// ============================================================
// page-editor.js - データベースの行のページ本文を、その場で書き換える軽いエディタ
//
// サイドピーク(PC)やスマホの行のページで、メモ画面へ移らずに本文を直すために使う。
// 文・見出し・箇条書き・番号・チェック・引用・トグルは、そのまま押して書ける。
// 表・画像・数式などの複雑なブロックは、ここでは表示だけ(「全画面で開く」のいつもの画面で直す)。
// 書いた内容は少し待ってからまとめて保存し(打つたびに保存しない)、同期は保存の仕組みに任せる。
// ============================================================
import { getKnowledgeMemoById, updateKnowledgeMemo } from '../storage.js';
import { memoBlocksToText } from '../memo-model.js';
import { esc, generateId } from '../utils.js';
import { renderBlocksView } from './memo.js';

// その場で書き換えられるブロックの種類と、行の頭に付ける印。
const EDITABLE = { paragraph: '', h1: '', h2: '', h3: '', bullet: '•', numbered: '', checklist: '', quote: '', toggle: '▸' };
// Enterで次の行を作る時に、同じ種類を続けるもの(箇条書きなど)。それ以外は普通の文にする。
const CONTINUES = new Set(['bullet', 'numbered', 'checklist']);

/** ブロックを入れ子(トグルの中身)まで含めて、id から { list, index } を探す。 */
function locate(blocks, id) {
  for (let index = 0; index < blocks.length; index += 1) {
    if (blocks[index].id === id) return { list: blocks, index };
    const inner = Array.isArray(blocks[index].children) ? locate(blocks[index].children, id) : null;
    if (inner) return inner;
  }
  return null;
}

/** ブロックの並びを、書ける行(または表示だけの行)のHTMLにする。depth はトグルの中の深さ。 */
function blocksHtml(blocks, depth = 0) {
  let number = 0;
  return blocks.map(block => {
    number = block.type === 'numbered' ? number + 1 : 0;
    if (!(block.type in EDITABLE)) {
      return `<div class="pe-block pe-static" style="--pe-depth:${depth}" data-block="${esc(block.id)}">${renderBlocksView([block])}</div>`;
    }
    const mark = block.type === 'checklist'
      ? `<input type="checkbox" class="pe-check" data-check-block="${esc(block.id)}"${block.checked ? ' checked' : ''} aria-label="完了">`
      : block.type === 'numbered' ? `<span class="pe-mark">${number}.</span>` : EDITABLE[block.type] ? `<span class="pe-mark">${EDITABLE[block.type]}</span>` : '';
    return `
      <div class="pe-block pe-${block.type}${block.checked ? ' is-checked' : ''}" style="--pe-depth:${depth}" data-block="${esc(block.id)}">
        ${mark}<div class="pe-text" contenteditable="true" data-placeholder="${depth || blocks.length > 1 ? '' : '本文を書く…'}">${block.text || ''}</div>
      </div>
      ${block.type === 'toggle' && Array.isArray(block.children) ? blocksHtml(block.children, depth + 1) : ''}`;
  }).join('');
}

/** 本文のエディタのHTML。本文が空なら、書き始められる空の行を1つ出す。 */
export function renderPageEditor(memo) {
  const blocks = memo?.blocks?.length ? memo.blocks : [{ id: 'pe-empty', type: 'paragraph', text: '' }];
  return `<div class="pe" data-page="${esc(memo?.id || '')}">${blocksHtml(blocks)}</div>`;
}

/** 書いている場所(文字カーソル)が、その行の先頭にあるか。 */
function caretAtStart(el) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.isCollapsed) return false;
  const range = selection.getRangeAt(0).cloneRange();
  range.selectNodeContents(el);
  range.setEnd(selection.getRangeAt(0).startContainer, selection.getRangeAt(0).startOffset);
  return range.toString().length === 0;
}

