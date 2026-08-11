import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
  removeItem() {},
};

const { mergeAtlasRecordsForSync, mergeFreshLocalCollection, mergeLearningRecordsForSync } = await import('../js/sync.js');

function record({ title, answer, titleAt, answerAt, updatedAt }) {
  const data = {
    title,
    originalQuestion: '質問',
    titleSource: 'user',
    titleEditedByUser: true,
    status: 'complete',
    classification: { majorId: 'natural_sciences', middleId: 'physics' },
    primaryConcept: null,
    concepts: [],
    facets: {},
    answer: { directAnswer: [{ text: answer, marks: [], conceptKey: '' }], sections: [], cautions: [] },
    fieldUpdatedAt: { title: titleAt, answer: answerAt, classification: answerAt },
  };
  return {
    id: 'entry-1',
    title,
    summary: answer,
    tags: ['__learning_library__'],
    blocks: [{ id: 'block', type: 'learning-entry-data', data }],
    updatedAt,
  };
}

test('merges independently edited title and answer fields', () => {
  const local = record({
    title: '端末Aの題名',
    answer: '古い回答',
    titleAt: '2026-07-27T10:10:00.000Z',
    answerAt: '2026-07-27T10:00:00.000Z',
    updatedAt: '2026-07-27T10:10:00.000Z',
  });
  const remote = record({
    title: '古い題名',
    answer: '端末Bの新しい回答',
    titleAt: '2026-07-27T10:00:00.000Z',
    answerAt: '2026-07-27T10:20:00.000Z',
    updatedAt: '2026-07-27T10:20:00.000Z',
  });
  const result = mergeLearningRecordsForSync([local], [remote]);
  const data = result.items[0].blocks[0].data;
  assert.equal(data.title, '端末Aの題名');
  assert.equal(data.answer.directAnswer[0].text, '端末Bの新しい回答');
  assert.equal(result.pushCandidates.length, 1);
});

test('does not create a push loop for identical learning records', () => {
  const item = record({
    title: '同じ題名',
    answer: '同じ回答',
    titleAt: '2026-07-27T10:00:00.000Z',
    answerAt: '2026-07-27T10:00:00.000Z',
    updatedAt: '2026-07-27T10:00:00.000Z',
  });
  const result = mergeLearningRecordsForSync([item], [structuredClone(item)]);
  assert.equal(result.pushCandidates.length, 0);
});

test('falls back to the newer record when legacy field timestamps are absent', () => {
  const local = record({
    title: '新しいローカル題名',
    answer: '新しいローカル回答',
    titleAt: '',
    answerAt: '',
    updatedAt: '2026-07-27T10:20:00.000Z',
  });
  const remote = record({
    title: '古いリモート題名',
    answer: '古いリモート回答',
    titleAt: '',
    answerAt: '',
    updatedAt: '2026-07-27T10:00:00.000Z',
  });
  const result = mergeLearningRecordsForSync([local], [remote]);
  const data = result.items[0].blocks[0].data;
  assert.equal(data.title, '新しいローカル題名');
  assert.equal(data.answer.directAnswer[0].text, '新しいローカル回答');
});

test('keeps a local edit made while a remote pull was in flight', () => {
  const previous = [{ id: 'event-1', title: 'before', updatedAt: '2026-07-27T10:00:00.000Z' }];
  const pulled = [{ id: 'event-1', title: 'remote', updatedAt: '2026-07-27T10:05:00.000Z' }];
  const fresh = [
    { id: 'event-1', title: 'edited locally', updatedAt: '2026-07-27T10:10:00.000Z' },
    { id: 'event-2', title: 'created locally', updatedAt: '2026-07-27T10:11:00.000Z' },
  ];

  const merged = mergeFreshLocalCollection('mp_events', previous, fresh, pulled);
  assert.equal(merged.find(item => item.id === 'event-1')?.title, 'edited locally');
  assert.equal(merged.find(item => item.id === 'event-2')?.title, 'created locally');
});

test('keeps an ordinary memo edit made while a remote pull was in flight', () => {
  const previous = [{
    id: 'memo-1',
    title: 'before',
    blocks: [{ id: 'block-1', type: 'text', content: 'before' }],
    updatedAt: '2026-07-27T10:00:00.000Z',
  }];
  const pulled = [{
    id: 'memo-1',
    title: 'remote',
    blocks: [{ id: 'block-1', type: 'text', content: 'remote' }],
    updatedAt: '2026-07-27T10:05:00.000Z',
  }];
  const fresh = [{
    id: 'memo-1',
    title: 'edited locally',
    blocks: [{ id: 'block-1', type: 'text', content: 'edited locally' }],
    updatedAt: '2026-07-27T10:10:00.000Z',
  }];

  const merged = mergeFreshLocalCollection('mp_knowledge', previous, fresh, pulled);
  assert.equal(merged[0]?.title, 'edited locally');
  assert.equal(merged[0]?.blocks?.[0]?.content, 'edited locally');
});

