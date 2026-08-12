import test from 'node:test';
import assert from 'node:assert/strict';

const {
  buildAtlasCatalogContext,
  detectAtlasQueryMode,
  extractRequestedAtlasExpressions,
  reuseEquivalentAtlasTopic,
} = await import('../js/ai.js');
const { splitAtlasSpeechText } = await import('../js/modules/expression-atlas.js');

test('splits long English speech at natural boundaries without dropping words', () => {
  const text = 'This is the first sentence. This second sentence is deliberately longer so the player can read it without the browser dropping one oversized utterance halfway through.';
  const chunks = splitAtlasSpeechText(text, 70);
  assert.ok(chunks.length >= 3);
  assert.equal(chunks.join(' ').replace(/\s+/g, ' ').trim(), text);
  assert.ok(chunks.every(chunk => chunk.length <= 70));
});

test('keeps all saved headwords in a light index and limits rich context by relevance', () => {
  const entries = Array.from({ length: 90 }, (_, index) => ({
    id: `entry-${index}`, term: `word${index}`, lemma: `word${index}`,
    category: 'その他', topic: `topic${index}`, coreMeaningJa: `意味${index}`,
  }));
  entries[88] = {
    id: 'bother', term: 'bother', lemma: 'bother', aliases: ['bothers'],
    category: '感情・感覚', topic: '負担・煩わしさ', partOfSpeech: 'verb', coreMeaningJa: '人を煩わせる',
  };

  const context = buildAtlasCatalogContext(entries, {
    learningTarget: 'bother', requestedExpressionTerms: ['bother'], detailedLimit: 12,
  });

  assert.equal(context.headwordIndex.length, 90);
  assert.equal(context.detailedEntries.length, 12);
  assert.equal(context.detailedEntries[0].lemma, 'bother');
  assert.equal(context.detailedEntries[0].isRequestedHeadword, true);
});

test('ranks taxonomy and meaning matches ahead of unrelated saved order', () => {
  const context = buildAtlasCatalogContext([
    { id: 'old', term: 'bright', lemma: 'bright', category: '性質・状態', topic: '明るさ' },
    { id: 'related', term: 'hassle', lemma: 'hassle', category: '感情・感覚', topic: '負担・煩わしさ', coreMeaningJa: '面倒な事柄' },
  ], { learningTarget: '面倒', category: '感情・感覚', topic: '負担・煩わしさ', detailedLimit: 1 });

  assert.equal(context.detailedEntries[0].lemma, 'hassle');
});

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
