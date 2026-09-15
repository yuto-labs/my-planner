import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { markdownBlockType, markdownBlockShortcut, completedInlineMarkdown } from '../js/markdown-shortcuts.js';
import { renderBlocksView, renderMemoCardPreview } from '../js/modules/knowledge.js';
import { normalizeMemoBlockIds } from '../js/storage.js';

test('offline app shell includes the memo shortcut module', () => {
  const serviceWorker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.match(serviceWorker, /'\.\/js\/markdown-shortcuts\.js'/);
});

test('markdown block markers map to existing memo block types', () => {
  assert.deepEqual(['#', '##', '###', '-', '*', '+', '1.', '>', '>>', '---']
    .map(markdownBlockType),
  ['h1', 'h2', 'h3', 'bullet', 'bullet', 'bullet', 'numbered', 'quote', 'toggle', 'divider']);
  assert.equal(markdownBlockType('####'), null);
  assert.equal(markdownBlockType('some # text'), null);
  assert.deepEqual(markdownBlockShortcut('- [ ]'), { type: 'checklist', checked: false });
  assert.deepEqual(markdownBlockShortcut('[x]'), { type: 'checklist', checked: true });
  assert.deepEqual(markdownBlockShortcut('```'), { type: 'codeblock', checked: false });
});

test('completed inline markers identify formatting without changing ordinary text', () => {
  assert.deepEqual(completedInlineMarkdown('note **important**'), {
    prefix: 'note ', text: 'important', tag: 'strong',
  });
  assert.deepEqual(completedInlineMarkdown('note *emphasis*'), {
    prefix: 'note ', text: 'emphasis', tag: 'em',
  });
  assert.deepEqual(completedInlineMarkdown('note ~~removed~~'), {
    prefix: 'note ', text: 'removed', tag: 's',
  });
  assert.deepEqual(completedInlineMarkdown('note `code`'), {
    prefix: 'note ', text: 'code', tag: 'code',
  });
  assert.equal(completedInlineMarkdown('ordinary * text'), null);
  assert.equal(completedInlineMarkdown('unfinished **bold'), null);
  assert.equal(completedInlineMarkdown('** **'), null);
  assert.deepEqual(completedInlineMarkdown(' and *again*'), {
    prefix: ' and ', text: 'again', tag: 'em',
  });
});

test('new memo block data renders safely without rewriting existing blocks', () => {
  const blocks = [
    { id: 'old', type: 'paragraph', text: 'Existing note' },
    { id: 'check', type: 'checklist', text: 'Done', checked: true },
    { id: 'code', type: 'codeblock', text: 'if (a < b) {\n  run();\n}' },
  ];
  const html = renderBlocksView(blocks);
  assert.match(html, /kn-view-checklist is-checked/);
  assert.match(html, /data-view-checklist-id="check"/);
  assert.match(html, /<pre class="kn-view-codeblock"/);
  assert.match(html, /if \(a &lt; b\)/);
  assert.match(html, /run\(\);\n\}/);
  assert.match(html, /Existing note/);
  const preview = renderMemoCardPreview(blocks);
  assert.match(preview, /☑/);
  assert.match(preview, /if \(a &lt; b\)/);
  const normalized = normalizeMemoBlockIds(blocks);
  assert.equal(normalized[1].checked, true);
  assert.equal(normalized[2].text, blocks[2].text);
  assert.deepEqual(blocks.map(block => block.id), ['old', 'check', 'code']);
});
