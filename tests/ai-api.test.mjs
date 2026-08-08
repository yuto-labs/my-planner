import test from 'node:test';
import assert from 'node:assert/strict';

const {
  hasCompleteStructuredResponse,
  normalizeStructuredResponse,
  pickFallbackModel,
  pickModel,
  validateRequestBody,
  maxDuration,
} = await import('../api/ai/generate.js');

test('allows long-form AI generation to use the Vercel Fluid Compute window', () => {
  assert.equal(maxDuration, 300);
});

test('routes fast and quality work to separate default model pools', () => {
  const previousFast = process.env.GEMINI_MODEL_FAST;
  const previousQuality = process.env.GEMINI_MODEL_QUALITY;
  const previousFallback = process.env.GEMINI_FALLBACK_MODEL;
  delete process.env.GEMINI_MODEL_FAST;
  delete process.env.GEMINI_MODEL_QUALITY;
  delete process.env.GEMINI_FALLBACK_MODEL;
  try {
    assert.equal(pickModel('fast'), 'gemini-3.5-flash-lite');
    assert.equal(pickModel('quality'), 'gemini-3.5-flash');
    assert.equal(pickFallbackModel('quality'), 'gemini-3.5-flash-lite');
    assert.equal(pickFallbackModel('fast'), 'gemini-2.5-flash');
  } finally {
    if (previousFast === undefined) delete process.env.GEMINI_MODEL_FAST;
    else process.env.GEMINI_MODEL_FAST = previousFast;
    if (previousQuality === undefined) delete process.env.GEMINI_MODEL_QUALITY;
    else process.env.GEMINI_MODEL_QUALITY = previousQuality;
    if (previousFallback === undefined) delete process.env.GEMINI_FALLBACK_MODEL;
    else process.env.GEMINI_FALLBACK_MODEL = previousFallback;
  }
});

test('rejects unknown AI actions before calling Gemini', () => {
  assert.throws(
    () => validateRequestBody({ actionType: 'arbitrary_remote_command' }),
    /Unsupported AI action/
  );
});

test('caps AI output tokens per action', () => {
  const body = validateRequestBody({
    actionType: 'event_parse',
    maxTokens: 100000,
    responseFormat: 'json',
  });
  assert.equal(body.maxTokens, 400);
});

test('rejects malformed structured output', () => {
  assert.equal(hasCompleteStructuredResponse('event_parse', '{"title":'), false);
  assert.equal(hasCompleteStructuredResponse('event_parse', '{"title":"Meeting"}'), false);
  assert.equal(hasCompleteStructuredResponse(
    'event_parse',
    '{"title":"Meeting","start":"2026-07-27T10:00:00","end":null}'
  ), true);
});

test('forces structured actions to JSON mode', () => {
  const body = validateRequestBody({
    actionType: 'knowledge_answer',
    responseFormat: 'text',
  });
  assert.equal(body.responseFormat, 'json');
});

test('accepts a knowledge primary concept that is not duplicated in concepts', () => {
  const text = 'あ'.repeat(900);
  const response = {
    title: '検証用',
    classification: { majorId: 'science', middleId: 'physics' },
    primaryConcept: { key: 'rayleigh-scattering', label: 'レイリー散乱' },
    concepts: [],
    answer: {
      directAnswer: [{ text, conceptKey: 'rayleigh-scattering' }],
      sections: [{ heading: '説明', paragraphs: [[{ text: '補足', conceptKey: 'rayleigh-scattering' }]] }],
    },
  };
  assert.equal(hasCompleteStructuredResponse('knowledge_answer', JSON.stringify(response)), true);
});

