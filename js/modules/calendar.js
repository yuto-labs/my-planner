// ============================================================
// calendar.js 窶・Calendar: month / week / day views + event CRUD
// ============================================================

import {
  getEvents, addEvent, updateEvent, deleteEvent, deleteFutureRecurring,
  getCategories, getCategoryById, getCategoryColor, getApiKey,
  pushUndo, applyUndo, getScheduleItemsForDate,
  getMyScheduleColor,
} from '../storage.js';
import { parseNaturalLanguageEvent } from '../ai.js';
import {
  esc, today, toDateStr, toDateTimeLocal, fromDateTimeLocal,
  formatDate, formatTime, startOfWeek, addDays, startOfMonth, endOfMonth,
  sameDay, generateId, getEventsForDate,
} from '../utils.js';
import { openDatePicker, openTimePicker, formatPickerDate } from '../datepicker.js';
import { getHolidayInfo } from '../holidays.js';

const nav       = (view) => window.AppNav?.navigate(view);
const toast     = (msg, type) => window.AppNav?.showToast(msg, type);
const undoToast = (msg, cb)   => window.AppNav?.showUndoToast(msg, cb);

// Module state
let state = {
  mode: 'month',         // 'month' | 'week' | 'day'
  cursor: new Date(),    // current view date
  weekStartDate: null,   // YYYY-MM-DD | null 窶・custom week start for week view only
  container: null,
};
let _slideDir     = null;  // 'next' | 'prev' | null 窶・swipe animation direction
let _selectedDate = null;  // currently highlighted date string (single-tap)
let _swipeLocked  = false; // true while slide animation plays 窶・blocks consecutive swipes

export function initCalendar(container) {
  state.container = container;
  if (!(state.cursor instanceof Date) || Number.isNaN(state.cursor.getTime())) {
    state.cursor = new Date();
  }
  const cleanupSwipe = _setupSwipe(container); // register touch listeners for this mount only
  render();
  // Return cleanup: remove calendar-only DOM/listeners when navigating away
  return () => {
    document.querySelector('.cal-day-sheet')?.remove();
    cleanupSwipe?.();
    if (state.container === container) state.container = null;
    _swipeLocked = false;
    _slideDir = null;
  };
}

export function openCalendarAddFlow() {
  if (state.container?.dataset.view !== 'calendar') return;
  document.querySelector('.cal-day-sheet')?.remove();
  openDatePicker({
    value: _selectedDate || today(),
    onConfirm: dateStr => {
      _selectedDate = dateStr;
      openEventModal(null, dateStr);
    },
  });
}

// Swipe listeners live on the container element for the lifetime of the view.
// They must NOT be inside render() 窶・render() is called on every navigation
// and would accumulate duplicate listeners on the same DOM node.
function _setupSwipe(container) {
  let _sx = 0, _sy = 0, _dx = 0;
  let _tracking = false;
  let _settling = false;
  let _allowSwipe = false;
  const isActiveCalendar = () => container.dataset.view === 'calendar' && state.container === container;
  const view = () => container.querySelector('#cal-view');
  const SWIPE_BLOCK_SELECTOR = [
    '.cal-day-sheet',
    '.modal',
    '.dp-popup',
    '.tp-popup',
    'button',
    'input',
    'textarea',
    'select',
    '[contenteditable="true"]',
  ].join(',');
  const clearDrag = () => {
    const v = view();
    if (v) {
      v.classList.remove('cal-view--dragging', 'cal-view--settling');
      v.style.transition = '';
      v.style.transform = '';
      v.style.opacity = '';
    }
    _dx = 0;
    _tracking = false;
    _settling = false;
    _allowSwipe = false;
  };
  const hasSwipeBlocker = () => {
    if (document.querySelector('.cal-day-sheet')) return true;
    const modalOverlay = document.getElementById('modal-overlay');
    if (modalOverlay && !modalOverlay.classList.contains('hidden') && modalOverlay.children.length) return true;
    const pickerOverlay = document.getElementById('dp-picker-overlay');
    if (pickerOverlay && !pickerOverlay.classList.contains('hidden') && pickerOverlay.children.length) return true;
    return false;
  };
  const onTouchStart = e => {
    if (!isActiveCalendar()) return;
    if (hasSwipeBlocker()) return;
    if (_swipeLocked || _settling) return;
    const target = e.target instanceof Element ? e.target : null;
    const blockedTarget = !!target?.closest?.(SWIPE_BLOCK_SELECTOR);
    _allowSwipe = !blockedTarget;
    if (!_allowSwipe) return;
    _sx = e.touches[0].clientX;
    _sy = e.touches[0].clientY;
    _dx = 0;
    _tracking = false;
  };
  const onTouchMove = e => {
    if (!isActiveCalendar()) return;
    if (hasSwipeBlocker()) { clearDrag(); return; }
    if (!_allowSwipe) return;
    if (_swipeLocked || _settling) return;
    const x = e.touches[0].clientX;
    const y = e.touches[0].clientY;
    const dx = x - _sx;
    const dy = Math.abs(y - _sy);

    if (!_tracking) {
      if (Math.abs(dx) < 12 || Math.abs(dx) < dy * 1.15) return;
      _tracking = true;
    }

    const v = view();
    if (!v) return;
    e.preventDefault();
    _dx = dx;
    const limit = window.innerWidth * 0.42;
    const clamped = Math.max(-limit, Math.min(limit, dx));
    const progress = Math.min(Math.abs(clamped) / limit, 1);
    v.classList.add('cal-view--dragging');
    v.style.transition = 'none';
    v.style.transform = `translate3d(${clamped}px,0,0)`;
    v.style.opacity = String(1 - progress * 0.14);
  };
  const onTouchEnd = e => {
    if (!isActiveCalendar()) return;
    if (hasSwipeBlocker()) { clearDrag(); return; }
    if (!_allowSwipe) return;
    if (_swipeLocked) return;               // one swipe = one move
    const dx = _tracking ? _dx : e.changedTouches[0].clientX - _sx;
    const dy = Math.abs(e.changedTouches[0].clientY - _sy);
    const v = view();
    const threshold = Math.max(56, Math.min(96, window.innerWidth * 0.16));
    const shouldMove = Math.abs(dx) > Math.abs(dy) * 1.25 && Math.abs(dx) > threshold;

    if (!_tracking && !shouldMove) return;
    if (!v) { clearDrag(); return; }

    _settling = true;
    v.classList.remove('cal-view--dragging');
    v.classList.add('cal-view--settling');

    if (shouldMove) {
      _swipeLocked = true;                  // lock until render animation ends
      clearDrag();
      moveCursor(dx > 0 ? -1 : 1);
    } else {
      v.style.transition = 'transform 0.14s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.14s ease';
      v.style.transform = 'translate3d(0,0,0)';
      v.style.opacity = '1';
      const done = () => clearDrag();
      v.addEventListener('transitionend', done, { once: true });
      setTimeout(done, 180);
    }
  };

  container.addEventListener('touchstart', onTouchStart, { passive: true });
  container.addEventListener('touchmove', onTouchMove, { passive: false });
  container.addEventListener('touchend', onTouchEnd, { passive: true });
  container.addEventListener('touchcancel', clearDrag, { passive: true });

  return () => {
    container.removeEventListener('touchstart', onTouchStart);
    container.removeEventListener('touchmove', onTouchMove);
    container.removeEventListener('touchend', onTouchEnd);
    container.removeEventListener('touchcancel', clearDrag);
    clearDrag();
  };
}

