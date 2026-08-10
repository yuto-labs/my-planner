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
  const nuanceBody = validateRequestBody({
    actionType: 'nuance_generate',
    maxTokens: 100000,
    responseFormat: 'json',
  });
  assert.equal(nuanceBody.maxTokens, 14000);
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
      keyPoints: ['短い波長ほど強く散乱される', '散乱光が空の広い方向から届く', '夕方は通過距離が長くなる'],
      sections: [{ heading: '説明', paragraphs: [[{ text: '補足', conceptKey: 'rayleigh-scattering' }]] }],
    },
  };
  assert.equal(hasCompleteStructuredResponse('knowledge_answer', JSON.stringify(response)), true);
  const noisyResponse = JSON.parse(JSON.stringify(response));
  noisyResponse.answer.directAnswer[0].text = `**${text}**`;
  noisyResponse.answer.directAnswer[0].conceptKey = 'missing-concept';
  const normalized = normalizeStructuredResponse('knowledge_answer', JSON.stringify(noisyResponse));
  const normalizedResponse = JSON.parse(normalized);
  assert.equal(normalizedResponse.answer.directAnswer[0].text.includes('**'), false);
  assert.equal(normalizedResponse.answer.directAnswer[0].conceptKey, '');
  assert.equal(hasCompleteStructuredResponse('knowledge_answer', normalized), true);
  const balancedResponse = JSON.parse(JSON.stringify(response));
  balancedResponse.answer.directAnswer[0].text = 'あ'.repeat(780);
  balancedResponse.answer.keyPoints = ['い'.repeat(30), 'う'.repeat(30), 'え'.repeat(30)];
  balancedResponse.answer.sections[0].paragraphs[0][0].text = 'お'.repeat(30);
  assert.equal(hasCompleteStructuredResponse('knowledge_answer', JSON.stringify(balancedResponse)), true);
  delete response.answer.keyPoints;
  assert.equal(hasCompleteStructuredResponse('knowledge_answer', JSON.stringify(response)), false);
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

  const examplesWithoutOptionalNotes = structuredClone(response);
  examplesWithoutOptionalNotes.entries.forEach(entry => {
    entry.examples.forEach(example => { example.noteJa = ''; });
  });
  assert.equal(
    hasCompleteStructuredResponse('nuance_generate', JSON.stringify(examplesWithoutOptionalNotes)),
    true
  );

  const examplesWithEquivalentKeys = structuredClone(response);
  examplesWithEquivalentKeys.entries.forEach(entry => {
    entry.examples = entry.examples.map(example => ({
      sentence: example.source,
      translationJa: example.translation,
      usageNoteJa: example.noteJa,
    }));
  });
  const normalizedEquivalentKeys = normalizeStructuredResponse(
    'nuance_generate',
    JSON.stringify(examplesWithEquivalentKeys)
  );
  assert.equal(hasCompleteStructuredResponse('nuance_generate', normalizedEquivalentKeys), true);

  const conciseButCompleteCore = JSON.parse(JSON.stringify(response));
  conciseButCompleteCore.entries.forEach(entry => {
    entry.coreImageJa = '物理的な核の像と、現代の意味へのつながりを説明します。';
    entry.coreMeaningJa = '中心から主要な意味が枝分かれする流れを説明します。';
  });
  assert.equal(
    hasCompleteStructuredResponse('nuance_generate', JSON.stringify(conciseButCompleteCore)),
    true
  );

  const conciseWithoutPadding = JSON.parse(JSON.stringify(response));
  conciseWithoutPadding.entries.forEach(entry => {
    entry.etymologyJa = '語'.repeat(58);
    entry.coreImageJa = '像'.repeat(48);
    entry.coreMeaningJa = '核'.repeat(42);
    entry.nuanceJa = '深'.repeat(133);
  });
  assert.equal(
    hasCompleteStructuredResponse('nuance_generate', JSON.stringify(conciseWithoutPadding)),
    true
  );

  const productionSizedExplanation = JSON.parse(JSON.stringify(response));
  productionSizedExplanation.entries.forEach(entry => {
    entry.etymologyJa = 'e'.repeat(36);
    entry.coreImageJa = 'i'.repeat(24);
    entry.coreMeaningJa = 'm'.repeat(27);
    entry.nuanceJa = 'n'.repeat(99);
    entry.comparisons = entry.comparisons.slice(0, 2);
  });
  assert.equal(
    hasCompleteStructuredResponse('nuance_generate', JSON.stringify(productionSizedExplanation)),
    true
  );

  const compactCoreMeaning = JSON.parse(JSON.stringify(productionSizedExplanation));
  compactCoreMeaning.entries[0].coreMeaningJa = 'm'.repeat(11);
  assert.equal(
    hasCompleteStructuredResponse('nuance_generate', JSON.stringify(compactCoreMeaning)),
    true
  );

  const rangedStars = JSON.parse(JSON.stringify(response));
  rangedStars.entries[0].intensityMin = 1;
  assert.equal(hasCompleteStructuredResponse('nuance_generate', JSON.stringify(rangedStars)), false);
  const normalizedStars = normalizeStructuredResponse('nuance_generate', JSON.stringify(rangedStars));
  assert.equal(hasCompleteStructuredResponse('nuance_generate', normalizedStars), true);

  const onlyThreeExpressions = { ...response, entries: response.entries.slice(0, 3) };
  assert.equal(hasCompleteStructuredResponse('nuance_generate', JSON.stringify(onlyThreeExpressions)), true);
  const onlyTwoExpressions = { ...response, entries: response.entries.slice(0, 2) };
  assert.equal(hasCompleteStructuredResponse('nuance_generate', JSON.stringify(onlyTwoExpressions)), false);

  const sixExpressions = {
    ...response,
    entries: [...response.entries, makeEntry('calm'), makeEntry('solace')],
  };
  assert.equal(hasCompleteStructuredResponse('nuance_generate', JSON.stringify(sixExpressions)), true);
  const sevenExpressions = { ...sixExpressions, entries: [...sixExpressions.entries, makeEntry('peace')] };
  assert.equal(hasCompleteStructuredResponse('nuance_generate', JSON.stringify(sevenExpressions)), false);

  const duplicateExample = JSON.parse(JSON.stringify(response));
  duplicateExample.entries[1].examples[0].source = duplicateExample.entries[0].examples[0].source;
  assert.equal(hasCompleteStructuredResponse('nuance_generate', JSON.stringify(duplicateExample)), true);

  const groupsWithoutLabels = JSON.parse(JSON.stringify(response));
  groupsWithoutLabels.mapMode = 'groups';
  groupsWithoutLabels.entries.forEach(entry => { delete entry.nuanceTypeJa; });
  assert.equal(hasCompleteStructuredResponse('nuance_generate', JSON.stringify(groupsWithoutLabels)), false);
  const normalizedGroups = normalizeStructuredResponse('nuance_generate', JSON.stringify(groupsWithoutLabels));
  assert.equal(hasCompleteStructuredResponse('nuance_generate', normalizedGroups), true);

  const missingAuxiliaryFields = JSON.parse(JSON.stringify(response));
  missingAuxiliaryFields.mapMode = '';
  missingAuxiliaryFields.mapAxisJa = '';
  missingAuxiliaryFields.entries[0].pronunciationIpa = '';
  missingAuxiliaryFields.entries[0].etymologyJa = '語源不詳';
  const normalizedAuxiliary = normalizeStructuredResponse(
    'nuance_generate',
    JSON.stringify(missingAuxiliaryFields)
  );
  assert.equal(hasCompleteStructuredResponse('nuance_generate', normalizedAuxiliary), true);

  const oneIncompleteOfFive = {
    ...response,
    entries: [...response.entries, makeEntry('tranquility')],
  };
  oneIncompleteOfFive.entries[4].nuanceJa = '短すぎる説明';
  const salvaged = normalizeStructuredResponse('nuance_generate', JSON.stringify(oneIncompleteOfFive));
  const salvagedParsed = JSON.parse(salvaged);
  assert.equal(salvagedParsed.entries.length, 4);
  assert.equal(salvagedParsed.discardedEntryCount, 1);
  assert.equal(hasCompleteStructuredResponse('nuance_generate', salvaged), true);
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
      { expression: `${translation} phrase`, lemma: translation, coreImageJa: '語句が持つ核の像を説明します。', nuanceJa: 'この文で生まれる焦点を説明します。' },
      { expression: `${translation} tense`, lemma: translation, coreImageJa: '時制が作る時間の見方を説明します。', nuanceJa: 'この文での時間的な含意を説明します。' },
      { expression: `${translation} clause`, lemma: translation, coreImageJa: '節同士を結ぶ関係を説明します。', nuanceJa: 'この文での情報の流れを説明します。' },
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

