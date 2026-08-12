// ============================================================
// knowledge.js — Knowledge Memo: list + block editor + viewer
// ============================================================

import {
  getKnowledgeMemos, getKnowledgeMemoById,
  addKnowledgeMemo, updateKnowledgeMemo, deleteKnowledgeMemo,
  getTermExplanation, setTermExplanation, isAiAvailable,
  scheduleFirstReview, getReviewEntry,
  rateReview, previewReviewIntervals, setReviewStage,
  setMemoReviewEnabled, isMemoReviewEnabled,
  MASTERY_STAGE, REVIEW_DISABLED_STAGE, STAGE_INTERVALS,
  addToPendingAIQueue, removeFromPendingAIQueue,
  pushUndo, applyUndo, addReviewLog, getReviewLog,
  getTags, addTag,
} from '../storage.js';
import {
  suggestKnowledgeTags, explainTerm, summarizeAndTagText,
  suggestUnstudiedTopics, formatKnowledgeMemo,
} from '../ai.js';
import { esc, generateId, today, formatDate, fmtDays, daysSince } from '../utils.js';
import {
  deletePlannerImage,
  hydratePlannerImages,
  uploadPlannerImage,
  wirePlannerImageViewer,
} from '../media.js';
import { flushPendingSync } from '../sync.js';

const nav       = (view, options = {}) => window.AppNav?.navigate(view, options);
const toast     = (msg, type) => window.AppNav?.showToast(msg, type);
const undoToast = (msg, cb)   => window.AppNav?.showUndoToast(msg, cb);

// ============================================================
// Module-level shared state (persists across navigations)
// ============================================================

let currentMemoId  = null;  // null = new memo
let pendingNewOpts = null;  // { tags:[], content:'' }
let activeEditorBlockId = null;
let editorBaseline = '';
let pendingImageUploads = new Set();
let pendingImageDeletes = new Set();
let editorSessionToken = 0;
const EDITOR_HISTORY_LIMIT = 80;
const KNOWLEDGE_TAG_RECENCY_KEY = 'mp_knowledge_tag_recency';
let editorUndoHistory = [];
let editorRedoHistory = [];
let editorTypingHistoryOpen = false;
let editorTypingHistoryTimer = null;
let editorHistoryRestoring = false;

// ---- Navigation history for swipe-back ----
let _knHistory           = [];  // [{memoId: string|null, scrollTop: number}]
let _pendingListScrollTop = 0;
let _pendingListAnchorId = null;
let _pendingDetailScrollTop = 0;
let _backFromDetail      = false;
let _detailGestureCleanup = null;

export function openKnowledgeMemo(id) {
  const main = document.getElementById('main-content');
  const fromDetail = main?.dataset.view === 'knowledge-detail';
  _knHistory.push({
    memoId: fromDetail ? currentMemoId : null,
    scrollTop: main?.scrollTop || 0,
    anchorId: fromDetail ? currentMemoId : id,
  });
  currentMemoId  = id;
  pendingNewOpts = null;

  const routeHash = `knowledge-detail?id=${encodeURIComponent(id)}`;
  if (fromDetail && main) {
    window.history.replaceState(null, '', `#${routeHash}`);
    initKnowledgeDetail(main);
  } else nav('knowledge-detail', { routeHash });

  if (fromDetail && main) main.scrollTop = 0;
}

export function backFromKnowledgeDetail() {
  if (!confirmDiscardKnowledgeChanges()) return;
  const prev = _knHistory.pop();
  if (!prev || prev.memoId === null) {
    _pendingListScrollTop = prev?.scrollTop || 0;
    _pendingListAnchorId = prev?.anchorId || null;
    _backFromDetail = true;
    window.AppNav?.navigate('memo', { preserveScroll: true, skipUnsavedGuard: true });
  } else {
    currentMemoId = prev.memoId;
    _pendingDetailScrollTop = prev.scrollTop || 0;
    const routeHash = `knowledge-detail?id=${encodeURIComponent(prev.memoId)}`;
    const main = document.getElementById('main-content');
    if (main?.dataset.view === 'knowledge-detail') {
      window.history.replaceState(null, '', `#${routeHash}`);
      initKnowledgeDetail(main);
    } else nav('knowledge-detail', { routeHash });
  }
}

function editorSnapshot() {
  return JSON.stringify({
    title: edState.title,
    blocks: edState.blocks,
    tags: edState.tags,
    url: edState.url,
    starred: edState.starred,
    reviewEnabled: edState.reviewEnabled,
  });
}

function markEditorBaseline() {
  editorBaseline = editorSnapshot();
}

function editorHistorySnapshot() {
  return {
    title: edState.title,
    blocks: deepClone(edState.blocks),
    tags: [...edState.tags],
    url: edState.url,
    starred: edState.starred,
    reviewEnabled: edState.reviewEnabled,
    activeBlockId: activeEditorBlockId,
  };
}

function resetEditorHistory() {
  editorUndoHistory = [];
  editorRedoHistory = [];
  editorTypingHistoryOpen = false;
  clearTimeout(editorTypingHistoryTimer);
  editorTypingHistoryTimer = null;
}

function updateEditorHistoryControls(container) {
  const undo = container?.querySelector('#kn-undo-btn');
  const redo = container?.querySelector('#kn-redo-btn');
  if (undo) {
    undo.disabled = !editorUndoHistory.length;
  }
  if (redo) {
    redo.disabled = !editorRedoHistory.length;
  }
}

function recordEditorHistory(container) {
  if (!edState.isEdit || editorHistoryRestoring) return;
  editorTypingHistoryOpen = false;
  clearTimeout(editorTypingHistoryTimer);
  const snapshot = editorHistorySnapshot();
  const last = editorUndoHistory.at(-1);
  if (last && JSON.stringify(last) === JSON.stringify(snapshot)) return;
  editorUndoHistory.push(snapshot);
  if (editorUndoHistory.length > EDITOR_HISTORY_LIMIT) editorUndoHistory.shift();
  editorRedoHistory = [];
  updateEditorHistoryControls(container);
}

function beginEditorTextHistory(container) {
  if (!editorTypingHistoryOpen) recordEditorHistory(container);
  editorTypingHistoryOpen = true;
  clearTimeout(editorTypingHistoryTimer);
  editorTypingHistoryTimer = setTimeout(() => {
    editorTypingHistoryOpen = false;
    editorTypingHistoryTimer = null;
  }, 700);
}

function restoreEditorHistory(container, direction) {
  const from = direction === 'undo' ? editorUndoHistory : editorRedoHistory;
  const to = direction === 'undo' ? editorRedoHistory : editorUndoHistory;
  const snapshot = from.pop();
  if (!snapshot) return;
  const scrollOwner = document.getElementById('main-content');
  const scrollTop = scrollOwner?.scrollTop || 0;
  // A keyboard undo should leave the user in the same block, but clicking the
  // toolbar should not steal focus or jump the page back to that block.
  const restoreEditableFocus = document.activeElement?.matches?.('[contenteditable="true"], textarea, input') || false;
  to.push(editorHistorySnapshot());
  if (to.length > EDITOR_HISTORY_LIMIT) to.shift();
  clearTimeout(editorTypingHistoryTimer);
  editorTypingHistoryOpen = false;
  edState = {
    ...edState,
    title: snapshot.title,
    blocks: deepClone(snapshot.blocks),
    tags: [...snapshot.tags],
    url: snapshot.url,
    starred: snapshot.starred,
    reviewEnabled: snapshot.reviewEnabled,
    isEdit: true,
  };
  activeEditorBlockId = snapshot.activeBlockId
    && findBlockInAllBlocks(edState.blocks, snapshot.activeBlockId)
    ? snapshot.activeBlockId
    : edState.blocks[0]?.id || null;
  // Rendering rebuilds the editor UI. Keep the history stacks intact even if a
  // render-time handler runs while the restored block tree is being mounted.
  const undoHistory = editorUndoHistory;
  const redoHistory = editorRedoHistory;
  editorHistoryRestoring = true;
  renderEditMode(container, { preserveHistory: true });
  editorUndoHistory = undoHistory;
  editorRedoHistory = redoHistory;
  // Keep the viewport stable while the block tree is rebuilt. Re-focusing
  // through the old helper selected the end of the block and made the page
  // visibly jump on every undo/redo.
  requestAnimationFrame(() => {
    if (scrollOwner) scrollOwner.scrollTop = scrollTop;
    editorHistoryRestoring = false;
    updateEditorHistoryControls(container);
    if (restoreEditableFocus && activeEditorBlockId) {
      const editable = container.querySelector(`.kn-block-focusable[data-block-id="${activeEditorBlockId}"]`);
      focusEditableWithoutScroll(editable);
    }
  });
}

export function hasUnsavedKnowledgeChanges() {
  return !!edState?.isEdit && editorSnapshot() !== editorBaseline;
}

export function confirmDiscardKnowledgeChanges() {
  return !hasUnsavedKnowledgeChanges()
    || window.confirm('未保存の変更があります。破棄して移動しますか？');
}

const knBack = backFromKnowledgeDetail;

export function openNewKnowledgeMemo(opts = {}) {
  currentMemoId  = null;
  pendingNewOpts = opts;
  nav('knowledge-detail', { routeHash: 'knowledge-detail?new=1' });
}

// ============================================================
// Block constants
// ============================================================

const BLOCK_TYPES = [
  { type: 'paragraph', icon: '¶',  label: 'テキスト'         },
  { type: 'h1',        icon: 'H1', label: '見出し1'           },
  { type: 'h2',        icon: 'H2', label: '見出し2'           },
  { type: 'h3',        icon: 'H3', label: '見出し3'           },
  { type: 'bullet',    icon: '•',  label: '箇条書き'          },
  { type: 'numbered',  icon: '1.',  label: '番号付き'         },
  { type: 'quote',     icon: '❝',  label: '引用'              },
  { type: 'toggle',    icon: '▶',  label: 'トグル'            },
  { type: 'math',      icon: 'Σ',  label: '数式(KaTeX)'       },
  { type: 'table',     icon: '▦',  label: '表'                },
  { type: 'divider',   icon: '─',  label: '区切り線'          },
];

const BLOCK_COLORS = [
  { id: 'default', label: 'デフォルト', css: '' },
  { id: 'purple',  label: '紫',         css: 'var(--primary)' },
  { id: 'green',   label: '緑',         css: 'var(--success)' },
  { id: 'red',     label: '赤',         css: '#F07090'        },
  { id: 'orange',  label: '橙',         css: '#F5C542'        },
  { id: 'blue',    label: '青',         css: '#60A5FA'        },
  { id: 'muted',   label: '薄字',       css: 'var(--text-muted)' },
];

const HIGHLIGHT_COLORS = [
  { id: 'clear',  label: 'マーカーを解除', css: 'transparent' },
  { id: 'yellow', label: '黄色',           css: '#F5C542' },
  { id: 'green',  label: '緑',             css: '#8FD0A6' },
  { id: 'blue',   label: '水色',           css: '#8EC5FF' },
  { id: 'pink',   label: 'ピンク',         css: '#F5A3C7' },
  { id: 'purple', label: '紫',             css: '#C9A7F5' },
];

const TEMPLATES = {
  study: {
    label: '📚 勉強まとめ',
    title: '勉強まとめ',
    blocks: [
      { type: 'h1',       text: '📚 勉強まとめ' },
      { type: 'h2',       text: '概要' },
      { type: 'paragraph',text: '' },
      { type: 'h2',       text: '重要なポイント' },
      { type: 'bullet',   text: 'ポイント1' },
      { type: 'bullet',   text: 'ポイント2' },
      { type: 'h2',       text: '用語メモ' },
      { type: 'paragraph',text: '' },
      { type: 'h2',       text: '数式・公式' },
      { type: 'math',     text: '' },
      { type: 'h2',       text: '感想・疑問' },
      { type: 'paragraph',text: '' },
    ],
  },
  meeting: {
    label: '📋 ミーティングメモ',
    title: 'ミーティングメモ',
    blocks: [
      { type: 'h1',       text: '📋 ミーティングメモ' },
      { type: 'paragraph',text: `日時: ${today()}` },
      { type: 'h2',       text: '参加者' },
      { type: 'bullet',   text: '' },
      { type: 'h2',       text: 'アジェンダ' },
      { type: 'numbered', text: '' },
      { type: 'h2',       text: '議事録' },
      { type: 'paragraph',text: '' },
      { type: 'h2',       text: 'ネクストアクション' },
      { type: 'bullet',   text: '[ ] ' },
    ],
  },
  book: {
    label: '📖 読書メモ',
    title: '読書メモ',
    blocks: [
      { type: 'h1',       text: '📖 読書メモ' },
      { type: 'paragraph',text: '著者: ' },
      { type: 'h2',       text: '一言まとめ' },
      { type: 'quote',    text: '' },
      { type: 'h2',       text: 'キーアイデア' },
      { type: 'bullet',   text: '' },
      { type: 'h2',       text: '印象に残ったフレーズ' },
      { type: 'quote',    text: '' },
      { type: 'h2',       text: '行動に移すこと' },
      { type: 'numbered', text: '' },
    ],
  },
};

// ============================================================
// LIST VIEW
// ============================================================

const MEMO_LIST_PAGE_SIZE = 40;
const memoSearchIndex = new Map();
let listState = {
  search: '',
  filterTag: null,
  container: null,
  visibleCount: MEMO_LIST_PAGE_SIZE,
};

export function initKnowledge(container) {
  const returningFromDetail = _backFromDetail;
  if (!returningFromDetail) _knHistory = [];
  _backFromDetail = false;
  listState.container = container;
  if (returningFromDetail) {
    container.classList.add('kn-restoring-scroll');
    renderList();
    restoreKnowledgeListPosition();
    return;
  }
  // Brief skeleton flash for smooth navigation feel
  container.innerHTML = `
    <div class="task-skeleton-list" style="padding:12px 16px">
      ${[80, 60, 90, 70].map(w => `
        <div class="task-skeleton-item">
          <div class="skeleton task-skeleton-check"></div>
          <div class="task-skeleton-body">
            <div class="skeleton skeleton-line" style="width:${w}%"></div>
            <div class="skeleton skeleton-line" style="width:${Math.round(w * 0.6)}%;margin-top:4px"></div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
  requestAnimationFrame(() => {
    if (!container.isConnected) return;
    renderList();
    restoreKnowledgeListPosition();
  });
}

function restoreKnowledgeListPosition() {
  const targetTop = _pendingListScrollTop;
  const anchorId = _pendingListAnchorId;
  const mainNow = document.getElementById('main-content');
  if (!targetTop && !anchorId) {
    mainNow?.classList.remove('kn-restoring-scroll');
    return;
  }

  if (mainNow?.dataset.view === 'memo' && targetTop > 0) {
    mainNow.scrollTop = targetTop;
  }

  requestAnimationFrame(() => {
    const main = document.getElementById('main-content');
    if (!main || main.dataset.view !== 'memo') return;

    if (targetTop > 0) main.scrollTop = targetTop;

    // Fallback: if layout height changed and exact scroll did not stick,
    // keep the tapped memo around the same visual area instead of jumping top.
    if (anchorId && targetTop > 0 && main.scrollTop < Math.min(40, targetTop)) {
      const card = main.querySelector(`[data-memo-id="${CSS.escape(anchorId)}"]`);
      card?.scrollIntoView({ block: 'center' });
    }

    _pendingListScrollTop = 0;
    _pendingListAnchorId = null;
    main.classList.remove('kn-restoring-scroll');
  });
}

