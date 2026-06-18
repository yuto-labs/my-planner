// ============================================================
// tasks.js — Task management module
// ============================================================

import {
  getTasks, addTask, updateTask, deleteTask,
  pushUndo, applyUndo, deleteCompletedTasks, reorderTask,
  addKnowledgeMemo, updateKnowledgeMemo, isAiAvailable,
  getTags, addTag,
  getEvents, getScheduleItems, addScheduleItem, deleteScheduleItem,
} from '../storage.js';
import { esc, today, tomorrow, formatDate, generateId, addDays, toDateStr, getEventsForDate } from '../utils.js';
import { splitGoalToTasks } from '../ai.js';
import { openDatePicker, openTimePicker, openDurationPicker, formatPickerDate, formatDuration } from '../datepicker.js';

const toast     = (msg, type) => window.AppNav?.showToast(msg, type);
const undoToast = (msg, cb)   => window.AppNav?.showUndoToast(msg, cb);
const nav       = (view)      => window.AppNav?.navigate(view);

let openPlannerHandler = null;

let state = {
  filter:      'all',    // 'all' | 'pending' | 'done' | 'large' | 'medium' | 'small'
  container:   null,
  addFormOpen: false,
  addTitle:    '',
  addWeight:   'medium',
  addCustomTagOpen: false,
  addDueDate:  null,     // YYYY-MM-DD
  addDueTime:  null,     // HH:MM
  addEstimate: null,     // minutes
  addRecurrence: '',
  addTags:     [],       // string[]
  addTaskType: 'normal', // 'normal' | 'goal'
  codexStartDate: null,
  codexEndDate:   null,
  codexStartTime:  '11:00',
  codexEndTime:    '23:00',
  codexBufferPct:   0,
  codexBreakStart:  '',
  codexBreakEnd:    '',
  codexPanelOpen:  false,
};

const PRESET_TAGS = ['就活', '授業', '研究', '娯楽'];

// ---- Public ----

export function initTasks(container) {
  state.container = container;
  if (openPlannerHandler) window.removeEventListener('tasks:open-planner', openPlannerHandler);
  openPlannerHandler = () => {
    state.codexPanelOpen = true;
    render();
    requestAnimationFrame(() => {
      state.container?.querySelector('#codex-plan-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };
  window.addEventListener('tasks:open-planner', openPlannerHandler);

  // Brief skeleton flash for smooth navigation feel
  container.innerHTML = `
    <div class="task-skeleton-list" style="padding:12px 16px">
      ${[75, 55, 85, 60].map(w => `
        <div class="task-skeleton-item">
          <div class="skeleton task-skeleton-check"></div>
          <div class="task-skeleton-body">
            <div class="skeleton skeleton-line" style="width:${w}%"></div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
  requestAnimationFrame(() => { if (container.isConnected) render(); });
  return () => {
    if (openPlannerHandler) {
      window.removeEventListener('tasks:open-planner', openPlannerHandler);
      openPlannerHandler = null;
    }
  };
}

// ---- Render ----

function render() {
  const { container } = state;

  container.innerHTML = `
    <!-- Add form -->
    <div class="tasks-add">
      <input class="input" id="task-input" placeholder="タスク名" type="text" value="${esc(state.addTitle)}">
      <button class="btn btn-primary" id="task-add-btn" style="flex-shrink:0">保存</button>
    </div>

    <!-- Add form extras (type + weight + due date + due time) -->
    <div class="tasks-add-extras">
      <span class="tasks-add-label">Type:</span>
      <div class="type-select" id="type-select">
        <button class="type-btn${state.addTaskType === 'normal' ? ' selected' : ''}" data-t="normal">Task</button>
        <button class="type-btn${state.addTaskType === 'goal' ? ' selected' : ''}" data-t="goal">🎯 Goal</button>
      </div>
      <span class="tasks-add-label">Priority:</span>
      <div class="weight-select" id="weight-select">
        <button class="weight-btn${state.addWeight === 'large' ? ' selected' : ''}" data-w="large">大</button>
        <button class="weight-btn${state.addWeight === 'medium' ? ' selected' : ''}" data-w="medium">中</button>
        <button class="weight-btn${state.addWeight === 'small' ? ' selected' : ''}" data-w="small">小</button>
      </div>
      <button class="dp-trigger tasks-due-input" id="task-due-date-btn" title="期日を選択">
        ${state.addDueDate ? formatPickerDate(state.addDueDate) : '📅 日付'}
      </button>
      <button class="dp-trigger tasks-due-input" id="task-due-time-btn" title="時刻を選択">
        ${state.addDueTime ? '🕐 ' + state.addDueTime : '🕐 時刻'}
      </button>
      <button class="dp-trigger tasks-due-input" id="task-estimate-btn" title="工数を選択">
        ${state.addEstimate ? `⏱ ${formatDuration(state.addEstimate)}` : '⏱ 工数'}
      </button>
      <select class="input tasks-due-input" id="task-recurrence" title="繰り返し">
        <option value=""${state.addRecurrence === '' ? ' selected' : ''}>なし</option>
        <option value="daily"${state.addRecurrence === 'daily' ? ' selected' : ''}>毎日</option>
        <option value="weekdays"${state.addRecurrence === 'weekdays' ? ' selected' : ''}>平日</option>
        <option value="weekly"${state.addRecurrence === 'weekly' ? ' selected' : ''}>毎週</option>
        <option value="monthly"${state.addRecurrence === 'monthly' ? ' selected' : ''}>毎月</option>
      </select>
    </div>

    <!-- Tags row -->
    <div class="tasks-add-tags-row" id="tasks-add-tags-row">
      <span class="tasks-add-label">Tags:</span>
      <div class="tasks-add-tag-toolbar">
        <div class="tasks-preset-tags" id="tasks-preset-tags"></div>
        <button class="btn btn-ghost btn-sm tasks-tag-add-btn" id="tasks-tag-add-btn" type="button">+ Tag</button>
      </div>
      <div class="add-tag-chips-wrap" id="add-tag-chips"></div>
      <div class="tasks-tag-input-wrap${state.addCustomTagOpen ? ' open' : ''}" id="tasks-tag-input-wrap">
        <input class="input tasks-tag-input" id="tasks-add-tag-input" placeholder="タグを追加 (Enter)" list="add-tag-dl">
      </div>
      <datalist id="add-tag-dl">
        ${getTags().map(t => `<option value="${esc(t)}">`).join('')}
      </datalist>
    </div>

    <!-- Completion bar -->
    <div class="tasks-progress-wrap" id="tasks-progress-wrap"></div>

    <!-- Filters -->
    <div class="tasks-filters">${renderFiltersHTML()}</div>

    ${state.codexPanelOpen ? renderCodexPlannerPanel() : ''}

    <!-- Task list -->
    <ul class="task-list" id="task-list"></ul>

    <!-- Archive link -->
    <div class="tasks-archive-link">
      <button class="btn btn-ghost btn-sm" id="goto-archive-btn">🗑 Trash を見る</button>
    </div>
  `;

  const addForm = container.querySelector('.tasks-add');
  const addExtras = container.querySelector('.tasks-add-extras');
  const addTagsRow = container.querySelector('.tasks-add-tags-row');
  if (addForm && addExtras && addTagsRow) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.id = 'task-add-toggle';
    toggle.className = `tasks-add-toggle${state.addFormOpen ? ' open' : ''}`;
    toggle.setAttribute('aria-expanded', state.addFormOpen ? 'true' : 'false');
    toggle.innerHTML = `
      <span>＋ タスクを作成</span>
      <span class="tasks-add-toggle-arrow">${state.addFormOpen ? '-' : '+'}</span>
    `;
    addForm.parentNode.insertBefore(toggle, addForm);

    const applyAddFormVisibility = () => {
      addForm.style.display = state.addFormOpen ? '' : 'none';
      addExtras.style.display = state.addFormOpen ? '' : 'none';
      addTagsRow.style.display = state.addFormOpen ? '' : 'none';
      toggle.classList.toggle('open', state.addFormOpen);
      toggle.setAttribute('aria-expanded', state.addFormOpen ? 'true' : 'false');
      const arrow = toggle.querySelector('.tasks-add-toggle-arrow');
      if (arrow) arrow.textContent = state.addFormOpen ? '-' : '+';
    };
    applyAddFormVisibility();
    toggle.addEventListener('click', () => {
      state.addFormOpen = !state.addFormOpen;
      applyAddFormVisibility();
      if (state.addFormOpen) container.querySelector('#task-input')?.focus();
    });
  }

  // --- Wire static controls ---

  // Type select
  const typeWrap = container.querySelector('#type-select');
  typeWrap?.querySelectorAll('.type-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      typeWrap.querySelectorAll('.type-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.addTaskType = btn.dataset.t;
    })
  );

  // Weight select
  const weightWrap = container.querySelector('#weight-select');
  weightWrap?.querySelectorAll('.weight-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      weightWrap.querySelectorAll('.weight-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.addWeight = btn.dataset.w || 'medium';
    })
  );

  // Due date/time picker buttons
  const _dueDateBtn = container.querySelector('#task-due-date-btn');
  const _dueTimeBtn = container.querySelector('#task-due-time-btn');
  const _estimateBtn = container.querySelector('#task-estimate-btn');

  const _updateDueDateBtn = () => {
    if (!_dueDateBtn) return;
    _dueDateBtn.textContent = state.addDueDate ? formatPickerDate(state.addDueDate) : '📅 日付';
    _dueDateBtn.classList.toggle('dp-trigger--set', !!state.addDueDate);
  };
  const _updateDueTimeBtn = () => {
    if (!_dueTimeBtn) return;
    _dueTimeBtn.textContent = state.addDueTime ? '🕐 ' + state.addDueTime : '🕐 時刻';
    _dueTimeBtn.classList.toggle('dp-trigger--set', !!state.addDueTime);
  };

  _dueDateBtn?.addEventListener('click', () => {
    openDatePicker({
      value: state.addDueDate,
      onConfirm: d => { state.addDueDate = d; _updateDueDateBtn(); },
      onClear:   () => { state.addDueDate = null; _updateDueDateBtn(); },
    });
  });
  _dueTimeBtn?.addEventListener('click', () => {
    openTimePicker({
      value: state.addDueTime,
      onConfirm: t => { state.addDueTime = t; _updateDueTimeBtn(); },
      onClear:   () => { state.addDueTime = null; _updateDueTimeBtn(); },
    });
  });

  const _updateEstimateBtn = () => {
    if (!_estimateBtn) return;
    _estimateBtn.textContent = state.addEstimate ? `⏱ ${formatDuration(state.addEstimate)}` : '⏱ 工数';
    _estimateBtn.classList.toggle('dp-trigger--set', !!state.addEstimate);
  };
  _estimateBtn?.addEventListener('click', () => {
    openDurationPicker({
      value: state.addEstimate,
      onConfirm: minutes => { state.addEstimate = minutes; _updateEstimateBtn(); },
      onClear: () => { state.addEstimate = null; _updateEstimateBtn(); },
    });
  });

  // Add button / Enter
  container.querySelector('#task-add-btn')
    ?.addEventListener('click', () => handleAdd());
  container.querySelector('#task-input')
    ?.addEventListener('input', e => { state.addTitle = e.target.value; });
  container.querySelector('#task-input')
    ?.addEventListener('keydown', e => { if (e.key === 'Enter') handleAdd(); });
  container.querySelector('#task-recurrence')
    ?.addEventListener('change', e => { state.addRecurrence = e.target.value || ''; });

  wireFilters(container);

  // Tag input for new task
  const _tagInput    = container.querySelector('#tasks-add-tag-input');
  const _tagChipsEl  = container.querySelector('#add-tag-chips');
  const _presetTags = container.querySelector('#tasks-preset-tags');
  const _tagInputWrap = container.querySelector('#tasks-tag-input-wrap');
  const _tagAddBtn = container.querySelector('#tasks-tag-add-btn');
  _presetTags.innerHTML = PRESET_TAGS.map(tag =>
    `<button class="task-tag-preset${state.addTags.includes(tag) ? ' active' : ''}" type="button" data-preset-tag="${esc(tag)}">${esc(tag)}</button>`
  ).join('');

  const _renderAddTagChips = () => {
    if (!_tagChipsEl) return;
    _tagChipsEl.innerHTML = state.addTags.map(t =>
      `<span class="task-tag-chip">${esc(t)}<button class="tag-chip-x" data-rm="${esc(t)}">✕</button></span>`
    ).join('');
    _tagChipsEl.querySelectorAll('[data-rm]').forEach(btn => {
      btn.onclick = () => { state.addTags = state.addTags.filter(x => x !== btn.dataset.rm); _renderAddTagChips(); };
    });
    _presetTags.querySelectorAll('[data-preset-tag]').forEach(btn => {
      btn.classList.toggle('active', state.addTags.includes(btn.dataset.presetTag));
    });
  };
  _renderAddTagChips();

  const _applyCustomTagInputVisibility = () => {
    if (!_tagInputWrap) return;
    _tagInputWrap.classList.toggle('open', state.addCustomTagOpen);
    if (_tagAddBtn) _tagAddBtn.textContent = state.addCustomTagOpen ? '閉じる' : '+ Tag';
  };
  _applyCustomTagInputVisibility();

  _tagAddBtn?.addEventListener('click', () => {
    state.addCustomTagOpen = !state.addCustomTagOpen;
    _applyCustomTagInputVisibility();
    if (state.addCustomTagOpen) _tagInput?.focus();
  });

  _presetTags.querySelectorAll('[data-preset-tag]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tag = btn.dataset.presetTag;
      if (!tag) return;
      state.addTags = state.addTags.includes(tag)
        ? state.addTags.filter(x => x !== tag)
        : [...state.addTags, tag];
      addTag(tag);
      _renderAddTagChips();
    });
  });

  _tagInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = _tagInput.value.trim().replace(/,/g, '');
      if (val && !state.addTags.includes(val)) {
        state.addTags.push(val);
        addTag(val);
        state.addCustomTagOpen = false;
        _renderAddTagChips();
        _applyCustomTagInputVisibility();
      }
      _tagInput.value = '';
    }
  });

  // Archive link
  container.querySelector('#goto-archive-btn')?.addEventListener('click', () => nav('archive'));

  if (state.codexPanelOpen) wireCodexPlannerPanel(container);

  // Initial list render
  const listEl = container.querySelector('#task-list');
  renderListInto(listEl);
  wireTaskActions();
  wireDragDrop(listEl);
  renderProgressBar();
}

