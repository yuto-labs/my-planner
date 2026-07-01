// ============================================================
// knowledge.js — Knowledge Memo: list + block editor + viewer
// ============================================================

import {
  getKnowledgeMemos, getKnowledgeMemoById,
  addKnowledgeMemo, updateKnowledgeMemo, deleteKnowledgeMemo,
  getTermExplanation, setTermExplanation, isAiAvailable,
  scheduleFirstReview, getReviewEntry,
  rateReview, previewReviewIntervals, setReviewStage,
  MASTERY_STAGE, STAGE_INTERVALS,
  getBatchSettings, addToPendingAIQueue, removeFromPendingAIQueue,
  pushUndo, applyUndo, addReviewLog, getReviewLog,
} from '../storage.js';
import {
  suggestKnowledgeTags, explainTerm, summarizeAndTagText,
  suggestUnstudiedTopics, formatKnowledgeMemo,
} from '../ai.js';
import { esc, generateId, today, formatDate, fmtDays, daysSince } from '../utils.js';

const nav       = (view) => window.AppNav?.navigate(view);
const toast     = (msg, type) => window.AppNav?.showToast(msg, type);
const undoToast = (msg, cb)   => window.AppNav?.showUndoToast(msg, cb);

// ============================================================
// Module-level shared state (persists across navigations)
// ============================================================

let currentMemoId  = null;  // null = new memo
let pendingNewOpts = null;  // { tags:[], content:'' }

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

  if (fromDetail && main) initKnowledgeDetail(main);
  else nav('knowledge-detail');

  if (fromDetail && main) main.scrollTop = 0;
}

export function backFromKnowledgeDetail() {
  const prev = _knHistory.pop();
  if (!prev || prev.memoId === null) {
    _pendingListScrollTop = prev?.scrollTop || 0;
    _pendingListAnchorId = prev?.anchorId || null;
    _backFromDetail = true;
    window.AppNav?.navigate('knowledge', { preserveScroll: true });
  } else {
    currentMemoId = prev.memoId;
    _pendingDetailScrollTop = prev.scrollTop || 0;
    const main = document.getElementById('main-content');
    if (main?.dataset.view === 'knowledge-detail') initKnowledgeDetail(main);
    else nav('knowledge-detail');
  }
}

const knBack = backFromKnowledgeDetail;

export function openNewKnowledgeMemo(opts = {}) {
  currentMemoId  = null;
  pendingNewOpts = opts;
  nav('knowledge-detail');
}

// ============================================================
// Block constants
// ============================================================

