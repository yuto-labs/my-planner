// ============================================================
// page-editor.js - データベースの行のページ本文を、その場で書き換えるエディタ
//
// サイドピーク(PC)やスマホの行のページで、メモ画面へ移らずに本文を直す。メモと同じ書き方ができる:
// - 行頭の記号で種類を変える(「# 」見出し、「- 」箇条書き、「1. 」番号、「[] 」チェック、「> 」引用、
//   「>> 」トグル、「--- 」区切り線、「``` 」コード)。記号の決まりはメモと共通(markdown-shortcuts.js)。
// - 空の行で「/」を打つか、上の「種類」ボタンで、ブロックの種類を選ぶ。
// - トグルは ▸ で開け閉めでき、中に書ける(Tabで前のトグルの中へ入れる、Shift+Tabで外へ出す)。
// - 太字・斜体・下線・マーカー(Ctrl+B / I / U、または上のボタン)。
// 保存の形はメモと同じ(text=文字だけ、html=装飾付き)。表・画像・数式はここでは表示だけ。
// 書いた内容は少し待ってからまとめて保存し、同期は保存の仕組みに任せる。
// ============================================================
import { getKnowledgeMemoById, updateKnowledgeMemo } from '../storage.js';
import { memoBlocksToText } from '../memo-model.js';
import { markdownBlockShortcut } from '../markdown-shortcuts.js';
import { esc, generateId } from '../utils.js';
import { getBlockRichHtml, renderBlocksView, sanitizeBlockHtml } from './memo.js';

// 選べるブロックの種類(メモの種類と同じ名前)。
const BLOCK_TYPES = [
  { type: 'paragraph', icon: 'Aa', label: 'テキスト', keys: 'text tekisuto' },
  { type: 'h1', icon: 'H1', label: '見出し1', keys: 'h1 heading midashi' },
  { type: 'h2', icon: 'H2', label: '見出し2', keys: 'h2 heading midashi' },
  { type: 'h3', icon: 'H3', label: '見出し3', keys: 'h3 heading midashi' },
  { type: 'bullet', icon: '•', label: '箇条書き', keys: 'bullet list' },
  { type: 'numbered', icon: '1.', label: '番号付き', keys: 'number list' },
  { type: 'checklist', icon: '☐', label: 'チェックリスト', keys: 'todo check' },
  { type: 'toggle', icon: '▸', label: 'トグル', keys: 'toggle' },
  { type: 'quote', icon: '❝', label: '引用', keys: 'quote' },
  { type: 'codeblock', icon: '<>', label: 'コード', keys: 'code' },
  { type: 'divider', icon: '─', label: '区切り線', keys: 'divider hr' },
];
// その場で書ける種類(それ以外=表・画像・数式などは表示だけ)。
const TEXT_TYPES = new Set(['paragraph', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'bullet', 'numbered', 'checklist', 'toggle', 'quote']);
// Enterで次の行を作る時に、同じ種類を続けるもの。それ以外は普通の文にする。
const CONTINUES = new Set(['bullet', 'numbered', 'checklist']);

/** 新しい空の行。 */
const newBlock = (type = 'paragraph') => ({ id: generateId(), type, text: '', html: '', color: null, ...(type === 'toggle' ? { children: [], collapsed: false } : {}) });

/** トグルが閉じているか(メモと同じ決まり: 保存値が無ければ、中身が無い時だけ閉じる)。 */
const isCollapsed = block => block.collapsed ?? !block.children?.length;

/**
 * ブロックを入れ子(トグルの中身)まで含めて探す。
 * @returns {{ list, index, parent }|null} list はそのブロックが入っている配列、parent はそれを持つトグル
 */
function locate(blocks, id, parent = null) {
  for (let index = 0; index < blocks.length; index += 1) {
    if (blocks[index].id === id) return { list: blocks, index, parent };
    const inner = Array.isArray(blocks[index].children) ? locate(blocks[index].children, id, blocks[index]) : null;
    if (inner) return inner;
  }
  return null;
}