// ---- Progress bar ----

function renderProgressBar() {
  const wrap = state.container?.querySelector('#tasks-progress-wrap');
  if (!wrap) return;
  const all   = getTasks();
  const done  = all.filter(t => t.completed).length;
  const total = all.length;
  if (total === 0) { wrap.innerHTML = ''; return; }
  const pct = Math.round((done / total) * 100);

  // Subtask stats
  let subTotal = 0, subDone = 0;
  all.forEach(t => {
    const subs = t.subtasks || [];
    subTotal  += subs.length;
    subDone   += subs.filter(s => s.completed).length;
  });
  const subStr = subTotal > 0 ? ` · サブタスク ${subDone}/${subTotal}` : '';

  wrap.innerHTML = `
    <div class="tasks-progress">
      <div class="tasks-progress-bar" style="width:${pct}%"></div>
      <span class="tasks-progress-label">${done} / ${total} 完了 (${pct}%)${subStr}</span>
    </div>
  `;
}

function getTaskCounts() {
  const tasks = getTasks();
  return {
    pending: tasks.filter(t => !t.completed && !t.abandoned).length,
    done: tasks.filter(t => t.completed).length,
    abandoned: tasks.filter(t => t.abandoned).length,
  };
}

function renderFiltersHTML() {
  const counts = getTaskCounts();
  return [
    { key: 'all', label: 'すべて', badge: null },
    { key: 'pending', label: '未完了', badge: counts.pending },
    { key: 'done', label: '完了', badge: counts.done },
    { key: 'abandoned', label: '諦めた', badge: counts.abandoned },
    { key: 'large', label: '大', badge: null },
    { key: 'medium', label: '中', badge: null },
    { key: 'small', label: '小', badge: null },
  ].map(f =>
    `<button class="filter-btn${state.filter === f.key ? ' active' : ''}" data-filter="${f.key}">
      ${f.label}${f.badge !== null ? `<span class="filter-badge">${f.badge}</span>` : ''}
    </button>`
  ).join('') + (counts.done > 0
    ? `<button class="filter-btn tasks-clear-done" id="tasks-clear-done" title="完了済みを一括削除">🗑 クリア</button>`
    : '');
}

