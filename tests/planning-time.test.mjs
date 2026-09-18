// カレンダーとタスク配分が共有する時刻解釈の特徴テスト。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calendarEventRange,
  clockTimeToMinutes,
  halfOpenRangesOverlap,
  scheduleRangeForDate,
} from '../js/planning-time.js';

test('converts strict 24-hour clock text to minutes from midnight', () => {
  assert.equal(clockTimeToMinutes('00:00'), 0);
  assert.equal(clockTimeToMinutes('10:30'), 630);
  assert.equal(clockTimeToMinutes('23:59'), 1439);
});

test('rejects malformed or out-of-range clock text', () => {
  for (const value of ['', null, '9:00', '24:00', '12:60', 'ab:cd', '12:30:00']) {
    assert.equal(clockTimeToMinutes(value), null, String(value));
  }
});

test('treats touching half-open ranges as consecutive rather than overlapping', () => {
  assert.equal(halfOpenRangesOverlap(600, 660, 660, 720), false);
  assert.equal(halfOpenRangesOverlap(600, 660, 659, 720), true);
  assert.equal(halfOpenRangesOverlap(600, 720, 630, 660), true);
  assert.equal(halfOpenRangesOverlap(600, 720, 540, 780), true);
});

test('calendar event ranges preserve valid ends and default missing or reversed ends to one hour', () => {
  const start = new Date('2026-09-18T10:00:00').getTime();
  const validEnd = new Date('2026-09-18T11:30:00').getTime();

  assert.deepEqual(
    calendarEventRange({ start: '2026-09-18T10:00:00', end: '2026-09-18T11:30:00' }),
    { start, end: validEnd },
  );
  assert.deepEqual(calendarEventRange({ start: '2026-09-18T10:00:00' }), {
    start,
    end: start + 60 * 60 * 1000,
  });
  assert.deepEqual(
    calendarEventRange({ start: '2026-09-18T10:00:00', end: '2026-09-18T09:00:00' }),
    { start, end: start + 60 * 60 * 1000 },
  );
  assert.equal(calendarEventRange({ start: 'not-a-date' }), null);
});

test('schedule ranges keep valid times and use one hour for missing or reversed ends', () => {
  const start = new Date('2026-09-18T10:00:00').getTime();
  const validEnd = new Date('2026-09-18T10:45:00').getTime();

  assert.deepEqual(
    scheduleRangeForDate({ startTime: '10:00', endTime: '10:45' }, '2026-09-18'),
    { start, end: validEnd },
  );
  assert.deepEqual(scheduleRangeForDate({ startTime: '10:00' }, '2026-09-18'), {
    start,
    end: start + 60 * 60 * 1000,
  });
  assert.deepEqual(
    scheduleRangeForDate({ startTime: '10:00', endTime: '09:00' }, '2026-09-18'),
    { start, end: start + 60 * 60 * 1000 },
  );
  assert.equal(scheduleRangeForDate({}, '2026-09-18'), null);
});