/** ブロックの並びを、書ける行(または表示だけの行)のHTMLにする。depth はトグルの中の深さ。 */
function blocksHtml(blocks, depth = 0) {
  let number = 0;
  return blocks.map(block => {
    number = block.type === 'numbered' ? number + 1 : 0;
    const attrs = `style="--pe-depth:${depth}" data-block="${esc(block.id)}"`;
    if (block.type === 'divider') return `<div class="pe-block pe-divider" ${attrs}><hr></div>`;
    if (block.type === 'codeblock') {
      return `<div class="pe-block pe-codeblock" ${attrs}><pre class="pe-text pe-code" contenteditable="true" spellcheck="false">${esc(block.text || '')}</pre></div>`;
    }
    if (!TEXT_TYPES.has(block.type)) return `<div class="pe-block pe-static" ${attrs}>${renderBlocksView([block])}</div>`;
    const collapsed = block.type === 'toggle' && isCollapsed(block);
    const mark = block.type === 'checklist'
      ? `<input type="checkbox" class="pe-check" data-check-block="${esc(block.id)}"${block.checked ? ' checked' : ''} aria-label="完了">`
      : block.type === 'toggle' ? `<button class="pe-toggle-btn" type="button" data-toggle-block="${esc(block.id)}" aria-expanded="${!collapsed}" aria-label="${collapsed ? 'トグルを開く' : 'トグルを閉じる'}">${collapsed ? '▸' : '▾'}</button>`
        : block.type === 'numbered' ? `<span class="pe-mark">${number}.</span>`
          : block.type === 'bullet' ? '<span class="pe-mark">•</span>' : '';
    return `
      <div class="pe-block pe-${block.type}${block.checked ? ' is-checked' : ''}" ${attrs}>
        ${mark}<div class="pe-text" contenteditable="true">${getBlockRichHtml(block)}</div>
      </div>
      ${block.type === 'toggle' && !collapsed ? blocksHtml(block.children || [], depth + 1) : ''}`;
  }).join('');
}

/** 本文のエディタのHTML(上の道具の行 + 本文)。本文が空でも、書き始められる行を1つ出す。 */
export function renderPageEditor(memo) {
  return `
    <div class="pe-wrap" data-page="${esc(memo?.id || '')}">
      <div class="pe-tools" role="toolbar" aria-label="本文の書式">
        <button class="pe-tool pe-tool--type" type="button" data-pe-tool="type">種類 ▾</button>
        <button class="pe-tool" type="button" data-pe-tool="bold" aria-label="太字"><b>B</b></button>
        <button class="pe-tool" type="button" data-pe-tool="italic" aria-label="斜体"><i>I</i></button>
        <button class="pe-tool" type="button" data-pe-tool="underline" aria-label="下線"><u>U</u></button>
        <button class="pe-tool" type="button" data-pe-tool="mark" aria-label="マーカー"><span class="pe-tool-mark">M</span></button>
        <button class="pe-tool" type="button" data-pe-tool="indent" aria-label="前のトグルの中へ">⇥</button>
        <button class="pe-tool" type="button" data-pe-tool="outdent" aria-label="トグルの外へ">⇤</button>
      </div>
      <div class="pe">${blocksHtml(memo?.blocks?.length ? memo.blocks : [{ ...newBlock(), id: 'pe-empty' }])}</div>
    </div>`;
}

/** 書いている場所(文字カーソル)より前・後ろに文字があるか(行の先頭/最後かの判定に使う)。 */
function caretEdge(el, side) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.isCollapsed) return false;
  const caret = selection.getRangeAt(0);
  const range = document.createRange();
  range.selectNodeContents(el);
  if (side === 'start') range.setEnd(caret.startContainer, caret.startOffset);
  else range.setStart(caret.endContainer, caret.endOffset);
  return range.toString().length === 0;
}

/** 行の先頭から文字カーソルまでの文字数(選んでいる時は -1)。 */
function caretOffset(el) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.isCollapsed) return -1;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.setEnd(selection.getRangeAt(0).startContainer, selection.getRangeAt(0).startOffset);
  return range.toString().length;
}

