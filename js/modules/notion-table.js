// ============================================================
// notion-table.js - データベースをNotionのような表で見せ、その場で書き換える部品
//
// 文字は折り返して全部見せ、セルを押すとその場で書き換えられる(Enterで確定、Shift+Enterで改行、
// Escで取り消し)。タグは色付きのラベル、URLは押すと開くリンク、チェックは押すだけで切り替わる。
// 見出しの右端をドラッグすると列の幅を変えられ、幅はデータベースに保存する(他の端末でも同じ幅)。
// ============================================================
import { addDatabaseRow, getDatabase, saveDatabase, updateDatabaseRow, updateKnowledgeMemo } from '../storage.js';
import { COMPUTED_TYPES, STATUS_OPTIONS, columnWidth, convertValue, formatValue, optionColor, rowValues } from '../database-model.js';
import { normalizeMemoUrl } from '../memo-model.js';
import { esc } from '../utils.js';

// 1列目(名前)は行のページの題名。ほかの列と同じに扱えるよう、列の形にしておく。
const TITLE = { id: '__title', name: '名前', type: 'title' };

/** 見出しに付ける、列の種類のアイコン(Notionと同じ意味の形)。 */
const svg = path => `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">${path}</svg>`;
const ICONS = {
  title: '<span class="nt-ico-text">Aa</span>',
  text: svg('<path d="M3 4.5h10M3 8h10M3 11.5h6.5"/>'),
  multi_select: svg('<circle cx="3.5" cy="4.5" r=".6"/><circle cx="3.5" cy="8" r=".6"/><circle cx="3.5" cy="11.5" r=".6"/><path d="M6.5 4.5h7M6.5 8h7M6.5 11.5h7"/>'),
  url: svg('<path d="M6.8 9.2l2.4-2.4M7.3 4.8l1-1a2.3 2.3 0 0 1 3.2 3.2l-1 1M8.7 11.2l-1 1a2.3 2.3 0 0 1-3.2-3.2l1-1"/>'),
  number: '<span class="nt-ico-text">#</span>',
  checkbox: svg('<rect x="2.8" y="2.8" width="10.4" height="10.4" rx="2"/><path d="M5.5 8.2l1.8 1.8 3.3-3.6"/>'),
  date: svg('<rect x="2.6" y="3.4" width="10.8" height="9.8" rx="1.6"/><path d="M2.6 6.6h10.8M5.6 2v2.6M10.4 2v2.6"/>'),
  select: svg('<circle cx="8" cy="8" r="5.6"/><path d="M5.8 7.2L8 9.4l2.2-2.2"/>'),
  status: svg('<circle cx="8" cy="8" r="5.6" stroke-dasharray="2.2 1.6"/><circle cx="8" cy="8" r="2" fill="currentColor"/>'),
  email: svg('<circle cx="8" cy="8" r="2.4"/><path d="M10.4 8v1a1.9 1.9 0 0 0 3.2 1.3A5.6 5.6 0 1 0 11 12.8"/>'),
  phone: svg('<path d="M4.2 2.6h2l1 2.6-1.4 1a7 7 0 0 0 4 4l1-1.4 2.6 1v2a1.4 1.4 0 0 1-1.5 1.4A10.6 10.6 0 0 1 2.8 4.1a1.4 1.4 0 0 1 1.4-1.5z"/>'),
  created_time: svg('<circle cx="8" cy="8" r="5.6"/><path d="M8 5v3.2l2 1.3"/>'),
  last_edited_time: svg('<circle cx="8" cy="8" r="5.6"/><path d="M8 5v3.2l2 1.3"/><path d="M12.6 2.6v2.2h-2.2"/>'),
};
// 値を書き換えられない列(ページから毎回作る作成日時・最終更新日時)と、1つだけ選ぶ列。
const READ_ONLY = new Set(COMPUTED_TYPES);
const SINGLE = new Set(['select', 'status']);

/** 列の種類のアイコン(並べ替え・絞り込みの一覧でも使う)。「メモ」のタグ列(tags)はタグと同じ形。 */
export function propIcon(type) {
  return ICONS[type === 'tags' ? 'multi_select' : type] || ICONS.text;
}

/** タグ1つの色付きラベル(ステータスは決まった3つに決まった色)。 */
const tagLabel = (tag, type = 'multi_select') => `<span class="nt-tag${type === 'status' ? ' nt-tag--status' : ''}" data-c="${optionColor(type, tag)}">${esc(tag)}</span>`;

