// ClaudeのコネクタがこのアプリのデータをAIに読ませるための「ログインの仕組み」(OAuth)の部品。
//
// 流れ: Claudeが /api/oauth/authorize を開く → アプリにログイン済みの本人が「許可」を押す
//   → 短命の「引換券(code)」をClaudeへ渡す → Claudeが /api/oauth/token で引換券を
//   「通行証(access token)」に替える → 以後 /api/mcp に通行証を付けて読みに来る。
//
// 引換券も通行証も、中身(誰か・期限)に電子署名を付けた文字列にする。サーバーに保存しないので
// データベースの表を増やさずに済み、署名が合わない・期限切れのものは受け付けない。
// 署名の鍵はservice role keyから作る。MCP_TOKEN_VERSION を変えると、発行済みの通行証がすべて無効になる。
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { serviceRoleKey } from './_supabase.js';

const ACCESS_TTL = 60 * 60;            // 通行証: 1時間(切れたら下の更新券で自動で取り直す)
const REFRESH_TTL = 60 * 60 * 24 * 90; // 更新券: 90日
const CODE_TTL = 5 * 60;               // 引換券: 5分

/** 署名に使う鍵。service role keyそのものは使わず、用途名を混ぜて別の鍵にする。 */
function signingKey() {
  return createHmac('sha256', serviceRoleKey())
    .update(`my-planner-mcp:${process.env.MCP_TOKEN_VERSION || '1'}`)
    .digest();
}

/** 中身(payload)に種類と期限を足して署名し、「中身.署名」の文字列にする。 */
export function signToken(type, payload, ttlSeconds, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ ...payload, typ: type, exp: Math.floor(now / 1000) + ttlSeconds })).toString('base64url');
  return `${body}.${createHmac('sha256', signingKey()).update(body).digest('base64url')}`;
}

/** 署名・種類・期限がすべて正しければ中身を返し、1つでも違えばnullを返す。 */
export function verifyToken(token, type, now = Date.now()) {
  const [body, signature] = String(token || '').split('.');
  if (!body || !signature) return null;
  const expected = createHmac('sha256', signingKey()).update(body).digest();
  const given = Buffer.from(signature, 'base64url');
  // 長さ違いや1文字違いを、比べる時間の差から推測されないよう timingSafeEqual で比べる。
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return payload.typ === type && payload.exp * 1000 > now ? payload : null;
  } catch {
    return null;
  }
}

/**
 * 引換券の送り先として認めるURLか。Claudeの公式の戻り先(claude.ai / claude.com)と、
 * Claude Codeが手元のPCで使う http://localhost:任意の番号/callback だけを認める。
 * これ以外へ送ると、他人のサイトに引換券を渡してしまうため。
 */
export function isAllowedRedirect(uri) {
  try {
    const url = new URL(uri);
    if (url.protocol === 'https:') return ['claude.ai', 'claude.com'].includes(url.hostname) && url.pathname === '/api/mcp/auth_callback';
    return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname === '/callback';
  } catch {
    return false;
  }
}

/** PKCE: Claudeが最初に見せた「合言葉のハッシュ」と、後から出した合言葉が合うか確かめる。 */
export function pkceMatches(verifier, challenge) {
  return !!verifier && !!challenge && createHash('sha256').update(String(verifier)).digest('base64url') === challenge;
}

/** 本人の情報から、5分だけ有効な引換券を作る。送り先とPKCEも券の中に入れて後で照合する。 */
export function issueCode({ user, clientId, redirectUri, codeChallenge }) {
  return signToken('code', { sub: user.id, email: user.email || '', cid: clientId, ru: redirectUri, cc: codeChallenge }, CODE_TTL);
}

/** 通行証と更新券をまとめて発行する(OAuthのトークン応答の形)。 */
export function issueTokens({ sub, email }) {
  return {
    access_token: signToken('access', { sub, email }, ACCESS_TTL),
    token_type: 'Bearer',
    expires_in: ACCESS_TTL,
    refresh_token: signToken('refresh', { sub, email }, REFRESH_TTL),
    scope: 'read',
  };
}

/** このサイト自身のURL(https://ドメイン)。リクエストのHostから作るので、ドメインを変えても動く。 */
export function siteOrigin(req) {
  return `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
}

/** JSONでもフォーム形式(a=1&b=2)でも、bodyを1つのオブジェクトにそろえる。 */
export function readParams(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const text = String(req.body || '');
  if (text.trim().startsWith('{')) {
    try { return JSON.parse(text); } catch { return {}; }
  }
  return Object.fromEntries(new URLSearchParams(text));
}
