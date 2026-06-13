// ============================================================
// goals.js — Goal management with AI task splitting
// ============================================================

import {
  getGoals, addGoal, updateGoal, deleteGoal,
  getTasks, addTask, getApiKey, getKnowledgeMemos,
} from '../storage.js';
import { splitGoalToTasks, predictGoalCompletionLocal } from '../ai.js';
import { openKnowledgeMemo, openNewKnowledgeMemo, getKnowledgeSuggestionsForGoal } from './knowledge.js';
import { esc, today, formatDate, generateId } from '../utils.js';

const toast = (msg, type) => window.AppNav?.showToast(msg, type);

const WEIGHT_LABEL = { large: '大', medium: '中', small: '小' };

let state = {
  tab: 'monthly',
  container: null,
};

export function initGoals(container) {
  state.container = container;
  render();
}

function render() {
  const { tab, container } = state;

  container.innerHTML = `
    <div class="goals-tabs">
      ${[
        { key: 'monthly', label: '月次目標' },
        { key: 'weekly',  label: '週次目標' },
        { key: 'daily',   label: '日次目標' },
      ].map(t =>
        `<button class="goals-tab${tab === t.key ? ' active' : ''}" data-tab="${t.key}">${t.label}</button>`
      ).join('')}
    </div>

    <div class="goal-list" id="goal-list">
      ${renderGoalList()}
    </div>

    <div style="padding:0 16px 24px">
      <button class="btn btn-primary btn-full" id="add-goal-btn">
        <svg viewBox="0 0 24 24" fill="currentColor" style="width:16px;height:16px">
          <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
        </svg>
        ${tab === 'monthly' ? '月次' : tab === 'weekly' ? '週次' : '日次'}目標を追加
      </button>
    </div>
  `;

  container.querySelectorAll('.goals-tab').forEach(btn => {
    btn.addEventListener('click', () => { state.tab = btn.dataset.tab; render(); });
  });

  container.querySelector('#add-goal-btn')?.addEventListener('click', () => openGoalModal(null));

  wireGoalActions(container);
}

function renderGoalList() {
  const { tab } = state;
  const goals = getGoals().filter(g => g.type === tab);

  if (goals.length === 0) {
    return `<div class="empty-state">
      <div class="empty-state-icon">🎯</div>
      <div class="empty-state-text">目標がまだありません</div>
      <div class="empty-state-sub">下の「追加」ボタンで目標を設定しましょう</div>
    </div>`;
  }

  return goals.map(g => renderGoalItem(g)).join('');
}

