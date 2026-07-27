import test from 'node:test';
import assert from 'node:assert/strict';

const values = new Map();
globalThis.localStorage = {
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); },
};

const {
  addLearningEntry,
  deleteLearningEntry,
  getLearningEntries,
  getKnowledgeMemos,
  getTrashItems,
  importBackup,
  restoreTrashItem,
} = await import('../js/storage.js');

function entry(id, title, updatedAt = '2026-07-27T10:00:00.000Z') {
  return {
    id,
    title,
    originalQuestion: `${title}とは？`,
    classification: {
      majorId: 'natural_sciences',
      middleId: 'physics',
      specialty: '',
      relatedCategoryIds: [],
    },
    concepts: [],
    facets: {},
    answer: {
      directAnswer: [{ text: '回答', marks: [], conceptKey: '' }],
      sections: [],
      cautions: [],
    },
    updatedAt,
  };
}

test.beforeEach(() => values.clear());

test('learning writes preserve ordinary memo records', () => {
  localStorage.setItem('mp_knowledge', JSON.stringify([{
    id: 'memo-1',
    title: '既存メモ',
    summary: '残す',
    tags: [],
    blocks: [{ id: 'text-1', type: 'text', content: '本文' }],
    createdAt: '2026-07-27T09:00:00.000Z',
    updatedAt: '2026-07-27T09:00:00.000Z',
  }]));

  assert.ok(addLearningEntry(entry('learning-1', '空の色')));
  assert.equal(getKnowledgeMemos().length, 1);
  assert.equal(getKnowledgeMemos()[0].title, '既存メモ');
  assert.equal(getLearningEntries().length, 1);
});

test('learning deletion is recoverable from trash', () => {
  addLearningEntry(entry('learning-1', '空の色'));
  assert.equal(deleteLearningEntry('learning-1'), true);
  assert.equal(getLearningEntries().length, 0);
  const trashItem = getTrashItems()[0];
  assert.equal(trashItem.entityType, 'learning');
  assert.ok(restoreTrashItem(trashItem.id));
  assert.equal(getLearningEntries()[0].title, '空の色');
});

test('backup import merges learning entries without deleting local-only data', () => {
  addLearningEntry(entry('local-only', '端末にだけある項目'));
  importBackup(JSON.stringify({
    version: 5,
    learningEntries: [entry('from-backup', 'バックアップの項目')],
  }));
  assert.deepEqual(
    getLearningEntries().map(item => item.id).sort(),
    ['from-backup', 'local-only']
  );
});
