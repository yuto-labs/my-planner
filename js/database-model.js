// ============================================================
// database-model.js - Notion風データベースの、画面に触れない処理
//
// CSV(NotionのエクスポートやExcel)を読み、列ごとに「URL・チェック・日付・数値・文字」の
// どれかを中身から推測する。1列目は名前(各行のページの題名)として扱う。
// パスワードらしい列は、同期で平文のままクラウドへ送られるため既定では取り込まない。
// ============================================================

export const PROPERTY_TYPES = Object.freeze(['text', 'multi_select', 'url', 'number', 'checkbox', 'date']);
export const PROPERTY_TYPE_LABELS = Object.freeze({ text: '文字', multi_select: 'タグ', url: 'URL', number: '数値', checkbox: 'チェック', date: '日付' });

// タグの色(Notionと同じ9色)。色は保存せず、タグの名前から毎回同じ色を選ぶ(同じ名前は必ず同じ色)。
export const TAG_COLOR_COUNT = 9;
/** タグの名前から色の番号(0〜8)を決める。 */
export function tagColor(name) {
  let hash = 0;
  for (const ch of String(name)) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return hash % TAG_COLOR_COUNT;
}

// 表の列の幅(px)の既定値。ドラッグで変えた幅は列ごとに保存する(prop.width / db.titleWidth)。
const DEFAULT_WIDTHS = { title: 280, text: 280, multi_select: 180, url: 220, number: 110, checkbox: 90, date: 150 };
/** 列の表示幅。保存した幅があればそれ、なければ種類ごとの既定値。 */
export function columnWidth(prop) {
  return Math.max(80, Number(prop?.width) || DEFAULT_WIDTHS[prop?.type] || 200);
}

/**
 * CSVの文字列を行と列の二次元配列にする。引用符で囲んだ値の中のカンマ・改行・""(引用符)にも対応する。
 * 先頭のBOM(Excelが付ける見えない文字)は取り除く。
 */
export function parseCsv(text) {
  const source = String(text || '').replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { value += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else value += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(value); value = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i += 1;
      row.push(value); rows.push(row); row = []; value = '';
    } else value += ch;
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  return rows.filter(cells => cells.some(cell => cell.trim()));
}

/** 「2026年8月24日 → 2026年9月4日」「2026/8/24」「2026-08-24」を {start, end} にする。読めなければnull。 */
export function parseDateValue(raw) {
  const parts = String(raw || '').split(/\s*(?:→|->|〜|~)\s*/).map(part => part.trim()).filter(Boolean);
  if (!parts.length) return null;
  /** 「2026年8月24日」などの1つの日付を YYYY-MM-DD にする。 */
  const toKey = part => {
    const match = part.match(/^(\d{4})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})\s*日?$/);
    return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : null;
  };
  const start = toKey(parts[0]);
  if (!start) return null;
  const end = parts[1] ? toKey(parts[1]) : null;
  return { start, end: end && end !== start ? end : null };
}

/** パスワード・暗証番号らしい列名か(既定で取り込まない)。 */
export function looksSecret(name) {
  return /pass|パスワード|暗証|pin\b/i.test(String(name || ''));
}