function renderList() {
  const { container, search, filterTag } = listState;
  const memos = [...getKnowledgeMemos()].sort((a, b) => {
    const aTime = Date.parse(a.updatedAt || a.createdAt || '') || 0;
    const bTime = Date.parse(b.updatedAt || b.createdAt || '') || 0;
    return bTime - aTime;
  });
  const allTags = [...new Set(memos.flatMap(m => m.tags || []))].sort();
  if (search) pruneMemoSearchIndex(memos);
  else memoSearchIndex.clear();

  const filtered = memos.filter(m => {
    const q = search.toLowerCase();
    const matchSearch = !q || memoSearchText(m).includes(q);
    const matchTag = !filterTag || (m.tags || []).includes(filterTag);
    return matchSearch && matchTag;
  });

  const orderedMemos = [...filtered].sort((a, b) => Number(Boolean(b.starred)) - Number(Boolean(a.starred)));
  const visibleMemos = orderedMemos.slice(0, listState.visibleCount);
  const visibleTotal = visibleMemos.length;
  const visibleStarred = visibleMemos.filter(memo => memo.starred);
  const visibleRegular = visibleMemos.filter(memo => !memo.starred);

  container.innerHTML = `
    <div class="kn-list-page">
      <!-- Search + new -->
      <div class="kn-search-bar">
        <div class="kn-search-wrap">
          <svg class="kn-search-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
          </svg>
          <input class="kn-search-input" id="kn-search" placeholder="検索…" value="${esc(search)}" type="search">
        </div>
        <button class="btn btn-ghost btn-sm kn-atlas-entry-btn" id="kn-atlas-btn" type="button" title="NUANCE ATLASを開く">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
            <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z"/>
            <path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5v-16Z"/>
          </svg>
          表現帳
        </button>
        <button class="btn btn-ghost btn-sm" id="kn-graph-btn" title="知識グラフ" style="flex-shrink:0;padding:6px 10px">
          🕸️
        </button>

        <button class="btn btn-primary btn-sm" id="kn-new-btn">
          <svg viewBox="0 0 24 24" fill="currentColor" style="width:14px;height:14px"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
          新規
        </button>
      </div>

      <!-- Tag filters -->
      ${allTags.length ? `
        <div class="kn-tag-filters">
          <button class="kn-tag-filter-btn${!filterTag ? ' active' : ''}" data-filter-tag="">すべて</button>
          ${allTags.map(t => `
            <button class="kn-tag-filter-btn${filterTag === t ? ' active' : ''}" data-filter-tag="${esc(t)}">${esc(t)}</button>
          `).join('')}
        </div>
      ` : ''}

      <!-- Memo list -->
      <div class="kn-memo-list">
        ${visibleStarred.length ? `
          <div class="kn-list-section-label">⭐ ピン留め</div>
          ${visibleStarred.map(renderMemoCard).join('')}
          ${visibleRegular.length ? '<div class="kn-list-section-label kn-list-section-label--gap">すべてのメモ</div>' : ''}
        ` : filtered.length ? '<div class="kn-list-section-label">すべてのメモ</div>' : ''}
        ${visibleRegular.map(renderMemoCard).join('')}
        ${visibleTotal < filtered.length ? `
          <button class="kn-load-more-btn" id="kn-load-more" type="button">
            さらに表示
            <span>${visibleTotal} / ${filtered.length}</span>
          </button>
        ` : ''}
        ${!filtered.length ? `
          <div class="empty-state">
            <div class="empty-state-icon">📝</div>
            <div class="empty-state-text">${search || filterTag ? '該当なし' : 'メモがありません'}</div>
            <div class="empty-state-sub">右上から新しいメモを作れます</div>
          </div>
        ` : ''}
      </div>
    </div>
  `;

  // Wire search (IME-safe: avoid rerendering on every composition keystroke)
  const searchEl = container.querySelector('#kn-search');
  let searchTimer = null;
  let composing = false;
  const applySearch = () => {
    if (!searchEl) return;
    listState.search = searchEl.value;
    listState.visibleCount = MEMO_LIST_PAGE_SIZE;
    renderList();
    requestAnimationFrame(() => {
      const next = container.querySelector('#kn-search');
      if (!next) return;
      next.focus();
      const end = next.value.length;
      try { next.setSelectionRange(end, end); } catch {}
    });
  };
  searchEl?.addEventListener('compositionstart', () => {
    composing = true;
  });
  searchEl?.addEventListener('compositionend', () => {
    composing = false;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applySearch, 0);
  });
  searchEl?.addEventListener('input', () => {
    if (composing) return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applySearch, 120);
  });

  // Wire graph navigation
  container.querySelector('#kn-graph-btn')?.addEventListener('click', () => nav('knowledge-graph'));

  // Wire expression atlas navigation
  container.querySelector('#kn-atlas-btn')?.addEventListener('click', () => nav('expression-atlas'));

  // Wire new
  container.querySelector('#kn-new-btn')?.addEventListener('click', () => startNewMemo(null));

  // Wire tag filters
  container.querySelectorAll('[data-filter-tag]').forEach(btn => {
    btn.addEventListener('click', () => {
      listState.filterTag = btn.dataset.filterTag || null;
      listState.visibleCount = MEMO_LIST_PAGE_SIZE;
      renderList();
    });
  });

  container.querySelector('#kn-load-more')?.addEventListener('click', () => {
    listState.visibleCount += MEMO_LIST_PAGE_SIZE;
    renderList();
  });

  // Wire memo cards
  container.querySelectorAll('[data-memo-id]').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('[data-star-id]')) return;
      openKnowledgeMemo(card.dataset.memoId);
    });
    card.addEventListener('keydown', e => {
      if (e.target !== card) return;
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      openKnowledgeMemo(card.dataset.memoId);
    });
  });

  // Wire star buttons
  container.querySelectorAll('[data-star-id]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const m = getKnowledgeMemoById(btn.dataset.starId);
      if (m) { updateKnowledgeMemo(m.id, { starred: !m.starred }); renderList(); }
    });
  });
}

function renderMemoCard(m) {
  const preview = renderMemoCardPreview(m.blocks || [], 1);
  const dateStr = formatDate(m.updatedAt || m.createdAt, 'short');
  const tags    = m.tags || [];

  return `
    <div class="kn-memo-card" data-memo-id="${esc(m.id)}" role="group" tabindex="0"
      aria-label="${esc(m.title || '無題のメモ')}を開く">
      <div class="kn-memo-card-top">
        <div class="kn-memo-heading">
          <span class="kn-memo-title">${esc(m.title || '無題のメモ')}</span>
        </div>
        ${m.pendingAI ? '<span class="kn-pending-badge">🤖 AI処理待ち</span>' : ''}
        <button class="kn-star-btn${m.starred ? ' starred' : ''}" data-star-id="${esc(m.id)}" aria-label="${m.starred ? 'スター解除' : 'スター'}">
          ${m.starred
            ? '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>'
            : '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z"/></svg>'}
        </button>
      </div>
      ${preview ? `<div class="kn-memo-preview">${preview}</div>` : ''}
      <div class="kn-memo-footer">
        <div class="kn-tag-list">
          ${tags.slice(0, 4).map(t => `<span class="kn-tag-chip">${esc(t)}</span>`).join('')}
          ${tags.length > 4 ? `<span class="kn-tag-chip kn-tag-chip--more">+${tags.length - 4}</span>` : ''}
        </div>
        <span class="kn-memo-date">${dateStr}</span>
      </div>
    </div>
  `;
}

export function renderMemoCardPreview(blocks, maxBlocks = 7) {
  const rows = [];
  let rendered = 0;

  const renderLevel = (items, depth = 0) => {
    let numbered = 0;
    for (const block of (items || [])) {
      if (rendered >= maxBlocks) break;
      numbered = block.type === 'numbered' ? numbered + 1 : 0;

      if (block.type === 'divider') {
        rows.push('<hr class="kn-memo-preview-divider">');
        rendered++;
        continue;
      }

      let text = String(block.text || '');
      if (block.type === 'table') {
        const table = normalizeTableData(block);
        text = [table.headers.join(' / '), table.rows[0]?.join(' / ')].filter(Boolean).join('\n');
      } else if (block.type === 'image') {
        text = block.caption || '写真';
      } else if (block.type === 'math') {
        text = block.text ? `数式: ${block.text}` : '数式';
      }
      if (!text.trim()) continue;

      const type = ['h1', 'h2', 'h3', 'bullet', 'numbered', 'quote', 'toggle'].includes(block.type)
        ? block.type
        : 'paragraph';
      const toggleCollapsed = type === 'toggle'
        ? (block.collapsed ?? !block.children?.length)
        : false;
      const prefix = type === 'bullet' ? '•'
        : type === 'numbered' ? `${numbered || 1}.`
          : type === 'toggle' ? (toggleCollapsed ? '▶' : '▼')
            : type === 'quote' ? '“'
              : '';
      rows.push(`
        <div class="kn-memo-preview-line kn-memo-preview-line--${type}" style="--preview-depth:${Math.min(depth, 2)}">
          ${prefix ? `<span class="kn-memo-preview-prefix" aria-hidden="true">${prefix}</span>` : ''}
          <div class="kn-memo-preview-text">${block.html ? getBlockRichHtml(block) : esc(text)}</div>
        </div>
      `);
      rendered++;

      if (type === 'toggle' && block.children?.length && !toggleCollapsed) {
        renderLevel(block.children, depth + 1);
      }
    }
  };

  renderLevel(blocks);
  return rows.join('');
}

function memoSearchText(memo) {
  const version = [
    memo.updatedAt || memo.createdAt || '',
    memo.title || '',
    memo.summary || '',
    (memo.tags || []).join('\u0001'),
  ].join('\u0002');
  const cached = memoSearchIndex.get(memo.id);
  if (cached?.version === version) return cached.text;
  const text = [
    memo.title || '',
    memo.summary || '',
    (memo.tags || []).join(' '),
    blocksToText(memo.blocks || []),
  ].join(' ').toLowerCase();
  memoSearchIndex.set(memo.id, { version, text });
  return text;
}

function pruneMemoSearchIndex(memos) {
  if (memoSearchIndex.size <= memos.length) return;
  const activeIds = new Set(memos.map(memo => memo.id));
  for (const id of memoSearchIndex.keys()) {
    if (!activeIds.has(id)) memoSearchIndex.delete(id);
  }
}

// ============================================================
// AI INPUT SHEET
// ============================================================

export function openKnowledgeAiOrganizer() {
  if (!isAiAvailable()) {
    toast('AI整理を使うにはログインとAI設定が必要です', 'error');
    return;
  }
  openAIInputSheet();
}

function openAIInputSheet() {
  document.querySelector('.kn-ai-sheet')?.remove();
  const hasApi = isAiAvailable();
  if (!hasApi) return;

  const sheet = document.createElement('div');
  sheet.className = 'kn-ai-sheet';
  sheet.innerHTML = `
    <div class="kn-ai-sheet-panel">
      <div class="kn-ai-sheet-handle"></div>

      <!-- Step 1: Input -->
      <div class="kn-ai-step" id="kn-ai-step1">
        <div class="kn-ai-sheet-hdr">
          <span class="kn-ai-sheet-title">AI\u30e1\u30e2\u5165\u529b</span>
          <button class="kn-ai-sheet-close" aria-label="閉じる">
            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>
        <div class="kn-ai-step-body">
          <textarea class="kn-ai-textarea" id="kn-ai-textarea"
            placeholder="メモしたい内容を自由に入力…&#10;箇条書きでも文章でも OK&#10;&#10;例: 今日の勉強メモ、会議の記録、読書の気づきなど"></textarea>
          <button class="btn btn-primary kn-ai-format-btn" id="kn-ai-format-btn" ${!hasApi ? 'disabled' : ''}>
            <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14" style="margin-right:4px"><path d="M21 3L3 10.53v.98l6.84 2.65L12.48 21h.98L21 3z"/></svg>
            ${hasApi ? 'AIに整理してもらう' : 'APIキーが必要です（設定で入力）'}
          </button>
        </div>
      </div>

      <!-- Loading -->
      <div class="kn-ai-loading hidden" id="kn-ai-loading" aria-live="polite">
        <span class="ai-spinner"></span>
        <strong>AIが整理中…</strong>
        <span class="kn-ai-loading-detail" id="kn-ai-loading-detail">通常は数秒で完了します</span>
        <button type="button" class="btn btn-ghost btn-sm" id="kn-ai-cancel">キャンセル</button>
      </div>

      <!-- Step 2: Preview -->
      <div class="kn-ai-step hidden" id="kn-ai-step2">
        <div class="kn-ai-sheet-hdr">
          <button class="btn btn-ghost btn-sm" id="kn-ai-back">← 戻る</button>
          <button class="btn btn-primary btn-sm" id="kn-ai-save">保存</button>
        </div>
        <div class="kn-ai-step-body">
          <input class="kn-ai-title-input" id="kn-ai-title-input" placeholder="タイトル">
          <div class="kn-ai-preview-tags" id="kn-ai-preview-tags"></div>
          <div class="kn-ai-preview-wrap">
            <div class="kn-view-content" id="kn-ai-preview-content"></div>
            <div class="kn-ai-related-section hidden" id="kn-ai-related-section">
              <div class="kn-related-title">📎 関連メモ</div>
              <div class="kn-related-list" id="kn-ai-related-list"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('app').appendChild(sheet);
  requestAnimationFrame(() => sheet.classList.add('kn-ai-sheet--open'));

  let _aiResult = null;
  let activeRequest = null;
  let slowNoticeTimer = null;

  const close = () => {
    activeRequest?.abort();
    clearTimeout(slowNoticeTimer);
    sheet.classList.remove('kn-ai-sheet--open');
    setTimeout(() => sheet.remove(), 280);
  };

  sheet.querySelector('.kn-ai-sheet-close').onclick = close;
  sheet.addEventListener('click', e => { if (e.target === sheet) close(); });

  const returnToInput = () => {
    activeRequest?.abort();
    activeRequest = null;
    clearTimeout(slowNoticeTimer);
    sheet.querySelector('#kn-ai-loading')?.classList.add('hidden');
    sheet.querySelector('#kn-ai-step1')?.classList.remove('hidden');
  };
  sheet.querySelector('#kn-ai-cancel')?.addEventListener('click', returnToInput);

  // ---- Format button ----
  sheet.querySelector('#kn-ai-format-btn')?.addEventListener('click', async () => {
    if (activeRequest) return;
    const rawText = sheet.querySelector('#kn-ai-textarea')?.value?.trim();
    if (!rawText) { toast('テキストを入力してください', 'error'); return; }

    const step1   = sheet.querySelector('#kn-ai-step1');
    const loading = sheet.querySelector('#kn-ai-loading');
    const step2   = sheet.querySelector('#kn-ai-step2');

    step1.classList.add('hidden');
    loading.classList.remove('hidden');
    activeRequest = new AbortController();
    const request = activeRequest;
    const loadingDetail = sheet.querySelector('#kn-ai-loading-detail');
    if (loadingDetail) loadingDetail.textContent = '通常は数秒で完了します';
    slowNoticeTimer = setTimeout(() => {
      if (loadingDetail && request === activeRequest) {
        loadingDetail.textContent = '少し時間がかかっています。続けて待つかキャンセルできます';
      }
    }, 8_000);

    try {
      // Compact context from existing memos (title + tags only)
      const existingCtx = getKnowledgeMemos()
        .slice(0, 12)
        .map(m => `${m.title}[${(m.tags || []).join(',')}]`)
        .join(' / ');

      const result = await formatKnowledgeMemo(rawText, existingCtx, { signal: request.signal });
      if (!sheet.isConnected || request !== activeRequest) return;

      // Attach block IDs and store on sheet element for cross-function access
      _aiResult = {
        ...result,
        sourceText: rawText,
        blocks: result.blocks.map(b => ({
          id: generateId(), type: b.type || 'paragraph', text: b.text || '', color: null,
        })),
      };
      sheet._aiResult = _aiResult;

      loading.classList.add('hidden');
      step2.classList.remove('hidden');

      // Populate title
      const titleInput = sheet.querySelector('#kn-ai-title-input');
      if (titleInput) titleInput.value = _aiResult.title;

      // Tags (with × to remove)
      _renderAITags(sheet, _aiResult.tags);

      // Content preview
      const contentEl = sheet.querySelector('#kn-ai-preview-content');
      if (contentEl) {
        contentEl.innerHTML = renderBlocksView(_aiResult.blocks);
        requestAnimationFrame(() => renderAllKaTeX(contentEl));
      }

      // Related memos based on AI tags
      const related = getRelatedMemos(null, _aiResult.tags);
      if (related.length) {
        sheet.querySelector('#kn-ai-related-section')?.classList.remove('hidden');
        const relList = sheet.querySelector('#kn-ai-related-list');
        if (relList) {
          relList.innerHTML = related.slice(0, 4).map(m => `
            <div class="kn-related-card" data-related-id="${esc(m.id)}">
              <div class="kn-related-card-title">${esc(m.title || '無題')}</div>
              <div class="kn-tag-list">
                ${(m.tags || []).slice(0, 3).map(t => `<span class="kn-tag-chip kn-tag-chip--sm">${esc(t)}</span>`).join('')}
              </div>
            </div>`).join('');
          // Tap related memo to navigate
          relList.querySelectorAll('[data-related-id]').forEach(card => {
            card.addEventListener('click', () => {
              currentMemoId = card.dataset.relatedId;
              pendingNewOpts = null;
              close();
              setTimeout(() => nav('knowledge-detail'), 120);
            });
          });
        }
      }

    } catch (e) {
      if (!sheet.isConnected || request !== activeRequest) return;
      loading.classList.add('hidden');
      step1.classList.remove('hidden');
      if (e?.name !== 'AbortError') {
        toast('AIエラー: ' + e.message, 'error');
      }
    } finally {
      if (request === activeRequest) activeRequest = null;
      clearTimeout(slowNoticeTimer);
    }
  });

  // ---- Back ----
  sheet.querySelector('#kn-ai-back')?.addEventListener('click', () => {
    sheet.querySelector('#kn-ai-step2')?.classList.add('hidden');
    sheet.querySelector('#kn-ai-step1')?.classList.remove('hidden');
  });

  // ---- Save ----
  sheet.querySelector('#kn-ai-save')?.addEventListener('click', () => {
    const result = sheet._aiResult;
    if (!result) return;
    const finalTitle = sheet.querySelector('#kn-ai-title-input')?.value?.trim()
      || result.title || '無題のメモ';

    const savedBlocks = [...result.blocks];
    if (String(result.sourceText || '').length > 1800) {
      savedBlocks.push({
        id: generateId(),
        type: 'toggle',
        text: 'AI整理前の原文',
        collapsed: true,
        children: [{ id: generateId(), type: 'paragraph', text: result.sourceText }],
      });
    }
    const saved = addKnowledgeMemo({
      title:   finalTitle,
      blocks:  savedBlocks,
      tags:    result.tags,
      url:     '',
      starred: false,
      summary: blocksToText(savedBlocks, 200),
    });
    if (!saved) {
      toast('メモを保存できませんでした', 'error');
      return;
    }
    scheduleFirstReview(saved.id);

    close();
    toast(`「${finalTitle}」を保存しました ✨`, 'success');

    setTimeout(() => {
      currentMemoId  = saved.id;
      pendingNewOpts = null;
      nav('knowledge-detail');
    }, 320);
  });
}

function _renderAITags(sheet, tags) {
  const wrap = sheet.querySelector('#kn-ai-preview-tags');
  if (!wrap) return;
  wrap.innerHTML = tags.map(t =>
    `<span class="kn-tag-chip kn-tag-chip--ai">${esc(t)} <button class="kn-ai-tag-x" data-rm-tag="${esc(t)}">×</button></span>`
  ).join('');
  wrap.querySelectorAll('[data-rm-tag]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (!sheet._aiResult) return;
      const rm = btn.dataset.rmTag;
      sheet._aiResult.tags = sheet._aiResult.tags.filter(t => t !== rm);
      _renderAITags(sheet, sheet._aiResult.tags);
    });
  });
}

function showTemplatePicker() {
  const overlay = document.getElementById('modal-overlay');
  if (!overlay) { startNewMemo(null); return; }
  overlay.innerHTML = '';
  overlay.classList.remove('hidden');

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">テンプレートを選択</span>
      <button class="modal-close" aria-label="閉じる">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
      </button>
    </div>
    <div class="modal-body">
      <div class="kn-template-grid">
        <button class="kn-template-btn" data-tpl="">
          <span class="kn-template-icon">📄</span>
          <span class="kn-template-label">空白のメモ</span>
        </button>
        ${Object.entries(TEMPLATES).map(([key, tpl]) => `
          <button class="kn-template-btn" data-tpl="${esc(key)}">
            <span class="kn-template-icon">${tpl.label.split(' ')[0]}</span>
            <span class="kn-template-label">${esc(tpl.label.slice(2))}</span>
          </button>
        `).join('')}
      </div>
    </div>
  `;
  overlay.appendChild(modal);

  const close = () => { overlay.classList.add('hidden'); overlay.innerHTML = ''; };
  modal.querySelector('.modal-close').onclick = close;
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  modal.querySelectorAll('[data-tpl]').forEach(btn => {
    btn.onclick = () => {
      close();
      startNewMemo(btn.dataset.tpl || null);
    };
  });
}

