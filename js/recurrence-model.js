// ============================================================
// recurrence-model.js - 繰り返し予定の「ルール」から開催日を計算する(純粋な処理)
//
// ルールは1件だけ保存し、実際の予定は「今日から半年先まで」だけ作る(storage.js)。
// ここでは、ルールに従って指定期間に入る開催日時を計算する。
// 各回のIDは「シリーズID-YYYYMMDD」と日付から決まる形にする。2台の端末が同時に
// 先の分を作っても同じIDになり、同期で一件にまとまる。消した回もIDで分かるので作り直さない。
// ============================================================

export const RECURRENCE_FREQS = Object.freeze(['daily', 'weekly', 'monthly']);

/** 日付を端末の時刻で YYYY-MM-DD にする。 */
export function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** シリーズIDと開催日から、その回の予定IDを決める。 */
export function occurrenceId(recurringId, date) {
  return `${recurringId}-${localDateKey(date).replace(/-/g, '')}`;
}

/** 月末を越えないよう、元の日にちを保って nか月先の同じ時刻を返す(1/31の翌月は2月末)。 */
function addMonthsClamped(first, months) {
  const index = first.getMonth() + months;
  const year = first.getFullYear() + Math.floor(index / 12);
  const month = ((index % 12) + 12) % 12;
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(first.getDate(), lastDay),
    first.getHours(), first.getMinutes(), first.getSeconds(), first.getMilliseconds());
}

/**
 * ルールに従い、after より後〜until(含む)の開催日時を順に返す。
 * rule: { firstStart(ISO), freq, until(YYYY-MM-DD|null), excludeWeekdays([0-6]) }
 * after/until は YYYY-MM-DD(日単位)。after を省くと初回から数える。
 */
export function occurrencesBetween(rule, { after = null, until }) {
  const first = new Date(rule?.firstStart || '');
  if (!Number.isFinite(first.getTime()) || !RECURRENCE_FREQS.includes(rule.freq) || !until) return [];
  const lastKey = rule.until && rule.until < until ? rule.until : until;
  const excluded = new Set((rule.excludeWeekdays || []).map(Number));
  const dates = [];
  // 念のための上限。毎日×半年でも約180件なので、通常はここに届かない。
  for (let index = 0; index < 2000; index += 1) {
    const date = rule.freq === 'monthly'
      ? addMonthsClamped(first, index)
      : new Date(first.getFullYear(), first.getMonth(), first.getDate() + index * (rule.freq === 'weekly' ? 7 : 1),
        first.getHours(), first.getMinutes(), first.getSeconds(), first.getMilliseconds());
    const key = localDateKey(date);
    if (key > lastKey) break;
    if (after && key <= after) continue;
    if (!excluded.has(date.getDay())) dates.push(date);
  }
  return dates;
}

/** 基準日から n日後を YYYY-MM-DD で返す。 */
export function addDaysKey(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return localDateKey(new Date(year, month - 1, day + days));
}
