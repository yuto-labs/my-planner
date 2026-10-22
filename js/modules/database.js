// ============================================================
// database.js - メモ欄の「データベース」まわりの画面
//
// メモ欄は「データベースの集まり」。いちばん上のチップで「メモ」(普通のメモ)と、
// 自分で作ったデータベース(就活など)を切り替える。どれにも「ビュー」(絞り込み・並べ替え・
// 一覧に出す列の組み合わせ)を保存でき、チップの下のタブで切り替える。
// 各行はいつものメモ(ページ)で、行の値はページ上部の欄やPCの表で直す。
// ============================================================
import {
  addDatabaseRow, createDatabase, deleteDatabase, deleteKnowledgeMemo, findDatabaseForRow, getDatabase, getDatabases,
  getKnowledgeMemos, getMemoSpace, moveMemoToSpace, saveDatabase, updateDatabaseRow,
} from '../storage.js';
import {
  PROPERTY_TYPE_LABELS, PROPERTY_TYPES, applyView, carryValues, convertValue, formatValue, parseCsv, planCsvImport,
  rowMatches, spaceViews, viewProperties,
} from '../database-model.js';
import { normalizeMemoUrl } from '../memo-model.js';
import { esc, generateId } from '../utils.js';
import { openKnowledgeMemo, refreshMemoSpace } from './memo.js';
import { renderNotionTable, wireNotionTable } from './notion-table.js';

/** `toast`: 短い通知メッセージを画面へ表示する。 */
const toast = (message, type = 'info') => window.AppNav?.showToast(message, type);
/** `nav`: 指定した画面へ移動する。 */
const nav = view => window.AppNav?.navigate(view);

let searchQuery = '';

// ---- 今どのデータベース・どのビューを見ているか ----
// 端末ごとの「前回の続き」なので、同期せずにこの端末(localStorage)にだけ覚える。

export const MEMO_SPACE = 'memos';
const SPACE_KEY = 'mp_memo_space';
const VIEW_KEY = 'mp_space_views';

