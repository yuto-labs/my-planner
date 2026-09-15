import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { markdownBlockType, completedInlineMarkdown } from '../js/markdown-shortcuts.js';

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
});