function startNewMemo(templateKey) {
  currentMemoId  = null;
  pendingNewOpts = templateKey
    ? { templateKey }
    : (pendingNewOpts || null);
  nav('knowledge-detail');
}

// ============================================================
// DETAIL / EDITOR VIEW
// ============================================================

// Editor state (kept in memory while editing)
let edState = {
  id:      null,
  title:   '',
  blocks:  [],
  tags:    [],
  url:     '',
  starred: false,
  reviewEnabled: true,
  isEdit:  false,
};

// Sync refreshes must never replace an open editor with the read-only view.
// Keeping this separate from the unsaved-change check avoids warning about an
// untouched memo while still protecting the current editing session.
export function isKnowledgeEditorOpen() {
  return !!edState?.isEdit;
}

export function initKnowledgeDetail(container) {
  editorSessionToken += 1;
  if (_detailGestureCleanup) { _detailGestureCleanup(); _detailGestureCleanup = null; }
  const main = document.getElementById('main-content');
  const currentScrollTop = main?.scrollTop || 0;
  const restoreScrollTop = _pendingDetailScrollTop > 0 ? _pendingDetailScrollTop : currentScrollTop;
  if (main) main.scrollTop = restoreScrollTop;

  const routeQuery = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const routeMemoId = routeQuery.get('id');
  if (routeMemoId) {
    currentMemoId = routeMemoId;
    pendingNewOpts = null;
  } else if (routeQuery.has('new')) {
    currentMemoId = null;
  }

  // Load memo or initialize new
  if (currentMemoId) {
    const memo = getKnowledgeMemoById(currentMemoId);
    if (!memo) { nav('memo'); return; }
    edState = {
      id:      memo.id,
      title:   memo.title,
      blocks:  deepClone(memo.blocks || [defaultBlock()]),
      tags:    [...(memo.tags || [])],
      url:     memo.url || '',
      starred: !!memo.starred,
      reviewEnabled: isMemoReviewEnabled(memo.id),
      isEdit:  false,
    };
    activeEditorBlockId = null;
  } else {
    // New memo
    const tpl = pendingNewOpts?.templateKey ? TEMPLATES[pendingNewOpts.templateKey] : null;
    edState = {
      id:      null,
      title:   tpl ? tpl.title : '',
      blocks:  tpl ? tpl.blocks.map(b => ({ ...defaultBlock(), ...b, id: generateId() })) : [defaultBlock()],
      tags:    pendingNewOpts?.tags || [],
      url:     '',
      starred: false,
      reviewEnabled: pendingNewOpts?.reviewEnabled !== false,
      isEdit:  true, // new memo starts in edit mode
    };
    activeEditorBlockId = edState.blocks[0]?.id || null;
    pendingNewOpts = null;
  }
  pendingImageUploads = new Set();
  pendingImageDeletes = new Set();

  markEditorBaseline();

  renderDetail(container);

  requestAnimationFrame(() => {
    if (main) main.scrollTop = restoreScrollTop;
    _pendingDetailScrollTop = 0;
  });

  const cleanupSwipe = setupKnowledgeSwipeBack(container);
  _detailGestureCleanup = cleanupSwipe;
  return () => {
    cleanupSwipe?.();
    if (_detailGestureCleanup === cleanupSwipe) _detailGestureCleanup = null;
    document.body.classList.remove('knowledge-editor-open');
    cleanupPendingImageUploads();
  };
}

function setupKnowledgeSwipeBack(container) {
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let tracking = false;
  let committing = false;

  const page = () => container.querySelector('.kn-view-page');
  const canBack = () => !committing && !edState?.isEdit && _knHistory.length > 0;

  const reset = () => {
    const view = page();
    if (view) {
      view.style.transition = '';
      view.style.transform = '';
      view.classList.remove('kn-view-page--swiping');
    }
    tracking = false;
    committing = false;
    dx = 0;
  };

  const updateDrag = (distance) => {
    dx = Math.max(0, distance);
    const view = page();
    if (!view) return;
    view.classList.add('kn-view-page--swiping');
    view.style.transition = 'none';
    view.style.transform = `translate3d(${Math.min(dx, window.innerWidth * 0.96)}px,0,0)`;
  };

  const onTouchStart = e => {
    if (!canBack()) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    dx = 0;
    tracking = false;
  };

  const onTouchMove = e => {
    if (!canBack()) return;
    const curX = e.touches[0].clientX;
    const curY = e.touches[0].clientY;
    const moveX = curX - startX;
    const moveY = Math.abs(curY - startY);

    if (!tracking) {
      if (moveX < 8 || Math.abs(moveX) < moveY * 1.35) return;
      tracking = true;
    }

    if (!tracking) return;
    e.preventDefault();
    updateDrag(moveX);
  };

  const onTouchEnd = e => {
    if (!canBack() && !tracking) return;
    const endX = e.changedTouches?.[0]?.clientX ?? startX;
    const endY = e.changedTouches?.[0]?.clientY ?? startY;
    const finalDx = Math.max(0, endX - startX);
    const finalDy = Math.abs(endY - startY);
    const horizontal = finalDx > finalDy * 1.35;
    if (!tracking && (!horizontal || finalDx < 12)) return;

    if (!tracking) {
      tracking = true;
      updateDrag(finalDx);
    }

    const view = page();
    const threshold = Math.min(118, window.innerWidth * 0.34);
    const shouldBack = finalDx >= threshold;

    if (!view) { reset(); return; }

    committing = true;
    view.classList.remove('kn-view-page--swiping');
    view.style.transition = 'transform 0.11s cubic-bezier(0.22, 1, 0.36, 1)';
    if (shouldBack) {
      view.style.transform = `translate3d(${window.innerWidth}px,0,0)`;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        view.style.visibility = 'hidden';
        knBack();
      };
      view.addEventListener('transitionend', finish, { once: true });
      setTimeout(finish, 140);
    } else {
      view.style.transform = 'translate3d(0,0,0)';
      let resetDone = false;
      const finishReset = () => {
        if (resetDone) return;
        resetDone = true;
        reset();
      };
      view.addEventListener('transitionend', finishReset, { once: true });
      setTimeout(finishReset, 150);
    }
  };

  container.addEventListener('touchstart', onTouchStart, { passive: true });
  container.addEventListener('touchmove',  onTouchMove,  { passive: false });
  container.addEventListener('touchend',   onTouchEnd,   { passive: true });
  container.addEventListener('touchcancel', reset,       { passive: true });

  return () => {
    container.removeEventListener('touchstart', onTouchStart);
    container.removeEventListener('touchmove',  onTouchMove);
    container.removeEventListener('touchend',   onTouchEnd);
    container.removeEventListener('touchcancel', reset);
    reset();
  };
}

function restoreDetailScroll(top) {
  const main = document.getElementById('main-content');
  if (!main || top <= 0) return;
  main.scrollTop = top;
  requestAnimationFrame(() => {
    main.scrollTop = top;
  });
}

function renderDetail(container, options = {}) {
  const restoreScrollTop = options.preserveScroll
    ? document.getElementById('main-content')?.scrollTop || 0
    : 0;
  const { isEdit, title, blocks, tags, url, starred, id } = edState;

  // Update header title
  const titleEl = document.getElementById('page-title');
  if (titleEl) titleEl.textContent = isEdit ? (id ? 'メモを編集' : '新規メモ') : (title || '無題のメモ');

  if (isEdit) {
    document.body.classList.add('knowledge-editor-open');
    renderEditMode(container);
  } else {
    document.body.classList.remove('knowledge-editor-open');
    renderViewMode(container);
  }

  if (options.preserveScroll) restoreDetailScroll(restoreScrollTop);
}

// ============================================================
// VIEW MODE
// ============================================================

function renderViewMode(container) {
  const { id, title, blocks, tags, url, starred } = edState;
  const relatedMemos = getRelatedMemos(id, tags);

  container.innerHTML = `
    <div class="kn-view-page">
      <!-- Header controls -->
      <div class="kn-view-controls">
        <button class="kn-star-btn${starred ? ' starred' : ''}" id="kn-view-star" aria-label="スター">
          ${starred
            ? '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>'
            : '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z"/></svg>'}
        </button>
        <button class="btn btn-ghost btn-sm" id="kn-edit-btn">✏️ 編集</button>
        <button class="btn btn-icon kn-delete-action" id="kn-delete-btn" aria-label="このメモを削除" title="削除">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
        </button>
      </div>

      <!-- Title -->
      <h1 class="kn-view-title">${esc(title || '無題のメモ')}</h1>

      <!-- Tags + URL -->
      ${tags.length || url ? `
        <div class="kn-view-meta">
          <div class="kn-tag-list">
            ${tags.map(t => `<span class="kn-tag-chip">${esc(t)}</span>`).join('')}
          </div>
          ${url ? `<a class="kn-url-link" href="${esc(url)}" target="_blank" rel="noopener">
            <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>
            ${esc(url.replace(/^https?:\/\//, '').split('/')[0])}
          </a>` : ''}
        </div>
      ` : ''}

      <!-- Block content -->
      <div class="kn-view-content" id="kn-view-content">
        ${renderBlocksView(blocks)}
      </div>

      <!-- 復習ボタン -->
      ${id ? (() => {
        const todayStr   = new Date().toISOString().slice(0, 10);
        const srsEntry   = getReviewEntry(id);
        if (srsEntry?.stage === REVIEW_DISABLED_STAGE) {
          return `<div class="kn-review-disabled-note">このメモは復習対象外です。編集画面からいつでも変更できます。</div>`;
        }
        const stage      = srsEntry?.stage ?? 0;
        const isMastered = stage >= MASTERY_STAGE;
        const isDue      = !srsEntry?.lastReview || (srsEntry.nextReview <= todayStr && !isMastered);
        const todayCount = getReviewLog().filter(e => e.memoId === id && e.date === todayStr).length;
        const ivs        = previewReviewIntervals(id);
        const dots = Array.from({ length: MASTERY_STAGE }, (_, i) =>
          `<span class="kn-srs-dot${i < stage ? ' done' : i === stage && !isMastered ? ' current' : ''}"></span>`
        ).join('') + `<span class="kn-srs-dot kn-srs-dot--star${isMastered ? ' done' : ''}">★</span>`;

        const stageOptions = STAGE_INTERVALS.map((days, i) => {
          const label = i === MASTERY_STAGE ? `Lv.${i} — 習得済み ★` : `Lv.${i} — ${days}日後`;
          return `<option value="${i}"${stage === i ? ' selected' : ''}>${label}</option>`;
        }).join('');

        const daysSinceLast = srsEntry?.lastReview ? daysSince(srsEntry.lastReview) : null;
        const daysUntilNext = srsEntry?.nextReview
          ? Math.ceil((new Date(srsEntry.nextReview) - Date.now()) / 86400000)
          : null;
        let statusText = isMastered ? 'すべてのステージ完了'
          : !srsEntry?.lastReview ? '初めての復習'
          : isDue ? `${daysSinceLast}日ぶりの復習`
          : `次回: ${daysUntilNext}日後`;

        return `<div class="kn-learned-action${isDue && !isMastered ? ' kn-learned-action--due' : ''}">
          <div class="kn-srs-progress">
            <div class="kn-srs-dots">${dots}</div>
            <span class="kn-srs-status">${esc(statusText)}</span>
          </div>
          ${isMastered
            ? `<div class="kn-mastered-badge">🎓 習得済み</div>
               <div class="kn-rating-btns kn-rating-btns--reset">
                 <button class="rv-btn rv-btn--again kn-rate-btn" data-rating="again">
                   <span class="rv-btn-label">もう一度</span><span class="rv-btn-interval">${fmtDays(ivs.again)}</span>
                 </button>
               </div>`
            : `<div class="kn-rating-btns${isDue ? '' : ' kn-rating-btns--early'}">
                 <button class="rv-btn rv-btn--again kn-rate-btn" data-rating="again">
                   <span class="rv-btn-label">もう一度</span><span class="rv-btn-interval">${fmtDays(ivs.again)}</span>
                 </button>
                 <button class="rv-btn rv-btn--hard kn-rate-btn" data-rating="hard">
                   <span class="rv-btn-label">難しい</span><span class="rv-btn-interval">${fmtDays(ivs.hard)}</span>
                 </button>
                 <button class="rv-btn rv-btn--good kn-rate-btn" data-rating="good">
                   <span class="rv-btn-label">普通</span><span class="rv-btn-interval">${fmtDays(ivs.good)}</span>
                 </button>
                 <button class="rv-btn rv-btn--easy kn-rate-btn" data-rating="easy">
                   <span class="rv-btn-label">簡単</span><span class="rv-btn-interval">${fmtDays(ivs.easy)}</span>
                 </button>
               </div>`
          }
          <div class="kn-stage-picker">
            <label class="kn-stage-label">ステージ変更</label>
            <select class="kn-stage-select" id="kn-stage-select">${stageOptions}</select>
          </div>
          ${todayCount > 0 ? `<div class="kn-learned-count">今日 ${todayCount}回 記録済み</div>` : ''}
        </div>`;
      })() : ''}

      <!-- Related memos -->
      ${relatedMemos.length ? `
        <div class="kn-related-section">
          <div class="kn-related-title">Related Notes</div>
          <div class="kn-related-list">
            ${relatedMemos.slice(0, 6).map(m => {
              const shared = (m.tags || []).filter(t => tags.includes(t));
              const others = (m.tags || []).filter(t => !tags.includes(t));
              return `
              <div class="kn-related-card" data-related-id="${esc(m.id)}">
                <div class="kn-related-card-title">${esc(m.title || '無題')}</div>
                <div class="kn-related-card-meta">
                  <div class="kn-related-shared">
                    ${shared.map(t => `<span class="kn-tag-chip kn-tag-chip--shared">${esc(t)}</span>`).join('')}
                  </div>
                  ${others.length ? `<div class="kn-tag-list">
                    ${others.slice(0,2).map(t => `<span class="kn-tag-chip kn-tag-chip--sm">${esc(t)}</span>`).join('')}
                  </div>` : ''}
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `;

  // Wire controls
  container.querySelector('#kn-edit-btn')?.addEventListener('click', () => {
    activeEditorBlockId = edState.blocks[0]?.id || null;
    markEditorBaseline();
    edState.isEdit = true;
    renderDetail(container, { preserveScroll: true });
  });

  container.querySelector('#kn-view-star')?.addEventListener('click', () => {
    edState.starred = !edState.starred;
    if (edState.id) updateKnowledgeMemo(edState.id, { starred: edState.starred });
    renderDetail(container, { preserveScroll: true });
  });

  container.querySelector('#kn-delete-btn')?.addEventListener('click', () => {
    if (!edState.id) { nav('memo'); return; }
    confirmDelete(edState.id, container);
  });

  container.querySelectorAll('.kn-rate-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const rating = btn.dataset.rating;
      addReviewLog(edState.id, edState.tags);
      rateReview(edState.id, rating);
      const newEntry = getReviewEntry(edState.id);
      if (newEntry?.stage >= MASTERY_STAGE && rating !== 'again') {
        window.AppNav?.showToast('🎓 習得済み！おめでとうございます', 'success');
      } else {
        const days = newEntry?.interval ? fmtDays(newEntry.interval) : null;
        window.AppNav?.showToast(`記録しました ✓${days ? ` — 次回: ${days}` : ''}`, 'success');
      }
      renderDetail(container, { preserveScroll: true });
    });
  });

  container.querySelector('#kn-stage-select')?.addEventListener('change', e => {
    setReviewStage(edState.id, parseInt(e.target.value, 10));
    renderDetail(container, { preserveScroll: true });
    window.AppNav?.showToast(`ステージを Lv.${e.target.value} に変更しました`, 'success');
  });

  // Toggle rows are clickable in view mode. Nested toggles use the same lookup.
  container.querySelectorAll('[data-view-toggle-id]').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('a')) return;
      const block = findBlockInAllBlocks(edState.blocks, row.dataset.viewToggleId);
      if (!block) return;
      block.collapsed = !block.collapsed;
      renderDetail(container, { preserveScroll: true });
    });
  });

  // Wire related memos — use openKnowledgeMemo so history is tracked
  container.querySelectorAll('[data-related-id]').forEach(card => {
    card.addEventListener('click', () => openKnowledgeMemo(card.dataset.relatedId));
  });

  // Setup term selection
  setupTermSelection(container.querySelector('#kn-view-content'), container);

  // Render KaTeX after DOM is ready
  requestAnimationFrame(() => {
    renderAllKaTeX(container);
    hydratePlannerImages(container);
    wirePlannerImageViewer(container);
  });
}

export function renderBlocksView(blocks, indent = 0) {
  if (!blocks || !blocks.length) return '';
  let html = '';
  let numberedCounter = 0;

  for (const block of blocks) {
    if (block.type === 'numbered') {
      numberedCounter++;
    } else {
      numberedCounter = 0;
    }
    html += renderBlockView(block, numberedCounter, indent);
  }
  return html;
}

