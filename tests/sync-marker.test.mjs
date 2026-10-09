// A failed sync marker must not turn an already-persisted memo into a save error.
import test from 'node:test';
import assert from 'node:assert/strict';

const local = new Map();
const session = new Map();
globalThis.localStorage = {
  getItem: key => local.get(key) ?? null,
  setItem(key, value) {
    if (key === 'mp_sync_recent_upserts') throw new DOMException('Storage full', 'QuotaExceededError');
    local.set(key, String(value));
  },
  removeItem: key => local.delete(key),
};
globalThis.sessionStorage = {
  getItem: key => session.get(key) ?? null,
  setItem: (key, value) => session.set(key, String(value)),
  removeItem: key => session.delete(key),
};

const { updateKnowledgeMemo } = await import('../js/storage.js');
const { initSync, resetSyncForUserSwitch } = await import('../js/sync.js');

test('memo save succeeds and protects the edit when only its sync marker is full', async () => {
  local.set('mp_knowledge', JSON.stringify([{
    id: 'memo-1', title: 'Before', blocks: [{ id: 'block-1', type: 'paragraph', text: 'Before' }],
    tags: ['General'], updatedAt: '2026-10-01T00:00:00.000Z',
  }]));
  initSync();

  const saved = updateKnowledgeMemo('memo-1', {
    title: 'After', blocks: [{ id: 'block-1', type: 'paragraph', text: 'After' }],
  });
  assert.equal(saved?.title, 'After');
  assert.equal(JSON.parse(local.get('mp_knowledge'))[0].blocks[0].text, 'After');
  const fallback = JSON.parse(session.get('mp_sync_recent_upserts_fallback'));
  assert.equal(fallback.some(entry => entry.table === 'knowledge_memos' && entry.id === 'memo-1'), true);
  await resetSyncForUserSwitch();
});