test('rejects translation notes that only contain labels', () => {
  const makeVariant = translation => ({
    translation,
    backTranslationJa: '逆翻訳です。',
    overallNuanceJa: '元の内容と実際の語句に触れながら、この訳が生む焦点、距離感、使用域を具体的に説明します。',
    register: 'neutral',
    vocabularyNotes: [1, 2, 3].map(index => ({ expression: `${translation}-${index}`, lemma: translation })),
    comparisons: [1, 2].map(index => ({ expression: translation, alternative: `${translation}-${index}`, differenceJa: '焦点が変わります。' })),
  });
  const response = { variants: ['One', 'Two', 'Three'].map(makeVariant) };
  assert.equal(hasCompleteStructuredResponse('translation_variants', JSON.stringify(response)), false);
});

test('requires every core part of an English learning answer', () => {
  const complete = {
    shortAnswerJa: 'この二つは、話者がどこへ意識を向けるかが異なります。',
    intuitionJa: '一方は点を、もう一方は範囲の内側を捉えるイメージです。',
    explanationJa: '前置詞が示す関係を、場所だけでなく時間や抽象的な状況にも広げて考えると違いが見えます。後続する名詞との関係と、話者が境界をどう捉えるかを確認すると自然に選べます。',
    examples: [
      { english: 'Example one.', japanese: '例文一。', noteJa: '使い方一。' },
      { english: 'Example two.', japanese: '例文二。', noteJa: '使い方二。' },
    ],
  };
  assert.equal(hasCompleteStructuredResponse('english_question', JSON.stringify(complete)), true);
  assert.equal(hasCompleteStructuredResponse('english_question', JSON.stringify({ ...complete, explanationJa: '' })), false);
});

test('rejects an empty memo-format response before it reaches the editor', () => {
  assert.equal(hasCompleteStructuredResponse('memo_format', JSON.stringify({
    title: '整理済みメモ',
    blocks: [{ type: 'paragraph', text: '残すべき本文です。' }],
    tags: [],
  })), true);
  assert.equal(hasCompleteStructuredResponse('memo_format', JSON.stringify({
    title: '整理済みメモ', blocks: [], tags: [],
  })), false);
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