function renderBlockView(block, numCounter = 0, indent = 0) {
  const color = block.color || '';
  const styles = [color ? `color:${color}` : '', indent > 0 ? `margin-left:${indent * 20}px` : ''].filter(Boolean);
  const style = styles.length ? `style="${styles.join(';')}"` : '';
  const id = `data-view-block-id="${esc(block.id || '')}"`;

  if (block.type === 'divider') {
    return `<hr class="kn-view-divider" ${id}>`;
  }

  if (block.type === 'math') {
    return `<div class="kn-view-math" ${id} data-katex="${esc(block.text || '')}">${esc(block.text || '')}</div>`;
  }

  if (block.type === 'table') {
    const table = normalizeTableData(block);
    return `<div class="kn-view-table-wrap" ${id}><table class="kn-view-table"><thead><tr>${table.headers.map(cell => `<th>${esc(cell)}</th>`).join('')}</tr></thead><tbody>${table.rows.map(row => `<tr>${row.map(cell => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  if (block.type === 'image') {
    return `
      <figure class="kn-view-image media-frame media-frame--loading" ${id}>
        <img data-media-path="${esc(block.path || '')}" data-media-view="1"
          ${Number(block.width) > 0 && Number(block.height) > 0
            ? `width="${Number(block.width)}" height="${Number(block.height)}"`
            : ''}
          data-media-caption="${esc(block.caption || '')}" tabindex="0" role="button"
          aria-label="メモの写真を拡大表示" alt="${esc(block.alt || block.caption || 'メモの写真')}">
        ${block.caption ? `<figcaption>${esc(block.caption)}</figcaption>` : ''}
      </figure>
    `;
  }

  const inlineText = getBlockRichHtml(block);

  if (block.type === 'toggle') {
    const children = block.children || [];
    const collapsed = block.collapsed ?? !children.length;
    return `
      <div class="kn-view-toggle${collapsed ? ' collapsed' : ''}" ${id}
        data-view-toggle-id="${esc(block.id || '')}">
        <button type="button" class="kn-block-toggle-arrow"
          aria-label="${collapsed ? 'トグルを開く' : 'トグルを閉じる'}"
          aria-expanded="${String(!collapsed)}">${collapsed ? '▶' : '▼'}</button>
        <span class="kn-view-toggle-text" ${style}>${inlineText || '<span style="color:var(--text-dim)">トグル</span>'}</span>
      </div>
      ${collapsed ? '' : `<div class="kn-view-toggle-children">${renderBlocksView(children, indent + 1)}</div>`}
    `;
  }

  const tagMap = {
    h1:        `<h1 class="kn-view-h1" ${id} ${style}>${inlineText}</h1>`,
    h2:        `<h2 class="kn-view-h2" ${id} ${style}>${inlineText}</h2>`,
    h3:        `<h3 class="kn-view-h3" ${id} ${style}>${inlineText}</h3>`,
    bullet:    `<div class="kn-view-bullet" ${id} ${style}><span class="kn-view-bullet-dot">•</span><span>${inlineText}</span></div>`,
    numbered:  `<div class="kn-view-numbered" ${id} ${style}><span class="kn-view-numbered-n">${numCounter}.</span><span>${inlineText}</span></div>`,
    quote:     `<blockquote class="kn-view-quote" ${id} ${style}>${inlineText}</blockquote>`,
    paragraph: `<p class="kn-view-para" ${id} ${style}>${inlineText || '<br>'}</p>`,
  };

  return tagMap[block.type] || tagMap.paragraph;
}

function renderInlineMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code class="kn-inline-code">$1</code>')
    .replace(/\[(.+?)\]\((https?:\/\/.+?)\)/g, '<a href="$2" target="_blank" rel="noopener" class="kn-inline-link">$1</a>');
}

function getBlockRichHtml(block) {
  if (block.html) return sanitizeBlockHtml(block.html);
  return renderInlineMarkdown(esc(block.text || ''));
}

function renderAllKaTeX(container) {
  if (typeof katex === 'undefined') return;
  container.querySelectorAll('.kn-view-math').forEach(el => {
    const formula = el.dataset.katex || el.textContent;
    try {
      el.innerHTML = katex.renderToString(formula, { displayMode: true, throwOnError: false });
    } catch (e) {
      el.innerHTML = `<code class="kn-katex-error">${esc(formula)}</code>`;
    }
  });
}

// ---- Term selection / explain ----

function setupTermSelection(contentEl, rootContainer) {
  if (!contentEl) return;
  let floatingBtn = null;

  const removeBtn = () => { floatingBtn?.remove(); floatingBtn = null; };

  contentEl.addEventListener('pointerup', e => {
    removeBtn();
    const sel = window.getSelection();
    const selText = sel?.toString().trim();
    if (!selText || selText.length < 2 || selText.length > 120) return;

    // Build floating button
    floatingBtn = document.createElement('div');
    floatingBtn.className = 'kn-explain-btn';
    const cached = getTermExplanation(selText);
    if (!cached && !isAiAvailable()) return;

    floatingBtn.innerHTML = `
      <button id="kn-explain-term">🔍 調べる</button>
    `;

    // Position near selection
    const range = sel.getRangeAt(0);
    const rect  = range.getBoundingClientRect();
    const appRect = document.getElementById('app')?.getBoundingClientRect() || { left: 0, top: 0 };
    floatingBtn.style.left = `${rect.left - appRect.left}px`;
    floatingBtn.style.top  = `${rect.top - appRect.top - 42}px`;
    document.getElementById('app')?.appendChild(floatingBtn);

    floatingBtn.querySelector('#kn-explain-term')?.addEventListener('click', async e => {
      e.stopPropagation();
      const term = selText;
      removeBtn();
      sel?.removeAllRanges?.();

      // Check cache first
      const cached = getTermExplanation(term);
      if (cached) { showTermPopup(term, cached, contentEl, rootContainer); return; }
      if (!isAiAvailable()) return;

      // Show loading
      showTermPopup(term, '読み込み中…', contentEl, rootContainer);
      try {
        const context = contentEl.textContent?.slice(0, 400) || '';
        const explanation = await explainTerm(term, context);
        setTermExplanation(term, explanation);
        showTermPopup(term, explanation, contentEl, rootContainer);
      } catch (err) {
        showTermPopup(term, `エラー: ${err.message}`, contentEl, rootContainer);
      }
    });
  });

  // Close floating button on outside click
  document.addEventListener('pointerdown', e => {
    if (!floatingBtn?.contains(e.target)) removeBtn();
  }, true);
}

function showTermPopup(term, text, anchorEl, rootContainer) {
  // Remove any existing popup
  rootContainer.querySelector('.kn-term-popup')?.remove();

  const popup = document.createElement('div');
  popup.className = 'kn-term-popup';
  popup.innerHTML = `
    <div class="kn-term-popup-header">
      <strong>${esc(term)}</strong>
      <button class="kn-term-popup-close">✕</button>
    </div>
    <div class="kn-term-popup-body">${esc(text)}</div>
    <div class="kn-term-popup-hint">タップして閉じる · 次回は即時表示</div>
  `;

  rootContainer.querySelector('.kn-view-page')?.appendChild(popup);
  popup.querySelector('.kn-term-popup-close')?.addEventListener('click', () => popup.remove());
  popup.addEventListener('click', () => popup.remove());
}

// ============================================================
// EDIT MODE
// ============================================================

function renderEditMode(container, { preserveHistory = false } = {}) {
  const { title, blocks, tags, id } = edState;
  const hasApi = isAiAvailable();
  if (!preserveHistory) resetEditorHistory();

  container.innerHTML = `
    <div class="kn-edit-page">
      <!-- Top action bar -->
      <div class="kn-edit-topbar">
        <button class="btn btn-ghost btn-sm" id="kn-cancel-btn">${id ? 'キャンセル' : '一覧へ'}</button>
        <button class="btn btn-primary btn-sm" id="kn-save-btn">保存</button>
      </div>

      <!-- Title -->
      <input class="kn-edit-title" id="kn-edit-title"
        placeholder="タイトルを入力…" value="${esc(title)}" maxlength="180" autocomplete="off">

      <!-- Tags -->
      <div class="kn-edit-meta">
        <div class="kn-edit-tags-wrap">
          <div class="kn-tag-list" id="kn-tag-display">
            ${tags.map(t => `
              <span class="kn-tag-chip kn-tag-chip--edit">
                ${esc(t)}<button class="kn-tag-remove" data-tag="${esc(t)}">×</button>
              </span>`).join('')}
          </div>
          <input class="kn-tag-input" id="kn-tag-input" placeholder="タグ追加 (Enter)" autocomplete="off">
          ${hasApi ? `
            <button class="kn-ai-tag-btn" id="kn-ai-tag-btn" title="AIでタグ候補を作る" aria-label="AIでタグ候補を作る">
              <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><path d="M21 3L3 10.53v.98l6.84 2.65L12.48 21h.98L21 3z"/></svg>
              <span>AI</span>
            </button>
          ` : ''}
          <div class="kn-tag-suggestions" id="kn-tag-suggestions"></div>
        </div>
        <label class="kn-review-toggle" for="kn-review-enabled">
          <input type="checkbox" id="kn-review-enabled"${edState.reviewEnabled ? ' checked' : ''}>
          <span class="kn-review-toggle-copy"><strong>復習対象</strong></span>
        </label>
      </div>

      <!-- Block toolbar -->
      <div class="kn-toolbar" id="kn-toolbar">
        <div class="kn-toolbar-history" aria-label="編集履歴">
          <button type="button" class="kn-toolbar-btn" id="kn-undo-btn" title="取り消し (Ctrl/Cmd+Z)" aria-label="取り消し" disabled>↶</button>
          <button type="button" class="kn-toolbar-btn" id="kn-redo-btn" title="やり直し (Ctrl/Cmd+Shift+Z)" aria-label="やり直し" disabled>↷</button>
        </div>
        <div class="kn-toolbar-types">
          <label class="kn-toolbar-type-field">
            <span class="sr-only">ブロック種類</span>
            <select class="kn-toolbar-type-select" id="kn-toolbar-type-select" title="本文・見出しなどを変更">
              ${renderBlockTypeOptions('paragraph')}
            </select>
          </label>
        </div>
        <div class="kn-toolbar-inline">
          <button class="kn-toolbar-btn" data-inline-command="bold" title="太字">B</button>
          <button class="kn-toolbar-btn" data-inline-command="italic" title="斜体"><em>I</em></button>
          <button class="kn-toolbar-btn" data-inline-command="underline" title="下線"><u>U</u></button>
          <button class="kn-toolbar-btn" data-inline-command="strikeThrough" title="取り消し線"><s>S</s></button>
          <button class="kn-toolbar-btn kn-toolbar-mark-btn" id="kn-highlight-btn"
            title="マーカー色" aria-expanded="false">MARK</button>
        </div>
        <button class="kn-toolbar-btn kn-toolbar-color-btn" id="kn-color-btn" title="文字色">🎨</button>
        <button type="button" class="kn-toolbar-block-menu-btn" id="kn-block-actions-toggle"
          aria-label="ブロック操作" aria-expanded="false" title="ブロック操作">•••</button>
        <div class="kn-toolbar-block-actions" aria-label="ブロック操作">
          <button type="button" class="kn-toolbar-block-btn" data-toolbar-block-action="up" title="上へ" aria-label="上へ移動">↑</button>
          <button type="button" class="kn-toolbar-block-btn" data-toolbar-block-action="down" title="下へ" aria-label="下へ移動">↓</button>
          <button type="button" class="kn-toolbar-block-btn" data-toolbar-block-action="indent" title="トグル内へ移動" aria-label="トグル内へ移動">→</button>
          <button type="button" class="kn-toolbar-block-btn" data-toolbar-block-action="outdent" title="外へ" aria-label="外側へ移動">←</button>
        </div>
        <button type="button" class="kn-toolbar-btn kn-toolbar-media-btn" id="kn-photo-btn"
          title="写真を追加" aria-label="写真を追加">PHOTO</button>
        <button type="button" class="kn-toolbar-btn kn-toolbar-media-btn" id="kn-camera-btn"
          title="カメラで撮影" aria-label="カメラで撮影">CAM</button>
        <input class="hidden" id="kn-photo-input" type="file" accept="image/*">
        <input class="hidden" id="kn-camera-input" type="file" accept="image/*" capture="environment">
      </div>

      <div class="kn-toggle-target-picker hidden" id="kn-toggle-target-picker" aria-label="移動先トグル"></div>

      <!-- Color picker (hidden by default) -->
      <div class="kn-color-picker hidden" id="kn-color-picker">
        ${BLOCK_COLORS.map(c => `
          <button class="kn-color-swatch" data-color-id="${esc(c.id)}" title="${esc(c.label)}"
            style="${c.css ? `background:${c.css}` : 'background:var(--text)'}">
          </button>
        `).join('')}
      </div>

      <!-- Blocks -->
      <div class="kn-blocks-wrap" id="kn-blocks-wrap">
        ${renderBlocksEdit(blocks)}
      </div>

      <div class="kn-color-picker kn-highlight-picker hidden" id="kn-highlight-picker" aria-label="マーカー色">
        <span class="kn-color-picker-label">マーカー</span>
        ${HIGHLIGHT_COLORS.map(c => `
          <button class="kn-color-swatch kn-highlight-swatch${c.id === 'clear' ? ' kn-highlight-swatch--clear' : ''}"
            data-highlight-id="${esc(c.id)}" title="${esc(c.label)}" aria-label="${esc(c.label)}"
            style="--swatch-color:${c.css}">
          </button>
        `).join('')}
      </div>

      <!-- Add one block below the active block -->
      <button class="kn-add-block-btn" id="kn-add-block-btn">
        <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
        ブロックを追加
      </button>
    </div>
  `;

  // Wire top actions
  container.querySelector('#kn-cancel-btn')?.addEventListener('click', () => {
    if (!confirmDiscardKnowledgeChanges()) return;
    cleanupPendingImageUploads();
    pendingImageDeletes.clear();
    if (id) {
      edState.isEdit = false;
      // Reload from storage to discard changes
      const memo = getKnowledgeMemoById(id);
      if (memo) {
        edState = { ...edState, title: memo.title, blocks: deepClone(memo.blocks || [defaultBlock()]),
          tags: [...(memo.tags || [])], url: memo.url || '', starred: !!memo.starred,
          reviewEnabled: isMemoReviewEnabled(memo.id), isEdit: false };
      }
      activeEditorBlockId = null;
      markEditorBaseline();
      renderDetail(container, { preserveScroll: true });
    } else {
      nav('memo', { skipUnsavedGuard: true });
    }
  });

  container.querySelector('#kn-save-btn')?.addEventListener('click', () => saveMemo(container));

  const editPage = container.querySelector('.kn-edit-page');
  editPage?.addEventListener('keydown', event => {
    if (event.isComposing || !(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === 'z') {
      event.preventDefault();
      restoreEditorHistory(container, event.shiftKey ? 'redo' : 'undo');
    } else if (key === 'y') {
      event.preventDefault();
      restoreEditorHistory(container, 'redo');
    }
  });
  editPage?.addEventListener('beforeinput', event => {
    if (event.target?.closest?.('#kn-blocks-wrap, #kn-edit-title, #kn-tag-input')) {
      beginEditorTextHistory(container);
    }
  });
  // Some mobile keyboards and embedded browsers do not surface beforeinput
  // consistently. Capturing the state when an editable control receives focus
  // still gives the next edit a reliable undo point.
  editPage?.addEventListener('focusin', event => {
    if (event.target?.matches?.('[contenteditable="true"], input, textarea')) {
      beginEditorTextHistory(container);
    }
  });
  container.querySelector('#kn-undo-btn')?.addEventListener('click', () => restoreEditorHistory(container, 'undo'));
  container.querySelector('#kn-redo-btn')?.addEventListener('click', () => restoreEditorHistory(container, 'redo'));

  // Wire title input
  container.querySelector('#kn-edit-title')?.addEventListener('input', e => {
    beginEditorTextHistory(container);
    edState.title = e.target.value.slice(0, 180);
  });

  container.querySelector('#kn-review-enabled')?.addEventListener('change', e => {
    recordEditorHistory(container);
    edState.reviewEnabled = e.target.checked;
  });

  // Wire tag input
  wireTagInput(container);

  // Wire AI tag suggestion
  container.querySelector('#kn-ai-tag-btn')?.addEventListener('click', () => handleAITagSuggest(container));

  // Wire toolbar
  wireToolbar(container);
  wireKnowledgeImageInputs(container);

  // Wire blocks
  wireBlocksEdit(container);

  // Wire add block button
  container.querySelector('#kn-add-block-btn')?.addEventListener('click', () => {
    recordEditorHistory(container);
    const focusedBlockId = resolveActiveEditorBlockId(container);
    const inserted = focusedBlockId ? insertBlockAfter(focusedBlockId) : null;
    if (!inserted) edState.blocks.push(defaultBlock());
    rerenderBlocks(container);
    focusBlock(inserted?.id || edState.blocks[edState.blocks.length - 1]?.id, container);
  });

  // Paste detection for long text
  container.querySelector('.kn-edit-page')?.addEventListener('paste', e => {
    const text = e.clipboardData?.getData('text/plain') || '';
    if (text.length > 300 && isAiAvailable()) {
      setTimeout(() => handlePasteSummarize(text, container), 100);
    }
  });
}

function renderBlocksEdit(blocks) {
  let listNumber = 0;
  return blocks.map((block, idx) => {
    listNumber = block.type === 'numbered' ? listNumber + 1 : 0;
    return renderBlockEdit(block, idx, listNumber);
  }).join('');
}

function renderBlockEdit(block, idx, listNumber = 0) {
  const colorStyle = block.color ? `style="color:${block.color}"` : '';
  const typeClass  = `kn-block--${block.type}`;
  const toggleCollapsed = block.type === 'toggle'
    ? (block.collapsed ?? !(block.children?.length))
    : false;
  const insertRow = renderBlockInsertRow(block.id);
  const controls = `
    <div class="kn-block-controls">
      <button type="button" class="kn-block-move" data-block-action="up" data-block-id="${esc(block.id)}" title="上へ" aria-label="上へ移動">↑</button>
      <button type="button" class="kn-block-move" data-block-action="down" data-block-id="${esc(block.id)}" title="下へ" aria-label="下へ移動">↓</button>
      <button type="button" class="kn-block-move" data-block-action="indent" data-block-id="${esc(block.id)}" title="上のトグルの中へ" aria-label="内側へ移動">→</button>
      <button type="button" class="kn-block-move" data-block-action="outdent" data-block-id="${esc(block.id)}" title="外へ" aria-label="外側へ移動">←</button>
    </div>`;

  if (block.type === 'divider') {
    return `
      <div class="kn-block kn-block--divider${block.id === activeEditorBlockId ? ' kn-block--active' : ''}"
        data-block-id="${esc(block.id)}" tabindex="0" role="separator"
        aria-label="区切り線。選択後、ブロック操作から移動または削除できます">
        <hr class="kn-view-divider">
        ${controls}
      </div>
      ${insertRow}`;
  }

  if (block.type === 'image') {
    return `
      <div class="kn-block kn-block--image${block.id === activeEditorBlockId ? ' kn-block--active' : ''}"
        data-block-id="${esc(block.id)}" tabindex="0">
        <div class="kn-edit-image media-frame media-frame--loading">
          <img data-media-path="${esc(block.path || '')}" data-media-view="1"
            ${Number(block.width) > 0 && Number(block.height) > 0
              ? `width="${Number(block.width)}" height="${Number(block.height)}"`
              : ''}
            data-media-caption="${esc(block.caption || '')}" tabindex="0" role="button"
            aria-label="メモの写真を拡大表示" alt="${esc(block.alt || block.caption || 'メモの写真')}">
          <button type="button" class="kn-image-remove" data-image-remove-id="${esc(block.id)}"
            aria-label="この写真を削除" title="写真を削除">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5"/></svg>
          </button>
          <input class="kn-image-caption" data-image-caption-id="${esc(block.id)}"
            value="${esc(block.caption || '')}" placeholder="写真の説明（任意）">
        </div>
        ${controls}
      </div>
      ${insertRow}`;
  }

  if (block.type === 'math') {
    return `
      <div class="kn-block kn-block--math${block.id === activeEditorBlockId ? ' kn-block--active' : ''}" data-block-id="${esc(block.id)}">
        <div class="kn-block-math-label">∑ KaTeX</div>
        <textarea class="kn-block-math-input kn-block-focusable" data-block-id="${esc(block.id)}"
          placeholder="数式を入力 (例: E=mc^2, \frac{a}{b})">${esc(block.text)}</textarea>
        <div class="kn-block-math-preview" data-katex-preview="${esc(block.id)}"></div>
        ${controls}
      </div>
      ${insertRow}`;
  }

  if (block.type === 'table') {
    const table = normalizeTableData(block);
    return `
      <div class="kn-block kn-block--table${block.id === activeEditorBlockId ? ' kn-block--active' : ''}" data-block-id="${esc(block.id)}" tabindex="0">
        <div class="kn-table-scroll"><table class="kn-edit-table"><thead><tr>${table.headers.map((cell, col) => `<th><input class="kn-table-input" data-table-header data-block-id="${esc(block.id)}" data-table-col="${col}" value="${esc(cell)}" aria-label="表の見出し ${col + 1}"></th>`).join('')}</tr></thead><tbody>${table.rows.map((row, rowIndex) => `<tr>${row.map((cell, col) => `<td><input class="kn-table-input" data-table-cell data-block-id="${esc(block.id)}" data-table-row="${rowIndex}" data-table-col="${col}" value="${esc(cell)}" aria-label="表の${rowIndex + 1}行${col + 1}列"></td>`).join('')}</tr>`).join('')}</tbody></table></div>
        <div class="kn-table-actions" aria-label="表の編集"><button type="button" data-table-action="add-row" data-block-id="${esc(block.id)}">行を追加</button><button type="button" data-table-action="remove-row" data-block-id="${esc(block.id)}" ${table.rows.length <= 1 ? 'disabled' : ''}>行を削除</button><button type="button" data-table-action="add-column" data-block-id="${esc(block.id)}">列を追加</button><button type="button" data-table-action="remove-column" data-block-id="${esc(block.id)}" ${table.headers.length <= 2 ? 'disabled' : ''}>列を削除</button></div>
        ${controls}
      </div>
      ${insertRow}`;
  }

  const placeholder = {
    paragraph: 'テキストを入力…',
    h1: '見出し1',
    h2: '見出し2',
    h3: '見出し3',
    bullet: '箇条書き',
    numbered: '番号付きリスト',
    quote: '引用',
    toggle: 'トグルのタイトル',
  }[block.type] || 'テキスト…';

  const prefix = {
    bullet:   '<span class="kn-block-prefix">•</span>',
    numbered: `<span class="kn-block-prefix">${listNumber || 1}.</span>`,
    quote:    '<span class="kn-block-prefix kn-block-prefix--quote">❝</span>',
    toggle:   `<button type="button" class="kn-block-prefix kn-block-prefix--toggle kn-toggle-edit-btn"
      data-toggle-edit-id="${esc(block.id)}" aria-label="${toggleCollapsed ? 'トグルを開く' : 'トグルを閉じる'}"
      aria-expanded="${String(!toggleCollapsed)}">${toggleCollapsed ? '▶' : '▼'}</button>`,
  }[block.type] || '';

  return `
    <div class="kn-block ${typeClass}${block.id === activeEditorBlockId ? ' kn-block--active' : ''}" data-block-id="${esc(block.id)}">
      ${prefix}
      <div class="kn-block-text kn-block-focusable" contenteditable="true"
        data-block-id="${esc(block.id)}"
        data-placeholder="${esc(placeholder)}"
        ${colorStyle}>${getBlockEditorHtml(block)}</div>
      ${block.type === 'toggle' && !toggleCollapsed && block.children?.length ? `
        <div class="kn-block-toggle-children-edit">
          ${renderBlocksEdit(block.children || [])}
        </div>` : ''}
      ${controls}
    </div>
    ${insertRow}`;
}

function renderBlockInsertRow(blockId) {
  // One add control is enough. Per-row buttons were easy to leave behind after a block was removed.
  return '';
}

function renderBlockTypeOptions(currentType) {
  return BLOCK_TYPES
    .map(bt => `<option value="${esc(bt.type)}"${bt.type === currentType ? ' selected' : ''}>${esc(bt.label)}</option>`)
    .join('');
}

function wireBlocksEdit(container) {
  const wrap = container.querySelector('#kn-blocks-wrap');
  if (!wrap) return;
  if (wrap.dataset.wired === '1') {
    renderMathPreviews(container);
    hydratePlannerImages(wrap);
    return;
  }
  wrap.dataset.wired = '1';
  wireBlockDrag(container, wrap);
  wireEditorImageLongPress(container, wrap);
  hydratePlannerImages(wrap);
  wirePlannerImageViewer(wrap);

  wrap.addEventListener('paste', event => {
    handleEditorPaste(event, container);
  });

  wrap.addEventListener('beforeinput', event => {
    if (event.target?.closest?.('[contenteditable="true"], textarea, input')) {
      beginEditorTextHistory(container);
    }
  });

  // Sync text on input
  wrap.addEventListener('input', e => {
    // Fallback for keyboards and browser automation paths that omit
    // beforeinput. At this point edState still has the pre-edit value.
    beginEditorTextHistory(container);
    const el = e.target;
    if (el.matches?.('[data-table-header], [data-table-cell]')) {
      const block = findBlockInAllBlocks(edState.blocks, el.dataset.blockId);
      if (!block) return;
      const table = normalizeTableData(block);
      const col = Number(el.dataset.tableCol);
      if (el.hasAttribute('data-table-header')) {
        table.headers[col] = el.value;
      } else {
        table.rows[Number(el.dataset.tableRow)][col] = el.value;
      }
      block.table = table;
      return;
    }
    const imageCaptionId = el.dataset.imageCaptionId;
    if (imageCaptionId) {
      const block = findBlockInAllBlocks(edState.blocks, imageCaptionId);
      if (block) block.caption = el.value;
      return;
    }
    const blockId = el.dataset.blockId;
    if (!blockId) return;

    if (el.tagName === 'TEXTAREA') {
      // Math block
      const block = findBlockInAllBlocks(edState.blocks, blockId);
      if (block) {
        block.text = el.value;
        // Live KaTeX preview
        const preview = container.querySelector(`[data-katex-preview="${blockId}"]`);
        if (preview && typeof katex !== 'undefined') {
          try {
            preview.innerHTML = katex.renderToString(el.value, { displayMode: true, throwOnError: false });
          } catch {}
        }
      }
    } else if (el.contentEditable === 'true') {
      const block = findBlockInAllBlocks(edState.blocks, blockId);
      if (block) {
        block.text = el.textContent.replace(/\u200B/g, '');
        block.html = sanitizeBlockHtml(el.innerHTML).replace(/\u200B/g, '');
      }
    }
  });

  // Keyboard shortcuts
  wrap.addEventListener('keydown', e => {
    const el = e.target;
    if (el.contentEditable !== 'true') return;
    const blockId = el.dataset.blockId;
    if (!blockId) return;
    handleBlockKeydown(e, blockId, container);
  });

  // Some mobile keyboards send only beforeinput for the return key.
  wrap.addEventListener('beforeinput', e => {
    const el = e.target;
    if (el.contentEditable !== 'true') return;
    const isLineBreak = e.inputType === 'insertParagraph'
      || e.inputType === 'insertLineBreak'
      || (e.inputType === 'insertText' && /\r?\n/.test(e.data || ''));
    if (!isLineBreak) return;
    const blockId = el.dataset.blockId;
    if (!blockId) return;
    e.preventDefault();
    const block = findBlockInAllBlocks(edState.blocks, blockId);
    if (block?.type === 'toggle') {
      openToggleForEditing(blockId, container);
      return;
    }
    if (block?.type === 'bullet' || block?.type === 'numbered') {
      continueListFromBlock(blockId, container, el);
      return;
    }
    insertBlockLineBreak(el);
    syncEditableBlock(blockId, el);
  });

  // Focus tracking for toolbar highlight
  wrap.addEventListener('focusin', e => {
    const el = e.target;
    const blockId = el.dataset.blockId;
    if (!blockId) return;
    activeEditorBlockId = blockId;
    wrap.querySelectorAll('.kn-block--active').forEach(blockEl => blockEl.classList.remove('kn-block--active'));
    el.closest('.kn-block')?.classList.add('kn-block--active');
    const block = findBlockInAllBlocks(edState.blocks, blockId);
    if (block) highlightToolbarType(container, block.type);
  });

  // Delete buttons
  wrap.addEventListener('click', e => {
    const selectedBlock = e.target.closest('.kn-block[data-block-id]');
    if (selectedBlock) {
      activeEditorBlockId = selectedBlock.dataset.blockId;
      wrap.querySelectorAll('.kn-block--active').forEach(blockEl => blockEl.classList.remove('kn-block--active'));
      selectedBlock.classList.add('kn-block--active');
      const selected = findBlockInAllBlocks(edState.blocks, activeEditorBlockId);
      if (selected) highlightToolbarType(container, selected.type);
    }

    const tableAction = e.target.closest('[data-table-action]');
    if (tableAction) {
      changeTableShape(tableAction.dataset.blockId, tableAction.dataset.tableAction, container);
      return;
    }

    const imageRemove = e.target.closest('[data-image-remove-id]');
    if (imageRemove) {
      removeEditorImageBlock(imageRemove.dataset.imageRemoveId, container);
      return;
    }

    const toggleBtn = e.target.closest('[data-toggle-edit-id]');
    if (toggleBtn) {
      toggleEditorBlock(toggleBtn.dataset.toggleEditId, container);
      return;
    }

    const insertBtn = e.target.closest('[data-insert-block-type]');
    if (insertBtn) {
      recordEditorHistory(container);
      const afterId = insertBtn.dataset.insertAfter;
      const type = insertBtn.dataset.insertBlockType || 'paragraph';
      const inserted = insertBlockAfter(afterId, type);
      if (inserted) {
        rerenderBlocks(container);
        focusBlock(inserted.id, container);
      }
      return;
    }

    const moveBtn = e.target.closest('[data-block-action]');
    if (moveBtn) {
      const blockId = moveBtn.dataset.blockId;
      if (moveBtn.dataset.blockAction === 'indent') {
        showToggleTargetPicker(container, blockId);
        return;
      }
      const scrollOwner = document.getElementById('main-content');
      const scrollTop = scrollOwner?.scrollTop || 0;
      recordEditorHistory(container);
      if (moveBlock(blockId, moveBtn.dataset.blockAction)) {
        rerenderBlocks(container);
        if (scrollOwner) scrollOwner.scrollTop = scrollTop;
        focusBlock(blockId, container, true);
      }
      return;
    }

  });

  renderMathPreviews(container);
}

function wireBlockDrag(container, wrap) {
  let dragState = null;
  let holdTimer = null;
  const clearHoldTimer = () => {
    clearTimeout(holdTimer);
    holdTimer = null;
  };
  const clearIndicators = () => {
    wrap.querySelectorAll('.kn-block--drop-before, .kn-block--drop-after, .kn-block--drop-inside')
      .forEach(el => el.classList.remove('kn-block--drop-before', 'kn-block--drop-after', 'kn-block--drop-inside'));
  };
  const finishDrag = (cancelled = false) => {
    clearHoldTimer();
    if (!dragState) return;
    const state = dragState;
    dragState = null;
    clearIndicators();
    document.body.classList.remove('kn-block-drag-active');
    wrap.querySelector(`[data-block-id="${state.blockId}"]`)?.classList.remove('kn-block--dragging');

    if (!cancelled && state.dragging && state.targetId && state.placement) {
      recordEditorHistory(container);
      if (moveBlockByDrop(state.blockId, state.targetId, state.placement)) {
        activeEditorBlockId = state.blockId;
        rerenderBlocks(container);
      }
      return;
    }

    if (!state.dragging) {
      activeEditorBlockId = state.blockId;
      wrap.querySelectorAll('.kn-block--active').forEach(el => el.classList.remove('kn-block--active'));
      const blockEl = wrap.querySelector(`[data-block-id="${state.blockId}"]`);
      blockEl?.classList.add('kn-block--active');
      const block = findBlockInAllBlocks(edState.blocks, state.blockId);
      if (block) highlightToolbarType(container, block.type);
    }
  };

  wrap.addEventListener('pointerdown', e => {
    if (e.target.closest('button, select, input, textarea, a, [data-media-view]')) return;
    const blockEl = e.target.closest('.kn-block[data-block-id]');
    if (!blockEl || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const blockId = blockEl.dataset.blockId;
    const movingBlock = findBlockInAllBlocks(edState.blocks, blockId);
    if (!movingBlock) return;
    dragState = {
      blockId,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      dragging: false,
      targetId: null,
      placement: null,
      blockedIds: collectBlockIds(movingBlock),
      blockEl,
    };
    activeEditorBlockId = blockId;
    holdTimer = setTimeout(() => {
      if (!dragState || dragState.pointerId !== e.pointerId) return;
      dragState.dragging = true;
      document.body.classList.add('kn-block-drag-active');
      blockEl.classList.add('kn-block--dragging');
      blockEl.setPointerCapture?.(e.pointerId);
      navigator.vibrate?.(12);
    }, e.pointerType === 'mouse' ? 280 : 380);
  });

  wrap.addEventListener('pointermove', e => {
    if (!dragState || dragState.pointerId !== e.pointerId) return;
    const distance = Math.hypot(e.clientX - dragState.startX, e.clientY - dragState.startY);
    if (!dragState.dragging) {
      if (distance > 8) {
        clearHoldTimer();
        dragState = null;
      }
      return;
    }
    e.preventDefault();
    clearIndicators();

    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const targetEl = hit?.closest?.('.kn-block[data-block-id]');
    const targetId = targetEl?.dataset.blockId;
    if (!targetEl || !targetId || dragState.blockedIds.has(targetId)) {
      dragState.targetId = null;
      dragState.placement = null;
      return;
    }

    const placement = resolveBlockDropPlacement(targetEl, e.clientX, e.clientY);
    dragState.targetId = targetId;
    dragState.placement = placement;
    targetEl.classList.add(`kn-block--drop-${placement}`);

    const scrollOwner = document.getElementById('main-content');
    if (scrollOwner) {
      if (e.clientY < 92) scrollOwner.scrollTop -= 14;
      else if (e.clientY > window.innerHeight - 92) scrollOwner.scrollTop += 14;
    }
  });

  wrap.addEventListener('pointerup', e => {
    if (!dragState || dragState.pointerId !== e.pointerId) return;
    finishDrag(false);
  });
  wrap.addEventListener('pointercancel', () => finishDrag(true));

  wrap.addEventListener('keydown', e => {
    if (!e.altKey) return;
    const blockEl = e.target.closest('.kn-block[data-block-id]');
    if (!blockEl) return;
    const blockId = blockEl.dataset.blockId;
    const action = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'outdent',
    }[e.key];
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      showToggleTargetPicker(container, blockId);
      return;
    }
    if (!action) return;
    e.preventDefault();
    recordEditorHistory(container);
    if (!moveBlock(blockId, action)) return;
    activeEditorBlockId = blockId;
    rerenderBlocks(container);
    requestAnimationFrame(() => container.querySelector(`[data-block-id="${blockId}"]`)?.focus());
  });
}

function wireEditorImageLongPress(container, wrap) {
  let press = null;
  let suppressClickUntil = 0;
  const clear = () => {
    if (press?.timer) clearTimeout(press.timer);
    press = null;
  };

  wrap.addEventListener('click', event => {
    if (Date.now() > suppressClickUntil || !event.target.closest('[data-media-view]')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  wrap.addEventListener('pointerdown', event => {
    const image = event.target.closest('.kn-block--image [data-media-view]');
    if (!image || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const blockId = image.closest('.kn-block[data-block-id]')?.dataset.blockId;
    if (!blockId) return;
    clear();
    press = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      timer: setTimeout(() => {
        suppressClickUntil = Date.now() + 700;
        navigator.vibrate?.(12);
        clear();
        removeEditorImageBlock(blockId, container);
      }, 560),
    };
  });
  wrap.addEventListener('pointermove', event => {
    if (!press || press.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - press.startX, event.clientY - press.startY) > 9) clear();
  });
  wrap.addEventListener('pointerup', clear);
  wrap.addEventListener('pointercancel', clear);
  wrap.addEventListener('contextmenu', event => {
    const image = event.target.closest('.kn-block--image [data-media-view]');
    if (!image) return;
    event.preventDefault();
    if (Date.now() <= suppressClickUntil) return;
    const blockId = image.closest('.kn-block[data-block-id]')?.dataset.blockId;
    if (blockId) removeEditorImageBlock(blockId, container);
  });
}

function removeEditorImageBlock(blockId, container) {
  const block = findBlockInAllBlocks(edState.blocks, blockId);
  if (!block || block.type !== 'image') return false;
  if (!window.confirm('この写真をメモから削除しますか？')) return false;
  recordEditorHistory(container);
  if (block.path) pendingImageDeletes.add(block.path);
  removeBlockById(blockId);
  if (!edState.blocks.length) edState.blocks.push(defaultBlock());
  activeEditorBlockId = edState.blocks[0]?.id || null;
  rerenderBlocks(container);
  toast('写真をメモから外しました。保存後に確定します', 'info');
  return true;
}

function resolveBlockDropPlacement(targetEl, clientX, clientY) {
  const targetId = targetEl.dataset.blockId;
  const target = findBlockInAllBlocks(edState.blocks, targetId);
  const titleEl = [...targetEl.children].find(el => el.classList?.contains('kn-block-text'));
  const rect = (titleEl || targetEl).getBoundingClientRect();
  const inset = Math.min(8, rect.height * 0.22);
  if (target?.type === 'toggle'
    && clientX >= rect.left - 4
    && clientY >= rect.top + inset
    && clientY <= rect.bottom - inset) {
    return 'inside';
  }
  return clientY < rect.top + rect.height / 2 ? 'before' : 'after';
}

function renderMathPreviews(container) {
  requestAnimationFrame(() => {
    container.querySelectorAll('.kn-block--math .kn-block-math-input').forEach(ta => {
      const blockId = ta.dataset.blockId;
      const preview = container.querySelector(`[data-katex-preview="${blockId}"]`);
      if (preview && typeof katex !== 'undefined' && ta.value) {
        try {
          preview.innerHTML = katex.renderToString(ta.value, { displayMode: true, throwOnError: false });
        } catch {}
      }
    });
  });
}

function handleBlockKeydown(e, blockId, container) {
  if (e.key === 'Enter' && !(e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    e.stopPropagation();
    const block = findBlockInAllBlocks(edState.blocks, blockId);
    recordEditorHistory(container);
    if (block?.type === 'toggle' && !e.shiftKey) {
      openToggleForEditing(blockId, container);
      return;
    }
    if (!e.shiftKey) {
      if (block?.type === 'bullet' || block?.type === 'numbered') {
        continueListFromBlock(blockId, container, e.target);
        return;
      }
    }
    insertBlockLineBreak(e.target);
    syncEditableBlock(blockId, e.target);
    return;
  }

  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    const loc = findBlockLocation(blockId);
    if (!loc) return;
    recordEditorHistory(container);
    const currentBlock = loc.blocks[loc.idx];
    const newBlock = defaultBlock();
    // If in toggle, add child
    if (currentBlock.type === 'toggle') {
      currentBlock.children = currentBlock.children || [];
      currentBlock.children.push(newBlock);
      rerenderBlocks(container);
      focusBlock(newBlock.id, container);
      return;
    }
    loc.blocks.splice(loc.idx + 1, 0, newBlock);
    rerenderBlocks(container);
    focusBlock(newBlock.id, container);
  }

  if (e.key === 'Backspace') {
    const el = e.target;
    const loc = findBlockLocation(blockId);
    if (el.textContent === '' && loc && (loc.parent || edState.blocks.length > 1)) {
      e.preventDefault();
      recordEditorHistory(container);
      removeBlockById(blockId);
      removeBlockElement(blockId, container);
      const prevBlock = loc.blocks[Math.max(0, loc.idx - 1)] || loc.parent || edState.blocks[0];
      if (prevBlock) focusBlock(prevBlock.id, container, true);
    }
  }
}

function openToggleForEditing(blockId, container) {
  recordEditorHistory(container);
  syncFocusedEditableBlock(container, blockId);
  const block = findBlockInAllBlocks(edState.blocks, blockId);
  if (!block || block.type !== 'toggle') return;
  block.children = block.children || [];
  if (!block.children.length) block.children.push(defaultBlock());
  block.collapsed = false;
  const childId = block.children[0].id;
  rerenderBlocks(container);
  focusBlock(childId, container);
}

function toggleEditorBlock(blockId, container) {
  recordEditorHistory(container);
  syncFocusedEditableBlock(container, blockId);
  const block = findBlockInAllBlocks(edState.blocks, blockId);
  if (!block || block.type !== 'toggle') return;

  if (!block.collapsed && block.children?.length) {
    block.collapsed = true;
    rerenderBlocks(container);
    focusBlock(blockId, container, true);
    return;
  }

  openToggleForEditing(blockId, container);
}

function splitEditableAtCaret(editable) {
  const selection = window.getSelection();
  if (!editable || !selection?.rangeCount) return null;
  const caret = selection.getRangeAt(0).cloneRange();
  if (!editable.contains(caret.commonAncestorContainer)) return null;
  if (!caret.collapsed) {
    caret.deleteContents();
    caret.collapse(true);
  }

  const extract = range => {
    const holder = document.createElement('div');
    holder.appendChild(range.cloneContents());
    return {
      text: holder.textContent.replace(/\u200B/g, ''),
      html: sanitizeBlockHtml(holder.innerHTML).replace(/\u200B/g, ''),
    };
  };
  const beforeRange = document.createRange();
  beforeRange.selectNodeContents(editable);
  beforeRange.setEnd(caret.startContainer, caret.startOffset);
  const afterRange = document.createRange();
  afterRange.selectNodeContents(editable);
  afterRange.setStart(caret.startContainer, caret.startOffset);
  return { before: extract(beforeRange), after: extract(afterRange) };
}

function continueListFromBlock(blockId, container, editable = null) {
  syncFocusedEditableBlock(container, blockId);
  const loc = findBlockLocation(blockId);
  if (!loc) return;
  const currentBlock = loc.blocks[loc.idx];
  if (!currentBlock) return;

  // Enter on an empty list item finishes that list item, like ordinary note editors.
  if (!(currentBlock.text || '').trim()) {
    currentBlock.type = 'paragraph';
    rerenderBlocks(container);
    focusBlock(blockId, container);
    return;
  }

  const split = splitEditableAtCaret(editable);
  if (split) {
    currentBlock.text = split.before.text;
    currentBlock.html = split.before.html;
  }

  const nextBlock = insertBlockAfter(blockId, currentBlock.type);
  if (!nextBlock) return;
  if (split) {
    nextBlock.text = split.after.text;
    nextBlock.html = split.after.html;
  }
  rerenderBlocks(container);
  focusBlock(nextBlock.id, container);
}

function insertBlockLineBreak(editable) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (!editable.contains(range.commonAncestorContainer)) return;

  range.deleteContents();
  const fragment = document.createDocumentFragment();
  const lineBreak = document.createElement('br');
  const caretAnchor = document.createTextNode('\u200B');
  fragment.append(lineBreak, caretAnchor);
  range.insertNode(fragment);
  range.setStart(caretAnchor, 0);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function syncEditableBlock(blockId, editable) {
  const block = findBlockInAllBlocks(edState.blocks, blockId);
  if (!block) return;
  block.text = editable.textContent.replace(/\u200B/g, '');
  block.html = sanitizeBlockHtml(editable.innerHTML).replace(/\u200B/g, '');
}

function wireToolbar(container) {
  let savedHighlightSelection = null;
  const blockMenuToggle = container.querySelector('#kn-block-actions-toggle');
  const blockMenu = container.querySelector('.kn-toolbar-block-actions');
  const placeBlockMenu = () => {
    if (!blockMenuToggle || !blockMenu) return;
    const rect = blockMenuToggle.getBoundingClientRect();
    blockMenu.style.top = `${Math.round(rect.bottom + 6)}px`;
    blockMenu.style.right = `${Math.max(10, Math.round(window.innerWidth - rect.right))}px`;
  };
  const closeBlockMenu = () => {
    blockMenu?.classList.remove('is-open');
    blockMenuToggle?.setAttribute('aria-expanded', 'false');
  };
  blockMenuToggle?.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = blockMenu?.classList.toggle('is-open');
    if (isOpen) placeBlockMenu();
    blockMenuToggle.setAttribute('aria-expanded', String(!!isOpen));
  });
  container.querySelector('.kn-edit-page')?.addEventListener('click', e => {
    if (!e.target.closest('#kn-block-actions-toggle, .kn-toolbar-block-actions')) closeBlockMenu();
    if (!e.target.closest('#kn-toggle-target-picker, [data-block-action="indent"], [data-toolbar-block-action="indent"]')) {
      container.querySelector('#kn-toggle-target-picker')?.classList.add('hidden');
    }
  });

  const typeSelect = container.querySelector('#kn-toolbar-type-select');
  typeSelect?.addEventListener('change', () => {
    const type = typeSelect.value || 'paragraph';
    const focusedBlockId = resolveActiveEditorBlockId(container);
    if (focusedBlockId) {
      changeBlockType(focusedBlockId, type, container);
      return;
    }
    edState.blocks.push({ ...defaultBlock(), type });
    rerenderBlocks(container);
    focusLastBlock(container);
  });

  container.querySelectorAll('[data-toolbar-block-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const blockId = resolveActiveEditorBlockId(container);
      if (!blockId) return;
      const action = btn.dataset.toolbarBlockAction;
      closeBlockMenu();
      if (action === 'indent') {
        showToggleTargetPicker(container, blockId);
        return;
      }

      const scrollOwner = document.getElementById('main-content');
      const scrollTop = scrollOwner?.scrollTop || 0;
      recordEditorHistory(container);
      if (!moveBlock(blockId, action)) return;
      rerenderBlocks(container);
      if (scrollOwner) scrollOwner.scrollTop = scrollTop;
      focusBlock(blockId, container, true);
    });
  });

  container.querySelectorAll('[data-inline-command]').forEach(btn => {
    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.addEventListener('click', () => {
      const focusedBlockId = getFocusedBlockId(container);
      if (!focusedBlockId) return;
      const command = btn.dataset.inlineCommand;
      recordEditorHistory(container);
      document.execCommand?.(command, false, null);
      syncFocusedEditableBlock(container, focusedBlockId);
      focusEditableWithoutScroll(container.querySelector(`.kn-block-focusable[data-block-id="${focusedBlockId}"]`));
    });
  });

  // Color picker toggle
  const colorBtn = container.querySelector('#kn-color-btn');
  colorBtn?.addEventListener('mousedown', e => e.preventDefault());
  colorBtn?.addEventListener('click', () => {
    const picker = container.querySelector('#kn-color-picker');
    picker?.classList.toggle('hidden');
    container.querySelector('#kn-highlight-picker')?.classList.add('hidden');
    container.querySelector('#kn-highlight-btn')?.setAttribute('aria-expanded', 'false');
  });

  const highlightBtn = container.querySelector('#kn-highlight-btn');
  highlightBtn?.addEventListener('mousedown', e => {
    const focusedBlockId = getFocusedBlockId(container);
    const active = focusedBlockId
      ? container.querySelector(`.kn-block-focusable[data-block-id="${focusedBlockId}"]:focus`)
      : null;
    const selection = window.getSelection();
    if (active && selection?.rangeCount && !selection.isCollapsed
      && active.contains(selection.anchorNode) && active.contains(selection.focusNode)) {
      savedHighlightSelection = {
        blockId: focusedBlockId,
        range: selection.getRangeAt(0).cloneRange(),
      };
    } else {
      savedHighlightSelection = null;
    }
    e.preventDefault();
  });
  highlightBtn?.addEventListener('click', () => {
    const picker = container.querySelector('#kn-highlight-picker');
    const willOpen = picker?.classList.contains('hidden');
    picker?.classList.toggle('hidden');
    highlightBtn.setAttribute('aria-expanded', String(!!willOpen));
    container.querySelector('#kn-color-picker')?.classList.add('hidden');
  });

  container.querySelectorAll('[data-highlight-id]').forEach(swatch => {
    swatch.addEventListener('mousedown', e => e.preventDefault());
    swatch.addEventListener('click', () => {
      const color = HIGHLIGHT_COLORS.find(item => item.id === swatch.dataset.highlightId);
      const focusedBlockId = savedHighlightSelection?.blockId || getFocusedBlockId(container);
      const active = focusedBlockId
        ? container.querySelector(`.kn-block-focusable[data-block-id="${focusedBlockId}"]`)
        : null;
      const selection = window.getSelection();
      if (active && savedHighlightSelection?.range) {
        selection?.removeAllRanges();
        selection?.addRange(savedHighlightSelection.range);
      }
      const hasSelectedText = active && selection?.rangeCount && !selection.isCollapsed
        && active.contains(selection.anchorNode) && active.contains(selection.focusNode);

      if (!color || !hasSelectedText) {
        toast('マーカーを付ける文字を選択してください', 'info');
      } else {
        recordEditorHistory(container);
        const ok = document.execCommand?.('hiliteColor', false, color.css);
        if (!ok) document.execCommand?.('backColor', false, color.css);
        syncFocusedEditableBlock(container, focusedBlockId);
        focusEditableWithoutScroll(active);
      }

      container.querySelector('#kn-highlight-picker')?.classList.add('hidden');
      highlightBtn?.setAttribute('aria-expanded', 'false');
      savedHighlightSelection = null;
    });
  });

  // Color swatches
  container.querySelectorAll('[data-color-id]').forEach(swatch => {
    swatch.addEventListener('mousedown', e => e.preventDefault());
    swatch.addEventListener('click', () => {
      const colorId = swatch.dataset.colorId;
      const color = BLOCK_COLORS.find(c => c.id === colorId);
      const focusedBlockId = getFocusedBlockId(container);
      if (focusedBlockId && color) {
        recordEditorHistory(container);
        const active = container.querySelector(`.kn-block-focusable[data-block-id="${focusedBlockId}"]:focus`);
        const selection = window.getSelection();
        if (active && selection && selection.rangeCount && !selection.isCollapsed && active.contains(selection.anchorNode)) {
          document.execCommand?.('foreColor', false, color.css || 'inherit');
          syncFocusedEditableBlock(container, focusedBlockId);
          focusEditableWithoutScroll(active);
        } else {
          const block = findBlockInAllBlocks(edState.blocks, focusedBlockId);
          if (block) {
            block.color = color.css || null;
            rerenderBlocks(container);
            focusBlock(focusedBlockId, container, true);
          }
        }
      }
      container.querySelector('#kn-color-picker')?.classList.add('hidden');
    });
  });
}

