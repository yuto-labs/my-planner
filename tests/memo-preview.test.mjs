// メモ一覧の短いプレビューが改行・トグル構造を壊さないことを守るテスト。
import test from 'node:test';
import assert from 'node:assert/strict';

const {
  renderMemoCard,
  renderMemoCardPreview,
  resolveNewMemoReviewEnabled,
  sameEditorHistoryContent,
  setCrossBlockSelectionMode,
} = await import('../js/modules/memo.js');

test('range selection leaves text unselected until drag and restores editing', () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const attributes = new Map();
  const editable = { setAttribute: (key, value) => attributes.set(key, value) };
  const classes = new Map();
  const page = { classList: { toggle: (key, enabled) => classes.set(key, enabled) } };
  const button = {
    classList: { toggle: (key, enabled) => classes.set(key, enabled) },
    setAttribute: (key, value) => attributes.set(key, value),
  };
  const wrap = {
    querySelectorAll: () => [editable],
    contains: () => false,
  };
  const container = {
    querySelector: selector => ({
      '.kn-edit-page': page,
      '#kn-blocks-wrap': wrap,
      '#kn-range-select-btn': button,
    })[selector] || null,
    querySelectorAll: () => [],
  };
  let cleared = 0;
  globalThis.window = { getSelection: () => ({ removeAllRanges: () => { cleared += 1; } }) };
  globalThis.document = { activeElement: null };
  try {
    setCrossBlockSelectionMode(container, true);
    assert.equal(attributes.get('contenteditable'), 'false');
    assert.equal(attributes.get('aria-pressed'), 'true');
    assert.equal(classes.get('kn-range-select-mode'), true);
    assert.equal(cleared, 1);

    setCrossBlockSelectionMode(container, false);
    assert.equal(attributes.get('contenteditable'), 'true');
    assert.equal(attributes.get('aria-pressed'), 'false');
    assert.equal(classes.get('kn-range-select-mode'), false);
    assert.equal(cleared, 2);
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
});

test('memo list uses two rows with creation date and right-aligned star', () => {
  const html = renderMemoCard({
    id: 'memo-1',
    title: '研究メモ',
    createdAt: '2026-10-09T12:00:00Z',
    updatedAt: '2026-10-10T12:00:00Z',
    starred: true,
    tags: ['資料', '研究', 'あとで'],
    blocks: [
      { type: 'paragraph', text: '最初の文章' },
      { type: 'paragraph', text: '次の文章' },
    ],
  });
  assert.match(html, /研究メモ/);
  assert.match(html, /2026\/10\/09/);
  assert.match(html, /kn-memo-card-tags/);
  assert.match(html, /資料/);
  assert.match(html, /研究/);
  assert.match(html, /\+1/);
  assert.ok(html.indexOf('kn-memo-card-tags') < html.indexOf('kn-memo-date'));
  assert.match(html, /kn-star-btn starred/);
  assert.match(html, /最初の文章/);
  assert.doesNotMatch(html, /2026\/10\/10|次の文章/);
  assert.ok(html.indexOf('kn-memo-title') < html.indexOf('kn-memo-date'));
  assert.ok(html.indexOf('kn-memo-date') < html.indexOf('kn-star-btn'));
  assert.ok(html.indexOf('kn-star-btn') < html.indexOf('kn-memo-card-sub'));
});

test('memo history ignores caret-only movement but detects block changes', () => {
  const base = {
    title: '題名',
    blocks: [{ id: 'a', type: 'paragraph', text: '本文' }],
    tags: ['資料'],
    url: '',
    starred: false,
    reviewEnabled: false,
    activeBlockId: 'a',
    selection: { kind: 'contenteditable', blockId: 'a', start: 0, end: 0 },
  };
  assert.equal(sameEditorHistoryContent(base, {
    ...base,
    selection: { kind: 'contenteditable', blockId: 'a', start: 2, end: 2 },
  }), true);
  assert.equal(sameEditorHistoryContent(base, {
    ...base,
    blocks: [...base.blocks, { id: 'b', type: 'paragraph', text: '' }],
  }), false);
});

test('new memos default to review disabled unless explicitly enabled', () => {
  assert.equal(resolveNewMemoReviewEnabled(), false);
  assert.equal(resolveNewMemoReviewEnabled({}), false);
  assert.equal(resolveNewMemoReviewEnabled({ reviewEnabled: false }), false);
  assert.equal(resolveNewMemoReviewEnabled({ reviewEnabled: true }), true);
});

test('memo preview preserves block structure and line breaks', () => {
  const html = renderMemoCardPreview([
    { type: 'h2', text: '研究メモ' },
    { type: 'paragraph', text: '一行目\n二行目' },
    { type: 'bullet', text: '重要な点' },
  ]);

  assert.match(html, /kn-memo-preview-line--h2/);
  assert.match(html, /一行目\n二行目/);
  assert.match(html, /kn-memo-preview-line--bullet/);
  assert.match(html, />•</);
});

test('memo preview keeps saved rich line-break structure', () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement() {
      return {
        content: { childNodes: [] },
        set innerHTML(value) { this._html = value; },
        get innerHTML() { return this._html; },
      };
    },
  };

  try {
    const html = renderMemoCardPreview([{
      type: 'paragraph',
      text: '一行目二行目',
      html: '一行目<div>二行目</div>',
    }]);
    assert.match(html, /一行目<div>二行目<\/div>/);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('memo preview keeps toggle title beside its marker and shows open children', () => {
  const html = renderMemoCardPreview([{
    type: 'toggle',
    text: '詳しい内容',
    collapsed: false,
    children: [{ type: 'paragraph', text: '補足説明' }],
  }]);

  assert.match(html, /kn-memo-preview-line--toggle/);
  assert.match(html, />▼</);
  assert.match(html, /詳しい内容/);
  assert.match(html, /--preview-depth:1/);
  assert.match(html, /補足説明/);
});
