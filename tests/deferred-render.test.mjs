// 一覧画面の初回描画を1フレーム遅らせる処理が、その間に移動した別画面を上書きしないことを守るテスト。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('tasks and memo skip their delayed first render after the user leaves', async () => {
  const tasks = await readFile(new URL('../js/modules/tasks.js', import.meta.url), 'utf8');
  const taskInit = tasks.slice(tasks.indexOf('export function initTasks'), tasks.indexOf('// ---- Render ----'));
  assert.match(taskInit, /container\.dataset\.view === 'tasks' && state\.container === container\) render\(\)/);

  const memo = await readFile(new URL('../js/modules/memo.js', import.meta.url), 'utf8');
  const memoInit = memo.slice(memo.indexOf('export function initKnowledge'), memo.indexOf('function restoreKnowledgeListPosition'));
  assert.match(memoInit, /if \(!container\.isConnected \|\| container\.dataset\.view !== 'memo'\) return;/);
});
