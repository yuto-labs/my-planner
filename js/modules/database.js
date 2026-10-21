// ============================================================
// database.js - Notion風データベースの画面
//
// 一覧(databases) → 1つのデータベース(database) → 行のページ(いつものメモ画面)の3段。
// スマホは1行1枚のカード(名前・リンクのボタン・コピーできる文字)、PCは表で見せる。
// 行の値は、行のページの上に出す欄(renderDatabaseRowPanel)で直す。
// ============================================================
import {
  addDatabaseRow, createDatabase, deleteDatabase, findDatabaseForRow, getDatabase, getDatabases,
  getKnowledgeMemos, updateDatabaseRow,
} from '../storage.js';
import {
  PROPERTY_TYPE_LABELS, PROPERTY_TYPES, convertValue, formatValue, parseCsv, planCsvImport, rowMatches,
} from '../database-model.js';
import { esc, generateId } from '../utils.js';
import { openKnowledgeMemo } from './memo.js';

/** `toast`: 短い通知メッセージを画面へ表示する。 */
const toast = (message, type = 'info') => window.AppNav?.showToast(message, type);
/** `nav`: 指定した画面へ移動する。 */
const nav = view => window.AppNav?.navigate(view);

let currentDbId = null;
let searchQuery = '';
// 行のページから戻る時に、開いていたデータベースへ戻すための印。
let returnDbId = null;

/** PCの幅なら表、スマホならカードで見せる。 */
const wideScreen = () => window.matchMedia?.('(min-width: 768px)')?.matches;

// ---- 一覧画面 ----

/** データベースの一覧と、CSVの取り込み・新規作成の入口を描く。 */
export function initDatabases(container) {
  const databases = getDatabases();
  container.innerHTML = `
    <div class="db-page">
      <div class="db-actions">
        <label class="btn btn-primary btn-sm db-import-btn">CSVを取り込む
          <input type="file" accept=".csv,text/csv" id="db-csv-input" hidden>
        </label>
        <button class="btn btn-ghost btn-sm" id="db-new-btn" type="button">空のデータベース</button>
      </div>
      ${databases.length ? databases.map(db => `
        <button class="db-list-item" type="button" data-db-open="${esc(db.id)}">
          <strong>${esc(db.name)}</strong>
          <span>${db.order.length}件</span>
        </button>`).join('') : `
        <div class="empty-state">
          <div class="empty-state-text">データベースはまだありません</div>
          <div class="empty-state-sub">NotionやExcelから書き出したCSVを取り込めます</div>
        </div>`}
    </div>`;
  container.querySelectorAll('[data-db-open]').forEach(button => button.addEventListener('click', () => openDatabase(button.dataset.dbOpen)));
  container.querySelector('#db-csv-input')?.addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (file) openImportSheet(file.name, await file.text());
    event.target.value = '';
  });
  container.querySelector('#db-new-btn')?.addEventListener('click', () => {
    // 空のデータベースは「名前・URL・ID」の3列で始める。列は後から増やせる。
    const db = createDatabase({
      name: '新しいデータベース',
      properties: [{ id: generateId(), name: 'URL', type: 'url' }, { id: generateId(), name: 'ID', type: 'text' }],
    });
    if (db) openDatabase(db.id);
  });
}

/** 指定したデータベースを開く。 */
export function openDatabase(id) {
  currentDbId = id;
  searchQuery = '';
  nav('database');
}

/**
 * CSVの取り込み画面。列ごとに「取り込むか」と種類を選べる。
 * パスワードらしい列は最初から外し、理由を表示する(同期で平文のままクラウドへ送られるため)。
 */
function openImportSheet(fileName, text) {
  const table = parseCsv(text);
  if (table.length < 2) { toast('CSVに行がありません', 'error'); return; }
  const plan = planCsvImport(table);
  const body = document.createElement('div');
  body.className = 'db-import';
  // Notionの書き出しはファイル名の後ろに長い英数字が付くので外す。
  const defaultName = fileName.replace(/\.csv$/i, '').replace(/\s+[0-9a-f]{32}(_all)?$/i, '');
  body.innerHTML = `
    <label class="form-label">名前</label>
    <input class="input" id="db-import-name" value="${esc(defaultName)}">
    <p class="db-import-note">${plan.rows.length}行。1列目「${esc(plan.columns[0].name)}」を各行の名前にします。</p>
    ${plan.columns.slice(1).map(column => `
      <div class="db-import-col">
        <label><input type="checkbox" data-col-include="${column.index}"${column.include ? ' checked' : ''}> ${esc(column.name)}</label>
        <select class="select" data-col-type="${column.index}">
          ${PROPERTY_TYPES.map(type => `<option value="${type}"${type === column.type ? ' selected' : ''}>${PROPERTY_TYPE_LABELS[type]}</option>`).join('')}
        </select>
        ${column.secret ? '<p class="db-import-warning">パスワードらしい列です。同期でそのままの文字がクラウドに送られるため、既定では取り込みません。iPhoneの「パスワード」アプリでの管理がおすすめです。</p>' : ''}
      </div>`).join('')}
    <button class="btn btn-primary" id="db-import-run" type="button">取り込む</button>`;
  const close = window.AppNav.openModal({ title: 'CSVの取り込み', body, autoFocus: false });
  body.querySelector('#db-import-run').addEventListener('click', () => {
    const chosen = plan.columns.slice(1)
      .filter(column => body.querySelector(`[data-col-include="${column.index}"]`)?.checked)
      .map(column => ({ ...column, type: body.querySelector(`[data-col-type="${column.index}"]`)?.value || column.type, id: generateId() }));
    const db = createDatabase({
      name: body.querySelector('#db-import-name').value,
      properties: chosen.map(({ id, name, type }) => ({ id, name, type })),
      rows: plan.rows.map(row => ({
        title: row[0],
        values: Object.fromEntries(chosen.map(column => [column.id, convertValue(column.type, row[column.index])])),
      })),
    });
    close?.();
    if (!db) { toast('取り込めませんでした', 'error'); return; }
    toast(`${db.order.length}行を取り込みました`, 'success');
    openDatabase(db.id);
  });
}

