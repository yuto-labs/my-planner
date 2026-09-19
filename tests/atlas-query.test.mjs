// AI通信を使わず、表現帳の入力分類と既存テーマ再利用だけを検証する。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canonicalTopicKey,
  detectAtlasQueryMode,
  extractRequestedAtlasExpressions,
  reuseEquivalentAtlasTopic,
  resolveAtlasTopic,
} from '../js/atlas-query.js';

test('classifies direct English expressions without treating inflection or typo as Japanese concepts', () => {
  assert.equal(detectAtlasQueryMode('make a difference'), 'english_seed');
  assert.equal(detectAtlasQueryMode('observations'), 'english_seed');
  assert.equal(detectAtlasQueryMode('drfit off'), 'english_seed');
  assert.equal(detectAtlasQueryMode(''), 'japanese_concept');
  assert.equal(detectAtlasQueryMode('rangeの別の意味'), 'japanese_concept');
});

test('extracts and deduplicates English expressions embedded in Japanese requests', () => {
  assert.deepEqual(
    extractRequestedAtlasExpressions('range と range の別の意味を知りたい'),
    ['range']
  );
});

test('keeps frightening actions separate while merging equivalent fear labels', () => {
  assert.equal(canonicalTopicKey('恐怖と不安'), 'fear-anxiety');
  assert.equal(canonicalTopicKey('人を怖がらせる表現'), 'intimidation-frightening');

  const result = reuseEquivalentAtlasTopic(
    [{
      category: '感情・感覚',
      topicRecords: [{ label: '恐怖・不安', aliases: ['恐れ'], terms: ['fear', 'anxiety'] }],
    }],
    '感情・感覚',
    '恐れと心配',
    'fear'
  );
  assert.deepEqual(result, { category: '感情・感覚', topic: '恐怖・不安' });
});

test('uses a valid fallback rather than saving a category name as a topic', () => {
  assert.equal(resolveAtlasTopic('感情・感覚', '感情・感覚', '負担・煩わしさ'), '負担・煩わしさ');
  assert.equal(resolveAtlasTopic('', '感情・感覚', ''), '関連表現');
});
