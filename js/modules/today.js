// ============================================================
// today.js — Today detail page
// ============================================================

import {
  getTasks, updateTask,
  getEvents, getCategoryById,
  getScheduleItemsForDate, addScheduleItem, deleteScheduleItem,
  getMyScheduleColor,
} from '../storage.js';
import { esc, today, formatDate, getEventsForDate, addDays, toDateStr } from '../utils.js';
import { openNewKnowledgeMemo, getStudyPromptForBlock } from './knowledge.js';

const nav   = (view) => window.AppNav?.navigate(view);
const toast = (msg, type) => window.AppNav?.showToast(msg, type);
let selectedDateStr = today();

// ---- Entry point ----

export function initToday(container) {
  if (!selectedDateStr) selectedDateStr = today();
  updateTodayHeaderTitle();
  renderPage(container);
}

// ---- Main render ----

function renderPage(container) {
  const todayStr  = selectedDateStr || today();
  const now       = new Date();
  const isRealToday = todayStr === today();
  const nowMin    = now.getHours() * 60 + now.getMinutes();

  // Today's calendar events (includes multi-day events with _displayStart/_displayEnd clamped to today)
  const events = getEventsForDate(getEvents(), todayStr);

  // マイスケジュール items for today
  const schedItems = getScheduleItemsForDate(todayStr);

  // Today's page keeps the broad task list; other dates show tasks due on that day.
  const dayTasks = (isRealToday ? getTasks() : getTasks().filter(t => t.dueDate === todayStr))
    .filter(t => !t.abandoned);
  const allTasks = dayTasks.sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    const wo = { large: 0, medium: 1, small: 2 };
    return (wo[a.weight] ?? 1) - (wo[b.weight] ?? 1);
  });

  const completedCount = allTasks.filter(t => t.completed).length;
  const totalTasks     = allTasks.length;
  const progress       = totalTasks > 0 ? Math.round((completedCount / totalTasks) * 100) : 0;
  const visibleTasks   = allTasks.slice(0, 3);
  const extraTasks     = allTasks.slice(3);

  // Next event banner data
  const nextInfo = isRealToday ? findNextEvent(events, schedItems, nowMin) : null;

  // Unified timeline
  const timeline = buildTimeline(events, schedItems);

  container.innerHTML = `
    <div class="today-page">

      <div class="today-date-nav">
        <button class="today-date-btn" id="today-prev-day" aria-label="前の日">‹</button>
        <button class="today-date-current" id="today-date-current">${esc(dayLabel(todayStr))}</button>
        <button class="today-date-btn" id="today-next-day" aria-label="次の日">›</button>
      </div>

      <!-- "次は" banner -->
      ${isRealToday ? renderNextBanner(nextInfo) : ''}

      <!-- Timeline section -->
      <section class="today-section">
        <div class="today-section-header">
          <span class="today-section-title">⏱ タイムライン</span>
        </div>
        <div class="today-timeline" id="today-timeline">
          ${renderTimelineHTML(timeline, isRealToday ? nowMin : null)}
        </div>
        <button class="today-add-schedule-btn" id="add-schedule-btn">
          <svg viewBox="0 0 24 24" fill="currentColor" style="width:16px;height:16px;flex-shrink:0">
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
          </svg>
          マイスケジュールを追加
        </button>
      </section>

      <!-- Tasks section -->
      <section class="today-section">
        <div class="today-section-header">
          <span class="today-section-title">📋 今日のタスク</span>
          <span class="today-progress-label" id="today-progress-label">${completedCount}/${totalTasks} 完了</span>
        </div>

        ${totalTasks > 0 ? `
          <div class="today-progress-bar-wrap">
            <div class="today-progress-bar">
              <div class="today-progress-fill" id="today-progress-fill" style="width:${progress}%"></div>
            </div>
            <span class="today-progress-pct" id="today-progress-pct">${progress}%</span>
          </div>
          <ul class="today-task-list" id="today-task-list">
            ${visibleTasks.map(renderSwipeTaskHTML).join('')}
          </ul>
          ${extraTasks.length > 0 ? `
            <button class="today-task-more-toggle" id="today-task-more-toggle" aria-expanded="false">
              他 ${extraTasks.length} 件のタスク <span class="today-task-more-arrow">▼</span>
            </button>
            <ul class="today-task-list today-task-extra-list" id="today-task-extra-list" style="display:none">
              ${extraTasks.map(renderSwipeTaskHTML).join('')}
            </ul>
          ` : ''}
        ` : `
          <div class="empty-state" style="padding:14px 0">
            <div class="empty-state-icon">📝</div>
            <div class="empty-state-text">タスクがありません</div>
          </div>
        `}
      </section>

    </div>
  `;

  // Wire interactions
  wireDateNav(container);
  wireTaskList(container, allTasks);
  wireTaskMoreToggle(container);
  wireTimeline(container, todayStr);
  container.querySelector('#add-schedule-btn')
    ?.addEventListener('click', () => openAddScheduleModal(todayStr, container));

  // Study prompt — check if a study-related schedule block just ended
  if (isRealToday) renderStudyPromptIfNeeded(schedItems, nowMin, container);
}

