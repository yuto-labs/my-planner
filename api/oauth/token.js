// 引換券(code)や更新券(refresh token)を、読み取り用の通行証(access token)に替える窓口。
import { issueTokens, pkceMatches, readParams, verifyToken } from '../_oauth.js';

/** OAuthの決まりどおりのエラー(400 + error)を返す。 */
function fail(res, error, description) {
  return res.status(400).json({ error, error_description: description });
}

/** grant_typeに応じて券を確かめ、新しい通行証と更新券を返す。 */
export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  res.setHeader('Cache-Control', 'no-store');
  const params = readParams(req);
  try {
    if (params.grant_type === 'authorization_code') {
      const code = verifyToken(params.code, 'code');
      if (!code) return fail(res, 'invalid_grant', '引換券が無効か、期限切れです。');
      // 許可した時と同じ相手・同じ戻り先で、PKCEの合言葉も合う時だけ通す(券を盗まれても使えない)。
      if (code.ru !== params.redirect_uri || (params.client_id && code.cid !== params.client_id)) {
        return fail(res, 'invalid_grant', '許可した時と相手が違います。');
      }
      if (!pkceMatches(params.code_verifier, code.cc)) return fail(res, 'invalid_grant', 'PKCEの確認に失敗しました。');
      return res.status(200).json(issueTokens(code));
    }
    if (params.grant_type === 'refresh_token') {
      const refresh = verifyToken(params.refresh_token, 'refresh');
      if (!refresh) return fail(res, 'invalid_grant', '更新券が無効か、期限切れです。');
      return res.status(200).json(issueTokens(refresh));
    }
    return fail(res, 'unsupported_grant_type', '対応していない方式です。');
  } catch (error) {
    return res.status(error.status || 500).json({ error: 'server_error', error_description: error.message });
  }
}
