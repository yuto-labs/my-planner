// Goal型タスクのAI分解が、表示どおり元タスクのサブタスクとして保存されることを守るテスト。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('AI decomposition stores results as subtasks of the original task', async () => {
  const source = await readFile(new URL('../js/modules/tasks.js', import.meta.url), 'utf8');
  const body = source.slice(
    source.indexOf('async function handleDecompose'),
    source.indexOf('/** 完了状態を切り替え'),
  );
  assert.ok(body.length > 0);
  // 別タスクを作ると「サブタスクを追加しました」という表示と食い違う。
  assert.doesNotMatch(body, /addTask\(/);
  assert.match(body, /updateTask\(taskId, \{ subtasks: \[\.\.\.\(current\.subtasks \|\| \[\]\), \.\.\.newSubtasks\] \}\)/);
  // 同じ分解を再実行しても既存のサブタスク名は重複させない。
  assert.match(body, /existingTitles\.has\(title\)/);
});
