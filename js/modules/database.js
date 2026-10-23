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
  getKnowledgeMemos, getMemoSpace, moveMemoToSpace, saveDatabase,
} from '../storage.js';
import {
  PROPERTY_TYPE_LABELS, PROPERTY_TYPES, applyView, carryValues, convertValue, formatValue, parseCsv, planCsvImport,
  rowMatches, spaceViews, viewProperties,
} from '../database-model.js';
import { normalizeMemoUrl } from '../memo-model.js';
import { esc, generateId } from '../utils.js';
import { openKnowledgeMemo, refreshMemoSpace } from './memo.js';
import { renderPageEditor, wirePageEditor } from './page-editor.js';
import { propIcon, renderNotionTable, renderPropertyList, wireNotionTable, wirePropertyList } from './notion-table.js';

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

// ---- メモ欄の上: 「チップ」の行と、ビューの1行(タブ・絞り込み・並べ替え・検索・新規) ----
// 「メモ」もデータベースも同じ形にして、切り替えても画面の高さや位置がずれないようにする。

/** 小さな線のアイコン(Notionの表の右上と同じ意味の形)。 */
const toolIcon = path => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">${path}</svg>`;
const TOOL_ICONS = {
  filter: toolIcon('<path d="M2.5 4h11M4.5 8h7M6.5 12h3"/>'),
  sort: toolIcon('<path d="M5 3v10M2.8 5.2 5 3l2.2 2.2M11 13V3M8.8 10.8 11 13l2.2-2.2"/>'),
  search: toolIcon('<circle cx="7" cy="7" r="4.3"/><path d="m10.2 10.2 3.3 3.3"/>'),
  graph: toolIcon('<circle cx="4" cy="4.5" r="1.6"/><circle cx="12" cy="4" r="1.6"/><circle cx="8" cy="12" r="1.6"/><path d="M5.5 5.2 7 10.6M10.6 5 9 10.6M5.6 4.4h4.8"/>'),
  more: toolIcon('<path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6"/><circle cx="10" cy="4.5" r="1.5"/><circle cx="6" cy="11.5" r="1.5"/>'),
  table: toolIcon('<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M2.5 6.5h11M6.5 6.5V13"/>'),
  list: toolIcon('<path d="M5.5 4.5h8M5.5 8h8M5.5 11.5h8"/><circle cx="3" cy="4.5" r=".6"/><circle cx="3" cy="8" r=".6"/><circle cx="3" cy="11.5" r=".6"/>'),
  eye: toolIcon('<path d="M1.8 8s2.3-4.2 6.2-4.2S14.2 8 14.2 8 11.9 12.2 8 12.2 1.8 8 1.8 8Z"/><circle cx="8" cy="8" r="1.8"/>'),
  eyeOff: toolIcon('<path d="M1.8 8s2.3-4.2 6.2-4.2S14.2 8 14.2 8 11.9 12.2 8 12.2 1.8 8 1.8 8Z"/><path d="m3 13 10-10"/>'),
};

/**
 * チップの行(メモ・各データベース・＋)と、ビューの1行のHTML。
 * search はその欄の検索語(入っていれば検索欄を開いたまま出す)。
 */
