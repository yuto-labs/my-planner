// 下部ナビの通常タップを保ちつつ、横スワイプだけを除外できるか確認する。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isHorizontalNavigationGesture,
  replaceAppRoute,
  shouldRestoreActiveRoute,
} from '../js/navigation-gesture.js';

test('treats a clear horizontal move as a navigation-blocking swipe', () => {
  assert.equal(isHorizontalNavigationGesture(300, 700, 220, 704), true);
  assert.equal(isHorizontalNavigationGesture(80, 700, 170, 695), true);
});

test('keeps taps, finger jitter, and vertical scrolling available', () => {
  assert.equal(isHorizontalNavigationGesture(100, 700, 105, 703), false);
  assert.equal(isHorizontalNavigationGesture(100, 700, 113, 700), false);
  assert.equal(isHorizontalNavigationGesture(100, 700, 118, 760), false);
  assert.equal(isHorizontalNavigationGesture(100, 700, 140, 735), false);
});

test('fails closed for malformed touch coordinates', () => {
  assert.equal(isHorizontalNavigationGesture(undefined, 0, 50, 0), false);
  assert.equal(isHorizontalNavigationGesture(0, 0, Number.NaN, 0), false);
});

test('replaces an app hash without adding a browser history entry', () => {
  const calls = [];
  const historyApi = {
    state: { retained: true },
    replaceState: (...args) => calls.push(args),
  };
  const locationApi = { hash: '#home' };

  assert.equal(replaceAppRoute(historyApi, locationApi, 'tasks'), true);
  assert.deepEqual(calls, [[{ retained: true }, '', '#tasks']]);
});

test('does not rewrite the URL when the requested app route is already active', () => {
  let called = false;
  const historyApi = { state: null, replaceState: () => { called = true; } };

  assert.equal(replaceAppRoute(historyApi, { hash: '#memo' }, '#memo'), false);
  assert.equal(called, false);
});

test('restores the active route when old browser history points at another screen', () => {
  assert.equal(shouldRestoreActiveRoute('calendar', '#tasks'), true);
  assert.equal(shouldRestoreActiveRoute('knowledge', '#knowledge'), false);
});

test('also protects detail routes from an old entry for another item', () => {
  assert.equal(
    shouldRestoreActiveRoute('knowledge-detail?id=current', '#knowledge-detail?id=old'),
    true,
  );
  assert.equal(shouldRestoreActiveRoute('', '#tasks'), false);
});
