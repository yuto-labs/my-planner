// ============================================================
// notion-table.js - データベースをNotionのような表で見せ、その場で書き換える部品
//
// 文字は折り返して全部見せ、セルを押すとその場で書き換えられる(Enterで確定、Shift+Enterで改行、
// Escで取り消し)。タグは色付きのラベル、URLは押すと開くリンク、チェックは押すだけで切り替わる。
// 見出しの右端をドラッグすると列の幅を変えられ、幅はデータベースに保存する(他の端末でも同じ幅)。
// ============================================================
import { addDatabaseRow, getDatabase, saveDatabase, updateDatabaseRow, updateKnowledgeMemo } from '../storage.js';
import { columnWidth, convertValue, formatValue, tagColor } from '../database-model.js';
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
};

/** タグ1つの色付きラベル。 */
const tagHtml = tag => `<span class="nt-tag" data-c="${tagColor(tag)}">${esc(tag)}</span>`;

/** セルの中身(表示用)。種類ごとに、Notionと同じ見せ方にする。 */
function cellHtml(prop, value) {
  if (prop.type === 'multi_select') return (Array.isArray(value) ? value : []).map(tagHtml).join('');
  if (prop.type === 'checkbox') return `<input type="checkbox" data-check${value ? ' checked' : ''} aria-label="${esc(prop.name)}">`;
  if (prop.type === 'url') {
    const href = normalizeMemoUrl(value);
    return href ? `<a class="nt-url" data-link href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(value)}</a>` : esc(value || '');
  }
  return esc(formatValue(prop.type, value));
}

/** 表の列(名前 + データベースの列)。名前の列の幅はデータベースに保存した titleWidth を使う。 */
const tableColumns = db => [{ ...TITLE, width: db.titleWidth }, ...db.properties];

/** Notionのような表のHTML。列の幅は <col> で決め、表全体の幅は列の合計にする(横にはみ出したら横スクロール)。 */
export function renderNotionTable(db, rows) {
  const columns = tableColumns(db);
  const widths = columns.map(columnWidth);
  return `
    <div class="nt-wrap">
      <table class="nt" style="width:${widths.reduce((sum, width) => sum + width, 0)}px">
        <colgroup>${widths.map(width => `<col style="width:${width}px">`).join('')}</colgroup>
        <thead><tr>${columns.map(col => `
          <th data-col="${esc(col.id)}" title="押すと列を編集">
            <span class="nt-th">${ICONS[col.type] || ICONS.text}<span class="nt-th-name">${esc(col.name)}</span></span>
            <span class="nt-resize" data-resize="${esc(col.id)}" aria-hidden="true"></span>
          </th>`).join('')}</tr></thead>
        <tbody>${rows.map(row => `
          <tr data-row="${esc(row.id)}">${columns.map(col => (col.id === TITLE.id ? `
            <td class="nt-td nt-td--title" data-edit="${TITLE.id}">
              <div class="nt-cell">${esc(row.title)}</div>
              <span class="nt-row-actions">
                <button class="nt-action" type="button" data-row-open="${esc(row.id)}">開く</button>
                <button class="nt-action db-delete" type="button" data-row-delete="${esc(row.id)}">削除</button>
              </span>
            </td>` : `
            <td class="nt-td nt-td--${col.type}" data-edit="${esc(col.id)}"><div class="nt-cell">${cellHtml(col, row.values[col.id])}</div></td>`)).join('')}
          </tr>`).join('')}</tbody>
      </table>
    </div>
    <button class="nt-add" type="button" data-nt-add>＋ 新規</button>`;
}

/**
 * 表を動くようにする。refresh は表を描き直す関数、onHeader は見出しを押した時(列の編集)、
 * onOpenRow は行のページを開く時に呼ぶ。スマホ(マウスで指せない端末)では名前を押すとページを開く。
 */
