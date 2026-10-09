// メモ一覧の短いプレビューが改行・トグル構造を壊さないことを守るテスト。
import test from 'node:test';
import assert from 'node:assert/strict';

const {
  renderMemoCard,
  renderMemoCardPreview,
  resolveNewMemoReviewEnabled,
  sameEditorHistoryContent,
} = await import('../js/modules/memo.js');

test('memo list uses two rows with creation date and right-aligned star', () => {
  const html = renderMemoCard({
    id: 'memo-1',
    title: '研究メモ',
    createdAt: '2026-10-09T12:00:00Z',
    updatedAt: '2026-10-10T12:00:00Z',
    starred: true,
    tags: ['資料'],
    blocks: [
      { type: 'paragraph', text: '最初の文章' },
      { type: 'paragraph', text: '次の文章' },
    ],
  });
  assert.match(html, /研究メモ/);
  assert.match(html, /2026\/10\/09/);
  assert.match(html, /kn-star-btn starred/);
  assert.match(html, /最初の文章/);
  assert.doesNotMatch(html, /2026\/10\/10|次の文章|kn-tag-chip|資料/);
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