function getFocusedBlockId(container) {
  const el = container.querySelector('.kn-block-focusable:focus');
  return el?.dataset.blockId || null;
}

function resolveActiveEditorBlockId(container) {
  const candidate = getFocusedBlockId(container) || activeEditorBlockId;
  if (candidate && findBlockInAllBlocks(edState.blocks, candidate)) return candidate;
  activeEditorBlockId = edState.blocks[0]?.id || null;
  return activeEditorBlockId;
}

function highlightToolbarType(container, type) {
  const select = container.querySelector('#kn-toolbar-type-select');
  if (select) select.value = type;
}

function changeBlockType(blockId, type, container) {
  const loc = findBlockLocation(blockId);
  const block = loc?.blocks[loc.idx];
  if (!block || !loc) return;
  recordEditorHistory(container);
  if (type === 'divider') {
    const divider = insertBlockAfter(blockId, 'divider');
    if (!divider) return;
    activeEditorBlockId = divider.id;
    rerenderBlocks(container);
    focusBlock(divider.id, container);
    return;
  }
  const releasedChildren = block.type === 'toggle' && type !== 'toggle'
    ? [...(block.children || [])]
    : [];

  block.type = type;
  if (type === 'toggle') {
    block.children = block.children || [];
    block.collapsed = block.collapsed ?? block.children.length === 0;
  } else if (type === 'table') {
    block.table = normalizeTableData(block);
    delete block.children;
    delete block.collapsed;
    if (releasedChildren.length) {
      loc.blocks.splice(loc.idx + 1, 0, ...releasedChildren);
    }
  } else {
    delete block.children;
    delete block.collapsed;
    delete block.table;
    if (releasedChildren.length) {
      loc.blocks.splice(loc.idx + 1, 0, ...releasedChildren);
    }
  }
  rerenderBlocks(container);
  focusBlock(blockId, container, true);
}

