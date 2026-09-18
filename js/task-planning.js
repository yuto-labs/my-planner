// ============================================================
// task-planning.js - AI時間配分の入力正規化と純粋な検査
//
// tasks.jsのUI・保存処理から、同じ入力なら必ず同じ結果になる
// 処理を分離する。外部AIのJSONのキー名ゆれはここで吸収する。
// ============================================================

import { clockTimeToMinutes, halfOpenRangesOverlap } from './planning-time.js';

/** `2026-09-19T10:30:00`のような文字列から日付部分を取り出す。 */
export function extractPlanDate(value) {
  const match = String(value || '').match(/\d{4}-\d{2}-\d{2}/);
  return match?.[0] || '';
}

/** `9:05`、`09:05:00`、ISO日時を保存用の`HH:MM`へそろえる。 */
export function normalizePlanTime(value) {
  const text = String(value || '').trim();
  const isoTime = text.match(/T(\d{2}:\d{2})(?::\d{2})?/);
  if (isoTime) return isoTime[1];
  const time = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!time) return '';
  return `${String(Number(time[1])).padStart(2, '0')}:${time[2]}`;
}

/** キー名の異なる外部AIの1ブロックをアプリの標準形式へ変換する。 */
export function normalizePlanBlock(block = {}) {
  const startRaw = block.startTime || block.start_time || block.start || block.from || '';
  const endRaw = block.endTime || block.end_time || block.end || block.to || '';
  const dateRaw = block.date || block.day || extractPlanDate(startRaw) || '';
  return {
    taskId: block.taskId || block.task_id || block.id || null,
    title: block.title || block.taskTitle || block.task_title || block.name || '',
    date: String(dateRaw).slice(0, 10),
    startTime: normalizePlanTime(startRaw),
    endTime: normalizePlanTime(endRaw),
    note: block.note || block.reason || block.memo || '',
  };
}

/**
 * 配列または複数の既知キーのいずれかからブロック一覧を読む。
 * 日付・開始・終了の文字列形式が欠ける項目は画面に渡さない。
 */
export function normalizeSchedulePlan(plan) {
  const source = Array.isArray(plan)
    ? plan
    : plan?.scheduleItems || plan?.mySchedule || plan?.blocks || plan?.plan
      || plan?.items || plan?.schedule?.items || [];
  if (!Array.isArray(source)) return [];
  return source
    .map(normalizePlanBlock)
    .filter(block => (
      /^\d{4}-\d{2}-\d{2}$/.test(block.date)
      && /^\d{2}:\d{2}$/.test(block.startTime)
      && /^\d{2}:\d{2}$/.test(block.endTime)
    ));
}

/**
 * 2つの時間帯が重なるかを判定する。
 * 不正な時刻は「安全を確認できない」ため、現行仕様どおり重複扱いにする。
 */
export function clockRangesOverlapConservatively(aStart, aEnd, bStart, bEnd) {
  const values = [aStart, aEnd, bStart, bEnd].map(clockTimeToMinutes);
  if (values.some(value => value == null)) return true;
  return halfOpenRangesOverlap(values[0], values[1], values[2], values[3]);
}

/** 同じ日の生成ブロック同士で、直前のブロックと重なる項目を返す。 */
export function findScheduleOverlaps(blocks) {
  const overlaps = [];
  const byDate = new Map();
  for (const block of blocks || []) {
    if (!byDate.has(block.date)) byDate.set(block.date, []);
    byDate.get(block.date).push(block);
  }

  byDate.forEach(dayBlocks => {
    const sorted = [...dayBlocks].sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const current = sorted[index];
      if (clockRangesOverlapConservatively(
        previous.startTime,
        previous.endTime,
        current.startTime,
        current.endTime,
      )) overlaps.push(current);
    }
  });
  return overlaps;
}

/** タスクの大きさからAI配分に渡す基準作業時間を返す。 */
export function estimateMinutesByWeight(weight) {
  if (weight === 'large') return 180;
  if (weight === 'small') return 45;
  return 90;
}

/** 見積時間に余裕率を加え、10分単位に丸める。 */
export function applyPlanningBuffer(minutes, bufferPercent) {
  const base = Math.max(1, Number(minutes) || 90);
  const buffered = base * (1 + (Number(bufferPercent) || 0) / 100);
  return Math.round(buffered / 10) * 10;
}

