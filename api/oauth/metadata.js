// Claudeが最初に読む「このサーバーへのログイン方法の案内」(OAuthのディスカバリー)。
// vercel.json で /.well-known/... のURLをここへ向けている。
//   kind=resource: 読み取りAPI(/api/mcp)を守っているログイン窓口はどこか
//   kind=server  : ログイン窓口の各URLと、対応している方式
import { siteOrigin } from '../_oauth.js';

/** 案内のJSONを返す。どちらも秘密は含まない公開情報。 */
export default function handler(req, res) {
  const origin = siteOrigin(req);
  const body = req.query?.kind === 'server'
    ? {
      issuer: origin,
      authorization_endpoint: `${origin}/api/oauth/authorize`,
      token_endpoint: `${origin}/api/oauth/token`,
      registration_endpoint: `${origin}/api/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['read'],
    }
    : {
      resource: `${origin}/api/mcp`,
      authorization_servers: [origin],
      scopes_supported: ['read'],
      bearer_methods_supported: ['header'],
    };
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(body);
}