// ---- Main render ----

function render() {
  const { mode, cursor, container } = state;
  if (!container) return;

  container.innerHTML = `
    <!-- Toolbar: title + mode tabs -->
    <div class="cal-toolbar">
      <button class="cal-nav-arrow" id="cal-prev-btn" aria-label="蜑阪∈">&#8249;</button>
      <div class="cal-title-wrap">
        <button class="cal-title" id="cal-title-btn">${getViewTitle()}</button>
      </div>
      <button class="cal-nav-arrow" id="cal-next-btn" aria-label="次へ">&#8250;</button>
      <div class="cal-mode-tabs">
        ${['month','week','day'].map(m =>
          `<button class="cal-mode-btn${mode===m?' active':''}" data-mode="${m}">
            ${m === 'month' ? '月' : m === 'week' ? '週' : '日'}
          </button>`
        ).join('')}
      </div>
    </div>
    <div id="cal-view"></div>
  `;

  // Title tap: month 竊・drum-roll year/month picker; other modes 竊・go to today
  container.querySelector('#cal-title-btn').onclick = () => {
    if (state.mode === 'month') openYearMonthPicker();
    else {
      state.cursor = new Date();
      if (state.mode === 'week') state.weekStartDate = null;
      _slideDir = null;
      render();
    }
  };

  container.querySelector('#cal-prev-btn').onclick = () => moveCursor(-1);
  container.querySelector('#cal-next-btn').onclick = () => moveCursor(1);

  container.querySelectorAll('.cal-mode-btn').forEach(btn => {
    btn.onclick = () => {
      _selectedDate = null;
      state.mode = btn.dataset.mode;
      if (state.mode === 'week') state.weekStartDate = null;
      render();
    };
  });

  renderView();

  // Apply slide animation triggered by swipe/moveCursor
  if (_slideDir) {
    const view = container.querySelector('#cal-view');
    const cls  = _slideDir === 'next' ? 'cal-slide-next' : 'cal-slide-prev';
    if (view) {
      view.classList.add(cls);
      view.addEventListener('animationend', () => {
        view.classList.remove(cls);
        _swipeLocked = false; // unlock here 窶・exactly when animation ends
      }, { once: true });
      // Safety fallback: unlock after 350ms even if animationend misfires
      setTimeout(() => { _swipeLocked = false; }, 350);
    } else {
      _swipeLocked = false;
    }
    _slideDir = null;
  }
}

function getViewTitle() {
  const { mode, cursor } = state;
  if (mode === 'month') return formatDate(cursor, 'month');
  if (mode === 'week') {
    const ws = getWeekStartDate(cursor);
    const we = addDays(ws, 6);
    return `${formatDate(ws, 'short')} 窶・${formatDate(we, 'short')}`;
  }
  return formatDate(cursor, 'medium');
}

function getWeekStartDate(fallbackDate = state.cursor) {
  const d = state.weekStartDate
    ? new Date(`${state.weekStartDate}T00:00:00`)
    : startOfWeek(fallbackDate);
  d.setHours(0, 0, 0, 0);
  return d;
}

function moveCursor(dir) {
  _selectedDate = null;
  const { mode, cursor } = state;
  if (mode === 'month') {
    state.cursor = new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1);
  } else if (mode === 'week') {
    const nextStart = addDays(getWeekStartDate(cursor), dir * 7);
    state.cursor = nextStart;
    state.weekStartDate = toDateStr(nextStart);
  } else {
    state.cursor = addDays(cursor, dir);
  }
  _slideDir = dir > 0 ? 'next' : 'prev';
  render();
}

function renderView() {
  const { mode } = state;
  if (mode === 'month') renderMonth();
  else renderTimeGrid(mode === 'week' ? 7 : 1);
}

// ============================================================
// MONTH VIEW
// ============================================================

