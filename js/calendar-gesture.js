// ============================================================
// calendar-gesture.js - カレンダーの横スワイプ判定
//
// DOMイベントを直接扱わず、指の移動量から意図だけを判定する。
// カレンダー本体のリスナーと分けることで、誤タップ防止の境界をテストできる。
// ============================================================

/** 移動がタップではなく横ドラッグと見なせるかを返す。 */
export function isCalendarHorizontalDrag(dx, dy, minDistance = 12, horizontalRatio = 1.15) {
  return Math.abs(dx) >= minDistance && Math.abs(dx) >= Math.abs(dy) * horizontalRatio;
}

/**
 * 指を離した時に期間を移動する方向を返す。
 * 右へのスワイプは前の期間`-1`、左は次の期間`1`、不十分なら`0`。
 */
export function calendarSwipeDirection(dx, dy, viewportWidth) {
  const threshold = Math.max(56, Math.min(96, viewportWidth * 0.16));
  const isCommittedSwipe = (
    Math.abs(dx) > Math.abs(dy) * 1.25
    && Math.abs(dx) > threshold
  );
  if (!isCommittedSwipe) return 0;
  return dx > 0 ? -1 : 1;
}