/** セルの中身(表示用)。種類ごとに、Notionと同じ見せ方にする。 */
function cellHtml(prop, value) {
  if (prop.type === 'multi_select') return (Array.isArray(value) ? value : []).map(tag => tagLabel(tag)).join('');
  if (SINGLE.has(prop.type)) return value ? tagLabel(String(value), prop.type) : '';
  if (prop.type === 'checkbox') return `<input type="checkbox" data-check${value ? ' checked' : ''} aria-label="${esc(prop.name)}">`;
  if (prop.type === 'url') {
    const href = normalizeMemoUrl(value);
    return href ? `<a class="nt-url" data-link href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(value)}</a>` : esc(value || '');
  }
  // メールと電話は、押すとメールアプリ・電話を開くリンクにする(空白や記号だけの値はリンクにしない)。
  if ((prop.type === 'email' && /^[^\s@]+@[^\s@]+$/.test(value || '')) || (prop.type === 'phone' && /\d/.test(value || ''))) {
    const href = prop.type === 'email' ? `mailto:${value}` : `tel:${String(value).replace(/[^\d+]/g, '')}`;
    return `<a class="nt-url" data-link href="${esc(href)}">${esc(value)}</a>`;
  }
  return esc(formatValue(prop.type, value));
}

/**
 * 表の列(名前 + データベースの列)。名前の列の幅はデータベースに保存した titleWidth を使う。
 * ビューで隠した列(view.hidden)は出さない。名前の列は隠せない。
 */
const tableColumns = (db, view) => [{ ...TITLE, width: db.titleWidth }, ...db.properties.filter(prop => !(view?.hidden || []).includes(prop.id))];

// 見出しの右端の「＋」(列を足す)の列の幅。
const ADD_COL_WIDTH = 44;

/**
 * Notionのような表のHTML。列の幅は <col> で決め、表全体の幅は列の合計にする(横にはみ出したら横スクロール)。
 * ビューの「セルの表示行数」(view.lines)を決めていれば、長い文はその行数で切って「…」にする。
 * 行の左の「⋮⋮」で順番を動かせる。並べ替え中のビューは順番が列の値で決まるので、つまみを出さない。
 */
export function renderNotionTable(db, rows, view) {
  const columns = tableColumns(db, view);
  const widths = [...columns.map(columnWidth), ADD_COL_WIDTH];
  const lines = Number(view?.lines) || 0;
  return `
    <div class="nt-wrap">
      <table class="nt" style="width:${widths.reduce((sum, width) => sum + width, 0)}px${lines ? `;--nt-lines:${lines}` : ''}"${lines ? ' data-lines' : ''}>
        <colgroup>${widths.map(width => `<col style="width:${width}px">`).join('')}</colgroup>
        <thead><tr>${columns.map(col => `
          <th data-col="${esc(col.id)}" title="押すと列を編集${col.id === TITLE.id ? '' : '・ドラッグで移動'}">
            <span class="nt-th">${ICONS[col.type] || ICONS.text}<span class="nt-th-name">${esc(col.name)}</span></span>
            <span class="nt-resize" data-resize="${esc(col.id)}" aria-hidden="true"></span>
          </th>`).join('')}
          <th class="nt-th-add"><button class="nt-col-add" type="button" data-col-add aria-label="列を追加" title="列を追加">＋</button></th></tr></thead>
        <tbody>${rows.map(row => `
          <tr data-row="${esc(row.id)}">${columns.map(col => (col.id === TITLE.id ? `
            <td class="nt-td nt-td--title" data-edit="${TITLE.id}">
              ${view?.sort ? '' : '<button class="nt-drag" type="button" data-drag-row aria-label="ドラッグで行を移動" title="ドラッグで移動">⋮⋮</button>'}
              <div class="nt-cell">${esc(row.title)}</div>
              <span class="nt-row-actions">
                <button class="nt-action" type="button" data-row-open="${esc(row.id)}">開く</button>
                <button class="nt-action db-delete" type="button" data-row-delete="${esc(row.id)}">削除</button>
              </span>
            </td>` : `
            <td class="nt-td nt-td--${col.type}" data-edit="${esc(col.id)}"><div class="nt-cell">${cellHtml(col, row.values[col.id])}</div></td>`)).join('')}
            <td class="nt-td-fill"></td>
          </tr>`).join('')}</tbody>
      </table>
    </div>
    <button class="nt-add" type="button" data-nt-add>＋ 新規</button>`;
}

