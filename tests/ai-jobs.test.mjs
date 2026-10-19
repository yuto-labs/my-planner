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

test('a completed response arriving after leaving the screen leaves saving to status polling', async () => {
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
    assert.equal(events.filter(type => type === 'ai:job-ready').length, 0);
    assert.equal(module.isAIJobOwnedByForeground(submittedId), false);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.document = originalDocument;
    globalThis.CustomEvent = originalCustomEvent;
  }
});

test('leaving during a pending submission releases the result for background saving', async () => {
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
    assert.equal(module.isAIJobOwnedByForeground(submittedId), true);
    controller.abort();
    await assert.rejects(pending, error => error?.name === 'AbortError');
    assert.equal(module.isAIJobOwnedByForeground(submittedId), false);
    assert.equal(events.includes('ai:job-ready'), false);
    const statusEventsBeforeLateResponse = events.filter(type => type === 'ai:job-status').length;
    finishRequest(new Response(JSON.stringify({ job: {
      id: submittedId, status: 'completed', resultText: '{"answer":"ready"}',
    } }), { status: 202 }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(events.filter(type => type === 'ai:job-status').length, statusEventsBeforeLateResponse);
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
    .replace("import { resumeCompletedAIJobs } from './ai-job-resume.js';", "const resumeCompletedAIJobs = async () => { globalThis.__aiTestResumeCount++; };")
    .replace("import { getFriendlyAIJobError } from './ai-response.js';", "const getFriendlyAIJobError = value => String(value);");
  const module = await import(`data:text/javascript;base64,${Buffer.from(isolated).toString('base64')}`);
  const originalDocument = globalThis.document;
  const originalCustomEvent = globalThis.CustomEvent;
  const events = [];
  globalThis.__aiTestOwned = true;
  globalThis.__aiTestResumeCount = 0;
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
    globalThis.__aiTestJobs = [{
      id: 'ai-job-atlas-stalled', actionType: 'nuance_generate', status: 'running',
      updatedAt: new Date(Date.now() - 400_000).toISOString(),
    }];
    await module.refreshAIJobStatus();
    await module.refreshAIJobStatus();
    assert.equal(globalThis.__aiTestResumeCount, 1);
  } finally {
    globalThis.document = originalDocument;
    globalThis.CustomEvent = originalCustomEvent;
    delete globalThis.__aiTestOwned;
    delete globalThis.__aiTestJobs;
    delete globalThis.__aiTestResumeCount;
  }
});

test('dismissing progress does not hide the eventual saved notice', async () => {
  const source = await readFile(new URL('../js/ai-job-status.js', import.meta.url), 'utf8');
  const isolated = source
    .replace("import { acknowledgeAIJob, isAIJobOwnedByForeground, listAIJobs } from './ai-jobs.js';", `
      const acknowledgeAIJob = async () => {};
      const isAIJobOwnedByForeground = () => false;
      const listAIJobs = async () => globalThis.__aiTestStatusJobs;
    `)
    .replace("import { resumeCompletedAIJobs } from './ai-job-resume.js';", 'const resumeCompletedAIJobs = async () => {};')
    .replace("import { getFriendlyAIJobError } from './ai-response.js';", 'const getFriendlyAIJobError = value => String(value);');
  const originalDocument = globalThis.document;
  const originalCustomEvent = globalThis.CustomEvent;
  const originalLocalStorage = globalThis.localStorage;
  const listeners = new Map();
  const host = {
    dataset: {},
    hidden: true,
    close: null,
    set innerHTML(value) {
      this.html = value;
      this.close = value.includes('ai-job-status__close')
        ? { click: null, addEventListener(_type, handler) { this.click = handler; } }
        : null;
    },
    get innerHTML() { return this.html || ''; },
    querySelector() { return this.close; },
  };
  globalThis.document = {
    hidden: false,
    getElementById: () => host,
    addEventListener(type, handler) { listeners.set(type, handler); },
    dispatchEvent(event) { listeners.get(event.type)?.(event); },
  };
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, options) { this.type = type; this.detail = options?.detail; }
  };
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  globalThis.__aiTestStatusJobs = [];
  const module = await import(`data:text/javascript;base64,${Buffer.from(isolated).toString('base64')}#dismiss`);
  try {
    module.initAIJobStatus();
    await new Promise(resolve => setImmediate(resolve));
    const job = { id: 'ai-job-dismiss-test', actionType: 'nuance_generate', status: 'running' };
    document.dispatchEvent(new CustomEvent('ai:job-status', { detail: { job } }));
    assert.equal(host.hidden, false);
    assert.match(host.innerHTML, /表示を閉じる（処理は続きます）/);
    host.close.click();
    assert.equal(host.hidden, true);
    globalThis.__aiTestStatusJobs = [job];
    await module.refreshAIJobStatus();
    assert.equal(host.hidden, true);

    document.dispatchEvent(new CustomEvent('ai:job-status', { detail: { job: {
      id: 'ai-job-new-test', actionType: 'knowledge_answer', status: 'running',
    } } }));
    assert.match(host.innerHTML, /Knowledgeの回答を作成中/);

    document.dispatchEvent(new CustomEvent('ai:job-saved', { detail: { id: job.id } }));
    assert.equal(host.hidden, false);
    assert.match(host.innerHTML, /表現帳の解説が完了しました/);
    host.close.click();
    assert.match(host.innerHTML, /Knowledgeの回答を作成中/);
    host.close.click();
    assert.equal(host.hidden, true);
  } finally {
    module.destroyAIJobStatus();
    globalThis.document = originalDocument;
    globalThis.CustomEvent = originalCustomEvent;
    globalThis.localStorage = originalLocalStorage;
    delete globalThis.__aiTestStatusJobs;
  }
});

