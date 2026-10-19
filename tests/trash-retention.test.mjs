// ごみ箱の保持期限と完全削除が、中身だけを捨てて同期用の削除記録を残すことを守るテスト。
// 記録ごと消すと、削除前から同期していない端末がメモ等をクラウドへ戻してしまう。
import test from 'node:test';
import assert from 'node:assert/strict';

const values = new Map();
globalThis.localStorage = {
  get length() { return values.size; },
  key(index) { return [...values.keys()][index] ?? null; },
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); },
};

const {
  deleteTrashItemsByMonth,
  getRestorableTrashItems,
  getTrashItems,
  isPurgedTrashItem,
  purgeExpiredTrashPayloads,
  purgeTrashItem,
  registerSyncDeleteHook,
  restoreTrashItem,
  TRASH_PAYLOAD_RETENTION_DAYS,
} = await import('../js/storage.js');

const deletes = [];
registerSyncDeleteHook(payload => deletes.push(payload));

const DAY = 86_400_000;
const now = Date.parse('2026-10-19T00:00:00.000Z');

function trashItem(id, entityType, daysAgo, payload) {
  const deletedAt = new Date(now - daysAgo * DAY).toISOString();
  return { id: `${entityType}:${id}`, entityType, entityId: id, title: `title-${id}`, deletedAt, updatedAt: deletedAt, payload: { id, ...payload } };
}

function reset(items) {
  values.clear();
  deletes.length = 0;
  values.set('mp_trash', JSON.stringify(items));
}

test('expired trash keeps a deletion record but drops the stored content', () => {
  reset([
    trashItem('old-memo', 'memo', TRASH_PAYLOAD_RETENTION_DAYS + 1, { title: 'old', blocks: [{ text: 'x'.repeat(500) }] }),
    trashItem('new-task', 'task', 3, { title: 'recent task' }),
  ]);

  assert.equal(purgeExpiredTrashPayloads({ now }), 1);
  const [oldItem, recent] = getTrashItems();
  assert.equal(isPurgedTrashItem(oldItem), true);
  assert.equal(oldItem.entityType, 'memo');
  assert.equal(oldItem.entityId, 'old-memo');
  assert.equal(oldItem.payload.blocks, undefined);
  assert.equal(oldItem.updatedAt, new Date(now).toISOString());
  assert.equal(isPurgedTrashItem(recent), false);
  assert.equal(recent.payload.title, 'recent task');
  // 削除記録はクラウドから消さない。
  assert.deepEqual(deletes, []);
  // 二回目は何も変えず、更新日時も進めない。
  assert.equal(purgeExpiredTrashPayloads({ now: now + DAY }), 0);
});

test('permanent delete in the trash screen keeps the deletion record', () => {
  reset([trashItem('memo-1', 'memo', 1, { title: 'memo' }), trashItem('task-1', 'task', 1, { title: 'task' })]);
  assert.equal(purgeTrashItem('memo:memo-1'), true);
  assert.equal(getTrashItems().length, 2);
  assert.deepEqual(getRestorableTrashItems().map(item => item.id), ['task:task-1']);
  assert.deepEqual(deletes, []);
});

test('a purged record cannot be restored into an empty item', () => {
  reset([trashItem('event-1', 'event', 40, { title: 'event', start: '2026-09-01T00:00:00.000Z' })]);
  purgeExpiredTrashPayloads({ now });
  assert.equal(restoreTrashItem('event:event-1'), null);
  assert.equal(values.get('mp_events'), undefined);
  assert.equal(getTrashItems().length, 1);
});

test('deleting a month of trash keeps deletion records for every item', () => {
  reset([
    { ...trashItem('a', 'memo', 1, {}), deletedAt: '2026-09-10T00:00:00.000Z' },
    { ...trashItem('b', 'task', 1, {}), deletedAt: '2026-09-20T00:00:00.000Z' },
    { ...trashItem('c', 'task', 1, {}), deletedAt: '2026-10-02T00:00:00.000Z' },
  ]);
  assert.equal(deleteTrashItemsByMonth('2026-09'), 2);
  assert.equal(getTrashItems().length, 3);
  assert.deepEqual(getRestorableTrashItems().map(item => item.entityId), ['c']);
  assert.deepEqual(deletes, []);
});

test('restoring a live item still removes its trash record', () => {
  reset([trashItem('task-9', 'task', 2, { title: 'restore me', createdAt: '2026-10-01T00:00:00.000Z' })]);
  const restored = restoreTrashItem('task:task-9');
  assert.equal(restored?.entityId, 'task-9');
  assert.equal(getTrashItems().length, 0);
  assert.deepEqual(deletes, [{ table: 'trash_items', id: 'task:task-9' }]);
});
