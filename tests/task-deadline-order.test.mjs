import test from 'node:test';
import assert from 'node:assert/strict';

import { sortTasksByDeadline } from '../js/modules/tasks.js';

test('tasks appear by nearest deadline despite saved manual order', () => {
  const tasks = [
    { id: 'later', dueDate: '2026-09-20', sortOrder: 0, completed: false },
    { id: 'none', dueDate: null, sortOrder: 1, completed: false },
    { id: 'soon', dueDate: '2026-09-16', sortOrder: 99, completed: false },
    { id: 'overdue', dueDate: '2026-09-10', sortOrder: 100, completed: false },
  ];
  assert.deepEqual(sortTasksByDeadline(tasks).map(task => task.id), ['overdue', 'soon', 'later', 'none']);
  assert.deepEqual(tasks.map(task => task.id), ['later', 'none', 'soon', 'overdue']);
});

test('deadline time sorts within a day and manual order breaks exact ties', () => {
  const tasks = [
    { id: 'evening', dueDate: '2026-09-16', dueTime: '18:00', sortOrder: 0 },
    { id: 'morning-b', dueDate: '2026-09-16', dueTime: '09:00', sortOrder: 2 },
    { id: 'morning-a', dueDate: '2026-09-16', dueTime: '09:00', sortOrder: 1 },
    { id: 'date-only', dueDate: '2026-09-16', sortOrder: 0 },
  ];
  assert.deepEqual(sortTasksByDeadline(tasks).map(task => task.id), [
    'morning-a', 'morning-b', 'evening', 'date-only',
  ]);
});

test('unfinished tasks precede completed tasks at the same deadline', () => {
  const tasks = [
    { id: 'done', dueDate: '2026-09-16', sortOrder: 0, completed: true },
    { id: 'pending', dueDate: '2026-09-16', sortOrder: 1, completed: false },
    { id: 'invalid', dueDate: 'not-a-date', completed: false },
  ];
  assert.deepEqual(sortTasksByDeadline(tasks).map(task => task.id), ['pending', 'done', 'invalid']);
});
