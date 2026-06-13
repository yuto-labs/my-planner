// ============================================================
// archive.js — Completed task archive (auto-archived from previous days)
// ============================================================

import { getArchivedTasks, deleteArchivedByMonth } from '../storage.js';
import { esc, formatDate } from '../utils.js';

const toast = (msg, type) => window.AppNav?.showToast(msg, type);

export function initArchive(container) {
  render(container);
}

function render(container) {
  const archived = getArchivedTasks();

  if (!archived.length) {
    container.innerHTML = `
      <div class="archive-page">
        <div class="archive-intro">
          <p>完了したタスクは翌日0時に自動でここへ移動されます。</p>
        </div>
        <div class="empty-state" style="padding-top:48px">
          <div class="empty-state-icon">📦</div>
          <div class="empty-state-text">アーカイブは空です</div>
          <div class="empty-state-sub">タスクを完了すると翌日に記録されます</div>
        </div>
      </div>
    `;
    return;
  }

  // Group by archivedAt month (YYYY-MM), newest month first
  const byMonth = {};
  archived.forEach(t => {
    const key = (t.archivedAt || t.completedAt || '').slice(0, 7) || 'unknown';
    if (!byMonth[key]) byMonth[key] = [];
    byMonth[key].push(t);
  });

  const sortedMonths = Object.keys(byMonth).sort().reverse();

  container.innerHTML = `
    <div class="archive-page">
      <div class="archive-intro">
        <p>完了したタスクの記録です。合計 <strong>${archived.length}</strong> 件</p>
      </div>
      ${sortedMonths.map(ym => {
        const tasks = byMonth[ym].sort((a, b) =>
          (b.archivedAt || '').localeCompare(a.archivedAt || '')
        );
        const [year, month] = ym.split('-');
        const label = year && month ? `${year}年${parseInt(month)}月` : 'その他';
        return `
          <div class="archive-month" data-ym="${esc(ym)}">
            <div class="archive-month-header">
              <div class="archive-month-meta">
                <span class="archive-month-label">${label}</span>
                <span class="archive-month-count">${tasks.length}件</span>
              </div>
              <button class="btn btn-ghost btn-sm archive-delete-btn" data-delete-ym="${esc(ym)}">
                🗑 削除
              </button>
            </div>
            <ul class="archive-task-list">
              ${tasks.map(t => {
                const subs = t.subtasks || [];
                const subDone = subs.filter(s => s.completed).length;
                const tags = t.tags || [];
                const doneDate = t.completedAt
                  ? formatDate(t.completedAt.slice(0,10), 'short')
                  : '';
                return `
                  <li class="archive-task-item">
                    <span class="archive-task-check">✓</span>
                    <div class="archive-task-body">
                      <span class="archive-task-title">${esc(t.title)}</span>
                      ${subs.length > 0
                        ? `<span class="archive-task-sub">${subDone}/${subs.length} サブタスク</span>`
                        : ''}
                      ${tags.length > 0
                        ? `<div class="archive-task-tags">
                             ${tags.map(tag => `<span class="task-tag-chip task-tag-chip--sm">${esc(tag)}</span>`).join('')}
                           </div>`
                        : ''}
                      ${t.memo
                        ? `<div class="archive-task-memo">${esc(t.memo.slice(0, 80))}${t.memo.length > 80 ? '…' : ''}</div>`
                        : ''}
                    </div>
                    <span class="archive-task-date">${doneDate}</span>
                  </li>
                `;
              }).join('')}
            </ul>
          </div>
        `;
      }).join('')}
    </div>
  `;

  // Wire delete buttons — use native confirm for simplicity
  container.querySelectorAll('[data-delete-ym]').forEach(btn => {
    btn.addEventListener('click', () => {
      const ym     = btn.dataset.deleteYm;
      const count  = byMonth[ym]?.length || 0;
      const [year, month] = ym.split('-');
      const label  = year && month ? `${year}年${parseInt(month)}月` : ym;
      if (!window.confirm(`${label}のアーカイブ ${count}件 を削除しますか？\nこの操作は取り消せません。`)) return;
      deleteArchivedByMonth(ym);
      toast(`${count}件を削除しました`, 'success');
      render(container); // re-render in place
    });
  });
}
