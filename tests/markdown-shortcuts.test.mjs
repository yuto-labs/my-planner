// Markdown風入力とメモブロック表示が、既存形式やオフライン配信でも動くことを守るテスト。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  markdownBlockType,
  markdownBlockShortcut,
  completedInlineMarkdown,
  markdownPrefixForBlock,
  parseMarkdownBlockSource,
  markdownDelimitersForCommand,
} from '../js/markdown-shortcuts.js';
import {
  isDecorativeClipboardTextColor,
  canMergeMemoTextBlocks,
  resolveMemoEnterAction,
  trimPastedMarkdownEdges,
  renderBlocksView,
  renderMemoCardPreview,
} from '../js/modules/knowledge.js';
import { normalizeMemoBlockIds } from '../js/storage.js';

test('offline app shell includes the memo shortcut module', () => {
  const serviceWorker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.match(serviceWorker, /'\.\/js\/markdown-shortcuts\.js'/);
});

test('markdown block markers map to existing memo block types', () => {
  assert.deepEqual(['#', '##', '###', '####', '#####', '######', '-', '*', '+', '1.', '7.', '>', '>>', '---']
    .map(markdownBlockType),
  ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'bullet', 'bullet', 'bullet', 'numbered', 'numbered', 'quote', 'toggle', 'divider']);
  assert.equal(markdownBlockType('#######'), null);
  assert.equal(markdownBlockType('some # text'), null);
  assert.deepEqual(markdownBlockShortcut('- [ ]'), { type: 'checklist', checked: false });
  assert.deepEqual(markdownBlockShortcut('[x]'), { type: 'checklist', checked: true });
  assert.deepEqual(markdownBlockShortcut('```'), { type: 'codeblock', checked: false });
  assert.deepEqual(markdownBlockShortcut('```javascript'), {
    type: 'codeblock', checked: false, language: 'javascript',
  });
});

