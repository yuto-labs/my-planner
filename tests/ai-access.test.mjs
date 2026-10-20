// AIを許可リストのアカウントだけが使え、それ以外はGeminiを呼ぶ前に拒否されることを守るテスト。
import test from 'node:test';
import assert from 'node:assert/strict';

import { assertAiAllowed } from '../api/ai/_access.js';
import generateHandler from '../api/ai/generate.js';
import jobsHandler from '../api/ai/jobs.js';

/** 環境変数を一時的に変えてテストし、終わったら元に戻す。 */
function withAllowed(value, run) {
  const previous = process.env.AI_ALLOWED_USERS;
  if (value === undefined) delete process.env.AI_ALLOWED_USERS;
  else process.env.AI_ALLOWED_USERS = value;
  try { return run(); } finally {
    if (previous === undefined) delete process.env.AI_ALLOWED_USERS;
    else process.env.AI_ALLOWED_USERS = previous;
  }
}

/** Vercelのレスポンスの代わりに、状態コードと本文を記録する。 */
function recorder() {
  return {
    statusCode: 200,
    body: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

test('only listed emails or user ids may use AI, case-insensitively', () => {
  withAllowed(' Owner@Example.com , user-9 ', () => {
    assert.doesNotThrow(() => assertAiAllowed({ id: 'a', email: 'owner@example.com' }));
    assert.doesNotThrow(() => assertAiAllowed({ id: 'USER-9' }));
    assert.throws(() => assertAiAllowed({ id: 'b', email: 'someone@example.com' }), error => error.status === 403);
    assert.throws(() => assertAiAllowed(null), error => error.status === 403);
  });
});

test('a missing allow list refuses everyone instead of opening AI to all accounts', () => {
  withAllowed(undefined, () => {
    assert.throws(() => assertAiAllowed({ id: 'a', email: 'owner@example.com' }), error => error.status === 403);
  });
});

test('generate and jobs reject a signed-in but unlisted account before calling Gemini', async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-key';
  const called = [];
  globalThis.fetch = async url => {
    called.push(String(url));
    // ログイン確認は成功する(登録しただけの他人を想定)
    return new Response(JSON.stringify({ id: 'stranger', email: 'stranger@example.com' }), { status: 200 });
  };
  try {
    await withAllowed('owner@example.com', async () => {
      const generateRes = recorder();
      await generateHandler({
        method: 'POST',
        headers: { authorization: 'Bearer token' },
        body: { system: 'x', userText: 'hello', maxTokens: 100, modelPreference: 'fast', actionType: 'ai_request' },
      }, generateRes);
      assert.equal(generateRes.statusCode, 403);

      const jobsRes = recorder();
      await jobsHandler({ method: 'GET', headers: { authorization: 'Bearer token' }, query: {} }, jobsRes);
      assert.equal(jobsRes.statusCode, 403);
    });
    // 呼ばれたのはSupabaseのログイン確認だけで、Geminiには一度も届いていない。
    assert.ok(called.length > 0);
    assert.ok(called.every(url => url.includes('/auth/v1/user')));
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});
