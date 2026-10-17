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
  default as jobsHandler,
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

test('a Knowledge job survives one provider 503 and saves the later answer', async () => {
  const originalFetch = globalThis.fetch;
  let storedRow = null;
  let generationCalls = 0;
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (path.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'user-1' }), { status: 200 });
    if (path.includes('/rest/v1/knowledge_memos')) {
      if (options.method === 'POST') {
        storedRow = JSON.parse(options.body);
        return new Response(JSON.stringify([storedRow]), { status: 201 });
      }
      return new Response(JSON.stringify(storedRow ? [storedRow] : []), { status: 200 });
    }
    if (path.endsWith('/api/ai/generate')) {
      generationCalls++;
      return generationCalls === 1
        ? new Response(JSON.stringify({ error: 'This model is currently experiencing high demand.' }), { status: 503 })
        : new Response(JSON.stringify({ text: '{"title":"レイリー散乱"}', model: 'gemini-3.8-flash' }), { status: 200 });
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  const res = {
    statusCode: 200,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  try {
    await jobsHandler({
      method: 'POST', headers: { authorization: 'Bearer test-token', host: '127.0.0.1:5180' },
      body: {
        id: 'ai-job-knowledge-503-retry',
        request: { actionType: 'knowledge_answer', userText: '夕焼けとレイリー散乱の関係' },
        clientContext: { kind: 'knowledge', question: '夕焼けとレイリー散乱の関係' },
      },
    }, res);
    assert.equal(res.statusCode, 202);
    assert.equal(generationCalls, 2);
    assert.equal(res.body.job.status, 'completed');
    assert.equal(res.body.job.resultText, '{"title":"レイリー散乱"}');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('offline app shell contains both background job modules', async () => {
  const serviceWorker = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  assert.match(serviceWorker, /\.\/js\/ai-jobs\.js/);
  assert.match(serviceWorker, /\.\/js\/ai-job-resume\.js/);
  assert.match(serviceWorker, /\.\/js\/ai-job-status\.js/);
});

test('job creation keeps the server worker alive until a terminal state is persisted', async () => {
  const source = await readFile(new URL('../api/ai/jobs.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /waitUntil\s*\(\s*runJob/);
  assert.match(source, /await runJob\s*\(\{/);
  assert.match(source, /const finishedRow = await readJobRow/);
  assert.match(source, /res\.status\(202\)\.json/);
});

test('the client checks the durable job id before treating a lost submit response as failure', async () => {
  const source = await readFile(new URL('../js/ai-jobs.js', import.meta.url), 'utf8');
  assert.match(source, /submitted = await getAIJob\(id\)/);
  assert.match(source, /'submit-recovered'/);
});

test('a surfaced generation failure is not automatically submitted again', async () => {
  const source = await readFile(new URL('../js/ai-job-resume.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /retryableFailure/);
  assert.match(source, /if \(!stalled \|\| !job\.request\) return false/);
  assert.match(source, /failedApplyThisSession\.add\(job\.id\)/);
  assert.doesNotMatch(source, /await acknowledgeAIJob\(job\.id\)/);
});

test('an actively awaited result has only one save owner', async () => {
  const source = await readFile(new URL('../js/ai-jobs.js', import.meta.url), 'utf8');
  const resumeSource = await readFile(new URL('../js/ai-job-resume.js', import.meta.url), 'utf8');
  const readyEvents = source.match(/new CustomEvent\('ai:job-ready'/g) || [];
  assert.equal(readyEvents.length, 1);
  assert.match(source, /if \(error\?\.name === 'AbortError'\)/);
  assert.match(source, /if \(signal\?\.aborted\)\s*\{\s*foregroundJobs\.delete\(id\);\s*notifyAIJobReady\(id\);\s*throw new DOMException/);
  assert.match(resumeSource, /if \(isAIJobOwnedByForeground\(job\.id\)\) continue/);
});

test('a completed response arriving after leaving the screen is handed to background saving', async () => {
  const source = await readFile(new URL('../js/ai-jobs.js', import.meta.url), 'utf8');
  const isolated = source
    .replace("import { getSession } from './supabase.js';", "const getSession = async () => ({ access_token: 'test-token' });")
    .replace("import { extractAIErrorMessage, getFriendlyAIJobError } from './ai-response.js';", "const extractAIErrorMessage = value => String(value); const getFriendlyAIJobError = value => String(value);");
  const module = await import(`data:text/javascript;base64,${Buffer.from(isolated).toString('base64')}`);
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  const originalCustomEvent = globalThis.CustomEvent;
  const events = [];
  let finishRequest;
  let submittedId = '';
  globalThis.document = { dispatchEvent(event) { events.push(event.type); } };
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, options) { this.type = type; this.detail = options?.detail; }
  };
  globalThis.fetch = (_url, options) => new Promise(resolve => {
    submittedId = JSON.parse(options.body).id;
    finishRequest = resolve;
  });
  try {
    const controller = new AbortController();
    const pending = module.runAIJob({ actionType: 'knowledge_answer' }, { kind: 'knowledge' }, {
      signal: controller.signal,
    });
    await new Promise(resolve => setImmediate(resolve));
    controller.abort();
    finishRequest(new Response(JSON.stringify({ job: {
      id: 'ai-job-completed-after-navigation',
      actionType: 'knowledge_answer',
      status: 'completed',
      resultText: '{"title":"saved by resume"}',
    } }), { status: 202 }));
    await assert.rejects(pending, error => error?.name === 'AbortError');
    assert.equal(events.filter(type => type === 'ai:job-ready').length, 1);
    assert.equal(module.isAIJobOwnedByForeground(submittedId), false);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.document = originalDocument;
    globalThis.CustomEvent = originalCustomEvent;
  }
});

test('status polling recovers an unowned completed Atlas job once', async () => {
  const source = await readFile(new URL('../js/ai-job-status.js', import.meta.url), 'utf8');
  const isolated = source
    .replace("import { acknowledgeAIJob, isAIJobOwnedByForeground, listAIJobs } from './ai-jobs.js';", `
      const acknowledgeAIJob = async () => {};
      const isAIJobOwnedByForeground = () => globalThis.__aiTestOwned;
      const listAIJobs = async () => globalThis.__aiTestJobs;
    `)
    .replace("import { getFriendlyAIJobError } from './ai-response.js';", "const getFriendlyAIJobError = value => String(value);");
  const module = await import(`data:text/javascript;base64,${Buffer.from(isolated).toString('base64')}`);
  const originalDocument = globalThis.document;
  const originalCustomEvent = globalThis.CustomEvent;
  const events = [];
  globalThis.__aiTestOwned = true;
  globalThis.__aiTestJobs = [{
    id: 'ai-job-atlas-complete', actionType: 'nuance_generate', status: 'completed', resultText: '{"entries":[]}',
  }];
  globalThis.document = { hidden: false, dispatchEvent(event) { events.push(event.type); } };
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, options) { this.type = type; this.detail = options?.detail; }
  };
  try {
    await module.refreshAIJobStatus();
    assert.deepEqual(events, []);
    globalThis.__aiTestOwned = false;
    await module.refreshAIJobStatus();
    await module.refreshAIJobStatus();
    assert.deepEqual(events, ['ai:job-ready']);
  } finally {
    globalThis.document = originalDocument;
    globalThis.CustomEvent = originalCustomEvent;
    delete globalThis.__aiTestOwned;
    delete globalThis.__aiTestJobs;
  }
});

test('foreground return checks completed jobs even while editing defers a cloud pull', async () => {
  const source = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  const foreground = source.slice(source.indexOf("document.addEventListener('visibilitychange'"), source.indexOf("window.addEventListener('pagehide'"));
  assert.ok(foreground.indexOf('resumeCompletedAIJobs()') < foreground.indexOf('if (isUserEditing() || hasPendingSyncWork())'));
});

test('Knowledge asks for short semantic highlight segments without Markdown symbols', async () => {
  const source = await readFile(new URL('../js/ai.js', import.meta.url), 'utf8');
  const prompt = source.slice(source.indexOf('export async function generateKnowledgeAnswer'), source.indexOf('export async function generateNuanceEntries'));
  assert.match(prompt, /marks:\["strong"\]/);
  assert.match(prompt, /marks:\["highlight-yellow"\]/);
  assert.match(prompt, /Surrounding words must remain separate unmarked segments/);
  assert.match(prompt, /Do not output Markdown, HTML/);
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

test('Atlas background jobs keep only the compact merge context', async () => {
  const source = await readFile(new URL('../js/ai.js', import.meta.url), 'utf8');
  const nuanceStart = source.indexOf('export async function generateNuanceEntries');
  const translationStart = source.indexOf('export async function generateTranslationVariants');
  const nuanceSource = source.slice(nuanceStart, translationStart);

  assert.match(nuanceSource, /referenceExpressions:\s*catalogExpressions/);
  assert.match(nuanceSource, /existingExpressions:\s*knownExpressions/);
  assert.match(nuanceSource, /existingTaxonomy:[\s\S]*?\.slice\(0, 40\)/);
  assert.doesNotMatch(nuanceSource, /referenceExpressions,\s*existingTaxonomy/);
});
