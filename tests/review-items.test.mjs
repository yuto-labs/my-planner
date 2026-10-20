// 表現帳の単語とKnowledgeの回答も、「復習に追加」すれば通常メモと同じ復習カードになることを守るテスト。
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
  addExpressionEntries, addKnowledgeMemo, addLearningEntry, createReviewItemResolver,
  getExpressionEntries, getLearningEntries, getReviewsForDate, isReviewScheduled, setMemoReviewEnabled,
} = await import('../js/storage.js');

test.beforeEach(() => values.clear());

/** 最小限のKnowledge回答。 */
function learningEntry() {
  return {
    id: 'learning-1',
    title: '夕焼けが赤い理由',
    originalQuestion: '夕焼けはなぜ赤い？',
    classification: { majorId: 'natural_sciences', middleId: 'physics', specialty: '', relatedCategoryIds: [] },
    concepts: [],
    facets: {},
    answer: { directAnswer: [{ text: '青い光が散乱して届きにくくなるため。', marks: [], conceptKey: '' }], sections: [], cautions: [] },
    updatedAt: '2026-10-20T00:00:00.000Z',
  };
}

test('memos, Atlas words, and Knowledge answers resolve to review cards of their own kind', () => {
  const memo = addKnowledgeMemo({ title: '通常メモ', blocks: [] });
  addExpressionEntries([{ term: 'relief', lemma: 'relief', category: '感情', topic: '安心', coreMeaningJa: '緊張が和らぐこと' }]);
  assert.ok(addLearningEntry(learningEntry()));
  const wordId = getExpressionEntries()[0].id;
  const learningId = getLearningEntries()[0].id;

  const resolve = createReviewItemResolver();
  assert.equal(resolve(memo.id).kind, 'memo');
  assert.deepEqual([resolve(wordId).kind, resolve(wordId).title], ['atlas', 'relief']);
  assert.deepEqual([resolve(learningId).kind, resolve(learningId).title], ['learning', '夕焼けが赤い理由']);
  assert.equal(resolve('missing'), null);
});

test('Atlas and Knowledge items enter review only after being added, and can be removed again', () => {
  addExpressionEntries([{ term: 'relief', lemma: 'relief', category: '感情', topic: '安心', coreMeaningJa: '緊張が和らぐこと' }]);
  const wordId = getExpressionEntries()[0].id;
  assert.equal(isReviewScheduled(wordId), false);

  setMemoReviewEnabled(wordId, true);
  assert.equal(isReviewScheduled(wordId), true);
  // 追加した翌日の復習一覧に入る。
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  assert.deepEqual(getReviewsForDate(dateStr).map(entry => entry.memoId), [wordId]);

  setMemoReviewEnabled(wordId, false);
  assert.equal(isReviewScheduled(wordId), false);
  assert.deepEqual(getReviewsForDate(dateStr), []);
});
