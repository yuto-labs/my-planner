import test from 'node:test';
import assert from 'node:assert/strict';
import { captureHorizontalTableScroll, restoreHorizontalTableScroll } from '../js/horizontal-scroll-state.js';

function table(className, id, heading, left = 0) {
  return {
    className,
    scrollLeft: left,
    closest: () => id ? { dataset: { viewBlockId: id } } : null,
    querySelector: () => heading ? { textContent: heading } : null,
  };
}

function container(elements) {
  return { querySelectorAll: () => elements };
}

test('restores horizontal positions of the same memo tables after a refresh', () => {
  const before = container([table('kn-view-table-wrap', 'first', '', 180), table('kn-view-table-wrap', 'second', '', 45)]);
  const after = container([table('kn-view-table-wrap', 'first', ''), table('kn-view-table-wrap', 'second', '')]);
  const positions = captureHorizontalTableScroll(before);
  restoreHorizontalTableScroll(after, positions);
  assert.deepEqual(after.querySelectorAll().map(item => item.scrollLeft), [180, 45]);
});

test('does not restore an old table position to a different memo block', () => {
  const positions = captureHorizontalTableScroll(container([table('kn-view-table-wrap', 'old', '', 160)]));
  const after = container([table('kn-view-table-wrap', 'new', '')]);
  restoreHorizontalTableScroll(after, positions);
  assert.equal(after.querySelectorAll()[0].scrollLeft, 0);
});

test('restores a Knowledge table only while its heading still matches', () => {
  const positions = captureHorizontalTableScroll(container([table('learning-table-scroll', null, '項目 説明', 120)]));
  const after = container([table('learning-table-scroll', null, '項目 説明')]);
  restoreHorizontalTableScroll(after, positions);
  assert.equal(after.querySelectorAll()[0].scrollLeft, 120);
  const changed = container([table('learning-table-scroll', null, '別の表')]);
  restoreHorizontalTableScroll(changed, positions);
  assert.equal(changed.querySelectorAll()[0].scrollLeft, 0);
});
