// 設定画面の保存容量表示が、データを変えずに種類別の使用量を集計することを守るテスト。
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

const { classifyKnowledgeRecord } = await import('../js/storage.js');
const {
  formatCharCount,
  measureKnowledgeRecords,
  measureLocalStorage,
} = await import('../js/storage-usage.js');

test('local storage usage is grouped by meaning and never modified', () => {
  values.clear();
  values.set('mp_knowledge', 'x'.repeat(1000));
  values.set('mp_trash', 'x'.repeat(300));
  values.set('mp_sync_backups:tasks:user', 'x'.repeat(200));
  values.set('mp_settings', '{}');
  const snapshot = JSON.stringify([...values]);

  const usage = measureLocalStorage(globalThis.localStorage);
  assert.equal(JSON.stringify([...values]), snapshot);
  assert.equal(usage.groups[0].id, 'knowledge');
  assert.equal(usage.groups[0].chars, 'mp_knowledge'.length + 1000);
  assert.equal(usage.groups.find(group => group.id === 'sync').keys, 1);
  assert.equal(usage.groups.find(group => group.id === 'other').chars, 'mp_settings'.length + 2);
  assert.equal(usage.totalChars, usage.groups.reduce((sum, group) => sum + group.chars, 0));
});

test('shared knowledge records are split into memos, Atlas, Knowledge, and jobs', () => {
  const records = [
    { id: 'm', title: 'memo', tags: [], blocks: [{ type: 'paragraph', text: 'a' }] },
    { id: 'a', tags: ['__expression_atlas__'], blocks: [{ type: 'nuance-data', data: {} }] },
    { id: 't', tags: ['__expression_atlas__'], blocks: [{ type: 'translation-set-data', data: {} }] },
    { id: 'l', tags: ['__learning_library__'], blocks: [{ type: 'learning-entry-data', data: {} }] },
    { id: 'j', tags: ['__ai_generation_job__'], blocks: [{ type: 'ai-generation-job', data: {} }] },
  ];
  const kinds = Object.fromEntries(measureKnowledgeRecords(records, classifyKnowledgeRecord).map(item => [item.kind, item.count]));
  assert.deepEqual(kinds, { memo: 1, atlas: 1, translation: 1, learning: 1, job: 1 });
});

test('character counts are shown compactly', () => {
  assert.equal(formatCharCount(950), '950文字');
  assert.equal(formatCharCount(45_000), '45K文字');
  assert.equal(formatCharCount(1_234_567), '1.23M文字');
});