/** 文字カーソルを、その行の最後(または先頭)へ置く。 */
function placeCaret(el, atEnd = true) {
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(!atEnd);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

/** 入力欄の中身を保存用の文字にする(何も書いていない時にブラウザが入れる <br> は空として扱う)。 */
const textOf = el => (el.innerHTML === '<br>' ? '' : el.innerHTML);

/**
 * エディタを動くようにする。onSaved は保存した後に呼ぶ(一覧の表示を新しくするため)。
 * 保存は最後の入力から少し待って行い、ページを離れる時(入力欄から出た時)にも必ず行う。
 */
export function wirePageEditor(root, memoId, onSaved) {
  const editor = root.querySelector('.pe');
  if (!editor) return;
  // 作業用の写し。保存の直前に、最新のページへこの本文だけを書き戻す。
  let blocks = JSON.parse(JSON.stringify(getKnowledgeMemoById(memoId)?.blocks || []));
  let saveTimer = null;
  let dirty = false;

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
  /** 作業用の本文で、エディタを描き直す。 */
  const redraw = () => { editor.innerHTML = blocksHtml(blocks.length ? blocks : [{ id: 'pe-empty', type: 'paragraph', text: '' }]); };
  /** 行の入力欄から、その行のブロック(なければ空の本文に最初の行を作る)。 */
  const blockOf = el => {
    const id = el.closest('[data-block]').dataset.block;
    if (id === 'pe-empty' && !blocks.length) blocks.push({ id: generateId(), type: 'paragraph', text: '' });
    return id === 'pe-empty' ? blocks[0] : locate(blocks, id)?.list[locate(blocks, id).index];
  };

  editor.addEventListener('input', event => {
    const el = event.target.closest('.pe-text');
    const block = el && blockOf(el);
    if (!block) return;
    block.text = textOf(el);
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
  editor.addEventListener('keydown', event => {
    const el = event.target.closest('.pe-text');
    if (!el || event.isComposing || event.keyCode === 229) return;
    const block = blockOf(el);
    const found = block && locate(blocks, block.id);
    if (!found) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      // 文字カーソルより後ろの文字を、新しい次の行へ移す(Notionと同じ)。
      event.preventDefault();
      const selection = window.getSelection();
      const tail = document.createRange();
      tail.selectNodeContents(el);
      if (selection.rangeCount) tail.setStart(selection.getRangeAt(0).endContainer, selection.getRangeAt(0).endOffset);
      const holder = document.createElement('div');
      holder.append(tail.extractContents());
      block.text = textOf(el);
      // 空の箇条書きでEnterを押したら、箇条書きをやめて普通の文にする。
      if (CONTINUES.has(block.type) && !block.text && !holder.innerHTML) {
        block.type = 'paragraph';
        redraw();
        placeCaret(editor.querySelector(`[data-block="${CSS.escape(block.id)}"] .pe-text`));
        saveSoon();
        return;
      }
      const next = { id: generateId(), type: CONTINUES.has(block.type) ? block.type : 'paragraph', text: holder.innerHTML === '<br>' ? '' : holder.innerHTML };
      found.list.splice(found.index + 1, 0, next);
      redraw();
      placeCaret(editor.querySelector(`[data-block="${CSS.escape(next.id)}"] .pe-text`), false);
      saveSoon();
    } else if (event.key === 'Backspace' && caretAtStart(el)) {
      // 行の先頭でBackspace: 箇条書きなどは普通の文に戻し、普通の文は前の行とつなげる。
      if (block.type !== 'paragraph') {
        event.preventDefault();
        block.type = 'paragraph';
        redraw();
        placeCaret(editor.querySelector(`[data-block="${CSS.escape(block.id)}"] .pe-text`), false);
        saveSoon();
        return;
      }
      const previousEl = [...editor.querySelectorAll('.pe-text')].at([...editor.querySelectorAll('.pe-text')].indexOf(el) - 1);
      if (!previousEl || previousEl === el) return;
      const previous = blockOf(previousEl);
      if (!previous || (block.children?.length)) return;
      event.preventDefault();
      previous.text = `${previous.text}${block.text}`;
      found.list.splice(found.index, 1);
      redraw();
      placeCaret(editor.querySelector(`[data-block="${CSS.escape(previous.id)}"] .pe-text`));
      saveSoon();
    }
  });
  // 入力欄から出た時(別の場所を押した・閉じた)は、待たずに保存する。
  editor.addEventListener('focusout', () => setTimeout(() => { if (!editor.contains(document.activeElement)) saveNow(); }, 0));
}
