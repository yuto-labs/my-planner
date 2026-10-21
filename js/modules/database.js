// ============================================================
// database.js - Notion風データベースの画面
//
// データベースは「メモ一覧に並ぶ1件」で、開くとスマホはカード、PCは表で中身を見せる。
// 各行はいつものメモ(ページ)で、行の値はページ上部の欄やPCの表で直す。
// 「編集」で名前と列(追加・名前・種類・並び・削除)を変えられる。
// ============================================================
import {
  addDatabaseRow, createDatabase, deleteDatabase, deleteKnowledgeMemo, findDatabaseForRow, getDatabase,
  getKnowledgeMemos, saveDatabase, updateDatabaseRow, updateKnowledgeMemo,
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

// ---- メモ一覧との接続 ----

/** メモ一覧に並べるデータベースのカード。開くと中身(カード/表)を見せる。 */
export function renderDatabaseListCard(db) {
  return `
    <div class="kn-memo-card db-memo-card" data-db-id="${esc(db.id)}" role="group" tabindex="0" aria-label="${esc(db.name)}を開く">
      <div class="kn-memo-card-top">
        <div class="kn-memo-heading">
          <span class="kn-memo-title"><span class="db-memo-icon" aria-hidden="true">▦</span>${esc(db.name)}</span>
        </div>
        <span class="kn-memo-date">${db.order.length}件</span>
        <button class="kn-star-btn${db.starred ? ' starred' : ''}" data-star-db="${esc(db.id)}" aria-label="${db.starred ? 'ピン留めを外す' : 'ピン留め'}">${db.starred ? '★' : '☆'}</button>
      </div>
      <div class="kn-memo-card-sub"><div class="kn-memo-preview">データベース・${esc(db.properties.map(prop => prop.name).join('・') || '列なし')}</div></div>
    </div>`;
}

/** データベースのピン留めを切り替える(メモの星と同じ扱いで一覧の上に出る)。 */
export function toggleDatabaseStar(id) {
  const db = getDatabase(id);
  return db ? saveDatabase({ ...db, starred: !db.starred }) : false;
}

/** 空のデータベース(「URL」「ID」の2列)を作って開く。メモの「新規」から呼ぶ。 */
export function createEmptyDatabase() {
  const db = createDatabase({
    name: '新しいデータベース',
    properties: [{ id: generateId(), name: 'URL', type: 'url' }, { id: generateId(), name: 'ID', type: 'text' }],
  });
  if (db) openDatabase(db.id);
}

/** CSVファイルを選んでもらい、取り込み画面を開く。メモの「新規」から呼ぶ。 */
export function startCsvImport() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv,text/csv';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (file) openImportSheet(file.name, await file.text());
  });
  input.click();
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
 * スマホの一覧。普通のデータベースのように1行1件で「名前」と主な列を1つ並べる。
 * 主な列は、URL以外で最初の列(就活ならID)。全部の項目は行をタップした詳細ページで見る。
 */
function renderList(db, rows) {
  const main = db.properties.find(prop => prop.type !== 'url');
  return `
    <div class="db-list">
      <div class="db-list-head"><span>名前</span><span>${esc(main?.name || '')}</span></div>
      ${rows.map(row => `
        <div class="db-list-row" data-row-open="${esc(row.id)}" role="button" tabindex="0">
          <span class="db-list-title">${esc(row.title)}</span>
          <span class="db-list-value">${main ? esc(formatValue(main.type, row.values[main.id])) : ''}</span>
        </div>`).join('')}
    </div>`;
}

/** 種類に合った入力欄を1つ作る(表のセルと、行のページの欄で共用)。 */
function propertyInput(prop, value, rowId = '') {
  const attrs = `data-prop="${esc(prop.id)}" data-prop-type="${prop.type}"${rowId ? ` data-row="${esc(rowId)}"` : ''} aria-label="${esc(prop.name)}"`;
  if (prop.type === 'checkbox') return `<input type="checkbox" ${attrs}${value ? ' checked' : ''}>`;
  if (prop.type === 'number') return `<input class="input" type="number" ${attrs} value="${value ?? ''}">`;
  if (prop.type === 'date') return `<input class="input" type="date" ${attrs} value="${esc(value?.start || '')}">`;
  return `<input class="input" ${attrs} value="${esc(value || '')}"${prop.type === 'url' ? ' inputmode="url"' : ''}>`;
}

/** 入力欄の今の値を、列の種類に合った保存用の値にする。 */
function inputValue(input) {
  const type = input.dataset.propType;
  if (type === 'checkbox') return input.checked;
  if (type === 'date') return input.value ? { start: input.value, end: null } : null;
  return convertValue(type, input.value);
}