// ---- 1つのデータベース ----

/** 行(ページ)を、並び順どおりに名前と値つきで集める。消えたメモは飛ばす。 */
function collectRows(db) {
  // メモ一覧は1回だけ読む(行ごとに読むと、全メモの読み込みが行数ぶん起きて遅い)。
  const memos = new Map(getKnowledgeMemos().map(memo => [memo.id, memo]));
  return db.order
    .map(id => ({ id, memo: memos.get(id) }))
    .filter(row => row.memo)
    .map(({ id, memo }) => ({ id, title: memo.title || '無題', values: db.rows[id] || {} }));
}

/**
 * カード1枚。1行目に名前とリンクのボタン、その下に文字の列(コピーできる)を並べる。
 * 会社が多くても1画面に多く収まるよう、縦に詰めた2段構成にしている。
 */
function renderCard(db, row) {
  const urls = db.properties.filter(prop => prop.type === 'url' && row.values[prop.id]);
  const texts = db.properties.filter(prop => prop.type !== 'url' && formatValue(prop.type, row.values[prop.id]));
  return `
    <div class="db-card" data-row-open="${esc(row.id)}" role="button" tabindex="0">
      <div class="db-card-head">
        <strong class="db-card-title">${esc(row.title)}</strong>
        ${urls.map(prop => `<a class="btn btn-ghost btn-sm" href="${esc(row.values[prop.id])}" target="_blank" rel="noopener noreferrer" data-link>${esc(prop.name === 'URL' ? 'マイページ' : prop.name)} ↗</a>`).join('')}
      </div>
      ${texts.map(prop => `
        <div class="db-card-field">
          <span class="db-card-label">${esc(prop.name)}</span>
          <span class="db-card-value">${esc(formatValue(prop.type, row.values[prop.id]))}</span>
          ${prop.type === 'text' ? `<button class="db-copy" type="button" data-copy="${esc(row.values[prop.id])}" aria-label="${esc(prop.name)}をコピー">コピー</button>` : ''}
        </div>`).join('')}
    </div>`;
}