function wireFilters(container) {
  container.querySelectorAll('.filter-btn[data-filter]').forEach(btn =>
    btn.addEventListener('click', () => {
      state.filter = btn.dataset.filter;
      container.querySelectorAll('.filter-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.filter === state.filter)
      );
      rerenderList();
    })
  );

  container.querySelector('#tasks-clear-done')?.addEventListener('click', () => {
    const completed = getTasks().filter(t => t.completed);
    if (!completed.length) return;
    deleteCompletedTasks();
    refreshTaskUi(true);
    toast(`${completed.length}件の完了タスクを削除しました`, 'success');
  });
}

function updateFilterBar() {
  const filters = state.container?.querySelector('.tasks-filters');
  if (!filters) return;
  filters.innerHTML = renderFiltersHTML();
  wireFilters(state.container);
}

function refreshTaskUi(shouldRerenderList = false) {
  renderProgressBar();
  updateFilterBar();
  if (shouldRerenderList) rerenderList();
}

// ---- Codex reschedule bridge ----

function renderCodexPlannerPanel() {
  const defaultStart = state.codexStartDate || today();
  const defaultEnd = state.codexEndDate || toDateStrLocal(addDays(new Date(), 3));
  if (!state.codexStartDate) state.codexStartDate = defaultStart;
  if (!state.codexEndDate) state.codexEndDate = defaultEnd;
  return `
    <section class="codex-plan-card">
      <div class="codex-plan-head">
        <div>
          <div class="codex-plan-kicker">外部AIスケジュール</div>
          <h3 class="codex-plan-title">タスクを作業時間に再配分</h3>
        </div>
        <button class="btn btn-ghost btn-sm" id="codex-close-btn" type="button">閉じる</button>
      </div>
      <p class="codex-plan-desc">
        指定期間の未完了タスクと予定だけをコピーします。AIには、見直しや余白を入れず、実作業だけを詰めてマイスケジュール案を作らせます。
      </p>
      <div class="codex-plan-controls">
        <button class="dp-trigger" id="codex-start-date-btn">開始日 ${formatPickerDate(defaultStart)}</button>
        <button class="dp-trigger" id="codex-end-date-btn">終了日 ${formatPickerDate(defaultEnd)}</button>
        <button class="dp-trigger" id="codex-start-time-btn">開始時刻 ${state.codexStartTime}</button>
        <button class="dp-trigger" id="codex-end-time-btn">終了時刻 ${state.codexEndTime}</button>
        <select class="input codex-plan-select" id="codex-buffer-pct" title="余裕">
          <option value="0" ${state.codexBufferPct === 0 ? 'selected' : ''}>余裕なし</option>
          <option value="10" ${state.codexBufferPct === 10 ? 'selected' : ''}>余裕 10%</option>
          <option value="20" ${state.codexBufferPct === 20 ? 'selected' : ''}>余裕 20%</option>
          <option value="30" ${state.codexBufferPct === 30 ? 'selected' : ''}>余裕 30%</option>
        </select>
        <button class="dp-trigger" id="codex-break-start-btn">休憩開始 ${state.codexBreakStart || 'なし'}</button>
        <button class="dp-trigger" id="codex-break-end-btn">休憩終了 ${state.codexBreakEnd || 'なし'}</button>
      </div>
      <div class="codex-plan-actions">
        <button class="btn btn-primary" id="codex-copy-btn">AI用にコピー</button>
        <button class="btn btn-ghost" id="codex-apply-btn">AI案を反映</button>
      </div>
      <textarea class="codex-plan-textarea" id="codex-export-text" readonly placeholder="コピーしたデータがここに出ます"></textarea>
      <textarea class="codex-plan-textarea" id="codex-import-text" placeholder="Claude / GPT / Codex が返した JSON を貼り付け"></textarea>
      <p class="codex-plan-note">反映先はマイスケジュールです。タスク本体の締切やメモは変更しません。</p>
    </section>
  `;
}

function wireCodexPlannerPanel(container) {
  const startDateBtn = container.querySelector('#codex-start-date-btn');
  const endDateBtn   = container.querySelector('#codex-end-date-btn');
  const startTimeBtn = container.querySelector('#codex-start-time-btn');
  const endTimeBtn   = container.querySelector('#codex-end-time-btn');
  const breakStartBtn = container.querySelector('#codex-break-start-btn');
  const breakEndBtn   = container.querySelector('#codex-break-end-btn');

  startDateBtn?.addEventListener('click', () => {
    openDatePicker({
      value: state.codexStartDate,
      onConfirm: d => {
        state.codexStartDate = d;
        if (state.codexEndDate && state.codexEndDate < d) state.codexEndDate = d;
        startDateBtn.textContent = `開始日 ${formatPickerDate(state.codexStartDate)}`;
        if (endDateBtn) endDateBtn.textContent = `終了日 ${formatPickerDate(state.codexEndDate)}`;
      },
    });
  });
  endDateBtn?.addEventListener('click', () => {
    openDatePicker({
      value: state.codexEndDate,
      onConfirm: d => {
        state.codexEndDate = d;
        if (state.codexStartDate && state.codexStartDate > d) state.codexStartDate = d;
        if (startDateBtn) startDateBtn.textContent = `開始日 ${formatPickerDate(state.codexStartDate)}`;
        endDateBtn.textContent = `終了日 ${formatPickerDate(state.codexEndDate)}`;
      },
    });
  });
  startTimeBtn?.addEventListener('click', () => openCodexTimePicker('codexStartTime', startTimeBtn, '開始時刻'));
  endTimeBtn?.addEventListener('click', () => openCodexTimePicker('codexEndTime', endTimeBtn, '終了時刻'));
  breakStartBtn?.addEventListener('click', () => openCodexTimePicker('codexBreakStart', breakStartBtn, '休憩開始', true));
  breakEndBtn?.addEventListener('click', () => openCodexTimePicker('codexBreakEnd', breakEndBtn, '休憩終了', true));
  container.querySelector('#codex-buffer-pct')?.addEventListener('change', e => {
    state.codexBufferPct = Number(e.target.value) || 0;
  });

  container.querySelector('#codex-copy-btn')?.addEventListener('click', () => copyCodexPayload(container));
  container.querySelector('#codex-apply-btn')?.addEventListener('click', () => applyCodexPlan(container));
  container.querySelector('#codex-close-btn')?.addEventListener('click', () => {
    state.codexPanelOpen = false;
    render();
  });
}

function openCodexTimePicker(key, btn, label, allowClear = false) {
  openTimePicker({
    value: state[key],
    onConfirm: t => {
      state[key] = t;
      if (btn) btn.textContent = `${label} ${t}`;
    },
    onClear: allowClear ? () => {
      state[key] = '';
      if (btn) btn.textContent = `${label} なし`;
    } : undefined,
  });
}