function insertBlockAfter(blockId, type = 'paragraph') {
  const loc = findBlockLocation(blockId);
  if (!loc) return null;
  const newBlock = defaultBlock(type);
  if (type === 'toggle') newBlock.children = [];
  loc.blocks.splice(loc.idx + 1, 0, newBlock);
  return newBlock;
}

function clipboardBlocksFromHtml(html) {
  const template = document.createElement('template');
  template.innerHTML = String(html || '');
  const blocks = [];
  const inferredTextBlockType = element => {
    const tag = element?.tagName;
    if (tag === 'H1') return 'h1';
    if (tag === 'H2') return 'h2';
    if (tag && /^H[3-6]$/.test(tag)) return 'h3';
    const size = Number.parseFloat(element?.style?.fontSize || '');
    if (Number.isFinite(size)) {
      if (size >= 24) return 'h1';
      if (size >= 19) return 'h2';
      if (size >= 16 && (element?.querySelector('b,strong') || Number.parseInt(element?.style?.fontWeight, 10) >= 600)) return 'h3';
    }
    return 'paragraph';
  };
  const addTextBlock = (element, type = 'paragraph') => {
    const text = String(element?.textContent || '').replace(/\u200B/g, '').trim();
    const inlineHtml = sanitizeBlockHtml(element?.innerHTML || '').replace(/\u200B/g, '').trim();
    if (!text && !inlineHtml) return;
    blocks.push({ id: generateId(), type: type === 'paragraph' ? inferredTextBlockType(element) : type, text, html: inlineHtml, color: null });
  };
  const addTable = table => {
    const rows = [...table.querySelectorAll('tr')].map(row => (
      [...row.querySelectorAll('th,td')].map(cell => String(cell.textContent || '').trim())
    )).filter(row => row.some(Boolean));
    if (!rows.length) return;
    const headerRow = rows.shift() || [];
    const width = Math.max(2, headerRow.length, ...rows.map(row => row.length));
    blocks.push({
      id: generateId(),
      type: 'table',
      text: '',
      color: null,
      table: {
        headers: Array.from({ length: width }, (_, index) => headerRow[index] || ''),
        rows: rows.map(row => Array.from({ length: width }, (_, index) => row[index] || '')),
      },
    });
  };
  const visit = node => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent.trim()) addTextBlock({ textContent: node.textContent, innerHTML: esc(node.textContent) });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName;
    if (/^H[1-6]$/.test(tag)) return addTextBlock(node, inferredTextBlockType(node));
    if (tag === 'P') return addTextBlock(node, 'paragraph');
    if (tag === 'DIV') {
      const hasBlockChildren = [...node.children].some(child => (
        ['H1', 'H2', 'H3', 'P', 'DIV', 'UL', 'OL', 'BLOCKQUOTE', 'TABLE', 'HR'].includes(child.tagName)
      ));
      if (hasBlockChildren) {
        [...node.childNodes].forEach(visit);
        return;
      }
      return addTextBlock(node, 'paragraph');
    }
    if (tag === 'BLOCKQUOTE') return addTextBlock(node, 'quote');
    if (tag === 'HR') {
      blocks.push({ id: generateId(), type: 'divider', text: '', color: null });
      return;
    }
    if (tag === 'UL' || tag === 'OL') {
      [...node.children].filter(child => child.tagName === 'LI').forEach(child => addTextBlock(child, tag === 'OL' ? 'numbered' : 'bullet'));
      return;
    }
    if (tag === 'TABLE') {
      addTable(node);
      return;
    }
    [...node.childNodes].forEach(visit);
  };
  [...template.content.childNodes].forEach(visit);
  return blocks;
}

