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
