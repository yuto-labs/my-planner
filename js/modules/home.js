// ============================================================
// home.js — Dashboard / Home screen
// ============================================================

import {
  getTasks, getEvents, isAiAvailable,
  getCategoryById, updateTask, getCategories, addEvent, addTask,
  addScheduleItem, addKnowledgeMemo, getScheduleItemsForDate, getMyScheduleColor, getReviewsForDate,
} from '../storage.js';
import { interpretPlannerInput } from '../ai.js';
import {
  esc, today, tomorrow, toDateStr, formatDate, formatTime, getGreeting, getGreetingPeriod,
  getEventsForDate, generateId,
} from '../utils.js';

const nav   = (view) => window.AppNav?.navigate(view);
const toast = (msg, type) => window.AppNav?.showToast(msg, type);
let nlBusy = false;

export function initHome(container) {
  const todayStr  = today();
  const tomorrowStr = tomorrow();
  const greeting  = getGreeting();
  const greetingPeriod = getGreetingPeriod();

  const allTasks  = getTasks();
  const allEvents = getEvents();
  const todayEvents = getEventsForDate(allEvents, todayStr);
  const todayMySchedule = getScheduleItemsForDate(todayStr);
  const todaySchedule = [
    ...todayEvents.map(e => ({ ...e, _homeType: 'calendar' })),
    ...todayMySchedule.map(s => ({ ...s, _homeType: 'mySchedule' })),
  ].sort(compareHomeScheduleItems);
  const aiAvailable = isAiAvailable();

  const pending = allTasks
    .filter(t => !t.completed && !t.abandoned)
    .sort((a, b) => {
      const aHas = !!(a.dueDate);
      const bHas = !!(b.dueDate);
      if (!aHas && !bHas) return weightOrder(a.weight) - weightOrder(b.weight);
      if (!aHas) return 1;
      if (!bHas) return -1;
      const aStr = a.dueDate + (a.dueTime ? 'T' + a.dueTime : 'T23:59');
      const bStr = b.dueDate + (b.dueTime ? 'T' + b.dueTime : 'T23:59');
      return aStr < bStr ? -1 : aStr > bStr ? 1 : 0;
    });

  const focusTasks = pending.slice(0, 3);
  const extraTasks = pending.slice(3);

  const tomorrowTasks = allTasks
    .filter(t => !t.completed && !t.abandoned && t.dueDate === tomorrowStr)
    .sort((a, b) => weightOrder(a.weight) - weightOrder(b.weight));

  container.innerHTML = `
    <div class="page home-page">
      <!-- Greeting -->
      <div class="home-greeting">
        <div class="home-date">${formatDate(new Date(), 'medium')}</div>
        <div class="home-greeting-row">
          <span class="home-greeting-icon" aria-hidden="true">${renderGreetingIcon(greetingPeriod)}</span>
          <div class="home-greeting-text">${esc(greeting)}</div>
        </div>
      </div>

      ${aiAvailable ? `
        <!-- Quick NL add input -->
        <div class="home-quick-add mt-3">
          <input class="input" id="nl-input"
            placeholder="AI\u306b\u8ffd\u52a0\u3057\u305f\u3044\u3053\u3068\u3092\u5165\u529b" type="text">
          <button class="btn btn-primary" id="nl-add-btn">Add</button>
        </div>
      ` : ''}

      <!-- Today's focus tasks -->
      <div class="card" id="focus-card">
        <div class="card-title">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>
          Today's Focus
          ${pending.length > 0 ? `<span class="badge" style="margin-left:auto">${pending.length}</span>` : ''}
        </div>
        ${focusTasks.length > 0
          ? `<ul class="task-focus-list">${focusTasks.map(t => renderFocusTask(t, todayStr)).join('')}</ul>
             ${extraTasks.length > 0 ? `
               <button class="focus-extra-toggle" id="focus-extra-toggle" aria-expanded="false">
                 ${extraTasks.length} more tasks <span class="focus-extra-arrow">▼</span>
               </button>
               <ul class="task-focus-list focus-extra-list" id="focus-extra-list" style="display:none">
                 ${extraTasks.map(t => renderFocusTask(t, todayStr)).join('')}
               </ul>
             ` : ''}`
          : `<div class="empty-state" style="padding:16px 0">
              <div class="empty-state-icon">✅</div>
              <div class="empty-state-text">タスクが全て完了しています！</div>
             </div>`
        }
        ${tomorrowTasks.length > 0 ? `
          <div class="home-tomorrow" id="tomorrow-section">
            <div class="home-tomorrow-header" id="tomorrow-header">
              <span>🌙 Tomorrow's Focus</span>
              <span class="badge">${tomorrowTasks.length}</span>
              <span class="collapse-icon">▼</span>
            </div>
            <div class="home-tomorrow-tasks" id="tomorrow-tasks" style="display:none">
              ${tomorrowTasks.map(t => `
                <div class="home-tomorrow-task">
                  <span class="weight-dot weight-${t.weight || 'medium'}"></span>
                  <span>${esc(t.title)}</span>
                  ${t.dueTime ? `<span class="task-due-time">${esc(t.dueTime)}</span>` : ''}
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>

      <!-- Today's schedule -->
      <div class="card" id="schedule-card">
        <div class="card-title">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"/></svg>
          Today's Schedule
          <button class="btn btn-ghost btn-sm" id="goto-today" style="margin-left:auto">Day →</button>
        </div>
        ${todaySchedule.length > 0
          ? `<div class="schedule-list">${todaySchedule.map(renderScheduleItem).join('')}</div>`
          : `<div class="empty-state" style="padding:16px 0">
              <div class="empty-state-icon">📅</div>
              <div class="empty-state-text">No schedule today</div>
             </div>`
        }
      </div>

      <!-- 今日の復習 -->
      ${(() => {
        const dueCount = getReviewsForDate(todayStr).length;
        if (!dueCount) return '';
        return `<div class="card home-review-card" id="home-review-card">
          <div class="home-review-inner">
            <div class="home-review-left">
              <div class="home-review-icon">🎴</div>
              <div>
                <div class="home-review-title">今日の復習</div>
                <div class="home-review-sub">${dueCount}件のカードが待っています</div>
              </div>
            </div>
            <button class="btn btn-primary home-review-btn" id="goto-review">開始 →</button>
          </div>
        </div>`;
      })()}
    </div>
  `;

  // Wire events
  container.querySelector('#goto-today')?.addEventListener('click', () => nav('today'));
  container.querySelector('#goto-review')?.addEventListener('click', () => nav('review'));

  container.querySelectorAll('[data-task-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const taskId = btn.dataset.taskId;
      const task = getTasks().find(t => t.id === taskId);
      if (!task) return;
      updateTask(taskId, { completed: !task.completed });
      reinit(container);
    });
  });

  const nlInput = container.querySelector('#nl-input');
  const nlBtn   = container.querySelector('#nl-add-btn');
  if (nlBtn && !nlBtn.disabled) {
    nlBtn.addEventListener('click', () => handleNLInput(nlInput, nlBtn, container));
    nlInput?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.repeat) { e.preventDefault(); handleNLInput(nlInput, nlBtn, container); }
    });
  }

  container.querySelector('#focus-extra-toggle')?.addEventListener('click', () => {
    const btn  = container.querySelector('#focus-extra-toggle');
    const list = container.querySelector('#focus-extra-list');
    if (!btn || !list) return;
    const isOpen = list.style.display !== 'none';
    list.style.display = isOpen ? 'none' : '';
    btn.setAttribute('aria-expanded', String(!isOpen));
    btn.querySelector('.focus-extra-arrow').textContent = isOpen ? '▼' : '▲';
  });

  container.querySelector('#tomorrow-header')?.addEventListener('click', () => {
    const header = container.querySelector('#tomorrow-header');
    const tasks  = container.querySelector('#tomorrow-tasks');
    if (!header || !tasks) return;
    const isOpen = tasks.style.display !== 'none';
    tasks.style.display = isOpen ? 'none' : 'flex';
    header.classList.toggle('open', !isOpen);
  });
}

