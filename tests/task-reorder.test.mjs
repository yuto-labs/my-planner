// タスクの手動並べ替えが、関係のないタスクを更新扱いにせず、
// スマホでは長押しで操作できることを守るテスト。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const values = new Map();
globalThis.localStorage = {
  get length() { return values.size; },
  key(index) { return [...values.keys()][index] ?? null; },
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); },
};

const { getTasks, reorderTask } = await import('../js/storage.js');

test('reordering updates only tasks whose position changed', () => {
  const old = '2026-10-01T00:00:00.000Z';
  const tasks = ['a', 'b', 'c', 'd', 'e'].map((id, index) => ({
    id, title: id, sortOrder: index, updatedAt: old, completed: false,
  }));
  values.set('mp_tasks', JSON.stringify(tasks));

  reorderTask('d', 'b');

  const after = getTasks();
  assert.deepEqual(after.map(task => task.id), ['a', 'd', 'b', 'c', 'e']);
  assert.deepEqual(after.map(task => task.sortOrder), [0, 1, 2, 3, 4]);
  const touched = after.filter(task => task.updatedAt !== old).map(task => task.id).sort();
  // a と e は位置が変わらないため、同期で再送信も上書きもされない。
  assert.deepEqual(touched, ['b', 'c', 'd']);
});

test('touch devices reorder by long press without opening the editor afterwards', async () => {
  const source = await readFile(new URL('../js/modules/tasks.js', import.meta.url), 'utf8');
  const touch = source.slice(source.indexOf('function wireTouchReorder'), source.indexOf('/** ポインタ操作で手動順を変更する。'));
  assert.match(source, /const TOUCH_REORDER_DELAY_MS = 420;/);
  // 長押し前に指が動いたら通常のスクロールとして扱う。
  assert.match(touch, /if \(moved > TOUCH_REORDER_MOVE_TOLERANCE\) reset\(\);/);
  // 並べ替え中だけスクロールを止めるため、touchmoveはpassiveにしない。
  assert.match(touch, /e\.preventDefault\(\);[\s\S]*\{ passive: false \}/);
  // 一覧が作り直されても直後のclickを無視できるよう、画面単位で記録する。
  assert.match(touch, /taskClickSuppressedUntil = Date\.now\(\) \+ 700;/);
  assert.match(source, /if \(Date\.now\(\) < taskClickSuppressedUntil\) return;/);
  // 締切・状態が違うタスク同士は、PCのドラッグと同じ規則で拒否する。
  assert.match(touch, /reorderWithinSameDeadline\(id, overId\)/);
  // タッチ直後のブラウザー標準ドラッグは使わず、二重の並べ替えを防ぐ。
  const drag = source.slice(source.indexOf('function wireDragDrop'), source.indexOf('// ---- Recurrence label'));
  assert.match(drag, /Date\.now\(\) - \(listEl\._lastTouchStartAt \|\| 0\) < 1500/);
});