function renderGoalItem(goal) {
  const tasks = getTasks().filter(t => t.goalId === goal.id);
  const doneTasks = tasks.filter(t => t.completed);
  const displayProgress = tasks.length > 0
    ? Math.round((doneTasks.length / tasks.length) * 100)
    : (goal.progress || 0);

  const dateLabel = goal.targetDate ? `📅 ${formatDate(goal.targetDate, 'short')}` : '';
  const hasApiKey = !!getApiKey();

  // Goal completion prediction (local, no API)
  const allTasks = getTasks();
  const prediction = predictGoalCompletionLocal(goal, allTasks);
  const predictionHtml = prediction && prediction.status !== 'no_tasks' ? (() => {
    if (prediction.status === 'done') {
      return `<div class="goal-prediction goal-prediction--done">🎉 完了済み</div>`;
    }
    if (prediction.status === 'no_rate') {
      return `<div class="goal-prediction">📊 タスクを完了すると予測日が表示されます</div>`;
    }
    const color = prediction.status === 'late' ? 'var(--danger)' : 'var(--success)';
    const icon  = prediction.status === 'late' ? '⚠️' : '✅';
    const lateNote = prediction.daysLate > 0
      ? ` <span style="color:var(--danger);font-weight:700">(${prediction.daysLate}日遅れ)</span>` : '';
    return `<div class="goal-prediction" style="color:${color}">${icon} このペースだと完了予定: <strong>${esc(prediction.label)}</strong>${lateNote}</div>`;
  })() : '';

  return `
    <div class="goal-item" data-goal-id="${esc(goal.id)}">
      <div class="goal-header">
        <div class="goal-title">${esc(goal.title)}</div>
        <div class="goal-actions">
          <button class="btn-icon" data-action="edit" title="編集">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
            </svg>
          </button>
          <button class="btn-icon" data-action="delete" title="削除" style="color:var(--danger)">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
            </svg>
          </button>
        </div>
      </div>

      ${goal.description
        ? `<p style="font-size:13px;color:var(--text-muted);margin-bottom:10px">${esc(goal.description)}</p>`
        : ''}

      <div class="goal-progress-wrap">
        <div class="goal-progress-label">
          <span>${tasks.length > 0 ? `${doneTasks.length}/${tasks.length}件完了` : '進捗'}</span>
          <span style="font-weight:700">${displayProgress}%</span>
        </div>
        <div class="goal-progress-bar">
          <div class="goal-progress-fill" style="width:${displayProgress}%"></div>
        </div>
      </div>

      ${tasks.length > 0 ? `
        <div style="margin-top:10px">
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;font-weight:600">関連タスク (${tasks.length}件)</div>
          ${tasks.slice(0, 4).map(t => `
            <div style="display:flex;align-items:center;gap:8px;padding:4px 0">
              <span class="weight-dot weight-${t.weight || 'medium'}"></span>
              <span style="font-size:13px;${t.completed ? 'text-decoration:line-through;color:var(--text-muted)' : ''}">${esc(t.title)}</span>
            </div>
          `).join('')}
          ${tasks.length > 4 ? `<div style="font-size:12px;color:var(--text-muted)">他 ${tasks.length - 4} 件</div>` : ''}
        </div>
      ` : ''}

      ${dateLabel ? `<div class="goal-date" style="margin-top:8px;font-size:12px;color:var(--text-muted)">${dateLabel}</div>` : ''}
      ${predictionHtml}

      <!-- Related knowledge memos -->
      ${renderRelatedKnowledgeMemos(goal)}

      <button class="goal-ai-btn" data-action="ai-split" ${!hasApiKey ? 'disabled title="設定でAPIキーを入力してください"' : ''}>
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M21 3L3 10.53v.98l6.84 2.65L12.48 21h.98L21 3z"/>
        </svg>
        AIでタスクに分解する
      </button>
    </div>
  `;
}

function wireGoalActions(container) {
  container.querySelector('#goal-list')?.addEventListener('click', async (e) => {
    // Navigate to knowledge memo (no data-action required)
    const knCard = e.target.closest('[data-knowledge-id]');
    if (knCard) { openKnowledgeMemo(knCard.dataset.knowledgeId); return; }

    const item = e.target.closest('[data-goal-id]');
    if (!item) return;
    const goalId = item.dataset.goalId;
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.action;

    if (action === 'edit') {
      const goal = getGoals().find(g => g.id === goalId);
      if (goal) openGoalModal(goal);
    } else if (action === 'delete') {
      if (await promptDelete(goalId)) {
        deleteGoal(goalId);
        toast('目標を削除しました', 'info');
        render();
      }
    } else if (action === 'ai-split') {
      await handleAISplit(goalId, item);
    } else if (action === 'ai-knowledge') {
      await handleAIKnowledgeSuggest(goalId, item);
    }
  });
}

async function promptDelete(goalId) {
  const goal = getGoals().find(g => g.id === goalId);
  return promptConfirm(
    `「${esc(goal?.title || '')}」を削除しますか？<br><small style="color:var(--text-muted)">関連タスクは削除されません</small>`,
    { okLabel: '削除', danger: true }
  );
}

