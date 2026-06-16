// ============================================================
// home.js — Dashboard / Home screen
// ============================================================

import {
  getTasks, getEvents, isAiAvailable,
  getCategoryById, updateTask, getCategories, addEvent,
  getScheduleItemsForDate, getMyScheduleColor, getReviewsForDate,
} from '../storage.js';
import { parseNaturalLanguageEvent } from '../ai.js';
import {
  esc, today, tomorrow, toDateStr, formatDate, formatTime, getGreeting,
  getEventsForDate,
} from '../utils.js';

const nav   = (view) => window.AppNav?.navigate(view);
const toast = (msg, type) => window.AppNav?.showToast(msg, type);

export function initHome(container) {
  const todayStr  = today();
  const tomorrowStr = tomorrow();
  const greeting  = getGreeting();

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
        <div class="home-greeting-text">${esc(greeting)}</div>
      </div>

      ${aiAvailable ? `
        <!-- Quick NL add input -->
        <div class="home-quick-add mt-3">
          <input class="input" id="nl-input"
            placeholder="✦ 例：明日14時から研究、今日バイト18時" type="text">
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
      if (e.key === 'Enter') handleNLInput(nlInput, nlBtn, container);
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
  if (!text) return;

  const originalText = btn.textContent;
  btn.textContent = '処理中…';
  btn.disabled = true;
  input.disabled = true;

  try {
    const cats = getCategories();
    const parsed = await parseNaturalLanguageEvent(text, cats);
    if (!parsed || !parsed.start) throw new Error('解析できませんでした');

    const cat = cats.find(c => c.name === parsed.categoryName) || cats[cats.length - 1];
    addEvent({
      title: parsed.title || text,
      start: parsed.start,
      end:   parsed.end,
      categoryId:  cat.id,
      isTentative: parsed.isTentative || false,
      isRoutine:   false,
    });

    input.value = '';
    toast(`「${parsed.title || text}」を追加しました ✨`, 'success');
    reinit(container);
  } catch (e) {
    toast('AI解析エラー: ' + e.message, 'error');
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
    input.disabled = false;
  }
}

function reinit(container) {
  container.innerHTML = '';
  initHome(container);
}