test('foreground save announces completion only after sync and job acknowledgement', async () => {
  const source = await readFile(new URL('../js/ai-jobs.js', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('export async function acknowledgeAIJobAfterSync('), source.indexOf('/** 指定時間だけ待機する。'));
  assert.ok(body.indexOf('await flushPendingSync()') < body.indexOf('await acknowledgeAIJob(id)'));
  assert.ok(body.indexOf('await acknowledgeAIJob(id)') < body.indexOf("new CustomEvent('ai:job-saved'"));
  assert.match(body, /const savedByForeground = foregroundJobs\.has\(id\)/);
});

test('completed background jobs restore all four learning destinations without taking an owned job', async () => {
  const source = await readFile(new URL('../js/ai-job-resume.js', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('let resumePromise = null;'));
  const names = [
    'addExpressionEntriesWithReport', 'addLearningEntry', 'archiveLocalSyncBackups',
    'addTranslationSet', 'getEnglishQuestions', 'getLearningEntries', 'updateEnglishQuestion',
    'answerEnglishLearningQuestion', 'generateKnowledgeAnswer', 'generateNuanceEntries',
    'generateTranslationVariants', 'acknowledgeAIJobAfterSync', 'isAIJobOwnedByForeground',
    'listAIJobs', 'submitAIJob', 'findDuplicateKnowledgeEntries', 'normalizeKnowledgeAnswer',
    'validateKnowledgeEntry',
  ];
  const isolated = `const { ${names.join(', ')} } = globalThis.__aiResumeHarness;\n${body}`;
  const originalDocument = globalThis.document;
  const originalCustomEvent = globalThis.CustomEvent;
  const originalWindow = globalThis.window;
  const saved = [];
  const acknowledged = [];
  const events = [];
  const jobs = [
    { id: 'knowledge-job', status: 'completed', resultText: '{"title":"Cloud"}', clientContext: { kind: 'knowledge', question: 'クラウドとは' } },
    { id: 'atlas-job', status: 'completed', resultText: '{"term":"range"}', clientContext: { kind: 'nuance', input: { expression: 'range' } } },
    { id: 'translation-job', status: 'completed', resultText: '{"sourceTextJa":"帰る"}', clientContext: { kind: 'translation', input: { sourceTextJa: '帰る' } } },
    { id: 'english-job', status: 'completed', resultText: '{"answer":"ready"}', clientContext: { kind: 'english-question', questionId: 'question-1', question: 'makeとは' } },
    { id: 'owned-job', status: 'completed', resultText: '{"title":"Owned"}', clientContext: { kind: 'knowledge', question: '保存中' } },
  ];
  globalThis.__aiResumeHarness = {
    addExpressionEntriesWithReport(entries) { saved.push(['atlas', entries]); return { entries }; },
    addLearningEntry(entry) { saved.push(['knowledge', entry]); return entry; },
    archiveLocalSyncBackups: async () => {},
    addTranslationSet(set) { saved.push(['translation', set]); return set; },
    getEnglishQuestions: () => [{ id: 'question-1', status: 'pending', questionJa: 'makeとは' }],
    getLearningEntries: () => [],
    updateEnglishQuestion(id, changes) { saved.push(['english-question', id, changes]); return changes; },
    answerEnglishLearningQuestion: async (_question, options) => JSON.parse(options.completedText),
    generateKnowledgeAnswer: async (_question, _taxonomy, options) => JSON.parse(options.completedText),
    generateNuanceEntries: async (_input, options) => [JSON.parse(options.completedText)],
    generateTranslationVariants: async (_input, options) => JSON.parse(options.completedText),
    acknowledgeAIJobAfterSync: async id => { acknowledged.push(id); },
    isAIJobOwnedByForeground: id => id === 'owned-job',
    listAIJobs: async () => jobs,
    submitAIJob: async () => { throw new Error('completed jobs must not restart'); },
    findDuplicateKnowledgeEntries: () => [],
    normalizeKnowledgeAnswer: (raw, question) => ({ ...raw, originalQuestion: question }),
    validateKnowledgeEntry: () => ({ valid: true }),
  };
  globalThis.document = { dispatchEvent(event) { events.push(event.type); } };
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, options) { this.type = type; this.detail = options?.detail; }
  };
  globalThis.window = { AppNav: { showToast() {}, refreshCurrentView() {} } };
  try {
    const module = await import(`data:text/javascript;base64,${Buffer.from(isolated).toString('base64')}`);
    const result = await module.resumeCompletedAIJobs();
    assert.equal(result.applied, 4);
    assert.deepEqual(saved.map(item => item[0]), ['knowledge', 'atlas', 'translation', 'english-question']);
    assert.deepEqual(acknowledged, jobs.slice(0, 4).map(job => job.id));
    assert.equal(events.filter(type => type === 'ai:job-applied').length, 4);
  } finally {
    globalThis.document = originalDocument;
    globalThis.CustomEvent = originalCustomEvent;
    globalThis.window = originalWindow;
    delete globalThis.__aiResumeHarness;
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

test('Knowledge emphasis segments render as visible strong text and highlights', async () => {
  const source = await readFile(new URL('../js/modules/learning-library.js', import.meta.url), 'utf8');
  const style = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
  const start = source.indexOf('function renderSegments(');
  const end = source.indexOf('/** AI回答の表・数式', start);
  assert.ok(start >= 0 && end > start);
  const { esc } = await import('../js/utils.js');
  const render = new Function('esc', 'findKnowledgeConceptMatches', `${source.slice(start, end)}; return renderSegments;`)(
    esc, () => [],
  );
  const html = render([
    { text: '理由は', marks: [] },
    { text: '光の散乱', marks: ['strong', 'highlight-yellow'] },
    { text: 'です。', marks: [] },
  ], new Map(), 'current');
  assert.match(html, /理由は<mark class="learning-mark learning-mark--yellow"><strong>光の散乱<\/strong><\/mark>です。/);
  assert.match(style, /\.learning-mark--yellow\s*\{\s*background:/);
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

test('job cleanup deletes only rows marked as internal AI jobs', async () => {
  const originalFetch = globalThis.fetch;
  const deleted = [];
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (path.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'user-1' }), { status: 200 });
    if (options.method === 'DELETE') {
      deleted.push(path);
      return new Response(null, { status: 204 });
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
      method: 'DELETE',
      headers: { authorization: 'Bearer test-token' },
      query: { id: 'ai-job-cleanup-test-1' },
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(deleted.length, 1);
    assert.match(deleted[0], /id=eq\.ai-job-cleanup-test-1/);
    assert.match(deleted[0], new RegExp(`tags=cs\\.${encodeURIComponent(`{${JOB_TAG}}`)}`));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('English question prompt describes the same shape the server schema requires', async () => {
  const source = await readFile(new URL('../js/ai.js', import.meta.url), 'utf8');
  const prompt = source.slice(
    source.indexOf('export async function answerEnglishLearningQuestion'),
    source.indexOf('export async function generateKnowledgeAnswer'),
  );
  ['shortAnswerJa', 'intuitionJa', 'explanationJa', 'examples', 'relatedTerms', 'cautionsJa', 'suggestedCategory']
    .forEach(key => assert.match(prompt, new RegExp(`"${key}"`)));
  // Knowledge用の分類・概念形式が混ざると、スキーマを外した再試行で不完全な回答になる。
  assert.doesNotMatch(prompt, /"classification"|"primaryConcept"|"directAnswer"/);
  // サーバー側の上限(2600)を超える要求は丸められるだけなので、同じ値を明示する。
  assert.match(prompt, /\n\s+2600,\n\s+'json',\n\s+'english_question'/);
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
