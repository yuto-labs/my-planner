// ============================================================
// search.js - アプリ内データの横断検索
//
// タスク、予定、メモ、表現帳、Knowledgeを読み取り専用で照合する(照合はsearch-model.js)。
// メモ・表現帳・Knowledgeの結果はその項目の詳細を直接開き、他は各画面へ移動する。
// ============================================================

import {
  getTasks, getEvents, getGoals, getKnowledgeMemos, getExpressionEntries, getLearningEntries,
} from '../storage.js';
import { esc, formatDate, formatTime } from '../utils.js';
import { normalizeSearchText, searchAll } from '../search-model.js';
import { openKnowledgeMemo } from './memo.js';
import { openLearningEntry } from './learning-library.js';
import { showAtlasEntry } from './expression-atlas.js';

/** `nav`: 指定したハッシュ画面へ移動し、必要なら遷移元の状態を引き継ぐ。 */
const nav = (view) => window.AppNav?.navigate(view);

// 結果を押した時の開き方。詳細を直接開けない種類は、その一覧画面へ移動する。
const OPENERS = {
  memo: id => openKnowledgeMemo(id),
  learning: id => openLearningEntry(id),
  atlas: id => showAtlasEntry(id) || nav('expression-atlas'),
  task: () => nav('tasks'),
  event: () => nav('calendar'),
  goal: () => nav('goals'),
};
// 種類ごとに最初に見せる件数。多すぎると目的の種類まで届きにくい。
const VISIBLE_PER_KIND = 6;

/** 全機能を横断する検索オーバーレイを開き、入力へフォーカスする。 */
export function openSearch() {
  const overlay = document.getElementById('search-overlay');
  if (!overlay || !overlay.classList.contains('hidden')) return;

  overlay.innerHTML = `
    <div class="search-bar">
      <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" aria-hidden="true">
        <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
      </svg>
      <input
        class="input search-input"
        id="search-q"
        type="search"
        placeholder="メモ本文・表現帳・Knowledge・タスク・予定を検索..."
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false">
      <button class="search-close-btn" id="search-close" type="button">Close</button>
    </div>
    <div class="search-body" id="search-body">
      <div class="search-hint">
        <div class="search-hint-icon">⌕</div>
        キーワードを入力してください
      </div>
    </div>
  `;

  overlay.classList.remove('hidden');

  const input = overlay.querySelector('#search-q');
  const body = overlay.querySelector('#search-body');
  const closeBtn = overlay.querySelector('#search-close');

  requestAnimationFrame(() => input?.focus());

  let timer = null;
  input?.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) {
      body.innerHTML = `
        <div class="search-hint">
          <div class="search-hint-icon">⌕</div>
          キーワードを入力してください
        </div>
      `;
      return;
    }
    body.innerHTML = renderSkeleton();
    timer = setTimeout(() => renderResults(q, body), 80);
  });

  closeBtn?.addEventListener('click', closeSearch);

  /** `keyH`: 確認ダイアログのキーボード操作を処理する。 */
  const keyH = (e) => {
    if (e.key === 'Escape') {
      closeSearch();
      document.removeEventListener('keydown', keyH);
    }
  };
  document.addEventListener('keydown', keyH);

  body.addEventListener('click', (e) => {
    const item = e.target.closest('[data-result-kind]');
    if (!item) return;
    closeSearch();
    OPENERS[item.dataset.resultKind]?.(item.dataset.resultId);
  });
  body.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const item = e.target.closest('[data-result-kind]');
    if (!item) return;
    e.preventDefault();
    item.click();
  });
}

/** 検索オーバーレイを閉じ、登録したキーボード処理も解除する。 */
export function closeSearch() {
  const overlay = document.getElementById('search-overlay');
  if (!overlay) return;
  overlay.classList.add('hidden');
  overlay.innerHTML = '';
}

/** 横断検索の待機中にレイアウトが跳ねないよう、結果カード形状の骨組みを表示する。 */
function renderSkeleton() {
  return `
    <div class="task-skeleton-list">
      ${[92, 75, 84].map(w => `
        <div class="task-skeleton-item">
          <div class="skeleton task-skeleton-check"></div>
          <div class="task-skeleton-body">
            <div class="skeleton skeleton-line" style="width:${w}%"></div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

/** 結果の右側に出す補足(日付・時刻・タグ・意味など)を種類に合わせて整える。 */
function metaText(kind, item) {
  if (kind === 'task' && item.meta) return formatDate(item.meta, 'short');
  if (kind === 'event' && item.meta) return `${formatDate(item.meta, 'short')} ${formatTime(item.meta)}`;
  return item.meta;
}

/** クエリを全種類へ照合し(search-model.js)、詳細を直接開ける結果一覧を描画する。 */
function renderResults(q, container) {
  const groups = searchAll(q, {
    memos: getKnowledgeMemos(),
    learning: getLearningEntries(),
    atlas: getExpressionEntries(),
    tasks: getTasks(),
    events: getEvents().sort((a, b) => (b.start || '').localeCompare(a.start || '')),
    goals: getGoals(),
  });
  if (!groups.length) {
    container.innerHTML = `<div class="search-empty">「${esc(q)}」に一致する結果はありません</div>`;
    return;
  }
  // 抜粋は全角/半角をそろえた文字なので、強調にも同じくそろえた検索語を使う。
  const normalizedQ = normalizeSearchText(q);
  container.innerHTML = groups.map(({ kind, label, items }) => `
    <div class="search-group">
      <div class="search-group-label">${esc(label)} (${items.length})</div>
      ${items.slice(0, VISIBLE_PER_KIND).map(item => `
        <div class="search-result-item${item.raw.completed ? ' completed' : ''}" data-result-kind="${kind}" data-result-id="${esc(item.id || '')}" role="button" tabindex="0">
          <span class="search-result-main">
            <span class="search-result-title">${highlight(item.title, q)}</span>
            ${item.snippet ? `<span class="search-result-snippet">${highlight(item.snippet, normalizedQ)}</span>` : ''}
          </span>
          ${metaText(kind, item) ? `<span class="search-result-meta">${esc(metaText(kind, item))}</span>` : ''}
        </div>
      `).join('')}
      ${items.length > VISIBLE_PER_KIND ? `<div class="search-group-label search-group-more">他 ${items.length - VISIBLE_PER_KIND} 件</div>` : ''}
    </div>
  `).join('');
}

/** 検索語に一致する部分だけを安全なmark要素で囲み、結果内で見つけやすくする。 */
function highlight(text, q) {
  const safeText = text || '';
  if (!q) return esc(safeText);
  const lowerText = safeText.toLowerCase();
  const lowerQ = q.toLowerCase();
  let result = '';
  let i = 0;
  while (i < safeText.length) {
    const idx = lowerText.indexOf(lowerQ, i);
    if (idx === -1) {
      result += esc(safeText.slice(i));
      break;
    }
    result += esc(safeText.slice(i, idx));
    result += `<mark class="search-highlight">${esc(safeText.slice(idx, idx + q.length))}</mark>`;
    i = idx + q.length;
  }
  return result;
}