async function copyCodexPayload(container) {
  const periodStart = state.codexStartDate || today();
  const periodEnd = state.codexEndDate || periodStart;
  const relevantTasks = getTasks()
    .filter(t => !t.completed && isNormalTask(t) && taskInPlanningPeriod(t, periodStart, periodEnd))
    .map(t => ({
      id: t.id,
      title: t.title,
      weight: t.weight || 'medium',
      dueDate: t.dueDate || null,
      dueTime: t.dueTime || null,
      estimatedMinutes: Number(t.estimatedMinutes) || estimateMinutesByWeight(t.weight),
      subtasks: (t.subtasks || []).map(s => ({ title: s.title, completed: !!s.completed })),
      tags: t.tags || [],
    }));

  const breaks = getCodexDailyBreaks();
  const todayStart = periodStart === today() ? nextHalfHour() : null;

  const tasksWithEffective = relevantTasks.map(t => ({
    ...t,
    effectiveMinutes: applyBufferAndRound(t.estimatedMinutes, state.codexBufferPct),
  }));

  const tasksAdjusted = adjustTasksForOverflow(
    tasksWithEffective, periodStart, periodEnd,
    state.codexStartTime, state.codexEndTime, breaks, todayStart
  );

  const totalAvailableMinutes = _availForPeriod(
    periodStart, periodEnd, state.codexStartTime, state.codexEndTime, breaks, todayStart
  );

  const payload = {
    kind: 'my-planner-ai-reschedule-request',
    version: 7,
    instruction: [
      'You are a scheduling assistant. Follow these rules exactly — no exceptions, no creative interpretation.',
      '',
      'RULE 1 — DURATION: Each task has a pre-computed effectiveMinutes (buffer already included, rounded to 10 min, and scaled for overflow if totalAvailableMinutes was exceeded). Use this number EXACTLY as the total work duration. Do NOT recompute, adjust, or round it.',
      'RULE 2 — TODAY START: Today is ' + periodStart + '. The current time is approximately ' + (todayStart || state.codexStartTime) + '. ' + (todayStart ? 'Do NOT schedule any block on ' + periodStart + ' that starts before ' + todayStart + '. Time slots before ' + todayStart + ' on today do not exist.' : ''),
      'RULE 3 — DEADLINES: A task with dueDate must have ALL its blocks on dates ≤ dueDate. Never schedule any portion of a task after its deadline. effectiveMinutes for deadline-constrained tasks has already been reduced if needed to guarantee they fit before their deadline.',
      'RULE 4 — GREEDY SLOT FILLING: Enumerate free slots in strict chronological order. A free slot is a continuous window inside activeHours not blocked by a calendarEvent or dailyBreak. Fill each slot back-to-back. Never leave a slot unused while tasks remain.',
      'RULE 5 — SPLIT ONLY AT BOUNDARIES: A task may only be interrupted at the end of a free slot (event start, break start, or activeHours end). Never split in the middle of an open free slot. The remainder of an interrupted task MUST be the first item in the very next free slot — before any new task.',
      'RULE 6 — PORTIONS: Each portion must be a multiple of 5 minutes. All portions for a task must sum exactly to effectiveMinutes.',
      'RULE 7 — NO OVERLAPS: Blocks must not overlap calendarEvents, existingMySchedule, or dailyBreaks.',
      'RULE 8 — ACTIVE HOURS: All blocks must fall within activeHours (' + state.codexStartTime + '–' + state.codexEndTime + ').',
      'RULE 9 — TASK WORK ONLY: No review, prep, buffer, admin, or placeholder blocks.',
      'RULE 10 — OUTPUT FORMAT: Return valid JSON only — no prose, no markdown. Schema: {"scheduleItems":[{"taskId":"...","title":"...","date":"YYYY-MM-DD","startTime":"HH:MM","endTime":"HH:MM","note":"..."}]}',
    ].join('\n'),
    activeHours: { start: state.codexStartTime, end: state.codexEndTime },
    planningPeriod: { startDate: periodStart, endDate: periodEnd },
    ...(todayStart ? { todayEarliestStart: todayStart } : {}),
    totalAvailableMinutes,
    dailyBreaks: breaks,
    tasks: tasksAdjusted,
    calendarEvents: getEventsInPlanningPeriod(periodStart, periodEnd),
    existingMySchedule: getScheduleItemsInPlanningPeriod(periodStart, periodEnd),
  };

  const text = JSON.stringify(payload, null, 2);
  const out = container.querySelector('#codex-export-text');
  if (out) out.value = text;
  try {
    await navigator.clipboard.writeText(text);
    toast(`${relevantTasks.length}件のタスクをAI用にコピーしました`, 'success');
  } catch {
    out?.focus();
    out?.select();
    toast('コピー欄を選択しました。手動でコピーしてください', 'info');
  }
}

function applyCodexPlan(container) {
  const input = container.querySelector('#codex-import-text');
  const raw = input?.value?.trim();
  if (!raw) {
    toast('Codex案のJSONを貼り付けてください', 'error');
    return;
  }

  let plan;
  try {
    plan = JSON.parse(raw);
  } catch {
    toast('JSONとして読めませんでした', 'error');
    return;
  }

  const blocks = normalizeCodexScheduleItems(plan);
  if (!blocks.length) {
    toast('scheduleItems が見つかりませんでした', 'error');
    return;
  }

  const normalTasksById = new Map(getTasks().filter(isNormalTask).map(t => [t.id, t]));
  const nonNormalRefs = blocks.filter(b => b.taskId && !normalTasksById.has(b.taskId));
  if (nonNormalRefs.length) {
    toast(`通常タスク以外、または存在しないタスクが ${nonNormalRefs.length} 件あります。反映を止めました`, 'error');
    return;
  }

  const outsideWindow = blocks.filter(blockOutsidePlanningWindow);
  if (outsideWindow.length) {
    toast(`活動時間外、または対象期限を超える案が ${outsideWindow.length} 件あります。反映を止めました`, 'error');
    return;
  }

  const breakOverlaps = blocks.filter(blockOverlapsBreak);
  if (breakOverlaps.length) {
    toast(`休憩時間と重なる案が ${breakOverlaps.length} 件あります。反映を止めました`, 'error');
    return;
  }

  const overlaps = blocks.filter(blockOverlapsCalendar);
  if (overlaps.length) {
    toast(`カレンダー予定と重なる案が ${overlaps.length} 件あります。反映を止めました`, 'error');
    return;
  }

  const scheduleOverlaps = blocks.filter(blockOverlapsExistingSchedule);
  if (scheduleOverlaps.length) {
    toast(`既存マイスケジュールと重なる案が ${scheduleOverlaps.length} 件あります。反映を止めました`, 'error');
    return;
  }

  if (!confirm(`${blocks.length}件の作業ブロックをマイスケジュールに反映します。既存のCodex計画は置き換えます。`)) return;

  getScheduleItems()
    .filter(i => i.source === 'codex-plan')
    .forEach(i => deleteScheduleItem(i.id));

  blocks.forEach(b => {
    const task = b.taskId ? normalTasksById.get(b.taskId) : null;
    addScheduleItem({
      title: b.title || task?.title || 'Codex plan',
      date: b.date,
      startTime: b.startTime,
      endTime: b.endTime,
      taskId: b.taskId || null,
      source: 'codex-plan',
      note: b.note || '',
    });
  });

  input.value = '';
  rerenderList();
  renderProgressBar();
  toast(`${blocks.length}件をマイスケジュールに反映しました`, 'success');
}

function normalizeCodexScheduleItems(plan) {
  const source = plan.scheduleItems || plan.mySchedule || plan.blocks || plan.plan || [];
  if (!Array.isArray(source)) return [];
  return source
    .map(b => ({
      taskId: b.taskId || b.task_id || null,
      title: b.title || b.taskTitle || b.name || '',
      date: b.date || '',
      startTime: b.startTime || b.start || '',
      endTime: b.endTime || b.end || '',
      note: b.note || b.reason || '',
    }))
    .filter(b => /^\d{4}-\d{2}-\d{2}$/.test(b.date) && /^\d{2}:\d{2}$/.test(b.startTime) && /^\d{2}:\d{2}$/.test(b.endTime));
}

function isNormalTask(task) {
  return !task.taskType || task.taskType === 'normal';
}

function taskInPlanningPeriod(task, startDate, endDate) {
  if (!task.dueDate) return true;
  return task.dueDate >= startDate && task.dueDate <= endDate;
}

function dateInPlanningPeriod(dateStr) {
  const startDate = state.codexStartDate || today();
  const endDate = state.codexEndDate || startDate;
  return dateStr >= startDate && dateStr <= endDate;
}

function blockOutsidePlanningWindow(block) {
  const startMin = timeToMinutes(block.startTime);
  const endMin = timeToMinutes(block.endTime);
  const activeStart = timeToMinutes(state.codexStartTime);
  const activeEnd = timeToMinutes(state.codexEndTime);
  if (startMin == null || endMin == null || activeStart == null || activeEnd == null) return true;
  if (endMin <= startMin) return true;
  if (startMin < activeStart || endMin > activeEnd) return true;
  return !dateInPlanningPeriod(block.date);
}

function blockOverlapsBreak(block) {
  const breaks = getCodexDailyBreaks();
  if (!breaks.length) return false;
  return breaks.some(b => timeRangesOverlap(block.startTime, block.endTime, b.start, b.end));
}

function blockOverlapsExistingSchedule(block) {
  return getScheduleItems().some(item => {
    if (item.source === 'codex-plan') return false;
    if (item.date && item.date !== block.date) return false;
    return timeRangesOverlap(block.startTime, block.endTime, item.startTime, item.endTime);
  });
}

function blockOverlapsCalendar(block) {
  const startMin = timeToMinutes(block.startTime);
  const endMin = timeToMinutes(block.endTime);
  if (endMin <= startMin) return true;

  return getEventsForDate(getEvents(), block.date).some(e => {
    if (e._isAllDay) return true;
    const startSrc = e._displayStart || e.start;
    const endSrc = e._displayEnd || e.end;
    const s = new Date(startSrc);
    let evStart = s.getHours() * 60 + s.getMinutes();
    let evEnd = evStart + 60;
    if (endSrc?.includes?.('T24:00')) evEnd = 1440;
    else if (endSrc) {
      const ed = new Date(endSrc);
      evEnd = ed.getHours() * 60 + ed.getMinutes();
    }
    return startMin < evEnd && endMin > evStart;
  });
}