export function renderSpaceHeader(space, { search = '' } = {}) {
  const activeId = space.kind === 'memos' ? MEMO_SPACE : space.id;
  const current = activeView(space);
  /** チップ1つ。 */
  const chip = (id, label) => `<button class="db-space-chip${id === activeId ? ' active' : ''}" type="button" data-space="${esc(id)}" aria-pressed="${id === activeId}">${esc(label)}</button>`;
  /** 右側の小さなアイコンのボタン。on は「設定中」(青くする)。 */
  const tool = (name, label, on = false) => `<button class="db-tool-btn${on ? ' is-on' : ''}" type="button" data-tool="${name}" aria-label="${label}" title="${label}">${TOOL_ICONS[name]}</button>`;
  return `
    <div class="db-space-header">
      <div class="db-space-bar" aria-label="メモとデータベースの切り替え(データベースは右クリック・長押しで名前の変更と削除)">
        ${chip(MEMO_SPACE, 'メモ')}
        ${getDatabases().map(db => chip(db.id, db.name)).join('')}
        <button class="db-space-chip db-space-add" type="button" data-space-add aria-label="データベースを作る">＋</button>
      </div>
      <div class="db-view-bar">
        <div class="db-view-tabs" aria-label="ビュー">
          ${spaceViews(space).map(view => `<button class="db-view-tab${view.id === current.id ? ' active' : ''}" type="button" data-view-id="${esc(view.id)}">${esc(view.name)}</button>`).join('')}
          <button class="db-view-tab db-view-add" type="button" data-view-add aria-label="ビューを追加">＋</button>
        </div>
        <div class="db-view-tools">
          <input class="db-search-input${search ? ' is-open' : ''}" id="space-search" type="search" placeholder="検索" value="${esc(search)}" aria-label="検索">
          ${tool('search', '検索', !!search)}
          ${tool('filter', 'フィルター', current.filters?.length > 0)}
          ${tool('sort', '並べ替え', !!current.sort && !(space.kind === 'memos' && current.sort.prop === '__updated' && current.sort.dir === 'desc'))}
          ${space.kind === 'memos' ? tool('graph', '知識グラフ') : ''}
          ${tool('more', 'ビューの設定')}
          <button class="db-new-btn" type="button" data-tool="new">新規</button>
        </div>
      </div>
    </div>`;
}

/**
 * チップの行とビューの1行を動くようにする。onSearch は検索語が変わった時、onNew は「新規」の時に呼ぶ
 * (「メモ」とデータベースで中身が違うので、呼ぶ側が決める)。
 */
export function wireSpaceHeader(container, space, { onSearch, onNew } = {}) {
  const header = container.querySelector('.db-space-header');
  if (!header) return;
  let suppressClick = false;
  header.addEventListener('click', event => {
    if (suppressClick) { suppressClick = false; return; }
    const chip = event.target.closest('[data-space]');
    // 別の欄へ切り替えたら、開いていた行のページは閉じる。
    if (chip) { peekRowId = null; setActiveSpaceId(chip.dataset.space); refreshMemoSpace(); return; }
    if (event.target.closest('[data-space-add]')) { openCreateDatabaseSheet(); return; }
    const tab = event.target.closest('[data-view-id]');
    if (tab) { setActiveView(space, tab.dataset.viewId); refreshMemoSpace(); return; }
    if (event.target.closest('[data-view-add]')) { openViewEditor(space, null); return; }
    const button = event.target.closest('[data-tool]');
    if (!button) return;
    const name = button.dataset.tool;
    if (name === 'search') {
      const input = header.querySelector('#space-search');
      input.classList.add('is-open');
      input.focus();
    } else if (name === 'filter') openFilterPopover(button, space);
    else if (name === 'sort') openSortPopover(button, space);
    else if (name === 'graph') nav('knowledge-graph');
    else if (name === 'more') openViewSettings(button, space);
    else if (name === 'new') onNew?.();
  });
  // 検索欄は、空のまま離れたら閉じる(アイコンだけに戻る)。
  const input = header.querySelector('#space-search');
  input?.addEventListener('blur', () => { if (!input.value) input.classList.remove('is-open'); });
  if (onSearch) onSearch(input);

  // データベースのチップは、右クリック(スマホは長押し)で「名前を変更」「削除」のメニュー。
  // 間違って消さないよう、削除はここからだけにする。
  const bar = header.querySelector('.db-space-bar');
  /** そのチップのデータベース(「メモ」と「＋」はメニューなし)。 */
  const chipDb = target => {
    const id = target.closest('[data-space]')?.dataset.space;
    return id && id !== MEMO_SPACE ? getDatabase(id) : null;
  };
  bar.addEventListener('contextmenu', event => {
    const db = chipDb(event.target);
    if (!db) return;
    event.preventDefault();
    openDatabaseMenu(db, event.clientX, event.clientY);
  });
  let pressTimer = null;
  bar.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch') return;
    const db = chipDb(event.target);
    if (!db) return;
    const { clientX, clientY } = event;
    pressTimer = setTimeout(() => { suppressClick = true; openDatabaseMenu(db, clientX, clientY); }, 550);
  });
  ['pointerup', 'pointercancel', 'pointermove'].forEach(type => bar.addEventListener(type, () => clearTimeout(pressTimer)));
}

