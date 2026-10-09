// メモ一覧と保存補助のデータ規則を、DOMを使わずに固定する。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectMemoImagePaths,
  memoBlocksToText,
  normalizeMemoTable,
  normalizeMemoTableCell, memoTableCellToMarkdown, parsePastedMemoTable,
  normalizeMemoUrl, splitMemoTextUrls,
  sortMemosForList,
  trimMemoEdgeEmptyBlocks,
} from '../js/memo-model.js';

test('plain memo URLs become safe links without including Japanese punctuation', () => {
  assert.deepEqual(splitMemoTextUrls('資料は https://example.com/a?q=1&b=2 。次は www.example.org/path。'), [
    { text: '資料は ' },
    { text: 'https://example.com/a?q=1&b=2', href: 'https://example.com/a?q=1&b=2' },
    { text: ' 。次は ' },
    { text: 'www.example.org/path', href: 'https://www.example.org/path' },
    { text: '。' },
  ]);
  assert.equal(normalizeMemoUrl('javascript:alert(1)'), null);
  assert.equal(normalizeMemoUrl('ftp://example.com/file'), null);
  assert.deepEqual(splitMemoTextUrls('ただの文章'), [{ text: 'ただの文章' }]);
});

test('table break tags become newlines without executing unrelated HTML or mutating saved data', () => {
  const source = { table: { headers: ['項目<br>補足', '説明'], rows: [['A<BR>B<br/>C<br />D', '<img onerror=alert(1)>']] } };
  const copy = JSON.stringify(source);
  const normalized = normalizeMemoTable(source);
  assert.equal(normalized.headers[0], '項目\n補足');
  assert.equal(normalized.rows[0][0], 'A\nB\nC\nD');
  assert.equal(normalized.rows[0][1], '<img onerror=alert(1)>');
  assert.equal(JSON.stringify(source), copy);
  assert.deepEqual(normalizeMemoTable({ table: JSON.parse(JSON.stringify(normalized)) }), normalized);
});

test('table copy preserves line breaks and literal pipes through Markdown round trip', () => {
  const cell = 'A | B\nC';
  const lines = ['| 項目 | 説明 |', '| --- | --- |', `| ${memoTableCellToMarkdown(cell)} | D |`];
  assert.equal(parsePastedMemoTable(lines).table.rows[0][0], cell);
  assert.equal(normalizeMemoTableCell('A\r\nB'), 'A\nB');
});

test('tab separated pasted report keeps cell breaks and stops before following prose', () => {
  const lines = ['前の段落', '課題\t解決策', '紙伝票<br>印鑑\t入力<BR>確認', '次の段落'];
  assert.deepEqual(parsePastedMemoTable(lines, 1), {
    table: { headers: ['課題', '解決策'], rows: [['紙伝票\n印鑑', '入力\n確認']] }, end: 3,
  });
  assert.equal(parsePastedMemoTable(['a | b', 'ただの文章']), null);
  assert.equal(parsePastedMemoTable(['a\tb']), null);
  assert.equal(parsePastedMemoTable(['a | b', '---']), null);
});

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