function updateTodayHeaderTitle() {
  const titleEl = document.getElementById('page-title');
  if (titleEl) titleEl.textContent = dayHeaderTitle(selectedDateStr || today());
}

function dayHeaderTitle(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const wd = ['日','月','火','水','木','金','土'][d.getDay()];
  if (dateStr === today()) return `Today – ${d.getMonth() + 1}/${d.getDate()}(${wd})`;
  const tomorrowStr = toDateStr(addDays(new Date(), 1));
  if (dateStr === tomorrowStr) return `Tomorrow – ${d.getMonth() + 1}/${d.getDate()}(${wd})`;
  return `${d.getMonth() + 1}/${d.getDate()}(${wd})`;
}

function dayLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const wd = ['日','月','火','水','木','金','土'][d.getDay()];
  if (dateStr === today()) return `Today ${d.getMonth() + 1}/${d.getDate()}(${wd})`;
  const tomorrowStr = toDateStr(addDays(new Date(), 1));
  if (dateStr === tomorrowStr) return `Tomorrow ${d.getMonth() + 1}/${d.getDate()}(${wd})`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}(${wd})`;
}

function wireDateNav(container) {
  const move = days => {
    const base = new Date((selectedDateStr || today()) + 'T00:00:00');
    selectedDateStr = toDateStr(addDays(base, days));
    updateTodayHeaderTitle();
    renderPage(container);
  };
  container.querySelector('#today-prev-day')?.addEventListener('click', () => move(-1));
  container.querySelector('#today-next-day')?.addEventListener('click', () => move(1));
  container.querySelector('#today-date-current')?.addEventListener('click', () => {
    selectedDateStr = today();
    updateTodayHeaderTitle();
    renderPage(container);
  });
}

// ============================================================
// "次は" banner
// ============================================================

function findNextEvent(events, schedItems, nowMin) {
  const all = [];

  events.forEach(e => {
    if (e._isAllDay) {
      // Middle day of multi-day event — spans all day
      all.push({ title: e.title, startMin: 0, endMin: 1440 });
      return;
    }
    const startSrc = e._displayStart || e.start;
    const endSrc   = e._displayEnd   || e.end;
    const sd   = new Date(startSrc);
    const sMin = sd.getHours() * 60 + sd.getMinutes();
    let eMin;
    if (endSrc && endSrc.includes('T24:00:00')) {
      eMin = 1440;
    } else {
      const ed = endSrc ? new Date(endSrc) : null;
      eMin = ed ? ed.getHours() * 60 + ed.getMinutes() : sMin + 60;
    }
    all.push({ title: e.title, startMin: sMin, endMin: eMin });
  });

  schedItems.forEach(s => {
    const [sh, sm] = s.startTime.split(':').map(Number);
    const [eh, em] = s.endTime.split(':').map(Number);
    all.push({ title: s.title, startMin: sh * 60 + sm, endMin: eh * 60 + em });
  });

  all.sort((a, b) => a.startMin - b.startMin);

  const ongoing = all.find(i => i.startMin <= nowMin && i.endMin > nowMin);
  if (ongoing) return { ...ongoing, status: 'ongoing' };

  const next = all.find(i => i.startMin > nowMin);
  if (next) return { ...next, status: 'upcoming', minutesUntil: next.startMin - nowMin };

  return all.length > 0 ? { status: 'done' } : { status: 'empty' };
}

function renderNextBanner(info) {
  if (!info || info.status === 'empty') {
    return `<div class="next-banner next-banner-empty">
      <span>📭 今日の予定はありません</span>
    </div>`;
  }
  if (info.status === 'done') {
    return `<div class="next-banner next-banner-done">
      <span>✅ 今日の予定はすべて終わりました</span>
    </div>`;
  }
  if (info.status === 'ongoing') {
    return `<div class="next-banner next-banner-ongoing">
      <span class="next-banner-pill">進行中</span>
      <span class="next-banner-title">${esc(info.title)}</span>
    </div>`;
  }
  // upcoming
  const mins = info.minutesUntil;
  const timeStr = mins < 60
    ? `あと${mins}分`
    : mins % 60 === 0
      ? `あと${Math.floor(mins / 60)}時間`
      : `あと${Math.floor(mins / 60)}時間${mins % 60}分`;

  return `<div class="next-banner next-banner-upcoming">
    <span class="next-banner-pill">次は</span>
    <span class="next-banner-title">${esc(info.title)}</span>
    <span class="next-banner-time">${timeStr}</span>
  </div>`;
}

// ============================================================
// Tasks section
// ============================================================

function renderSwipeTaskHTML(task) {
  const weightIcon = task.weight === 'large' ? '🔴' : task.weight === 'small' ? '🟢' : '🟡';
  return `
    <li class="today-task-item${task.completed ? ' completed' : ''}" data-task-id="${esc(task.id)}">
      <div class="swipe-bg" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="white" width="22" height="22">
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
        </svg>
        <span style="color:white;font-size:13px;font-weight:700;margin-left:6px">完了</span>
      </div>
      <div class="swipe-content">
        <button class="task-check${task.completed ? ' done' : ''}" data-action="toggle" aria-label="完了トグル">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
        </button>
        <span class="weight-dot weight-${task.weight || 'medium'}"></span>
        <span class="today-task-title">${esc(task.title)}</span>
        ${task.dueDate ? `<span class="today-task-due">${formatDate(task.dueDate, 'short')}</span>` : ''}
      </div>
    </li>`;
}

function wireTaskList(container, allTasks) {
  const lists = container.querySelectorAll('.today-task-list');
  if (!lists.length) return;

  const onClick = e => {
    const btn = e.target.closest('[data-action="toggle"]');
    if (!btn) return;
    const item   = btn.closest('[data-task-id]');
    const taskId = item?.dataset.taskId;
    if (!taskId) return;

    const task = getTasks().find(t => t.id === taskId);
    if (!task) return;
    const newCompleted = !task.completed;
    updateTask(taskId, { completed: newCompleted });

    item.classList.toggle('completed', newCompleted);
    btn.classList.toggle('done', newCompleted);
    updateProgressUI(container);
  };

  lists.forEach(list => list.addEventListener('click', onClick));

  // Swipe-to-complete gesture
  container.querySelectorAll('.today-task-item:not(.completed)').forEach(item => {
    attachSwipe(item, container);
  });
}

function wireTaskMoreToggle(container) {
  const btn = container.querySelector('#today-task-more-toggle');
  const list = container.querySelector('#today-task-extra-list');
  if (!btn || !list) return;
  btn.addEventListener('click', () => {
    const isOpen = list.style.display !== 'none';
    list.style.display = isOpen ? 'none' : '';
    btn.setAttribute('aria-expanded', String(!isOpen));
    const arrow = btn.querySelector('.today-task-more-arrow');
    if (arrow) arrow.textContent = isOpen ? '▼' : '▲';
  });
}

function attachSwipe(item, container) {
  const content = item.querySelector('.swipe-content');
  const bg      = item.querySelector('.swipe-bg');
  const THRESHOLD = 80;
  let startX = 0, startY = 0, dx = 0, tracking = false;

  item.addEventListener('touchstart', e => {
    startX   = e.touches[0].clientX;
    startY   = e.touches[0].clientY;
    dx       = 0;
    tracking = false;
    content.style.transition = 'none';
  }, { passive: true });

  item.addEventListener('touchmove', e => {
    if (item.classList.contains('completed')) return;
    const curDx = e.touches[0].clientX - startX;
    const curDy = Math.abs(e.touches[0].clientY - startY);

    if (!tracking) {
      if (Math.abs(curDx) < 6 && curDy < 6) return;
      if (curDy > Math.abs(curDx)) return; // vertical scroll — ignore
      tracking = true;
    }
    if (curDx <= 0) return;
    dx = curDx;
    const clamped = Math.min(dx, 120);
    content.style.transform = `translateX(${clamped}px)`;
    if (bg) bg.style.opacity = String(Math.min(dx / THRESHOLD, 1));
  }, { passive: true });

  item.addEventListener('touchend', () => {
    if (!tracking) return;
    content.style.transition = 'transform 0.22s ease';
    if (dx >= THRESHOLD) {
      // ✅ Complete!
      content.style.transform = 'translateX(115%)';
      setTimeout(() => {
        const taskId = item.dataset.taskId;
        updateTask(taskId, { completed: true });
        item.classList.add('completed');
        content.style.transition = 'none';
        content.style.transform  = '';
        if (bg) bg.style.opacity = '0';
        item.querySelector('.task-check')?.classList.add('done');
        updateProgressUI(container);
        toast('完了しました ✓', 'success');
      }, 210);
    } else {
      content.style.transform = 'translateX(0)';
      if (bg) bg.style.opacity = '0';
    }
    tracking = false;
    dx = 0;
  });
}

function updateProgressUI(container) {
  const items = container.querySelectorAll('.today-task-item');
  const total = items.length;
  const done  = [...items].filter(i => i.classList.contains('completed')).length;
  const pct   = total > 0 ? Math.round((done / total) * 100) : 0;
  const fill  = container.querySelector('#today-progress-fill');
  const label = container.querySelector('#today-progress-label');
  const pctEl = container.querySelector('#today-progress-pct');
  if (fill)  fill.style.width      = pct + '%';
  if (label) label.textContent     = `${done}/${total} 完了`;
  if (pctEl) pctEl.textContent     = pct + '%';
}

// ============================================================
// Timeline
// ============================================================

function buildTimeline(events, schedItems) {
  const items = [];

  const hh = (d) => String(d.getHours()).padStart(2, '0');
  const mm = (d) => String(d.getMinutes()).padStart(2, '0');

  events.forEach(e => {
    const cat = getCategoryById(e.categoryId);
    if (e._isAllDay) {
      // Middle day of multi-day event — show as all-day block
      items.push({
        id:          e.id,
        title:       e.title,
        startMin:    0,
        endMin:      1440,
        startStr:    '終日',
        endStr:      '',
        type:        'event',
        color:       cat?.color || '#3b82f6',
        catName:     cat?.name  || '',
        isTentative: !!e.isTentative,
      });
      return;
    }
    const startSrc = e._displayStart || e.start;
    const endSrc   = e._displayEnd   || e.end;
    const sd   = new Date(startSrc);
    const sMin = sd.getHours() * 60 + sd.getMinutes();
    let eMin, endStr;
    if (endSrc && endSrc.includes('T24:00:00')) {
      eMin    = 1440;
      endStr  = '24:00';
    } else {
      const ed = endSrc ? new Date(endSrc) : null;
      eMin    = ed ? ed.getHours() * 60 + ed.getMinutes() : sMin + 60;
      endStr  = ed ? `${hh(ed)}:${mm(ed)}` : '';
    }
    items.push({
      id:          e.id,
      title:       e.title,
      startMin:    sMin,
      endMin:      eMin,
      startStr:    `${hh(sd)}:${mm(sd)}`,
      endStr,
      type:        'event',
      color:       cat?.color || '#3b82f6',
      catName:     cat?.name  || '',
      isTentative: !!e.isTentative,
    });
  });

  schedItems.forEach(s => {
    const [sh, sm] = s.startTime.split(':').map(Number);
    const [eh, em] = s.endTime.split(':').map(Number);
    items.push({
      id:       s.id,
      title:    s.title,
      startMin: sh * 60 + sm,
      endMin:   eh * 60 + em,
      startStr: s.startTime,
      endStr:   s.endTime,
      type:     'schedule',
    });
  });

  return items.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
}

function renderTimelineHTML(items, nowMin = null) {
  if (items.length === 0) {
    return `<div class="empty-state" style="padding:16px 0">
      <div class="empty-state-icon">📅</div>
      <div class="empty-state-text">予定がありません</div>
      <div class="empty-state-sub">下のボタンでマイスケジュールを追加できます</div>
    </div>`;
  }

  let html = '';
  let nowLineInserted = false;
  const showNowState = typeof nowMin === 'number';

  for (const item of items) {
    if (showNowState && !nowLineInserted && item.startMin > nowMin) {
      html += nowLineHTML();
      nowLineInserted = true;
    }
    html += timelineCardHTML(item, nowMin);
  }
  if (showNowState && !nowLineInserted) html += nowLineHTML(); // all past

  return html;
}

function nowLineHTML() {
  const now = new Date();
  const hh  = String(now.getHours()).padStart(2, '0');
  const mm  = String(now.getMinutes()).padStart(2, '0');
  return `<div class="timeline-now-line">
    <span class="timeline-now-time">${hh}:${mm}</span>
    <div class="timeline-now-bar"></div>
  </div>`;
}

function timelineCardHTML(item, nowMin) {
  const showNowState = typeof nowMin === 'number';
  const isPast    = showNowState && item.endMin   <= nowMin;
  const isOngoing = showNowState && item.startMin <= nowMin && item.endMin > nowMin;
  const timeRange = item.endStr ? `${item.startStr} – ${item.endStr}` : item.startStr;
  const pastCls   = isPast    ? ' timeline-past'    : '';
  const onCls     = isOngoing ? ' timeline-ongoing'  : '';

  if (item.type === 'event') {
    const c = item.color;
    return `<div class="timeline-card timeline-event${pastCls}${onCls}"
      style="border-left-color:${c};background:${c}18"
      data-id="${esc(item.id)}">
      <div class="timeline-time">${esc(timeRange)}</div>
      <div class="timeline-title">${esc(item.title)}${item.isTentative ? ' <em class="timeline-tentative">(仮)</em>' : ''}</div>
      ${item.catName ? `<div class="timeline-cat" style="color:${c}">${esc(item.catName)}</div>` : ''}
      ${isOngoing ? '<div class="timeline-badge-ongoing">進行中</div>' : ''}
    </div>`;
  }

  // マイスケジュール
  const c = getMyScheduleColor();
  return `<div class="timeline-card timeline-schedule${pastCls}${onCls}" style="--schedule-color:${c}" data-id="${esc(item.id)}">
    <div class="timeline-time">${esc(timeRange)}</div>
    <div class="timeline-title">${esc(item.title)}</div>
    ${isOngoing ? '<div class="timeline-badge-ongoing">進行中</div>' : ''}
    <button class="timeline-delete-btn" data-delete-id="${esc(item.id)}" aria-label="削除">
      <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
      </svg>
    </button>
  </div>`;
}

function wireTimeline(container, todayStr) {
  container.querySelector('#today-timeline')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-delete-id]');
    if (!btn) return;
    e.stopPropagation();
    deleteScheduleItem(btn.dataset.deleteId);
    toast('削除しました', 'info');
    renderPage(container);
  });
}

// ============================================================
// Study prompt
// ============================================================

function renderStudyPromptIfNeeded(schedItems, nowMin, container) {
  // Find a study block that ended in the last 30 min
  const recentlyEnded = schedItems.find(s => {
    const [eh, em] = s.endTime.split(':').map(Number);
    const endMin = eh * 60 + em;
    return getStudyPromptForBlock(s) && endMin <= nowMin && nowMin - endMin <= 30;
  });
  if (!recentlyEnded) return;

  // Don't show if already shown this session for this item
  const storageKey = `study_prompt_shown_${recentlyEnded.id}_${today()}`;
  if (sessionStorage.getItem(storageKey)) return;
  sessionStorage.setItem(storageKey, '1');

  const banner = document.createElement('div');
  banner.className = 'kn-study-prompt';
  banner.innerHTML = `
    <div class="kn-study-prompt-icon">📝</div>
    <div class="kn-study-prompt-text">
      <strong>「${esc(recentlyEnded.title)}」が終わりました</strong>
      <span>今日学んだことを記録しますか？</span>
    </div>
    <div class="kn-study-prompt-actions">
      <button class="btn btn-ghost btn-sm" id="study-prompt-skip">スキップ</button>
      <button class="btn btn-primary btn-sm" id="study-prompt-record">記録する</button>
    </div>
  `;

  // Insert above the timeline section
  const timelineSection = container.querySelector('.today-section:last-of-type');
  container.querySelector('.today-page')?.insertBefore(banner, timelineSection);

  banner.querySelector('#study-prompt-skip')?.addEventListener('click', () => banner.remove());
  banner.querySelector('#study-prompt-record')?.addEventListener('click', () => {
    banner.remove();
    openNewKnowledgeMemo({ tags: [recentlyEnded.title] });
  });
}

// ============================================================
// Add schedule modal (self-contained, no app.js dependency)
// ============================================================

function openAddScheduleModal(todayStr, container) {
  const overlay = document.getElementById('modal-overlay');
  if (!overlay) return;
  overlay.innerHTML = '';
  overlay.classList.remove('hidden');

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">マイスケジュールを追加</span>
      <button class="modal-close" aria-label="閉じる">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
        </svg>
      </button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">タイトル <span style="color:var(--danger)">*</span></label>
        <input class="input" id="sched-title" placeholder="例：朝食、通学、自習" autocomplete="off">
      </div>
      <div class="form-row">
        <div class="form-group" style="flex:1">
          <label class="form-label">開始</label>
          <input class="input" id="sched-start" type="time" value="09:00">
        </div>
        <div class="form-group" style="flex:1">
          <label class="form-label">終了</label>
          <input class="input" id="sched-end" type="time" value="10:00">
        </div>
      </div>
      <label class="form-label" style="display:flex;align-items:center;gap:10px;cursor:pointer;font-weight:400">
        <input type="checkbox" id="sched-today-only" checked style="width:16px;height:16px">
        今日のみ表示（チェックを外すと毎日表示）
      </label>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost btn-sm" id="sched-cancel">キャンセル</button>
      <button class="btn btn-primary btn-sm" id="sched-save">追加する</button>
    </div>
  `;

  overlay.appendChild(modal);

  const close = () => { overlay.classList.add('hidden'); overlay.innerHTML = ''; };
  modal.querySelector('.modal-close').onclick = close;
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  const keyH = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', keyH); } };
  document.addEventListener('keydown', keyH);

  modal.querySelector('#sched-cancel').onclick = close;

  // Focus title input after animation
  setTimeout(() => modal.querySelector('#sched-title')?.focus(), 80);

  modal.querySelector('#sched-save').onclick = () => {
    const title = modal.querySelector('#sched-title').value.trim();
    if (!title) {
      modal.querySelector('#sched-title').focus();
      modal.querySelector('#sched-title').style.borderColor = 'var(--danger)';
      return;
    }
    const startTime   = modal.querySelector('#sched-start').value || '09:00';
    const endTime     = modal.querySelector('#sched-end').value   || '10:00';
    const todayOnly   = modal.querySelector('#sched-today-only').checked;

    addScheduleItem({ title, startTime, endTime, date: todayOnly ? todayStr : null });
    toast(`「${title}」を追加しました`, 'success');
    close();
    renderPage(container);
  };
}