// ---- 小さな選択窓(ポップオーバー)。表示中は1つだけ ----

let closeActivePopover = null;

/**
 * ボタン(または画面上の位置)の下に小さな窓を出す。外を押す・Escで閉じる。
 * 窓は body の直下に置くので、中身を描き直しても閉じない。中身を入れた後に位置を整える。
 * @returns {HTMLElement} 中身を入れる窓
 */
function openPopover(anchor, className = '') {
  // 位置は、前の窓を閉じる前に読む(前の窓の中のボタンから開く時、閉じると位置が分からなくなるため)。
  const rect = anchor instanceof Element ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, bottom: anchor.y };
  closeActivePopover?.();
  const pop = document.createElement('div');
  pop.className = `db-pop ${className}`;
  document.body.append(pop);
  /** 画面からはみ出さない位置に置き直す(中身の大きさが変わった時にも呼ぶ)。 */
  pop.place = () => {
    const width = pop.offsetWidth;
    pop.style.left = `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8, rect.left))}px`;
    pop.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - pop.offsetHeight - 8)}px`;
  };
  /** 外を押したら閉じる。 */
  const outside = event => { if (!pop.contains(event.target)) close(); };
  /** Escで閉じる。 */
  const onKey = event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } };
  let closed = false;
  /** 窓と監視を片付ける(2回目以降は何もしない)。 */
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('pointerdown', outside, true);
    window.removeEventListener('keydown', onKey, true);
    pop.remove();
    if (closeActivePopover === close) closeActivePopover = null;
  }
  // 開いた時の押下で閉じないよう、外の押下の見張りは一拍おいて始める(その間に閉じていたら始めない)。
  setTimeout(() => { if (!closed) document.addEventListener('pointerdown', outside, true); }, 0);
  window.addEventListener('keydown', onKey, true);
  closeActivePopover = close;
  pop.close = close;
  return pop;
}

/** 最新の欄(「メモ」の設定かデータベース)を読み直す。 */
const freshSpace = space => (space.kind === 'memos' ? getMemoSpace() : getDatabase(space.id)) || space;

/** 今のビューを書き換えて保存し、メモ欄を描き直す(窓は開いたまま)。 */
function updateActiveView(space, change) {
  const target = freshSpace(space);
  const view = JSON.parse(JSON.stringify(activeView(target)));
  change(view);
  const views = spaceViews(target);
  saveDatabase({ ...target, views: views.some(item => item.id === view.id) ? views.map(item => (item.id === view.id ? view : item)) : [...views, view] });
  setActiveView(target, view.id);
  refreshMemoSpace();
}

/**
 * 列を選ぶ一覧(上に絞り込み用の入力欄)。Notionの「並べ替え基準…」と同じ形。onPick に選んだ列を渡す。
 */
function propertyPicker(pop, space, placeholder, onPick) {
  const props = viewProperties(freshSpace(space));
  pop.innerHTML = `
    <input class="db-pop-search" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}">
    <div class="db-pop-list">${props.map(prop => `
      <button class="db-pop-item" type="button" data-pick="${esc(prop.id)}">${propIcon(prop.type === 'text' && prop.id === '__title' ? 'title' : prop.type)}<span>${esc(prop.name)}</span></button>`).join('')}
    </div>`;
  const input = pop.querySelector('.db-pop-search');
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    pop.querySelectorAll('[data-pick]').forEach(item => { item.hidden = !!q && !item.textContent.toLowerCase().includes(q); });
  });
  pop.querySelector('.db-pop-list').addEventListener('click', event => {
    const id = event.target.closest('[data-pick]')?.dataset.pick;
    if (id) onPick(props.find(prop => prop.id === id));
  });
  // 窓そのものに描いた時だけ位置を整える(並べ替えの窓は、下に入れてから窓の側で整える)。
  pop.place?.();
  input.focus();
}

/**
 * 並べ替えの窓。並べ替え中なら「列・向き・外す」を出し、その下で別の列を選べる。
 * 選んだ時点で今のビューに保存して、表がすぐ並び替わる。
 */
function openSortPopover(button, space) {
  const pop = openPopover(button, 'db-pop--sort');
  /** 今の並べ替えで窓を描き直す。 */
  const draw = () => {
    const target = freshSpace(space);
    const sort = activeView(target).sort;
    const props = viewProperties(target);
    const prop = sort && props.find(item => item.id === sort.prop);
    const holder = document.createElement('div');
    propertyPicker(holder, space, '並べ替え基準…', picked => {
      updateActiveView(space, view => { view.sort = { prop: picked.id, dir: view.sort?.prop === picked.id ? view.sort.dir : 'asc' }; });
      draw();
    });
    pop.innerHTML = prop ? `
      <div class="db-pop-rule">
        ${propIcon(prop.id === '__title' ? 'title' : prop.type)}<span class="db-pop-rule-name">${esc(prop.name)}</span>
        <select class="select db-pop-select" data-sort-dir aria-label="向き">
          <option value="asc"${sort.dir !== 'desc' ? ' selected' : ''}>昇順</option>
          <option value="desc"${sort.dir === 'desc' ? ' selected' : ''}>降順</option>
        </select>
        <button class="db-pop-x" type="button" data-sort-clear aria-label="並べ替えを外す">×</button>
      </div>` : '';
    pop.append(holder);
    pop.querySelector('[data-sort-dir]')?.addEventListener('change', event => {
      updateActiveView(space, view => { view.sort = { ...view.sort, dir: event.target.value }; });
    });
    pop.querySelector('[data-sort-clear]')?.addEventListener('click', () => {
      updateActiveView(space, view => { view.sort = null; });
      draw();
    });
    pop.place();
  };
  draw();
}

/**
 * フィルターの窓。今のビューの絞り込み条件を並べ、値はその場で変えられる(すぐ表に反映)。
 * 「＋ フィルターを追加」で列を選ぶと、その列の条件が1つ増える。
 */
function openFilterPopover(button, space) {
  const pop = openPopover(button, 'db-pop--filter');
  let typingTimer = null;
  /** 今の条件で窓を描き直す。 */
  const draw = () => {
    const target = freshSpace(space);
    const props = viewProperties(target);
    const filters = activeView(target).filters || [];
    pop.innerHTML = `
      ${filters.map((filter, index) => {
        const prop = props.find(item => item.id === filter.prop);
        return prop ? `<div class="db-pop-rule" data-filter="${index}">
          ${propIcon(prop.id === '__title' ? 'title' : prop.type)}<span class="db-pop-rule-name">${esc(prop.name)}</span>
          ${filterValueInput(prop, filter.value)}
          <button class="db-pop-x" type="button" data-filter-remove aria-label="この条件を外す">×</button>
        </div>` : '';
      }).join('') || '<p class="db-pop-empty">絞り込みはありません</p>'}
      <button class="db-pop-add" type="button" data-filter-add>＋ フィルターを追加</button>
      <datalist id="db-tag-list">${[...new Set(getKnowledgeMemos().flatMap(memo => memo.tags || []))].map(tag => `<option value="${esc(tag)}"></option>`).join('')}</datalist>`;
    pop.place();
  };
  /** 入力欄の今の値を、条件の値の形にする(日付は期間、チェックは真偽)。 */
  const readValue = (row, prop) => (prop?.type === 'date'
    ? { from: row.querySelector('[data-filter-from]').value, to: row.querySelector('[data-filter-to]').value }
    : prop?.type === 'checkbox' ? row.querySelector('[data-filter-value]').value === 'true' : row.querySelector('[data-filter-value]').value);
  /** 1つの条件の値を保存する。 */
  const saveRow = row => {
    const index = Number(row.dataset.filter);
    updateActiveView(space, view => {
      const prop = viewProperties(freshSpace(space)).find(item => item.id === view.filters[index]?.prop);
      if (view.filters[index]) view.filters[index].value = readValue(row, prop);
    });
  };
  pop.addEventListener('input', event => {
    const row = event.target.closest('[data-filter]');
    if (!row) return;
    // 文字を打っている間は少し待ってから反映する(1文字ごとに表を描き直さない)。
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => saveRow(row), 250);
  });
  pop.addEventListener('change', event => {
    const row = event.target.closest('[data-filter]');
    if (row) { clearTimeout(typingTimer); saveRow(row); }
  });
  pop.addEventListener('click', event => {
    if (event.target.closest('[data-filter-remove]')) {
      const index = Number(event.target.closest('[data-filter]').dataset.filter);
      updateActiveView(space, view => { view.filters.splice(index, 1); });
      draw();
    } else if (event.target.closest('[data-filter-add]')) {
      propertyPicker(pop, space, 'フィルター対象…', picked => {
        updateActiveView(space, view => { view.filters = [...(view.filters || []), { prop: picked.id, value: picked.type === 'checkbox' ? true : '' }]; });
        draw();
        pop.querySelector('[data-filter]:last-of-type input')?.focus();
      });
    }
  });
  draw();
}

/**
 * 「…」の「ビューの設定」(Notionの右上の設定と同じ並び)。ビューの名前・レイアウト・列の表示/非表示・
 * フィルター・並べ替えと、データベースの列の編集・ビューの削除をここにまとめる。変更はすぐ保存して表に出す。
 * 「レイアウト」「列の表示/非表示」は、同じ窓の中で次の画面に切り替わる(‹ で戻る)。
 */
function openViewSettings(button, space) {
  const pop = openPopover(button, 'db-pop--settings');
  const isDb = space.kind !== 'memos';
  let screen = 'main';
  let nameTimer = null;
  /** 「›」付きの項目1つ。 */
  const item = (key, icon, label, value = '') => `<button class="db-pop-item" type="button" data-set="${key}">${icon}<span class="db-pop-label">${label}</span><span class="db-pop-value">${esc(value)}</span><span class="db-pop-arrow" aria-hidden="true">›</span></button>`;
  /** 今の画面を描き直す(保存のたびに最新の内容で)。 */
  const draw = () => {
    const target = freshSpace(space);
    const view = activeView(target);
    const props = viewProperties(target);
    const sortProp = view.sort && props.find(prop => prop.id === view.sort.prop);
    const hidden = new Set(view.hidden || []);
    const back = '<button class="db-pop-back" type="button" data-set="main">‹ ビューの設定</button>';
    if (screen === 'layout') {
      pop.innerHTML = `${back}
        ${[['table', 'テーブル', 'Notionのように全部の列'], ['list', 'リスト', '名前と選んだ列だけ']].map(([key, label, sub]) => `
          <button class="db-pop-item${(view.layout || 'table') === key ? ' is-current' : ''}" type="button" data-layout="${key}">
            ${TOOL_ICONS[key === 'table' ? 'table' : 'list']}<span class="db-pop-label">${label}<small>${sub}</small></span>${(view.layout || 'table') === key ? '<span class="db-pop-check">✓</span>' : ''}
          </button>`).join('')}`;
    } else if (screen === 'props') {
      pop.innerHTML = `${back}
        ${target.properties.map(prop => `
          <button class="db-pop-item" type="button" data-toggle-prop="${esc(prop.id)}">
            ${propIcon(prop.type)}<span class="db-pop-label">${esc(prop.name)}</span>
            <span class="db-pop-eye${hidden.has(prop.id) ? ' is-off' : ''}" aria-label="${hidden.has(prop.id) ? '隠している' : '表示中'}">${TOOL_ICONS[hidden.has(prop.id) ? 'eyeOff' : 'eye']}</span>
          </button>`).join('') || '<p class="db-pop-empty">列がありません</p>'}`;
    } else {
      pop.innerHTML = `
        <div class="db-pop-head"><strong>ビューの設定</strong><button class="db-pop-x" type="button" data-set="close" aria-label="閉じる">×</button></div>
        <input class="db-pop-search" data-view-name value="${esc(view.name)}" placeholder="ビュー名" aria-label="ビュー名">
        ${isDb ? item('layout', TOOL_ICONS.table, 'レイアウト', view.layout === 'list' ? 'リスト' : 'テーブル') : ''}
        ${isDb ? item('props', TOOL_ICONS.eye, 'プロパティの表示/非表示', String(target.properties.length - hidden.size)) : ''}
        ${item('filter', TOOL_ICONS.filter, 'フィルター', view.filters?.length ? `${view.filters.length}件` : '')}
        ${item('sort', TOOL_ICONS.sort, '並べ替え', sortProp ? `${sortProp.name} ${view.sort.dir === 'desc' ? '降順' : '昇順'}` : '')}
        ${isDb ? `<div class="db-pop-section">データの設定</div>${item('columns', TOOL_ICONS.list, 'プロパティを編集')}` : ''}
        ${spaceViews(target).length > 1 ? '<button class="db-pop-item db-delete" type="button" data-set="delete-view">このビューを削除</button>' : ''}`;
    }
    pop.place();
  };
  pop.addEventListener('input', event => {
    if (!event.target.matches('[data-view-name]')) return;
    const name = event.target.value.trim();
    clearTimeout(nameTimer);
    nameTimer = setTimeout(() => { if (name) updateActiveView(space, view => { view.name = name; }); }, 400);
  });
  pop.addEventListener('click', async event => {
    const layout = event.target.closest('[data-layout]')?.dataset.layout;
    if (layout) { updateActiveView(space, view => { view.layout = layout; }); draw(); return; }
    const propId = event.target.closest('[data-toggle-prop]')?.dataset.toggleProp;
    if (propId) {
      updateActiveView(space, view => {
        const hidden = new Set(view.hidden || []);
        if (hidden.has(propId)) hidden.delete(propId); else hidden.add(propId);
        view.hidden = [...hidden];
      });
      draw();
      return;
    }
    const target = event.target.closest('[data-set]');
    const key = target?.dataset.set;
    if (!key) return;
    if (key === 'close') pop.close();
    else if (key === 'main' || key === 'layout' || key === 'props') { screen = key; draw(); }
    else if (key === 'filter') openFilterPopover(target, space);
    else if (key === 'sort') openSortPopover(target, space);
    else if (key === 'columns') { pop.close(); openSchemaEditor(space.id, refreshMemoSpace); }
    else if (key === 'delete-view') {
      const fresh = freshSpace(space);
      const current = activeView(fresh);
      pop.close();
      if (!await window.AppNav.confirm(`ビュー「${current.name}」を削除しますか？ 中のメモや行は消えません。`, { okLabel: '削除', danger: true })) return;
      saveDatabase({ ...fresh, views: spaceViews(fresh).filter(view => view.id !== current.id) });
      refreshMemoSpace();
    }
  });
  draw();
}

/** データベースのチップの右クリック(長押し)メニュー: 名前を変更・削除(確認あり)。 */
function openDatabaseMenu(db, x, y) {
  const pop = openPopover({ x, y }, 'db-pop--menu');
  pop.innerHTML = `
    <button class="db-pop-item" type="button" data-menu="rename">名前を変更</button>
    <button class="db-pop-item db-delete" type="button" data-menu="delete">削除</button>`;
  pop.place();
  pop.addEventListener('click', async event => {
    const item = event.target.closest('[data-menu]')?.dataset.menu;
    if (!item) return;
    pop.close();
    if (item === 'delete') { confirmDeleteDatabase(db); return; }
    const name = await window.AppNav.prompt('データベースの名前', { value: db.name, okLabel: '変更' });
    const fresh = getDatabase(db.id);
    if (name && fresh) { saveDatabase({ ...fresh, name }); refreshMemoSpace(); }
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

/** 名前を付けて、空のデータベース(「URL」「ID」の2列)を作って開く。名前を入れずにやめたら作らない。 */
export async function createEmptyDatabase() {
  const name = await window.AppNav.prompt('新しいデータベースの名前', { placeholder: '例: 就活', okLabel: '作る' });
  if (!name) return;
  const db = createDatabase({
    name,
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

// ---- 行のページ(サイドピーク) ----
// PCは表の右側に、スマホはデータベースの上に全画面で、行のページを開く。メモ画面へは移らず、
// 題名・列の値・本文をその場で書き換えられる(表・画像などの複雑な本文は「全画面で開く」で直す)。

let peekRowId = null;

/**
 * 行のページを描く(peekRowId が無ければ閉じる)。refreshTable は表を描き直す関数。
 * 上(題名と列の値)は表を描き直すたびに新しくし、本文のエディタは行ごとに1回だけ作る
 * (打っている途中の本文を、描き直しで消さないため)。
 */
function renderPeek(container, dbId, refreshTable) {
  const page = container.querySelector('.db-page');
  if (!page) return;
  let peek = page.querySelector('.nt-peek');
  const db = getDatabase(dbId);
  const memo = peekRowId && getKnowledgeMemos().find(item => item.id === peekRowId);
  if (!db || !memo || !(peekRowId in db.rows)) {
    peekRowId = null;
    peek?.remove();
    page.classList.remove('nt-peek-open');
    document.body.classList.remove('has-peek');
    return;
  }
  if (!peek) {
    peek = document.createElement('aside');
    peek.className = 'nt-peek';
    peek.innerHTML = `
      <div class="nt-peek-bar">
        <button class="db-tool" type="button" data-peek-close aria-label="閉じる" title="閉じる"><span class="nt-peek-close-wide">»</span><span class="nt-peek-close-narrow">‹ 戻る</span></button>
        <button class="db-tool" type="button" data-peek-full>全画面で開く</button>
      </div>
      <div class="nt-peek-body"><div class="nt-peek-head"></div><div class="nt-peek-content"></div></div>`;
    page.append(peek);
    // 題名・列の値を書き換えたら表を描き直す(表を描き直すと、ここの上の部分も新しくなる)。
    wirePropertyList(peek.querySelector('.nt-peek-head'), dbId, refreshTable, toast);
    peek.addEventListener('click', event => {
      if (event.target.closest('[data-peek-close]')) { peekRowId = null; renderPeek(container, dbId, refreshTable); }
      else if (event.target.closest('[data-peek-full]')) { const id = peekRowId; peekRowId = null; openKnowledgeMemo(id); }
    });
  }
  // 上の帯(ヘッダー)の下から画面の下までに置く。
  peek.style.top = `${Math.round(document.getElementById('app-header')?.getBoundingClientRect().bottom || 0)}px`;
  peek.querySelector('.nt-peek-head').innerHTML = `
    <div class="nt-peek-title" data-row="${esc(memo.id)}"><div data-edit="__title"><div class="nt-cell">${esc(memo.title || '無題')}</div></div></div>
    ${renderPropertyList(db, memo.id)}`;
  const content = peek.querySelector('.nt-peek-content');
  if (content.dataset.row !== memo.id) {
    content.dataset.row = memo.id;
    content.innerHTML = renderPageEditor(memo);
    wirePageEditor(content, memo.id);
    peek.scrollTop = 0;
  }
  page.classList.add('nt-peek-open');
  // 右下のAIの窓を、開いた行のページと重ならない位置へずらすための印(PCだけ効く)。
  document.body.classList.add('has-peek');
}

/** 行のページを開く(PCは表の右、スマホは全画面)。 */
function openPeek(container, dbId, rowId, refreshTable) {
  peekRowId = rowId;
  renderPeek(container, dbId, refreshTable);
}

/**
 * AIの答えに出た名前から開く。データベースの行なら、そのデータベースを開いて行のページを出す。
 * 普通のメモなら、いつものメモの画面で開く。
 */
export function openRowFromAI(memoId) {
  const found = findDatabaseForRow(memoId);
  if (!found) { openKnowledgeMemo(memoId); return; }
  peekRowId = memoId;
  openDatabase(found.db.id);
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
      : renderNotionTable(fresh, rows, view);
    const wrap = target.querySelector('.nt-wrap');
    if (wrap) wrap.scrollLeft = scrollLeft;
    renderPeek(container, db.id, renderBody);
  };

  // 上はチップの行とビューの1行だけ(「メモ」と同じ形)。データベースの削除はチップの右クリックから。
  container.innerHTML = `
    <div class="db-page" data-space-id="${esc(db.id)}">
      ${renderSpaceHeader(db, { search: searchQuery })}
      <div id="db-body"></div>
    </div>`;
  renderBody();
  wireSpaceHeader(container, db, {
    onSearch: input => input.addEventListener('input', () => { searchQuery = input.value; renderBody(); }),
    // 表の時は表の下の「＋ 新規」と同じ(その場で名前を書く)。リストの時は新しい行のページを開く。
    onNew: () => {
      const inlineAdd = container.querySelector('[data-nt-add]');
      if (inlineAdd) { inlineAdd.click(); return; }
      const id = addDatabaseRow(db.id, '新しい項目');
      if (id) { renderBody(); openPeek(container, db.id, id, renderBody); }
    },
  });

  const body = container.querySelector('#db-body');
  // カード・表の行を押したらページを開く。リンク・コピー・入力欄は、押してもページを開かない。
  body.addEventListener('click', async event => {
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
      if (!await window.AppNav.confirm(`「${title}」を削除しますか？ ごみ箱から戻せます。`, { okLabel: '削除', danger: true })) return;
      if (deleteKnowledgeMemo(memoId)) { toast('ごみ箱へ移しました', 'success'); renderBody(); }
      return;
    }
    const row = event.target.closest('[data-row-open]');
    // 行のページは、メモ画面へ移らずにここで開く(PCは右側、スマホは全画面)。
    if (row) openPeek(container, db.id, row.dataset.rowOpen, renderBody);
  });
  // 表のセルの書き換え・タグ・列の幅・行の追加(notion-table.js)。見出しを押すと列の編集を開く。
  wireNotionTable(body, db.id, {
    refresh: renderBody,
    onHeader: () => openSchemaEditor(db.id, refreshMemoSpace),
    onOpenRow: rowId => openPeek(container, db.id, rowId, renderBody),
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
        <span></span>
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

  body.addEventListener('click', async event => {
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
      if (!await window.AppNav.confirm(`列「${column.name}」を削除しますか？ この列の値も消えます。`, { okLabel: '削除', danger: true })) return;
      columns.splice(Number(row.dataset.col), 1);
      render();
    } else if (event.target.closest('#db-col-add')) {
      collect();
      columns.push({ id: generateId(), name: `列${columns.length + 1}`, type: 'text' });
      render();
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
  body.addEventListener('click', async event => {
    if (event.target.closest('#view-filter-add')) {
      collect();
      draft.filters.push({ prop: props[0].id, value: '' });
      render();
    } else if (event.target.closest('[data-filter-remove]')) {
      collect();
      draft.filters.splice(Number(event.target.closest('[data-filter]').dataset.filter), 1);
      render();
    } else if (event.target.closest('#view-delete')) {
      if (!await window.AppNav.confirm(`ビュー「${draft.name}」を削除しますか？ 中のメモや行は消えません。`, { okLabel: '削除', danger: true })) return;
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
 * メモがデータベースの行なら、題名のすぐ下に、Notionと同じ「アイコン・列名・値」の並びで列の値を出す。
 * 値は押すとその場で書き換えられる。普通のメモには列が無いので何も出さない。
 */
export function renderDatabaseRowPanel(container, memoId) {
  const found = memoId ? findDatabaseForRow(memoId) : null;
  const page = container.querySelector('.kn-view-page');
  if (!found || !page || !found.db.properties.length) return;
  const panel = document.createElement('div');
  panel.className = 'db-row-panel';
  /** 最新の値で列の欄を描き直す(書き換えた後にも呼ぶ)。 */
  const draw = () => {
    const db = getDatabase(found.db.id);
    if (db) panel.innerHTML = `<p class="db-row-panel-db">${esc(db.name)}</p>${renderPropertyList(db, memoId)}`;
  };
  draw();
  const title = page.querySelector('.kn-view-title');
  if (title) title.after(panel);
  else page.prepend(panel);
  wirePropertyList(panel, found.db.id, draw, toast);
}
