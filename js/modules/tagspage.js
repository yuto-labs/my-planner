// ============================================================
// tagspage.js - Cross-item tag browser (tasks + memos)
// ============================================================

import { getTasks, getArchivedTasks, getKnowledgeMemos } from '../storage.js';
import { esc, formatDate } from '../utils.js';

let tagsState = { activeTag: null };

// Called externally (e.g. from task/memo card tag chip clicks) before navigating
let _pendingTag = null;
export function setTagFilter(tag) { _pendingTag = tag; }

export function initTagsPage(container) {
  if (_pendingTag !== null) {
    tagsState.activeTag = _pendingTag;
    _pendingTag = null;
  }
  render(container);
}

function render(container) {
  const tasks    = getTasks();
  const archived = getArchivedTasks();
  const memos    = getKnowledgeMemos();

  const tagUsage = {};
  const allItems = [...tasks, ...archived];
  allItems.forEach(t => (t.tags || []).forEach(tag => { tagUsage[tag] = (tagUsage[tag] || 0) + 1; }));
  memos.forEach(m => (m.tags || []).forEach(tag => { tagUsage[tag] = (tagUsage[tag] || 0) + 1; }));

  const usedTags  = Object.keys(tagUsage).sort();
  const activeTag = tagsState.activeTag;

  const taggedTasks = activeTag ? tasks.filter(t => (t.tags || []).includes(activeTag)) : [];
  const taggedMemos = activeTag ? memos.filter(m => (m.tags || []).includes(activeTag)) : [];
  const total       = taggedTasks.length + taggedMemos.length;

  container.innerHTML = `
    <div class="tags-page">
      <div class="tags-cloud-wrap">
        ${!usedTags.length
          ? `<p class="tags-empty-hint">タグはまだありません。タスクやメモにタグを追加すると、ここに表示されます。</p>`
          : usedTags.map(tag => `
              <button class="tag-cloud-btn${activeTag === tag ? ' active' : ''}" data-tag="${esc(tag)}">
                ${esc(tag)}<span class="tag-cloud-count">${tagUsage[tag]}</span>
              </button>
            `).join('')}
      </div>

      ${activeTag ? `
        <div class="tags-results">
          <div class="tags-results-header">
            「${esc(activeTag)}」 - ${total}件
          </div>

          ${taggedTasks.length ? `
            <div class="tags-section">
              <div class="tags-section-label">Tasks (${taggedTasks.length})</div>
              ${taggedTasks.map(t => `
                <div class="tags-task-item">
                  <span class="weight-dot weight-${t.weight || 'medium'}"></span>
                  <span class="tags-item-title${t.completed ? ' tags-item--done' : ''}">${esc(t.title)}</span>
                  ${t.completed ? '<span class="tags-done-mark">✓</span>' : ''}
                  ${t.dueDate ? `<span class="tags-item-date">${formatDate(t.dueDate, 'short')}</span>` : ''}
                </div>
              `).join('')}
            </div>
          ` : ''}

          ${taggedMemos.length ? `
            <div class="tags-section">
              <div class="tags-section-label">Knowledge (${taggedMemos.length})</div>
              ${taggedMemos.map(m => `
                <div class="tags-memo-item" data-memo-id="${esc(m.id)}">
                  <span class="tags-item-title">${esc(m.title || '無題のメモ')}</span>
                  <span class="tags-item-date">${formatDate(m.updatedAt || m.createdAt, 'short')}</span>
                </div>
              `).join('')}
            </div>
          ` : ''}

          ${!total ? `
            <div class="empty-state" style="padding:24px 0">
              <div class="empty-state-text">「${esc(activeTag)}」のアイテムはありません</div>
            </div>
          ` : ''}
        </div>
      ` : `
        <div class="tags-hint">タグをタップして絞り込み</div>
      `}
    </div>
  `;

  container.querySelectorAll('.tag-cloud-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tag = btn.dataset.tag;
      tagsState.activeTag = tagsState.activeTag === tag ? null : tag;
      render(container);
    });
  });

  container.querySelectorAll('[data-memo-id]').forEach(card => {
    card.addEventListener('click', () => {
      import('./knowledge.js').then(k => k.openKnowledgeMemo(card.dataset.memoId));
    });
  });
}
