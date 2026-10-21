// ============================================================
// database-model.js - Notion風データベースの、画面に触れない処理
//
// CSV(NotionのエクスポートやExcel)を読み、列ごとに「URL・チェック・日付・数値・文字」の
// どれかを中身から推測する。1列目は名前(各行のページの題名)として扱う。
// パスワードらしい列は、同期で平文のままクラウドへ送られるため既定では取り込まない。
// ============================================================

export const PROPERTY_TYPES = Object.freeze(['text', 'url', 'number', 'checkbox', 'date']);
export const PROPERTY_TYPE_LABELS = Object.freeze({ text: '文字', url: 'URL', number: '数値', checkbox: 'チェック', date: '日付' });

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
  if (type === 'date') return value?.start ? `${value.start}${value.end ? ` → ${value.end}` : ''}` : '';
  return String(value);
}

/** 名前と全列の文字に、検索語(大文字小文字・全角半角を無視)が含まれるか。 */
export function rowMatches(row, properties, query) {
  const q = String(query || '').normalize('NFKC').toLowerCase().trim();
  if (!q) return true;
  const text = [row.title, ...properties.map(prop => formatValue(prop.type, row.values?.[prop.id]))].join(' ');
  return text.normalize('NFKC').toLowerCase().includes(q);
}
