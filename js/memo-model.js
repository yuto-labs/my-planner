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

/** 本文に表示するURLだけを検証する。保存値は書き換えない。 */
export function normalizeMemoUrl(value) {
  const source = String(value || '').trim();
  if (!/^(?:https?:\/\/|www\.)/i.test(source)) return null;
  try {
    const url = new URL(/^www\./i.test(source) ? `https://${source}` : source);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname ? url.href : null;
  } catch {
    return null;
  }
}

/** 裸のURLを表示用の文字列とリンク先へ分け、句読点はリンクに含めない。 */
export function splitMemoTextUrls(value) {
  const source = String(value ?? '');
  const urlPattern = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;
  const parts = [];
  let cursor = 0;
  for (const match of source.matchAll(urlPattern)) {
    const start = match.index;
    if (start > 0 && /[a-z\d@_]/i.test(source[start - 1])) continue;
    const label = match[0].replace(/[.,!?;:、。！？，．）)\]}]+$/u, '');
    const href = normalizeMemoUrl(label);
    if (!href) continue;
    if (start > cursor) parts.push({ text: source.slice(cursor, start) });
    parts.push({ text: label, href });
    cursor = start + label.length;
  }
  if (cursor < source.length) parts.push({ text: source.slice(cursor) });
  return parts.length ? parts : [{ text: source }];
}

/** 表で使われる改行タグだけを改行へ戻す。他のHTMLは実行せず文字列のまま残す。 */
export function normalizeMemoTableCell(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').replace(/<br\s*\/?\s*>/gi, '\n');
}

/** Markdown表の一行に収まるよう、セル内の改行と区切り文字をエスケープする。 */
export function memoTableCellToMarkdown(value) {
  return normalizeMemoTableCell(value).replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

/** 貼り付けの現在行から、タブ区切り表または区切り行付きMarkdown表だけを読み取る。 */
export function parsePastedMemoTable(lines, start = 0) {
  const first = lines[start] || '';
  const tabs = first.includes('\t');
  /** 区切りだけを解析し、セルの文字列はHTMLとして扱わない。 */
  const split = line => tabs
    ? line.split('\t').map(cell => normalizeMemoTableCell(cell.trim()))
    : line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/)
      .map(cell => normalizeMemoTableCell(cell.trim().replace(/\\\|/g, '|')));
  const headers = split(first);
  if (headers.length < 2) return null;
  const separator = split(lines[start + 1] || '');
  if (!tabs && (separator.length !== headers.length || !separator.every(cell => /^:?-{3,}:?$/.test(cell)))) return null;
  let end = start + (tabs ? 1 : 2);
  const rows = [];
  while (end < lines.length && lines[end].trim()) {
    const row = split(lines[end]);
    if (row.length !== headers.length) break;
    rows.push(row);
    end++;
  }
  if (tabs && !rows.length) return null;
  return { table: { headers, rows }, end };
}

/** 古い表や一部欠けた表も、最低2列の安全な表示用データとして読む。 */
export function normalizeMemoTable(block) {
  const source = block?.table || {};
  const headers = Array.isArray(source.headers) ? source.headers.map(normalizeMemoTableCell) : [];
  const width = Math.max(2, headers.length);
  const normalizedHeaders = Array.from({ length: width }, (_, index) => headers[index] || `列${index + 1}`);
  const rows = Array.isArray(source.rows) && source.rows.length ? source.rows : [['', '']];
  return {
    headers: normalizedHeaders,
    rows: rows.map(row => Array.from({ length: width }, (_, index) => normalizeMemoTableCell((row || [])[index]))),
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

const EDGE_TRIMMABLE_BLOCK_TYPES = new Set([
  'paragraph', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'bullet', 'numbered', 'checklist', 'quote', 'code',
]);

/** 装飾タグや改行だけのHTMLを、空の編集ブロックとして扱える形へ整える。 */
function memoHtmlToComparableText(html) {
  return String(html || '')
    .replace(/<br\s*\/?\s*>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .trim();
}

/** 先頭・末尾に残った空の文字ブロックだけを除き、本文中の意図的な空行は保つ。 */
export function trimMemoEdgeEmptyBlocks(blocks, { keepOne = true } = {}) {
  const source = Array.isArray(blocks) ? blocks : [];
  const normalized = source.map(block => {
    if (!Array.isArray(block?.children)) return block;
    return {
      ...block,
      children: trimMemoEdgeEmptyBlocks(block.children, { keepOne: false }),
    };
  });
  /** 画像や区切り線を除き、文字を持たない編集用ブロックだけを判定する。 */
  const isEmptyEdgeBlock = block => {
    const type = block?.type || 'paragraph';
    if (!EDGE_TRIMMABLE_BLOCK_TYPES.has(type)) return false;
    return !String(block?.text || '').trim() && !memoHtmlToComparableText(block?.html);
  };

  let start = 0;
  let end = normalized.length;
  while (start < end && isEmptyEdgeBlock(normalized[start])) start += 1;
  while (end > start && isEmptyEdgeBlock(normalized[end - 1])) end -= 1;
  const trimmed = normalized.slice(start, end);

  // エディタには入力先が一つ必要なので、全文が空なら既存の先頭ブロックを残す。
  if (!trimmed.length && keepOne && normalized.length) return [normalized[0]];
  return trimmed;
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