function timeRangesOverlap(aStart, aEnd, bStart, bEnd) {
  const as = timeToMinutes(aStart);
  const ae = timeToMinutes(aEnd);
  const bs = timeToMinutes(bStart);
  const be = timeToMinutes(bEnd);
  if ([as, ae, bs, be].some(v => v == null)) return true;
  return as < be && ae > bs;
}

function timeToMinutes(t) {
  if (!/^\d{2}:\d{2}$/.test(t || '')) return null;
  const [h, m] = t.split(':').map(Number);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

function getCodexDailyBreaks() {
  if (!state.codexBreakStart || !state.codexBreakEnd) return [];
  const start = timeToMinutes(state.codexBreakStart);
  const end = timeToMinutes(state.codexBreakEnd);
  if (start == null || end == null || end <= start) return [];
  return [{ start: state.codexBreakStart, end: state.codexBreakEnd, label: '休憩' }];
}

function estimateMinutesByWeight(weight) {
  if (weight === 'large') return 180;
  if (weight === 'small') return 45;
  return 90;
}

function applyBufferAndRound(minutes, bufferPct) {
  const raw = Math.max(1, Number(minutes) || 90) * (1 + (Number(bufferPct) || 0) / 100);
  return Math.round(raw / 10) * 10;
}

// ---- Overflow scaling helpers ----

function _timeStrToMin(t) {
  if (!t || !/^\d{2}:\d{2}$/.test(t)) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function _breakDeduction(breaks, slotStart, slotEnd) {
  return (breaks || []).reduce((sum, b) => {
    if (!b.start || !b.end) return sum;
    const bs = Math.max(_timeStrToMin(b.start), slotStart);
    const be = Math.min(_timeStrToMin(b.end), slotEnd);
    return sum + Math.max(0, be - bs);
  }, 0);
}

function _dayAvailMin(dateStr, activeStart, activeEnd, breaks, todayFirstSlot) {
  const startMin = dateStr === today() && todayFirstSlot
    ? Math.max(_timeStrToMin(todayFirstSlot), _timeStrToMin(activeStart))
    : _timeStrToMin(activeStart);
  const endMin = _timeStrToMin(activeEnd);
  if (endMin <= startMin) return 0;
  return Math.max(0, endMin - startMin - _breakDeduction(breaks, startMin, endMin));
}

function _availForPeriod(fromDate, toDate, activeStart, activeEnd, breaks, todayFirstSlot) {
  let total = 0;
  let d = new Date(fromDate + 'T00:00:00');
  const end = new Date(toDate + 'T00:00:00');
  while (d <= end) {
    total += _dayAvailMin(toDateStr(d), activeStart, activeEnd, breaks, todayFirstSlot);
    d = addDays(d, 1);
  }
  return total;
}

function adjustTasksForOverflow(tasks, periodStart, periodEnd, activeStart, activeEnd, breaks, todayFirstSlot) {
  // Step 1: global scale if total needed > total available
  const totalAvail = _availForPeriod(periodStart, periodEnd, activeStart, activeEnd, breaks, todayFirstSlot);
  const totalNeeded = tasks.reduce((s, t) => s + t.effectiveMinutes, 0);
  let scaled = tasks;

  if (totalNeeded > totalAvail && totalAvail > 0) {
    const factor = totalAvail / totalNeeded;
    scaled = tasks.map(t => ({
      ...t,
      effectiveMinutes: Math.max(10, Math.round(t.effectiveMinutes * factor / 10) * 10),
    }));
  }

  // Step 2: per-deadline group — if tasks due by D still overflow available time up to D, scale that group down further
  const groups = {};
  scaled.forEach(t => {
    const key = t.dueDate && t.dueDate <= periodEnd ? t.dueDate : '_later';
    (groups[key] = groups[key] || []).push(t);
  });

  const deadlines = Object.keys(groups).filter(k => k !== '_later').sort();
  for (const dl of deadlines) {
    const grp = groups[dl];
    const avail = _availForPeriod(periodStart, dl, activeStart, activeEnd, breaks, todayFirstSlot);
    const needed = grp.reduce((s, t) => s + t.effectiveMinutes, 0);
    if (needed > avail && avail > 0) {
      const f = avail / needed;
      groups[dl] = grp.map(t => ({
        ...t,
        effectiveMinutes: Math.max(10, Math.round(t.effectiveMinutes * f / 10) * 10),
      }));
    }
  }

  // Reassemble preserving order
  const updated = new Map([...Object.values(groups).flat()].map(t => [t.id, t]));
  return scaled.map(t => updated.get(t.id) || t);
}

function nextHalfHour() {
  const now = new Date();
  const totalMin = now.getHours() * 60 + now.getMinutes();
  const rounded = Math.ceil(totalMin / 30) * 30;
  const h = Math.floor(rounded / 60) % 24;
  const m = rounded % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatEstimate(minutes) {
  return formatDuration(minutes);
}

function getEventsInPlanningPeriod(startDate, endDate) {
  const all = getEvents();
  const byId = new Map();
  forEachDateInRange(startDate, endDate, dateStr => {
    getEventsForDate(all, dateStr).forEach(e => {
      if (!byId.has(e.id)) {
        byId.set(e.id, {
          id: e.id,
          title: e.title,
          start: e.start,
          end: e.end,
          categoryId: e.categoryId || null,
        });
      }
    });
  });
  return [...byId.values()];
}

function getScheduleItemsInPlanningPeriod(startDate, endDate) {
  return getScheduleItems()
    .filter(s => !s.date || (s.date >= startDate && s.date <= endDate))
    .map(s => ({
      id: s.id,
      title: s.title,
      date: s.date,
      startTime: s.startTime,
      endTime: s.endTime,
      taskId: s.taskId || null,
      source: s.source || null,
    }));
}

function forEachDateInRange(startDate, endDate, fn) {
  let d = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  while (!isNaN(d.getTime()) && !isNaN(end.getTime()) && d <= end) {
    fn(toDateStrLocal(d));
    d = addDays(d, 1);
  }
}

function toDateStrLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---- List rendering ----

function getSortedFilteredTasks() {
  const { filter } = state;
  let tasks = getTasks();

  // Sort: incomplete first → weight → dueDate → createdAt desc
  const wo = { large: 0, medium: 1, small: 2 };
  tasks.sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    if (wo[a.weight] !== wo[b.weight]) return wo[a.weight] - wo[b.weight];
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  if (filter === 'abandoned') return tasks.filter(t => t.abandoned);
  // 諦めたタスクは abandoned フィルター以外では非表示
  const active = tasks.filter(t => !t.abandoned);
  if (filter === 'pending') return active.filter(t => !t.completed);
  if (filter === 'done')    return active.filter(t =>  t.completed);
  if (['large', 'medium', 'small'].includes(filter))
    return active.filter(t => t.weight === filter);
  return active;
}

function renderTaskItem(task) {
  const tdStr   = today();
  const overdue = task.dueDate && task.dueDate < tdStr && !task.completed;

  // Due label
  let dueLabel = '';
  if (task.dueDate) {
    const timeStr = task.dueTime ? ` ${task.dueTime}` : '';
    dueLabel = `<span class="task-due${overdue ? ' task-due--overdue' : ''}">${formatDate(task.dueDate, 'short')}${timeStr}</span>`;
  }

  const recurIcon = task.recurrence
    ? `<span class="task-recur-icon" title="${esc(recurrenceLabel(task.recurrence))}">🔁</span>` : '';

  const estimateChip = task.estimatedMinutes
    ? `<span class="task-estimate-chip" title="工数">${formatEstimate(task.estimatedMinutes)}</span>`
    : '';

  // Subtask progress chip
  const subs    = task.subtasks || [];
  const subDone = subs.filter(s => s.completed).length;
  const subChip = subs.length > 0
    ? `<span class="task-sub-chip${subDone === subs.length ? ' done' : ''}" title="サブタスク">${subDone}/${subs.length}</span>`
    : '';

  // Memo indicator
  const memoIcon = task.memo ? `<span class="task-memo-dot" title="メモあり">📝</span>` : '';

  // Tag chips (up to 2)
  const tagChips = (task.tags || []).slice(0, 2)
    .map(t => `<span class="task-tag-chip task-tag-chip--sm">${esc(t)}</span>`)
    .join('');
  const metaInline = [subChip, estimateChip, memoIcon, recurIcon, dueLabel, tagChips]
    .filter(Boolean)
    .join('');

  const isGoal = task.taskType === 'goal';

  return `
    <li class="task-item${task.completed ? ' completed' : ''}${task.abandoned ? ' abandoned' : ''}${isGoal ? ' task-item--goal' : ''}" data-task-id="${esc(task.id)}" draggable="true">
      <button class="task-check${task.completed ? ' done' : ''}" data-action="toggle"
        ${task.abandoned ? 'disabled aria-label="諦めたタスクは完了に変更できません" title="諦めたタスクは完了に変更できません"' : 'aria-label="完了切り替え"'}>
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
        </svg>
      </button>
      <span class="weight-dot weight-${task.weight || 'medium'}"></span>
      ${isGoal ? '<span class="task-goal-icon">🎯</span>' : ''}
      <div class="task-main">
        <span class="task-title" data-action="edit-title">${esc(task.title)}</span>
        ${metaInline ? `<div class="task-inline-meta">${metaInline}</div>` : ''}
      </div>
      <div class="task-meta">
        ${isGoal ? `<button class="btn btn-ghost btn-sm task-decompose-btn" data-action="decompose" title="AIでサブタスクに分解">🤖</button>` : ''}
        ${task.abandoned
          ? `<button class="task-abandon task-abandon--undo" data-action="unabandon" aria-label="諦めを取り消す" title="諦めを取り消す">↩</button>`
          : !task.completed
            ? `<button class="task-abandon" data-action="abandon" aria-label="諦める" title="諦める">🏳</button>`
            : ''
        }
        <button class="task-delete" data-action="delete" aria-label="削除">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
          </svg>
        </button>
      </div>
    </li>
  `;
}

function renderListInto(listEl) {
  if (!listEl) return;
  const tasks = getSortedFilteredTasks();
  if (tasks.length === 0) {
    const { filter } = state;
    listEl.innerHTML = `<li style="list-style:none">
      <div class="empty-state">
        <div class="empty-state-icon">${filter === 'done' ? '✅' : filter === 'abandoned' ? '🏳' : '📝'}</div>
        <div class="empty-state-text">${filter === 'done' ? '完了タスクはありません' : filter === 'abandoned' ? '諦めたタスクはありません' : 'タスクがありません'}</div>
        <div class="empty-state-sub">${(filter === 'all' || filter === 'pending') ? '上のフォームで追加しましょう' : ''}</div>
      </div>
    </li>`;
    return;
  }
  listEl.innerHTML = tasks.map(renderTaskItem).join('');
}

// ---- Event delegation (wired ONCE per render) ----

function wireTaskActions() {
  const listEl = state.container?.querySelector('#task-list');
  if (!listEl || listEl._wired) return;
  listEl._wired = true;

  listEl.addEventListener('click', e => {
    const li = e.target.closest('[data-task-id]');
    if (!li) return;
    const taskId = li.dataset.taskId;
    const action = e.target.closest('[data-action]')?.dataset.action;

    if (action === 'toggle')          handleToggle(taskId, li);
    else if (action === 'delete')     handleDelete(taskId, li);
    else if (action === 'abandon')    handleAbandon(taskId, li);
    else if (action === 'unabandon')  handleUnabandon(taskId, li);
    else if (action === 'edit-title') startTitleEdit(li, taskId);
    else if (action === 'decompose')  handleDecompose(taskId, e.target.closest('[data-action="decompose"]'));
  });
}

// ---- Actions ----

function handleAdd() {
  const c     = state.container;
  const input = c.querySelector('#task-input');
  const title = (state.addTitle || input?.value || '').trim();
  if (!title) { input?.focus(); return; }

  const weight     = state.addWeight || c.querySelector('.weight-btn.selected')?.dataset.w || 'medium';
  const dueDate    = state.addDueDate;
  const dueTime    = state.addDueTime;
  const estimatedMinutes = state.addEstimate ? Number(state.addEstimate) : null;
  const recurFreq  = state.addRecurrence || c.querySelector('#task-recurrence')?.value || '';
  const recurrence = recurFreq ? { freq: recurFreq } : null;
  const tags       = [...state.addTags];
  const taskType   = state.addTaskType;

  // Clear form immediately for instant feel
  input.value = '';
  state.addTitle = '';
  state.addWeight = 'medium';
  state.addDueDate = null;
  state.addDueTime = null;
  state.addEstimate = null;
  state.addRecurrence = '';
  state.addTags    = [];
  state.addTaskType = 'normal';
  state.addCustomTagOpen = false;
  // Reset type buttons
  c.querySelectorAll('.type-btn').forEach(b => b.classList.toggle('selected', b.dataset.t === 'normal'));
  c.querySelector('#task-recurrence').value = '';
  // Reset picker buttons
  const _db = c.querySelector('#task-due-date-btn');
  const _tb = c.querySelector('#task-due-time-btn');
  if (_db) { _db.textContent = '📅 日付'; _db.classList.remove('dp-trigger--set'); }
  if (_tb) { _tb.textContent = '🕐 時刻'; _tb.classList.remove('dp-trigger--set'); }
  // Reset tag chips
  const _tce = c.querySelector('#add-tag-chips');
  if (_tce) _tce.innerHTML = '';
  c.querySelectorAll('[data-preset-tag]').forEach(btn => btn.classList.remove('active'));
  const _eb = c.querySelector('#task-estimate-btn');
  if (_eb) { _eb.textContent = '⏱ 工数'; _eb.classList.remove('dp-trigger--set'); }
  input.focus();

  // Persist synchronously — addTask returns the new task object
  const newTask = addTask({ title, weight, dueDate, dueTime, estimatedMinutes, recurrence, tags, taskType });

  // ── Optimistic: insert new item into DOM without full rerender ──
  const listEl = state.container?.querySelector('#task-list');
  if (listEl && newTask) {
    // Remove empty-state placeholder if it's there
    listEl.querySelector('li:has(.empty-state)')?.remove();
    // If current filter hides this task, fall back to full rerender
    const filterHides = state.filter === 'done' ||
      (['large','medium','small'].includes(state.filter) && state.filter !== weight);

    if (filterHides) {
      rerenderList();
    } else {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = renderTaskItem(newTask);
      const newLi = wrapper.firstElementChild;
      // Insert before first completed task to keep sort order
      const firstDone = listEl.querySelector('.task-item.completed');
      if (firstDone) listEl.insertBefore(newLi, firstDone);
      else           listEl.appendChild(newLi);

      // Slide-in animation
      newLi.style.opacity   = '0';
      newLi.style.transform = 'translateY(-6px)';
      requestAnimationFrame(() => {
        newLi.style.transition = 'opacity 0.18s ease, transform 0.18s ease';
        newLi.style.opacity    = '1';
        newLi.style.transform  = 'translateY(0)';
      });
    }
  } else {
    rerenderList();
  }

  renderProgressBar();
  toast(`「${title}」を追加しました`, 'success');
}

async function handleDecompose(taskId, btn) {
  const task = getTasks().find(t => t.id === taskId);
  if (!task) return;
  if (!isAiAvailable()) { toast('AI is currently unavailable.', 'error'); return; }

  const originalText = btn?.textContent || '🤖';
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }

  try {
    const result = await splitGoalToTasks({
      id: task.id,
      title: task.title,
      type: 'weekly',
      targetDate: task.dueDate || null,
      description: '',
    });
    const subtasks = result?.tasks || [];
    if (!subtasks.length) { toast('サブタスクを生成できませんでした', 'error'); return; }

    subtasks.forEach(st => {
      addTask({ title: st.title, weight: st.weight || 'medium', dueDate: st.dueDate || task.dueDate, tags: task.tags || [] });
    });

    rerenderList();
    renderProgressBar();
    const advice = result?.advice ? ` ${result.advice}` : '';
    toast(`${subtasks.length}件のサブタスクを追加しました ✓${advice}`, 'success');
  } catch (e) {
    toast('AI分解エラー: ' + e.message, 'error');
  } finally {
    if (btn) { btn.textContent = originalText; btn.disabled = false; }
  }
}

function handleToggle(taskId, li) {
  const tasks = getTasks();
  const task  = tasks.find(t => t.id === taskId);
  if (!task) return;

  const willComplete = !task.completed;

  if (willComplete) {
    // ── Optimistic: instantly apply completed styles ──
    li.classList.add('completed');
    li.querySelector('.task-check')?.classList.add('done');

    // Persist
    const completedAt = new Date().toISOString();
    pushUndo({ type: 'complete_task', taskId, wasCompleted: false, completedAt });
    updateTask(taskId, { completed: true, completedAt });

    refreshTaskUi(false);

    undoToast(`「${task.title.slice(0, 20)}」を完了しました`, () => {
      applyUndo();
      rerenderList();
        refreshTaskUi(true);
      });

    // Remove from filtered lists / move in all lists after a short tick animation.
    setTimeout(() => {
      refreshTaskUi(true);
    }, 220);

    // Knowledge save prompt when task has a memo
    if (task.memo) {
      setTimeout(() => showKnowledgeSavePrompt(task), 600);
    }

  } else {
    // ── Optimistic: instantly remove completed styles ──
    li.classList.remove('completed');
    li.querySelector('.task-check')?.classList.remove('done');

    updateTask(taskId, { completed: false, completedAt: null });
    refreshTaskUi(false);

    // Reinsert at correct sort position after short delay
    setTimeout(() => refreshTaskUi(true), 220);
  }
}

function handleDelete(taskId, li) {
  const tasks = getTasks();
  const task  = tasks.find(t => t.id === taskId);
  if (!task) return;

  // ── Optimistic: animate out immediately ──
  li.style.transition = 'opacity 0.18s ease, transform 0.18s ease';
  li.style.opacity    = '0';
  li.style.transform  = 'translateX(-8px)';
  setTimeout(() => li.remove(), 180);

  // Persist
  pushUndo({ type: 'delete_task', task });
  deleteTask(taskId);
  refreshTaskUi(false);

  undoToast(`「${task.title.slice(0, 20)}」を削除しました`, () => {
    applyUndo();
    refreshTaskUi(true);
  });

  setTimeout(() => refreshTaskUi(true), 200);
}

function handleAbandon(taskId, li) {
  const task = getTasks().find(t => t.id === taskId);
  if (!task || task.completed) return;

  li.classList.add('abandoned');
  updateTask(taskId, { abandoned: true });
  refreshTaskUi(false);

  undoToast(`「${task.title.slice(0, 20)}」を諦めました`, () => {
    updateTask(taskId, { abandoned: false, abandonedAt: null });
    refreshTaskUi(true);
  });

  setTimeout(() => {
    refreshTaskUi(true);
  }, 220);
}

function handleUnabandon(taskId, li) {
  const task = getTasks().find(t => t.id === taskId);
  if (!task) return;
  li.classList.remove('abandoned');
  updateTask(taskId, { abandoned: false, abandonedAt: null });
  refreshTaskUi(false);

  undoToast(`「${task.title.slice(0, 20)}」を諦めリストから戻しました`, () => {
    updateTask(taskId, { abandoned: true });
    refreshTaskUi(true);
  });

  setTimeout(() => {
    refreshTaskUi(true);
  }, 220);
}

// ---- Task edit modal (title + due date/time + tags + subtasks + memo) ----

function startTitleEdit(li, taskId) {
  const task = getTasks().find(t => t.id === taskId);
  if (!task) return;

  const overlay = document.getElementById('modal-overlay');
  if (!overlay) return;

  let editDueDate  = task.dueDate  || null;
  let editDueTime  = task.dueTime  || null;
  let editEstimate = task.estimatedMinutes || null;
  let editTags     = [...(task.tags || [])];
  let editSubtasks = (task.subtasks || []).map(s => ({ ...s }));
  let editMemo     = task.memo || '';

  const modal = document.createElement('div');
  modal.className = 'modal task-edit-modal';

  const allTags = getTags();

  modal.innerHTML = `
    <div class="modal-header">
      <h2 class="modal-title">タスクを編集</h2>
      <button class="btn-icon modal-close" aria-label="閉じる">✕</button>
    </div>
    <div class="modal-body task-edit-body">
      <!-- Title -->
      <label class="form-label">タスク名</label>
      <input class="input" id="edit-task-title" value="${esc(task.title)}" placeholder="タスク名">

      <!-- Due date / time -->
      <div class="edit-dt-row">
        <div style="flex:1">
          <label class="form-label">締め切り日</label>
          <button class="dp-trigger dp-trigger--full${editDueDate ? ' dp-trigger--set' : ''}" id="edit-task-date-btn">
            ${editDueDate ? formatPickerDate(editDueDate) : '📅 日付'}
          </button>
        </div>
        <div style="flex:1">
          <label class="form-label">締め切り時刻</label>
          <button class="dp-trigger dp-trigger--full${editDueTime ? ' dp-trigger--set' : ''}" id="edit-task-time-btn">
            ${editDueTime ? '🕐 ' + editDueTime : '🕐 時刻'}
          </button>
        </div>
      </div>

      <label class="form-label">工数</label>
      <button class="dp-trigger dp-trigger--full${editEstimate ? ' dp-trigger--set' : ''}" id="edit-task-estimate-btn">
        ${editEstimate ? `⏱ ${formatDuration(editEstimate)}` : '⏱ 工数'}
      </button>

      <!-- Tags -->
      <label class="form-label">タグ</label>
      <div class="edit-tag-area">
        <div class="edit-tag-chips" id="edit-tag-chips"></div>
        <input class="input" id="edit-tag-input" placeholder="タグを入力してEnter" list="edit-tag-dl" style="font-size:13px;margin-top:6px">
        <datalist id="edit-tag-dl">
          ${allTags.map(t => `<option value="${esc(t)}">`).join('')}
        </datalist>
      </div>

      <!-- Subtasks -->
      <label class="form-label">
        サブタスク
        <span class="edit-sub-count" id="edit-sub-count"></span>
      </label>
      <ul class="edit-subtask-list" id="edit-subtask-list"></ul>
      <div class="edit-sub-add-row">
        <input class="input" id="edit-new-sub" placeholder="サブタスクを追加…" style="flex:1;font-size:13px">
        <button class="btn btn-ghost btn-sm" id="add-sub-btn">+ 追加</button>
      </div>

      <!-- Memo -->
      <details class="task-memo-details" ${editMemo ? 'open' : ''}>
        <summary class="form-label task-memo-summary">📝 メモ</summary>
        <textarea class="input task-memo-textarea" id="edit-task-memo" placeholder="メモ（任意）…" rows="4">${esc(editMemo)}</textarea>
      </details>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="edit-cancel-btn">キャンセル</button>
      <button class="btn btn-primary" id="edit-save-btn">保存</button>
    </div>
  `;

  overlay.innerHTML = '';
  overlay.appendChild(modal);
  overlay.classList.remove('hidden');

  // ---- キーボード表示時のビューポート調整 ----
  let _vvCleanup = null;
  if (window.visualViewport) {
    const _onVVResize = () => {
      const vvH = window.visualViewport.height;
      // フォーム全体が見えるよう max-height を動的に更新
      modal.style.maxHeight = `${vvH - 20}px`;
    };
    window.visualViewport.addEventListener('resize', _onVVResize);
    _vvCleanup = () => window.visualViewport.removeEventListener('resize', _onVVResize);
  }

  // タイトル入力欄にフォーカス（キーボードを出さない preventScroll 付き）
  requestAnimationFrame(() => {
    modal.querySelector('#edit-task-title')?.focus({ preventScroll: true });
  });

  // ---- Subtask list ----
  const _renderSubs = () => {
    const list = modal.querySelector('#edit-subtask-list');
    const countEl = modal.querySelector('#edit-sub-count');
    if (!list) return;
    list.innerHTML = editSubtasks.map((s, i) => `
      <li class="edit-sub-item${s.completed ? ' done' : ''}" data-si="${i}">
        <button class="edit-sub-check${s.completed ? ' done' : ''}" data-sub-toggle="${i}" aria-label="完了切り替え">
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
          </svg>
        </button>
        <span class="edit-sub-title">${esc(s.title)}</span>
        <button class="edit-sub-del" data-sub-del="${i}" aria-label="削除">✕</button>
      </li>
    `).join('');
    list.querySelectorAll('[data-sub-toggle]').forEach(btn => {
      btn.onclick = () => {
        const i = +btn.dataset.subToggle;
        editSubtasks[i].completed = !editSubtasks[i].completed;
        _renderSubs();
      };
    });
    list.querySelectorAll('[data-sub-del]').forEach(btn => {
      btn.onclick = () => { editSubtasks.splice(+btn.dataset.subDel, 1); _renderSubs(); };
    });
    if (countEl) {
      const done = editSubtasks.filter(s => s.completed).length;
      countEl.textContent = editSubtasks.length ? ` ${done}/${editSubtasks.length}` : '';
    }
  };
  _renderSubs();

  const newSubInput = modal.querySelector('#edit-new-sub');
  const addSubBtn   = modal.querySelector('#add-sub-btn');
  const _doAddSub   = () => {
    const title = newSubInput?.value?.trim();
    if (!title) return;
    editSubtasks.push({ id: generateId(), title, completed: false, createdAt: new Date().toISOString() });
    newSubInput.value = '';
    _renderSubs();
  };
  addSubBtn?.addEventListener('click', _doAddSub);
  newSubInput?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); _doAddSub(); } });

  // ---- Tag chips ----
  const _renderTags = () => {
    const chips = modal.querySelector('#edit-tag-chips');
    if (!chips) return;
    chips.innerHTML = editTags.map(t =>
      `<span class="task-tag-chip">${esc(t)}<button class="tag-chip-x" data-remove="${esc(t)}">✕</button></span>`
    ).join('');
    chips.querySelectorAll('[data-remove]').forEach(btn => {
      btn.onclick = () => { editTags = editTags.filter(x => x !== btn.dataset.remove); _renderTags(); };
    });
  };
  _renderTags();

  const tagInput = modal.querySelector('#edit-tag-input');
  tagInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = tagInput.value.trim().replace(/,/g, '');
      if (val && !editTags.includes(val)) {
        editTags.push(val);
        addTag(val);
        _renderTags();
      }
      tagInput.value = '';
    }
  });

  // ---- Date/time pickers ----
  const titleInput = modal.querySelector('#edit-task-title');
  const dateBtn    = modal.querySelector('#edit-task-date-btn');
  const timeBtn    = modal.querySelector('#edit-task-time-btn');
  const estimateBtn = modal.querySelector('#edit-task-estimate-btn');

  const _updDate = () => {
    dateBtn.textContent = editDueDate ? formatPickerDate(editDueDate) : '📅 日付';
    dateBtn.classList.toggle('dp-trigger--set', !!editDueDate);
  };
  const _updTime = () => {
    timeBtn.textContent = editDueTime ? '🕐 ' + editDueTime : '🕐 時刻';
    timeBtn.classList.toggle('dp-trigger--set', !!editDueTime);
  };
  const _updEstimate = () => {
    estimateBtn.textContent = editEstimate ? `⏱ ${formatDuration(editEstimate)}` : '⏱ 工数';
    estimateBtn.classList.toggle('dp-trigger--set', !!editEstimate);
  };

  dateBtn?.addEventListener('click', () => {
    openDatePicker({
      value: editDueDate,
      onConfirm: d => { editDueDate = d; _updDate(); },
      onClear:   () => { editDueDate = null; _updDate(); },
    });
  });
  timeBtn?.addEventListener('click', () => {
    openTimePicker({
      value: editDueTime,
      onConfirm: t => { editDueTime = t; _updTime(); },
      onClear:   () => { editDueTime = null; _updTime(); },
    });
  });
  estimateBtn?.addEventListener('click', () => {
    openDurationPicker({
      value: editEstimate,
      onConfirm: minutes => { editEstimate = minutes; _updEstimate(); },
      onClear: () => { editEstimate = null; _updEstimate(); },
    });
  });

  const close = () => {
    _vvCleanup?.();
    overlay.classList.add('hidden');
    overlay.innerHTML = '';
  };

  const save = () => {
    const newTitle = titleInput.value.trim();
    if (!newTitle) { toast('タスク名を入力してください', 'error'); return; }

    const newMemo = modal.querySelector('#edit-task-memo')?.value || '';
    const newEstimate = editEstimate ? Number(editEstimate) : null;

    const changes = {};
    if (newTitle    !== task.title)                              changes.title    = newTitle;
    if (editDueDate !== (task.dueDate || null))                  changes.dueDate  = editDueDate;
    if (editDueTime !== (task.dueTime || null))                  changes.dueTime  = editDueTime;
    if (newEstimate !== (task.estimatedMinutes || null))         changes.estimatedMinutes = newEstimate;
    if (JSON.stringify(editTags) !== JSON.stringify(task.tags || []))
      changes.tags = editTags;
    if (JSON.stringify(editSubtasks) !== JSON.stringify(task.subtasks || []))
      changes.subtasks = editSubtasks;
    if (newMemo !== (task.memo || ''))                           changes.memo     = newMemo;

    if (Object.keys(changes).length) {
      updateTask(taskId, changes);
      toast('タスクを更新しました', 'success');
    }
    close();
    rerenderList();
    renderProgressBar();
  };

  modal.querySelector('#edit-save-btn')?.addEventListener('click', save);
  modal.querySelector('#edit-cancel-btn')?.addEventListener('click', close);
  modal.querySelector('.modal-close')?.addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); }, { once: true });
  titleInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
}

