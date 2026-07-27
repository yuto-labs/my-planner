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
