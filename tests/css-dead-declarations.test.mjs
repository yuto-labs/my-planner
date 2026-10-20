// CSSの「後ろの同じセレクタに上書きされて効かない宣言」だけを消し、効く宣言・予備の値は残すことを守るテスト。
import test from 'node:test';
import assert from 'node:assert/strict';

import { removeDeadDeclarations } from '../scripts/css-dead-declarations.mjs';

test('an earlier declaration overridden by the same selector later is removed', () => {
  const css = '.a { color: red; margin: 0; }\n.b { color: blue; }\n.a { color: green; }\n';
  const { css: out, removedDeclarations } = removeDeadDeclarations(css);
  assert.equal(removedDeclarations, 1);
  assert.equal(out, '.a { margin: 0; }\n.b { color: blue; }\n.a { color: green; }\n');
});

test('a rule whose every declaration is overridden disappears entirely', () => {
  const css = '.a {\n  color: red;\n}\n.a {\n  color: green;\n}\n';
  assert.equal(removeDeadDeclarations(css).css, '.a {\n  color: green;\n}\n');
});

test('different media contexts, !important, and modern fallbacks are kept', () => {
  const css = [
    '.a { color: red; }',
    '@media (max-width: 500px) { .a { color: blue; } }',
    '.b { color: red !important; }',
    '.b { color: blue; }',
    '.c { height: 100vh; }',
    '.c { height: 100dvh; }',
    '',
  ].join('\n');
  const result = removeDeadDeclarations(css);
  assert.equal(result.removedDeclarations, 0);
  assert.equal(result.css, css);
});

test('comments, strings, and data URLs with semicolons do not confuse the parser', () => {
  const css = '/* .a { color: red } */\n.a { background: url("data:image/svg+xml;utf8,<svg>;</svg>"); content: "}"; }\n.a { color: green; }\n';
  const result = removeDeadDeclarations(css);
  assert.equal(result.removedDeclarations, 0);
  assert.equal(result.css, css);
});