// ---- Knowledge-save banner (appears when completing a task with memo) ----

function showKnowledgeSavePrompt(task) {
  document.querySelector('.kn-save-banner')?.remove();

  const banner = document.createElement('div');
  banner.className = 'kn-save-banner';
  banner.innerHTML = `
    <span class="kn-save-text">📝 メモをナレッジに保存しますか？</span>
    <button class="btn btn-primary btn-sm kn-save-yes">保存</button>
    <button class="kn-save-dismiss" aria-label="閉じる">✕</button>
  `;
  document.body.appendChild(banner);

  // Auto-dismiss after 8 s
  const dismiss = () => {
    banner.style.opacity = '0';
    banner.style.transform = 'translateY(100%)';
    setTimeout(() => banner.remove(), 250);
  };
  const timer = setTimeout(dismiss, 8000);

  banner.querySelector('.kn-save-yes')?.addEventListener('click', () => {
    clearTimeout(timer);
    dismiss();
    const newMemo = addKnowledgeMemo({
      title:  task.title,
      blocks: [{ id: generateId(), type: 'paragraph', text: task.memo }],
      tags:   task.tags || [],
      summary: task.memo.slice(0, 120),
    });
    // If API key set, kick off AI tag suggestion
    if (isAiAvailable() && task.memo.length > 10) {
      import('../ai.js').then(({ suggestKnowledgeTags }) => {
        suggestKnowledgeTags(task.title || 'Task memo', task.memo).then(aiTags => {
          if (aiTags?.length) {
            updateKnowledgeMemo(newMemo.id, {
              tags: [...new Set([...(task.tags || []), ...aiTags])],
            });
          }
        }).catch(() => {});
      });
    }
    toast('ナレッジに保存しました ✓', 'success');
  });

  banner.querySelector('.kn-save-dismiss')?.addEventListener('click', () => {
    clearTimeout(timer);
    dismiss();
  });
}

