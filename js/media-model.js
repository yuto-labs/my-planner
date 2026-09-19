// ============================================================
// media-model.js - 画像機能の純粋な入力整形と安全性判定
//
// Supabase、DOM、Cache Storageに依存しない処理だけを置く。
// media.jsは通信と表示を担当し、このファイルが保存前の形と境界を決める。
// ============================================================

/** Storageのフォルダ名に使える英数字・`_`・`-`だけを残す。 */
export function sanitizeMediaKind(value) {
  return String(value || 'misc').replace(/[^a-z0-9_-]/gi, '').slice(0, 32) || 'misc';
}

/**
 * 縦横比を保ったまま長辺を上限以下にする。
 * 小さい画像は拡大せず、丸め後も最低1pxを保証する。
 */
export function scaledImageDimensions(width, height, maxEdge = 1600) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** 画像パスが現在のユーザーフォルダの下にあるかを確認する。 */
export function isOwnedMediaPath(path, userId) {
  const cleanPath = String(path || '').trim();
  const cleanUserId = String(userId || '').trim();
  return !!cleanPath && !!cleanUserId && cleanPath.startsWith(`${cleanUserId}/`);
}

/** キャプション等をHTMLへ埋め込む前に特殊文字を無害化する。 */
export function escapeMediaHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/** HTML属性に改行が入らないよう、エスケープ後に空白へ変換する。 */
export function escapeMediaAttribute(value) {
  return escapeMediaHtml(value).replaceAll('\n', ' ');
}
