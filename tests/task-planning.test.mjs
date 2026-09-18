// 外部AIが返す時間配分JSONの受理ルールを固定するテスト。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyPlanningBuffer,
  clockRangesOverlapConservatively,
  estimateMinutesByWeight,
  findScheduleOverlaps,
  normalizePlanTime,
  normalizeSchedulePlan,
} from '../js/task-planning.js';

test('normalizes supported plan containers and key aliases', () => {
  // The established parser requires a two-digit hour inside an ISO datetime.
  assert.deepEqual(normalizeSchedulePlan({ blocks: [{
    task_id: 'task-1',
    task_title: '資料作成',
    start: '2026-09-19T9:05:00',
    end_time: '10:15:00',
    reason: '午前に集中',
  }] }), []);

  assert.deepEqual(normalizeSchedulePlan({ items: [{
    id: 'task-2', date: '2026-09-19', from: '9:05', to: '10:15', name: '読書', memo: '集中',
  }] }), [{
    taskId: 'task-2', title: '読書', date: '2026-09-19', startTime: '09:05', endTime: '10:15', note: '集中',
  }]);
});

test('normalizes clock spellings and rejects unsupported text', () => {
  assert.equal(normalizePlanTime('9:05'), '09:05');
  assert.equal(normalizePlanTime('09:05:30'), '09:05');
  assert.equal(normalizePlanTime('2026-09-19T09:05:30'), '09:05');
  assert.equal(normalizePlanTime('9時5分'), '');
});

test('drops plan blocks missing the required date or clock shape', () => {
  assert.deepEqual(normalizeSchedulePlan({ scheduleItems: [
    { date: '2026-09-19', startTime: '09:00', endTime: '10:00' },
    { date: '', startTime: '09:00', endTime: '10:00' },
    { date: '2026-09-19', startTime: '', endTime: '10:00' },
  ] }), [{ taskId: null, title: '', date: '2026-09-19', startTime: '09:00', endTime: '10:00', note: '' }]);
});

test('keeps adjacent blocks and reports only actual same-day overlaps', () => {
  const first = { date: '2026-09-19', startTime: '09:00', endTime: '10:00' };
  const adjacent = { date: '2026-09-19', startTime: '10:00', endTime: '11:00' };
  const overlap = { date: '2026-09-19', startTime: '10:30', endTime: '11:30' };
  const otherDay = { date: '2026-09-20', startTime: '10:30', endTime: '11:30' };
  assert.deepEqual(findScheduleOverlaps([overlap, otherDay, adjacent, first]), [overlap]);
});

test('treats malformed clock ranges conservatively as conflicts', () => {
  assert.equal(clockRangesOverlapConservatively('09:00', '10:00', '10:00', '11:00'), false);
  assert.equal(clockRangesOverlapConservatively('09:00', '10:00', '09:30', '11:00'), true);
  assert.equal(clockRangesOverlapConservatively('bad', '10:00', '09:30', '11:00'), true);
});

test('keeps current weight estimates and ten-minute buffer rounding', () => {
  assert.equal(estimateMinutesByWeight('large'), 180);
  assert.equal(estimateMinutesByWeight('medium'), 90);
  assert.equal(estimateMinutesByWeight('small'), 45);
  assert.equal(applyPlanningBuffer(45, 20), 50);
  assert.equal(applyPlanningBuffer(null, 0), 90);
});
