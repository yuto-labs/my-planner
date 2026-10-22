// ClaudeのカスタムコネクタがつながるMCPサーバー(読み取り専用)。URL: /api/mcp
//
// MCPは「Claudeが使える道具の一覧を聞く(tools/list)」「道具を呼ぶ(tools/call)」などを
// JSON-RPCという決まった形のPOSTでやり取りする仕組み。ここでは会話の状態を持たず、毎回1往復で答える。
// 通行証(_oauth.jsで発行)が無い・無効なら401を返し、Claudeにログイン(許可画面)を始めさせる。
import { assertAiAllowed } from './ai/_access.js';
import { TOOLS, runTool } from './_mcp-data.js';
import { readParams, siteOrigin, verifyToken } from './_oauth.js';

// 対応しているMCPの版。Claudeが求めた版が一覧にあればそれで、なければ最新で答える。
const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const INSTRUCTIONS = 'マイプランナー(本人の予定・今日の計画・タスク・メモ)を読むための道具です。読み取り専用で、日時はすべて日本時間です。'
  + '1日の確認には get_overview、メモは search_memos で探してから get_memo で全文を読んでください。';

/** JSON-RPCのメッセージ1件に答える。idの無い通知(notifications/...)には答えない(nullを返す)。 */
export async function handleMessage(message, userId) {
  const { id, method, params = {} } = message || {};
  if (id === undefined || id === null) return null;
  /** 成功の返事を作る。 */
  const reply = result => ({ jsonrpc: '2.0', id, result });
  switch (method) {
    case 'initialize':
      return reply({
        protocolVersion: SUPPORTED_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'my-planner', title: 'My Planner', version: '1.0.0' },
        instructions: INSTRUCTIONS,
      });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS });
    case 'tools/call':
      try {
        const data = await runTool(params.name, params.arguments || {}, userId);
        return reply({ content: [{ type: 'text', text: JSON.stringify(data) }] });
      } catch (error) {
        // 道具の失敗(日付の形が違う等)は、AIが読んで直せるように結果の中で伝える。
        return reply({ content: [{ type: 'text', text: error.message }], isError: true });
      }
    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
  }
}

/** 通行証を確かめてから、届いたメッセージ(1件または複数)に答える。 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  let auth = null;
  try {
    const token = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1];
    auth = verifyToken(token, 'access');
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message });
  }
  if (!auth) {
    // どこでログインすればよいかを伝える。Claudeはこれを読んで許可画面を開く。
    res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${siteOrigin(req)}/api/oauth/metadata?kind=resource"`);
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    // 許可リストから外したアカウントは、発行済みの通行証が残っていても読めないようにする。
    assertAiAllowed({ id: auth.sub, email: auth.email });
  } catch (error) {
    return res.status(403).json({ error: error.message });
  }
  const body = readParams(req);
  const messages = Array.isArray(body) ? body : [body];
  const replies = (await Promise.all(messages.map(message => handleMessage(message, auth.sub)))).filter(Boolean);
  if (!replies.length) return res.status(202).end();
  return res.status(200).json(Array.isArray(body) ? replies : replies[0]);
}