export function wireNotionTable(body, dbId, { refresh, onHeader, onOpenRow }) {
  let justResized = false;
  /** マウスで指せない端末(スマホ)か。スマホでは名前を押すとページを開く(書き換えは開いた先で)。 */
  const touchOnly = () => window.matchMedia?.('(hover: none)')?.matches;

  body.addEventListener('click', event => {
    if (event.target.closest('a, button:not([data-nt-add]), input, textarea, .nt-tag-pop')) return;
    if (event.target.closest('[data-nt-add]')) {
      // Notionと同じく、ページを開かずに表の最後へ1行足し、そのまま名前を書けるようにする。
      const id = addDatabaseRow(dbId, '');
      refresh();
      const td = body.querySelector(`tr[data-row="${CSS.escape(id || '')}"] [data-edit="${TITLE.id}"]`);
      if (td) startEdit(td, { blank: true });
      return;
    }
    const th = event.target.closest('th[data-col]');
    if (th) { if (!justResized && !event.target.closest('[data-resize]')) onHeader?.(); return; }
    const td = event.target.closest('td[data-edit]');
    if (!td) return;
    if (td.dataset.edit === TITLE.id && touchOnly()) { onOpenRow(td.closest('tr').dataset.row); return; }
    startEdit(td);
  });

  // チェックは押した時点で保存する。
  body.addEventListener('change', event => {
    const check = event.target.closest('[data-check]');
    if (!check) return;
    updateDatabaseRow(dbId, check.closest('tr').dataset.row, { [check.closest('td').dataset.edit]: check.checked });
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

  /** セルをその場の入力欄に変える。確定したら保存して表を描き直す。 */
  function startEdit(td, { blank = false } = {}) {
    const db = getDatabase(dbId);
    const rowId = td.closest('tr').dataset.row;
    const prop = td.dataset.edit === TITLE.id ? TITLE : db?.properties.find(item => item.id === td.dataset.edit);
    if (!db || !prop || prop.type === 'checkbox') return;
    const current = prop === TITLE ? td.querySelector('.nt-cell').textContent : db.rows[rowId]?.[prop.id];
    if (prop.type === 'multi_select') { openTagEditor(td, db, rowId, prop, refresh); return; }

    const editor = document.createElement(prop.type === 'date' ? 'input' : 'textarea');
    editor.className = 'nt-editor';
    if (prop.type === 'date') { editor.type = 'date'; editor.value = current?.start || ''; }
    else { editor.rows = 1; editor.value = blank ? '' : prop === TITLE ? current : prop.type === 'number' ? (current ?? '') : (current || ''); }
    /** 中身に合わせて入力欄の高さを伸ばす(長い文も全部見える)。 */
    const fit = () => { if (editor.tagName === 'TEXTAREA') { editor.style.height = 'auto'; editor.style.height = `${editor.scrollHeight}px`; } };
    td.classList.add('nt-editing');
    td.querySelector('.nt-cell').replaceChildren(editor);
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
}

/**
 * タグの選択欄。今のタグを外したり、この列で使ったことのあるタグを付けたり、新しく作ったりできる。
 * 付け外しはその場で保存し、欄の外を押すと閉じて表を描き直す。
 */
function openTagEditor(td, db, rowId, prop, refresh) {
  const selected = new Set(Array.isArray(db.rows[rowId]?.[prop.id]) ? db.rows[rowId][prop.id] : []);
  // この列のタグの候補 = どれかの行で使われているタグ。
  const options = [...new Set(Object.values(db.rows).flatMap(values => (Array.isArray(values?.[prop.id]) ? values[prop.id] : [])))];
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
      <div class="nt-tag-selected">${[...selected].map(tag => `<span class="nt-tag" data-c="${tagColor(tag)}">${esc(tag)}<button type="button" data-tag-remove="${esc(tag)}" aria-label="${esc(tag)}を外す">×</button></span>`).join('')}
        <input class="nt-tag-input" placeholder="タグを選ぶか、入力してEnter" value="${esc(query)}"></div>
      <div class="nt-tag-options">
        ${matches.map(tag => `<button type="button" class="nt-tag-option${selected.has(tag) ? ' is-on' : ''}" data-tag-toggle="${esc(tag)}">${tagHtml(tag)}</button>`).join('')}
        ${q && !options.includes(q) ? `<button type="button" class="nt-tag-option" data-tag-create="${esc(q)}">作る ${tagHtml(q)}</button>` : ''}
      </div>`;
    const input = pop.querySelector('.nt-tag-input');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  };
  /** 選んでいるタグを保存する。 */
  const save = () => updateDatabaseRow(db.id, rowId, { [prop.id]: [...selected] });
  /** タグを付ける(なければ候補にも足す)。 */
  const add = tag => { selected.add(tag); if (!options.includes(tag)) options.push(tag); save(); render(); };

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

  /** 欄の外を押したら閉じる。 */
  const outside = event => { if (!pop.contains(event.target)) close(); };
  /** 閉じて表を描き直す。 */
  function close() {
    document.removeEventListener('pointerdown', outside, true);
    pop.remove();
    refresh();
  }
  document.body.append(pop);
  render();
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
}
