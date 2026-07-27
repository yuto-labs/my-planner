import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
  removeItem() {},
};

const { mergeLearningRecordsForSync } = await import('../js/sync.js');

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
