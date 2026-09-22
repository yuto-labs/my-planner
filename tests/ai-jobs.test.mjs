import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  BACKGROUND_ACTIONS,
  JOB_BLOCK_TYPE,
  JOB_TAG,
  rowToJob,
} from '../api/ai/jobs.js';
import { createAIJobId } from '../js/ai-jobs.js';

test('only durable long-form AI actions use background jobs', () => {
  assert.deepEqual(
    [...BACKGROUND_ACTIONS].sort(),
    ['knowledge_answer', 'nuance_generate', 'translation_variants'].sort(),
  );
  assert.equal(BACKGROUND_ACTIONS.has('event_parse'), false);
  assert.equal(BACKGROUND_ACTIONS.has('planner_action'), false);
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

test('offline app shell contains both background job modules', async () => {
  const serviceWorker = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  assert.match(serviceWorker, /\.\/js\/ai-jobs\.js/);
  assert.match(serviceWorker, /\.\/js\/ai-job-resume\.js/);
});
