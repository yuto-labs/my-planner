// リマインダーが既定オフで、予定は開始前・タスクは時刻付きの締切前に一度だけ鳴ることを守るテスト。
import test from 'node:test';
import assert from 'node:assert/strict';

import { claimReminder, normalizeReminderSettings, planReminders } from '../js/reminders.js';

const at = text => new Date(text).getTime();

test('reminders are off by default and invalid lead times fall back to 10 minutes', () => {
  assert.deepEqual(normalizeReminderSettings(undefined), { enabled: false, leadMinutes: 10, includeTasks: true });
  assert.equal(normalizeReminderSettings({ leadMinutes: -5 }).leadMinutes, 10);
  assert.equal(normalizeReminderSettings({ enabled: 'yes' }).enabled, false);
});

test('events fire before their start, and only timed, open tasks are included', () => {
  const plan = planReminders({
    events: [{ id: 'e1', title: '面談', start: '2026-10-20T10:00:00' }],
    tasks: [
      { id: 't1', title: '提出', dueDate: '2026-10-20', dueTime: '12:00' },
      { id: 't2', title: '時刻なし', dueDate: '2026-10-20' },
      { id: 't3', title: '完了済み', dueDate: '2026-10-20', dueTime: '13:00', completed: true },
    ],
    settings: { enabled: true, leadMinutes: 15 },
    from: at('2026-10-20T00:00:00'),
    to: at('2026-10-21T00:00:00'),
  });
  assert.deepEqual(plan.map(item => [item.title, new Date(item.fireAt).toTimeString().slice(0, 5), item.body]), [
    ['面談', '09:45', '15分後に開始'],
    ['提出', '11:45', '15分後に締切'],
  ]);
});

test('task reminders can be turned off and items outside the window are skipped', () => {
  const plan = planReminders({
    events: [{ id: 'late', title: '明後日', start: '2026-10-22T10:00:00' }],
    tasks: [{ id: 't1', title: '提出', dueDate: '2026-10-20', dueTime: '12:00' }],
    settings: { includeTasks: false, leadMinutes: 0 },
    from: at('2026-10-20T00:00:00'),
    to: at('2026-10-21T00:00:00'),
  });
  assert.deepEqual(plan, []);
});

test('each reminder is claimed only once, so reloads and other tabs do not repeat it', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  assert.equal(claimReminder('event:e1:1', storage), true);
  assert.equal(claimReminder('event:e1:1', storage), false);
  assert.equal(claimReminder('event:e1:2', storage), true);
});