test('does not resurrect an unchanged item deleted remotely during another local edit', () => {
  const previous = [
    { id: 'event-1', title: 'deleted remotely', updatedAt: '2026-07-27T10:00:00.000Z' },
    { id: 'event-2', title: 'before', updatedAt: '2026-07-27T10:00:00.000Z' },
  ];
  const fresh = [
    previous[0],
    { id: 'event-2', title: 'edited locally', updatedAt: '2026-07-27T10:10:00.000Z' },
  ];
  const merged = mergeFreshLocalCollection('mp_events', previous, fresh, []);
  assert.equal(merged.some(item => item.id === 'event-1'), false);
  assert.equal(merged.find(item => item.id === 'event-2')?.title, 'edited locally');
});

test('three-way merges tag edits without clearing remote tags', () => {
  const merged = mergeFreshLocalCollection(
    'mp_tags',
    ['work', 'old'],
    ['work', 'new'],
    ['work', 'old', 'remote']
  );
  assert.deepEqual(merged, ['new', 'remote', 'work']);
});

test('concurrent Atlas sense additions survive synchronization', () => {
  const atlasRecord = (sense, answerAt, updatedAt) => ({
    id: 'range-entry',
    title: 'range',
    summary: sense.coreMeaningJa,
    tags: ['__expression_atlas__'],
    blocks: [{
      id: 'range-block',
      type: 'expression-atlas-data',
      data: {
        term: 'range', lemma: 'range', category: '状態・性質', topic: '分布と範囲',
        senses: [sense],
        sourceQueries: [sense.sourceQueryJa],
        aliases: [],
        fieldUpdatedAt: { answer: answerAt, classification: answerAt, personalNote: answerAt },
      },
    }],
    updatedAt,
  });
  const local = atlasRecord(
    { senseId: 'vary-between', partOfSpeech: 'verb', coreMeaningJa: '一定の範囲にわたる', sourceQueryJa: 'range' },
    '2026-08-11T10:10:00.000Z',
    '2026-08-11T10:10:00.000Z'
  );
  const remote = atlasRecord(
    { senseId: 'extent', partOfSpeech: 'noun', coreMeaningJa: '端から端までの範囲', sourceQueryJa: '範囲' },
    '2026-08-11T10:05:00.000Z',
    '2026-08-11T10:05:00.000Z'
  );

  const result = mergeAtlasRecordsForSync([local], [remote]);
  const data = result.items[0].blocks[0].data;
  assert.deepEqual(data.senses.map(sense => sense.partOfSpeech).sort(), ['noun', 'verb']);
  assert.deepEqual(data.sourceQueries.sort(), ['range', '範囲'].sort());
  assert.equal(result.pushCandidates.length, 1);
});

test('Atlas sync keeps distinct same-POS meanings even when sense ids share a word', () => {
  const record = (sense, updatedAt) => ({
    id: 'range-entry',
    title: 'range',
    summary: sense.coreMeaningJa,
    tags: ['__expression_atlas__'],
    blocks: [{
      id: 'range-block',
      type: 'expression-atlas-data',
      data: {
        term: 'range', lemma: 'range', senses: [sense], aliases: [], sourceQueries: [],
        fieldUpdatedAt: { answer: updatedAt, classification: updatedAt, personalNote: updatedAt },
      },
    }],
    updatedAt,
  });
  const local = record(
    { senseId: 'value-range', partOfSpeech: 'noun', coreMeaningJa: '数値の下限から上限までの幅' },
    '2026-08-11T10:10:00.000Z'
  );
  const remote = record(
    { senseId: 'mountain-range', partOfSpeech: 'noun', coreMeaningJa: '連なって続く山々のまとまり' },
    '2026-08-11T10:05:00.000Z'
  );

  const data = mergeAtlasRecordsForSync([local], [remote]).items[0].blocks[0].data;
  assert.equal(data.senses.length, 2);
  assert.deepEqual(data.senses.map(sense => sense.senseId).sort(), ['mountain-range', 'value-range']);
});
