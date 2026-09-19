// カレンダーのタップを横スワイプと誤認しないための特徴テスト。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calendarDayTapAction,
  calendarSwipeDirection,
  isCalendarHorizontalDrag,
} from '../js/calendar-gesture.js';

test('starts calendar dragging only after a clearly horizontal movement', () => {
  assert.equal(isCalendarHorizontalDrag(11, 0), false);
  assert.equal(isCalendarHorizontalDrag(12, 0), true);
  assert.equal(isCalendarHorizontalDrag(20, 18), false);
  assert.equal(isCalendarHorizontalDrag(-30, 5), true);
});

test('commits a swipe only beyond the viewport-aware threshold', () => {
  // 375px viewport -> 60px threshold. The comparison is intentionally strict.
  assert.equal(calendarSwipeDirection(60, 0, 375), 0);
  assert.equal(calendarSwipeDirection(61, 0, 375), -1);
  assert.equal(calendarSwipeDirection(-61, 0, 375), 1);
});

test('does not move the calendar for vertical or diagonal gestures', () => {
  assert.equal(calendarSwipeDirection(90, 80, 375), 0);
  assert.equal(calendarSwipeDirection(20, 100, 1200), 0);
});

test('caps the swipe threshold between 56 and 96 pixels', () => {
  assert.equal(calendarSwipeDirection(57, 0, 300), -1);
  assert.equal(calendarSwipeDirection(96, 0, 2000), 0);
  assert.equal(calendarSwipeDirection(97, 0, 2000), -1);
});

test('opens a month day only on the second tap of the same date', () => {
  assert.equal(calendarDayTapAction(null, '2026-09-19'), 'select');
  assert.equal(calendarDayTapAction('2026-09-18', '2026-09-19'), 'select');
  assert.equal(calendarDayTapAction('2026-09-19', '2026-09-19'), 'open');
  assert.equal(calendarDayTapAction('2026-09-19', ''), 'ignore');
});