async function handleAISplit(goalId, itemEl) {
  const goal = getGoals().find(g => g.id === goalId);
  if (!goal) return;

  const btn = itemEl.querySelector('[data-action="ai-split"]');
  if (!btn) return;
  const originalHTML = btn.innerHTML;
  btn.innerHTML = '<span class="ai-spinner"></span> AI分解中…';
  btn.disabled = true;

  try {
    const result = await splitGoalToTasks(goal);
    if (!result || !result.tasks?.length) throw new Error('タスク生成に失敗しました');

    showAITaskModal(goal, result);
  } catch (e) {
    toast('AIエラー: ' + e.message, 'error');
  } finally {
    btn.innerHTML = originalHTML;
    btn.disabled = !getApiKey();
  }
}

function showAITaskModal(goal, result) {
  const body = document.createElement('div');

  let html = '';
  if (result.advice) {
    html += `<div class="card ai-card" style="margin-bottom:12px">
      <div class="ai-message">💡 ${esc(result.advice)}</div>
    </div>`;
  }
  html += `<p style="font-size:13px;color:var(--text-muted);margin-bottom:12px">${result.tasks.length}件のタスクが生成されました。追加するタスクを選択：</p>`;
  html += `<div style="display:flex;flex-direction:column;gap:8px" id="ai-task-items">`;
  result.tasks.forEach((t, i) => {
    const wLabel = WEIGHT_LABEL[t.weight] || t.weight;
    const due = t.dueDate ? formatDate(t.dueDate, 'short') : '期日未設定';
    html += `
      <label style="display:flex;align-items:flex-start;gap:10px;padding:10px;background:var(--bg-hover);border-radius:var(--radius-sm);cursor:pointer">
        <input type="checkbox" data-idx="${i}" checked style="margin-top:3px;flex-shrink:0;width:16px;height:16px">
        <div>
          <div style="font-size:14px;font-weight:600;margin-bottom:2px">${esc(t.title)}</div>
          <div style="font-size:12px;color:var(--text-muted)">
            <span class="chip" style="background:var(--bg-card);border:1px solid var(--border);color:var(--text-muted)">重要度: ${esc(wLabel)}</span>
            <span style="margin-left:6px">${esc(due)}</span>
          </div>
          ${t.description ? `<div style="font-size:12px;color:var(--text-muted);margin-top:4px">${esc(t.description)}</div>` : ''}
        </div>
      </label>
    `;
  });
  html += '</div>';
  body.innerHTML = html;

  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;width:100%';

  const cancelBtn = makeBtn('キャンセル', 'btn btn-ghost btn-sm');
  const addBtn    = makeBtn('選択したタスクを追加', 'btn btn-primary btn-sm');
  footer.append(cancelBtn, addBtn);

  const close = openModalInline({ title: 'AIタスク分解 ✨', body, footer });
  cancelBtn.onclick = close;

  addBtn.onclick = () => {
    const checked = body.querySelectorAll('[data-idx]:checked');
    let added = 0;
    checked.forEach(cb => {
      const t = result.tasks[parseInt(cb.dataset.idx)];
      if (t) { addTask({ ...t, goalId: goal.id }); added++; }
    });
    toast(`${added}件のタスクを追加しました ✨`, 'success');
    close();
    render();
  };
}

