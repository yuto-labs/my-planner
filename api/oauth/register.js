// Claudeが自分を「接続してくる相手」として登録する窓口(OAuthの動的クライアント登録)。
// 登録内容は保存しない。代わりに、戻り先URLがClaudeの公式のものだけかをここと許可画面の両方で確かめる。
import { randomUUID } from 'node:crypto';
import { isAllowedRedirect, readParams } from '../_oauth.js';

/** 戻り先URLを確かめて、接続用のID(client_id)を返す。 */
export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const params = readParams(req);
  const redirects = Array.isArray(params.redirect_uris) ? params.redirect_uris : [];
  if (!redirects.length || !redirects.every(isAllowedRedirect)) {
    return res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'Claude以外の戻り先は登録できません。' });
  }
  return res.status(201).json({
    client_id: `claude-${randomUUID()}`,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: params.client_name || 'Claude',
    redirect_uris: redirects,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  });
}
