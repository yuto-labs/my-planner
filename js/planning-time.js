// ============================================================
// planning-time.js - カレンダーとタスク配分で共有する時間計算
//
// 画面や保存に触れない純粋関数だけを置く。
// 同じ HH:MM 検査が画面ごとにずれるのを防ぐための共通層。
// ============================================================

/**
 * 24時間表記の`HH:MM`を0時からの分数へ変換する。
 * 形式と時刻の範囲の両方が正しくなければ`null`を返す。
 */
export function clockTimeToMinutes(value) {
  if (!/^\d{2}:\d{2}$/.test(value || '')) return null;
  const [hours, minutes] = value.split(':').map(Number);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * 終了時刻を含まない`[開始, 終了)`の時間帯が重なるかを返す。
 * 一方の終了ともう一方の開始が同じ場合は、連続予定として重複にしない。
 */
export function halfOpenRangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

const DEFAULT_EVENT_DURATION_MS = 60 * 60 * 1000;

/**
 * ISO日時を持つカレンダー予定を比較用の数値範囲へ変換する。
 * 終了が無い、または開始以前なら1時間の予定として扱う。
 */
export function calendarEventRange(event) {
  const start = new Date(event?.start).getTime();
  if (!Number.isFinite(start)) return null;
  const parsedEnd = event?.end ? new Date(event.end).getTime() : start + DEFAULT_EVENT_DURATION_MS;
  const end = Number.isFinite(parsedEnd) && parsedEnd > start
    ? parsedEnd
    : start + DEFAULT_EVENT_DURATION_MS;
  return { start, end };
}

/**
 * `YYYY-MM-DD`とマイスケジュールの時刻から、比較用範囲を作る。
 * 終了時刻が不正または開始以前なら、現行仕様ど1時間に補正する。
 */
export function scheduleRangeForDate(item, dateString) {
  if (!item?.startTime) return null;
  const start = new Date(`${dateString}T${item.startTime}:00`).getTime();
  if (!Number.isFinite(start)) return null;

  const endTime = item.endTime || item.startTime;
  const parsedEnd = new Date(`${dateString}T${endTime}:00`).getTime();
  const end = Number.isFinite(parsedEnd) && parsedEnd > start
    ? parsedEnd
    : start + DEFAULT_EVENT_DURATION_MS;
  return { start, end };
}
