// 定期同期が、毎回の全件取得ではなく軽い変化検出で動くことを守るテスト。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
  removeItem() {},
};

const { readRemoteSignature, shouldRunFullPull, FULL_PULL_FALLBACK_MS } = await import('../js/sync.js');

/** Supabaseクエリビルダーの必要な部分だけを再現し、テーブルごとの結果と条件を記録する。 */
function fakeClient(tables) {
  const calls = [];
  return {
    calls,
    from(table) {
      const call = { table, columns: '', filters: [] };
      calls.push(call);
      const builder = {
        select(columns, options) { call.columns = columns; call.count = options?.count; return builder; },
        eq(column, value) { call.filters.push(['eq', column, value]); return builder; },
        not(column, operator, value) { call.filters.push(['not', column, operator, value]); return builder; },
        order() { return builder; },
        limit() { return builder; },
        then(resolve, reject) {
          const result = typeof tables[table] === 'function' ? tables[table](call) : tables[table];
          return Promise.resolve(result || { data: [], count: 0, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

const baseTables = () => ({
  tasks: { data: [{ updated_at: '2026-10-19T00:00:00Z' }], count: 3, error: null },
  events: { data: [{ updated_at: '2026-10-19T01:00:00Z' }], count: 10, error: null },
  goals: { data: [], count: 0, error: null },
  knowledge_memos: { data: [{ updated_at: '2026-10-19T02:00:00Z' }], count: 40, error: null },
  trash_items: { data: [], count: 0, error: null },
  schedule_items: { data: [], count: 0, error: null },
  tags: { data: [{ name: '研究' }, { name: '就活' }], error: null },
  review_schedule: { data: [{ memo_id: 'm1', stage: 1, next_review: '2026-10-20', last_review: '2026-10-19' }], error: null },
});

test('change signature reflects edits, deletions, tags, and review progress', async () => {
  const before = await readRemoteSignature(fakeClient(baseTables()), 'user-1');
  assert.equal(before, await readRemoteSignature(fakeClient(baseTables()), 'user-1'));

  const edited = baseTables();
  edited.events = { data: [{ updated_at: '2026-10-19T03:00:00Z' }], count: 10, error: null };
  assert.notEqual(await readRemoteSignature(fakeClient(edited), 'user-1'), before);

  const deleted = baseTables();
  deleted.knowledge_memos = { data: [{ updated_at: '2026-10-19T02:00:00Z' }], count: 39, error: null };
  assert.notEqual(await readRemoteSignature(fakeClient(deleted), 'user-1'), before);

  const tagged = baseTables();
  tagged.tags = { data: [{ name: '研究' }], error: null };
  assert.notEqual(await readRemoteSignature(fakeClient(tagged), 'user-1'), before);

  const reviewed = baseTables();
  reviewed.review_schedule = { data: [{ memo_id: 'm1', stage: 2, next_review: '2026-10-26', last_review: '2026-10-19' }], error: null };
  assert.notEqual(await readRemoteSignature(fakeClient(reviewed), 'user-1'), before);
});

test('change signature reads only light columns and ignores AI job rows', async () => {
  const client = fakeClient(baseTables());
  await readRemoteSignature(client, 'user-1');
  const memoCall = client.calls.find(call => call.table === 'knowledge_memos');
  assert.equal(memoCall.columns, 'updated_at');
  assert.equal(memoCall.count, 'exact');
  assert.deepEqual(memoCall.filters.find(filter => filter[0] === 'not'), ['not', 'tags', 'cs', '{__ai_generation_job__}']);
  assert.ok(client.calls.every(call => call.filters.some(filter => filter[0] === 'eq' && filter[2] === 'user-1')));
  assert.ok(client.calls.every(call => call.columns !== '*'));
});

test('a failed change check surfaces as an error so the caller can fall back to a full pull', async () => {
  const tables = baseTables();
  tables.events = { data: null, count: null, error: new Error('permission denied') };
  await assert.rejects(() => readRemoteSignature(fakeClient(tables), 'user-1'));
});

test('full pulls run only when unknown, changed, or overdue', () => {
  const now = 1_000_000_000;
  assert.equal(shouldRunFullPull({ known: null, current: 'a', lastFullPullAt: now, now }), true);
  assert.equal(shouldRunFullPull({ known: 'a', current: null, lastFullPullAt: now, now }), true);
  assert.equal(shouldRunFullPull({ known: 'a', current: 'a', lastFullPullAt: now, now: now + 10_000 }), false);
  assert.equal(shouldRunFullPull({ known: 'a', current: 'b', lastFullPullAt: now, now: now + 10_000 }), true);
  assert.equal(shouldRunFullPull({ known: 'a', current: 'a', lastFullPullAt: now, now: now + FULL_PULL_FALLBACK_MS }), true);
});

test('foreground sync uses the light change check instead of a three-second full pull', async () => {
  const source = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  const foreground = source.slice(source.indexOf('function setupForegroundSync()'), source.indexOf('// ---- FAB'));
  assert.match(foreground, /pullIfRemoteChanged\(\)/);
  assert.doesNotMatch(foreground, /pullIfStale\(3000/);
  assert.match(source, /const FOREGROUND_CHANGE_CHECK_MS = 10_000;/);
  assert.match(foreground, /deferSyncWhileEditing\(\{ needsChangeCheck: true \}\)/);
});