/**
 * 表を動くようにする。refresh は表を描き直す関数、onHeader は見出しを押した時(列の編集)、
 * onOpenRow は行のページを開く時、onAddColumn は見出しの「＋」を押した時に呼ぶ。
 * onMoveRow / onMoveColumn は、行・列をドラッグして離した時に (動かしたID, 落とした先のID, 後ろか) で呼ぶ。
 * スマホ(マウスで指せない端末)では名前を押すとページを開く。
 */
export function wireNotionTable(body, dbId, { refresh, onHeader, onOpenRow, onAddColumn, onMoveRow, onMoveColumn }) {
  let justResized = false;
  /** マウスで指せない端末(スマホ)か。スマホでは名前を押すとページを開く(書き換えは開いた先で)。 */
  const touchOnly = () => window.matchMedia?.('(hover: none)')?.matches;

  body.addEventListener('click', event => {
    const add = event.target.closest('[data-col-add]');
    if (add) { onAddColumn?.(add); return; }
    if (event.target.closest('a, button:not([data-nt-add]), input, textarea, .nt-tag-pop')) return;
    if (event.target.closest('[data-nt-add]')) {
      // Notionと同じく、ページを開かずに表の最後へ1行足し、そのまま名前を書けるようにする。
      const id = addDatabaseRow(dbId, '');
      refresh();
      const td = body.querySelector(`tr[data-row="${CSS.escape(id || '')}"] [data-edit="${TITLE.id}"]`);
      if (td) startEdit(td, dbId, refresh, { blank: true });
      return;
    }
    const th = event.target.closest('th[data-col]');
    if (th) { if (!justResized && !event.target.closest('[data-resize]')) onHeader?.(); return; }
    const td = event.target.closest('td[data-edit]');
    if (!td) return;
    if (td.dataset.edit === TITLE.id && touchOnly()) { onOpenRow(td.closest('tr').dataset.row); return; }
    startEdit(td, dbId, refresh);
  });
  wireCheckboxes(body, dbId);

  // 行の左の「⋮⋮」をつかむと行を、見出し(名前の列以外)をつかむと列をドラッグで動かせる。
  // 見出しは少し動かすまでは普通の押下(列の編集)のまま。指の端末では見出しのドラッグは横スクロールと
  // ぶつかるので使わず、列の順番は「プロパティを編集」の画面で動かす。
  body.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const grip = event.target.closest('[data-drag-row]');
    if (grip) {
      event.preventDefault();
      const rows = [...body.querySelectorAll('tbody tr[data-row]')];
      startDragSort(event, grip.closest('tr'), rows, {
        axis: 'y', threshold: 2,
        onDrop: (target, after) => onMoveRow?.(grip.closest('tr').dataset.row, target.dataset.row, after),
      });
      return;
    }
    const th = event.target.closest('th[data-col]');
    if (!th || th.dataset.col === TITLE.id || event.target.closest('[data-resize]') || event.pointerType === 'touch') return;
    const heads = [...body.querySelectorAll('th[data-col]')].filter(head => head.dataset.col !== TITLE.id);
    startDragSort(event, th, heads, {
      axis: 'x', threshold: 6,
      onDrop: (target, after) => onMoveColumn?.(th.dataset.col, target.dataset.col, after),
    });
  });

  // 見出しの右端をドラッグして列の幅を変える。離した時に幅を保存する。
  body.addEventListener('pointerdown', event => {
    const handle = event.target.closest('[data-resize]');
    if (!handle) return;
    event.preventDefault();
    const th = handle.closest('th');
    const table = th.closest('table');
    const col = table.querySelectorAll('col')[th.cellIndex];
    const startX = event.clientX;
    const startWidth = parseFloat(col.style.width);
    const startTable = parseFloat(table.style.width);
    /** ドラッグ中は幅だけを変える(保存は離した時)。 */
    const move = moveEvent => {
      const width = Math.max(80, startWidth + moveEvent.clientX - startX);
      col.style.width = `${width}px`;
      table.style.width = `${startTable + width - startWidth}px`;
    };
    /** 指を離したら幅を保存し、直後の「見出しを押した」扱いを止める。 */
    const up = () => {
      window.removeEventListener('pointermove', move);
      const width = Math.round(parseFloat(col.style.width));
      const db = getDatabase(dbId);
      const id = handle.dataset.resize;
      if (db && width !== startWidth) {
        saveDatabase(id === TITLE.id ? { ...db, titleWidth: width } : { ...db, properties: db.properties.map(prop => (prop.id === id ? { ...prop, width } : prop)) });
      }
      justResized = true;
      setTimeout(() => { justResized = false; }, 0);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  });
}