function hasStructuredClipboardHtml(html) {
  const template = document.createElement('template');
  template.innerHTML = String(html || '');
  return Boolean(template.content.querySelector(
    'h1,h2,h3,h4,h5,h6,p,div,ul,ol,li,blockquote,table,hr'
  ));
}

function clipboardImageFiles(clipboard) {
  const files = [...(clipboard?.files || [])].filter(file => file.type.startsWith('image/'));
  for (const item of [...(clipboard?.items || [])]) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    const file = item.getAsFile?.();
    if (file && !files.some(existing => existing.name === file.name && existing.size === file.size && existing.type === file.type)) {
      files.push(file);
    }
  }
  return files;
}

function clipboardImageSources(html) {
  const template = document.createElement('template');
  template.innerHTML = String(html || '');
  return [...template.content.querySelectorAll('img[src]')]
    .map(image => image.getAttribute('src') || '')
    .filter(Boolean);
}

async function clipboardImageSourceToFile(source, index) {
  try {
    const response = await fetch(source);
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) return null;
    const extension = blob.type.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'png';
    return new File([blob], `clipboard-${Date.now()}-${index}.${extension}`, { type: blob.type });
  } catch {
    return null;
  }
}

function insertRichClipboardBlocks(blockId, editable, blocks, container) {
  const loc = findBlockLocation(blockId);
  if (!loc || !blocks.length) return false;
  const split = splitEditableAtCaret(editable);
  const current = loc.blocks[loc.idx];
  const before = split?.before || { text: current.text || '', html: current.html || '' };
  const after = split?.after || { text: '', html: '' };
  const beforeIsEmpty = !String(before.text || '').trim() && !String(before.html || '').replace(/<br\s*\/?>(\s*)/gi, '').trim();
  const inserted = blocks.map(block => ({ ...block }));
  if (beforeIsEmpty) {
    const first = inserted.shift();
    Object.keys(current).forEach(key => delete current[key]);
    Object.assign(current, first, { id: current.id });
  } else {
    current.text = before.text;
    current.html = before.html;
  }
  const insertAt = loc.idx + 1;
  if (inserted.length) loc.blocks.splice(insertAt, 0, ...inserted);
  if (String(after.text || '').trim() || String(after.html || '').trim()) {
    loc.blocks.splice(insertAt + inserted.length, 0, {
      id: generateId(), type: 'paragraph', text: after.text, html: after.html, color: null,
    });
  }
  const focusTarget = inserted[inserted.length - 1]?.id || current.id;
  activeEditorBlockId = focusTarget;
  rerenderBlocks(container);
  focusBlock(focusTarget, container, true);
  return true;
}

function handleEditorPaste(event, container) {
  const target = event.target;
  const editable = target?.closest?.('[contenteditable="true"]');
  if (!editable) return;
  recordEditorHistory(container);
  const clipboard = event.clipboardData;
  if (!clipboard) return;
  const imageFiles = clipboardImageFiles(clipboard);
  if (imageFiles.length) {
    event.preventDefault();
    event.stopPropagation();
    imageFiles.reduce(
      (pending, file) => pending.then(() => insertMemoImageFile(file, container)),
      Promise.resolve()
    );
    return;
  }
  const html = clipboard.getData('text/html');
  if (!html) return;
  const imageSources = clipboardImageSources(html);
  if (imageSources.length) {
    event.preventDefault();
    event.stopPropagation();
    Promise.all(imageSources.map(clipboardImageSourceToFile)).then(files => {
      const readableFiles = files.filter(Boolean);
      if (!readableFiles.length) {
        toast('この画像は安全に読み取れませんでした。画像ファイルとして貼り付け直してください。', 'error');
        return;
      }
      readableFiles.reduce(
        (pending, file) => pending.then(() => insertMemoImageFile(file, container)),
        Promise.resolve()
      );
    });
    return;
  }
  if (!hasStructuredClipboardHtml(html)) {
    const safeHtml = sanitizeBlockHtml(html);
    if (!safeHtml) return;
    event.preventDefault();
    event.stopPropagation();
    document.execCommand?.('insertHTML', false, safeHtml);
    syncEditableBlock(editable.dataset.blockId, editable);
    return;
  }
  const blocks = clipboardBlocksFromHtml(html);
  if (!blocks.length) return;
  event.preventDefault();
  event.stopPropagation();
  insertRichClipboardBlocks(editable.dataset.blockId, editable, blocks, container);
}

function insertMediaBlock(blockId, media) {
  const block = {
    id: generateId(),
    type: 'image',
    path: media.path,
    width: media.width,
    height: media.height,
    size: media.size,
    alt: '',
    caption: '',
  };
  const loc = blockId ? findBlockLocation(blockId) : null;
  if (loc) loc.blocks.splice(loc.idx + 1, 0, block);
  else edState.blocks.push(block);
  return block;
}

async function insertMemoImageFile(file, container, button = null) {
  if (!(file instanceof File) || !file.type.startsWith('image/')) return false;
  const previous = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = '...';
  }
  try {
    const uploadSession = editorSessionToken;
    const uploadMemoId = edState.id;
    const media = await uploadPlannerImage(file, 'memos');
    if (uploadSession !== editorSessionToken || uploadMemoId !== edState.id) {
      await deletePlannerImage(media.path).catch(() => {});
      return false;
    }
    pendingImageUploads.add(media.path);
    recordEditorHistory(container);
    const block = insertMediaBlock(resolveActiveEditorBlockId(container), media);
    activeEditorBlockId = block.id;
    rerenderBlocks(container);
    requestAnimationFrame(() => {
      hydratePlannerImages(container);
      container.querySelector(`[data-image-caption-id="${block.id}"]`)?.focus({ preventScroll: true });
    });
    toast('写真を追加しました。保存すると確定します', 'success');
    return true;
  } catch (error) {
    toast(error?.message || '写真を追加できませんでした', 'error');
    return false;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = previous;
    }
  }
}

function wireKnowledgeImageInputs(container) {
  const photoInput = container.querySelector('#kn-photo-input');
  const cameraInput = container.querySelector('#kn-camera-input');
  container.querySelector('#kn-photo-btn')?.addEventListener('click', () => photoInput?.click());
  container.querySelector('#kn-camera-btn')?.addEventListener('click', () => cameraInput?.click());

  const handleFile = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const button = event.target === cameraInput
      ? container.querySelector('#kn-camera-btn')
      : container.querySelector('#kn-photo-btn');
    await insertMemoImageFile(file, container, button);
  };
  photoInput?.addEventListener('change', handleFile);
  cameraInput?.addEventListener('change', handleFile);
}

function syncFocusedEditableBlock(container, blockId) {
  const el = container.querySelector(`.kn-block-focusable[data-block-id="${blockId}"]`);
  const block = findBlockInAllBlocks(edState.blocks, blockId);
  if (!el || !block || el.tagName === 'TEXTAREA') return;
  block.text = el.textContent;
  block.html = sanitizeBlockHtml(el.innerHTML);
}

function findBlockLocation(blockId, blocks = edState.blocks, parent = null) {
  const idx = blocks.findIndex(block => block.id === blockId);
  if (idx >= 0) return { blocks, idx, parent };
  for (const block of blocks) {
    if (block.children) {
      const found = findBlockLocation(blockId, block.children, block);
      if (found) return found;
    }
  }
  return null;
}

function collectBlockIds(block, ids = new Set()) {
  if (!block) return ids;
  ids.add(block.id);
  (block.children || []).forEach(child => collectBlockIds(child, ids));
  return ids;
}

function collectToggleTargets(blocks, excludedIds, currentParentId, depth = 0, result = []) {
  for (const block of blocks || []) {
    if (block.type === 'toggle' && !excludedIds.has(block.id) && block.id !== currentParentId) {
      result.push({
        id: block.id,
        label: (block.text || '').trim() || '無題のトグル',
        depth,
      });
    }
    if (block.children?.length) {
      collectToggleTargets(block.children, excludedIds, currentParentId, depth + 1, result);
    }
  }
  return result;
}

function showToggleTargetPicker(container, blockId) {
  syncFocusedEditableBlock(container, blockId);
  const picker = container.querySelector('#kn-toggle-target-picker');
  const movingBlock = findBlockInAllBlocks(edState.blocks, blockId);
  const loc = findBlockLocation(blockId);
  if (!picker || !movingBlock || !loc) return;

  const targets = collectToggleTargets(
    edState.blocks,
    collectBlockIds(movingBlock),
    loc.parent?.id || null,
  );
  if (!targets.length) {
    picker.classList.add('hidden');
    toast('移動先にできるトグルがありません', 'info');
    return;
  }

  picker.innerHTML = `
    <div class="kn-toggle-target-head">
      <span>移動先のトグル</span>
      <button type="button" class="kn-toggle-target-close" aria-label="閉じる">×</button>
    </div>
    <div class="kn-toggle-target-list">
      ${targets.map(target => `
        <button type="button" class="kn-toggle-target-option" data-toggle-target-id="${esc(target.id)}"
          style="padding-left:${10 + Math.min(target.depth, 3) * 12}px">
          <span class="kn-toggle-target-arrow">↳</span>
          <span>${esc(target.label)}</span>
        </button>
      `).join('')}
    </div>
  `;
  picker.classList.remove('hidden');
  picker.querySelector('.kn-toggle-target-close')?.addEventListener('click', () => picker.classList.add('hidden'));
  picker.querySelectorAll('[data-toggle-target-id]').forEach(option => {
    option.addEventListener('click', () => {
      if (!moveBlockIntoToggle(blockId, option.dataset.toggleTargetId)) return;
      picker.classList.add('hidden');
      activeEditorBlockId = blockId;
      rerenderBlocks(container);
      focusBlock(blockId, container, true);
      toast('ブロックをトグル内へ移動しました', 'success');
    });
  });
}

function moveBlockIntoToggle(blockId, targetToggleId) {
  const loc = findBlockLocation(blockId);
  const movingBlock = loc?.blocks[loc.idx];
  const target = findBlockInAllBlocks(edState.blocks, targetToggleId);
  if (!loc || !movingBlock || target?.type !== 'toggle') return false;
  if (collectBlockIds(movingBlock).has(targetToggleId)) return false;

  loc.blocks.splice(loc.idx, 1);
  target.children = target.children || [];
  target.children.push(movingBlock);
  target.collapsed = false;

  let ancestor = findBlockLocation(targetToggleId)?.parent || null;
  while (ancestor) {
    ancestor.collapsed = false;
    ancestor = findBlockLocation(ancestor.id)?.parent || null;
  }
  return true;
}

function moveBlockByDrop(blockId, targetId, placement) {
  if (!blockId || !targetId || blockId === targetId) return false;
  if (placement === 'inside') return moveBlockIntoToggle(blockId, targetId);

  const movingLoc = findBlockLocation(blockId);
  const movingBlock = movingLoc?.blocks[movingLoc.idx];
  if (!movingLoc || !movingBlock || collectBlockIds(movingBlock).has(targetId)) return false;

  movingLoc.blocks.splice(movingLoc.idx, 1);
  const targetLoc = findBlockLocation(targetId);
  if (!targetLoc) {
    movingLoc.blocks.splice(Math.min(movingLoc.idx, movingLoc.blocks.length), 0, movingBlock);
    return false;
  }

  const insertAt = targetLoc.idx + (placement === 'after' ? 1 : 0);
  targetLoc.blocks.splice(insertAt, 0, movingBlock);
  return true;
}

function moveBlock(blockId, action) {
  const loc = findBlockLocation(blockId);
  if (!loc) return false;
  const { blocks, idx, parent } = loc;
  const block = blocks[idx];

  if (action === 'up') {
    if (idx <= 0) return false;
    [blocks[idx - 1], blocks[idx]] = [blocks[idx], blocks[idx - 1]];
    return true;
  }

  if (action === 'down') {
    if (idx >= blocks.length - 1) return false;
    [blocks[idx + 1], blocks[idx]] = [blocks[idx], blocks[idx + 1]];
    return true;
  }

  if (action === 'indent') {
    if (idx <= 0) return false;
    const previous = blocks[idx - 1];
    if (previous.type !== 'toggle') return false;
    previous.children = previous.children || [];
    blocks.splice(idx, 1);
    previous.children.push(block);
    previous.collapsed = false;
    return true;
  }

  if (action === 'outdent') {
    if (!parent) return false;
    const parentLoc = findBlockLocation(parent.id);
    if (!parentLoc) return false;
    blocks.splice(idx, 1);
    parentLoc.blocks.splice(parentLoc.idx + 1, 0, block);
    return true;
  }

  return false;
}

function rerenderBlocks(container) {
  const wrap = container.querySelector('#kn-blocks-wrap');
  if (!wrap) return;
  wrap.innerHTML = renderBlocksEdit(edState.blocks);
  wireBlocksEdit(container);
  const activeId = activeEditorBlockId && findBlockInAllBlocks(edState.blocks, activeEditorBlockId)
    ? activeEditorBlockId
    : edState.blocks[0]?.id;
  if (!activeId) return;
  activeEditorBlockId = activeId;
  wrap.querySelector(`[data-block-id="${activeId}"]`)?.classList.add('kn-block--active');
  const activeBlock = findBlockInAllBlocks(edState.blocks, activeId);
  if (activeBlock) highlightToolbarType(container, activeBlock.type);
}

function removeBlockById(blockId, blocks = edState.blocks) {
  const idx = blocks.findIndex(block => block.id === blockId);
  if (idx >= 0) {
    blocks.splice(idx, 1);
    return true;
  }
  for (const block of blocks) {
    if (block.children && removeBlockById(blockId, block.children)) return true;
  }
  return false;
}

function removeBlockElement(blockId, container) {
  const blockEl = container.querySelector(`.kn-block[data-block-id="${blockId}"]`);
  if (!blockEl) return;
  blockEl.classList.add('kn-block--removing');
  setTimeout(() => blockEl.remove(), 120);
}

function focusBlock(id, container, atEnd = false) {
  requestAnimationFrame(() => {
    const el = container.querySelector(`.kn-block-focusable[data-block-id="${id}"]`);
    if (!el) {
      const blockEl = container.querySelector(`.kn-block[data-block-id="${id}"]`);
      activeEditorBlockId = id;
      blockEl?.focus({ preventScroll: true });
      return;
    }
    focusEditableWithoutScroll(el);
    if (atEnd && el.contentEditable === 'true') {
      const range = document.createRange();
      const sel   = window.getSelection();
      range.selectNodeContents(el);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  });
}

function focusLastBlock(container) {
  const last = edState.blocks[edState.blocks.length - 1];
  if (last) focusBlock(last.id, container);
}

// ---- AI Tag suggestion ----

async function handleAITagSuggest(container) {
  const btn = container.querySelector('#kn-ai-tag-btn');
  if (!btn) return;
  const prev = btn.innerHTML;
  btn.innerHTML = '<span class="ai-spinner"></span>';
  btn.disabled  = true;

  try {
    const titleVal = (container.querySelector('#kn-edit-title')?.value || edState.title).trim();
    const preview  = blocksToText(edState.blocks, 400);
    const suggested = await suggestKnowledgeTags(titleVal || '(無題)', preview);

    if (!suggested.length) { toast('タグ提案がありませんでした', 'info'); return; }

    // Show suggestion pills for quick approval
    showTagSuggestions(suggested, container);
  } catch (e) {
    toast('AIエラー: ' + e.message, 'error');
  } finally {
    btn.innerHTML = prev;
    btn.disabled  = !isAiAvailable();
  }
}

function showTagSuggestions(suggested, container) {
  const existing = new Set(edState.tags);
  const newOnes  = suggested.filter(t => !existing.has(t));
  if (!newOnes.length) { toast('新しいタグ提案はありませんでした', 'info'); return; }

  const wrap = container.querySelector('.kn-edit-meta');
  const existing_suggest = wrap?.querySelector('.kn-ai-suggest-row');
  existing_suggest?.remove();

  const row = document.createElement('div');
  row.className = 'kn-ai-suggest-row';
  row.innerHTML = `
    <span class="kn-ai-suggest-label">AI提案:</span>
    ${newOnes.map(t => `<button class="kn-ai-suggest-tag" data-suggest-tag="${esc(t)}">${esc(t)} ＋</button>`).join('')}
  `;
  wrap?.appendChild(row);

  row.querySelectorAll('[data-suggest-tag]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tag = btn.dataset.suggestTag;
      if (!edState.tags.includes(tag)) {
        edState.tags.push(tag);
        renderTagDisplay(container);
      }
      btn.classList.add('added');
      btn.disabled = true;
    });
  });
}

