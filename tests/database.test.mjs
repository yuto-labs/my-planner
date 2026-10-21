// CSVからデータベースを作り、列の種類を正しく推測し、パスワード列を既定で外し、行のページが
// メモ一覧に混ざらず、データベースを消しても行のページ(メモ)は消えないことを守るテスト。
import test from 'node:test';
import assert from 'node:assert/strict';

const values = new Map();
globalThis.localStorage = {
  get length() { return values.size; },
  key(index) { return [...values.keys()][index] ?? null; },
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); },
};

const { convertValue, parseCsv, parseDateValue, planCsvImport, rowMatches } = await import('../js/database-model.js');
const {
  addDatabaseRow, createDatabase, deleteDatabase, findDatabaseForRow, getDatabase, getDatabaseRowIds,
  getDatabases, getKnowledgeMemos, updateDatabaseRow,
} = await import('../js/storage.js');

test.beforeEach(() => values.clear());

const CSV = '﻿名前,URL,ID,password,日付,チェックボックス,テキスト\r\n'
  + '日立,https://example.com/a,28103437,secret1,,Yes,ES落ち\r\n'
  + '"富士, フイルム",,FG8001963,secret2,2026年8月24日 → 2026年9月4日,No,"動画→""合格"""\r\n';

test('Notion CSV exports parse with quotes, commas, and a BOM', () => {
  const table = parseCsv(CSV);
  assert.equal(table.length, 3);
  assert.equal(table[0][0], '名前');
  assert.equal(table[2][0], '富士, フイルム');
  assert.equal(table[2][6], '動画→"合格"');
});

test('column types are inferred and password columns are left out by default', () => {
  const { columns } = planCsvImport(parseCsv(CSV));
  const byName = Object.fromEntries(columns.map(column => [column.name, column]));
  assert.equal(byName['名前'].type, 'title');
  assert.equal(byName.URL.type, 'url');
  assert.equal(byName.ID.type, 'text');
  assert.equal(byName['日付'].type, 'date');
  assert.equal(byName['チェックボックス'].type, 'checkbox');
  assert.equal(byName.password.include, false);
  assert.equal(byName.password.secret, true);
  assert.deepEqual(parseDateValue('2026年8月24日 → 2026年9月4日'), { start: '2026-08-24', end: '2026-09-04' });
  assert.equal(convertValue('checkbox', 'Yes'), true);
});

test('rows become memos hidden from the memo list, and values can be edited and searched', () => {
  const db = createDatabase({
    name: '就活',
    properties: [{ id: 'p-url', name: 'URL', type: 'url' }, { id: 'p-id', name: 'ID', type: 'text' }],
    rows: [{ title: '日立', values: { 'p-url': 'https://example.com/a', 'p-id': '28103437' } }, { title: 'SONY', values: {} }],
  });
  assert.equal(getDatabases().length, 1);
  assert.equal(getKnowledgeMemos().length, 2);
  assert.equal(getDatabaseRowIds().size, 2);
  const hitachi = getKnowledgeMemos().find(memo => memo.title === '日立');
  assert.equal(findDatabaseForRow(hitachi.id).values['p-id'], '28103437');

  updateDatabaseRow(db.id, hitachi.id, { 'p-id': 'NEW-1' });
  assert.equal(getDatabase(db.id).rows[hitachi.id]['p-id'], 'NEW-1');
  const id = addDatabaseRow(db.id, 'NEC');
  assert.equal(getDatabase(db.id).order.at(-1), id);

  const row = { title: '日立', values: getDatabase(db.id).rows[hitachi.id] };
  assert.equal(rowMatches(row, getDatabase(db.id).properties, 'new-1'), true);
  assert.equal(rowMatches(row, getDatabase(db.id).properties, 'ソニー'), false);
});

test('deleting a database keeps its pages as ordinary memos', () => {
  const db = createDatabase({ name: '消す', properties: [], rows: [{ title: '残るページ', values: {} }] });
  assert.ok(deleteDatabase(db.id));
  assert.equal(getDatabases().length, 0);
  assert.equal(getDatabaseRowIds().size, 0);
  assert.deepEqual(getKnowledgeMemos().map(memo => memo.title), ['残るページ']);
});