/**
 * つかんだ要素(el)を、同じ並び(items)の中でドラッグして動かす。pointerdown の中で呼ぶ。
 * threshold(px)動くまでは普通の押下のまま(押しただけなら、いつものクリックになる)。
 * 動かしている間は落とす位置に線を出し、離したら落とした先の要素と「その後ろか」を onDrop へ渡す。
 * ドラッグした直後のクリックは捨てる(見出しの編集などが開かないように)。
 */
export function startDragSort(event, el, items, { axis = 'y', threshold = 4, onDrop }) {
  /** 動かす向きの、指(マウス)の位置。 */
  const pos = e => (axis === 'y' ? e.clientY : e.clientX);
  const start = pos(event);
  let dragging = false;
  let target = null;
  let after = false;
  /** 落とす位置の線を消す。 */
  const clear = () => items.forEach(item => item.classList.remove('drop-before', 'drop-after'));
  /** 指の位置から、どの要素の前・後ろに落とすかを決めて線を出す。 */
  const move = e => {
    if (!dragging && Math.abs(pos(e) - start) < threshold) return;
    if (!dragging) { dragging = true; el.classList.add('is-dragging'); document.body.classList.add('is-drag-sorting'); }
    e.preventDefault();
    const p = pos(e);
    target = items.find(item => p < item.getBoundingClientRect()[axis === 'y' ? 'bottom' : 'right']) || items.at(-1);
    const rect = target.getBoundingClientRect();
    after = p > (axis === 'y' ? rect.top + rect.height / 2 : rect.left + rect.width / 2);
    clear();
    if (target !== el) target.classList.add(after ? 'drop-after' : 'drop-before');
  };
  /** 離した時: 線と印を消し、動かしていたら onDrop を呼ぶ。 */
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    clear();
    el.classList.remove('is-dragging');
    document.body.classList.remove('is-drag-sorting');
    if (!dragging) return;
    /** ドラッグの直後に起きるクリックを1回だけ止める。 */
    const swallow = e => { e.stopPropagation(); e.preventDefault(); };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, true), 0);
    if (target && target !== el) onDrop(target, after);
  };
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

/** チェックを押した時点で保存する(表とページの列の欄で共通)。 */
function wireCheckboxes(root, dbId) {
  root.addEventListener('change', event => {
    const check = event.target.closest('[data-check]');
    if (!check) return;
    updateDatabaseRow(dbId, check.closest('[data-row]').dataset.row, { [check.closest('[data-edit]').dataset.edit]: check.checked });
  });
}

/**
 * セル(または、ページの列の欄の値)をその場の入力欄に変える。確定したら保存して refresh で描き直す。
 * el は data-edit(列ID)を持ち、祖先に data-row(行=ページのID)がある要素。
 */
