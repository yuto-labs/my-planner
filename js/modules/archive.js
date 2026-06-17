// ============================================================
// archive.js - Trash page for deleted items
// ============================================================

import {
  getTrashItems,
  restoreTrashItem,
  removeTrashItem,
  deleteTrashItemsByMonth,
} from '../storage.js';
import { esc, formatDate } from '../utils.js';

const toast = (msg, type) => window.AppNav?.showToast(msg, type);

const TYPE_META = {
  task:  { label: 'Task',  icon: '✓' },
  event: { label: 'Event', icon: '📅' },
  memo:  { label: 'Note',  icon: '📝' },
};

export function initArchive(container) {
  render(container);
}

function render(container) {
  const items = getTrashItems();

  if (!items.length) {
    container.innerHTML = `
      <div class="archive-page">
        <div class="archive-intro">
          <p>削除したタスク・予定・メモはここに入ります。</p>
        </div>
        <div class="empty-state" style="padding-top:48px">
          <div class="empty-state-icon">🗑</div>
          <div class="empty-state-text">Trash は空です</div>
          <div class="empty-state-sub">削除した項目はここから復元できます</div>
        </div>
      </div>
    `;
    return;
  }

  const byMonth = {};
  items.forEach(item => {
    const key = (item.deletedAt || '').slice(0, 7) || 'unknown';
    if (!byMonth[key]) byMonth[key] = [];
    byMonth[key].push(item);
  });

  const sortedMonths = Object.keys(byMonth).sort().reverse();

  container.innerHTML = `
    <div class="archive-page">
      <div class="archive-intro">
        <p>削除済みの項目一覧です。合計 <strong>${items.length}</strong> 件</p>
      </div>
      ${sortedMonths.map(ym => renderMonthBlock(ym, byMonth[ym])).join('')}
    </div>
  `;

  container.querySelectorAll('[data-trash-restore]').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = restoreTrashItem(btn.dataset.trashRestore);
      if (!item) return;
      toast(`「${item.title?.slice(0, 20) || '項目'}」を復元しました`, 'success');
      render(container);
    });
  });

  container.querySelectorAll('[data-trash-delete]').forEach(btn => {
    btn.addEventListener('click', () => {
      removeTrashItem(btn.dataset.trashDelete);
      toast('Trash から削除しました', 'success');
      render(container);
    });
  });

  container.querySelectorAll('[data-trash-delete-month]').forEach(btn => {
    btn.addEventListener('click', () => {
      const ym = btn.dataset.trashDeleteMonth;
      const count = byMonth[ym]?.length || 0;
      const label = monthLabel(ym);
      if (!window.confirm(`${label} の ${count} 件を Trash から完全削除しますか？`)) return;
      deleteTrashItemsByMonth(ym);
      toast(`${count} 件を削除しました`, 'success');
      render(container);
    });
  });
}

function renderMonthBlock(ym, items) {
  const sorted = [...items].sort((a, b) => (b.deletedAt || '').localeCompare(a.deletedAt || ''));
  return `
    <div class="archive-month" data-ym="${esc(ym)}">
      <div class="archive-month-header">
        <div class="archive-month-meta">
          <span class="archive-month-label">${monthLabel(ym)}</span>
          <span class="archive-month-count">${sorted.length}件</span>
        </div>
        <button class="btn btn-ghost btn-sm archive-delete-btn" data-trash-delete-month="${esc(ym)}">
          まとめて削除
        </button>
      </div>
      <ul class="archive-task-list">
        ${sorted.map(renderTrashItem).join('')}
      </ul>
    </div>
  `;
}

function renderTrashItem(item) {
  const meta = TYPE_META[item.entityType] || { label: item.entityType || 'Item', icon: '•' };
  const payload = item.payload || {};
  const note = payload.memo || payload.summary || '';
  const tags = payload.tags || [];
  const subInfo = item.entityType === 'task' && Array.isArray(payload.subtasks) && payload.subtasks.length
    ? `${payload.subtasks.filter(s => s.completed).length}/${payload.subtasks.length} サブタスク`
    : '';

  return `
    <li class="archive-task-item">
      <span class="archive-task-check">${meta.icon}</span>
      <div class="archive-task-body">
        <div class="archive-trash-head">
          <span class="archive-task-title">${esc(item.title || 'Untitled')}</span>
          <span class="trash-type-badge trash-type-${esc(item.entityType || 'item')}">${esc(meta.label)}</span>
        </div>
        ${subInfo ? `<span class="archive-task-sub">${esc(subInfo)}</span>` : ''}
        ${tags.length ? `<div class="archive-task-tags">${tags.map(tag => `<span class="task-tag-chip task-tag-chip--sm">${esc(tag)}</span>`).join('')}</div>` : ''}
        ${note ? `<div class="archive-task-memo">${esc(String(note).slice(0, 80))}${String(note).length > 80 ? '…' : ''}</div>` : ''}
        <div class="archive-actions">
          <button class="btn btn-ghost btn-sm archive-action-btn" data-trash-restore="${esc(item.id)}">復元</button>
          <button class="btn btn-ghost btn-sm archive-action-btn archive-action-btn--danger" data-trash-delete="${esc(item.id)}">完全削除</button>
        </div>
      </div>
      <span class="archive-task-date">${formatDeletedAt(item.deletedAt)}</span>
    </li>
  `;
}

function monthLabel(ym) {
  const [year, month] = String(ym || '').split('-');
  if (!year || !month) return 'Unknown';
  return `${year}年${parseInt(month, 10)}月`;
}

function formatDeletedAt(iso) {
  if (!iso) return '';
  const day = formatDate(iso.slice(0, 10), 'short');
  const time = iso.slice(11, 16);
  return `${day} ${time}`;
}
