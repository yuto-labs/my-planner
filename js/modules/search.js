// ============================================================
// search.js — Universal cross-data search overlay
// ============================================================

import {
  getTasks, getEvents, getGoals, getKnowledgeMemos,
} from '../storage.js';
import { esc, formatDate, formatTime } from '../utils.js';

const nav = (view) => window.AppNav?.navigate(view);

// ============================================================
// Public: open / close the search overlay
// ============================================================

export function openSearch() {
  const overlay = document.getElementById('search-overlay');
  if (!overlay) return;

  overlay.innerHTML = `
    <div class="search-bar">
      <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
        <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
      </svg>
      <input
        class="input search-input"
        id="search-q"
        type="search"
        placeholder="タスク・予定・メモ・目標を検索…"
        autocomplete="off"
        autocorrect="off"
        spellcheck="false">
      <button class="search-close-btn" id="search-close">閉じる</button>
    </div>
    <div class="search-body" id="search-body">
      <div class="search-hint">
        <div class="search-hint-icon">🔍</div>
        キーワードを入力してください
      </div>
    </div>
  `;

  overlay.classList.remove('hidden');

  const input  = overlay.querySelector('#search-q');
  const body   = overlay.querySelector('#search-body');
  const close  = overlay.querySelector('#search-close');

  // Auto focus
  requestAnimationFrame(() => input?.focus());

  // Real-time search with debounce
  let timer;
  input?.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) {
      body.innerHTML = '<div class="search-hint"><div class="search-hint-icon">🔍</div>キーワードを入力してください</div>';
      return;
    }
    // Show skeleton while "searching" (gives instant feedback even though it's synchronous)
    body.innerHTML = renderSkeleton();
    timer = setTimeout(() => renderResults(q, body), 80);
  });

  // Close
  close?.addEventListener('click', closeSearch);

  // Escape key
  const keyH = (e) => {
    if (e.key === 'Escape') { closeSearch(); document.removeEventListener('keydown', keyH); }
  };
  document.addEventListener('keydown', keyH);

  // Navigate on result click
  body.addEventListener('click', (e) => {
    const item = e.target.closest('[data-result-nav]');
    if (!item) return;
    closeSearch();
    nav(item.dataset.resultNav);
  });
}

export function closeSearch() {
  const overlay = document.getElementById('search-overlay');
  overlay?.classList.add('hidden');
  if (overlay) overlay.innerHTML = '';
}

// ============================================================
// Helpers
// ============================================================

function renderSkeleton() {
  return `
    <div class="task-skeleton-list">
      ${[90, 70, 80].map(w => `
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

function renderResults(q, container) {
  const lower = q.toLowerCase();

  const tasks  = getTasks()
    .filter(t => matchText(t.title, lower));

  const events = getEvents()
    .filter(e => matchText(e.title, lower))
    .sort((a, b) => (b.start || '').localeCompare(a.start || ''));

  const memos  = getKnowledgeMemos()
    .filter(m =>
      matchText(m.title, lower) ||
      (m.tags || []).some(t => t.toLowerCase().includes(lower))
    );

  const goals  = getGoals()
    .filter(g => matchText(g.title, lower));

  const total = tasks.length + events.length + memos.length + goals.length;

  if (total === 0) {
    container.innerHTML = `
      <div class="search-empty">
        「${esc(q)}」に一致する結果はありません
      </div>
    `;
    return;
  }

  let html = '';

  if (tasks.length) {
    html += `
      <div class="search-group">
        <div class="search-group-label">✅ タスク (${tasks.length})</div>
        ${tasks.slice(0, 6).map(t => `
          <div class="search-result-item${t.completed ? ' completed' : ''}" data-result-nav="tasks">
            <span class="weight-dot weight-${esc(t.weight || 'medium')}"></span>
            <span class="search-result-title">${highlight(t.title, q)}</span>
            ${t.dueDate ? `<span class="search-result-meta">${esc(formatDate(t.dueDate, 'short'))}</span>` : ''}
            ${t.completed ? '<span class="search-result-badge done">完了</span>' : ''}
          </div>
        `).join('')}
        ${tasks.length > 6 ? `<div class="search-group-label" style="color:var(--text-dim)">他 ${tasks.length - 6} 件</div>` : ''}
      </div>
    `;
  }

  if (events.length) {
    html += `
      <div class="search-group">
        <div class="search-group-label">📅 予定 (${events.length})</div>
        ${events.slice(0, 5).map(e => `
          <div class="search-result-item" data-result-nav="calendar">
            <span class="search-result-title">${highlight(e.title, q)}</span>
            <span class="search-result-meta">${e.start ? esc(formatDate(e.start, 'short')) + ' ' + esc(formatTime(e.start)) : ''}</span>
          </div>
        `).join('')}
        ${events.length > 5 ? `<div class="search-group-label" style="color:var(--text-dim)">他 ${events.length - 5} 件</div>` : ''}
      </div>
    `;
  }

  if (memos.length) {
    html += `
      <div class="search-group">
        <div class="search-group-label">📝 メモ (${memos.length})</div>
        ${memos.slice(0, 5).map(m => `
          <div class="search-result-item" data-result-nav="knowledge">
            <span class="search-result-title">${highlight(m.title || '無題', q)}</span>
            ${(m.tags || []).length
              ? `<span class="search-result-meta">${m.tags.slice(0, 3).map(t => `#${esc(t)}`).join(' ')}</span>`
              : ''}
          </div>
        `).join('')}
        ${memos.length > 5 ? `<div class="search-group-label" style="color:var(--text-dim)">他 ${memos.length - 5} 件</div>` : ''}
      </div>
    `;
  }

  if (goals.length) {
    html += `
      <div class="search-group">
        <div class="search-group-label">🎯 目標 (${goals.length})</div>
        ${goals.slice(0, 5).map(g => `
          <div class="search-result-item" data-result-nav="goals">
            <span class="search-result-title">${highlight(g.title, q)}</span>
            <span class="search-result-meta">${g.progress ?? 0}%</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  container.innerHTML = html;
}

// ---- Text matching ----

function matchText(text, lowerQ) {
  return text?.toLowerCase().includes(lowerQ) ?? false;
}

/**
 * Highlight all occurrences of q in text (XSS-safe).
 */
function highlight(text, q) {
  if (!q) return esc(text);
  const lowerText = (text || '').toLowerCase();
  const lowerQ    = q.toLowerCase();
  let result = '';
  let i = 0;
  while (i < text.length) {
    const idx = lowerText.indexOf(lowerQ, i);
    if (idx === -1) { result += esc(text.slice(i)); break; }
    result += esc(text.slice(i, idx));
    result += `<mark class="search-highlight">${esc(text.slice(idx, idx + q.length))}</mark>`;
    i = idx + q.length;
  }
  return result;
}
