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
  saveExpressionEntries,
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

test('repeated Atlas queries reuse an entry despite classification and sense-id drift', () => {
  const [first] = addExpressionEntries([{
    term: 'nudge',
    lemma: 'nudge',
    partOfSpeech: 'verb',
    category: 'Action',
    topic: 'Gentle movement',
    senseId: 'small-push',
    sourceQueryJa: 'nudge',
    sourceQueries: ['nudge'],
    coreMeaningJa: 'A',
  }]);
  const [second] = addExpressionEntries([{
    term: 'nudge',
    lemma: 'nudge',
    partOfSpeech: 'verb',
    category: 'Communication',
    topic: 'Gentle prompting',
    senseId: 'prompt-gently',
    sourceQueryJa: 'nudge',
    sourceQueries: ['nudge'],
    coreMeaningJa: 'B',
  }]);

  assert.equal(second.id, first.id);
  assert.equal(getExpressionEntries().filter(entry => entry.lemma === 'nudge').length, 1);
  assert.equal(getExpressionEntries().find(entry => entry.id === first.id)?.coreMeaningJa, 'B');
});

test('repeated Atlas queries keep different parts of speech as senses of one headword', () => {
  addExpressionEntries([{
    term: 'draft', lemma: 'draft', partOfSpeech: 'noun', category: 'Writing', topic: 'Draft',
    senseId: 'preliminary-text', sourceQueryJa: 'draft', sourceQueries: ['draft'],
  }]);
  addExpressionEntries([{
    term: 'draft', lemma: 'draft', partOfSpeech: 'verb', category: 'Writing', topic: 'Draft',
    senseId: 'write-preliminary', sourceQueryJa: 'draft', sourceQueries: ['draft'],
  }]);

  const matches = getExpressionEntries().filter(entry => entry.lemma === 'draft');
  assert.equal(matches.length, 1);
  assert.deepEqual(matches[0].senses.map(sense => sense.partOfSpeech).sort(), ['noun', 'verb']);
});

test('same headword in one topic merges without requiring identical sense ids or queries', () => {
  const [first] = addExpressionEntries([{
    term: 'range', lemma: 'range', partOfSpeech: 'noun', category: '状態・性質', topic: '分布と範囲',
    senseId: 'extent', sourceQueryJa: '分散', coreMeaningJa: '値が広がる範囲',
  }]);
  const [second] = addExpressionEntries([{
    term: 'range', lemma: 'range', partOfSpeech: 'verb', category: '状態・性質', topic: '分布と範囲',
    senseId: 'vary-between', sourceQueryJa: 'range', coreMeaningJa: '一定の範囲にわたる',
  }]);

  assert.equal(second.id, first.id);
  const [saved] = getExpressionEntries().filter(entry => entry.lemma === 'range');
  assert.equal(saved.senses.length, 2);
  assert.deepEqual(saved.senses.map(sense => sense.partOfSpeech).sort(), ['noun', 'verb']);
});

test('near-identical sense ids enrich one sense while distinct meanings remain separate', () => {
  addExpressionEntries([{
    term: 'range', lemma: 'range', partOfSpeech: 'noun', category: '状態・性質', topic: '分布と範囲',
    senseId: 'extent-span', sourceQueryJa: '範囲', coreMeaningJa: '広がりの端から端までの範囲',
  }]);
  addExpressionEntries([{
    term: 'range', lemma: 'range', partOfSpeech: 'noun', category: '状態・性質', topic: '分布と範囲',
    senseId: 'value-extent', sourceQueryJa: '値の範囲', coreMeaningJa: '値が広がっている範囲',
  }]);
  addExpressionEntries([{
    term: 'range', lemma: 'range', partOfSpeech: 'noun', category: '状態・性質', topic: '分布と範囲',
    senseId: 'line-of-items', sourceQueryJa: '並び', coreMeaningJa: '物が一列に並んだもの',
  }]);

  const [saved] = getExpressionEntries().filter(entry => entry.lemma === 'range');
  assert.equal(saved.senses.length, 2);
  assert.ok(saved.senses.some(sense => sense.senseId === 'value-extent'));
  assert.ok(saved.senses.some(sense => sense.senseId === 'line-of-items'));
});

test('a new save never silently removes pre-existing duplicate record ids', () => {
  saveExpressionEntries([
    { id: 'legacy-a', term: 'range', lemma: 'range', category: '状態・性質', topic: '分布と範囲', senseId: 'extent' },
    { id: 'legacy-b', term: 'range', lemma: 'range', category: '状態・性質', topic: '分布と範囲', senseId: 'row' },
  ]);
  addExpressionEntries([{
    term: 'spread', lemma: 'spread', category: '状態・性質', topic: '分布と範囲', senseId: 'distribution',
  }]);

  const ids = getExpressionEntries().map(entry => entry.id);
  assert.ok(ids.includes('legacy-a'));
  assert.ok(ids.includes('legacy-b'));
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