test('accepts nuance output using the schema field names', () => {
  const makeEntry = term => ({
    term,
    lemma: term,
    pronunciationIpa: '/test/',
    intensityLevel: 2,
    intensityMin: 2,
    intensityMax: 2,
    etymologyJa: `語源の説明。${'歴史的な成り立ちを確認して説明します。'.repeat(4)}`,
    coreImageJa: `根源的なイメージ。${'物理的な感覚と現代の意味の接続を説明します。'.repeat(5)}`,
    coreMeaningJa: `中心的な意味。${'主要な意味がどのように枝分かれするかを説明します。'.repeat(5)}`,
    nuanceJa: `具体的なニュアンス。${'話者の視点、主体性、強さ、含意、使用域と自然な境界を具体的に説明します。'.repeat(7)}`,
    useCasesJa: ['自然な使用場面', '別の関係性での使用場面'],
    examples: [
      { source: `${term} example one.`, translation: '例文一', noteJa: '場面一' },
      { source: `${term} example two.`, translation: '例文二', noteJa: '場面二' },
      { source: `${term} example three.`, translation: '例文三', noteJa: '場面三' },
    ],
    comparisons: [
      { term: `${term}-a`, differenceJa: '視点の違いを説明します。' },
      { term: `${term}-b`, differenceJa: '強さの違いを説明します。' },
      { term: `${term}-c`, differenceJa: '使用域の違いを説明します。' },
    ],
  });
  const response = {
    category: '感情',
    topic: '安心',
    mapMode: 'scale',
    mapAxisJa: '安心感の強さ',
    mapLowLabelJa: 'ほっとする',
    mapHighLabelJa: '深く安心する',
    entries: [makeEntry('relief'), makeEntry('reassurance'), makeEntry('comfort'), makeEntry('ease')],
  };
  assert.equal(hasCompleteStructuredResponse('nuance_generate', JSON.stringify(response)), true);

  const rangedStars = JSON.parse(JSON.stringify(response));
  rangedStars.entries[0].intensityMin = 1;
  assert.equal(hasCompleteStructuredResponse('nuance_generate', JSON.stringify(rangedStars)), false);
  const normalizedStars = normalizeStructuredResponse('nuance_generate', JSON.stringify(rangedStars));
  assert.equal(hasCompleteStructuredResponse('nuance_generate', normalizedStars), true);

  const onlyThreeExpressions = { ...response, entries: response.entries.slice(0, 3) };
  assert.equal(hasCompleteStructuredResponse('nuance_generate', JSON.stringify(onlyThreeExpressions)), false);

  const duplicateExample = JSON.parse(JSON.stringify(response));
  duplicateExample.entries[1].examples[0].source = duplicateExample.entries[0].examples[0].source;
  assert.equal(hasCompleteStructuredResponse('nuance_generate', JSON.stringify(duplicateExample)), false);
});

test('keeps legacy nuance field names readable during validation', () => {
  const makeEntry = term => ({
    term,
    lemma: term,
    ipa: '/test/',
    intensityLevel: 2,
    intensityMin: 2,
    intensityMax: 2,
    etymologyJa: `語源の説明。${'歴史的な成り立ちを確認して説明します。'.repeat(4)}`,
    coreImageJa: `根源的なイメージ。${'物理的な感覚と現代の意味の接続を説明します。'.repeat(5)}`,
    coreMeaningJa: `中心的な意味。${'主要な意味がどのように枝分かれするかを説明します。'.repeat(5)}`,
    nuanceJa: `具体的なニュアンス。${'話者の視点、主体性、強さ、含意、使用域と自然な境界を具体的に説明します。'.repeat(7)}`,
    useCasesJa: ['自然な使用場面', '別の関係性での使用場面'],
    examples: [
      { english: `${term} example one.`, japanese: '例文一', noteJa: '場面一' },
      { english: `${term} example two.`, japanese: '例文二', noteJa: '場面二' },
      { english: `${term} example three.`, japanese: '例文三', noteJa: '場面三' },
    ],
    comparisons: [
      { term: `${term}-a`, differenceJa: '視点の違いを説明します。' },
      { term: `${term}-b`, differenceJa: '強さの違いを説明します。' },
      { term: `${term}-c`, differenceJa: '使用域の違いを説明します。' },
    ],
  });
  const response = {
    category: '感情',
    topic: '安心',
    mapMode: 'scale',
    mapAxisJa: '安心感の強さ',
    mapLowLabelJa: 'ほっとする',
    mapHighLabelJa: '深く安心する',
    entries: [makeEntry('relief'), makeEntry('reassurance'), makeEntry('comfort'), makeEntry('ease')],
  };
  assert.equal(hasCompleteStructuredResponse('nuance_generate', JSON.stringify(response)), true);
});

test('rejects a nuance set whose explanation fields are only placeholders', () => {
  const makeEntry = term => ({
    term,
    lemma: term,
    pronunciationIpa: '/test/',
    coreMeaningJa: '中心的な意味',
    nuanceJa: '具体的なニュアンス',
    useCasesJa: ['自然な使用場面'],
    examples: [
      { source: `${term} example one.`, translation: '例文一' },
      { source: `${term} example two.`, translation: '例文二' },
    ],
  });
  const response = {
    category: '感情',
    topic: '安心',
    entries: [makeEntry('relief'), makeEntry('reassurance'), makeEntry('comfort')],
  };
  assert.equal(hasCompleteStructuredResponse('nuance_generate', JSON.stringify(response)), false);
});