/** 1列ぶんの値から、いちばん合う種類を推測する。空欄は判定に使わない。 */
export function inferType(values) {
  const filled = values.map(value => String(value || '').trim()).filter(Boolean);
  if (!filled.length) return 'text';
  /** 空欄以外の値のうち、条件に合うものの割合(0〜1)。 */
  const share = test =>filled.filter(test).length / filled.length;
  if (share(value => /^https?:\/\//i.test(value)) >= 0.6) return 'url';
  if (share(value => /^(yes|no|true|false|はい|いいえ)$/i.test(value)) === 1) return 'checkbox';
  if (share(value => !!parseDateValue(value)) === 1) return 'date';
  if (share(value => /^-?\d+(\.\d+)?$/.test(value)) === 1 && filled.every(value => value.length < 8)) return 'number';
  return 'text';
}

/** 文字のCSV値を、種類に合った保存用の値にする。 */
export function convertValue(type, raw) {
  // タグは「あるある, 来世ハック」のようなカンマ区切り(Notionの書き出しの形)を、重複なしの配列にする。
  if (type === 'multi_select') {
    const parts = Array.isArray(raw) ? raw : String(raw ?? '').split(/[,、]/);
    return [...new Set(parts.map(part => String(part).trim()).filter(Boolean))];
  }
  const value = String(raw ?? '').trim();
  if (type === 'checkbox') return /^(yes|true|はい|1)$/i.test(value);
  if (type === 'number') return value === '' ? null : Number(value);
  if (type === 'date') return parseDateValue(value);
  return value;
}

/**
 * CSVの見出しと行から、取り込みの下書き(列の一覧と推測した種類)を作る。
 * 1列目は名前として必ず使う。include=false の列は取り込まない(画面で変更できる)。
 */
export function planCsvImport(table) {
  const [headers = [], ...rows] = table;
  const columns = headers.map((name, index) => ({
    index,
    name: String(name || '').trim() || `列${index + 1}`,
    type: index === 0 ? 'title' : inferType(rows.map(row => row[index])),
    include: index === 0 || !looksSecret(name),
    secret: index !== 0 && looksSecret(name),
  }));
  return { columns, rows };
}

/** 表示用に値を文字へ戻す(表の中身・検索に使う)。 */
export function formatValue(type, value) {
  if (value === null || value === undefined || value === '') return '';
  if (type === 'checkbox') return value ? '✓' : '';
  if (type === 'date') return value?.start ? `${String(value.start).slice(0, 10)}${value.end ? ` → ${value.end}` : ''}` : '';
  if (type === 'tags' || type === 'multi_select') return Array.isArray(value) ? value.join(', ') : '';
  return String(value);
}

// ---- ビュー(絞り込み・並べ替え・一覧に出す列の組み合わせ) ----
//
// メモ欄の「メモ」も「就活」も同じデータベースとして扱い、どちらにもビューを保存できる。
// 行は { id, title, values } の形。名前は列ID「__title」として、ほかの列と同じに絞り込み・並べ替えできる。
// 「メモ」には決まった列(1行目・タグ・更新日)だけがあり、値はメモ本体から作る(__first / __tags / __updated)。
// 「メモ」は文章を書く場所なので自分の列は足さない。列が欲しくなったものはデータベースへ移す。

export const TITLE_PROPERTY = Object.freeze({ id: '__title', name: '名前', type: 'text' });
export const MEMO_BUILTIN_PROPERTIES = Object.freeze([
  { id: '__first', name: '1行目', type: 'text' },
  { id: '__tags', name: 'タグ', type: 'tags' },
  { id: '__updated', name: '更新日', type: 'date' },
]);

/** 絞り込み・並べ替えに使える列の一覧。「メモ」は名前と決まった列、データベースは名前と自分で作った列。 */
export function viewProperties(space) {
  return [TITLE_PROPERTY, ...(space?.kind === 'memos' ? MEMO_BUILTIN_PROPERTIES : space?.properties || [])];
}

/** ビューが1つも保存されていない時に使う「すべて」。メモは更新の新しい順、データベースは並び順のまま。 */
export function defaultView(space) {
  return { id: 'all', name: 'すべて', filters: [], sort: space?.kind === 'memos' ? { prop: '__updated', dir: 'desc' } : null, columns: [], layout: 'table' };
}

/** 保存済みのビュー(なければ「すべて」1つ)を返す。 */
export function spaceViews(space) {
  return space?.views?.length ? space.views : [defaultView(space)];
}

/** 行の、ある列の値。名前だけは行の title から読む。 */
const cellValue = (row, propId) => (propId === TITLE_PROPERTY.id ? row.title : row.values?.[propId]);

/** 比べやすい形(全角半角・大文字小文字をそろえた文字)にする。 */
const fold = value => String(value ?? '').normalize('NFKC').toLowerCase();

/**
 * 1つの絞り込み条件に行が合うか。条件の形は列の種類で決まる:
 * 文字・URL・数値は「含む」、タグは「このタグがある」、チェックは「付いている/いない」、
 * 日付は「from〜to の間」(片方だけでもよい)。値が空の条件は「条件なし」として通す。
 */
export function rowPassesFilter(row, filter, prop) {
  if (!prop) return true;
  const value = cellValue(row, prop.id);
  const wanted = filter.value;
  if (prop.type === 'checkbox') return wanted === undefined || wanted === '' || !!value === (wanted === true || wanted === 'true');
  if (prop.type === 'tags' || prop.type === 'multi_select') return !wanted || (Array.isArray(value) && value.includes(wanted));
  if (prop.type === 'date') {
    const { from = '', to = '' } = wanted || {};
    if (!from && !to) return true;
    const day = String(value?.start || '').slice(0, 10);
    return !!day && (!from || day >= from) && (!to || day <= to);
  }
  return !wanted || fold(formatValue(prop.type, value)).includes(fold(wanted));
}

/** 並べ替え用に、列の値を比べられる形(数値・文字)にする。空は null。 */
function sortKey(row, prop) {
  const value = cellValue(row, prop.id);
  if (prop.type === 'number') return Number.isFinite(value) ? value : null;
  if (prop.type === 'checkbox') return value ? 1 : 0;
  if (prop.type === 'date') return value?.start || null;
  const text = formatValue(prop.type, value);
  return text === '' ? null : text;
}

/**
 * 行の一覧にビューを当てる(絞り込み → 並べ替え)。並べ替えなしなら元の順のまま。
 * 空の値は、昇順・降順どちらでも最後に回す(未入力の行が先頭を埋めないように)。
 */
export function applyView(rows, view, properties) {
  const byId = new Map(properties.map(prop => [prop.id, prop]));
  const kept = rows.filter(row => (view?.filters || []).every(filter => rowPassesFilter(row, filter, byId.get(filter.prop))));
  const prop = byId.get(view?.sort?.prop);
  if (!prop) return kept;
  const direction = view.sort.dir === 'desc' ? -1 : 1;
  return kept
    .map(row => ({ row, key: sortKey(row, prop) }))
    .sort((left, right) => {
      if (left.key === null || right.key === null) return (left.key === null) - (right.key === null);
      if (typeof left.key === 'number' && typeof right.key === 'number') return (left.key - right.key) * direction;
      return String(left.key).localeCompare(String(right.key), 'ja') * direction;
    })
    .map(item => item.row);
}

/**
 * ほかのデータベースへ移す時に、値を引き継ぐ。名前と種類が同じ列の値だけ持っていく
 * (違う意味の列に値が紛れ込まないように)。
 */
export function carryValues(values, fromProperties, toProperties) {
  const target = new Map(toProperties.map(prop => [`${prop.name}\u0000${prop.type}`, prop.id]));
  return Object.fromEntries(fromProperties
    .map(prop => [target.get(`${prop.name}\u0000${prop.type}`), values?.[prop.id]])
    .filter(([id, value]) => id && value !== undefined && value !== null && value !== ''));
}

/** 名前と全列の文字に、検索語(大文字小文字・全角半角を無視)が含まれるか。 */
export function rowMatches(row, properties, query) {
  const q = String(query || '').normalize('NFKC').toLowerCase().trim();
  if (!q) return true;
  const text = [row.title, ...properties.map(prop => formatValue(prop.type, row.values?.[prop.id]))].join(' ');
  return text.normalize('NFKC').toLowerCase().includes(q);
}
