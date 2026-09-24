// Vercel Functionを偽物のHTTP要求・応答で呼び、認証やモデル切替を確認するテスト。
import test from 'node:test';
import assert from 'node:assert/strict';

import generateHandler from '../api/ai/generate.js';
import statusHandler from '../api/ai/status.js';

function createResponseRecorder() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

function geminiResponse(text) {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test('quality generation falls back after a model rate limit and reports the active model', async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GEMINI_API_KEY;
  const previousFast = process.env.GEMINI_MODEL_FAST;
  const previousQuality = process.env.GEMINI_MODEL_QUALITY;
  const previousFallback = process.env.GEMINI_FALLBACK_MODEL;
  const requestedModels = [];

  process.env.GEMINI_API_KEY = 'test-key';
  delete process.env.GEMINI_MODEL_FAST;
  delete process.env.GEMINI_MODEL_QUALITY;
  delete process.env.GEMINI_FALLBACK_MODEL;
  globalThis.fetch = async url => {
    const value = String(url);
    if (value.includes('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: 'user-1' }), { status: 200 });
    }
    const match = value.match(/\/models\/([^:]+):generateContent/);
    assert.ok(match, `unexpected request: ${value}`);
    const model = decodeURIComponent(match[1]);
    requestedModels.push(model);
    if (model === 'gemini-3.5-flash') {
      return new Response(JSON.stringify({ error: { message: 'rate limited' } }), { status: 429 });
    }
    return geminiResponse(JSON.stringify({
      title: 'Meeting',
      start: '2026-08-02T10:00:00',
      end: null,
    }));
  };

  try {
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer test-token' },
      body: {
        modelPreference: 'quality',
        actionType: 'event_parse',
        responseFormat: 'json',
        maxTokens: 300,
        userText: 'meeting at 10',
      },
    };
    const res = createResponseRecorder();
    await generateHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.model, 'gemini-3.5-flash-lite');
    assert.deepEqual(requestedModels, ['gemini-3.5-flash', 'gemini-3.5-flash-lite']);
    assert.equal(JSON.parse(res.body.text).title, 'Meeting');
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv('GEMINI_API_KEY', previousKey);
    restoreEnv('GEMINI_MODEL_FAST', previousFast);
    restoreEnv('GEMINI_MODEL_QUALITY', previousQuality);
    restoreEnv('GEMINI_FALLBACK_MODEL', previousFallback);
  }
});

test('AI status remains available when one configured model route is degraded', async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GEMINI_API_KEY;
  const previousFast = process.env.GEMINI_MODEL_FAST;
  const previousQuality = process.env.GEMINI_MODEL_QUALITY;

  process.env.GEMINI_API_KEY = 'test-key';
  delete process.env.GEMINI_MODEL_FAST;
  delete process.env.GEMINI_MODEL_QUALITY;
  globalThis.fetch = async url => new Response(null, {
    status: String(url).includes('gemini-3.5-flash-lite') ? 200 : 503,
  });

  try {
    const res = createResponseRecorder();
    await statusHandler({ method: 'GET', headers: {} }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.configured, true);
    assert.equal(res.body.available, true);
    assert.equal(res.body.message, 'gemini_model_degraded');
    assert.deepEqual(res.body.modelAvailability, { fast: true, quality: false });
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv('GEMINI_API_KEY', previousKey);
    restoreEnv('GEMINI_MODEL_FAST', previousFast);
    restoreEnv('GEMINI_MODEL_QUALITY', previousQuality);
  }
});

test('knowledge generation accepts short, vague, conceptual, and complex questions', async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-key';
  const questions = [
    '自由って何？',
    'それって結局どういうこと？',
    'レイリー散乱',
    '金利上昇が家計、企業、為替、物価へ波及する仕組みを知りたい',
  ];
  const prompts = [];
  globalThis.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value.includes('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: 'user-1' }), { status: 200 });
    }
    const request = JSON.parse(options.body || '{}');
    prompts.push(request.systemInstruction?.parts?.[0]?.text || '');
    const answerText = '質問の最も自然な解釈を明示し、前提から仕組み、具体例、限界まで順に説明します。'.repeat(35);
    return geminiResponse(JSON.stringify({
      title: '質問に応じた解説',
      classification: {
        majorId: 'interdisciplinary', middleId: 'unclassified', specialty: '', relatedCategoryIds: [],
      },
      primaryConcept: { key: 'question-core', label: '中心概念', aliases: [], role: 'primary' },
      concepts: [{ key: 'question-core', label: '中心概念', aliases: [], role: 'primary' }],
      facets: { periods: [], regions: [], people: [], organizations: [], works: [], systems: [] },
      timeline: { mode: 'timeless', startYear: null, endYear: null, precision: 'range', label: '' },
      geography: { scope: 'unclassified', regionIds: [], countryCodes: [] },
      answer: {
        directAnswer: [{ text: answerText, marks: [], conceptKey: 'question-core' }],
        keyPoints: ['中心的な意味を示す', '判断の前提を分ける', '限界と別解釈を区別する'],
        sections: [{ heading: '意味と仕組み', paragraphs: [[{ text: answerText, marks: [], conceptKey: '' }]], richBlocks: [] }],
        cautions: [],
      },
    }));
  };

  try {
    for (const question of questions) {
      const req = {
        method: 'POST',
        headers: { authorization: 'Bearer test-token' },
        body: {
          modelPreference: 'quality',
          actionType: 'knowledge_answer',
          responseFormat: 'json',
          maxTokens: 6500,
          systemText: '曖昧でも合理的に解釈して答える。',
          userText: JSON.stringify({ question }),
        },
      };
      const res = createResponseRecorder();
      await generateHandler(req, res);
      assert.equal(res.statusCode, 200, question);
      assert.doesNotMatch(res.body.text, /\[object Object\]/);
    }
    assert.equal(prompts.length, questions.length);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv('GEMINI_API_KEY', previousKey);
  }
});