// ---- Rerender helpers ----

function rerenderList() {
  const listEl = state.container?.querySelector('#task-list');
  if (!listEl) return;
  const newList = document.createElement('ul');
  newList.className = 'task-list';
  newList.id        = 'task-list';
  renderListInto(newList);
  listEl.replaceWith(newList);
  wireTaskActions();
  wireDragDrop(newList);
}

// ---- Drag & Drop ----

function wireDragDrop(listEl) {
  if (!listEl) return;
  let draggingId = null;

  listEl.addEventListener('dragstart', e => {
    const li = e.target.closest('[data-task-id]');
    if (!li) return;
    draggingId = li.dataset.taskId;
    li.classList.add('task-dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  listEl.addEventListener('dragend', e => {
    const li = e.target.closest('[data-task-id]');
    li?.classList.remove('task-dragging');
    listEl.querySelectorAll('.task-drag-over').forEach(el => el.classList.remove('task-drag-over'));
    draggingId = null;
  });

  listEl.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const li = e.target.closest('[data-task-id]');
    listEl.querySelectorAll('.task-drag-over').forEach(el => el.classList.remove('task-drag-over'));
    if (li && li.dataset.taskId !== draggingId) li.classList.add('task-drag-over');
  });

  listEl.addEventListener('drop', e => {
    e.preventDefault();
    const li = e.target.closest('[data-task-id]');
    if (!li || !draggingId || li.dataset.taskId === draggingId) return;
    li.classList.remove('task-drag-over');
    reorderTask(draggingId, li.dataset.taskId);
    rerenderList();
  });
}

// ---- Recurrence label ----

function recurrenceLabel(r) {
  if (!r) return '';
  switch (r.freq) {
    case 'daily':    return '毎日';
    case 'weekdays': return '平日毎日';
    case 'weekly':   return '毎週';
    case 'monthly':  return '毎月';
    default: return '';
  }
}
