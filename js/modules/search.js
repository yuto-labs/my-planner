// ============================================================
// search.js - Universal cross-data search overlay
// ============================================================

import {
  getTasks, getEvents, getGoals, getKnowledgeMemos,
} from '../storage.js';
import { esc, formatDate, formatTime } from '../utils.js';

const nav = (view) => window.AppNav?.navigate(view);

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
        placeholder="タスク・予定・メモ・目標を検索..."
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

  const keyH = (e) => {
    if (e.key === 'Escape') {
      closeSearch();
      document.removeEventListener('keydown', keyH);
    }
  };
  document.addEventListener('keydown', keyH);

  body.addEventListener('click', (e) => {
    const item = e.target.closest('[data-result-nav]');
    if (!item) return;
    closeSearch();
    nav(item.dataset.resultNav);
  });
}

export function closeSearch() {
  const overlay = document.getElementById('search-overlay');
  if (!overlay) return;
  overlay.classList.add('hidden');
  overlay.innerHTML = '';
}

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

function renderResults(q, container) {
  const lower = q.toLowerCase();

  const tasks = getTasks().filter(t => matchText(t.title, lower));

  const events = getEvents()
    .filter(e => matchText(e.title, lower))
    .sort((a, b) => (b.start || '').localeCompare(a.start || ''));

  const memos = getKnowledgeMemos()
    .filter(m =>
      matchText(m.title, lower) ||
      (m.tags || []).some(t => t.toLowerCase().includes(lower))
    );

  const goals = getGoals().filter(g => matchText(g.title, lower));

  const total = tasks.length + events.length + memos.length + goals.length;

  if (total === 0) {
    container.innerHTML = `<div class="search-empty">「${esc(q)}」に一致する結果はありません</div>`;
    return;
  }

  let html = '';

  if (tasks.length) {
    html += `
      <div class="search-group">
        <div class="search-group-label">Tasks (${tasks.length})</div>
        ${tasks.slice(0, 6).map(t => `
          <div class="search-result-item${t.completed ? ' completed' : ''}" data-result-nav="tasks">
            <span class="weight-dot weight-${esc(t.weight || 'medium')}"></span>
            <span class="search-result-title">${highlight(t.title, q)}</span>
            ${t.dueDate ? `<span class="search-result-meta">${esc(formatDate(t.dueDate, 'short'))}</span>` : ''}
            ${t.completed ? '<span class="search-result-badge done">Done</span>' : ''}
          </div>
        `).join('')}
        ${tasks.length > 6 ? `<div class="search-group-label" style="color:var(--text-dim)">他 ${tasks.length - 6} 件</div>` : ''}
      </div>
    `;
  }

  if (events.length) {
    html += `
      <div class="search-group">
        <div class="search-group-label">Events (${events.length})</div>
        ${events.slice(0, 5).map(e => `
          <div class="search-result-item" data-result-nav="calendar">
            <span class="search-result-title">${highlight(e.title, q)}</span>
            <span class="search-result-meta">${e.start ? `${esc(formatDate(e.start, 'short'))} ${esc(formatTime(e.start))}` : ''}</span>
          </div>
        `).join('')}
        ${events.length > 5 ? `<div class="search-group-label" style="color:var(--text-dim)">他 ${events.length - 5} 件</div>` : ''}
      </div>
    `;
  }

  if (memos.length) {
    html += `
      <div class="search-group">
        <div class="search-group-label">Notes (${memos.length})</div>
        ${memos.slice(0, 5).map(m => `
          <div class="search-result-item" data-result-nav="knowledge">
            <span class="search-result-title">${highlight(m.title || 'Untitled', q)}</span>
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
        <div class="search-group-label">Goals (${goals.length})</div>
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

function matchText(text, lowerQ) {
  return text?.toLowerCase().includes(lowerQ) ?? false;
}

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