/** PCの表。ページを開かずにセルを直接書き換えられる。名前の横の↗でページを開く。 */
function renderTable(db, rows) {
  return `
    <div class="db-table-wrap">
      <table class="db-table">
        <thead><tr><th>名前</th>${db.properties.map(prop => `<th>${esc(prop.name)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(row => `
          <tr>
            <td class="db-table-title">
              <input class="input" data-title-row="${esc(row.id)}" value="${esc(row.title)}" aria-label="名前">
              <button class="db-open-page" type="button" data-row-open="${esc(row.id)}" aria-label="ページを開く">↗</button>
              <button class="db-open-page db-delete" type="button" data-row-delete="${esc(row.id)}" aria-label="この行を削除">削除</button>
            </td>
            ${db.properties.map(prop => `<td>${propertyInput(prop, row.values[prop.id], row.id)}</td>`).join('')}
          </tr>`).join('')}</tbody>
      </table>
    </div>`;
}

/** 1つのデータベースを、検索欄つきで表(PC)またはカード(スマホ)として描く。 */
export function initDatabase(container) {
  const db = currentDbId ? getDatabase(currentDbId) : null;
  if (!db) { nav('memo'); return; }
  const titleEl = document.getElementById('page-title');
  if (titleEl) titleEl.textContent = db.name;

  /** 検索語で絞り込んだ結果だけを描き直す(検索欄は作り直さないので入力が途切れない)。 */
  const renderBody = () => {
    const fresh = getDatabase(db.id) || db;
    const rows = collectRows(fresh).filter(row => rowMatches(row, fresh.properties, searchQuery));
    container.querySelector('#db-body').innerHTML = rows.length
      ? (wideScreen() ? renderTable(fresh, rows) : renderList(fresh, rows))
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
        <button class="btn btn-ghost btn-sm" id="db-edit" type="button">編集（名前・列）</button>
        <button class="btn btn-ghost btn-sm db-delete" id="db-delete-db" type="button" aria-label="データベースを削除">削除</button>
      </div>
      <div id="db-body"></div>
    </div>`;
  renderBody();

  container.querySelector('#db-search').addEventListener('input', event => { searchQuery = event.target.value; renderBody(); });
  container.querySelector('#db-add-row').addEventListener('click', () => {
    const id = addDatabaseRow(db.id, '新しい項目');
    if (id) openRow(db.id, id);
  });
  container.querySelector('#db-edit').addEventListener('click', () => openSchemaEditor(db.id, () => initDatabase(container)));
  container.querySelector('#db-delete-db').addEventListener('click', () => confirmDeleteDatabase(db));

  const body = container.querySelector('#db-body');
  // カード・表の行を押したらページを開く。リンク・コピー・入力欄は、押してもページを開かない。
  body.addEventListener('click', event => {
    if (event.target.closest('[data-link]')) return;
    const copy = event.target.closest('[data-copy]');
    if (copy) {
      navigator.clipboard?.writeText(copy.dataset.copy).then(() => toast('コピーしました', 'success')).catch(() => {});
      return;
    }
    if (event.target.closest('input')) return;
    // PCの表の「削除」: その行のページをごみ箱へ移す(ごみ箱から戻すと行も戻る)。
    const remove = event.target.closest('[data-row-delete]');
    if (remove) {
      const memoId = remove.dataset.rowDelete;
      const title = getKnowledgeMemos().find(memo => memo.id === memoId)?.title || 'この行';
      if (!window.confirm(`「${title}」を削除しますか？ ごみ箱から戻せます。`)) return;
      if (deleteKnowledgeMemo(memoId)) { toast('ごみ箱へ移しました', 'success'); renderBody(); }
      return;
    }
    const row = event.target.closest('[data-row-open]');
    if (row) openRow(db.id, row.dataset.rowOpen);
  });
  // PCの表で書き換えたセルは、入力し終えた時点で保存する。名前はメモの題名として保存する。
  body.addEventListener('change', event => {
    const titleInput = event.target.closest('[data-title-row]');
    if (titleInput) { updateKnowledgeMemo(titleInput.dataset.titleRow, { title: titleInput.value.trim() || '無題' }); return; }
    const input = event.target.closest('[data-prop][data-row]');
    if (input) updateDatabaseRow(db.id, input.dataset.row, { [input.dataset.prop]: inputValue(input) });
  });
}

/**
 * 名前と列を編集する画面。列は名前・種類を変えたり、↑↓で並べ替えたり、削除したりできる。
 * 種類を変えた列は、入っている値も新しい種類へ変換する(例: 文字→日付で「2026年8月24日」を日付に)。
 */