function renderMonth() {
  const { cursor } = state;
  const events = getEvents();
  const view = state.container.querySelector('#cal-view');

  const monthStart = startOfMonth(cursor);
  const monthEnd   = endOfMonth(cursor);

  // Grid starts on Sunday of the week containing monthStart
  const gridStart = startOfWeek(monthStart);
  const todayStr  = today();

  // Pre-build events map: dateStr 竊・clamped events[] 窶・avoids 42ﾃ・filter in the grid loop
  const eventsByDate = new Map();
  {
    let dTemp = new Date(gridStart);
    for (let i = 0; i < 42; i++) {
      const ds = toDateStr(dTemp);
      eventsByDate.set(ds, getEventsForDate(events, ds));
      dTemp = addDays(dTemp, 1);
    }
  }

  const dayLabels = ['日', '月', '火', '水', '木', '金', '土'];

  let html = `
    <div class="cal-month">
      <div class="cal-day-headers">
        ${dayLabels.map(d => `<div class="cal-day-header">${d}</div>`).join('')}
      </div>
      <div class="cal-grid" id="cal-grid">
  `;

  let d = new Date(gridStart);
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 7; col++) {
      const dateStr  = toDateStr(d);
      const isToday  = dateStr === todayStr;
      const isOther  = d.getMonth() !== cursor.getMonth();
      const isSun    = col === 0;
      const isSat    = col === 6;
      const holidayInfo = getHolidayInfo(dateStr);

      const dayEvents = eventsByDate.get(dateStr) ?? [];

      const MAX_CHIPS = 4;
      const chips = dayEvents.slice(0, MAX_CHIPS).map(e => {
        const color = getCategoryColor(e.categoryId);
        const title = e.title || '';
        const isLong = [...title].length > 4;
        return `<span class="cal-event-chip${isLong ? ' long' : ''}${e.isTentative ? ' tentative' : ''}${e._multiDay ? ' multiday' : ''}"
          style="--event-color:${color}" data-event-id="${esc(e.id)}">${esc(e.title)}</span>`;
      }).join('');
      const moreHtml = dayEvents.length > MAX_CHIPS
        ? `<span class="cal-more">+${dayEvents.length - MAX_CHIPS}</span>` : '';

      let classes = 'cal-cell';
      if (isToday) classes += ' today';
      if (isOther) classes += ' other-month';
      if (isSun)   classes += ' sunday';
      if (isSat)   classes += ' saturday';
      if (holidayInfo) classes += ' holiday';

      html += `<div class="${classes}" data-date="${dateStr}">
        <div class="cal-cell-num">${d.getDate()}</div>
        ${holidayInfo ? `<div class="cal-cell-holiday-name" title="${esc(holidayInfo.name)}">${esc(holidayInfo.name)}</div>` : ''}
        ${chips}${moreHtml}
      </div>`;

      d = addDays(d, 1);
    }
  }

  html += '</div></div>';
  view.innerHTML = html;

  // Restore selected-date highlight after re-render
  if (_selectedDate) {
    view.querySelector(`.cal-cell[data-date="${_selectedDate}"]`)
      ?.classList.add('cal-cell--selected');
  }

  // Cell tap: 1st tap 竊・highlight; 2nd tap on same date 竊・open day sheet
  view.querySelectorAll('.cal-cell').forEach(cell => {
    cell.addEventListener('click', (e) => {
      if (e.target.classList.contains('cal-event-chip')) return;
      const dateStr = cell.dataset.date;
      if (_selectedDate === dateStr) {
        openDaySheet(dateStr);
      } else {
        _selectedDate = dateStr;
        view.querySelectorAll('.cal-cell').forEach(c => c.classList.remove('cal-cell--selected'));
        cell.classList.add('cal-cell--selected');
      }
    });
  });

  // Event chip on grid: select the parent cell's date (same as tapping the date number)
  view.querySelectorAll('.cal-event-chip').forEach(chip => {
    chip.addEventListener('click', e => {
      e.stopPropagation();
      const cell = chip.closest('.cal-cell');
      if (!cell) return;
      const dateStr = cell.dataset.date;
      if (_selectedDate === dateStr) {
        openDaySheet(dateStr);
      } else {
        _selectedDate = dateStr;
        view.querySelectorAll('.cal-cell').forEach(c => c.classList.remove('cal-cell--selected'));
        cell.classList.add('cal-cell--selected');
      }
    });
  });
}

// ============================================================
// WEEK / DAY VIEW (time grid)
// ============================================================