test('accepts a grouped nuance map without forcing a strength ranking', () => {
  const makeEntry = (term, group) => ({
    term,
    lemma: term,
    pronunciationIpa: '/test/',
    nuanceTypeJa: group,
    intensityLevel: 3,
    intensityMin: 3,
    intensityMax: 3,
    etymologyJa: '語源から現代の形に至る経路と、その変化の理由を具体的に説明します。'.repeat(4),
    coreImageJa: '物理的な動きと話者の視点を結びつけ、意味の核となる像を具体的に説明します。'.repeat(4),
    coreMeaningJa: '中心的な意味から各用法がどう枝分かれするかを、境界も含めて説明します。'.repeat(4),
    nuanceJa: '場面、心理、主体性、含意、距離感、使用域の違いを比較し、自然に選べる境界と判断基準を説明します。'.repeat(6),
    useCasesJa: ['自然な使用場面', '別の関係性での使用場面'],
    examples: [
      { source: `${term} example one.`, translation: '例文一', noteJa: '場面一' },
      { source: `${term} example two.`, translation: '例文二', noteJa: '場面二' },
      { source: `${term} example three.`, translation: '例文三', noteJa: '場面三' },
    ],
    comparisons: [
      { term: `${term}-a`, differenceJa: '視点の違いを説明します。' },
      { term: `${term}-b`, differenceJa: '強さの違いを説明します。' },
      { term: `${term}-c`, differenceJa: '使用域の違いを説明します。' },
    ],
  });
  const response = {
    category: '伝達',
    topic: '見る',
    mapMode: 'groups',
    mapAxisJa: '見る方法',
    mapLowLabelJa: '',
    mapHighLabelJa: '',
    entries: [
      makeEntry('look', '意図して視線を向ける'),
      makeEntry('see', '自然に視界へ入る'),
      makeEntry('watch', '動きを継続して見る'),
      makeEntry('observe', '注意深く変化を捉える'),
    ],
  };
  assert.equal(hasCompleteStructuredResponse('nuance_generate', JSON.stringify(response)), true);
});

test('rejects a nuance map with no meaningful comparison axis', () => {
  const response = {
    category: '感情',
    topic: '安心',
    mapMode: 'scale',
    mapAxisJa: '',
    mapLowLabelJa: '弱い',
    mapHighLabelJa: '強い',
    entries: [],
  };
  assert.equal(hasCompleteStructuredResponse('nuance_generate', JSON.stringify(response)), false);
});

test('rejects shallow translation variants before they can be saved', () => {
  const response = {
    variants: [
      { translation: 'One', backTranslationJa: '一', overallNuanceJa: '説明', register: 'neutral', vocabularyNotes: [] },
      { translation: 'Two', backTranslationJa: '二', overallNuanceJa: '説明', register: 'neutral', vocabularyNotes: [] },
      { translation: 'Three', backTranslationJa: '三', overallNuanceJa: '説明', register: 'neutral', vocabularyNotes: [] },
    ],
  };
  assert.equal(hasCompleteStructuredResponse('translation_variants', JSON.stringify(response)), false);
});

test('accepts detailed translation variants with expanded notes and comparisons', () => {
  const makeVariant = (translation, japanese) => ({
    translation,
    backTranslationJa: japanese,
    overallNuanceJa: '元の出来事と話者の視点に触れながら、実際に選んだ語句と構文が強調や距離感をどう変えるかを説明します。',
    register: 'neutral',
    vocabularyNotes: [
      { expression: `${translation} phrase`, lemma: translation },
      { expression: `${translation} tense`, lemma: translation },
      { expression: `${translation} clause`, lemma: translation },
    ],
    comparisons: [
      { expression: translation, alternative: `${translation} alternative`, differenceJa: 'この文での焦点が変わります。' },
      { expression: `${translation} phrase`, alternative: `${translation} phrase two`, differenceJa: 'この文での距離感が変わります。' },
    ],
  });
  const response = { variants: [
    makeVariant('One', '一'),
    makeVariant('Two', '二'),
    makeVariant('Three', '三'),
  ] };
  assert.equal(hasCompleteStructuredResponse('translation_variants', JSON.stringify(response)), true);
});

test('rejects translation variants with too few notes or comparisons', () => {
  const makeVariant = (translation, japanese) => ({
    translation,
    backTranslationJa: japanese,
    overallNuanceJa: '内容に即した説明です。',
    register: 'neutral',
    vocabularyNotes: [{ expression: translation, lemma: translation }],
    comparisons: [],
  });
  const response = { variants: [
    makeVariant('One', '一'),
    makeVariant('Two', '二'),
    makeVariant('Three', '三'),
  ] };
  assert.equal(hasCompleteStructuredResponse('translation_variants', JSON.stringify(response)), false);
});