/** 文字カーソルを、その行の最後(または先頭)へ置く。 */
function placeCaret(el, atEnd = true) {
  if (!el) return;
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(!atEnd);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

/** 入力欄の中身を、メモと同じ形(text=文字だけ、html=装飾付き)にする。改行(<br>)は文字では改行にする。 */
function readEditable(el) {
  if (el.classList.contains('pe-code')) return { text: el.textContent || '', html: '' };
  const html = el.innerHTML === '<br>' ? '' : sanitizeBlockHtml(el.innerHTML);
  const holder = document.createElement('div');
  holder.innerHTML = html.replace(/<br\s*\/?>/gi, '\n');
  return { text: holder.textContent || '', html };
}

/**
 * エディタを動くようにする。onSaved は保存した後に呼ぶ。
 * 保存は最後の入力から少し待って行い、エディタから出た時・アプリが裏に回った時にも必ず行う。
 */
export function wirePageEditor(root, memoId, onSaved) {
  const wrap = root.querySelector('.pe-wrap');
  const editor = root.querySelector('.pe');
  if (!wrap || !editor) return;
  // 作業用の写し。保存する時は、この本文だけを最新のページへ書き戻す。
  let blocks = JSON.parse(JSON.stringify(getKnowledgeMemoById(memoId)?.blocks || []));
  let saveTimer = null;
  let dirty = false;
  let currentId = null; // 最後に書いていた行(上の道具の行で、どの行を変えるかに使う)
  let menu = null;

  /** 本文を保存する(変わっていなければ何もしない)。 */
  const saveNow = () => {
    clearTimeout(saveTimer);
    if (!dirty) return;
    dirty = false;
    updateKnowledgeMemo(memoId, { blocks, summary: memoBlocksToText(blocks, 200) });
    onSaved?.();
  };
  /** 少し待ってから保存する(続けて打っている間は待ち続ける)。 */
  const saveSoon = () => { dirty = true; clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 700); };
  /** 本文を描き直し、指定した行に文字カーソルを置く。 */
  const redraw = (focusId, atEnd = true) => {
    editor.innerHTML = blocksHtml(blocks.length ? blocks : [{ ...newBlock(), id: 'pe-empty' }]);
    if (focusId) placeCaret(editor.querySelector(`[data-block="${CSS.escape(focusId)}"] .pe-text`), atEnd);
  };
  /** 行の入力欄から、そのブロックの場所。本文が空の時は、ここで最初の行を作る。 */
  const findFor = el => {
    const id = el.closest('[data-block]').dataset.block;
    if (id === 'pe-empty') {
      if (!blocks.length) blocks.push(newBlock());
      return { list: blocks, index: 0, parent: null };
    }
    return locate(blocks, id);
  };
  /** ブロックの種類を変える(トグルの中身や、区切り線・コードの決まりもメモと同じに整える)。 */
  const setType = (found, type, extra = {}) => {
    const block = found.list[found.index];
    if (block.type === 'toggle' && type !== 'toggle' && block.children?.length) found.list.splice(found.index + 1, 0, ...block.children);
    block.type = type;
    if (type === 'toggle') { block.children = block.children || []; block.collapsed = false; } else { delete block.children; delete block.collapsed; }
    if (type === 'checklist') block.checked = !!extra.checked; else delete block.checked;
    if (type === 'codeblock') { block.language = extra.language || ''; block.text = block.text || ''; block.html = ''; } else delete block.language;
    if (type === 'divider') {
      block.text = '';
      block.html = '';
      const next = newBlock();
      found.list.splice(found.index + 1, 0, next);
      return next.id;
    }
    return block.id;
  };

  // ---- 種類を選ぶメニュー(「/」または上の「種類」) ----
  /** メニューを閉じる。 */
  const closeMenu = () => { menu?.remove(); menu = null; };
  /** 行の下に種類のメニューを出す。fromSlash の時は、選んだら行の「/…」を消す。 */
  const openMenu = (el, fromSlash) => {
    closeMenu();
    const query = fromSlash ? (el.textContent || '').slice(1).trim().toLowerCase() : '';
    const items = BLOCK_TYPES.filter(item => !query || item.label.includes(query) || item.keys.includes(query));
    if (!items.length) return;
    menu = document.createElement('div');
    menu.className = 'db-pop pe-menu';
    menu.innerHTML = items.map(item => `<button class="db-pop-item" type="button" data-pe-type="${item.type}"><span class="pe-menu-icon">${esc(item.icon)}</span><span>${item.label}</span></button>`).join('');
    document.body.append(menu);
    const rect = el.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${rect.bottom + 4 + menu.offsetHeight > window.innerHeight ? Math.max(8, rect.top - menu.offsetHeight - 4) : rect.bottom + 4}px`;
    // メニューを押しても、書いていた行から文字カーソルが外れないようにする。
    menu.addEventListener('pointerdown', event => event.preventDefault());
    menu.addEventListener('click', event => {
      const type = event.target.closest('[data-pe-type]')?.dataset.peType;
      if (!type) return;
      const found = findFor(el);
      if (!found) return;
      if (fromSlash) { found.list[found.index].text = ''; found.list[found.index].html = ''; } else Object.assign(found.list[found.index], readEditable(el));
      const focusId = setType(found, type);
      closeMenu();
      redraw(focusId);
      saveSoon();
    });
  };

  editor.addEventListener('focusin', event => {
    const block = event.target.closest('[data-block]');
    if (block && event.target.closest('.pe-text')) currentId = block.dataset.block;
  });

  editor.addEventListener('input', event => {
    const el = event.target.closest('.pe-text');
    const found = el && findFor(el);
    if (!found) return;
    const block = found.list[found.index];
    Object.assign(block, readEditable(el));
    saveSoon();
    if (block.type === 'codeblock') return;
    // 「/」だけの行(または「/見出し」のように続けて打った行)で、種類のメニューを出す。
    if (/^\/\S{0,8}$/.test(block.text)) openMenu(el, true); else closeMenu();
    // 行頭の記号+空白で、種類を変える(メモと同じ記号)。打ったのが行頭の記号の直後の時だけ。
    const raw = block.text.replace(/ /g, ' ');
    const marker = raw.match(/^(- \[[ xX]\]|\[[ xX]?\]|#{1,6}|[-*+]|\d+\.|>>|>|---|```[a-z0-9_+-]*) /)?.[1];
    const shortcut = marker && markdownBlockShortcut(marker === '[]' ? '[ ]' : marker);
    if (!shortcut || caretOffset(el) !== marker.length + 1) return;
    const rest = raw.slice(marker.length + 1);
    block.text = rest;
    block.html = esc(rest);
    const focusId = setType(found, shortcut.type, shortcut);
    redraw(focusId, shortcut.type !== 'divider' && !rest);
    saveSoon();
  });

  // 貼り付けは文字だけにする(よそのページの色や太字の決まりを持ち込まない)。
  editor.addEventListener('paste', event => {
    if (!event.target.closest('.pe-text')) return;
    event.preventDefault();
    document.execCommand('insertText', false, event.clipboardData?.getData('text/plain') || '');
  });

  editor.addEventListener('change', event => {
    const check = event.target.closest('[data-check-block]');
    const found = check && locate(blocks, check.dataset.checkBlock);
    if (!found) return;
    found.list[found.index].checked = check.checked;
    check.closest('.pe-block').classList.toggle('is-checked', check.checked);
    dirty = true;
    saveNow();
  });

  editor.addEventListener('click', event => {
    const toggle = event.target.closest('[data-toggle-block]');
    const found = toggle && locate(blocks, toggle.dataset.toggleBlock);
    if (!found) return;
    const block = found.list[found.index];
    block.collapsed = !isCollapsed(block);
    redraw();
    saveSoon();
  });

  /** 今の行を、前の行がトグルならその中へ入れる(Tab)。入れたらtrue。 */
  const indent = (el, found) => {
    const previous = found.list[found.index - 1];
    if (previous?.type !== 'toggle') return false;
    Object.assign(found.list[found.index], readEditable(el));
    const [moved] = found.list.splice(found.index, 1);
    previous.children = [...(previous.children || []), moved];
    previous.collapsed = false;
    redraw(moved.id);
    saveSoon();
    return true;
  };
  /** 今の行を、入っているトグルの外(トグルのすぐ後ろ)へ出す(Shift+Tab)。出したらtrue。 */
  const outdent = (el, found) => {
    if (!found.parent) return false;
    Object.assign(found.list[found.index], readEditable(el));
    const [moved] = found.list.splice(found.index, 1);
    const outer = locate(blocks, found.parent.id);
    outer.list.splice(outer.index + 1, 0, moved);
    redraw(moved.id);
    saveSoon();
    return true;
  };

  editor.addEventListener('keydown', event => {
    const el = event.target.closest('.pe-text');
    if (!el || event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape' && menu) { event.preventDefault(); closeMenu(); return; }
    const found = findFor(el);
    if (!found) return;
    const block = found.list[found.index];
    const editables = [...editor.querySelectorAll('.pe-text')];
    const position = editables.indexOf(el);

    if (event.key === 'Tab') {
      event.preventDefault();
      if (event.shiftKey) outdent(el, found); else indent(el, found);
      return;
    }
    // 上下の矢印で、行の端から前後の行へ移る。
    if (event.key === 'ArrowUp' && caretEdge(el, 'start') && position > 0) { event.preventDefault(); placeCaret(editables[position - 1]); return; }
    if (event.key === 'ArrowDown' && caretEdge(el, 'end') && position < editables.length - 1) { event.preventDefault(); placeCaret(editables[position + 1], false); return; }
    // コードの中のEnterは改行(コードから出る時は上の「種類」かクリックで)。
    if (block.type === 'codeblock') {
      if (event.key === 'Enter') { event.preventDefault(); document.execCommand('insertText', false, '\n'); }
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      closeMenu();
      // 文字カーソルより後ろの文字を、新しい次の行へ移す(Notion・メモと同じ)。
      const selection = window.getSelection();
      const tail = document.createRange();
      tail.selectNodeContents(el);
      if (selection.rangeCount) tail.setStart(selection.getRangeAt(0).endContainer, selection.getRangeAt(0).endOffset);
      const holder = document.createElement('div');
      holder.append(tail.extractContents());
      Object.assign(block, readEditable(el));
      // 空の箇条書きなどでEnterを押したら、その種類をやめて普通の文にする。
      if ((CONTINUES.has(block.type) || block.type === 'quote') && !block.text && !holder.textContent) {
        setType(found, 'paragraph');
        redraw(block.id);
        saveSoon();
        return;
      }
      const tailHtml = holder.innerHTML === '<br>' ? '' : sanitizeBlockHtml(holder.innerHTML);
      const next = { ...newBlock(CONTINUES.has(block.type) ? block.type : 'paragraph'), html: tailHtml, text: holder.textContent || '' };
      // 開いているトグルの中身の先頭に作る(閉じている時は、トグルの次の行に作る)。
      if (block.type === 'toggle' && !isCollapsed(block)) block.children = [next, ...(block.children || [])];
      else found.list.splice(found.index + 1, 0, next);
      redraw(next.id, false);
      saveSoon();
      return;
    }

    if (event.key === 'Backspace' && caretEdge(el, 'start')) {
      // 行の先頭でBackspace: 前が区切り線なら消す。見出しや箇条書きは普通の文に戻す。
      // 普通の文は前の行とつなげる(トグルの中の先頭の行は、トグルの外へ出す)。
      if (found.list[found.index - 1]?.type === 'divider') {
        event.preventDefault();
        found.list.splice(found.index - 1, 1);
        redraw(block.id, false);
        saveSoon();
        return;
      }
      if (block.type !== 'paragraph') {
        event.preventDefault();
        Object.assign(block, readEditable(el));
        setType(found, 'paragraph');
        redraw(block.id, false);
        saveSoon();
        return;
      }
      if (found.parent && found.index === 0) { event.preventDefault(); outdent(el, found); return; }
      const previousEl = editables[position - 1];
      const previousFound = previousEl && findFor(previousEl);
      const previous = previousFound?.list[previousFound.index];
      if (!previous || previous.type === 'codeblock') return;
      event.preventDefault();
      Object.assign(block, readEditable(el));
      previous.html = sanitizeBlockHtml(`${previous.html || esc(previous.text || '')}${block.html || esc(block.text || '')}`);
      previous.text = `${previous.text || ''}${block.text || ''}`;
      found.list.splice(found.index, 1);
      redraw(previous.id);
      saveSoon();
    }
  });

  // ---- 上の道具の行(種類・太字・斜体・下線・マーカー・字下げ) ----
  const tools = wrap.querySelector('.pe-tools');
  // 道具を押しても、書いていた行の文字カーソル(選んだ文字)が外れないようにする。
  tools.addEventListener('pointerdown', event => event.preventDefault());
  tools.addEventListener('click', event => {
    const tool = event.target.closest('[data-pe-tool]')?.dataset.peTool;
    const el = currentId && editor.querySelector(`[data-block="${CSS.escape(currentId)}"] .pe-text`);
    if (!tool || !el) return;
    if (tool === 'type') { openMenu(el, false); return; }
    const found = findFor(el);
    if (!found) return;
    if (tool === 'indent') { indent(el, found); return; }
    if (tool === 'outdent') { outdent(el, found); return; }
    el.focus();
    if (tool === 'mark') document.execCommand('hiliteColor', false, 'rgba(245, 197, 66, 0.45)');
    else document.execCommand(tool);
    Object.assign(found.list[found.index], readEditable(el));
    saveSoon();
  });

  // エディタから出た時(別の場所を押した・閉じた)と、アプリが裏に回った時は、待たずに保存する。
  wrap.addEventListener('focusout', () => setTimeout(() => {
    if (wrap.contains(document.activeElement)) return;
    closeMenu();
    saveNow();
  }, 0));
  /** アプリが裏に回ったら保存する。このエディタが画面から消えていたら、見張りをやめる(開くたびに増えないように)。 */
  const onHide = () => {
    if (!wrap.isConnected) { document.removeEventListener('visibilitychange', onHide); return; }
    if (document.hidden) saveNow();
  };
  document.addEventListener('visibilitychange', onHide);
}