function renderGreetingIcon(period) {
  if (period === 'morning') {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="4"></circle>
      <path d="M12 2v2.5M12 19.5V22M4.93 4.93l1.77 1.77M17.3 17.3l1.77 1.77M2 12h2.5M19.5 12H22M4.93 19.07l1.77-1.77M17.3 6.7l1.77-1.77"></path>
    </svg>`;
  }
  if (period === 'day') {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M7 18h9.5a4.5 4.5 0 0 0 .6-8.96A5.5 5.5 0 0 0 6.5 10.5 3.5 3.5 0 0 0 7 18Z"></path>
    </svg>`;
  }
  if (period === 'evening') {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 16h18"></path>
      <path d="M6 16a6 6 0 0 1 12 0"></path>
      <path d="M12 5v2.5M5 12l1.5.5M19 12l-1.5.5"></path>
    </svg>`;
  }
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"></path>
  </svg>`;
}

// ---- Helpers ----

function weightOrder(w) {
  return w === 'large' ? 0 : w === 'small' ? 2 : 1;
}

function renderFocusTask(task, todayStr) {
  const dotClass = `weight-${task.weight || 'medium'}`;
  let urgency = '';
  if (task.dueDate) {
    if (task.dueDate < todayStr) urgency = 'focus-overdue';
    else if (task.dueDate === todayStr) urgency = 'focus-today';
  }
  let dueLabelText = '';
  if (task.dueDate) {
    const dateObj = new Date(task.dueDate + 'T00:00:00');
    const mm = dateObj.getMonth() + 1;
    const dd = dateObj.getDate();
    dueLabelText = `${mm}/${dd}`;
    if (task.dueTime) dueLabelText += ` ${task.dueTime}`;
  }
  const dueLabel = dueLabelText
    ? `<span class="focus-due-label${urgency ? ' ' + urgency : ''}">${esc(dueLabelText)}</span>`
    : '';
  const goalIcon = task.taskType === 'goal' ? '<span style="margin-right:4px">🎯</span>' : '';

  return `
    <li class="task-focus-item${task.completed ? ' completed' : ''}${urgency ? ' ' + urgency : ''}">
      <button class="task-check${task.completed ? ' done' : ''}" data-task-id="${esc(task.id)}" aria-label="完了トグル">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
      </button>
      <span class="weight-dot ${dotClass}"></span>
      ${goalIcon}<span class="task-title">${esc(task.title)}</span>
      ${dueLabel}
    </li>
  `;
}

function renderScheduleItem(event) {
  if (event._homeType === 'mySchedule') {
    const color = getMyScheduleColor();
    const timeStr = `${event.startTime || '--:--'} – ${event.endTime || '--:--'}`;
    return `
      <div class="schedule-item schedule-my-item" style="--cat-color:${color}">
        <span class="schedule-time">${esc(timeStr)}</span>
        <span class="schedule-title">${esc(event.title || 'My Schedule')}</span>
        <span class="chip schedule-my-chip">My</span>
      </div>
    `;
  }

  const cat   = getCategoryById(event.categoryId);
  const color = cat?.color || '#6b7280';

  let timeStr;
  if (event._isAllDay) {
    timeStr = '終日';
  } else {
    const startSrc = event._displayStart || event.start;
    const endSrc   = event._displayEnd   || event.end;
    timeStr = formatTime(startSrc) + (endSrc ? ` – ${formatTime(endSrc)}` : '');
  }

  const multiDayBadge = event._multiDay
    ? '<span class="event-multiday-badge">複数日</span>'
    : '';

  return `
    <div class="schedule-item${event.isTentative ? ' schedule-tentative' : ''}" style="--cat-color:${color}">
      <span class="schedule-time">${esc(timeStr)}</span>
      <span class="schedule-title">
        ${multiDayBadge}
        ${esc(event.title)}${event.isTentative ? ' <em style="color:var(--text-muted);font-size:12px">(仮)</em>' : ''}
        ${event.isRoutine ? ' <span style="color:var(--text-muted);font-size:12px">🔄</span>' : ''}
      </span>
      ${cat ? `<span class="chip" style="background:${color}20;color:${color}">${esc(cat.name)}</span>` : ''}
    </div>
  `;
}

function compareHomeScheduleItems(a, b) {
  return homeScheduleStartMin(a) - homeScheduleStartMin(b);
}

function homeScheduleStartMin(item) {
  if (item._homeType === 'mySchedule') return timeToMinutes(item.startTime) ?? 1440;
  if (item._isAllDay) return 0;
  const startSrc = item._displayStart || item.start;
  const d = startSrc ? new Date(startSrc) : null;
  if (!d || isNaN(d.getTime())) return 1440;
  return d.getHours() * 60 + d.getMinutes();
}

function timeToMinutes(t) {
  if (!/^\d{2}:\d{2}$/.test(t || '')) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

async function handleNLInput(input, btn, container) {
  const text = input?.value?.trim();
  if (!text || nlBusy) return;

  nlBusy = true;
  const originalText = btn.textContent;
  btn.textContent = 'AI\u51e6\u7406\u4e2d...';
  btn.disabled = true;
  input.disabled = true;

  try {
    const parsed = await interpretPlannerInput(text, {
      today: today(),
      categories: getCategories().map(c => c.name),
      recentTasks: getTasks().slice(-8).map(t => ({ title: t.title, dueDate: t.dueDate, tags: t.tags || [] })),
    });

    const title = parsed.title || text;
    const tags = Array.isArray(parsed.tags) ? parsed.tags : [];
    let message = parsed.message || '';

    if (parsed.action === 'event') {
      const cats = getCategories();
      const cat = cats.find(c => c.name === parsed.categoryName) || cats[cats.length - 1];
      const start = parsed.start || (parsed.date && parsed.startTime ? parsed.date + 'T' + parsed.startTime + ':00' : null);
      const end = parsed.end || (parsed.date && parsed.endTime ? parsed.date + 'T' + parsed.endTime + ':00' : null);
      if (!start) throw new Error('event needs date and start time');
      addEvent({ title, start, end, categoryId: cat.id, isTentative: !!parsed.isTentative, isRoutine: false, memo: parsed.memo || '', tags });
      message = message || '\u4e88\u5b9a\u3092\u8ffd\u52a0\u3057\u307e\u3057\u305f';
    } else if (parsed.action === 'schedule') {
      if (!parsed.date || !parsed.startTime || !parsed.endTime) throw new Error('schedule needs date, startTime, and endTime');
      addScheduleItem({ title, date: parsed.date, startTime: parsed.startTime, endTime: parsed.endTime, note: parsed.memo || '', source: 'ai-input' });
      message = message || '\u6d3b\u52d5\u6642\u9593\u306b\u8ffd\u52a0\u3057\u307e\u3057\u305f';
    } else if (parsed.action === 'memo' || parsed.action === 'database') {
      const isDb = parsed.action === 'database';
      const fields = Array.isArray(parsed.fields) ? parsed.fields : [];
      const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
      const blocks = Array.isArray(parsed.blocks) && parsed.blocks.length
        ? parsed.blocks.map(b => ({ id: generateId(), type: b.type || 'paragraph', text: b.text || '' }))
        : buildMemoBlocksFromInput(text, parsed.memo || '', isDb, fields, rows);
      addKnowledgeMemo({ title, blocks, tags: [...new Set([...(isDb ? ['Database'] : []), ...tags])], summary: (parsed.memo || text).slice(0, 200) });
      message = message || (isDb ? '\u30c7\u30fc\u30bf\u30d9\u30fc\u30b9\u3092\u4f5c\u6210\u3057\u307e\u3057\u305f' : '\u30e1\u30e2\u3092\u4f5c\u6210\u3057\u307e\u3057\u305f');
    } else {
      addTask({
        title,
        weight: parsed.weight || 'medium',
        dueDate: parsed.dueDate || parsed.date || null,
        dueTime: parsed.dueTime || null,
        estimatedMinutes: parsed.estimatedMinutes || null,
        tags,
        memo: parsed.memo || '',
      });
      message = message || '\u30bf\u30b9\u30af\u3092\u8ffd\u52a0\u3057\u307e\u3057\u305f';
    }

    input.value = '';
    toast(message, 'success');
    reinit(container);
  } catch (e) {
    toast('AI error: ' + e.message, 'error');
  } finally {
    nlBusy = false;
    btn.textContent = originalText;
    btn.disabled = false;
    input.disabled = false;
  }
}

function buildMemoBlocksFromInput(rawText, memo, isDatabase, fields, rows) {
  if (!isDatabase) return [{ id: generateId(), type: 'paragraph', text: memo || rawText }];
  const blocks = [
    { id: generateId(), type: 'h2', text: '\u30c7\u30fc\u30bf\u30d9\u30fc\u30b9' },
    { id: generateId(), type: 'paragraph', text: memo || 'AI input database.' },
  ];
  if (fields.length) blocks.push({ id: generateId(), type: 'bullet', text: '\u9805\u76ee: ' + fields.join(' / ') });
  rows.slice(0, 20).forEach(row => blocks.push({ id: generateId(), type: 'bullet', text: Object.entries(row).map(([k, v]) => k + ': ' + v).join(' / ') }));
  if (!rows.length && rawText) blocks.push({ id: generateId(), type: 'quote', text: rawText });
  return blocks;
}

function reinit(container) {
  container.innerHTML = '';
  initHome(container);
}