/** 端末に覚えた値を読む。読めない環境(プライベートモード等)では既定値を返す。 */
function readLocal(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
/** 端末に値を覚える。書けない環境では何もしない(表示は既定に戻るだけ)。 */
function writeLocal(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

/** 今開いている欄のID。「メモ」なら MEMO_SPACE。消えたデータベースを覚えていたら「メモ」に戻す。 */
export function getActiveSpaceId() {
  const id = readLocal(SPACE_KEY, MEMO_SPACE);
  return id === MEMO_SPACE || getDatabases().some(db => db.id === id) ? id : MEMO_SPACE;
}

/** 欄を切り替える(検索語は欄ごとに持ち越さない)。 */
function setActiveSpaceId(id) {
  writeLocal(SPACE_KEY, id);
  searchQuery = '';
}

/** ビューの選択を覚えるキー(「メモ」欄は端末で別々のIDになり得るので固定名にする)。 */
const viewKey = space => (space.kind === 'memos' ? MEMO_SPACE : space.id);

/** その欄で今選んでいるビュー(覚えたものが消えていたら最初のビュー)。 */
export function activeView(space) {
  const views = spaceViews(space);
  return views.find(view => view.id === readLocal(VIEW_KEY, {})[viewKey(space)]) || views[0];
}

/** ビューを選んだことを覚える。 */
function setActiveView(space, viewId) {
  writeLocal(VIEW_KEY, { ...readLocal(VIEW_KEY, {}), [viewKey(space)]: viewId });
}

// ---- メモ欄の上の「チップ」と「ビューのタブ」 ----

/** 欄の切り替えチップ(メモ・各データベース・＋)と、その欄のビューのタブのHTML。 */
export function renderSpaceHeader(space) {
  const activeId = space.kind === 'memos' ? MEMO_SPACE : space.id;
  const current = activeView(space);
  /** チップ1つ。 */
  const chip = (id, label) => `<button class="db-space-chip${id === activeId ? ' active' : ''}" type="button" data-space="${esc(id)}" aria-pressed="${id === activeId}">${esc(label)}</button>`;
  return `
    <div class="db-space-header">
      <div class="db-space-bar" aria-label="メモとデータベースの切り替え">
        ${chip(MEMO_SPACE, 'メモ')}
        ${getDatabases().map(db => chip(db.id, db.name)).join('')}
        <button class="db-space-chip db-space-add" type="button" data-space-add aria-label="データベースを作る">＋</button>
      </div>
      <div class="db-view-tabs" aria-label="ビュー">
        ${spaceViews(space).map(view => `<button class="db-view-tab${view.id === current.id ? ' active' : ''}" type="button" data-view-id="${esc(view.id)}">${esc(view.name)}</button>`).join('')}
        <button class="db-view-tab db-view-add" type="button" data-view-add aria-label="ビューを追加">＋</button>
        <span class="db-view-tools">
          <button class="btn btn-ghost btn-sm" type="button" data-view-edit>ビュー編集</button>
        </span>
      </div>
    </div>`;
}

/** チップとタブを動くようにする。切り替えたらメモ欄を描き直す。 */
export function wireSpaceHeader(container, space) {
  container.querySelector('.db-space-header')?.addEventListener('click', event => {
    const chip = event.target.closest('[data-space]');
    if (chip) { setActiveSpaceId(chip.dataset.space); refreshMemoSpace(); return; }
    if (event.target.closest('[data-space-add]')) { openCreateDatabaseSheet(); return; }
    const tab = event.target.closest('[data-view-id]');
    if (tab) { setActiveView(space, tab.dataset.viewId); refreshMemoSpace(); return; }
    if (event.target.closest('[data-view-add]')) { openViewEditor(space, null); return; }
    if (event.target.closest('[data-view-edit]')) openViewEditor(space, activeView(space).id);
  });
}

/** 「＋」: データベースを「空から作る」か「CSVから取り込む」かを選ぶ。 */
function openCreateDatabaseSheet() {
  const body = document.createElement('div');
  body.className = 'kn-template-grid';
  body.innerHTML = `
    <button class="kn-template-btn" type="button" data-new-db="empty"><span class="kn-template-icon">▦</span><span class="kn-template-label">空のデータベース</span></button>
    <button class="kn-template-btn" type="button" data-new-db="csv"><span class="kn-template-icon">⇪</span><span class="kn-template-label">CSVから取り込む</span></button>`;
  const close = window.AppNav?.openModal({ title: 'データベースを作る', body, autoFocus: false });
  body.addEventListener('click', event => {
    const choice = event.target.closest('[data-new-db]')?.dataset.newDb;
    if (!choice) return;
    close?.();
    if (choice === 'csv') startCsvImport();
    else createEmptyDatabase();
  });
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

/** 指定したデータベースをメモ欄で開く(チップをそのデータベースに切り替える)。 */
export function openDatabase(id) {
  setActiveSpaceId(id);
  if (document.getElementById('main-content')?.dataset.view === 'memo') refreshMemoSpace();
  else nav('memo');
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
 * URLの値を、新しいタブで開くリンクにする。http/https以外(javascript:など)はリンクにしない。
 * data-link があると、一覧の行を押した扱い(ページを開く)にならない。
 */
function openLinkHtml(value, label = '開く ↗') {
  const href = normalizeMemoUrl(value);
  return href ? `<a class="db-open-link" data-link href="${esc(href)}" target="_blank" rel="noopener noreferrer">${label}</a>` : '';
}

/**
 * ビューで「一覧に出す列」に選んだ列(最大2つ)。選んでいなければ、URL以外で最初の列(就活ならID)。
 * URLの列はここに入れず、右端の「開く」リンクで別に出す。
 */
export function listColumns(space, view) {
  const props = space.properties.filter(prop => prop.type !== 'url');
  const chosen = (view?.columns || []).map(id => props.find(prop => prop.id === id)).filter(Boolean);
  return (chosen.length ? chosen : props.slice(0, 1)).slice(0, 2);
}

/**
 * スマホの一覧。普通のデータベースのように1行1件で「名前」と、ビューで選んだ列を並べる。
 * URLの列があれば、右端にそのまま飛べる「開く」を付ける。全部の項目は行をタップした詳細ページで見る。
 */
function renderList(db, rows, view) {
  const columns = listColumns(db, view);
  const link = db.properties.find(prop => prop.type === 'url');
  // 列の数が変わっても見出しと行がそろうよう、列の幅の決まりを1つにまとめて両方に使う。
  const grid = `style="--db-cols: minmax(0, 1fr) ${columns.map(() => 'auto').join(' ')} 3.5em"`;
  return `
    <div class="db-list">
      <div class="db-list-head" ${grid}><span>名前</span>${columns.map(prop => `<span>${esc(prop.name)}</span>`).join('')}<span>${esc(link?.name || '')}</span></div>
      ${rows.map(row => `
        <div class="db-list-row" ${grid} data-row-open="${esc(row.id)}" role="button" tabindex="0">
          <span class="db-list-title">${esc(row.title)}</span>
          ${columns.map(prop => `<span class="db-list-value">${esc(formatValue(prop.type, row.values[prop.id]))}</span>`).join('')}
          <span>${link ? openLinkHtml(row.values[link.id]) : ''}</span>
        </div>`).join('')}
    </div>`;
}

/** 種類に合った入力欄を1つ作る(表のセルと、行のページの欄で共用)。 */
function propertyInput(prop, value, rowId = '') {
  const attrs = `data-prop="${esc(prop.id)}" data-prop-type="${prop.type}"${rowId ? ` data-row="${esc(rowId)}"` : ''} aria-label="${esc(prop.name)}"`;
  if (prop.type === 'checkbox') return `<input type="checkbox" ${attrs}${value ? ' checked' : ''}>`;
  if (prop.type === 'number') return `<input class="input" type="number" ${attrs} value="${value ?? ''}">`;
  if (prop.type === 'date') return `<input class="input" type="date" ${attrs} value="${esc(value?.start || '')}">`;
  // タグはカンマ区切りで入力する(保存する時に配列へ直す)。
  if (prop.type === 'multi_select') return `<input class="input" ${attrs} value="${esc(formatValue(prop.type, value))}" placeholder="タグをカンマ区切りで">`;
  return `<input class="input" ${attrs} value="${esc(value || '')}"${prop.type === 'url' ? ' inputmode="url"' : ''}>`;
}

/** 入力欄の今の値を、列の種類に合った保存用の値にする。 */
function inputValue(input) {
  const type = input.dataset.propType;
  if (type === 'checkbox') return input.checked;
  if (type === 'date') return input.value ? { start: input.value, end: null } : null;
  return convertValue(type, input.value);
}

/**
 * メモ欄で、チップがデータベースを選んでいる時の中身。上にチップとビューのタブ、
 * その下に検索欄と、Notionのような表(または、ビューで選んだ時はリスト)を描く。
 * 行はビューで絞り込み・並べ替えてから出す。
 */
export function mountDatabaseSpace(container, db) {
  /** 検索語で絞り込んだ結果だけを描き直す(検索欄は作り直さないので入力が途切れない)。 */
  const renderBody = () => {
    const fresh = getDatabase(db.id) || db;
    const view = activeView(fresh);
    const rows = applyView(collectRows(fresh), view, viewProperties(fresh))
      .filter(row => rowMatches(row, fresh.properties, searchQuery));
    const target = container.querySelector('#db-body');
    // 書き換えのたびに表を描き直すので、横にスクロールしていた位置を保つ。
    const scrollLeft = target.querySelector('.nt-wrap')?.scrollLeft || 0;
    target.innerHTML = view.layout === 'list'
      ? (rows.length ? renderList(fresh, rows, view) : '<div class="empty-state"><div class="empty-state-text">該当なし</div></div>')
      : renderNotionTable(fresh, rows);
    const wrap = target.querySelector('.nt-wrap');
    if (wrap) wrap.scrollLeft = scrollLeft;
    container.querySelector('#db-count').textContent = `${rows.length}件`;
  };

  container.innerHTML = `
    <div class="db-page" data-space-id="${esc(db.id)}">
      ${renderSpaceHeader(db)}
      <!-- Notionのように控えめな1行: 検索・件数・列の編集・削除。行の追加は表の下の「＋ 新規」(リストの時は「＋」)。 -->
      <div class="db-toolbar">
        <input class="input db-search" id="db-search" type="search" placeholder="検索" value="${esc(searchQuery)}">
        <span class="db-count" id="db-count"></span>
        <button class="db-tool" id="db-add-row" type="button" aria-label="行を追加" title="行を追加">＋</button>
        <button class="db-tool" id="db-edit" type="button">列を編集</button>
        <button class="db-tool db-delete" id="db-delete-db" type="button" aria-label="データベースを削除">削除</button>
      </div>
      <div id="db-body"></div>
    </div>`;
  renderBody();
  wireSpaceHeader(container, db);

  container.querySelector('#db-search').addEventListener('input', event => { searchQuery = event.target.value; renderBody(); });
  container.querySelector('#db-add-row').addEventListener('click', () => {
    // 表の時は表の下の「＋ 新規」と同じ(その場で名前を書く)。リストの時は新しい行のページを開く。
    const inlineAdd = container.querySelector('[data-nt-add]');
    if (inlineAdd) { inlineAdd.click(); return; }
    const id = addDatabaseRow(db.id, '新しい項目');
    if (id) openKnowledgeMemo(id);
  });
  container.querySelector('#db-edit').addEventListener('click', () => openSchemaEditor(db.id, refreshMemoSpace));
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
    if (row) openKnowledgeMemo(row.dataset.rowOpen);
  });
  // 表のセルの書き換え・タグ・列の幅・行の追加(notion-table.js)。見出しを押すと列の編集を開く。
  wireNotionTable(body, db.id, {
    refresh: renderBody,
    onHeader: () => openSchemaEditor(db.id, refreshMemoSpace),
    onOpenRow: openKnowledgeMemo,
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
    openDatabase(MEMO_SPACE);
  });
}

/**
 * メモ画面の「戻る」で、データベースの行のページなら、そのデータベースを開いたメモ欄へ戻す。戻したらtrue。
 * 普通のメモは今までどおりの戻り方(一覧の位置の復元など)に任せる。
 */
export function returnToDatabaseFromRow(memoId) {
  const found = memoId ? findDatabaseForRow(memoId) : null;
  if (!found) return false;
  setActiveSpaceId(found.db.id);
  nav('memo');
  return true;
}

// ---- ビューの編集 ----

/** 絞り込み1つの「値」の入力欄。列の種類で形を変える(日付は期間、チェックは付いている/いない)。 */
function filterValueInput(prop, value) {
  if (prop?.type === 'checkbox') {
    return `<select class="select" data-filter-value>
      <option value="true"${value !== false && value !== 'false' ? ' selected' : ''}>付いている</option>
      <option value="false"${value === false || value === 'false' ? ' selected' : ''}>付いていない</option></select>`;
  }
  if (prop?.type === 'date') {
    return `<input class="input" type="date" data-filter-from value="${esc(value?.from || '')}" aria-label="から">
      <input class="input" type="date" data-filter-to value="${esc(value?.to || '')}" aria-label="まで">`;
  }
  return `<input class="input" data-filter-value value="${esc(value || '')}" placeholder="${prop?.type === 'tags' ? 'タグ名' : '含む文字'}"${prop?.type === 'tags' ? ' list="db-tag-list"' : ''}>`;
}

/**
 * ビューを作る・直す画面。名前、絞り込み(いくつでも。すべてに合う行だけ出す)、並べ替え、
 * 一覧に出す列(2つまで)を決める。viewId が null なら新しいビューを作る。
 */
function openViewEditor(space, viewId) {
  /** 保存の直前に最新の状態を読み直す(編集中に他の端末から同期されても上書きしないため)。 */
  const fresh = () => (space.kind === 'memos' ? getMemoSpace() : getDatabase(space.id));
  const props = viewProperties(space);
  const original = spaceViews(space).find(view => view.id === viewId);
  const draft = original
    ? JSON.parse(JSON.stringify(original))
    : { id: generateId(), name: `ビュー${spaceViews(space).length + 1}`, filters: [], sort: null, columns: [], layout: 'table' };
  const tags = space.kind === 'memos' ? [...new Set(getKnowledgeMemos().flatMap(memo => memo.tags || []))].sort() : [];
  // 「メモ」は題名・1行目・タグ・更新日だけの固定の形なので、一覧に出す列は選ばない(カードの形のまま)。
  const columnChoices = space.kind === 'memos' ? [] : space.properties.filter(prop => prop.type !== 'url');
  const body = document.createElement('div');
  body.className = 'db-import db-view-editor';

  /** 編集中の内容で画面を描き直す。 */
  const render = () => {
    body.innerHTML = `
      <label class="form-label">ビューの名前</label>
      <input class="input" id="view-name" value="${esc(draft.name)}">
      <label class="form-label">絞り込み（すべてに合うものだけ出します）</label>
      ${draft.filters.map((filter, index) => `
        <div class="db-filter-row" data-filter="${index}">
          <select class="select" data-filter-prop aria-label="列">
            ${props.map(prop => `<option value="${esc(prop.id)}"${prop.id === filter.prop ? ' selected' : ''}>${esc(prop.name)}</option>`).join('')}
          </select>
          ${filterValueInput(props.find(prop => prop.id === filter.prop), filter.value)}
          <button class="btn btn-ghost btn-sm db-delete" type="button" data-filter-remove aria-label="この絞り込みを外す">外す</button>
        </div>`).join('')}
      <button class="btn btn-ghost btn-sm" id="view-filter-add" type="button">＋ 絞り込みを追加</button>
      <datalist id="db-tag-list">${tags.map(tag => `<option value="${esc(tag)}"></option>`).join('')}</datalist>
      <label class="form-label">並べ替え</label>
      <div class="db-filter-row">
        <select class="select" id="view-sort-prop" aria-label="並べ替える列">
          <option value="">${space.kind === 'memos' ? 'なし' : 'なし（追加順）'}</option>
          ${props.map(prop => `<option value="${esc(prop.id)}"${prop.id === draft.sort?.prop ? ' selected' : ''}>${esc(prop.name)}</option>`).join('')}
        </select>
        <select class="select" id="view-sort-dir" aria-label="向き">
          <option value="asc"${draft.sort?.dir !== 'desc' ? ' selected' : ''}>古い・小さい順</option>
          <option value="desc"${draft.sort?.dir === 'desc' ? ' selected' : ''}>新しい・大きい順</option>
        </select>
      </div>
      ${space.kind !== 'memos' ? `
        <label class="form-label">表示の形</label>
        <select class="select" id="view-layout" aria-label="表示の形">
          <option value="table"${draft.layout !== 'list' ? ' selected' : ''}>表（Notionのように全部の列）</option>
          <option value="list"${draft.layout === 'list' ? ' selected' : ''}>リスト（名前と選んだ列だけ）</option>
        </select>` : ''}
      ${columnChoices.length ? `
        <label class="form-label">リストに出す列（2つまで）</label>
        ${columnChoices.map(prop => `<label class="db-view-column"><input type="checkbox" data-view-column="${esc(prop.id)}"${draft.columns.includes(prop.id) ? ' checked' : ''}> ${esc(prop.name)}</label>`).join('')}` : ''}
      <div class="db-schema-footer">
        ${original && spaceViews(space).length > 1 ? '<button class="btn btn-ghost btn-sm db-delete" id="view-delete" type="button">このビューを削除</button>' : '<span></span>'}
        <button class="btn btn-primary" id="view-save" type="button">保存</button>
      </div>`;
  };
  /** 入力中の内容を draft へ取り込む(列を変えて描き直す前・保存の前に呼ぶ)。 */
  const collect = () => {
    draft.name = body.querySelector('#view-name').value.trim() || draft.name;
    draft.filters = [...body.querySelectorAll('[data-filter]')].map(row => {
      const prop = props.find(item => item.id === row.querySelector('[data-filter-prop]').value);
      const value = prop?.type === 'date'
        ? { from: row.querySelector('[data-filter-from]').value, to: row.querySelector('[data-filter-to]').value }
        : row.querySelector('[data-filter-value]').value;
      return { prop: prop?.id, value: prop?.type === 'checkbox' ? value === 'true' : value };
    });
    const sortProp = body.querySelector('#view-sort-prop').value;
    draft.sort = sortProp ? { prop: sortProp, dir: body.querySelector('#view-sort-dir').value } : null;
    draft.columns = [...body.querySelectorAll('[data-view-column]:checked')].map(input => input.dataset.viewColumn).slice(0, 2);
    draft.layout = body.querySelector('#view-layout')?.value || draft.layout || 'table';
  };
  /** ビューの一覧を保存し、メモ欄を描き直す。 */
  const commit = views => {
    const target = fresh();
    if (!target) return;
    saveDatabase({ ...target, views });
    close?.();
    refreshMemoSpace();
  };

  render();
  const close = window.AppNav.openModal({ title: original ? 'ビューの編集' : 'ビューを追加', body, autoFocus: false });
  // 列を選び直したら、値の入力欄をその列の種類に合わせて作り直す。
  body.addEventListener('change', event => {
    if (event.target.closest('[data-filter-prop]')) {
      collect();
      const row = draft.filters[Number(event.target.closest('[data-filter]').dataset.filter)];
      row.value = '';
      render();
    }
  });
  body.addEventListener('click', event => {
    if (event.target.closest('#view-filter-add')) {
      collect();
      draft.filters.push({ prop: props[0].id, value: '' });
      render();
    } else if (event.target.closest('[data-filter-remove]')) {
      collect();
      draft.filters.splice(Number(event.target.closest('[data-filter]').dataset.filter), 1);
      render();
    } else if (event.target.closest('#view-delete')) {
      if (!window.confirm(`ビュー「${draft.name}」を削除しますか？ 中のメモや行は消えません。`)) return;
      commit(spaceViews(fresh()).filter(view => view.id !== draft.id));
    } else if (event.target.closest('#view-save')) {
      collect();
      const views = spaceViews(fresh());
      const next = views.some(view => view.id === draft.id) ? views.map(view => (view.id === draft.id ? draft : view)) : [...views, draft];
      setActiveView(space, draft.id);
      commit(next);
    }
  });
}

// ---- メモを別のデータベースへ移す ----

/**
 * 「移動」の選択画面。普通のメモ⇄データベース、データベース⇄データベースを移せる。
 * 値は名前と種類が同じ列だけ引き継ぐ。移したら onMoved を呼ぶ(詳細画面を描き直すため)。
 */
export function openMoveSheet(memoId, onMoved) {
  const current = findDatabaseForRow(memoId)?.db.id || MEMO_SPACE;
  const targets = [{ id: MEMO_SPACE, name: 'メモ' }, ...getDatabases()];
  const body = document.createElement('div');
  body.className = 'db-import';
  body.innerHTML = `
    <p class="db-import-note">名前と種類が同じ列の値は引き継ぎます。データベースに入れたページは復習の対象から外れます。</p>
    ${targets.map(target => `<button class="btn btn-ghost" type="button" data-move-to="${esc(target.id)}"${target.id === current ? ' disabled' : ''}>
      ${esc(target.name)}${target.id === current ? '（今ここ）' : ''}</button>`).join('')}`;
  const close = window.AppNav.openModal({ title: '移動先', body, autoFocus: false });
  body.addEventListener('click', event => {
    const id = event.target.closest('[data-move-to]')?.dataset.moveTo;
    if (!id) return;
    const target = targets.find(item => item.id === id);
    if (!moveMemoToSpace(memoId, id === MEMO_SPACE ? null : id, carryValues)) { toast('移動できませんでした', 'error'); return; }
    close?.();
    toast(`「${target.name}」へ移動しました`, 'success');
    onMoved?.();
  });
}

// ---- 行のページの上に出す欄 ----

/**
 * メモがデータベースの行なら、閲覧画面の上に「列の値」の欄を出す。値は入力し終えた時点で保存する。
 * URLは開くボタン、文字はコピーボタンを横に付ける。普通のメモには列が無いので何も出さない。
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
        ${prop.type === 'url' ? openLinkHtml(values[prop.id]) : ''}
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