function renderTimeGrid(numDays = 7) {
  const { cursor } = state;
  const events = getEvents();
  const view = state.container.querySelector('#cal-view');
  const todayStr = today();

  // Which days to show
  const startDay = numDays === 7 ? getWeekStartDate(cursor) : new Date(cursor);
  startDay.setHours(0, 0, 0, 0);

  const days = [];
  for (let i = 0; i < numDays; i++) {
    days.push(addDays(startDay, i));
  }

  const HOURS = 24;
  const SLOT_H = 56; // px per hour
  const START_H = 0;

  const dayLabels = ['日', '月', '火', '水', '木', '金', '土'];

  // Header
  let html = `
    <div class="cal-week">
      <div class="cal-week-header${numDays===1?' day-mode':''}">
        <div></div>
        ${days.map(d => {
          const ds = toDateStr(d);
          const isToday = ds === todayStr;
          const wd = dayLabels[d.getDay()];
          const holidayInfo = getHolidayInfo(ds);
          const cls = `cal-week-col-head${isToday?' today':''} ${d.getDay()===0?'sunday':d.getDay()===6?'saturday':''}${holidayInfo?' holiday':''}`;
          const inner = `<span class="day-num">${d.getDate()}</span><span class="cal-week-day-label">${wd}</span>${holidayInfo ? `<span class="cal-week-holiday-name">${esc(holidayInfo.name)}</span>` : ''}`;
          return numDays === 7
            ? `<button type="button" class="${cls}" data-week-start="${ds}" aria-label="${ds}から1週間を表示">${inner}</button>`
            : `<div class="${cls}">${inner}</div>`;
        }).join('')}
      </div>
      <div class="cal-week-body${numDays===1?' day-mode':''}" id="cal-week-body">
        <!-- Hour labels -->
        <div class="cal-hour-labels">
          ${Array.from({length:HOURS}, (_,h) =>
            `<div class="cal-hour-label">${h===0?'':String(h).padStart(2,'0')}</div>`
          ).join('')}
        </div>
        <!-- Day columns -->
        ${days.map(d => {
          const ds = toDateStr(d);
          const isToday = ds === todayStr;
          const dayEvents = [
            ...getEventsForDate(events, ds),
            ...getScheduleItemsForDate(ds).map(scheduleItemToTimedEvent),
          ].sort(compareTimedItems);
          return `<div class="cal-day-col${isToday?' today':''}" data-date="${ds}">
            ${Array.from({length:HOURS}, (_,h) =>
              `<div class="cal-hour-slot" data-hour="${h}" data-date="${ds}"></div>`
            ).join('')}
            ${dayEvents.map(e => renderTimedEvent(e, SLOT_H)).join('')}
          </div>`;
        }).join('')}
      </div>
    </div>
  `;

  view.innerHTML = html;

  const body = view.querySelector('#cal-week-body');

  if (numDays === 7) {
    view.querySelectorAll('[data-week-start]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.weekStartDate = btn.dataset.weekStart;
        state.cursor = new Date(`${state.weekStartDate}T00:00:00`);
        _slideDir = null;
        render();
      });
    });
  }

  // Scroll to 7am on load
  requestAnimationFrame(() => {
    if (body) body.scrollTop = 7 * SLOT_H;
  });

  // Current time indicator
  const now = new Date();
  const nowDateStr = toDateStr(now); // local date
  const nowDayCol = body?.querySelector(`.cal-day-col[data-date="${nowDateStr}"]`);
  if (nowDayCol) {
    const pct = (now.getHours() * 60 + now.getMinutes()) / (HOURS * 60);
    const line = document.createElement('div');
    line.className = 'cal-now-line';
    line.style.top = `${pct * HOURS * SLOT_H}px`;
    nowDayCol.appendChild(line);
  }

  // Click slot 竊・add event at that time
  body?.querySelectorAll('.cal-hour-slot').forEach(slot => {
    slot.addEventListener('click', () => {
      const date = slot.dataset.date;
      const hour = parseInt(slot.dataset.hour);
      const startISO = `${date}T${String(hour).padStart(2,'0')}:00:00`;
      const endISO   = `${date}T${String(hour+1).padStart(2,'0')}:00:00`;
      openEventModal(null, null, startISO, endISO);
    });
  });

  // Click timed event 竊・edit
  body?.querySelectorAll('.cal-timed-event').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (el.dataset.scheduleId) return;
      const ev = getEvents().find(ev => ev.id === el.dataset.eventId);
      if (ev) openEventModal(ev, null);
    });
  });
}

// ============================================================
// YEAR / MONTH DRUM-ROLL PICKER
// ============================================================

function openYearMonthPicker() {
  document.querySelector('.cal-ymp')?.remove();

  const { cursor } = state;
  const curYear  = cursor.getFullYear();
  const curMonth = cursor.getMonth(); // 0-indexed

  const ITEM_H   = 44;
  const START_Y  = 2020;
  const END_Y    = 2035;
  const YEARS    = Array.from({ length: END_Y - START_Y + 1 }, (_, i) => START_Y + i);
  const MONTHS   = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

  const el = document.createElement('div');
  el.className = 'cal-ymp';
  el.innerHTML = `
    <div class="cal-ymp-panel">
      <div class="cal-ymp-toolbar">
        <button class="cal-ymp-cancel">キャンセル</button>
        <span class="cal-ymp-label">年と月を選択</span>
        <button class="cal-ymp-ok">決定</button>
      </div>
      <div class="cal-ymp-wrap">
        <div class="cal-ymp-drums">
          <div class="cal-ymp-drum" id="ymp-year-drum">
            <div class="cal-ymp-pad"></div>
            ${YEARS.map(y => `<div class="cal-ymp-item" data-val="${y}">${y}蟷ｴ</div>`).join('')}
            <div class="cal-ymp-pad"></div>
          </div>
          <div class="cal-ymp-drum" id="ymp-month-drum">
            <div class="cal-ymp-pad"></div>
            ${MONTHS.map((m, i) => `<div class="cal-ymp-item" data-val="${i}">${m}</div>`).join('')}
            <div class="cal-ymp-pad"></div>
          </div>
        </div>
        <div class="cal-ymp-highlight"></div>
      </div>
    </div>
  `;

  document.getElementById('app').appendChild(el);

  const yearDrum  = el.querySelector('#ymp-year-drum');
  const monthDrum = el.querySelector('#ymp-month-drum');
  const yearIdx   = Math.max(0, YEARS.indexOf(curYear));

  // Set initial scroll position then animate open
  requestAnimationFrame(() => {
    yearDrum.scrollTop  = yearIdx    * ITEM_H;
    monthDrum.scrollTop = curMonth   * ITEM_H;
    requestAnimationFrame(() => el.classList.add('cal-ymp--open'));
  });

  const getSelected = (drum) => {
    const items = drum.querySelectorAll('.cal-ymp-item');
    const idx   = Math.round(drum.scrollTop / ITEM_H);
    const clamped = Math.max(0, Math.min(idx, items.length - 1));
    return parseInt(items[clamped]?.dataset.val ?? '0');
  };

  const close = () => {
    el.classList.remove('cal-ymp--open');
    setTimeout(() => el.remove(), 260);
  };

  el.querySelector('.cal-ymp-cancel').onclick = close;
  el.addEventListener('click', e => { if (e.target === el) close(); });

  el.querySelector('.cal-ymp-ok').onclick = () => {
    const y = getSelected(yearDrum);
    const m = getSelected(monthDrum);
    state.cursor = new Date(y, m, 1);
    _selectedDate = null;
    close();
    render();
  };
}

