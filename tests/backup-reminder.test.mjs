// バックアップのお知らせが、使い始めや書き出し直後には出ず、30日たったら出て、「あとで」で7日止まることを守るテスト。
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
const { isBackupDue } = await import('../js/backup-reminder.js');

const DAY = 86_400_000;
const now = 1_800_000_000_000;

test('a device that just started using the app is not reminded', () => {
  assert.equal(isBackupDue({ backupReminderSince: now }, now), false);
  assert.equal(isBackupDue({}, now), false);
});

test('the reminder appears 30 days after starting or after the last export', () => {
  assert.equal(isBackupDue({ backupReminderSince: now - 30 * DAY }, now), true);
  assert.equal(isBackupDue({ backupReminderSince: now - 90 * DAY, lastBackupAt: now - 29 * DAY }, now), false);
  assert.equal(isBackupDue({ backupReminderSince: now - 90 * DAY, lastBackupAt: now - 31 * DAY }, now), true);
});

test('"later" hides the reminder until the snooze ends', () => {
  const settings = { backupReminderSince: now - 90 * DAY, backupSnoozedUntil: now + 7 * DAY };
  assert.equal(isBackupDue(settings, now), false);
  assert.equal(isBackupDue(settings, now + 7 * DAY), true);
});
