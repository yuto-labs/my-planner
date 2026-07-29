import test from 'node:test';
import assert from 'node:assert/strict';

const { hasCompleteStructuredResponse, validateRequestBody } = await import('../api/ai/generate.js');

test('rejects unknown AI actions before claiming usage', () => {
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

test('accepts translation vocabulary notes using the documented expression field', () => {
  const makeVariant = (translation, japanese) => ({
    translation,
    backTranslationJa: japanese,
    overallNuanceJa: '文脈に合わせた説明',
    register: 'neutral',
    vocabularyNotes: [{ expression: translation, lemma: translation }],
  });
  const response = { variants: [
    makeVariant('One', '一'),
    makeVariant('Two', '二'),
    makeVariant('Three', '三'),
  ] };
  assert.equal(hasCompleteStructuredResponse('translation_variants', JSON.stringify(response)), true);
});