function openGoalModal(goal) {
  const isEdit = !!goal;
  let selectedType = goal?.type || state.tab;

  const body = document.createElement('div');
  body.innerHTML = `
    <div class="form-group">
      <label class="form-label">目標タイトル <span style="color:var(--danger)">*</span></label>
      <input class="input" id="goal-title" placeholder="達成したい目標" value="${esc(goal?.title || '')}" autofocus>
    </div>
    <div class="form-group">
      <label class="form-label">詳細・背景（任意）</label>
      <textarea class="textarea" id="goal-desc" placeholder="目標の背景・動機・詳細など">${esc(goal?.description || '')}</textarea>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">期日（任意）</label>
        <input class="input" id="goal-date" type="date" value="${goal?.targetDate || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">手動進捗 (%)</label>
        <input class="input" id="goal-progress" type="number" min="0" max="100" value="${goal?.progress || 0}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">タイプ</label>
      <div class="weight-select" id="type-select">
        ${[
          { key: 'monthly', label: '月次' },
          { key: 'weekly',  label: '週次' },
          { key: 'daily',   label: '日次' },
        ].map(t =>
          `<button type="button" class="weight-btn${(goal?.type || state.tab) === t.key ? ' selected' : ''}" data-type="${t.key}"
            style="${(goal?.type || state.tab) === t.key ? 'background:var(--primary-bg);border-color:var(--primary);color:var(--primary)' : ''}">${t.label}</button>`
        ).join('')}
      </div>
    </div>
  `;

  // Type toggle
  body.querySelectorAll('[data-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      body.querySelectorAll('[data-type]').forEach(b => {
        b.classList.remove('selected');
        b.style.cssText = '';
      });
      btn.classList.add('selected');
      btn.style.cssText = 'background:var(--primary-bg);border-color:var(--primary);color:var(--primary)';
      selectedType = btn.dataset.type;
    });
  });

  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;gap:8px;justify-content:space-between;width:100%';

  const leftDiv = document.createElement('div');
  if (isEdit) {
    const delBtn = makeBtn('削除', 'btn btn-danger btn-sm');
    delBtn.onclick = async () => {
      if (await promptDelete(goal.id)) {
        deleteGoal(goal.id); toast('削除しました', 'info'); close(); render();
      }
    };
    leftDiv.appendChild(delBtn);
  }

  const rightDiv = document.createElement('div');
  rightDiv.style.cssText = 'display:flex;gap:8px';
  const cancelBtn = makeBtn('キャンセル', 'btn btn-ghost btn-sm');
  const saveBtn   = makeBtn(isEdit ? '更新' : '追加', 'btn btn-primary btn-sm');
  rightDiv.append(cancelBtn, saveBtn);

  footer.append(leftDiv, rightDiv);

  const close = openModalInline({ title: isEdit ? '目標を編集' : '目標を追加', body, footer });
  cancelBtn.onclick = close;

  saveBtn.onclick = () => {
    const title = body.querySelector('#goal-title')?.value.trim();
    if (!title) { body.querySelector('#goal-title')?.focus(); return; }

    const data = {
      title,
      type: selectedType,
      targetDate: body.querySelector('#goal-date')?.value || null,
      progress: Math.max(0, Math.min(100, parseInt(body.querySelector('#goal-progress')?.value || '0'))),
      description: body.querySelector('#goal-desc')?.value.trim() || '',
    };

    if (isEdit) { updateGoal(goal.id, data); toast('目標を更新しました', 'success'); }
    else { addGoal(data); toast('目標を追加しました ✨', 'success'); }
    close();
    render();
  };
}