// ============================================================
// DAY BOTTOM SHEET
// ============================================================

function openDaySheet(dateStr) {
  // Remove any existing sheet
  document.querySelector('.cal-day-sheet')?.remove();

  const date = new Date(dateStr + 'T00:00:00');
  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
  const dayTitle = `${date.getMonth() + 1}月${date.getDate()}日 (${dayNames[date.getDay()]})`;

  const holidayInfo = getHolidayInfo(dateStr);
  const events    = getEvents();
  const dayEvents = getEventsForDate(events, dateStr).sort((a, b) =>
    new Date(a._displayStart ?? a.start).getTime() -
    new Date(b._displayStart ?? b.start).getTime()
  );

  const sheet = document.createElement('div');
  sheet.className = 'cal-day-sheet';
  sheet.innerHTML = `
    <div class="cal-day-sheet-panel">
      <div class="cal-day-sheet-handle"></div>
      <div class="cal-day-sheet-header">
        <div class="cal-day-sheet-date-wrap">
          <span class="cal-day-sheet-date">${dayTitle}</span>
          ${holidayInfo ? `<span class="cal-day-sheet-holiday">${esc(holidayInfo.name)}</span>` : ''}
        </div>
        <button class="cal-day-sheet-close" aria-label="閉じる">
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
      </div>
      <div class="cal-day-sheet-events">
        ${dayEvents.length ? dayEvents.map(e => {
          const color   = getCategoryColor(e.categoryId);
          const startSrc = e._displayStart ?? e.start;
          const endSrc   = e._displayEnd   ?? e.end;
          const timeStr = e._isAllDay ? '終日' : (startSrc ? formatTime(startSrc) : '');
          const endStr  = (!e._isAllDay && endSrc) ? `〜${formatTime(endSrc)}` : '';
          return `<div class="cal-sheet-ev" data-ev-id="${esc(e.id)}" style="--ev-color:${color}">
            <div class="cal-sheet-ev-bar"></div>
            <div class="cal-sheet-ev-body">
              <div class="cal-sheet-ev-time">${timeStr}${endStr}</div>
              <div class="cal-sheet-ev-title">${esc(e.title)}</div>
            </div>
          </div>`;
        }).join('') : '<p class="cal-sheet-empty">予定はありません</p>'}
      </div>
      <button class="cal-day-sheet-add" aria-label="予定を追加">
        <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
          <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
        </svg>
      </button>
    </div>
  `;

  document.getElementById('app').appendChild(sheet);
  // Animate in (next frame to allow transition)
  requestAnimationFrame(() => sheet.classList.add('cal-day-sheet--open'));

  const closeSheet = () => {
    sheet.classList.remove('cal-day-sheet--open');
    setTimeout(() => sheet.remove(), 290);
  };

  sheet.querySelector('.cal-day-sheet-close').onclick = closeSheet;
  // Tap backdrop to close
  sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });

  // Tap event 竊・edit
  sheet.querySelectorAll('.cal-sheet-ev').forEach(el => {
    el.addEventListener('click', () => {
      const ev = getEvents().find(e => e.id === el.dataset.evId);
      if (ev) { closeSheet(); setTimeout(() => openEventModal(ev, null), 80); }
    });
  });

  // "+" button 竊・add event on this date
  sheet.querySelector('.cal-day-sheet-add').onclick = () => {
    closeSheet();
    setTimeout(() => openEventModal(null, dateStr), 80);
  };
}

function renderTimedEvent(event, slotH) {
  if (event._scheduleItem) return renderTimedScheduleItem(event, slotH);

  // Use _displayStart/_displayEnd for multi-day events clamped to this day
  const startSrc = event._displayStart ?? event.start;
  const endSrc   = event._displayEnd   ?? event.end;

  const startMin = displayDateTimeToMinutes(startSrc);
  let endMin = endSrc ? displayDateTimeToMinutes(endSrc) : startMin + 60;
  if (endMin <= startMin && !String(endSrc || '').includes('T24:00')) {
    endMin += 24 * 60;
  }
  const duration = Math.max(endMin - startMin, 30);

  const top    = (startMin / 60) * slotH;
  const height = (duration / 60) * slotH - 2;

  const color = getCategoryColor(event.categoryId);
  const timeStr = formatTime(startSrc) + (endSrc ? `窶・{formatTime(endSrc)}` : '');

  return `<div class="cal-timed-event${event.isTentative?' tentative':''}"
    data-event-id="${esc(event.id)}"
    style="top:${top}px;height:${height}px;background:${color}"
    title="${esc(event.title)}">
    <div>${esc(timeStr)}</div>
    <div style="font-weight:500">${esc(event.title)}</div>
  </div>`;
}

function displayDateTimeToMinutes(value) {
  if (!value) return 0;
  if (typeof value === 'string' && value.includes('T24:00')) return 24 * 60;
  const d = new Date(value);
  if (isNaN(d.getTime())) return 0;
  return d.getHours() * 60 + d.getMinutes();
}

function scheduleItemToTimedEvent(item) {
  return {
    ...item,
    _scheduleItem: true,
    id: item.id,
    title: item.title || 'My Schedule',
  };
}

function compareTimedItems(a, b) {
  return getTimedItemStartMin(a) - getTimedItemStartMin(b);
}

function getTimedItemStartMin(item) {
  if (item._scheduleItem) return timeToMinutes(item.startTime) ?? 1440;
  if (item._isAllDay) return 0;
  const startSrc = item._displayStart ?? item.start;
  const d = startSrc ? new Date(startSrc) : null;
  if (!d || isNaN(d.getTime())) return 1440;
  return d.getHours() * 60 + d.getMinutes();
}

