// メモ一覧と保存補助のデータ規則を、DOMを使わずに固定する。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectMemoImagePaths,
  memoBlocksToText,
  normalizeMemoTable,
  sortMemosForList,
  trimMemoEdgeEmptyBlocks,
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

test('trims only empty edge blocks while preserving intentional gaps and structural blocks', () => {
  const source = [
    { id: 'leading', type: 'paragraph', text: '', html: '<br>' },
    { id: 'body', type: 'paragraph', text: '本文' },
    { id: 'gap', type: 'paragraph', text: '' },
    { id: 'body-2', type: 'paragraph', text: '続き' },
    { id: 'trailing', type: 'h2', text: '', html: '<strong></strong>' },
  ];
  assert.deepEqual(trimMemoEdgeEmptyBlocks(source).map(block => block.id), [
    'body', 'gap', 'body-2',
  ]);
  assert.deepEqual(trimMemoEdgeEmptyBlocks([
    { id: 'divider', type: 'divider', text: '' },
    { id: 'empty', type: 'paragraph', text: '' },
  ]).map(block => block.id), ['divider']);
});

test('keeps one editable block for a completely empty memo and trims toggle child edges', () => {
  const [only] = trimMemoEdgeEmptyBlocks([
    { id: 'first', type: 'paragraph', text: '' },
    { id: 'second', type: 'paragraph', text: '' },
  ]);
  assert.equal(only.id, 'first');

  const [toggle] = trimMemoEdgeEmptyBlocks([{
    id: 'toggle', type: 'toggle', text: '詳細', children: [
      { id: 'child-empty', type: 'paragraph', text: '' },
      { id: 'child-body', type: 'paragraph', text: '中身' },
      { id: 'child-tail', type: 'paragraph', text: '' },
    ],
  }]);
  assert.deepEqual(toggle.children.map(block => block.id), ['child-body']);
});