test('completed inline markers identify formatting without changing ordinary text', () => {
  assert.deepEqual(completedInlineMarkdown('note **important**'), {
    prefix: 'note ', text: 'important', tag: 'strong',
  });
  assert.deepEqual(completedInlineMarkdown('note *emphasis*'), {
    prefix: 'note ', text: 'emphasis', tag: 'em',
  });
  assert.deepEqual(completedInlineMarkdown('heading ***important***'), {
    prefix: 'heading ', text: 'important', tags: ['strong', 'em'],
  });
  assert.deepEqual(completedInlineMarkdown('heading __important__'), {
    prefix: 'heading ', text: 'important', tag: 'strong',
  });
  assert.deepEqual(completedInlineMarkdown('heading _emphasis_'), {
    prefix: 'heading ', text: 'emphasis', tag: 'em',
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
  assert.deepEqual(completedInlineMarkdown('see [OpenAI](https://openai.com)'), {
    prefix: 'see ', text: 'OpenAI', tag: 'a', href: 'https://openai.com',
  });
  assert.deepEqual(completedInlineMarkdown('see <https://openai.com/docs>'), {
    prefix: 'see ', text: 'https://openai.com/docs', tag: 'a', href: 'https://openai.com/docs',
  });
  assert.equal(completedInlineMarkdown('[unsafe](javascript:alert(1))'), null);
});

test('saved block types are represented as visible Markdown while editing', () => {
  assert.equal(markdownPrefixForBlock({ type: 'h2' }), '## ');
  assert.equal(markdownPrefixForBlock({ type: 'checklist', checked: true }), '- [x] ');
  assert.equal(markdownPrefixForBlock({ type: 'numbered' }, 3), '3. ');
  assert.equal(markdownPrefixForBlock({ type: 'toggle' }), '>> ');
});

test('editing Markdown prefixes changes the block type without storing the marker in its text', () => {
  assert.deepEqual(parseMarkdownBlockSource('### 見出し'), { type: 'h3', text: '見出し', checked: false });
  assert.deepEqual(parseMarkdownBlockSource('- [x] 完了'), { type: 'checklist', text: '完了', checked: true });
  assert.deepEqual(parseMarkdownBlockSource('12. 項目'), { type: 'numbered', text: '項目', checked: false });
  assert.deepEqual(parseMarkdownBlockSource('記号を消した本文'), { type: 'paragraph', text: '記号を消した本文', checked: false });
});

test('toolbar formatting inserts source markers instead of hidden rich HTML', () => {
  assert.deepEqual(markdownDelimitersForCommand('bold'), ['**', '**']);
  assert.deepEqual(markdownDelimitersForCommand('underline'), ['<u>', '</u>']);
  assert.equal(markdownDelimitersForCommand('unknown'), null);
});

test('pasted page text colors are distinguished from meaningful emphasis colors', () => {
  assert.equal(isDecorativeClipboardTextColor('rgb(39, 35, 62)'), true);
  assert.equal(isDecorativeClipboardTextColor('#222222'), true);
  assert.equal(isDecorativeClipboardTextColor('white'), true);
  assert.equal(isDecorativeClipboardTextColor('rgb(220, 38, 38)'), false);
  assert.equal(isDecorativeClipboardTextColor('#2563eb'), false);
});

test('desktop Enter splits blocks while Shift+Enter keeps an inline line break', () => {
  assert.equal(resolveMemoEnterAction({ key: 'Enter' }, 'paragraph', true), 'split-block');
  assert.equal(resolveMemoEnterAction({ key: 'Enter', shiftKey: true }, 'paragraph', true), 'line-break');
  assert.equal(resolveMemoEnterAction({ key: 'Enter' }, 'bullet', true), 'continue-list');
  assert.equal(resolveMemoEnterAction({ key: 'Enter' }, 'toggle', true), 'open-toggle');
  assert.equal(resolveMemoEnterAction({ key: 'Enter' }, 'paragraph', false), 'line-break');
  assert.equal(resolveMemoEnterAction({ key: 'Enter', isComposing: true }, 'paragraph', true), null);
  assert.equal(resolveMemoEnterAction({ key: 'Enter', ctrlKey: true }, 'paragraph', true), null);
});

test('paste trimming removes only outer blank lines', () => {
  assert.equal(trimPastedMarkdownEdges('\n\n本文\n二行目\n\n'), '本文\n二行目');
  assert.equal(trimPastedMarkdownEdges('  \r\n\r\n見出し\r\n\r\n本文  '), '見出し\n\n本文  ');
  assert.equal(trimPastedMarkdownEdges('本文\n\n途中の段落'), '本文\n\n途中の段落');
});

test('Backspace merging accepts text blocks but protects structural content', () => {
  assert.equal(canMergeMemoTextBlocks(
    { type: 'paragraph', text: '上' },
    { type: 'paragraph', text: '下' },
  ), true);
  assert.equal(canMergeMemoTextBlocks(
    { type: 'h2', text: '見出し' },
    { type: 'bullet', text: '本文' },
  ), true);
  assert.equal(canMergeMemoTextBlocks(
    { type: 'image' },
    { type: 'paragraph', text: '本文' },
  ), false);
  assert.equal(canMergeMemoTextBlocks(
    { type: 'paragraph', text: '上' },
    { type: 'toggle', text: '下', children: [{ type: 'paragraph', text: '子' }] },
  ), false);
});

test('new memo block data renders safely without rewriting existing blocks', () => {
  const blocks = [
    { id: 'old', type: 'paragraph', text: 'Existing note' },
    { id: 'check', type: 'checklist', text: 'Done', checked: true },
    { id: 'code', type: 'codeblock', text: 'if (a < b) {\n  run();\n}' },
    { id: 'heading', type: 'h4', text: 'Saved heading' },
  ];
  const html = renderBlocksView(blocks);
  assert.match(html, /kn-view-checklist is-checked/);
  assert.match(html, /data-view-checklist-id="check"/);
  assert.match(html, /<pre class="kn-view-codeblock"/);
  assert.match(html, /if \(a &lt; b\)/);
  assert.match(html, /run\(\);\n\}/);
  assert.match(html, /kn-view-h4/);
  assert.match(html, /Saved heading/);
  assert.match(html, /Existing note/);
  const preview = renderMemoCardPreview(blocks);
  assert.match(preview, /☑/);
  assert.match(preview, /if \(a &lt; b\)/);
  const normalized = normalizeMemoBlockIds(blocks);
  assert.equal(normalized[1].checked, true);
  assert.equal(normalized[2].text, blocks[2].text);
  assert.deepEqual(blocks.map(block => block.id), ['old', 'check', 'code', 'heading']);
});
