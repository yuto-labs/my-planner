// ============================================================
// data-compare.js - 保存・同期で使う内容比較と版選択
//
// DOMやlocalStorageには触れない。キー順と無関係に内容を比較し、
// 複数端末の同じIDから新しい方を選ぶための純粋関数群。
// ============================================================

/** オブジェクトのキーをソートし、内容比較に使える安定した文字列を作る。 */
export function stableJsonStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableJsonStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => (
      `${JSON.stringify(key)}:${stableJsonStringify(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}
/** ISO日時等を比較用ミリ秒に変換し、不正な値は0にする。 */
export function timestampOrZero(value) {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/**
 * 数値の同期版があればそれを優先し、旧形式は更新日時で比較する。
 * `syncVersion: 0`も明示的な版として扱う。
 */
export function recordVersion(item) {
  const explicit = Number(item?.syncVersion);
  return Number.isFinite(explicit)
    ? explicit
    : timestampOrZero(item?.updatedAt || item?.createdAt);
}

/**
 * 同じIDの記録を1件にし、版の新しい方を残す。
 * 版が同じ場合は後から渡された記録を残す現行の同期規則を保つ。
 */
export function dedupeNewestById(items) {
  const byId = new Map();
  for (const item of items || []) {
    if (!item?.id) continue;
    const existing = byId.get(item.id);
    if (!existing || recordVersion(item) >= recordVersion(existing)) byId.set(item.id, item);
  }
  return [...byId.values()];
}
