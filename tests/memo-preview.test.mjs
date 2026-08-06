import test from 'node:test';
import assert from 'node:assert/strict';

const { renderMemoCardPreview } = await import('../js/modules/knowledge.js');

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
