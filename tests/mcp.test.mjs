// Claudeが予定・タスク・メモを読むための仕組み(OAuth + MCP)を守るテスト。
// 本人だけが許可でき、通行証が無ければ読めず、読む時は必ず本人の行だけに絞ることを確かめる。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { isAllowedRedirect, pkceMatches, signToken, verifyToken } from '../api/_oauth.js';
import { blocksToLines, jstText, runTool } from '../api/_mcp-data.js';
import authorizeHandler from '../api/oauth/authorize.js';
import tokenHandler from '../api/oauth/token.js';
import registerHandler from '../api/oauth/register.js';
import mcpHandler from '../api/mcp.js';

process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.AI_ALLOWED_USERS = 'owner@example.com';

const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';

/** Vercelのレスポンスの代わりに、状態コード・ヘッダー・本文を記録する。 */
function recorder() {
  return {
    statusCode: 200, body: null, headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
    end() { return this; },
  };
}

/** fetchを差し替えて、呼ばれたURLを記録しながら決まった応答を返す。 */
async function withFetch(respond, run) {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async url => { calls.push(decodeURIComponent(String(url))); return new Response(JSON.stringify(respond(String(url)))); };
  try { await run(calls); } finally { globalThis.fetch = previous; }
}

test('tokens are rejected when tampered, expired, or of another kind', () => {
  const token = signToken('access', { sub: 'u1' }, 60);
  assert.equal(verifyToken(token, 'access').sub, 'u1');
  assert.equal(verifyToken(token, 'refresh'), null);
  assert.equal(verifyToken(`${token.split('.')[0]}x.${token.split('.')[1]}`, 'access'), null);
  assert.equal(verifyToken(signToken('access', { sub: 'u1' }, 60, Date.now() - 120_000), 'access'), null);
  assert.equal(verifyToken('garbage', 'access'), null);
});

test('only Claude callbacks may receive a sign-in code', () => {
  assert.ok(isAllowedRedirect(CALLBACK));
  assert.ok(isAllowedRedirect('https://claude.com/api/mcp/auth_callback'));
  assert.ok(isAllowedRedirect('http://localhost:3118/callback'));
  assert.ok(!isAllowedRedirect('https://evil.example/api/mcp/auth_callback'));
  assert.ok(!isAllowedRedirect('http://claude.ai/api/mcp/auth_callback'));
  const res = recorder();
  registerHandler({ method: 'POST', body: { redirect_uris: ['https://evil.example/cb'] } }, res);
  assert.equal(res.statusCode, 400);
});