function focusEditableWithoutScroll(el) {
  if (!el) return;
  try { el.focus({ preventScroll: true }); }
  catch { el.focus(); }
}

function getKnowledgeTagRecency() {
  try {
    const tags = JSON.parse(localStorage.getItem(KNOWLEDGE_TAG_RECENCY_KEY) || '[]');
    return Array.isArray(tags) ? tags.filter(tag => typeof tag === 'string' && tag.trim()) : [];
  } catch {
    return [];
  }
}

function touchKnowledgeTag(tag) {
  const trimmed = String(tag || '').trim();
  if (!trimmed) return;
  const next = [trimmed, ...getKnowledgeTagRecency().filter(item => item !== trimmed)].slice(0, 80);
  try { localStorage.setItem(KNOWLEDGE_TAG_RECENCY_KEY, JSON.stringify(next)); } catch {}
}

function collectExistingKnowledgeTags() {
  const tags = new Set(getTags());
  const lastUsed = new Map();
  getKnowledgeMemos().forEach(memo => {
    const updatedAt = Date.parse(memo.updatedAt || memo.createdAt || '') || 0;
    (memo.tags || []).forEach(tag => {
      const trimmed = String(tag || '').trim();
      if (!trimmed) return;
      tags.add(trimmed);
      lastUsed.set(trimmed, Math.max(lastUsed.get(trimmed) || 0, updatedAt));
    });
  });
  const recency = new Map(getKnowledgeTagRecency().map((tag, index) => [tag, index]));
  return [...tags].sort((a, b) => {
    const recentA = recency.get(a);
    const recentB = recency.get(b);
    if (recentA != null || recentB != null) return (recentA ?? Infinity) - (recentB ?? Infinity);
    const timeDiff = (lastUsed.get(b) || 0) - (lastUsed.get(a) || 0);
    return timeDiff || a.localeCompare(b, 'ja');
  });
}

function addKnowledgeTagToEdit(tag, container) {
  const trimmed = String(tag || '').trim();
  if (!trimmed || edState.tags.includes(trimmed)) return;
  recordEditorHistory(container);
  touchKnowledgeTag(trimmed);
  edState.tags.push(trimmed);
  addTag(trimmed);
  renderTagDisplay(container);
}

function syncKnowledgeTagSuggestions(container) {
  const row = container.querySelector('#kn-tag-suggestions');
  const input = container.querySelector('#kn-tag-input');
  if (!row || !input) return;

  const query = input.value.trim().toLowerCase();
  const isFocused = document.activeElement === input;
  if (!query && !isFocused) {
    row.innerHTML = '';
    row.classList.add('hidden');
    return;
  }
  const selected = new Set(edState.tags);
  const candidates = collectExistingKnowledgeTags()
    .filter(tag => !selected.has(tag))
    .filter(tag => !query || tag.toLowerCase().includes(query))
    .slice(0, 8);

  if (!candidates.length) {
    row.innerHTML = '';
    row.classList.add('hidden');
    return;
  }

  row.classList.remove('hidden');
  row.innerHTML = `
    <span class="kn-tag-suggest-label">候補</span>
    ${candidates.map(tag => `<button class="kn-tag-suggest-btn" type="button" data-existing-tag="${esc(tag)}">${esc(tag)}</button>`).join('')}
  `;

  row.querySelectorAll('[data-existing-tag]').forEach(btn => {
    btn.addEventListener('click', () => {
      addKnowledgeTagToEdit(btn.dataset.existingTag, container);
      input.value = '';
      input.focus();
      syncKnowledgeTagSuggestions(container);
    });
  });
}

// ---- Paste summarize ----

async function handlePasteSummarize(text, container) {
  // Check if banner already shown
  if (container.querySelector('.kn-paste-banner')) return;

  const banner = document.createElement('div');
  banner.className = 'kn-paste-banner';
  banner.innerHTML = `
    <span>📋 長いテキストが貼り付けられました</span>
    <div class="kn-paste-actions">
      <button class="btn btn-ghost btn-sm" id="kn-paste-dismiss">スキップ</button>
      <button class="btn btn-primary btn-sm" id="kn-paste-summarize">AIで要約</button>
    </div>
  `;
  container.querySelector('.kn-edit-page')?.insertBefore(banner, container.querySelector('#kn-blocks-wrap'));

  banner.querySelector('#kn-paste-dismiss')?.addEventListener('click', () => banner.remove());
  banner.querySelector('#kn-paste-summarize')?.addEventListener('click', async () => {
    banner.innerHTML = '<span class="ai-spinner"></span> AIで要約中…';
    try {
      const result = await summarizeAndTagText(text);
      // Add summary as a quote block
      if (result.summary) {
        edState.blocks.unshift({ ...defaultBlock(), type: 'quote', text: result.summary });
      }
      // Add tags
      if (result.tags?.length) {
        result.tags.forEach(t => { if (!edState.tags.includes(t)) edState.tags.push(t); });
        renderTagDisplay(container);
        toast(`タグを${result.tags.length}件追加しました`, 'success');
      }
      rerenderBlocks(container);
      banner.remove();
      toast('AIで要約しました ✨', 'success');
    } catch (e) {
      toast('AIエラー: ' + e.message, 'error');
      banner.remove();
    }
  });
}

// ---- Tag input wiring ----

function wireTagInput(container) {
  const input = container.querySelector('#kn-tag-input');
  if (!input) return;

  const addCurrentInputTag = () => {
    const tag = input.value.trim().replace(/,$/, '');
    if (tag) addKnowledgeTagToEdit(tag, container);
    input.value = '';
    syncKnowledgeTagSuggestions(container);
  };

  input.addEventListener('focus', () => syncKnowledgeTagSuggestions(container));
  input.addEventListener('input', () => syncKnowledgeTagSuggestions(container));
  input.addEventListener('blur', () => setTimeout(() => syncKnowledgeTagSuggestions(container), 0));

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addCurrentInputTag();
    }
    if (e.key === 'Backspace' && !input.value && edState.tags.length) {
      recordEditorHistory(container);
      edState.tags.pop();
      renderTagDisplay(container);
      syncKnowledgeTagSuggestions(container);
    }
  });

  // Wire remove buttons (delegated)
  container.querySelector('#kn-tag-display')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-tag]');
    if (!btn) return;
    recordEditorHistory(container);
    edState.tags = edState.tags.filter(t => t !== btn.dataset.tag);
    renderTagDisplay(container);
    syncKnowledgeTagSuggestions(container);
  });

  syncKnowledgeTagSuggestions(container);
}

function renderTagDisplay(container) {
  const display = container.querySelector('#kn-tag-display');
  if (!display) return;
  display.innerHTML = edState.tags.map(t => `
    <span class="kn-tag-chip kn-tag-chip--edit">
      ${esc(t)}<button class="kn-tag-remove" data-tag="${esc(t)}">×</button>
    </span>`).join('');
  syncKnowledgeTagSuggestions(container);
}

// ---- Save / Delete ----

async function saveMemo(container) {
  // Sync title
  const titleInput = container.querySelector('#kn-edit-title');
  if (titleInput) edState.title = titleInput.value.trim().slice(0, 180);

  // Sync block texts from DOM
  container.querySelectorAll('.kn-block-focusable').forEach(el => {
    const blockId = el.dataset.blockId;
    if (!blockId) return;
    const block = findBlockInAllBlocks(edState.blocks, blockId);
    if (!block) return;
    if (el.tagName === 'TEXTAREA') {
      block.text = el.value;
    } else if (el.contentEditable === 'true') {
      block.text = el.textContent;
      block.html = sanitizeBlockHtml(el.innerHTML);
    }
  });

  const memoData = {
    title:   edState.title || '無題のメモ',
    blocks:  edState.blocks,
    tags:    edState.tags.length > 0 ? edState.tags : ['General'],
    url:     edState.url,
    starred: edState.starred,
    summary: blocksToText(edState.blocks, 200),
  };

  if (edState.id) {
    // Clear pendingAI if tags were added during this edit
    if (memoData.tags?.length) memoData.pendingAI = false;
    if (!memoData.pendingAI && memoData.tags?.length) {
      removeFromPendingAIQueue(edState.id, 'memo_tags');
    }
    const saved = updateKnowledgeMemo(edState.id, memoData);
    if (!saved) {
      toast('保存できませんでした。入力内容は画面に残しています', 'error');
      return;
    }
    setMemoReviewEnabled(edState.id, edState.reviewEnabled);
    toast('メモを保存しました ✓', 'success');
    markEditorBaseline();
    edState.isEdit = false;
    renderDetail(container, { preserveScroll: true });
  } else {
    const saved = addKnowledgeMemo(memoData);
    if (!saved) {
      toast('保存できませんでした。入力内容は画面に残しています', 'error');
      return;
    }
    edState.id   = saved.id;
    currentMemoId = saved.id;
    if (edState.reviewEnabled) scheduleFirstReview(saved.id);
    else setMemoReviewEnabled(saved.id, false);

    // Offline saves remain usable and can be tagged once connectivity returns.
    const isOffline = !navigator.onLine;

    if (isOffline && !memoData.tags?.length) {
      updateKnowledgeMemo(saved.id, { pendingAI: true });
      addToPendingAIQueue({ id: saved.id, type: 'memo_tags', title: memoData.title || '無題' });
      toast('メモを作成しました ✨ (オフライン中のためAIタグは後で処理されます)', 'success');
    } else {
      toast('メモを作成しました ✨', 'success');
    }
    markEditorBaseline();
    edState.isEdit = false;
    renderDetail(container, { preserveScroll: true });
  }
  pendingImageUploads.clear();
  const livePaths = collectImagePaths(edState.blocks);
  const deletions = [...pendingImageDeletes].filter(path => !livePaths.has(path));
  pendingImageDeletes.clear();
  if (deletions.length) {
    const sync = await flushPendingSync();
    if (sync.attempted === sync.succeeded) {
      await Promise.allSettled(deletions.map(deletePlannerImage));
    }
  }
}

function confirmDelete(memoId, container) {
  const overlay = document.getElementById('modal-overlay');
  if (!overlay) return;
  overlay.innerHTML = '';
  overlay.classList.remove('hidden');

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">メモを削除</span>
      <button class="modal-close"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></button>
    </div>
    <div class="modal-body"><p style="font-size:15px">このメモを Trash へ移動します。Trash から復元できます。</p></div>
    <div class="modal-footer" style="justify-content:flex-end">
      <button class="btn btn-ghost btn-sm" id="del-cancel">キャンセル</button>
      <button class="btn btn-danger btn-sm" id="del-ok">削除</button>
    </div>
  `;
  overlay.appendChild(modal);
  const close = () => { overlay.classList.add('hidden'); overlay.innerHTML = ''; };
  modal.querySelector('.modal-close').onclick = close;
  modal.querySelector('#del-cancel').onclick = close;
  modal.querySelector('#del-ok').onclick = () => {
    const deleted = deleteKnowledgeMemo(memoId);
    if (!deleted) {
      toast('削除できませんでした。メモは保持されています', 'error');
      return;
    }
    pushUndo({ type: 'delete_memo', memo: deleted });
    close();
    nav('memo');
    // Show undo toast after navigation
    setTimeout(() => {
      undoToast('メモを削除しました', () => {
        applyUndo();
        toast('メモを復元しました ✓', 'success');
      });
    }, 100);
  };
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
}

// ============================================================
// HELPERS
// ============================================================

function defaultBlock(type = 'paragraph') {
  const block = { id: generateId(), type, text: '', color: null };
  if (type === 'table') block.table = createDefaultTable();
  return block;
}

function createDefaultTable() {
  return { headers: ['項目', '内容'], rows: [['', '']] };
}

function normalizeTableData(block) {
  const source = block?.table || {};
  const headers = Array.isArray(source.headers) ? source.headers.map(value => String(value ?? '')) : [];
  const width = Math.max(2, headers.length);
  const normalizedHeaders = Array.from({ length: width }, (_, index) => headers[index] || `列${index + 1}`);
  const rows = Array.isArray(source.rows) && source.rows.length ? source.rows : [['', '']];
  return {
    headers: normalizedHeaders,
    rows: rows.map(row => Array.from({ length: width }, (_, index) => String((row || [])[index] ?? ''))),
  };
}

function changeTableShape(blockId, action, container) {
  const block = findBlockInAllBlocks(edState.blocks, blockId);
  if (!block || block.type !== 'table') return;
  recordEditorHistory(container);
  const table = normalizeTableData(block);
  if (action === 'add-row') table.rows.push(Array(table.headers.length).fill(''));
  if (action === 'remove-row' && table.rows.length > 1) table.rows.pop();
  if (action === 'add-column') {
    table.headers.push(`列${table.headers.length + 1}`);
    table.rows.forEach(row => row.push(''));
  }
  if (action === 'remove-column' && table.headers.length > 2) {
    table.headers.pop();
    table.rows.forEach(row => row.pop());
  }
  block.table = table;
  activeEditorBlockId = blockId;
  rerenderBlocks(container);
  container.querySelector(`[data-block-id="${blockId}"] .kn-table-input`)?.focus();
}

function collectImagePaths(blocks, paths = new Set()) {
  (blocks || []).forEach(block => {
    if (block?.type === 'image' && block.path) paths.add(block.path);
    if (block?.children?.length) collectImagePaths(block.children, paths);
  });
  return paths;
}

function cleanupPendingImageUploads() {
  const paths = [...pendingImageUploads];
  pendingImageUploads.clear();
  if (paths.length) Promise.allSettled(paths.map(deletePlannerImage));
}

function getBlockEditorHtml(block) {
  if (block.html) return sanitizeBlockHtml(block.html);
  return esc(block.text || '');
}

function sanitizeBlockHtml(html) {
  const template = document.createElement('template');
  template.innerHTML = String(html || '');
  const allowedTags = new Set(['BR', 'DIV', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'SPAN', 'MARK', 'CODE', 'A', 'FONT']);
  const allowedStyles = new Set(['color', 'background-color']);

  const cleanNode = (node) => {
    [...node.childNodes].forEach(child => {
      if (child.nodeType === Node.TEXT_NODE) return;
      if (child.nodeType !== Node.ELEMENT_NODE) {
        child.remove();
        return;
      }

      const tag = child.tagName;
      if (!allowedTags.has(tag)) {
        child.replaceWith(document.createTextNode(child.textContent || ''));
        return;
      }

      [...child.attributes].forEach(attr => {
        const name = attr.name.toLowerCase();
        if (tag === 'FONT' && name === 'color') {
          const value = child.getAttribute('color') || '';
          if (value && !/url|expression|javascript/i.test(value)) child.style.color = value;
          child.removeAttribute('color');
          return;
        }
        if (tag === 'A' && ['href', 'target', 'rel', 'class'].includes(name)) return;
        if (name === 'style') {
          const safe = [];
          for (const prop of allowedStyles) {
            const value = child.style.getPropertyValue(prop);
            if (value && !/url|expression|javascript/i.test(value)) safe.push(`${prop}:${value}`);
          }
          if (safe.length) child.setAttribute('style', safe.join(';'));
          else child.removeAttribute('style');
          return;
        }
        child.removeAttribute(attr.name);
      });

      if (tag === 'A') {
        const href = child.getAttribute('href') || '';
        if (!/^https?:\/\//i.test(href)) child.removeAttribute('href');
        child.setAttribute('target', '_blank');
        child.setAttribute('rel', 'noopener');
        child.classList.add('kn-inline-link');
      }

      cleanNode(child);
    });
  };

  cleanNode(template.content);
  return template.innerHTML;
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function findBlockById(blocks, id) {
  return blocks.find(b => b.id === id) || null;
}

function findBlockInAllBlocks(blocks, id) {
  for (const b of blocks) {
    if (b.id === id) return b;
    if (b.children) {
      const found = findBlockInAllBlocks(b.children, id);
      if (found) return found;
    }
  }
  return null;
}

function blocksToText(blocks, maxLen = 0) {
  let text = '';
  for (const b of (blocks || [])) {
    if (b.type === 'divider' || b.type === 'math') continue;
    if (b.type === 'table') {
      const table = normalizeTableData(b);
      text += `${table.headers.join(' ')} ${table.rows.map(row => row.join(' ')).join(' ')} `;
      continue;
    }
    text += (b.text || '') + ' ';
    if (b.children) {
      for (const c of b.children) text += (c.text || '') + ' ';
    }
  }
  text = text.trim();
  return maxLen && text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
}

function getRelatedMemos(currentId, tags) {
  if (!tags?.length) return [];
  return getKnowledgeMemos()
    .filter(m => m.id !== currentId && (m.tags || []).some(t => tags.includes(t)))
    .sort((a, b) => {
      const aMatch = (a.tags || []).filter(t => tags.includes(t)).length;
      const bMatch = (b.tags || []).filter(t => tags.includes(t)).length;
      return bMatch - aMatch; // more matching tags first
    })
    .slice(0, 6);
}

// ============================================================
// GOALS INTEGRATION — export for goals.js
// ============================================================

export async function getKnowledgeSuggestionsForGoal(goalTitle) {
  const memos    = getKnowledgeMemos();
  const allTags  = [...new Set(memos.flatMap(m => m.tags || []))];
  if (!isAiAvailable()) return null;
  try {
    return await suggestUnstudiedTopics(goalTitle, allTags);
  } catch {
    return null;
  }
}

// ============================================================
// TODAY INTEGRATION — check for ended study blocks
// ============================================================

export function getStudyPromptForBlock(scheduleItem) {
  const STUDY_KEYWORDS = ['勉強', '学習', '研究', '読書', '授業', '講義', 'study', 'learn'];
  if (!scheduleItem?.title) return false;
  return STUDY_KEYWORDS.some(kw => scheduleItem.title.includes(kw));
}
