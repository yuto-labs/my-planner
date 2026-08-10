import test from 'node:test';
import assert from 'node:assert/strict';

const {
  NUANCE_ATLAS_CATEGORIES,
  isValidAtlasTopic,
  normalizeAtlasCategory,
  normalizeAtlasTopic,
  withStableClassification,
  expressionLookupKeys,
} = await import('../js/atlas-model.js');

test('uses the fixed semantic category set', () => {
  assert.deepEqual(NUANCE_ATLAS_CATEGORIES, [
    '感情・感覚', '思考・認識', '意思・判断', '対人・伝達', '行動・変化',
    '状態・性質', '程度・量・評価', '時間・順序・頻度', '空間・位置・移動', '関係・原因・目的',
  ]);
});

test('expansion duplicate keys include lemmas, aliases, and inflected forms', () => {
  const existing = new Set(expressionLookupKeys({
    term: 'drift off',
    lemma: 'drift off',
    aliases: ['drifted off'],
  }));
  assert.equal(expressionLookupKeys({ term: 'drifted off' }).some(key => existing.has(key)), true);
  assert.equal(expressionLookupKeys({ term: 'doze off' }).some(key => existing.has(key)), false);
});

test('maps legacy categories while preserving the old label as a search alias', () => {
  const entry = withStableClassification({
    category: '感情',
    topic: '恐怖・不安',
    categoryAliases: [],
  });
  assert.equal(entry.category, '感情・感覚');
  assert.equal(entry.categoryId, 'cat-感情・感覚');
  assert.deepEqual(entry.categoryAliases, ['感情']);
});

test('keeps mixed legacy action and state records on the more fitting new shelf', () => {
  assert.equal(normalizeAtlasCategory('行動・状態', '強い眠気'), '状態・性質');
  assert.equal(normalizeAtlasCategory('行動・状態', '開始と中断'), '行動・変化');
});

test('removes boilerplate from new topic names and rejects category-like themes', () => {
  assert.equal(normalizeAtlasTopic('怒りを表す表現', '感情・感覚'), '怒り');
  assert.equal(normalizeAtlasTopic('感情・感覚', '感情・感覚'), '');
  assert.equal(isValidAtlasTopic('やわらかい拒否', '対人・伝達'), true);
  assert.equal(isValidAtlasTopic('対人・伝達', '対人・伝達'), false);
});
