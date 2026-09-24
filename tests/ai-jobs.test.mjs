import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  BACKGROUND_ACTIONS,
  JOB_BLOCK_TYPE,
  JOB_TAG,
  errorMessage,
  generationApiUrl,
  rowToJob,
} from '../api/ai/jobs.js';
import { createAIJobId } from '../js/ai-jobs.js';
import {
  aiJobLabel,
  formatAIElapsed,
  hasShownAIJobNotice,
  normalizeAIJobNoticeHistory,
  rememberAIJobNotice,
} from '../js/ai-job-status.js';

test('only durable long-form AI actions use background jobs', () => {
  assert.deepEqual(
    [...BACKGROUND_ACTIONS].sort(),
    ['english_question', 'knowledge_answer', 'nuance_generate', 'translation_variants'].sort(),
  );
  assert.equal(BACKGROUND_ACTIONS.has('event_parse'), false);
  assert.equal(BACKGROUND_ACTIONS.has('planner_action'), false);
});

test('AI status labels and elapsed time stay compact and deterministic', () => {
  assert.equal(aiJobLabel({ actionType: 'english_question' }), '英語の疑問');
  assert.equal(aiJobLabel({ actionType: 'unknown' }), 'AI回答');
  assert.equal(formatAIElapsed('2026-09-22T00:00:00.000Z', Date.parse('2026-09-22T00:01:08.000Z')), '1:08');
  assert.equal(formatAIElapsed('2026-09-22T00:00:00.000Z', Date.parse('2026-09-22T01:02:03.000Z')), '1:02:03');
});

test('a failed AI job is announced once and old notice history stays bounded', () => {
  const now = Date.UTC(2026, 8, 24);
  const history = rememberAIJobNotice({}, 'job-1', 'save-failed', now);
  assert.equal(hasShownAIJobNotice(history, 'job-1', 'save-failed', now + 1000), true);
  assert.equal(hasShownAIJobNotice(history, 'job-1', 'generation-failed', now + 1000), false);
  const old = { old: now - (31 * 24 * 60 * 60 * 1000) };
  assert.deepEqual(normalizeAIJobNoticeHistory(old, now), {});
  const many = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`job-${index}`, now - index]));
  assert.equal(Object.keys(normalizeAIJobNoticeHistory(many, now)).length, 80);
});

test('AI job ids are valid, unique, and independent from memo ids', () => {
  const first = createAIJobId();
  const second = createAIJobId();
  assert.match(first, /^ai-job-[a-zA-Z0-9-]{12,80}$/);
  assert.match(second, /^ai-job-[a-zA-Z0-9-]{12,80}$/);
  assert.notEqual(first, second);
});

test('stored internal records restore job state without exposing row metadata', () => {
  const row = {
    id: 'ai-job-123456789abc',
    title: 'AI generation job',
    summary: 'completed',
    tags: [JOB_TAG],
    blocks: [{
      id: 'ai-job-123456789abc-data',
      type: JOB_BLOCK_TYPE,
      data: {
        status: 'completed',
        actionType: 'knowledge_answer',
        resultText: '{"title":"answer"}',
        createdAt: '2026-09-22T00:00:00.000Z',
      },
    }],
    created_at: '2026-09-22T00:00:00.000Z',
    updated_at: '2026-09-22T00:01:00.000Z',
  };
  assert.deepEqual(rowToJob(row), {
    id: row.id,
    status: 'completed',
    actionType: 'knowledge_answer',
    resultText: '{"title":"answer"}',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
});

test('malformed knowledge memo rows are never treated as AI jobs', () => {
  assert.equal(rowToJob(null), null);
  assert.equal(rowToJob({ id: 'memo', blocks: [] }), null);
  assert.equal(rowToJob({
    id: 'memo',
    blocks: [{ type: 'paragraph', data: { status: 'completed' } }],
  }), null);
});

test('background jobs persist a readable nested upstream error', () => {
  assert.equal(errorMessage({ error: { message: 'Gemini request rejected' } }), 'Gemini request rejected');
  assert.equal(errorMessage({ message: '[object Object]' }, 'AI生成に失敗しました。'), 'AI生成に失敗しました。');
});

test('offline app shell contains both background job modules', async () => {
  const serviceWorker = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  assert.match(serviceWorker, /\.\/js\/ai-jobs\.js/);
  assert.match(serviceWorker, /\.\/js\/ai-job-resume\.js/);
  assert.match(serviceWorker, /\.\/js\/ai-job-status\.js/);
});

test('job creation waits until generation has started and persisted a terminal state', async () => {
  const source = await readFile(new URL('../api/ai/jobs.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /waitUntil\s*\(\s*runJob/);
  assert.match(source, /await runJob\s*\(\{/);
  assert.match(source, /const finishedRow = await readJobRow/);
});

test('background generation uses the public request host instead of a protected deployment URL', () => {
  const previous = process.env.VERCEL_URL;
  process.env.VERCEL_URL = 'protected-preview.example.vercel.app';
  try {
    assert.equal(
      generationApiUrl({ headers: { host: 'my-planner-five-alpha.vercel.app' } }),
      'https://my-planner-five-alpha.vercel.app/api/ai/generate',
    );
    assert.equal(
      generationApiUrl({ headers: { host: '127.0.0.1:5180' } }),
      'http://127.0.0.1:5180/api/ai/generate',
    );
  } finally {
    if (previous === undefined) delete process.env.VERCEL_URL;
    else process.env.VERCEL_URL = previous;
  }
});