function startEdit(el, dbId, refresh, { blank = false } = {}) {
  const db = getDatabase(dbId);
  const rowId = el.closest('[data-row]').dataset.row;
  const prop = el.dataset.edit === TITLE.id ? TITLE : db?.properties.find(item => item.id === el.dataset.edit);
  if (!db || !prop || prop.type === 'checkbox' || READ_ONLY.has(prop.type)) return;
  const current = prop === TITLE ? el.querySelector('.nt-cell').textContent : db.rows[rowId]?.[prop.id];
  if (prop.type === 'multi_select' || SINGLE.has(prop.type)) { openTagEditor(el, db, rowId, prop, refresh); return; }

  const editor = document.createElement(prop.type === 'date' ? 'input' : 'textarea');
  editor.className = 'nt-editor';
  if (prop.type === 'date') { editor.type = 'date'; editor.value = current?.start || ''; }
  else { editor.rows = 1; editor.value = blank ? '' : prop === TITLE ? current : prop.type === 'number' ? (current ?? '') : (current || ''); }
  /** 中身に合わせて入力欄の高さを伸ばす(長い文も全部見える)。 */
  const fit = () => { if (editor.tagName === 'TEXTAREA') { editor.style.height = 'auto'; editor.style.height = `${editor.scrollHeight}px`; } };
  el.classList.add('nt-editing');
  el.querySelector('.nt-cell').replaceChildren(editor);
  fit();
  editor.focus();
  editor.select?.();

  let done = false;
  /** 確定(save=true)か取り消し。変わっていなければ保存しない(同期を無駄に起こさない)。 */
  const finish = save => {
    if (done) return;
    done = true;
    if (save) {
      const raw = editor.value;
      if (prop === TITLE) {
        if (raw.trim() !== current || blank) updateKnowledgeMemo(rowId, { title: raw.trim() || '無題' });
      } else {
        const next = prop.type === 'date' ? (raw ? { start: raw, end: current?.end || null } : null) : convertValue(prop.type, raw);
        if (JSON.stringify(next) !== JSON.stringify(current ?? (prop.type === 'number' || prop.type === 'date' ? null : ''))) {
          updateDatabaseRow(dbId, rowId, { [prop.id]: next });
        }
      }
    }
    refresh();
  };
  editor.addEventListener('input', fit);
  editor.addEventListener('keydown', event => {
    // 日本語の変換を確定するEnterでは保存しない。
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') { event.preventDefault(); finish(false); }
    // 改行できるのは「文字」の列だけ(Shift+Enter)。ほかの列はEnterで確定。
    if (event.key === 'Enter' && !(event.shiftKey && prop.type === 'text')) { event.preventDefault(); finish(true); }
  });
  editor.addEventListener('blur', () => finish(true));
  if (prop.type === 'date') editor.addEventListener('change', () => finish(true));
}

// ---- 行のページの「列の欄」(Notionのページ上部の、アイコン・列名・値の並び) ----

/**
 * ページの上に出す列の一覧のHTML。値は表と同じ見せ方で、押すとその場で書き換えられる。
 * memo(行のページ)は、作成日時・最終更新日時の列を作るのに使う。
 */
export function renderPropertyList(db, rowId, memo) {
  const values = rowValues(db.properties, db.rows[rowId], memo);
  return `
    <div class="nt-props" data-row="${esc(rowId)}">
      ${db.properties.map(prop => `
        <div class="nt-prop">
          <div class="nt-prop-name">${ICONS[prop.type] || ICONS.text}<span>${esc(prop.name)}</span></div>
          <div class="nt-prop-value nt-td--${prop.type}" data-edit="${esc(prop.id)}">
            <div class="nt-cell">${cellHtml(prop, values[prop.id]) || '<span class="nt-empty">未入力</span>'}</div>
            ${prop.type === 'text' && values[prop.id] ? `<button class="nt-copy" type="button" data-copy="${esc(values[prop.id])}">コピー</button>` : ''}
          </div>
        </div>`).join('')}
    </div>`;
}

/**
 * 列の一覧(とサイドピークの題名)を動くようにする。値を押すと書き換え、チェックは押すだけで保存、
 * 「コピー」は値をクリップボードへ。notify は通知を出す関数。
 */
export function wirePropertyList(root, dbId, refresh, notify) {
  root.addEventListener('click', event => {
    const copy = event.target.closest('[data-copy]');
    if (copy) {
      navigator.clipboard?.writeText(copy.dataset.copy).then(() => notify?.('コピーしました', 'success')).catch(() => {});
      return;
    }
    if (event.target.closest('a, button, input, textarea, .nt-tag-pop')) return;
    const value = event.target.closest('[data-edit]');
    if (value) startEdit(value, dbId, refresh);
  });
  wireCheckboxes(root, dbId);
}

/**
 * タグの選択欄。今のタグを外したり、この列で使ったことのあるタグを付けたり、新しく作ったりできる。
 * 「選択」「ステータス」の列は1つだけ選べる(選ぶと前のものと入れ替わり、欄が閉じる)。
 * 付け外しはその場で保存し、欄の外を押すと閉じて表を描き直す。
 */
