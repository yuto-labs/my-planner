import test from 'node:test';
import assert from 'node:assert/strict';

const values = new Map();
globalThis.localStorage = {
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); },
};

const {
  addExpressionEntries,
  addLearningEntry,
  addTranslationSet,
  deleteLearningEntry,
  getExpressionEntries,
  getLearningEntries,
  getKnowledgeMemos,
  getTranslationSets,
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

test('atlas writes preserve memos, learning entries, and other atlas record types', () => {
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
  assert.equal(addExpressionEntries([{
    term: 'relief',
    lemma: 'relief',
    category: '感情',
    topic: '安心',
    coreMeaningJa: '緊張や苦痛が和らぐこと',
  }]).length, 1);
  assert.ok(addTranslationSet({
    sourceTextJa: 'ほっとした。',
    category: '感情',
    topic: '安心',
    variants: [{ translation: 'I felt relieved.' }],
  }));

  assert.equal(getKnowledgeMemos().length, 1);
  assert.equal(getLearningEntries().length, 1);
  assert.equal(getExpressionEntries().length, 1);
  assert.equal(getTranslationSets().length, 1);
});

test('atlas updates preserve every Japanese and English source query as a search alias', () => {
  const base = {
    term: 'bother',
    lemma: 'bother',
    category: '感情・感覚',
    topic: '面倒・煩わしさ',
    senseId: 'annoy-inconvenience',
    coreMeaningJa: '人の注意や平穏に割り込んで負担を生じさせる。',
  };
  assert.equal(addExpressionEntries([{
    ...base,
    sourceQueryJa: 'bother',
    sourceQueries: ['bother'],
  }]).length, 1);
  assert.equal(addExpressionEntries([{
    ...base,
    sourceQueryJa: '面倒',
    sourceQueries: ['面倒'],
  }]).length, 1);

  const [saved] = getExpressionEntries();
  assert.equal(saved.sourceQueryJa, 'bother');
  assert.deepEqual(saved.sourceQueries.sort(), ['bother', '面倒'].sort());
});

test('atlas preserves legacy collocations and new Japanese meanings together', () => {
  const [saved] = addExpressionEntries([{
    term: 'monitor',
    lemma: 'monitor',
    category: '行動・状態',
    topic: '監視',
    senseId: 'observe-continuously',
    collocations: [
      'monitor closely',
      { expression: 'monitor progress', translationJa: '進捗を継続的に確認する' },
    ],
  }]);

  assert.deepEqual(saved.collocations, [
    'monitor closely',
    { expression: 'monitor progress', translationJa: '進捗を継続的に確認する' },
  ]);
  assert.deepEqual(getExpressionEntries().find(entry => entry.id === saved.id)?.collocations, saved.collocations);
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

test('backup import preserves local trash items omitted from the backup', () => {
  addLearningEntry(entry('learning-trash', '削除対象'));
  deleteLearningEntry('learning-trash');
  const localTrashId = getTrashItems()[0].id;
  importBackup(JSON.stringify({ version: 5, trash: [] }));
  assert.equal(getTrashItems().some(item => item.id === localTrashId), true);
});