async function handleAIKnowledgeSuggest(goalId, itemEl) {
  const goal = getGoals().find(g => g.id === goalId);
  if (!goal) return;
  const btn = itemEl.querySelector('[data-action="ai-knowledge"]');
  if (!btn) return;
  const prev = btn.innerHTML;
  btn.innerHTML = '<span class="ai-spinner"></span> 分析中…';
  btn.disabled = true;

  try {
    const topics = await getKnowledgeSuggestionsForGoal(goal.title);
    if (!topics?.length) { toast('提案が見つかりませんでした', 'info'); return; }

    // Show topics in a modal
    const body = document.createElement('div');
    body.innerHTML = `
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px">
        「${esc(goal.title)}」の達成に向けてまだ学習できていない可能性のあるトピック：
      </p>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${topics.map(t => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--bg-hover);border-radius:var(--radius-sm)">
            <span style="font-size:14px;font-weight:600">${esc(t)}</span>
            <button class="btn btn-ghost btn-sm kn-topic-new-btn" data-topic="${esc(t)}">メモ作成 →</button>
          </div>
        `).join('')}
      </div>
    `;
    const close = openModalInline({ title: '学習トピック提案 ✨', body, footer: null });
    body.querySelectorAll('.kn-topic-new-btn').forEach(topicBtn => {
      topicBtn.addEventListener('click', () => {
        close();
        openNewKnowledgeMemo({ tags: [topicBtn.dataset.topic, goal.title] });
      });
    });
  } catch (e) {
    toast('AIエラー: ' + e.message, 'error');
  } finally {
    btn.innerHTML = prev;
    btn.disabled = !getApiKey();
  }
}

function renderRelatedKnowledgeMemos(goal) {
  const memos = getKnowledgeMemos();
  // Match memos whose tags contain words from the goal title
  const titleWords = goal.title.replace(/[^\w぀-鿿＀-￯]/g, ' ').split(/\s+/).filter(w => w.length >= 2);
  const related = memos.filter(m =>
    (m.tags || []).some(t => titleWords.some(w => t.includes(w)))
    || (m.tags || []).includes(goal.title)
  ).slice(0, 3);

  if (!related.length) return '';

  return `
    <div class="goal-knowledge-section" style="margin-top:10px">
      <div style="font-size:11px;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">📝 関連ナレッジ</div>
      ${related.map(m => `
        <div class="goal-knowledge-card" data-knowledge-id="${esc(m.id)}">
          <span style="font-size:13px;font-weight:600;flex:1">${esc(m.title || '無題')}</span>
          <div class="kn-tag-list">
            ${(m.tags || []).slice(0, 2).map(t => `<span class="kn-tag-chip kn-tag-chip--sm">${esc(t)}</span>`).join('')}
          </div>
        </div>
      `).join('')}
      <button class="goal-ai-btn" data-action="ai-knowledge" style="margin-top:6px" ${!getApiKey() ? 'disabled' : ''}>
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 3L3 10.53v.98l6.84 2.65L12.48 21h.98L21 3z"/></svg>
        学習していないトピックを提案
      </button>
    </div>
  `;
}

// ---- Shared helpers ----

function makeBtn(text, cls) {
  const btn = document.createElement('button');
  btn.className = cls;
  btn.textContent = text;
  return btn;
}

function promptConfirm(message, opts = {}) {
  return new Promise(resolve => {
    const body = document.createElement('div');
    body.innerHTML = `<p style="font-size:15px;line-height:1.6">${message}</p>`;
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;width:100%';
    const cancelBtn = makeBtn('キャンセル', 'btn btn-ghost btn-sm');
    const okBtn = makeBtn(opts.okLabel || 'OK', opts.danger ? 'btn btn-danger btn-sm' : 'btn btn-primary btn-sm');
    footer.append(cancelBtn, okBtn);
    const close = openModalInline({ title: opts.title || '確認', body, footer });
    cancelBtn.onclick = () => { close(); resolve(false); };
    okBtn.onclick = () => { close(); resolve(true); };
  });
}

function openModalInline(opts) {
  const overlay = document.getElementById('modal-overlay');
  if (!overlay) return () => {};
  overlay.innerHTML = '';
  overlay.classList.remove('hidden');

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">${opts.title || ''}</span>
      <button class="modal-close" aria-label="閉じる">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
        </svg>
      </button>
    </div>
    <div class="modal-body"></div>
    ${opts.footer !== null ? '<div class="modal-footer"></div>' : ''}
  `;

  modal.querySelector('.modal-body').appendChild(opts.body);
  if (opts.footer && modal.querySelector('.modal-footer')) {
    modal.querySelector('.modal-footer').appendChild(opts.footer);
  }

  overlay.appendChild(modal);
  const close = () => { overlay.classList.add('hidden'); overlay.innerHTML = ''; };
  modal.querySelector('.modal-close').onclick = close;
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  const keyH = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', keyH); } };
  document.addEventListener('keydown', keyH);
  return close;
}
