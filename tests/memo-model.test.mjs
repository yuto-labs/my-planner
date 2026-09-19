// メモ一覧と保存補助のデータ規則を、DOMを使わずに固定する。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectMemoImagePaths,
  memoBlocksToText,
  normalizeMemoTable,
  sortMemosForList,
} from '../js/memo-model.js';

test('sorts starred memos first and then uses the latest edit time', () => {
  const source = [
    { id: 'regular-new', updatedAt: '2026-09-03T00:00:00Z' },
    { id: 'star-old', starred: true, updatedAt: '2026-09-01T00:00:00Z' },
    { id: 'star-new', starred: true, updatedAt: '2026-09-02T00:00:00Z' },
    { id: 'regular-old', createdAt: '2026-09-01T00:00:00Z' },
  ];
  assert.deepEqual(sortMemosForList(source).map(memo => memo.id), [
    'star-new', 'star-old', 'regular-new', 'regular-old',
  ]);
  assert.equal(source[0].id, 'regular-new');
});

test('normalizes legacy tables to at least two string columns', () => {
  assert.deepEqual(normalizeMemoTable({ table: { headers: ['項目'], rows: [[1]] } }), {
    headers: ['項目', '列2'],
    rows: [['1', '']],
  });
  assert.deepEqual(normalizeMemoTable({}), {
    headers: ['列1', '列2'],
    rows: [['', '']],
  });
});

test('collects nested image paths without duplicates', () => {
  const paths = collectMemoImagePaths([
    { type: 'image', path: 'memo/a.webp' },
    { type: 'toggle', children: [
      { type: 'image', path: 'memo/b.webp' },
      { type: 'image', path: 'memo/a.webp' },
    ] },
  ]);
  assert.deepEqual([...paths], ['memo/a.webp', 'memo/b.webp']);
});

test('builds the current search text while skipping dividers and math', () => {
  const text = memoBlocksToText([
    { type: 'h1', text: '見出し', children: [{ type: 'paragraph', text: '子本文' }] },
    { type: 'divider' },
    { type: 'math', text: 'x=1' },
    { type: 'table', table: { headers: ['語', '意味'], rows: [['range', '範囲']] } },
  ]);
  assert.equal(text, '見出し 子本文 語 意味 range 範囲');
  assert.equal(memoBlocksToText([{ type: 'paragraph', text: '123456' }], 4), '1234…');
});