const BLOCK_TYPES = [
  { type: 'paragraph', icon: '¶',  label: '本文'             },
  { type: 'h1',        icon: 'H1', label: '見出し1'           },
  { type: 'h2',        icon: 'H2', label: '見出し2'           },
  { type: 'h3',        icon: 'H3', label: '見出し3'           },
  { type: 'bullet',    icon: '•',  label: '箇条書き'          },
  { type: 'numbered',  icon: '1.',  label: '番号付き'         },
  { type: 'quote',     icon: '❝',  label: '引用'              },
  { type: 'toggle',    icon: '▶',  label: 'トグル'            },
  { type: 'math',      icon: 'Σ',  label: '数式(KaTeX)'       },
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

let listState = { search: '', filterTag: null, container: null };

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

  if (mainNow?.dataset.view === 'knowledge' && targetTop > 0) {
    mainNow.scrollTop = targetTop;
  }

  requestAnimationFrame(() => {
    const main = document.getElementById('main-content');
    if (!main || main.dataset.view !== 'knowledge') return;

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
  const memos  = getKnowledgeMemos();
  const allTags = [...new Set(memos.flatMap(m => m.tags || []))].sort();
  const aiAvailable = isAiAvailable();

  const filtered = memos.filter(m => {
    const q = search.toLowerCase();
    const matchSearch = !q
      || m.title.toLowerCase().includes(q)
      || (m.summary || '').toLowerCase().includes(q)
      || blocksToText(m.blocks || []).toLowerCase().includes(q)
      || (m.tags || []).some(t => t.toLowerCase().includes(q));
    const matchTag = !filterTag || (m.tags || []).includes(filterTag);
    return matchSearch && matchTag;
  });

  const starred = filtered.filter(m => m.starred);
  const regular = filtered.filter(m => !m.starred);

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
        <button class="btn btn-ghost btn-sm" id="kn-graph-btn" title="知識グラフ" style="flex-shrink:0;padding:6px 10px">
          🕸️
        </button>

        <button class="btn btn-primary btn-sm" id="kn-new-btn">
          <svg viewBox="0 0 24 24" fill="currentColor" style="width:14px;height:14px"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
          新規
        </button>
      </div>

      ${aiAvailable ? `
        <!-- AI input shortcut -->
        <button class="kn-ai-input-btn" id="kn-ai-input-btn">
          <span class="kn-ai-input-btn-main">✨ AIに整理してもらう</span>
          <span class="kn-ai-input-btn-sub">テキストを貼り付けてブロック形式に整形 · Haiku 使用</span>
        </button>
      ` : ''}

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
        ${starred.length ? `
          <div class="kn-list-section-label">⭐ ピン留め</div>
          ${starred.map(renderMemoCard).join('')}
          ${regular.length ? '<div class="kn-list-section-label kn-list-section-label--gap">すべてのメモ</div>' : ''}
        ` : filtered.length ? '<div class="kn-list-section-label">すべてのメモ</div>' : ''}
        ${regular.map(renderMemoCard).join('')}
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

  // Wire AI input sheet
  container.querySelector('#kn-ai-input-btn')?.addEventListener('click', () => openAIInputSheet());

  // Wire graph navigation
  container.querySelector('#kn-graph-btn')?.addEventListener('click', () => nav('knowledge-graph'));

  // Wire new
  container.querySelector('#kn-new-btn')?.addEventListener('click', () => showTemplatePicker());

  // Wire tag filters
  container.querySelectorAll('[data-filter-tag]').forEach(btn => {
    btn.addEventListener('click', () => {
      listState.filterTag = btn.dataset.filterTag || null;
      renderList();
    });
  });

  // Wire memo cards
  container.querySelectorAll('[data-memo-id]').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('[data-star-id]')) return;
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
  const preview = blocksToText(m.blocks || [], 90);
  const dateStr = formatDate(m.updatedAt || m.createdAt, 'short');
  const tags    = m.tags || [];

  // Spaced-repetition review badge (nextReview ベースで判定)
  const entry = getReviewEntry(m.id);
  const todayForBadge = new Date().toISOString().slice(0, 10);
  let reviewBadge = '';
  if (entry?.stage >= MASTERY_STAGE) {
    reviewBadge = '<span class="kn-review-badge kn-review-badge--done">🎓 習得済み</span>';
  } else if (!entry?.lastReview) {
    const ageMs = Date.now() - new Date(m.createdAt || 0).getTime();
    if (ageMs > 86400000) {
      reviewBadge = '<span class="kn-review-badge kn-review-badge--new">未確認</span>';
    }
  } else if (entry.nextReview <= todayForBadge) {
    const days = daysSince(entry.lastReview);
    if (days >= 14) {
      reviewBadge = `<span class="kn-review-badge kn-review-badge--urgent">要復習 (${days}日)</span>`;
    } else {
      reviewBadge = `<span class="kn-review-badge kn-review-badge--warn">復習 (${days}日)</span>`;
    }
  }

  return `
    <div class="kn-memo-card" data-memo-id="${esc(m.id)}">
      <div class="kn-memo-card-top">
        <span class="kn-memo-title">${esc(m.title || '無題のメモ')}</span>
        ${m.pendingAI ? '<span class="kn-pending-badge">🤖 AI処理待ち</span>' : ''}
        <button class="kn-star-btn${m.starred ? ' starred' : ''}" data-star-id="${esc(m.id)}" aria-label="${m.starred ? 'スター解除' : 'スター'}">
          ${m.starred
            ? '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>'
            : '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z"/></svg>'}
        </button>
      </div>
      ${reviewBadge ? `<div class="kn-review-row">${reviewBadge}</div>` : ''}
      ${preview ? `<div class="kn-memo-preview">${esc(preview)}</div>` : ''}
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

// ============================================================
// AI INPUT SHEET
// ============================================================

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
      <div class="kn-ai-loading hidden" id="kn-ai-loading">
        <span class="ai-spinner"></span>
        <span>Haiku が整理中…</span>
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

  const close = () => {
    sheet.classList.remove('kn-ai-sheet--open');
    setTimeout(() => sheet.remove(), 280);
  };

  sheet.querySelector('.kn-ai-sheet-close').onclick = close;
  sheet.addEventListener('click', e => { if (e.target === sheet) close(); });

  // ---- Format button ----
  sheet.querySelector('#kn-ai-format-btn')?.addEventListener('click', async () => {
    const rawText = sheet.querySelector('#kn-ai-textarea')?.value?.trim();
    if (!rawText) { toast('テキストを入力してください', 'error'); return; }

    const step1   = sheet.querySelector('#kn-ai-step1');
    const loading = sheet.querySelector('#kn-ai-loading');
    const step2   = sheet.querySelector('#kn-ai-step2');

    step1.classList.add('hidden');
    loading.classList.remove('hidden');

    try {
      // Compact context from existing memos (title + tags only)
      const existingCtx = getKnowledgeMemos()
        .slice(0, 12)
        .map(m => `${m.title}[${(m.tags || []).join(',')}]`)
        .join(' / ');

      const result = await formatKnowledgeMemo(rawText, existingCtx);

      // Attach block IDs and store on sheet element for cross-function access
      _aiResult = {
        ...result,
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
      loading.classList.add('hidden');
      step1.classList.remove('hidden');
      toast('AIエラー: ' + e.message, 'error');
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

    const saved = addKnowledgeMemo({
      title:   finalTitle,
      blocks:  result.blocks,
      tags:    result.tags,
      url:     '',
      starred: false,
      summary: blocksToText(result.blocks, 200),
    });
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
  isEdit:  false,
};

export function initKnowledgeDetail(container) {
  if (_detailGestureCleanup) { _detailGestureCleanup(); _detailGestureCleanup = null; }
  const main = document.getElementById('main-content');
  const restoreScrollTop = _pendingDetailScrollTop > 0 ? _pendingDetailScrollTop : 0;
  if (main) main.scrollTop = restoreScrollTop;

  // Load memo or initialize new
  if (currentMemoId) {
    const memo = getKnowledgeMemoById(currentMemoId);
    if (!memo) { nav('knowledge'); return; }
    edState = {
      id:      memo.id,
      title:   memo.title,
      blocks:  deepClone(memo.blocks || [defaultBlock()]),
      tags:    [...(memo.tags || [])],
      url:     memo.url || '',
      starred: !!memo.starred,
      isEdit:  false,
    };
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
      isEdit:  true, // new memo starts in edit mode
    };
    pendingNewOpts = null;
  }

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

function renderDetail(container) {
  const { isEdit, title, blocks, tags, url, starred, id } = edState;

  // Update header title
  const titleEl = document.getElementById('page-title');
  if (titleEl) titleEl.textContent = isEdit ? (id ? 'メモを編集' : '新規メモ') : (title || '無題のメモ');

  if (isEdit) {
    renderEditMode(container);
  } else {
    renderViewMode(container);
  }
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
        <button class="btn btn-icon" id="kn-delete-btn" style="color:var(--danger)" aria-label="削除">
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
    edState.isEdit = true;
    renderDetail(container);
  });

  container.querySelector('#kn-view-star')?.addEventListener('click', () => {
    edState.starred = !edState.starred;
    if (edState.id) updateKnowledgeMemo(edState.id, { starred: edState.starred });
    renderDetail(container);
  });

  container.querySelector('#kn-delete-btn')?.addEventListener('click', () => {
    if (!edState.id) { nav('knowledge'); return; }
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
      renderViewMode(container);
    });
  });

  container.querySelector('#kn-stage-select')?.addEventListener('change', e => {
    setReviewStage(edState.id, parseInt(e.target.value, 10));
    renderViewMode(container);
    window.AppNav?.showToast(`ステージを Lv.${e.target.value} に変更しました`, 'success');
  });

  // Wire toggle blocks
  container.querySelectorAll('.kn-block-toggle-arrow').forEach(arrow => {
    arrow.addEventListener('click', () => {
      const blockEl = arrow.closest('[data-view-block-id]');
      const blockId = blockEl?.dataset.viewBlockId;
      if (!blockId) return;
      const block = findBlockById(edState.blocks, blockId);
      if (block) {
        block.collapsed = !block.collapsed;
        renderDetail(container);
      }
    });
  });

  // Wire related memos — use openKnowledgeMemo so history is tracked
  container.querySelectorAll('[data-related-id]').forEach(card => {
    card.addEventListener('click', () => openKnowledgeMemo(card.dataset.relatedId));
  });

  // Setup term selection
  setupTermSelection(container.querySelector('#kn-view-content'), container);

  // Render KaTeX after DOM is ready
  requestAnimationFrame(() => renderAllKaTeX(container));
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
  const style = color ? `style="color:${color}"` : '';
  const indentStyle = indent > 0 ? `style="margin-left:${indent * 20}px"` : '';
  const id = `data-view-block-id="${esc(block.id || '')}"`;

  if (block.type === 'divider') {
    return `<hr class="kn-view-divider" ${id}>`;
  }

  if (block.type === 'math') {
    return `<div class="kn-view-math" ${id} data-katex="${esc(block.text || '')}">${esc(block.text || '')}</div>`;
  }

  const inlineText = renderInlineMarkdown(esc(block.text || ''));

  if (block.type === 'toggle') {
    const collapsed = !!block.collapsed;
    const children = block.children || [];
    return `
      <div class="kn-view-toggle${collapsed ? ' collapsed' : ''}" ${id}>
        <span class="kn-block-toggle-arrow">${collapsed ? '▶' : '▼'}</span>
        <span class="kn-view-toggle-text" ${style}>${inlineText || '<span style="color:var(--text-dim)">トグル</span>'}</span>
      </div>
      ${collapsed ? '' : `<div class="kn-view-toggle-children">${renderBlocksView(children, indent + 1)}</div>`}
    `;
  }

  const tagMap = {
    h1:        `<h1 class="kn-view-h1" ${id} ${style}>${inlineText}</h1>`,
    h2:        `<h2 class="kn-view-h2" ${id} ${style}>${inlineText}</h2>`,
    h3:        `<h3 class="kn-view-h3" ${id} ${style}>${inlineText}</h3>`,
    bullet:    `<div class="kn-view-bullet" ${id} ${indentStyle} ${style}><span class="kn-view-bullet-dot">•</span><span>${inlineText}</span></div>`,
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

function renderEditMode(container) {
  const { title, blocks, tags, url, id } = edState;
  const hasApi = isAiAvailable();

  container.innerHTML = `
    <div class="kn-edit-page">
      <!-- Top action bar -->
      <div class="kn-edit-topbar">
        <button class="btn btn-ghost btn-sm" id="kn-cancel-btn">${id ? 'キャンセル' : '一覧へ'}</button>
        <button class="btn btn-primary btn-sm" id="kn-save-btn">保存</button>
      </div>

      <!-- Title -->
      <input class="kn-edit-title" id="kn-edit-title"
        placeholder="タイトルを入力…" value="${esc(title)}" autocomplete="off">

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
            <button class="kn-ai-tag-btn" id="kn-ai-tag-btn" title="AIでタグ提案">
              <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><path d="M21 3L3 10.53v.98l6.84 2.65L12.48 21h.98L21 3z"/></svg>
              AI提案
            </button>
          ` : ''}
        </div>
        <input class="kn-url-input" id="kn-url-input" placeholder="参照URL (任意)" value="${esc(url)}" type="url" autocomplete="off">
      </div>

      <!-- Block toolbar -->
      <div class="kn-toolbar" id="kn-toolbar">
        <div class="kn-toolbar-types">
          ${BLOCK_TYPES.map(bt => `
            <button class="kn-toolbar-btn" data-block-type="${esc(bt.type)}" title="${esc(bt.label)}">${esc(bt.icon)}</button>
          `).join('')}
        </div>
        <button class="kn-toolbar-btn kn-toolbar-color-btn" id="kn-color-btn" title="文字色">🎨</button>
      </div>

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
        ${blocks.map((b, i) => renderBlockEdit(b, i)).join('')}
      </div>

      <!-- Add block -->
      <button class="kn-add-block-btn" id="kn-add-block-btn">
        <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
        ブロックを追加
      </button>
    </div>
  `;

  // Wire top actions
  container.querySelector('#kn-cancel-btn')?.addEventListener('click', () => {
    if (id) {
      edState.isEdit = false;
      // Reload from storage to discard changes
      const memo = getKnowledgeMemoById(id);
      if (memo) {
        edState = { ...edState, title: memo.title, blocks: deepClone(memo.blocks || [defaultBlock()]),
          tags: [...(memo.tags || [])], url: memo.url || '', starred: !!memo.starred, isEdit: false };
      }
      renderDetail(container);
    } else {
      nav('knowledge');
    }
  });

  container.querySelector('#kn-save-btn')?.addEventListener('click', () => saveMemo(container));

  // Wire title input
  container.querySelector('#kn-edit-title')?.addEventListener('input', e => {
    edState.title = e.target.value;
  });

  // Wire URL input
  container.querySelector('#kn-url-input')?.addEventListener('input', e => {
    edState.url = e.target.value;
  });

  // Wire tag input
  wireTagInput(container);

  // Wire AI tag suggestion
  container.querySelector('#kn-ai-tag-btn')?.addEventListener('click', () => handleAITagSuggest(container));

  // Wire toolbar
  wireToolbar(container);

  // Wire blocks
  wireBlocksEdit(container);

  // Wire add block button
  container.querySelector('#kn-add-block-btn')?.addEventListener('click', () => {
    edState.blocks.push(defaultBlock());
    rerenderBlocks(container);
    focusLastBlock(container);
  });

  // Paste detection for long text
  container.querySelector('.kn-edit-page')?.addEventListener('paste', e => {
    const text = e.clipboardData?.getData('text/plain') || '';
    if (text.length > 300 && isAiAvailable()) {
      setTimeout(() => handlePasteSummarize(text, container), 100);
    }
  });
}

function renderBlockEdit(block, idx) {
  const colorStyle = block.color ? `style="color:${block.color}"` : '';
  const typeClass  = `kn-block--${block.type}`;

  if (block.type === 'divider') {
    return `
      <div class="kn-block kn-block--divider" data-block-id="${esc(block.id)}">
        <hr class="kn-view-divider">
        <button class="kn-block-del" data-del-id="${esc(block.id)}" aria-label="削除">✕</button>
      </div>`;
  }

  if (block.type === 'math') {
    return `
      <div class="kn-block kn-block--math" data-block-id="${esc(block.id)}">
        <div class="kn-block-math-label">∑ KaTeX</div>
        <textarea class="kn-block-math-input kn-block-focusable" data-block-id="${esc(block.id)}"
          placeholder="数式を入力 (例: E=mc^2, \frac{a}{b})">${esc(block.text)}</textarea>
        <div class="kn-block-math-preview" data-katex-preview="${esc(block.id)}"></div>
        <button class="kn-block-del" data-del-id="${esc(block.id)}" aria-label="削除">✕</button>
      </div>`;
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
    numbered: `<span class="kn-block-prefix">${idx + 1}.</span>`,
    quote:    '<span class="kn-block-prefix kn-block-prefix--quote">❝</span>',
    toggle:   '<span class="kn-block-prefix kn-block-prefix--toggle">▶</span>',
  }[block.type] || '';

  return `
    <div class="kn-block ${typeClass}" data-block-id="${esc(block.id)}">
      ${prefix}
      <div class="kn-block-text kn-block-focusable" contenteditable="true"
        data-block-id="${esc(block.id)}"
        data-placeholder="${esc(placeholder)}"
        ${colorStyle}>${esc(block.text)}</div>
      ${block.type === 'toggle' && block.children?.length ? `
        <div class="kn-block-toggle-children-edit">
          ${(block.children || []).map((c, ci) => renderBlockEdit(c, ci)).join('')}
        </div>` : ''}
      <button class="kn-block-del" data-del-id="${esc(block.id)}" aria-label="削除">✕</button>
    </div>`;
}

function wireBlocksEdit(container) {
  const wrap = container.querySelector('#kn-blocks-wrap');
  if (!wrap) return;

  // Sync text on input
  wrap.addEventListener('input', e => {
    const el = e.target;
    const blockId = el.dataset.blockId;
    if (!blockId) return;

    if (el.tagName === 'TEXTAREA') {
      // Math block
      const block = findBlockById(edState.blocks, blockId);
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
      if (block) block.text = el.textContent;
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

  // Focus tracking for toolbar highlight
  wrap.addEventListener('focusin', e => {
    const el = e.target;
    const blockId = el.dataset.blockId;
    if (!blockId) return;
    const block = findBlockInAllBlocks(edState.blocks, blockId);
    if (block) highlightToolbarType(container, block.type);
  });

  // Delete buttons
  wrap.addEventListener('click', e => {
    const btn = e.target.closest('[data-del-id]');
    if (!btn) return;
    const delId = btn.dataset.delId;
    if (edState.blocks.length <= 1) {
      const block = findBlockInAllBlocks(edState.blocks, delId);
      const el = container.querySelector(`.kn-block-focusable[data-block-id="${delId}"]`);
      if (block) block.text = '';
      if (el) {
        if (el.tagName === 'TEXTAREA') el.value = '';
        else el.textContent = '';
        el.focus();
      }
      return;
    }
    const blockEl = btn.closest('.kn-block');
    const nextFocusId = blockEl?.previousElementSibling?.dataset?.blockId
      || blockEl?.nextElementSibling?.dataset?.blockId
      || edState.blocks.find(b => b.id !== delId)?.id;
    removeBlockById(delId);
    removeBlockElement(delId, container);
    if (nextFocusId) focusBlock(nextFocusId, container, true);
  });

  // Render KaTeX previews
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
    document.execCommand?.('insertLineBreak');
    const block = findBlockInAllBlocks(edState.blocks, blockId);
    if (block) block.text = e.target.textContent;
    return;
  }

  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    const idx = edState.blocks.findIndex(b => b.id === blockId);
    if (idx < 0) return;
    const currentBlock = edState.blocks[idx];
    const newBlock = defaultBlock();
    // If in toggle, add child
    if (currentBlock.type === 'toggle') {
      currentBlock.children = currentBlock.children || [];
      currentBlock.children.push(newBlock);
      rerenderBlocks(container);
      focusBlock(newBlock.id, container);
      return;
    }
    edState.blocks.splice(idx + 1, 0, newBlock);
    rerenderBlocks(container);
    focusBlock(newBlock.id, container);
  }

  if (e.key === 'Backspace') {
    const el = e.target;
    if (el.textContent === '' && edState.blocks.length > 1) {
      e.preventDefault();
      const idx = edState.blocks.findIndex(b => b.id === blockId);
      if (idx < 0) return;
      removeBlockById(blockId);
      removeBlockElement(blockId, container);
      const prevBlock = edState.blocks[Math.max(0, idx - 1)];
      if (prevBlock) focusBlock(prevBlock.id, container, true);
    }
  }
}

function wireToolbar(container) {
  // Block type buttons
  container.querySelectorAll('[data-block-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.blockType;
      const focusedBlockId = getFocusedBlockId(container);
      if (focusedBlockId) {
        changeBlockType(focusedBlockId, type, container);
      } else {
        // Add new block of that type
        edState.blocks.push({ ...defaultBlock(), type });
        rerenderBlocks(container);
        focusLastBlock(container);
      }
    });
  });

  // Color picker toggle
  container.querySelector('#kn-color-btn')?.addEventListener('click', () => {
    const picker = container.querySelector('#kn-color-picker');
    picker?.classList.toggle('hidden');
  });

  // Color swatches
  container.querySelectorAll('[data-color-id]').forEach(swatch => {
    swatch.addEventListener('click', () => {
      const colorId = swatch.dataset.colorId;
      const color = BLOCK_COLORS.find(c => c.id === colorId);
      const focusedBlockId = getFocusedBlockId(container);
      if (focusedBlockId && color) {
        const block = findBlockInAllBlocks(edState.blocks, focusedBlockId);
        if (block) {
          block.color = color.css || null;
          rerenderBlocks(container);
          focusBlock(focusedBlockId, container, true);
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

function highlightToolbarType(container, type) {
  container.querySelectorAll('[data-block-type]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.blockType === type);
  });
}

function changeBlockType(blockId, type, container) {
  const block = findBlockInAllBlocks(edState.blocks, blockId);
  if (!block) return;
  block.type = type;
  if (type === 'toggle') block.children = block.children || [];
  if (type !== 'toggle') delete block.children;
  rerenderBlocks(container);
  focusBlock(blockId, container, true);
}

function rerenderBlocks(container) {
  const wrap = container.querySelector('#kn-blocks-wrap');
  if (!wrap) return;
  wrap.innerHTML = edState.blocks.map((b, i) => renderBlockEdit(b, i)).join('');
  wireBlocksEdit(container);
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
    if (!el) return;
    el.focus();
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

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const tag = input.value.trim().replace(/,$/, '');
      if (tag && !edState.tags.includes(tag)) {
        edState.tags.push(tag);
        renderTagDisplay(container);
      }
      input.value = '';
    }
    if (e.key === 'Backspace' && !input.value && edState.tags.length) {
      edState.tags.pop();
      renderTagDisplay(container);
    }
  });

  // Wire remove buttons (delegated)
  container.querySelector('#kn-tag-display')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-tag]');
    if (!btn) return;
    edState.tags = edState.tags.filter(t => t !== btn.dataset.tag);
    renderTagDisplay(container);
  });
}

