import test from 'node:test';
import assert from 'node:assert/strict';

const {
  detectAtlasQueryMode,
  extractRequestedAtlasExpressions,
  reuseEquivalentAtlasTopic,
} = await import('../js/ai.js');

test('detects a direct English word or phrasal verb as an anchor expression', () => {
  assert.equal(detectAtlasQueryMode('bother'), 'english_seed');
  assert.equal(detectAtlasQueryMode('look forward to'), 'english_seed');
  assert.equal(detectAtlasQueryMode('面倒'), 'japanese_concept');
  assert.equal(detectAtlasQueryMode('bother の違い'), 'japanese_concept');
});

test('keeps phrasal verbs, inflected forms, plurals, and likely typos in English seed mode', () => {
  ['drift off', 'drifted off', 'observations', 'drfit off'].forEach(value => {
    assert.equal(detectAtlasQueryMode(value), 'english_seed');
  });
});

test('extracts a saved English headword from a Japanese enrichment request', () => {
  assert.deepEqual(extractRequestedAtlasExpressions('rangeの別の意味も詳しく'), ['range']);
  assert.deepEqual(extractRequestedAtlasExpressions('drift off の別の使い方'), ['drift off']);
});

test('reuses a theme when its saved representative terms contain the English query', () => {
  const result = reuseEquivalentAtlasTopic(
    [{
      category: '感情・感覚',
      topicRecords: [{ label: '面倒・煩わしさ', aliases: [], terms: ['bother', 'hassle'] }],
    }],
    '感情・感覚',
    '負担・煩わしさ',
    'bother'
  );

  assert.deepEqual(result, { category: '感情・感覚', topic: '面倒・煩わしさ' });
});

test('keeps expressions that cause fear distinct from fear and anxiety', () => {
  const taxonomy = [{
    category: '感情',
    topicRecords: [{ label: '恐怖・不安', aliases: ['恐れ'] }],
  }];

  const result = reuseEquivalentAtlasTopic(
    taxonomy,
    '感情',
    '怖がらせる・恐怖を与える表現',
    '人を怖がらせる英語表現'
  );

  assert.deepEqual(result, { category: '感情・感覚', topic: '怖がらせる・恐怖を与える表現' });
});

test('keeps a new topic when no equivalent taxonomy topic exists', () => {
  const result = reuseEquivalentAtlasTopic(
    [{ category: '感情', topicRecords: [{ label: '喜び', aliases: [] }] }],
    '感情',
    '驚き',
    'surprise expressions'
  );

  assert.deepEqual(result, { category: '感情・感覚', topic: '驚き' });
});
