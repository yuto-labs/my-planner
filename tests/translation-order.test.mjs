// 既存データを書き換えず、自然な英訳を最初に表示することを守るテスト。
import test from 'node:test';
import assert from 'node:assert/strict';

import { orderedTranslationVariants } from '../js/modules/expression-atlas.js';

test('natural translation is displayed first without rewriting saved variants', () => {
  const saved = [
    { style: 'standard_faithful', translation: 'Faithful' },
    { style: 'natural_conversational', translation: 'Natural' },
    { style: 'expressive_polished', translation: 'Polished' },
  ];
  const ordered = orderedTranslationVariants(saved);

  assert.deepEqual(ordered.map(item => item.translation), ['Natural', 'Faithful', 'Polished']);
  assert.deepEqual(saved.map(item => item.translation), ['Faithful', 'Natural', 'Polished']);
});

test('legacy variants without style keep their saved relative order', () => {
  const ordered = orderedTranslationVariants([
    { translation: 'Legacy A' },
    { style: 'natural_conversational', translation: 'Natural' },
    { translation: 'Legacy B' },
  ]);

  assert.deepEqual(ordered.map(item => item.translation), ['Natural', 'Legacy A', 'Legacy B']);
});
