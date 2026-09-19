// ============================================================
// memo-model.js - メモ画面に依存しないデータ整形規則
//
// DOMを触らない処理をエディタ本体から分けることで、一覧表示や保存前処理を
// ブラウザなしでテストできる。保存済みデータを変更せず、読む時だけ補正する。
// ============================================================

/** 星付きを先にし、同じグループ内を最終更新の新しい順に並べる。 */
export function sortMemosForList(memos) {
  return [...(Array.isArray(memos) ? memos : [])].sort((left, right) => {
    const starOrder = Number(Boolean(right?.starred)) - Number(Boolean(left?.starred));
    if (starOrder) return starOrder;
    const leftTime = Date.parse(left?.updatedAt || left?.createdAt || '') || 0;
    const rightTime = Date.parse(right?.updatedAt || right?.createdAt || '') || 0;
    return rightTime - leftTime;
  });
}

/** 古い表や一部欠けた表も、最低2列の安全な表示用データとして読む。 */
export function normalizeMemoTable(block) {
  const source = block?.table || {};
  const headers = Array.isArray(source.headers) ? source.headers.map(value => String(value ?? '')) : [];
  const width = Math.max(2, headers.length);
  const normalizedHeaders = Array.from({ length: width }, (_, index) => headers[index] || `列${index + 1}`);
  const rows = Array.isArray(source.rows) && source.rows.length ? source.rows : [['', '']];
  return {
    headers: normalizedHeaders,
    rows: rows.map(row => Array.from({ length: width }, (_, index) => String((row || [])[index] ?? ''))),
  };
}

/** 保存前の画像掃除で残すべきパスを、トグルの子を含めてすべて集める。 */
export function collectMemoImagePaths(blocks, paths = new Set()) {
  (blocks || []).forEach(block => {
    if (block?.type === 'image' && block.path) paths.add(block.path);
    if (block?.children?.length) collectMemoImagePaths(block.children, paths);
  });
  return paths;
}

/** 検索索引や概要に使うプレーンテキストを、現在の保存形式から作る。 */
export function memoBlocksToText(blocks, maxLen = 0) {
  let text = '';
  for (const block of (blocks || [])) {
    if (block.type === 'divider' || block.type === 'math') continue;
    if (block.type === 'table') {
      const table = normalizeMemoTable(block);
      text += `${table.headers.join(' ')} ${table.rows.map(row => row.join(' ')).join(' ')} `;
      continue;
    }
    text += (block.text || '') + ' ';
    if (block.children) {
      for (const child of block.children) text += (child.text || '') + ' ';
    }
  }
  text = text.trim();
  return maxLen && text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
}
