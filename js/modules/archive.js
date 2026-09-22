// ============================================================
// archive.js - 削除済みデータのごみ箱
//
// 完全削除前に、元データの種類に応じた復元を提供する。
// 戻る操作は固定ページではなく、app.jsが記録した直前画面へ戻す。
// ============================================================

import {
  getTrashItems,
  restoreTrashItem,
  removeTrashItem,
  deleteTrashItemsByMonth,
} from '../storage.js';
import { esc, formatDate } from '../utils.js';

/** `toast`: 短い通知メッセージを画面へ表示する。 */
const toast = (msg, type) => window.AppNav?.showToast(msg, type);

const TYPE_META = {
  task:  { label: 'Task',  icon: '✓' },
  event: { label: 'Event', icon: '📅' },
  memo:  { label: 'Note',  icon: '📝' },
  learning: { label: 'Knowledge', icon: '◈' },
  goal:  { label: 'Goal',  icon: '◎' },
  schedule: { label: 'Schedule', icon: '◫' },
};

/** ごみ箱を種類・月ごとに表示し、復元と完全削除を接続する。 */
export function initArchive(container) {
  render(container);
}

/** ごみ箱の中身を月ごとにまとめ、復元・完全削除操作を描画する。 */
function render(container) {
  const items = getTrashItems();

  if (!items.length) {
    container.innerHTML = `
      <div class="archive-page">
        <div class="archive-intro">
          <p>削除したタスク・予定・メモ・目標・マイスケジュールはここに入ります。</p>
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
      const item = getTrashItems().find(entry => entry.id === btn.dataset.trashDelete);
      const title = item?.title?.slice(0, 30) || 'この項目';
      if (!window.confirm(`「${title}」を Trash から完全削除しますか？この操作は元に戻せません。`)) return;
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

/** アーカイブ済みタスクを月単位にまとめ、展開可能な一覧ブロックへ変換する。 */
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

/** 元データの種類と題名が分かる、ごみ箱の一行を組み立てる。 */
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

/** YYYY-MMの保存キーを、アーカイブ見出し用の「YYYY年M月」へ変換する。 */
function monthLabel(ym) {
  const [year, month] = String(ym || '').split('-');
  if (!year || !month) return 'Unknown';
  return `${year}年${parseInt(month, 10)}月`;
}

/** アーカイブ日時を月別履歴カードで読める短い日付表記へ変換する。 */
function formatDeletedAt(iso) {
  if (!iso) return '';
  const day = formatDate(iso.slice(0, 10), 'short');
  const time = iso.slice(11, 16);
  return `${day} ${time}`;
}
