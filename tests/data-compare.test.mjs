// 保存差分と同期競合に使う共通比較ルールの特徴テスト。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  dedupeNewestById,
  recordVersion,
  stableJsonStringify,
  timestampOrZero,
} from '../js/data-compare.js';

test('stable JSON ignores object key order but preserves array order', () => {
  assert.equal(
    stableJsonStringify({ b: 2, a: { y: 2, x: 1 } }),
    stableJsonStringify({ a: { x: 1, y: 2 }, b: 2 }),
  );
  assert.notEqual(stableJsonStringify([1, 2]), stableJsonStringify([2, 1]));
});

test('timestamp conversion falls back to zero for missing or invalid values', () => {
  assert.equal(timestampOrZero(null), 0);
  assert.equal(timestampOrZero('not-a-date'), 0);
  assert.equal(timestampOrZero('2026-09-19T00:00:00.000Z'), Date.parse('2026-09-19T00:00:00.000Z'));
});

test('record version prefers an explicit numeric version and supports legacy timestamps', () => {
  assert.equal(recordVersion({ syncVersion: 7, updatedAt: '2099-01-01T00:00:00Z' }), 7);
  assert.equal(recordVersion({ syncVersion: 0, updatedAt: '2099-01-01T00:00:00Z' }), 0);
  assert.equal(recordVersion({ updatedAt: '2026-09-19T00:00:00Z' }), Date.parse('2026-09-19T00:00:00Z'));
});

test('deduplication keeps the newest id and lets the later record win a tie', () => {
  const older = { id: 'a', syncVersion: 1, value: 'old' };
  const newer = { id: 'a', syncVersion: 2, value: 'new' };
  const tiedLater = { id: 'b', syncVersion: 3, value: 'later' };
  assert.deepEqual(dedupeNewestById([
    older,
    { id: 'b', syncVersion: 3, value: 'first' },
    { value: 'missing id' },
    newer,
    tiedLater,
  ]), [newer, tiedLater]);
});