function openTagEditor(td, db, rowId, prop, refresh) {
  const single = SINGLE.has(prop.type);
  /** 値を配列でそろえる(選択・ステータスは文字1つ、タグは配列で保存している)。 */
  const asList = value => (Array.isArray(value) ? value : value ? [String(value)] : []);
  const selected = new Set(asList(db.rows[rowId]?.[prop.id]));
  // この列の候補 = どれかの行で使われているもの(ステータスは最初からある3つも)。
  const options = [...new Set([...(prop.type === 'status' ? STATUS_OPTIONS : []), ...Object.values(db.rows).flatMap(values => asList(values?.[prop.id]))])];
  /** ラベル1つ(この列の種類の色で)。 */
  const tagHtml = tag => tagLabel(tag, prop.type);
  const pop = document.createElement('div');
  pop.className = 'nt-tag-pop';
  const rect = td.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 288))}px`;
  pop.style.top = `${Math.min(rect.top, window.innerHeight - 320)}px`;

  /** 選択欄の中身を描き直す(入力中の文字で候補を絞る)。 */
  const render = (query = '') => {
    const q = query.trim();
    const matches = options.filter(tag => !q || tag.toLowerCase().includes(q.toLowerCase()));
    pop.innerHTML = `
      <div class="nt-tag-selected">${[...selected].map(tag => `<span class="nt-tag" data-c="${optionColor(prop.type, tag)}">${esc(tag)}<button type="button" data-tag-remove="${esc(tag)}" aria-label="${esc(tag)}を外す">×</button></span>`).join('')}
        <input class="nt-tag-input" placeholder="タグを選ぶか、入力してEnter" value="${esc(query)}"></div>
      <div class="nt-tag-options">
        ${matches.map(tag => `<button type="button" class="nt-tag-option${selected.has(tag) ? ' is-on' : ''}" data-tag-toggle="${esc(tag)}">${tagHtml(tag)}</button>`).join('')}
        ${q && !options.includes(q) ? `<button type="button" class="nt-tag-option" data-tag-create="${esc(q)}">作る ${tagHtml(q)}</button>` : ''}
      </div>`;
    const input = pop.querySelector('.nt-tag-input');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  };
  /** 選んでいるタグを保存する(選択・ステータスは文字1つで)。 */
  const save = () => updateDatabaseRow(db.id, rowId, { [prop.id]: single ? [...selected][0] || '' : [...selected] });
  /** タグを付ける(なければ候補にも足す)。1つだけの列は入れ替えて、そのまま閉じる。 */
  const add = tag => {
    if (single) selected.clear();
    selected.add(tag);
    if (!options.includes(tag)) options.push(tag);
    save();
    if (single) close(); else render();
  };

  pop.addEventListener('click', event => {
    event.stopPropagation();
    const remove = event.target.closest('[data-tag-remove]')?.dataset.tagRemove;
    const toggle = event.target.closest('[data-tag-toggle]')?.dataset.tagToggle;
    const create = event.target.closest('[data-tag-create]')?.dataset.tagCreate;
    if (remove !== undefined) { selected.delete(remove); save(); render(); }
    else if (toggle !== undefined) { if (selected.has(toggle)) { selected.delete(toggle); save(); render(); } else add(toggle); }
    else if (create) add(create);
  });
  pop.addEventListener('input', event => { if (event.target.matches('.nt-tag-input')) render(event.target.value); });
  pop.addEventListener('keydown', event => {
    if (!event.target.matches('.nt-tag-input') || event.isComposing || event.keyCode === 229) return;
    const value = event.target.value.trim();
    if (event.key === 'Enter' && value) { event.preventDefault(); add(value); }
    if (event.key === 'Escape') close();
    if (event.key === 'Backspace' && !event.target.value && selected.size) { selected.delete([...selected].pop()); save(); render(); }
  });

  let closed = false;
  /** 欄の外を押したら閉じる。 */
  const outside = event => { if (!pop.contains(event.target)) close(); };
  /** 閉じて表を描き直す(2回目以降は何もしない)。 */
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('pointerdown', outside, true);
    pop.remove();
    refresh();
  }
  document.body.append(pop);
  render();
  // 開いた時の押下で閉じないよう、外の押下の見張りは一拍おいて始める。
  // その一拍の間に閉じていたら始めない(始めると見張りが残り、次の押下で表が描き直されて操作が消える)。
  setTimeout(() => { if (!closed) document.addEventListener('pointerdown', outside, true); }, 0);
}
