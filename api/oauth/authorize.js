// Claudeとつなぐ時に開く「許可画面」。
// GET: 画面を表示する。画面はこのアプリと同じドメインなので、アプリのログイン情報(端末に保存済み)を
//      そのまま使える。別のパスワードを作らずに「今アプリにログインしている本人か」で判断する。
// POST: 「許可」なら本人確認と許可リスト(AI_ALLOWED_USERS)の確認をして、引換券を付けてClaudeへ戻す。
import { assertAiAllowed } from '../ai/_access.js';
import { fetchSupabaseUser } from '../_supabase.js';
import { isAllowedRedirect, issueCode, readParams } from '../_oauth.js';

/** 許可画面に必要な値がそろっていて、戻り先がClaudeのものかを確かめる。問題があれば理由を返す。 */
export function checkAuthorizeParams(params) {
  if (params.response_type !== 'code') return 'response_type が code ではありません。';
  if (!isAllowedRedirect(params.redirect_uri)) return '戻り先がClaudeのURLではありません。';
  if (!params.code_challenge || params.code_challenge_method !== 'S256') return 'PKCE(S256)が必要です。';
  return '';
}

/** 戻り先URLに引換券やエラーを付け足したURLを作る。 */
function redirectWith(params, extra) {
  const url = new URL(params.redirect_uri);
  Object.entries({ ...extra, state: params.state }).forEach(([key, value]) => value && url.searchParams.set(key, value));
  return url.href;
}

/** 許可画面のHTML。値はJSONとして埋め込み、< を変換して<script>の外へ出られないようにする。 */
function pageHtml(params) {
  const data = JSON.stringify({
    response_type: params.response_type, client_id: params.client_id || '', redirect_uri: params.redirect_uri,
    code_challenge: params.code_challenge, code_challenge_method: params.code_challenge_method, state: params.state || '',
  }).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Claudeとの接続</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f6f4; --card: #fff; --text: #1d1d1b; --muted: #6b6b66; --accent: #3a6df0; }
  @media (prefers-color-scheme: dark) { :root { --bg: #161615; --card: #232321; --text: #ececea; --muted: #a3a39d; --accent: #7aa2ff; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--text);
    font-family: system-ui, -apple-system, "Hiragino Sans", sans-serif; padding: 16px; box-sizing: border-box; }
  main { max-width: 420px; width: 100%; background: var(--card); border-radius: 16px; padding: 24px; box-shadow: 0 2px 12px rgb(0 0 0 / .08); }
  h1 { font-size: 18px; margin: 0 0 12px; }
  p, li { font-size: 14px; line-height: 1.7; color: var(--muted); }
  ul { padding-left: 20px; margin: 8px 0 16px; }
  .row { display: flex; gap: 8px; margin-top: 20px; }
  button { flex: 1; padding: 12px; border-radius: 10px; border: 1px solid var(--muted); background: transparent; color: var(--text); font-size: 15px; }
  #allow { background: var(--accent); border-color: var(--accent); color: #fff; }
  button:disabled { opacity: .4; }
  a { color: var(--accent); }
</style></head>
<body><main>
  <h1>Claudeに読み取りを許可しますか？</h1>
  <p>許可すると、Claudeがあなたの次の内容を<strong>読む</strong>ことができます。書き換えや削除はできません。</p>
  <ul><li>予定・今日の計画</li><li>タスク</li><li>メモ(データベースを含む)</li></ul>
  <p id="status">ログイン状態を確認しています…</p>
  <div class="row"><button id="deny" type="button">やめる</button><button id="allow" type="button" disabled>許可する</button></div>
</main>
<script type="application/json" id="params">${data}</script>
<script type="module">
  // アプリと同じログイン処理を使い、保存済みのログイン情報を読む(期限切れなら自動で取り直す)。
  import { getSession } from '/js/supabase.js';
  const params = JSON.parse(document.getElementById('params').textContent);
  const status = document.getElementById('status');
  const allow = document.getElementById('allow');
  const session = await getSession().catch(() => null);
  if (session?.access_token) {
    status.textContent = (session.user?.email || 'ログイン中のアカウント') + ' として許可します。';
    allow.disabled = false;
  } else {
    status.innerHTML = 'このブラウザでアプリにログインしていません。<a href="/" target="_blank" rel="noopener">アプリを開いてログイン</a>してから、このページを再読み込みしてください。';
  }
  /** 選んだ結果をサーバーへ送り、返ってきたClaudeの戻り先へ移動する。 */
  async function decide(decision) {
    allow.disabled = true;
    const response = await fetch(location.pathname, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...params, decision, access_token: session?.access_token || '' }),
    });
    const result = await response.json().catch(() => ({}));
    if (result.redirect) location.href = result.redirect;
    else { status.textContent = result.error || '許可できませんでした。'; allow.disabled = false; }
  }
  allow.addEventListener('click', () => decide('allow'));
  document.getElementById('deny').addEventListener('click', () => decide('deny'));
</script>
</body></html>`;
}

/** GETは許可画面を表示し、POSTは選んだ結果に応じて戻り先URLを返す。 */
export default async function handler(req, res) {
  const params = req.method === 'POST' ? readParams(req) : (req.query || {});
  const problem = checkAuthorizeParams(params);
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') {
    if (problem) return res.status(400).send(`接続できません: ${problem}`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(pageHtml(params));
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (problem) return res.status(400).json({ error: problem });
  if (params.decision !== 'allow') return res.status(200).json({ redirect: redirectWith(params, { error: 'access_denied' }) });
  try {
    const user = await fetchSupabaseUser(params.access_token);
    // AIを使ってよい本人(許可リスト)だけが接続できる。共有カレンダー用の他のアカウントは通さない。
    assertAiAllowed(user);
    const code = issueCode({ user, clientId: params.client_id, redirectUri: params.redirect_uri, codeChallenge: params.code_challenge });
    return res.status(200).json({ redirect: redirectWith(params, { code }) });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message });
  }
}