function renderTagDisplay(container) {
  const display = container.querySelector('#kn-tag-display');
  if (!display) return;
  display.innerHTML = edState.tags.map(t => `
    <span class="kn-tag-chip kn-tag-chip--edit">
      ${esc(t)}<button class="kn-tag-remove" data-tag="${esc(t)}">×</button>
    </span>`).join('');
}

// ---- Save / Delete ----

function saveMemo(container) {
  // Sync title
  const titleInput = container.querySelector('#kn-edit-title');
  if (titleInput) edState.title = titleInput.value.trim();

  // Sync URL
  const urlInput = container.querySelector('#kn-url-input');
  if (urlInput) edState.url = urlInput.value.trim();

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
    updateKnowledgeMemo(edState.id, memoData);
    toast('メモを保存しました ✓', 'success');
    edState.isEdit = false;
    renderDetail(container);
  } else {
    const saved = addKnowledgeMemo(memoData);
    edState.id   = saved.id;
    currentMemoId = saved.id;
    scheduleFirstReview(saved.id);

    // Queue AI tagging if offline or batch mode
    const isOffline = !navigator.onLine;
    const batchCfg  = getBatchSettings();
    const useBatch  = batchCfg.aiMode === 'batch';

    if ((isOffline || useBatch) && !memoData.tags?.length) {
      updateKnowledgeMemo(saved.id, { pendingAI: true });
      addToPendingAIQueue({ id: saved.id, type: 'memo_tags', title: memoData.title || '無題' });
      const reason = isOffline ? 'オフライン中' : 'バッチモード';
      toast(`メモを作成しました ✨ (${reason}のためAIタグは後で処理されます)`, 'success');
    } else {
      toast('メモを作成しました ✨', 'success');
    }
    edState.isEdit = false;
    renderDetail(container);
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
    <div class="modal-body"><p style="font-size:15px">このメモを削除しますか？この操作は元に戻せません。</p></div>
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
    const memo = getKnowledgeMemoById(memoId);
    if (memo) pushUndo({ type: 'delete_memo', memo });
    deleteKnowledgeMemo(memoId);
    close();
    nav('knowledge');
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

function defaultBlock() {
  return { id: generateId(), type: 'paragraph', text: '', color: null };
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
