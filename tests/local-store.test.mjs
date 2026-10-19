// 大きい端末データをIndexedDBへ移す保存窓口が、データを失わずに移行・保存・
// タブ間反映を行い、失敗時は従来のlocalStorageのまま動くことを守るテスト。
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
  flushLocalStore,
  getLocalStoreMode,
  getManagedEntries,
  initLocalStore,
  localStore,
  receiveLocalStoreMessageForTests,
  resetLocalStoreForTests,
} = await import('../js/local-store.js');
const { addEvent, getEvents, clearUserContentLocal, getTrashItems, saveTrashItems } = await import('../js/storage.js');

/** IndexedDBの代わりに、同じ規則(新しい書き込みだけ採用)で動く保存先。 */
function fakeBackend({ failPut = false, corruptRead = false } = {}) {
  const data = new Map();
  return {
    data,
    failPut,
    async getMany(keys) {
      const result = {};
      keys.forEach(key => {
        if (!data.has(key)) return;
        result[key] = corruptRead ? { value: 'broken', stamp: 1 } : { ...data.get(key) };
      });
      return result;
    },
    async putMany(entries, { force = false } = {}) {
      if (this.failPut) throw new Error('disk full');
      entries.forEach(([key, record]) => {
        const existing = data.get(key);
        if (!force && existing && existing.stamp > record.stamp) return;
        if (record.value === null) data.delete(key);
        else data.set(key, { ...record });
      });
    },
  };
}

function reset() {
  resetLocalStoreForTests();
  values.clear();
}

test('without initialization every key keeps using localStorage', () => {
  reset();
  localStore.setItem('mp_events', '[1]');
  assert.equal(values.get('mp_events'), '[1]');
  assert.equal(localStore.getItem('mp_events'), '[1]');
  assert.equal(getLocalStoreMode(), 'localStorage');
});

test('initialization moves large data after verifying it, and leaves small keys alone', async () => {
  reset();
  values.set('mp_knowledge', '[{"id":"memo"}]');
  values.set('mp_settings', '{"theme":"light"}');
  const backend = fakeBackend();

  assert.equal(await initLocalStore({ backendFactory: async () => backend, channelFactory: () => null }), true);
  assert.equal(getLocalStoreMode(), 'indexeddb');
  assert.equal(backend.data.get('mp_knowledge').value, '[{"id":"memo"}]');
  assert.equal(values.has('mp_knowledge'), false);
  assert.equal(values.get('mp_settings'), '{"theme":"light"}');
  assert.equal(localStore.getItem('mp_knowledge'), '[{"id":"memo"}]');
  assert.deepEqual(getManagedEntries(), [['mp_knowledge', '[{"id":"memo"}]']]);
});

test('a failed migration keeps the original localStorage data and mode', async () => {
  reset();
  values.set('mp_events', '[{"id":"event"}]');
  assert.equal(await initLocalStore({ backendFactory: async () => fakeBackend({ failPut: true }), channelFactory: () => null }), false);
  assert.equal(getLocalStoreMode(), 'localStorage');
  assert.equal(values.get('mp_events'), '[{"id":"event"}]');
});

test('a migration that cannot be read back unchanged is abandoned', async () => {
  reset();
  values.set('mp_trash', '[{"id":"t"}]');
  assert.equal(await initLocalStore({ backendFactory: async () => fakeBackend({ corruptRead: true }), channelFactory: () => null }), false);
  assert.equal(values.get('mp_trash'), '[{"id":"t"}]');
  assert.equal(getLocalStoreMode(), 'localStorage');
});

test('unavailable IndexedDB keeps the app on localStorage', async () => {
  reset();
  assert.equal(await initLocalStore({ backendFactory: async () => null, channelFactory: () => null }), false);
  assert.equal(getLocalStoreMode(), 'localStorage');
});

test('writes are visible immediately and reach IndexedDB after flushing', async () => {
  reset();
  const backend = fakeBackend();
  await initLocalStore({ backendFactory: async () => backend, channelFactory: () => null });
  localStore.setItem('mp_events', '[{"id":"a"}]');
  assert.equal(localStore.getItem('mp_events'), '[{"id":"a"}]');
  await flushLocalStore();
  assert.equal(backend.data.get('mp_events').value, '[{"id":"a"}]');
  assert.equal(values.has('mp_events'), false);

  localStore.removeItem('mp_events');
  await flushLocalStore();
  assert.equal(localStore.getItem('mp_events'), null);
  assert.equal(backend.data.has('mp_events'), false);
});

test('a failed write keeps the data in memory and is retried', async () => {
  reset();
  const backend = fakeBackend();
  await initLocalStore({ backendFactory: async () => backend, channelFactory: () => null });
  backend.failPut = true;
  localStore.setItem('mp_task_archive', '[{"id":"done"}]');
  await flushLocalStore();
  assert.equal(localStore.getItem('mp_task_archive'), '[{"id":"done"}]');
  assert.equal(backend.data.has('mp_task_archive'), false);

  backend.failPut = false;
  await new Promise(resolve => setTimeout(resolve, 1700));
  await flushLocalStore();
  assert.equal(backend.data.get('mp_task_archive').value, '[{"id":"done"}]');
});

test('another tab can only replace the cache with a newer write', async () => {
  reset();
  await initLocalStore({ backendFactory: async () => fakeBackend(), channelFactory: () => null });
  localStore.setItem('mp_events', '[{"id":"mine"}]');
  receiveLocalStoreMessageForTests({ key: 'mp_events', value: '[{"id":"old"}]', stamp: 1, tabId: 'other' });
  assert.equal(localStore.getItem('mp_events'), '[{"id":"mine"}]');
  receiveLocalStoreMessageForTests({ key: 'mp_events', value: '[{"id":"newer"}]', stamp: Number.MAX_SAFE_INTEGER, tabId: 'other' });
  assert.equal(localStore.getItem('mp_events'), '[{"id":"newer"}]');
  await flushLocalStore();
});

test('storage.js reads and writes large collections through IndexedDB', async () => {
  reset();
  const backend = fakeBackend();
  await initLocalStore({ backendFactory: async () => backend, channelFactory: () => null });
  const event = addEvent({ title: '面談', start: '2026-10-20T01:00:00.000Z' });
  assert.ok(event);
  assert.equal(getEvents()[0].title, '面談');
  assert.equal(values.has('mp_events'), false);
  assert.ok(saveTrashItems([{ id: 'task:x', entityType: 'task', entityId: 'x', payload: {} }]));
  await flushLocalStore();
  assert.equal(JSON.parse(backend.data.get('mp_events').value)[0].title, '面談');
  assert.equal(getTrashItems().length, 1);

  // アカウント切替時の消去もIndexedDB側へ届く。
  clearUserContentLocal();
  await flushLocalStore();
  assert.deepEqual(getEvents(), []);
  assert.equal(backend.data.has('mp_events'), false);
});
