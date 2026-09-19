// ============================================================
// navigation-gesture.js - 画面移動ボタンのタップと横スワイプを区別する
//
// DOMや画面遷移には触れない純粋関数として分離し、端末差のあるタッチ操作を
// 数値だけでテストできるようにする。
// ============================================================

/**
 * 指を置いた位置と離した位置から、タップではなく横スワイプだったか判定する。
 * 小さな指ぶれや縦スクロールではtrueにせず、下部ナビの通常タップを保つ。
 */
export function isHorizontalNavigationGesture(
  startX,
  startY,
  endX,
  endY,
  minDistance = 14,
  horizontalRatio = 1.25,
) {
  const dx = Math.abs(Number(endX) - Number(startX));
  const dy = Math.abs(Number(endY) - Number(startY));
  if (![dx, dy, minDistance, horizontalRatio].every(Number.isFinite)) return false;
  return dx >= minDistance && dx > dy * horizontalRatio;
}

/**
 * アプリ内ルートのハッシュだけを置換し、ブラウザー履歴の件数は増やさない。
 * 端末の画面端スワイプが以前のアプリ画面を再生しないためにreplaceStateを使う。
 * @returns {boolean} URLを変更した場合はtrue、すでに同じ場合はfalse
 */
export function replaceAppRoute(historyApi, locationApi, routeHash) {
  const nextHash = `#${String(routeHash || '').replace(/^#/, '')}`;
  if (locationApi?.hash === nextHash) return false;
  historyApi.replaceState(historyApi.state ?? null, '', nextHash);
  return true;
}

/**
 * 履歴から来たURLが、実際に表示中のルートと異なるか判定する。
 * 画面名だけでなくクエリも比べることで、同じ詳細画面の別項目へ
 * 画面端スワイプだけで切り替わることも防ぐ。
 */
export function shouldRestoreActiveRoute(activeRouteHash, incomingLocationHash) {
  const active = String(activeRouteHash || '').replace(/^#/, '');
  const incoming = String(incomingLocationHash || '').replace(/^#/, '');
  return active.length > 0 && incoming !== active;
}