function renderTimedScheduleItem(item, slotH) {
  const startMin = timeToMinutes(item.startTime) ?? 0;
  const endMin = timeToMinutes(item.endTime) ?? (startMin + 60);
  const duration = Math.max(endMin - startMin, 30);
  const top = (startMin / 60) * slotH;
  const height = (duration / 60) * slotH - 2;
  const color = getMyScheduleColor();
  const timeStr = `${item.startTime || '--:--'}窶・{item.endTime || '--:--'}`;

  return `<div class="cal-timed-event cal-timed-schedule"
    data-schedule-id="${esc(item.id)}"
    style="top:${top}px;height:${height}px;--schedule-color:${color}"
    title="${esc(item.title || 'My Schedule')}">
    <div>${esc(timeStr)}</div>
    <div style="font-weight:500">${esc(item.title || 'My Schedule')}</div>
  </div>`;
}

function timeToMinutes(t) {
  if (!/^\d{2}:\d{2}$/.test(t || '')) return null;
  const [h, m] = t.split(':').map(Number);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

// ============================================================
// EVENT MODAL (add / edit)
// ============================================================

function openEventModal(event, defaultDate, defaultStart, defaultEnd) {
  const isEdit = !!event;
  const cats = getCategories();

  const defStart = defaultStart || (defaultDate
    ? `${defaultDate}T09:00:00`
    : event?.start || new Date().toISOString());
  const defEnd = defaultEnd || (event?.end
    ? event.end
    : new Date(new Date(defStart).getTime() + 3600000).toISOString());

  const _dtParts = (iso) => {
    if (!iso) return { date: '', time: '' };
    const d = new Date(iso);
    const pad = n => String(n).padStart(2, '0');
    return {
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    };
  };

  let evStart = _dtParts(defStart);
  let evEnd = _dtParts(defEnd);
  let evRecurEnd = '';

  const body = document.createElement('div');
  body.innerHTML = `
    <div class="form-group">
      <label class="form-label">タイトル</label>
      <input class="input" id="ev-title" placeholder="予定タイトル" value="${esc(event?.title || '')}" autofocus>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label class="form-label">開始</label>
        <input type="hidden" id="ev-start" value="${esc(toDateTimeLocal(defStart))}">
        <div class="ev-dt-btns">
          <button class="dp-trigger dp-trigger--ev" id="ev-start-date-btn">${formatPickerDate(evStart.date)}</button>
          <button class="dp-trigger dp-trigger--ev" id="ev-start-time-btn">🕐 ${evStart.time}</button>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">終了</label>
        <input type="hidden" id="ev-end" value="${esc(toDateTimeLocal(defEnd))}">
        <div class="ev-dt-btns">
          <button class="dp-trigger dp-trigger--ev" id="ev-end-date-btn">${formatPickerDate(evEnd.date)}</button>
          <button class="dp-trigger dp-trigger--ev" id="ev-end-time-btn">🕐 ${evEnd.time}</button>
        </div>
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">カテゴリ</label>
      <div class="event-cat-select" id="ev-cat-list">
        ${cats.map(c => `
          <button type="button" class="event-cat-btn${event?.categoryId === c.id || (!event && c.id === cats[0].id) ? ' selected' : ''}"
            data-cat-id="${c.id}" style="background:${c.color}">
            ${esc(c.name)}
          </button>
        `).join('')}
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">メモ</label>
      <textarea class="input event-memo-textarea" id="ev-memo" placeholder="補足メモ（任意）…" rows="4">${esc(event?.memo || '')}</textarea>
    </div>

    <div class="form-group" style="display:flex;gap:20px;align-items:center">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="ev-tentative" ${event?.isTentative ? 'checked' : ''}>
        <span>仮予定</span>
      </label>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="ev-routine" ${event?.isRoutine ? 'checked' : ''}>
        <span>ルーティン</span>
      </label>
    </div>

    ${isEdit && event.recurringId ? `
      <div class="form-group" style="background:var(--bg-hover);border-radius:var(--radius-sm);padding:12px">
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:8px">繰り返し予定の更新範囲:</p>
        <div style="display:flex;gap:10px">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
            <input type="radio" name="recurring-scope" value="this" checked> この予定のみ
          </label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
            <input type="radio" name="recurring-scope" value="future"> 今後すべて
          </label>
        </div>
      </div>
    ` : ''}

    ${!isEdit ? `
      <div class="form-group">
        <label class="form-label">繰り返し</label>
        <select class="select" id="ev-recurring">
          <option value="">なし</option>
          <option value="daily">毎日</option>
          <option value="weekly">毎週</option>
          <option value="monthly">毎月</option>
        </select>
      </div>
      <div class="form-group hidden" id="ev-recurring-end-wrap">
        <label class="form-label">繰り返し終了日</label>
        <input type="hidden" id="ev-recurring-end">
        <button class="dp-trigger dp-trigger--full" id="ev-recurring-end-btn">📅 終了日を選ぶ</button>
      </div>
    ` : ''}
  `;

  const suggWrap = document.createElement('div');
  suggWrap.className = 'ev-title-sugg-wrap';
  body.querySelector('#ev-title')?.insertAdjacentElement('afterend', suggWrap);

  const _syncHidden = () => {
    const sh = body.querySelector('#ev-start');
    const eh = body.querySelector('#ev-end');
    if (sh) sh.value = evStart.date && evStart.time ? `${evStart.date}T${evStart.time}` : '';
    if (eh) eh.value = evEnd.date && evEnd.time ? `${evEnd.date}T${evEnd.time}` : '';
  };

  body.querySelector('#ev-title')?.addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    suggWrap.innerHTML = '';
    if (!q) return;

    const timeMap = new Map();
    getEvents().forEach(ev => {
      if (!ev.start || !ev.end || !ev.title?.toLowerCase().includes(q)) return;
      const pad = n => String(n).padStart(2, '0');
      const sd = new Date(ev.start);
      const ed = new Date(ev.end);
      const sStr = `${pad(sd.getHours())}:${pad(sd.getMinutes())}`;
      const eStr = `${pad(ed.getHours())}:${pad(ed.getMinutes())}`;
      const key = `${sStr}-${eStr}`;
      if (!timeMap.has(key)) timeMap.set(key, { sStr, eStr });
    });

    [...timeMap.values()].slice(0, 4).forEach(({ sStr, eStr }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ev-title-sugg-btn';
      btn.textContent = `${sStr}-${eStr}`;
      btn.onclick = () => {
        evStart.time = sStr;
        evEnd.time = eStr;
        if (!evEnd.date) evEnd.date = evStart.date;
        const sb = body.querySelector('#ev-start-time-btn');
        const eb = body.querySelector('#ev-end-time-btn');
        if (sb) sb.textContent = '🕐 ' + sStr;
        if (eb) eb.textContent = '🕐 ' + eStr;
        _syncHidden();
        suggWrap.innerHTML = '';
      };
      suggWrap.appendChild(btn);
    });
  });

  body.querySelectorAll('.event-cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      body.querySelectorAll('.event-cat-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  if (!isEdit) {
    const recSel = body.querySelector('#ev-recurring');
    const recEndWrap = body.querySelector('#ev-recurring-end-wrap');
    recSel?.addEventListener('change', () => {
      recEndWrap.classList.toggle('hidden', !recSel.value);
    });
  }

  body.querySelector('#ev-start-date-btn')?.addEventListener('click', () => {
    openDatePicker({
      value: evStart.date || null,
      onConfirm: d => {
        evStart.date = d;
        const b = body.querySelector('#ev-start-date-btn');
        if (b) b.textContent = formatPickerDate(d);
        _syncHidden();
      },
    });
  });

  body.querySelector('#ev-start-time-btn')?.addEventListener('click', () => {
    openTimePicker({
      value: evStart.time || null,
      onConfirm: t => {
        evStart.time = t;
        const sb = body.querySelector('#ev-start-time-btn');
        if (sb) sb.textContent = '🕐 ' + t;

        const [sh, sm] = t.split(':').map(Number);
        let eh = sh + 1;
        let em = sm;
        if (eh >= 24) { eh = 23; em = 59; }
        const autoEnd = `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
        evEnd.time = autoEnd;
        if (!evEnd.date) evEnd.date = evStart.date;
        const eb = body.querySelector('#ev-end-time-btn');
        if (eb) eb.textContent = '🕐 ' + autoEnd;
        _syncHidden();
      },
    });
  });

  body.querySelector('#ev-end-date-btn')?.addEventListener('click', () => {
    openDatePicker({
      value: evEnd.date || null,
      onConfirm: d => {
        evEnd.date = d;
        const b = body.querySelector('#ev-end-date-btn');
        if (b) b.textContent = formatPickerDate(d);
        _syncHidden();
      },
    });
  });

  body.querySelector('#ev-end-time-btn')?.addEventListener('click', () => {
    openTimePicker({
      value: evEnd.time || null,
      onConfirm: t => {
        evEnd.time = t;
        const b = body.querySelector('#ev-end-time-btn');
        if (b) b.textContent = '🕐 ' + t;
        _syncHidden();
      },
    });
  });

  body.querySelector('#ev-recurring-end-btn')?.addEventListener('click', () => {
    openDatePicker({
      value: evRecurEnd || null,
      onConfirm: d => {
        evRecurEnd = d;
        body.querySelector('#ev-recurring-end').value = d;
        const b = body.querySelector('#ev-recurring-end-btn');
        if (b) {
          b.textContent = formatPickerDate(d);
          b.classList.add('dp-trigger--set');
        }
      },
      onClear: () => {
        evRecurEnd = '';
        body.querySelector('#ev-recurring-end').value = '';
        const b = body.querySelector('#ev-recurring-end-btn');
        if (b) {
          b.textContent = '📅 終了日を選ぶ';
          b.classList.remove('dp-trigger--set');
        }
      },
    });
  });

  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;gap:8px;justify-content:space-between;width:100%';

  if (isEdit) {
    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-danger btn-sm';
    delBtn.textContent = '削除';
    delBtn.onclick = () => handleDelete(event);
    footer.appendChild(delBtn);
  } else {
    footer.appendChild(document.createElement('span'));
  }

  const rightBtns = document.createElement('div');
  rightBtns.style.cssText = 'display:flex;gap:8px';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-ghost btn-sm';
  cancelBtn.textContent = 'キャンセル';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-primary btn-sm';
  saveBtn.textContent = isEdit ? '更新' : '追加';

  rightBtns.appendChild(cancelBtn);
  rightBtns.appendChild(saveBtn);
  footer.appendChild(rightBtns);

  const close = openModalGlobal({
    title: isEdit ? '予定を編集' : '予定を追加',
    body,
    footer,
  });

  cancelBtn.onclick = close;

  saveBtn.onclick = () => {
    const title = body.querySelector('#ev-title').value.trim();
    if (!title) {
      body.querySelector('#ev-title').focus();
      return;
    }

    const startVal = body.querySelector('#ev-start').value;
    const endVal = body.querySelector('#ev-end').value;
    if (!startVal) return;

    const catId = body.querySelector('.event-cat-btn.selected')?.dataset.catId || cats[0].id;
    const isTentative = body.querySelector('#ev-tentative')?.checked || false;
    const isRoutine = body.querySelector('#ev-routine')?.checked || false;

    const startIso = fromDateTimeLocal(startVal);
    let endIso = endVal ? fromDateTimeLocal(endVal) : null;
    if (endIso && new Date(endIso) <= new Date(startIso)) {
      const fixedEnd = new Date(endIso);
      fixedEnd.setDate(fixedEnd.getDate() + 1);
      endIso = fixedEnd.toISOString();
    }

    const newData = {
      title,
      start: startIso,
      end: endIso,
      categoryId: catId,
      isTentative,
      isRoutine,
      memo: body.querySelector('#ev-memo')?.value?.trim() || '',
      tags: [],
    };

    if (isEdit) {
      const scope = body.querySelector('[name="recurring-scope"]:checked')?.value || 'this';
      updateEvent(event.id, newData);
      if (scope === 'future' && event.recurringId) {
        const allEvents = getEvents();
        allEvents
          .filter(e => e.recurringId === event.recurringId && e.start >= event.start && e.id !== event.id)
          .forEach(e => {
            const diff = new Date(newData.start) - new Date(event.start);
            updateEvent(e.id, {
              ...newData,
              start: new Date(new Date(e.start).getTime() + diff).toISOString(),
              end: newData.end ? new Date(new Date(e.end).getTime() + diff).toISOString() : null,
            });
          });
      }
      toast('予定を更新しました', 'success');
    } else {
      const recurType = body.querySelector('#ev-recurring')?.value || '';
      const recurEndStr = body.querySelector('#ev-recurring-end')?.value || '';
      if (recurType) {
        createRecurringEvents(newData, recurType, recurEndStr);
        toast('繰り返し予定を追加しました', 'success');
      } else {
        addEvent(newData);
        toast(`「${title}」を追加しました`, 'success');
      }
    }

    close();
    render();
  };
}

function createRecurringEvents(eventData, recurType, endDateStr) {
  const recurringId = generateId();
  const endDate = endDateStr ? new Date(endDateStr) : addDays(new Date(eventData.start), 90);
  const duration = eventData.end
    ? new Date(eventData.end) - new Date(eventData.start)
    : 3600000;

  let cursor = new Date(eventData.start);
  let count = 0;
  const MAX = 200;

  while (cursor <= endDate && count < MAX) {
    addEvent({
      ...eventData,
      start: cursor.toISOString(),
      end: new Date(cursor.getTime() + duration).toISOString(),
      recurringId,
    });

    if (recurType === 'daily') cursor = addDays(cursor, 1);
    else if (recurType === 'weekly') cursor = addDays(cursor, 7);
    else if (recurType === 'monthly') {
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1,
        cursor.getDate(), cursor.getHours(), cursor.getMinutes());
    } else break;

    count++;
  }
}

async function handleDelete(event) {
  const { openModal: _, closeModal: close } = { closeModal: null };

  if (event.recurringId) {
    // Show choice: this only vs all future
    const body = document.createElement('div');
    body.innerHTML = `
      <p style="margin-bottom:12px">繰り返し予定を削除します。</p>
      <div style="display:flex;flex-direction:column;gap:10px">
        <button class="btn btn-ghost" id="del-this">この予定のみ削除</button>
        <button class="btn btn-danger" id="del-future">この予定と今後すべて削除</button>
      </div>
    `;

    const closeChoice = openModalGlobal({ title: '削除の確認', body, footer: null });

    body.querySelector('#del-this').onclick = () => {
      deleteEvent(event.id);
      toast('削除しました', 'success');
      closeChoice();
      closeModalGlobal();
      render();
    };
    body.querySelector('#del-future').onclick = () => {
      deleteFutureRecurring(event.recurringId, event.start);
      toast('削除しました', 'success');
      closeChoice();
      render();
    };
  } else {
    if (await confirmGlobal(`「${event.title}」を削除しますか？`, { danger: true, okLabel: '削除' })) {
      pushUndo({ type: 'delete_event', event });
      deleteEvent(event.id);
      closeModalGlobal();
      render();
      undoToast(`「${event.title.slice(0, 20)}」を削除しました`, () => {
        applyUndo();
        render();
      });
    }
  }
}

// ---- NL Input ----
async function handleNLInput(input, btn) {
  const text = input?.value?.trim();
  if (!text) return;

  btn.textContent = '…';
  btn.disabled = true;
  input.disabled = true;

  try {
    const cats = getCategories();
    const parsed = await parseNaturalLanguageEvent(text, cats);
    if (!parsed || !parsed.start) throw new Error('解釈できませんでした');

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
    toast(`「${parsed.title || text}」を追加しました`, 'success');
    render();
  } catch (e) {
    toast('AI解釈エラー: ' + e.message, 'error');
  } finally {
    btn.textContent = '追加';
    btn.disabled = false;
    input.disabled = false;
  }
}

// ---- Helpers: use app.js modal system via globals ----

function openModalGlobal(opts) {
  // Access app.js openModal via the DOM trick
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
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
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

  const close = () => {
    overlay.classList.add('hidden');
    overlay.innerHTML = '';
  };

  modal.querySelector('.modal-close').onclick = close;
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  const keyH = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', keyH); } };
  document.addEventListener('keydown', keyH);

  return close;
}

function closeModalGlobal() {
  const overlay = document.getElementById('modal-overlay');
  overlay?.classList.add('hidden');
  if (overlay) overlay.innerHTML = '';
}

function confirmGlobal(message, opts = {}) {
  return new Promise(resolve => {
    const body = document.createElement('div');
    body.innerHTML = `<p style="font-size:15px;line-height:1.6">${message}</p>`;

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;width:100%';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-ghost btn-sm';
    cancelBtn.textContent = 'キャンセル';

    const okBtn = document.createElement('button');
    okBtn.className = opts.danger ? 'btn btn-danger btn-sm' : 'btn btn-primary btn-sm';
    okBtn.textContent = opts.okLabel || 'OK';

    footer.appendChild(cancelBtn);
    footer.appendChild(okBtn);

    const close = openModalGlobal({ title: opts.title || '確認', body, footer });
    cancelBtn.onclick = () => { close(); resolve(false); };
    okBtn.onclick = () => { close(); resolve(true); };
  });
}