/** PCの表。名前を押すと行のページが開く。 */
function renderTable(db, rows) {
  return `
    <div class="db-table-wrap">
      <table class="db-table">
        <thead><tr><th>名前</th>${db.properties.map(prop => `<th>${esc(prop.name)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(row => `
          <tr data-row-open="${esc(row.id)}">
            <td class="db-table-title">${esc(row.title)}</td>
            ${db.properties.map(prop => {
              const value = row.values[prop.id];
              if (prop.type === 'url' && value) return `<td><a href="${esc(value)}" target="_blank" rel="noopener noreferrer" data-link>開く ↗</a></td>`;
              return `<td>${esc(formatValue(prop.type, value))}</td>`;
            }).join('')}
          </tr>`).join('')}</tbody>
      </table>
    </div>`;
}

/** 1つのデータベースを、検索欄つきで表(PC)またはカード(スマホ)として描く。 */
export function initDatabase(container) {
  const db = currentDbId ? getDatabase(currentDbId) : null;
  if (!db) { nav('databases'); return; }
  const titleEl = document.getElementById('page-title');
  if (titleEl) titleEl.textContent = db.name;

  /** 検索語で絞り込んだ結果だけを描き直す(検索欄は作り直さないので入力が途切れない)。 */
  const renderBody = () => {
    const rows = collectRows(db).filter(row => rowMatches(row, db.properties, searchQuery));
    const body = container.querySelector('#db-body');
    body.innerHTML = rows.length
      ? (wideScreen() ? renderTable(db, rows) : `<div class="db-cards">${rows.map(row => renderCard(db, row)).join('')}</div>`)
      : '<div class="empty-state"><div class="empty-state-text">該当なし</div></div>';
    container.querySelector('#db-count').textContent = `${rows.length}件`;
  };

  container.innerHTML = `
    <div class="db-page">
      <div class="db-toolbar">
        <input class="input" id="db-search" type="search" placeholder="名前やIDで検索" value="${esc(searchQuery)}">
        <span class="db-count" id="db-count"></span>
      </div>
      <div class="db-actions">
        <button class="btn btn-primary btn-sm" id="db-add-row" type="button">＋ 追加</button>
        <button class="btn btn-ghost btn-sm db-delete" id="db-delete" type="button">データベースを削除</button>
      </div>
      <div id="db-body"></div>
    </div>`;
  renderBody();

  container.querySelector('#db-search').addEventListener('input', event => { searchQuery = event.target.value; renderBody(); });
  container.querySelector('#db-add-row').addEventListener('click', () => {
    const id = addDatabaseRow(db.id, '新しい項目');
    if (id) openRow(db.id, id);
  });
  container.querySelector('#db-delete').addEventListener('click', () => {
    if (!window.confirm(`「${db.name}」を削除しますか？ 各行のページは消えず、普通のメモとして残ります。`)) return;
    deleteDatabase(db.id);
    toast('データベースを削除しました', 'success');
    nav('databases');
  });
  // カード・表の行を押したらページを開く。リンクとコピーのボタンは、押してもページを開かない。
  container.querySelector('#db-body').addEventListener('click', event => {
    if (event.target.closest('[data-link]')) return;
    const copy = event.target.closest('[data-copy]');
    if (copy) {
      navigator.clipboard?.writeText(copy.dataset.copy).then(() => toast('コピーしました', 'success')).catch(() => {});
      return;
    }
    const row = event.target.closest('[data-row-open]');
    if (row) openRow(db.id, row.dataset.rowOpen);
  });
}

/** 行のページ(メモ画面)を開き、戻った時にこのデータベースへ戻れるよう覚えておく。 */
function openRow(dbId, memoId) {
  returnDbId = dbId;
  openKnowledgeMemo(memoId);
}

/** メモ画面の「戻る」で、データベースから開いたページならデータベースへ戻す。戻したらtrue。 */
export function returnToDatabaseFromRow(memoId) {
  if (!returnDbId || !findDatabaseForRow(memoId)) return false;
  currentDbId = returnDbId;
  returnDbId = null;
  nav('database');
  return true;
}

// ---- 行のページの上に出す欄 ----

/** 種類に合った入力欄を1つ作る。 */
function propertyInput(prop, value) {
  const attrs = `data-prop="${esc(prop.id)}" data-prop-type="${prop.type}"`;
  if (prop.type === 'checkbox') return `<input type="checkbox" ${attrs}${value ? ' checked' : ''}>`;
  if (prop.type === 'number') return `<input class="input" type="number" ${attrs} value="${value ?? ''}">`;
  if (prop.type === 'date') return `<input class="input" type="date" ${attrs} value="${esc(value?.start || '')}">`;
  return `<input class="input" ${attrs} value="${esc(value || '')}"${prop.type === 'url' ? ' inputmode="url"' : ''}>`;
}

/**
 * メモがデータベースの行なら、閲覧画面の上に「列の値」の欄を出す。値は入力し終えた時点で保存する。
 * URLは開くボタン、文字はコピーボタンを横に付ける。
 */
export function renderDatabaseRowPanel(container, memoId) {
  const found = memoId ? findDatabaseForRow(memoId) : null;
  const page = container.querySelector('.kn-view-page');
  if (!found || !page || !found.db.properties.length) return;
  const { db, values } = found;
  const panel = document.createElement('div');
  panel.className = 'db-row-panel';
  panel.innerHTML = `
    <p class="db-row-panel-db">${esc(db.name)}</p>
    ${db.properties.map(prop => `
      <div class="db-row-field">
        <label class="db-card-label">${esc(prop.name)}</label>
        ${propertyInput(prop, values[prop.id])}
        ${prop.type === 'url' && values[prop.id] ? `<a class="btn btn-ghost btn-sm" href="${esc(values[prop.id])}" target="_blank" rel="noopener noreferrer">開く ↗</a>` : ''}
        ${prop.type === 'text' && values[prop.id] ? `<button class="db-copy" type="button" data-copy="${esc(values[prop.id])}">コピー</button>` : ''}
      </div>`).join('')}`;
  page.prepend(panel);
  panel.addEventListener('change', event => {
    const input = event.target.closest('[data-prop]');
    if (!input) return;
    const type = input.dataset.propType;
    const value = type === 'checkbox' ? input.checked
      : type === 'date' ? (input.value ? { start: input.value, end: null } : null)
        : convertValue(type, input.value);
    updateDatabaseRow(db.id, memoId, { [input.dataset.prop]: value });
  });
  panel.addEventListener('click', event => {
    const copy = event.target.closest('[data-copy]');
    if (copy) navigator.clipboard?.writeText(copy.dataset.copy).then(() => toast('コピーしました', 'success')).catch(() => {});
  });
}
