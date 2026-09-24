// AIの揺れた出力を読む規則と、通信エラー表示の互換性を固定する。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractAIErrorMessage,
  getFriendlyAIJobError,
  getFriendlyAiError,
  tryParseAIJSON,
} from '../js/ai-response.js';

test('parses plain, fenced, and surrounded JSON without evaluating arbitrary text', () => {
  assert.deepEqual(tryParseAIJSON('{"ok":true}'), { ok: true });
  assert.deepEqual(tryParseAIJSON('```json\n{"value":2}\n```'), { value: 2 });
  assert.deepEqual(tryParseAIJSON('結果です: {"items":[1,2]} 以上です'), { items: [1, 2] });
  assert.deepEqual(tryParseAIJSON('prefix ["a","b"] suffix'), ['a', 'b']);
  assert.equal(tryParseAIJSON('not json'), null);
  assert.equal(tryParseAIJSON('{broken]'), null);
});

test('background jobs hide Gemini policy enum names', () => {
  const message = getFriendlyAIJobError('Gemini could not complete the response: PROHIBITED_CONTENT');
  assert.match(message, /内容判定/);
  assert.doesNotMatch(message, /PROHIBITED_CONTENT|blocked/i);
  assert.match(getFriendlyAIJobError('protected'), /内容判定/);
});

test('keeps Japanese server detail and maps common HTTP failures', () => {
  assert.equal(getFriendlyAiError(400, '入力内容を確認してください。'), '入力内容を確認してください。');
  assert.equal(getFriendlyAiError(401, 'unauthorized'), 'AIを使うにはログインしてください。');
  assert.equal(getFriendlyAiError(403, 'forbidden'), 'このアカウントではAIを利用できません。');
  assert.equal(getFriendlyAiError(429, 'rate limited'), 'AIの利用が集中しています。少し時間を置いてもう一度お試しください。');
  assert.match(getFriendlyAiError(503, 'model unavailable'), /model unavailable/);
  assert.equal(getFriendlyAiError(500, 'server failed'), 'AIから正常な応答を受け取れませんでした。もう一度お試しください。');
  assert.equal(getFriendlyAiError(418, ''), 'AIエラー (418)');
});

test('extracts nested API failures without leaking object Object', () => {
  assert.equal(extractAIErrorMessage({ error: { message: 'モデルが混雑しています' } }), 'モデルが混雑しています');
  assert.equal(extractAIErrorMessage({ details: { hint: 'しばらく待ってください' } }), 'しばらく待ってください');
  assert.equal(extractAIErrorMessage({}, 'AI生成に失敗しました。'), 'AI生成に失敗しました。');
  assert.equal(getFriendlyAiError(429, { error: { message: 'rate limited' } }), 'AIの利用が集中しています。少し時間を置いてもう一度お試しください。');
  assert.equal(extractAIErrorMessage({ message: '[object Object]' }, 'fallback'), 'fallback');
});
