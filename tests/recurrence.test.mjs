// 繰り返し予定をルール1件で持ち、半年先までだけ作って自動で作り足し、消した回は作り直さないことを守るテスト。
import test from 'node:test';
import assert from 'node:assert/strict';

const values = new Map();
globalThis.localStorage = {
  get length() { return values.size; },
  key(index) { return [...values.keys()][index] ?? null; },
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); },
};

const { localDateKey, occurrenceId, occurrencesBetween } = await import('../js/recurrence-model.js');
const {
  createRecurringSeries, deleteEvent, deleteFutureRecurring, endRecurrenceBefore, extendRecurringSeries,
  getEvents, getRecurrenceRules, updateRecurrenceTemplate,
} = await import('../js/storage.js');

test.beforeEach(() => values.clear());

/** 今日から n日後の YYYY-MM-DD。 */
const daysFromToday = days => { const d = new Date(); d.setDate(d.getDate() + days); return localDateKey(d); };
/** 今日から n日後の指定時刻のISO。 */
const isoAt = (days, hour) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return d.toISOString(); };

test('monthly rules keep the day of month and clamp to month ends; weekdays can be excluded', () => {
  const monthly = occurrencesBetween({ firstStart: new Date(2026, 0, 31, 9).toISOString(), freq: 'monthly' }, { until: '2026-04-30' });
  assert.deepEqual(monthly.map(localDateKey), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  // 2026-10-19は月曜日。土日を除外した毎日。
  const weekdays = occurrencesBetween({ firstStart: new Date(2026, 9, 19, 9).toISOString(), freq: 'daily', excludeWeekdays: [0, 6] }, { until: '2026-10-26' });
  assert.deepEqual(weekdays.map(localDateKey), ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-26']);
  // 終了日のあるルールはそこで止まり、after より後だけを返す。
  const ended = occurrencesBetween({ firstStart: new Date(2026, 9, 19, 9).toISOString(), freq: 'weekly', until: '2026-11-09' }, { after: '2026-10-19', until: '2027-01-01' });
  assert.deepEqual(ended.map(localDateKey), ['2026-10-26', '2026-11-02', '2026-11-09']);
});

test('an open-ended series stores one rule and only about six months of events', () => {
  const { count, recurringId } = createRecurringSeries({ title: '朝ラン', start: isoAt(0, 7), end: isoAt(0, 8), categoryId: 'c' }, { freq: 'daily' });
  assert.ok(count >= 180 && count <= 182, `created ${count}`);
  assert.equal(Object.keys(getRecurrenceRules()).length, 1);
  const events = getEvents();
  assert.ok(events.every(event => event.recurringId === recurringId && event.title === '朝ラン'));
  // IDは日付から決まる(2台で同時に作っても同じIDになる)。
  assert.equal(events[0].id, occurrenceId(recurringId, new Date(events[0].start)));
  assert.equal(new Date(events[0].end) - new Date(events[0].start), 3_600_000);
});

test('the series is extended when fewer than three months remain, without recreating deleted ones', () => {
  const { recurringId } = createRecurringSeries({ title: '週次MTG', start: isoAt(0, 10), end: isoAt(0, 11) }, { freq: 'weekly' });
  const before = getEvents().length;
  // 削除した回は、作り足しでも復活しない。
  const deleted = getEvents()[1];
  assert.ok(deleteEvent(deleted.id));
  assert.equal(extendRecurringSeries(), 0); // まだ半年分あるので作らない
  const later = new Date(); later.setDate(later.getDate() + 100);
  const added = extendRecurringSeries({ now: later });
  assert.ok(added >= 13 && added <= 15, `added ${added}`);
  assert.equal(getEvents().length, before - 1 + added);
  assert.equal(getEvents().some(event => event.id === deleted.id), false);
  assert.ok(getRecurrenceRules()[recurringId].generatedUntil >= daysFromToday(279));
});

test('deleting the rest of a series stops the rule, and template edits apply to new occurrences', () => {
  const { recurringId } = createRecurringSeries({ title: '英会話', start: isoAt(0, 19), end: isoAt(0, 20) }, { freq: 'weekly' });
  updateRecurrenceTemplate(recurringId, { title: '英会話(新)', start: isoAt(0, 19), end: isoAt(0, 21) });
  assert.equal(getRecurrenceRules()[recurringId].template.title, '英会話(新)');
  assert.equal(getRecurrenceRules()[recurringId].durationMs, 2 * 3_600_000);

  const cut = getEvents()[3];
  deleteFutureRecurring(recurringId, cut.start);
  endRecurrenceBefore(recurringId, cut.start);
  const far = new Date(); far.setDate(far.getDate() + 200);
  assert.equal(extendRecurringSeries({ now: far }), 0);
  assert.equal(getEvents().length, 3);
});