function openSchemaEditor(dbId, onSaved) {
  const db = getDatabase(dbId);
  if (!db) return;
  let columns = db.properties.map(prop => ({ ...prop }));
  const body = document.createElement('div');
  body.className = 'db-import';

  /** 列の一覧を、今の編集中の状態で描き直す。 */
  const render = () => {
    body.innerHTML = `
      <label class="form-label">データベースの名前</label>
      <input class="input" id="db-edit-name" value="${esc(body.querySelector('#db-edit-name')?.value ?? db.name)}">
      <label class="form-label">列（1列目の「名前」は各ページの題名です）</label>
      ${columns.map((column, index) => `
        <div class="db-schema-col" data-col="${index}">
          <input class="input" data-col-name value="${esc(column.name)}" aria-label="列の名前">
          <select class="select" data-col-type aria-label="列の種類">
            ${PROPERTY_TYPES.map(type => `<option value="${type}"${type === column.type ? ' selected' : ''}>${PROPERTY_TYPE_LABELS[type]}</option>`).join('')}
          </select>
          <button class="btn btn-ghost btn-sm" type="button" data-col-move="-1" aria-label="上へ"${index === 0 ? ' disabled' : ''}>↑</button>
          <button class="btn btn-ghost btn-sm" type="button" data-col-move="1" aria-label="下へ"${index === columns.length - 1 ? ' disabled' : ''}>↓</button>
          <button class="btn btn-ghost btn-sm db-delete" type="button" data-col-remove aria-label="列を削除">削除</button>
        </div>`).join('')}
      <button class="btn btn-ghost btn-sm" id="db-col-add" type="button">＋ 列を追加</button>
      <div class="db-schema-footer">
        <button class="btn btn-ghost btn-sm db-delete" id="db-delete" type="button">データベースを削除</button>
        <button class="btn btn-primary" id="db-edit-save" type="button">保存</button>
      </div>`;
  };
  /** 入力中の列名・種類を columns へ取り込む(並べ替え・追加の前に呼ぶ)。 */
  const collect = () => {
    body.querySelectorAll('[data-col]').forEach(row => {
      const column = columns[Number(row.dataset.col)];
      column.name = row.querySelector('[data-col-name]').value.trim() || column.name;
      column.type = row.querySelector('[data-col-type]').value;
    });
  };
  render();
  const close = window.AppNav.openModal({ title: 'データベースの編集', body, autoFocus: false });

  body.addEventListener('click', event => {
    const row = event.target.closest('[data-col]');
    if (event.target.closest('[data-col-move]') && row) {
      collect();
      const from = Number(row.dataset.col);
      const to = from + Number(event.target.closest('[data-col-move]').dataset.colMove);
      [columns[from], columns[to]] = [columns[to], columns[from]];
      render();
    } else if (event.target.closest('[data-col-remove]') && row) {
      collect();
      const column = columns[Number(row.dataset.col)];
      if (!window.confirm(`列「${column.name}」を削除しますか？ この列の値も消えます。`)) return;
      columns.splice(Number(row.dataset.col), 1);
      render();
    } else if (event.target.closest('#db-col-add')) {
      collect();
      columns.push({ id: generateId(), name: `列${columns.length + 1}`, type: 'text' });
      render();
    } else if (event.target.closest('#db-delete')) {
      close?.();
      confirmDeleteDatabase(db);
    } else if (event.target.closest('#db-edit-save')) {
      collect();
      const before = new Map(db.properties.map(prop => [prop.id, prop]));
      const kept = new Set(columns.map(column => column.id));
      // 種類を変えた列は値を変換し、削除した列の値は行から取り除く。
      const rows = Object.fromEntries(Object.entries(db.rows).map(([rowId, values]) => [rowId, Object.fromEntries(
        Object.entries(values).filter(([propId]) => kept.has(propId)).map(([propId, value]) => {
          const old = before.get(propId);
          const next = columns.find(column => column.id === propId);
          return [propId, old && next && old.type !== next.type ? convertValue(next.type, formatValue(old.type, value)) : value];
        }),
      )]));
      saveDatabase({ ...db, name: body.querySelector('#db-edit-name').value.trim() || db.name, properties: columns, rows });
      close?.();
      toast('保存しました', 'success');
      onSaved?.();
    }
  });
}

/**
 * データベースを消す前の確認。行のページも一緒に消すか、普通のメモとして残すかを選べる。
 * 一緒に消す場合もごみ箱へ移すだけなので、ごみ箱から戻せる。
 */
function confirmDeleteDatabase(db) {
  const body = document.createElement('div');
  body.className = 'db-import';
  body.innerHTML = `
    <p class="db-import-note">「${esc(db.name)}」を削除します。中の${db.order.length}件のページをどうしますか？</p>
    <button class="btn btn-danger" type="button" data-delete-mode="with-pages">ページも一緒に削除（ごみ箱から戻せます）</button>
    <button class="btn btn-ghost" type="button" data-delete-mode="keep-pages">ページは普通のメモとして残す</button>`;
  const close = window.AppNav.openModal({ title: 'データベースを削除', body, autoFocus: false });
  body.addEventListener('click', event => {
    const mode = event.target.closest('[data-delete-mode]')?.dataset.deleteMode;
    if (!mode) return;
    if (mode === 'with-pages') db.order.forEach(memoId => deleteKnowledgeMemo(memoId));
    deleteDatabase(db.id);
    close?.();
    toast('データベースを削除しました', 'success');
    nav('memo');
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
    if (input) updateDatabaseRow(db.id, memoId, { [input.dataset.prop]: inputValue(input) });
  });
  panel.addEventListener('click', event => {
    const copy = event.target.closest('[data-copy]');
    if (copy) navigator.clipboard?.writeText(copy.dataset.copy).then(() => toast('コピーしました', 'success')).catch(() => {});
  });
}