test('sign-in flow: allowed owner → code → token → MCP reads only their rows', async () => {
  const verifier = 'v'.repeat(50);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const params = { response_type: 'code', client_id: 'claude-1', redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz' };

  // 許可画面のGETはHTMLを返す。値は<script>の外へ出られない形で埋め込まれる。
  const page = recorder();
  await authorizeHandler({ method: 'GET', headers: {}, query: { ...params, state: '</script><b>' } }, page);
  assert.equal(page.statusCode, 200);
  assert.ok(!page.body.includes('</script><b>'));

  let code = '';
  await withFetch(() => ({ id: 'owner-id', email: 'owner@example.com' }), async () => {
    const res = recorder();
    await authorizeHandler({ method: 'POST', headers: {}, body: { ...params, decision: 'allow', access_token: 'session' } }, res);
    const redirect = new URL(res.body.redirect);
    assert.equal(redirect.origin + redirect.pathname, CALLBACK);
    assert.equal(redirect.searchParams.get('state'), 'xyz');
    code = redirect.searchParams.get('code');
  });

  // PKCEの合言葉が違えば通行証はもらえない。
  const bad = recorder();
  tokenHandler({ method: 'POST', body: { grant_type: 'authorization_code', code, redirect_uri: CALLBACK, client_id: 'claude-1', code_verifier: 'wrong' } }, bad);
  assert.equal(bad.body.error, 'invalid_grant');

  const ok = recorder();
  tokenHandler({ method: 'POST', body: `grant_type=authorization_code&code=${code}&redirect_uri=${encodeURIComponent(CALLBACK)}&client_id=claude-1&code_verifier=${verifier}` }, ok);
  assert.equal(ok.statusCode, 200);
  const access = ok.body.access_token;

  const refreshed = recorder();
  tokenHandler({ method: 'POST', body: { grant_type: 'refresh_token', refresh_token: ok.body.refresh_token } }, refreshed);
  assert.ok(refreshed.body.access_token);

  const listRes = recorder();
  await mcpHandler({ method: 'POST', headers: { authorization: `Bearer ${access}` }, body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } }, listRes);
  assert.deepEqual(listRes.body.result.tools.map(tool => tool.name), ['get_overview', 'list_events', 'list_tasks', 'search_memos', 'get_memo']);
  assert.ok(listRes.body.result.tools.every(tool => tool.annotations.readOnlyHint));

  await withFetch(() => [], async calls => {
    const res = recorder();
    await mcpHandler({ method: 'POST', headers: { authorization: `Bearer ${access}` }, body: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_overview', arguments: { date: '2026-10-22' } } } }, res);
    assert.equal(res.body.result.isError, undefined);
    assert.equal(calls.length, 3);
    assert.ok(calls.every(url => url.includes('user_id=eq.owner-id')));
  });
});

test('MCP asks for sign-in without a token, and refuses an unlisted or denied account', async () => {
  const res = recorder();
  await mcpHandler({ method: 'POST', headers: { host: 'example.app' }, body: { jsonrpc: '2.0', id: 1, method: 'initialize' } }, res);
  assert.equal(res.statusCode, 401);
  assert.match(res.headers['www-authenticate'], /resource_metadata="https:\/\/example\.app\/api\/oauth\/metadata\?kind=resource"/);

  const stranger = recorder();
  await mcpHandler({ method: 'POST', headers: { authorization: `Bearer ${signToken('access', { sub: 's', email: 'x@example.com' }, 60)}` }, body: {} }, stranger);
  assert.equal(stranger.statusCode, 403);

  await withFetch(() => ({ id: 's', email: 'x@example.com' }), async () => {
    const denied = recorder();
    await authorizeHandler({ method: 'POST', headers: {}, body: {
      response_type: 'code', redirect_uri: CALLBACK, code_challenge: 'c', code_challenge_method: 'S256', decision: 'allow', access_token: 't',
    } }, denied);
    assert.equal(denied.statusCode, 403);
  });
});

test('memos read as plain lines, and password-like database columns are never shown', async () => {
  assert.deepEqual(blocksToLines([
    { type: 'h2', text: '見出し' },
    { type: 'checklist', checked: true, text: '<mark>済み</mark> &amp; OK' },
    { type: 'toggle', text: '開閉', children: [{ type: 'bullet', text: '中身' }] },
  ]), ['## 見出し', '[x] 済み & OK', '▸ 開閉', '  ・中身']);
  assert.equal(jstText('2026-10-22T01:30:00.000Z'), '2026-10-22 10:30');

  const db = {
    type: 'database-data',
    data: { name: '就活', properties: [{ id: 'p1', name: 'ID', type: 'text' }, { id: 'p2', name: 'password', type: 'text' }], rows: { r1: { p1: 'AB1', p2: 'secret-1' } }, order: ['r1'] },
  };
  await withFetch(() => [
    { id: 'db1', title: '就活', tags: ['__database__'], blocks: [db], updated_at: '2026-10-22T00:00:00Z' },
    { id: 'r1', title: 'サンプル電機', tags: [], blocks: [], updated_at: '2026-10-22T00:00:00Z' },
  ], async () => {
    const table = await runTool('get_memo', { id: 'db1' }, 'owner-id');
    assert.deepEqual(table.columns, ['ID']);
    assert.deepEqual(table.rows, [{ id: 'r1', name: 'サンプル電機', ID: 'AB1' }]);
    const found = await runTool('search_memos', { query: 'ab1' }, 'owner-id');
    assert.equal(found.memos[0].database, '就活');
    assert.ok(!JSON.stringify(found).includes('secret-1'));
  });
});
