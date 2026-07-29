// ============================================================
// calendar.js - Calendar: month / week / day views + event CRUD
// ============================================================

import {
  getEvents, saveEvents, addEvent, updateEvent, deleteEvent, deleteFutureRecurring,
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
import { acceptSharedInvite, collectSharedCalendarEvents, getShareGroupsForEventForm, loadSharedGroups } from '../shared-calendar.js';
import {
  deletePlannerImage,
  hydratePlannerImages,
  uploadPlannerImage,
  wirePlannerImageViewer,
} from '../media.js';
import { flushPendingSync } from '../sync.js';

const toast     = (msg, type) => window.AppNav?.showToast(msg, type);
const undoToast = (msg, cb)   => window.AppNav?.showUndoToast(msg, cb);
const SHARE_DEFAULTS_KEY = 'mp_calendar_share_defaults';
const EVENT_TITLE_HISTORY_KEY = 'mp_calendar_event_title_history';
const EVENT_TITLE_HISTORY_MAX = 240;
const SHARED_REFRESH_MS = 15_000;

// Module state
let state = {
  mode: 'month',         // 'month' | 'week' | 'day'
  cursor: new Date(),    // current view date
  weekStartDate: null,   // YYYY-MM-DD | null - custom week start for week view only
  container: null,
  source: 'personal',
  groupId: '',
  shareGroups: [],
  sharedEvents: [],
  sharedLoading: false,
  sharedError: null,
};
let _slideDir     = null;  // 'next' | 'prev' | null - swipe animation direction
let _selectedDate = null;  // currently highlighted date string (single-tap)
let _swipeLocked  = false; // true while slide animation plays - blocks consecutive swipes

export function initCalendar(container) {
  state.container = container;
  state.mode = 'month';
  _selectedDate = null;
  if (!(state.cursor instanceof Date) || Number.isNaN(state.cursor.getTime())) {
    state.cursor = new Date();
  }
  const cleanupSwipe = _setupSwipe(container); // register touch listeners for this mount only
  const onGroupsChanged = () => loadCalendarShareGroups();
  const refreshSharedData = () => {
    if (document.hidden || state.container !== container) return;
    refreshCalendarBackground().catch(() => {});
  };
  const onVisibilityChange = () => {
    if (!document.hidden) refreshSharedData();
  };
  const onRemoteChange = event => {
    if (!event?.detail?.table || event.detail.table === 'events') refreshSharedData();
  };
  document.addEventListener('shared-calendar:groups-changed', onGroupsChanged);
  document.addEventListener('visibilitychange', onVisibilityChange);
  document.addEventListener('sync:remote-change', onRemoteChange);
  window.addEventListener('online', refreshSharedData);
  const sharedRefreshTimer = setInterval(refreshSharedData, SHARED_REFRESH_MS);
  render();
  handleCalendarInviteFromUrl()
    .catch(e => toast(e?.message || '招待リンクを処理できませんでした', 'error'))
    .finally(loadCalendarShareGroups);
  // Return cleanup: remove calendar-only DOM/listeners when navigating away
  return () => {
    document.querySelector('.cal-day-sheet')?.remove();
    document.removeEventListener('shared-calendar:groups-changed', onGroupsChanged);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    document.removeEventListener('sync:remote-change', onRemoteChange);
    window.removeEventListener('online', refreshSharedData);
    clearInterval(sharedRefreshTimer);
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
      openEventModal(null, dateStr, null, null, getCurrentShareDefaults());
    },
  });
}

async function handleCalendarInviteFromUrl() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get('shareInvite');
  if (!token) return;
  const result = await acceptSharedInvite(token);
  url.searchParams.delete('shareInvite');
  window.history.replaceState({}, document.title, `${url.origin}${url.pathname}#calendar`);
  if (result?.pendingLogin) {
    toast('ログインすると、この招待グループに自動で参加します', 'info');
    window.AppNav?.navigate('settings');
    return;
  }
  toast('共有グループに参加しました', 'success');
}

// Swipe listeners live on the container element for the lifetime of the view.
// They must NOT be inside render() - render() is called on every navigation
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
      <button class="cal-nav-arrow" id="cal-prev-btn" aria-label="前へ">&#8249;</button>
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
    <div class="cal-source-bar" aria-label="カレンダー表示元">
      <button class="cal-source-btn${state.source === 'personal' ? ' active' : ''}" data-source="personal" type="button">個人</button>
      ${state.shareGroups.map(group => `
        <button class="cal-source-btn${state.groupId === group.id ? ' active' : ''}" data-source="group" data-group-id="${esc(group.id)}" type="button">
          ${esc(group.name || '共有')}
        </button>
      `).join('')}
      ${state.shareGroups.length ? '<button class="cal-source-refresh" id="cal-source-refresh" type="button">更新</button>' : '<span class="cal-source-help">共有グループは設定から作成できます</span>'}
    </div>
    ${state.sharedError ? `<div class="cal-shared-error">${esc(state.sharedError)}</div>` : ''}
    ${state.sharedLoading ? '<div class="cal-shared-loading">共有予定を読み込み中...</div>' : ''}
    <div id="cal-view"></div>
  `;

  // Title tap: month -> drum-roll year/month picker; other modes -> go to today
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

  container.querySelectorAll('.cal-source-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const source = btn.dataset.source;
      setCalendarSource(source, btn.dataset.groupId || '');
    });
  });
  container.querySelector('#cal-source-refresh')?.addEventListener('click', () => {
    if (isSharedSource()) refreshCalendarSharedEvents();
    else loadCalendarShareGroups();
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
        _swipeLocked = false; // unlock here - exactly when animation ends
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
    return `${formatDate(ws, 'short')} 〜 ${formatDate(we, 'short')}`;
  }
  return formatDate(cursor, 'medium');
}

async function loadCalendarShareGroups() {
  try {
    state.shareGroups = await loadSharedGroups();
    if (state.source !== 'personal') await refreshCalendarSharedEvents();
    else render();
  } catch {
    state.shareGroups = getShareGroupsForEventForm();
    render();
  }
}

async function setCalendarSource(source, groupId = '') {
  const previousGroupId = state.groupId;
  state.source = source;
  state.groupId = source === 'personal' ? '' : groupId;
  if (source !== 'personal' && previousGroupId !== state.groupId) state.sharedEvents = [];
  _selectedDate = null;
  document.querySelector('.cal-day-sheet')?.remove();
  if (source === 'personal') {
    state.sharedEvents = [];
    state.sharedError = null;
    render();
    return;
  }
  await refreshCalendarSharedEvents();
}

let sharedRefreshPromise = null;
let sharedRefreshGroupId = '';
let sharedRefreshVersion = 0;

function sharedCalendarFingerprint() {
  return JSON.stringify({
    groups: (state.shareGroups || []).map(group => [group.id, group.name, group.updated_at]),
    events: (state.sharedEvents || []).map(event => [
      event.id,
      event.updatedAt,
      event.start,
      event.end,
      event.shareVisibility,
      event.visibleTitle || event.title,
    ]),
    error: state.sharedError,
  });
}

async function refreshCalendarBackground() {
  if (!state.container || state.container.dataset.view !== 'calendar') return;
  if (state.source !== 'personal') {
    await refreshCalendarSharedEvents({ silent: true });
    return;
  }

  const before = sharedCalendarFingerprint();
  try {
    state.shareGroups = await loadSharedGroups();
    if (sharedCalendarFingerprint() !== before) render();
  } catch {}
}

async function refreshCalendarSharedEvents({ silent = false } = {}) {
  if (state.source === 'personal') return;

  const requestedGroupId = state.groupId;
  if (sharedRefreshPromise && sharedRefreshGroupId === requestedGroupId) return sharedRefreshPromise;
  const requestVersion = ++sharedRefreshVersion;
  sharedRefreshGroupId = requestedGroupId;
  const before = sharedCalendarFingerprint();
  if (!silent) {
    state.sharedLoading = true;
    state.sharedError = null;
    render();
  }

  sharedRefreshPromise = (async () => {
    try {
      const result = await collectSharedCalendarEvents(requestedGroupId);
      if (
        requestVersion !== sharedRefreshVersion
        || state.source === 'personal'
        || state.groupId !== requestedGroupId
      ) return;
      if (result.error) throw result.error;

      state.shareGroups = result.groups || state.shareGroups;
      if (!state.shareGroups.some(group => group.id === requestedGroupId)) {
        state.source = 'personal';
        state.groupId = '';
        state.sharedEvents = [];
      } else {
        state.sharedEvents = result.events || [];
      }
      state.sharedError = null;
    } catch (e) {
      if (
        requestVersion === sharedRefreshVersion
        && state.source !== 'personal'
        && state.groupId === requestedGroupId
      ) {
        state.sharedError = e?.message || '共有予定を読み込めませんでした';
      }
    } finally {
      if (requestVersion === sharedRefreshVersion) {
        state.sharedLoading = false;
        if (!silent || sharedCalendarFingerprint() !== before) render();
        sharedRefreshPromise = null;
        sharedRefreshGroupId = '';
      }
    }
  })();

  return sharedRefreshPromise;
}

function isSharedSource() {
  return state.source !== 'personal' && !!state.groupId;
}

function getVisibleEvents() {
  return isSharedSource() ? state.sharedEvents : getEvents();
}

function getMonthVisibleEvents() {
  return getVisibleEvents().filter(event => !event.hideFromMonth);
}

function getEventDisplayTitle(event) {
  return event.visibleTitle || event.title || '予定';
}

function appendSharedPreviewEvent(event) {
  if (!isSharedSource() || !event?.id) return;
  const groupIds = Array.isArray(event.sharedGroupIds) ? event.sharedGroupIds : [];
  if (event.shareVisibility === 'private') return;
  if (state.groupId && !groupIds.includes(state.groupId)) return;
  const preview = {
    ...event,
    isOwn: true,
    visibleTitle: event.title || '予定',
    visibleMemo: event.memo || '',
    visibleGroups: groupIds,
  };
  state.sharedEvents = [
    ...state.sharedEvents.filter(item => item.id !== event.id),
    preview,
  ].sort((a, b) => new Date(a.start) - new Date(b.start));
}

function redrawAfterEventChange(removedId = '') {
  if (removedId) state.sharedEvents = state.sharedEvents.filter(event => event.id !== removedId);
  render();
  if (isSharedSource()) {
    setTimeout(() => refreshCalendarSharedEvents(), 600);
  }
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
  const events = getMonthVisibleEvents();
  const view = state.container.querySelector('#cal-view');

  const monthStart = startOfMonth(cursor);
  const monthEnd   = endOfMonth(cursor);

  // Grid starts on Sunday of the week containing monthStart
  const gridStart = startOfWeek(monthStart);
  const todayStr  = today();

  // Pre-build events map: dateStr -> clamped events[]; avoids repeated grid filtering
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
        const color = e.isOwn === false ? 'var(--primary)' : getCategoryColor(e.categoryId);
        const title = getEventDisplayTitle(e);
        const isLong = [...title].length > 4;
        return `<span class="cal-event-chip${isLong ? ' long' : ''}${e.isTentative ? ' tentative' : ''}${e._multiDay ? ' multiday' : ''}${e.isOwn === false ? ' shared-readonly' : ''}"
          style="--event-color:${color}" data-event-id="${esc(e.id)}">${esc(title)}</span>`;
      }).join('');
      const moreHtml = dayEvents.length > MAX_CHIPS
        ? `<span class="cal-more">+${dayEvents.length - MAX_CHIPS}</span>` : '';

      let classes = 'cal-cell';
      if (isToday) classes += ' today';
      if (isOther) classes += ' other-month';
      if (isSun)   classes += ' sunday';
      if (isSat)   classes += ' saturday';
      if (holidayInfo) classes += ' holiday';

      html += `<div class="${classes}" data-date="${dateStr}" role="button" tabindex="0"
        aria-label="${esc(`${formatPickerDate(dateStr)}、予定${dayEvents.length}件。選択後、もう一度押すと予定一覧を表示`)}">
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

  // Cell tap: first tap highlights; second tap on the same date opens the day sheet.
  view.querySelectorAll('.cal-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      const dateStr = cell.dataset.date;
      if (_selectedDate === dateStr) {
        openDaySheet(dateStr);
      } else {
        _selectedDate = dateStr;
        view.querySelectorAll('.cal-cell').forEach(c => c.classList.remove('cal-cell--selected'));
        cell.classList.add('cal-cell--selected');
      }
    });
    cell.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      cell.click();
    });
  });

}

// ============================================================
// WEEK / DAY VIEW (time grid)
// ============================================================

function renderTimeGrid(numDays = 7) {
  const { cursor } = state;
  const events = getVisibleEvents();
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
            ...(isSharedSource() ? [] : getScheduleItemsForDate(ds).map(scheduleItemToTimedEvent)),
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

  // Click slot -> add event at that time
  body?.querySelectorAll('.cal-hour-slot').forEach(slot => {
    slot.addEventListener('click', () => {
      const date = slot.dataset.date;
      const hour = parseInt(slot.dataset.hour);
      const startISO = `${date}T${String(hour).padStart(2,'0')}:00:00`;
      const endISO   = `${date}T${String(hour+1).padStart(2,'0')}:00:00`;
      openEventModal(null, null, startISO, endISO, getCurrentShareDefaults());
    });
  });

  // Click timed event -> edit
  body?.querySelectorAll('.cal-timed-event').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (el.dataset.scheduleId) return;
      const ev = getVisibleEvents().find(item => item.id === el.dataset.eventId);
      if (ev) openCalendarEvent(ev);
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
            ${YEARS.map(y => `<div class="cal-ymp-item" data-val="${y}">${y}\u5e74</div>`).join('')}
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
  const events    = getVisibleEvents();
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
          const color   = e.isOwn === false ? 'var(--primary)' : getCategoryColor(e.categoryId);
          const startSrc = e._displayStart ?? e.start;
          const endSrc   = e._displayEnd   ?? e.end;
          const timeStr = e._isAllDay ? '終日' : (startSrc ? formatTime(startSrc) : '');
          const endStr  = (!e._isAllDay && endSrc) ? `〜${formatTime(endSrc)}` : '';
          return `<div class="cal-sheet-ev${e.isOwn === false ? ' shared-readonly' : ''}" data-ev-id="${esc(e.id)}" style="--ev-color:${color}">
            <div class="cal-sheet-ev-bar"></div>
            <div class="cal-sheet-ev-body">
              <div class="cal-sheet-ev-time">${timeStr}${endStr}</div>
              <div class="cal-sheet-ev-title">${esc(getEventDisplayTitle(e))}</div>
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
  // Double RAF: first frame paints the element, second triggers the transition (iOS Safari fix)
  requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add('cal-day-sheet--open')));

  const closeSheet = () => {
    sheet.classList.remove('cal-day-sheet--open');
    sheet.style.pointerEvents = 'none';
    setTimeout(() => sheet.remove(), 290);
  };

  sheet.querySelector('.cal-day-sheet-close').onclick = closeSheet;
  // Tap backdrop to close
  sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });

  // Tap event -> edit
  sheet.querySelectorAll('.cal-sheet-ev').forEach(el => {
    el.addEventListener('click', () => {
      const ev = getVisibleEvents().find(e => e.id === el.dataset.evId);
      if (ev) { closeSheet(); setTimeout(() => openCalendarEvent(ev), 80); }
    });
  });

  // "+" button -> add event on this date
  sheet.querySelector('.cal-day-sheet-add').onclick = () => {
    closeSheet();
    setTimeout(() => openEventModal(null, dateStr, null, null, getCurrentShareDefaults()), 80);
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

  const color = event.isOwn === false ? 'var(--primary)' : getCategoryColor(event.categoryId);
  const timeStr = formatTime(startSrc) + (endSrc ? `〜${formatTime(endSrc)}` : '');

  return `<div class="cal-timed-event${event.isTentative?' tentative':''}${event.isOwn === false ? ' shared-readonly' : ''}"
    data-event-id="${esc(event.id)}"
    style="top:${top}px;height:${height}px;background:${color}"
    title="${esc(getEventDisplayTitle(event))}">
    <div>${esc(timeStr)}</div>
    <div style="font-weight:500">${esc(getEventDisplayTitle(event))}</div>
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
  const timeStr = `${item.startTime || '--:--'}〜${item.endTime || '--:--'}`;

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

function getCurrentShareDefaults() {
  if (!isSharedSource()) return {};
  return {
    defaultShareGroupId: state.groupId,
    defaultShareVisibility: 'shared_detail',
    preferDefaultShareGroup: true,
  };
}

function loadShareDefaults() {
  try {
    return JSON.parse(localStorage.getItem(SHARE_DEFAULTS_KEY) || 'null') || {};
  } catch {
    return {};
  }
}

function saveShareDefaults(visibility, groupIds) {
  try {
    localStorage.setItem(SHARE_DEFAULTS_KEY, JSON.stringify({
      visibility: visibility || 'private',
      groupIds: Array.isArray(groupIds) ? groupIds : [],
    }));
  } catch {}
}

function loadEventTitleHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(EVENT_TITLE_HISTORY_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter(item => item?.title) : [];
  } catch {
    return [];
  }
}

function saveEventTitleHistory(history) {
  try {
    localStorage.setItem(EVENT_TITLE_HISTORY_KEY, JSON.stringify(history.slice(0, EVENT_TITLE_HISTORY_MAX)));
  } catch {}
}

function rememberEventTitle({ title, start, end, categoryId, updatedAt, createdAt } = {}) {
  const cleanTitle = String(title || '').trim();
  if (!cleanTitle || !start || !end) return;
  const sd = new Date(start);
  const ed = new Date(end);
  if (Number.isNaN(sd.getTime()) || Number.isNaN(ed.getTime())) return;

  const pad = n => String(n).padStart(2, '0');
  const startTime = `${pad(sd.getHours())}:${pad(sd.getMinutes())}`;
  const endTime = `${pad(ed.getHours())}:${pad(ed.getMinutes())}`;
  const key = `${cleanTitle.toLowerCase()}|${startTime}|${endTime}`;
  const latest = new Date(updatedAt || createdAt || start).getTime() || Date.now();
  const rest = loadEventTitleHistory().filter(item => item.key !== key);
  saveEventTitleHistory([{ key, title: cleanTitle, startTime, endTime, categoryId: categoryId || '', latest, count: 1 }, ...rest]);
}

function seedEventTitleHistoryFromExistingEvents() {
  const existing = loadEventTitleHistory();
  const byKey = new Map(existing.map(item => [item.key, item]));
  let changed = false;

  getEvents().forEach(ev => {
    const cleanTitle = String(ev.title || '').trim();
    if (!cleanTitle || !ev.start || !ev.end) return;
    const sd = new Date(ev.start);
    const ed = new Date(ev.end);
    if (Number.isNaN(sd.getTime()) || Number.isNaN(ed.getTime())) return;

    const pad = n => String(n).padStart(2, '0');
    const startTime = `${pad(sd.getHours())}:${pad(sd.getMinutes())}`;
    const endTime = `${pad(ed.getHours())}:${pad(ed.getMinutes())}`;
    const key = `${cleanTitle.toLowerCase()}|${startTime}|${endTime}`;
    const latest = new Date(ev.updatedAt || ev.createdAt || ev.start).getTime() || sd.getTime();
    const prev = byKey.get(key);
    byKey.set(key, {
      key,
      title: cleanTitle,
      startTime,
      endTime,
      latest: Math.max(prev?.latest || 0, latest),
      count: (prev?.count || 0) + 1,
      categoryId: prev?.categoryId || ev.categoryId || '',
    });
    if (!prev) changed = true;
  });

  if (changed) {
    saveEventTitleHistory([...byKey.values()].sort((a, b) => (b.latest || 0) - (a.latest || 0)));
  }
}

function openCalendarEvent(event) {
  if (!event) return;
  if (event.isOwn === false) {
    openReadOnlySharedEvent(event);
    return;
  }
  const local = getEvents().find(ev => ev.id === event.id) || event;
  openEventModal(local, null);
}

function openReadOnlySharedEvent(event) {
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="shared-event-detail">
      <p class="shared-cal-kicker">READ ONLY</p>
      <h3>${esc(getEventDisplayTitle(event))}</h3>
      <p>${esc(formatDate(new Date(event.start), 'medium'))} ${esc(formatTime(event.start))}${event.end ? ` - ${esc(formatTime(event.end))}` : ''}</p>
      ${event.visibleMemo ? `<p class="shared-event-memo">${esc(event.visibleMemo)}</p>` : ''}
      <p class="form-help">この予定は共有メンバーの予定です。閲覧だけできます。</p>
    </div>
  `;
  window.AppNav?.openModal({ title: '共有予定', body, footer: null });
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function eventRange(event) {
  const start = new Date(event.start).getTime();
  if (!Number.isFinite(start)) return null;
  const end = event.end ? new Date(event.end).getTime() : start + 60 * 60 * 1000;
  return { start, end: Number.isFinite(end) && end > start ? end : start + 60 * 60 * 1000 };
}

function scheduleItemRange(item, dateStr) {
  if (!item?.startTime) return null;
  const start = new Date(`${dateStr}T${item.startTime}:00`).getTime();
  if (!Number.isFinite(start)) return null;
  const endTime = item.endTime || item.startTime;
  let end = new Date(`${dateStr}T${endTime}:00`).getTime();
  if (!Number.isFinite(end) || end <= start) end = start + 60 * 60 * 1000;
  return { start, end };
}

function getEventConflicts(candidate, excludeId = '') {
  const range = eventRange(candidate);
  if (!range) return [];
  const dateStr = toDateStr(new Date(candidate.start));
  const conflicts = [];

  getEvents().forEach(event => {
    if (!event || event.id === excludeId) return;
    const other = eventRange(event);
    if (!other || !rangesOverlap(range.start, range.end, other.start, other.end)) return;
    conflicts.push({
      type: 'event',
      title: event.title || '予定',
      time: `${formatTime(event.start)}${event.end ? `-${formatTime(event.end)}` : ''}`,
    });
  });

  getScheduleItemsForDate(dateStr).forEach(item => {
    const other = scheduleItemRange(item, dateStr);
    if (!other || !rangesOverlap(range.start, range.end, other.start, other.end)) return;
    conflicts.push({
      type: 'schedule',
      title: item.title || 'My Schedule',
      time: `${item.startTime || ''}${item.endTime ? `-${item.endTime}` : ''}`,
    });
  });

  return conflicts.slice(0, 5);
}

// ============================================================
// EVENT MODAL (add / edit)
// ============================================================

function openEventModal(event, defaultDate, defaultStart, defaultEnd, options = {}) {
  const isEdit = !!event;
  let attachments = Array.isArray(event?.attachments)
    ? event.attachments.map(item => ({ ...item }))
    : [];
  const pendingImageUploads = new Set();
  const removedImagePaths = new Set();
  let modalCommitted = false;
  const cats = getCategories();
  const shareGroups = getShareGroupsForEventForm();
  const savedShareDefaults = loadShareDefaults();
  const validSavedGroupIds = Array.isArray(savedShareDefaults.groupIds)
    ? savedShareDefaults.groupIds.filter(id => shareGroups.some(group => group.id === id))
    : [];
  const selectedShareGroups = new Set(Array.isArray(event?.sharedGroupIds) ? event.sharedGroupIds : []);
  const hasDefaultShareGroup = !isEdit
    && options.defaultShareGroupId
    && shareGroups.some(group => group.id === options.defaultShareGroupId);
  if (hasDefaultShareGroup && options.preferDefaultShareGroup) {
    selectedShareGroups.add(options.defaultShareGroupId);
  } else if (!isEdit && validSavedGroupIds.length) {
    validSavedGroupIds.forEach(id => selectedShareGroups.add(id));
  }
  if (!isEdit && !validSavedGroupIds.length && hasDefaultShareGroup) selectedShareGroups.add(options.defaultShareGroupId);
  if (!isEdit && !validSavedGroupIds.length && !hasDefaultShareGroup && shareGroups.length === 1) {
    selectedShareGroups.add(shareGroups[0].id);
  }
  const currentShareVisibility = event?.shareVisibility
    || options.defaultShareVisibility
    || (!isEdit && savedShareDefaults.visibility)
    || (!isEdit && selectedShareGroups.size ? 'shared_detail' : 'private');
  const findRememberedCategoryId = (title = '') => {
    const q = String(title || '').trim().toLowerCase();
    if (!q) return '';
    const exact = loadEventTitleHistory()
      .filter(item => String(item.title || '').trim().toLowerCase() === q && item.categoryId)
      .sort((a, b) => (b.latest || 0) - (a.latest || 0))[0];
    return exact?.categoryId && cats.some(c => c.id === exact.categoryId) ? exact.categoryId : '';
  };
  const defaultCategoryId = event?.categoryId || findRememberedCategoryId(event?.title) || cats[0]?.id || '';
  const hideFromMonth = !!event?.hideFromMonth;

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
          <button type="button" class="event-cat-btn${defaultCategoryId === c.id ? ' selected' : ''}"
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

    <div class="form-group event-photo-field">
      <div class="event-photo-heading">
        <label class="form-label">写真</label>
        <div class="event-photo-actions">
          <button type="button" class="btn btn-ghost btn-sm" id="ev-photo-btn">写真を選ぶ</button>
          <button type="button" class="btn btn-ghost btn-sm" id="ev-camera-btn">撮影する</button>
        </div>
      </div>
      <input class="hidden" id="ev-photo-input" type="file" accept="image/*">
      <input class="hidden" id="ev-camera-input" type="file" accept="image/*" capture="environment">
      <div class="event-photo-list" id="ev-photo-list"></div>
      <p class="form-help">写真は非公開で保存され、ログイン中の端末間で同期されます。</p>
    </div>

    <div class="form-group event-display-box">
      <label class="event-display-choice">
        <input type="checkbox" id="ev-hide-month" ${hideFromMonth ? 'checked' : ''}>
        <span>
          <strong>月カレンダーには表示しない</strong>
          <small>予定は残したまま、週・日・今日のマイスケジュール側で確認します。</small>
        </span>
      </label>
    </div>

    <div class="event-conflict-warning hidden" id="ev-conflict-warning"></div>

    <div class="form-group event-share-box">
      <label class="form-label">共有する内容</label>
      <div class="event-share-visibility" id="ev-share-visibility">
        <label class="event-share-choice${currentShareVisibility === 'private' ? ' selected' : ''}">
          <input type="radio" name="ev-share-visibility" value="private" ${currentShareVisibility === 'private' ? 'checked' : ''}>
          <span>共有しない</span>
        </label>
        <label class="event-share-choice${currentShareVisibility === 'shared_busy' ? ' selected' : ''}">
          <input type="radio" name="ev-share-visibility" value="shared_busy" ${currentShareVisibility === 'shared_busy' ? 'checked' : ''}>
          <span>時間だけ</span>
        </label>
        <label class="event-share-choice${currentShareVisibility === 'shared_detail' ? ' selected' : ''}">
          <input type="radio" name="ev-share-visibility" value="shared_detail" ${currentShareVisibility === 'shared_detail' ? 'checked' : ''}>
          <span>詳細も</span>
        </label>
      </div>
      <p class="form-help">時間だけなら相手には「予定あり」と表示されます。詳細も選ぶとタイトルとメモも見えます。</p>
      <label class="form-label">共有先</label>
      <div class="event-share-groups" id="ev-share-groups">
        ${shareGroups.length ? shareGroups.map(group => `
          <label class="event-share-group">
            <input type="checkbox" value="${esc(group.id)}" ${selectedShareGroups.has(group.id) ? 'checked' : ''}>
            <span>${esc(group.name || '共有グループ')}</span>
          </label>
        `).join('') : '<p class="form-help">共有グループは設定画面から作成できます。</p>'}
      </div>
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

    ${(!isEdit || !event.recurringId) ? `
      <div class="form-group">
        <label class="form-label">繰り返し${isEdit ? 'にする' : ''}</label>
        <select class="select" id="ev-recurring">
          <option value="">なし</option>
          <option value="daily">毎日</option>
          <option value="weekly">毎週</option>
          <option value="monthly">毎月</option>
        </select>
      </div>
      <div class="form-group hidden" id="ev-recurring-end-wrap">
        <label class="form-label">繰り返し期間</label>
        <input type="hidden" id="ev-recurring-end">
        <div class="ev-recurring-range">
          <div class="ev-recurring-range-side">
            <span class="ev-recurring-range-label">開始</span>
            <strong id="ev-recurring-start-label">${formatPickerDate(evStart.date)}</strong>
          </div>
          <div class="ev-recurring-range-arrow">→</div>
          <button class="dp-trigger dp-trigger--full ev-recurring-end-trigger" id="ev-recurring-end-btn">終了日を選ぶ</button>
        </div>
        <div class="ev-recurring-exclude">
          <label class="form-label">除外する曜日</label>
          <div class="ev-recurring-weekdays">
              <label class="ev-recurring-weekday">
                <input type="checkbox" value="0">
                <span>日</span>
              </label>

              <label class="ev-recurring-weekday">
                <input type="checkbox" value="1">
                <span>月</span>
              </label>

              <label class="ev-recurring-weekday">
                <input type="checkbox" value="2">
                <span>火</span>
              </label>

              <label class="ev-recurring-weekday">
                <input type="checkbox" value="3">
                <span>水</span>
              </label>

              <label class="ev-recurring-weekday">
                <input type="checkbox" value="4">
                <span>木</span>
              </label>

              <label class="ev-recurring-weekday">
                <input type="checkbox" value="5">
                <span>金</span>
              </label>

              <label class="ev-recurring-weekday">
                <input type="checkbox" value="6">
                <span>土</span>
              </label>

          </div>
        </div>
        <p class="form-help">選んだ期間まで作成します。除外した曜日には繰り返し予定を作りません。</p>
      </div>
    ` : ''}
  `;

  const suggWrap = document.createElement('div');
  suggWrap.className = 'ev-title-sugg-wrap';
  body.querySelector('#ev-title')?.insertAdjacentElement('afterend', suggWrap);

  const renderAttachments = () => {
    const list = body.querySelector('#ev-photo-list');
    if (!list) return;
    list.innerHTML = attachments.map(item => `
      <div class="event-photo-item media-frame media-frame--loading">
        <img data-media-path="${esc(item.path || '')}" data-media-view="1"
          tabindex="0" role="button" aria-label="予定の写真を拡大表示"
          alt="${esc(item.alt || '予定の写真')}">
        <button type="button" data-remove-event-photo="${esc(item.path || '')}" aria-label="写真を削除">×</button>
      </div>
    `).join('');
    list.classList.toggle('hidden', attachments.length === 0);
    list.querySelectorAll('[data-remove-event-photo]').forEach(button => {
      button.addEventListener('click', () => {
        const path = button.dataset.removeEventPhoto;
        attachments = attachments.filter(item => item.path !== path);
        removedImagePaths.add(path);
        renderAttachments();
      });
    });
    hydratePlannerImages(list);
    wirePlannerImageViewer(list);
  };
  renderAttachments();

  const photoInput = body.querySelector('#ev-photo-input');
  const cameraInput = body.querySelector('#ev-camera-input');
  body.querySelector('#ev-photo-btn')?.addEventListener('click', () => photoInput?.click());
  body.querySelector('#ev-camera-btn')?.addEventListener('click', () => cameraInput?.click());
  const handlePhoto = async eventInput => {
    const file = eventInput.target.files?.[0];
    eventInput.target.value = '';
    if (!file) return;
    const button = eventInput.target === cameraInput
      ? body.querySelector('#ev-camera-btn')
      : body.querySelector('#ev-photo-btn');
    const previous = button?.textContent;
    if (button) {
      button.disabled = true;
      button.textContent = '追加中...';
    }
    try {
      const media = await uploadPlannerImage(file, 'events');
      attachments.push(media);
      pendingImageUploads.add(media.path);
      renderAttachments();
    } catch (error) {
      toast(error?.message || '写真を追加できませんでした', 'error');
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = previous;
      }
    }
  };
  photoInput?.addEventListener('change', handlePhoto);
  cameraInput?.addEventListener('change', handlePhoto);

  const _syncHidden = () => {
    const sh = body.querySelector('#ev-start');
    const eh = body.querySelector('#ev-end');
    if (sh) sh.value = evStart.date && evStart.time ? `${evStart.date}T${evStart.time}` : '';
    if (eh) eh.value = evEnd.date && evEnd.time ? `${evEnd.date}T${evEnd.time}` : '';
  };

  const selectEventCategory = (categoryId) => {
    if (!categoryId || !cats.some(c => c.id === categoryId)) return;
    body.querySelectorAll('.event-cat-btn').forEach(b => {
      b.classList.toggle('selected', b.dataset.catId === categoryId);
    });
  };

  const titleInput = body.querySelector('#ev-title');
  const renderTitleSuggestions = () => {
    const q = titleInput?.value.trim().toLowerCase() || '';
    suggWrap.innerHTML = '';
    if (q.length < 1) return;

    getEventTitleSuggestions(q, event?.id).slice(0, 5).forEach(sugg => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ev-title-sugg-btn';
      btn.innerHTML = `
        <span class="ev-title-sugg-main">${esc(sugg.title)}</span>
        <span class="ev-title-sugg-time">${esc(sugg.startTime)}-${esc(sugg.endTime)}${sugg.categoryName ? ` / ${esc(sugg.categoryName)}` : ''}</span>
      `;
      btn.onclick = () => {
        if (titleInput) titleInput.value = sugg.title;
        evStart.time = sugg.startTime;
        evEnd.time = sugg.endTime;
        if (!evEnd.date) evEnd.date = evStart.date;
        const sb = body.querySelector('#ev-start-time-btn');
        const eb = body.querySelector('#ev-end-time-btn');
        if (sb) sb.textContent = '🕐 ' + sugg.startTime;
        if (eb) eb.textContent = '🕐 ' + sugg.endTime;
        selectEventCategory(sugg.categoryId);
        _syncHidden();
        suggWrap.innerHTML = '';
      };
      suggWrap.appendChild(btn);
    });
  };
  titleInput?.addEventListener('input', () => {
    const rememberedCategoryId = findRememberedCategoryId(titleInput?.value);
    if (rememberedCategoryId && !isEdit) selectEventCategory(rememberedCategoryId);
    renderTitleSuggestions();
  });
  titleInput?.addEventListener('focus', renderTitleSuggestions);

  body.querySelectorAll('.event-cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      body.querySelectorAll('.event-cat-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  const ensureShareGroupSelection = () => {
    const selectedVisibility = body.querySelector('[name="ev-share-visibility"]:checked')?.value || 'private';
    if (selectedVisibility === 'private') return;
    const checked = body.querySelectorAll('#ev-share-groups input[type="checkbox"]:checked');
    if (checked.length) return;
    const fallbackId = hasDefaultShareGroup
      ? options.defaultShareGroupId
      : (shareGroups.length === 1 ? shareGroups[0].id : '');
    if (!fallbackId) return;
    const fallback = [...body.querySelectorAll('#ev-share-groups input[type="checkbox"]')]
      .find(input => input.value === fallbackId);
    if (fallback) fallback.checked = true;
  };

  body.querySelectorAll('.event-share-choice input').forEach(input => {
    input.addEventListener('change', () => {
      body.querySelectorAll('.event-share-choice').forEach(label => {
        label.classList.toggle('selected', label.querySelector('input')?.checked);
      });
      ensureShareGroupSelection();
    });
  });

  if (!isEdit || !event?.recurringId) {
    const recSel = body.querySelector('#ev-recurring');
    const recEndWrap = body.querySelector('#ev-recurring-end-wrap');
    const startLabel = body.querySelector('#ev-recurring-start-label');
    const refreshRecurringStartLabel = () => {
      if (startLabel) startLabel.textContent = evStart.date ? formatPickerDate(evStart.date) : '開始日未設定';
    };
    recSel?.addEventListener('change', () => {
      recEndWrap.classList.toggle('hidden', !recSel.value);
      refreshRecurringStartLabel();
    });
  }

  body.querySelector('#ev-start-date-btn')?.addEventListener('click', () => {
    openDatePicker({
      value: evStart.date || null,
      onConfirm: d => {
        const previousStart = evStart.date && evStart.time
          ? new Date(`${evStart.date}T${evStart.time}:00`)
          : null;
        const previousEnd = evEnd.date && evEnd.time
          ? new Date(`${evEnd.date}T${evEnd.time}:00`)
          : null;
        const durationMs = previousStart && previousEnd && previousEnd > previousStart
          ? previousEnd.getTime() - previousStart.getTime()
          : null;
        evStart.date = d;
        if (durationMs != null && evStart.time) {
          const shiftedEnd = new Date(new Date(`${d}T${evStart.time}:00`).getTime() + durationMs);
          evEnd.date = toDateStr(shiftedEnd);
          evEnd.time = `${String(shiftedEnd.getHours()).padStart(2, '0')}:${String(shiftedEnd.getMinutes()).padStart(2, '0')}`;
          const endDateButton = body.querySelector('#ev-end-date-btn');
          const endTimeButton = body.querySelector('#ev-end-time-btn');
          if (endDateButton) endDateButton.textContent = formatPickerDate(evEnd.date);
          if (endTimeButton) endTimeButton.textContent = '🕐 ' + evEnd.time;
        } else if (!evEnd.date) {
          evEnd.date = d;
        }
        const b = body.querySelector('#ev-start-date-btn');
        if (b) b.textContent = formatPickerDate(d);
        const recurStart = body.querySelector('#ev-recurring-start-label');
        if (recurStart) recurStart.textContent = formatPickerDate(d);
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
      value: evRecurEnd || evStart.date || null,
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
          b.textContent = '終了日を選ぶ';
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
    onClose: () => {
      if (!modalCommitted && pendingImageUploads.size) {
        Promise.allSettled([...pendingImageUploads].map(deletePlannerImage));
      }
    },
  });

  cancelBtn.onclick = close;

  const showConflictWarning = (conflicts, onContinue) => {
    const warning = body.querySelector('#ev-conflict-warning');
    if (!warning) return false;
    warning.classList.remove('hidden');
    warning.innerHTML = `
      <div class="event-conflict-title">時間が重なっている予定があります</div>
      <ul>
        ${conflicts.map(item => `<li>${esc(item.time)} ${esc(item.title)}</li>`).join('')}
      </ul>
      <div class="event-conflict-actions">
        <button type="button" class="btn btn-ghost btn-sm" id="ev-conflict-edit">時間を直す</button>
        <button type="button" class="btn btn-primary btn-sm" id="ev-conflict-continue">それでも${isEdit ? '更新' : '追加'}</button>
      </div>
    `;
    warning.querySelector('#ev-conflict-edit')?.addEventListener('click', () => {
      warning.classList.add('hidden');
      body.querySelector('#ev-start-time-btn')?.focus();
    });
    warning.querySelector('#ev-conflict-continue')?.addEventListener('click', onContinue);
    warning.scrollIntoView({ block: 'nearest' });
    return true;
  };

  const saveEvent = async (allowOverlap = false) => {
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

    const checkedShareGroups = [...body.querySelectorAll('#ev-share-groups input[type="checkbox"]:checked')].map(input => input.value);
    const shareVisibility = body.querySelector('[name="ev-share-visibility"]:checked')?.value || 'private';
    if (shareVisibility !== 'private' && checkedShareGroups.length === 0) {
      if (hasDefaultShareGroup) checkedShareGroups.push(options.defaultShareGroupId);
      else if (shareGroups.length === 1) checkedShareGroups.push(shareGroups[0].id);
    }
    const effectiveShareGroups = shareVisibility === 'private' ? [] : [...new Set(checkedShareGroups)];
    const effectiveShareVisibility = effectiveShareGroups.length ? shareVisibility : 'private';

    const newData = {
      title,
      start: startIso,
      end: endIso,
      categoryId: catId,
      isTentative,
      isRoutine,
      memo: body.querySelector('#ev-memo')?.value?.trim() || '',
      attachments,
      shareVisibility: effectiveShareVisibility,
      sharedGroupIds: effectiveShareGroups,
      hideFromMonth: body.querySelector('#ev-hide-month')?.checked || false,
    };

    const conflicts = getEventConflicts(newData, isEdit ? event.id : '');
    if (!allowOverlap && conflicts.length) {
      showConflictWarning(conflicts, () => saveEvent(true));
      return;
    }

    saveShareDefaults(newData.shareVisibility, newData.sharedGroupIds);
    rememberEventTitle(newData);

    if (isEdit) {
      const scope = body.querySelector('[name="recurring-scope"]:checked')?.value || 'this';
      const recurType = body.querySelector('#ev-recurring')?.value || '';
      const recurEndStr = body.querySelector('#ev-recurring-end')?.value || '';
      const excludeWeekdays = [...body.querySelectorAll('.ev-recurring-weekday input:checked')]
        .map(input => Number(input.value))
        .filter(day => Number.isInteger(day) && day >= 0 && day <= 6);

      if (!event.recurringId && recurType) {
        if (!recurEndStr) {
          toast('繰り返しの終了日を選んでください', 'error');
          return;
        }
        const recurringId = generateId();
        if (!updateEvent(event.id, { ...newData, recurringId })) {
          toast('予定を保存できませんでした。入力内容は残しています', 'error');
          return;
        }
        const createdCount = createRecurringEvents(newData, recurType, recurEndStr, excludeWeekdays, { recurringId, skipFirst: true });
        if (createdCount < 0) {
          toast('繰り返し予定を保存できませんでした', 'error');
          return;
        }
        toast((createdCount + 1) + '件の繰り返し予定にしました', 'success');
      } else {
        if (scope === 'future' && event.recurringId) {
          const allEvents = getEvents();
          const startShiftMs = new Date(newData.start).getTime() - new Date(event.start).getTime();
          const nextDurationMs = newData.end
            ? Math.max(0, new Date(newData.end).getTime() - new Date(newData.start).getTime())
            : null;
          const now = new Date().toISOString();
          allEvents.forEach((e, index) => {
            if (e.id === event.id) {
              allEvents[index] = { ...e, ...newData, updatedAt: now };
              return;
            }
            if (e.recurringId === event.recurringId && e.start >= event.start) {
              const shiftedStart = new Date(new Date(e.start).getTime() + startShiftMs);
              allEvents[index] = {
                ...e,
                ...newData,
                start: shiftedStart.toISOString(),
                end: nextDurationMs == null
                  ? null
                  : new Date(shiftedStart.getTime() + nextDurationMs).toISOString(),
                updatedAt: now,
              };
            }
          });
          if (!saveEvents(allEvents)) {
            toast('予定を保存できませんでした。入力内容は残しています', 'error');
            return;
          }
        } else if (!updateEvent(event.id, newData)) {
          toast('予定を保存できませんでした。入力内容は残しています', 'error');
          return;
        }
        toast('予定を更新しました', 'success');
      }
    } else {
      const recurType = body.querySelector('#ev-recurring')?.value || '';
      const recurEndStr = body.querySelector('#ev-recurring-end')?.value || '';
      const excludeWeekdays = [...body.querySelectorAll('.ev-recurring-weekday input:checked')]
        .map(input => Number(input.value))
        .filter(day => Number.isInteger(day) && day >= 0 && day <= 6);
      if (recurType) {
        if (!recurEndStr) {
          toast('繰り返しの終了日を選んでください', 'error');
          return;
        }
        const createdCount = createRecurringEvents(newData, recurType, recurEndStr, excludeWeekdays);
        if (createdCount < 0) {
          toast('繰り返し予定を保存できませんでした。入力内容は残しています', 'error');
          return;
        }
        if (createdCount === 0) {
          toast('条件に合う繰り返し予定がありません。期間か除外曜日を見直してください', 'error');
          return;
        }
        toast(createdCount + '件の繰り返し予定を追加しました', 'success');
      } else {
        const created = addEvent(newData);
        if (!created) {
          toast('予定を保存できませんでした。入力内容は残しています', 'error');
          return;
        }
        appendSharedPreviewEvent(created);
        toast(`「${title}」を追加しました`, 'success');
      }
    }

    modalCommitted = true;
    pendingImageUploads.clear();
    const activePaths = new Set(getEvents().flatMap(item => (
      Array.isArray(item.attachments) ? item.attachments.map(media => media.path) : []
    )));
    const removablePaths = [...removedImagePaths]
      .filter(path => path && !activePaths.has(path));
    if (removablePaths.length) {
      const sync = await flushPendingSync();
      if (sync.attempted === sync.succeeded) {
        await Promise.allSettled(removablePaths.map(deletePlannerImage));
      }
    }
    close();
    redrawAfterEventChange();
  };

  saveBtn.onclick = () => saveEvent(false);
}

function createRecurringEvents(eventData, recurType, endDateStr, excludeWeekdays = [], options = {}) {
  const recurringId = options.recurringId || generateId();
  const startDate = new Date(eventData.start);
  const endDate = endDateStr ? new Date(`${endDateStr}T23:59:59.999`) : addDays(new Date(eventData.start), 90);
  const duration = eventData.end
    ? new Date(eventData.end) - startDate
    : 3600000;
  const excluded = new Set((Array.isArray(excludeWeekdays) ? excludeWeekdays : [])
    .map(Number)
    .filter(day => Number.isInteger(day) && day >= 0 && day <= 6));

  const lastDayOfMonth = (year, month) => new Date(year, month + 1, 0).getDate();
  const addMonthsClamped = (monthOffset) => {
    const targetMonthIndex = startDate.getMonth() + monthOffset;
    const targetYear = startDate.getFullYear() + Math.floor(targetMonthIndex / 12);
    const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
    return new Date(
      targetYear,
      targetMonth,
      Math.min(startDate.getDate(), lastDayOfMonth(targetYear, targetMonth)),
      startDate.getHours(),
      startDate.getMinutes(),
      startDate.getSeconds(),
      startDate.getMilliseconds()
    );
  };
  const estimateIterations = () => {
    const ms = Math.max(0, endDate - startDate);
    if (recurType === 'daily') return Math.ceil(ms / 86400000) + 2;
    if (recurType === 'weekly') return Math.ceil(ms / (86400000 * 7)) + 2;
    if (recurType === 'monthly') {
      const months = (endDate.getFullYear() - startDate.getFullYear()) * 12 + (endDate.getMonth() - startDate.getMonth());
      return Math.max(1, months + 2);
    }
    return 1;
  };

  let cursor = new Date(startDate);
  let iterations = 0;
  const pendingEvents = [];
  const maxIterations = Math.min(Math.max(estimateIterations(), 1), 5000);

  while (cursor <= endDate && iterations < maxIterations) {
    const isFirst = iterations === 0;
    if (!(options.skipFirst && isFirst) && !excluded.has(cursor.getDay())) {
      const recurringEvent = {
        ...eventData,
        id: generateId(),
        start: cursor.toISOString(),
        end: new Date(cursor.getTime() + duration).toISOString(),
        recurringId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      pendingEvents.push(recurringEvent);
    }

    if (recurType === 'daily') cursor = addDays(cursor, 1);
    else if (recurType === 'weekly') cursor = addDays(cursor, 7);
    else if (recurType === 'monthly') {
      cursor = addMonthsClamped(iterations + 1);
    } else break;

    iterations++;
  }

  if (!pendingEvents.length) return 0;
  if (!saveEvents([...getEvents(), ...pendingEvents])) return -1;
  pendingEvents.forEach(rememberEventTitle);
  return pendingEvents.length;
}

function getEventTitleSuggestions(query, excludeId = null) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const pad = n => String(n).padStart(2, '0');
  const suggestions = new Map();
  seedEventTitleHistoryFromExistingEvents();

  const addSuggestion = ({ title, startTime, endTime, categoryId = '', latest = 0, count = 1 }) => {
    const cleanTitle = String(title || '').trim();
    if (!cleanTitle || !startTime || !endTime) return;
    const hay = cleanTitle.toLowerCase();
    if (!hay.includes(q)) return;
    const key = `${hay}|${startTime}|${endTime}`;
    const prev = suggestions.get(key);
    suggestions.set(key, {
      title: cleanTitle,
      startTime,
      endTime,
      count: (prev?.count || 0) + count,
      categoryId: categoryId || prev?.categoryId || '',
      categoryName: getCategoryById(categoryId || prev?.categoryId || '')?.name || '',
      latest: Math.max(prev?.latest || 0, latest || 0),
      score: (hay.startsWith(q) ? 1000 : 0)
        + ((prev?.count || 0) + count) * 20
        + Math.min((latest || 0) / 86_400_000, 30000),
    });
  };

  getEvents().forEach(ev => {
    const title = String(ev.title || '').trim();
    if (!title || !ev.start || !ev.end || ev.id === excludeId) return;
    const hay = title.toLowerCase();
    if (!hay.includes(q)) return;

    const sd = new Date(ev.start);
    const ed = new Date(ev.end);
    if (Number.isNaN(sd.getTime()) || Number.isNaN(ed.getTime())) return;

    const startTime = `${pad(sd.getHours())}:${pad(sd.getMinutes())}`;
    const endTime = `${pad(ed.getHours())}:${pad(ed.getMinutes())}`;
    const updatedAt = new Date(ev.updatedAt || ev.createdAt || ev.start).getTime() || sd.getTime();
    addSuggestion({
      title,
      startTime,
      endTime,
      latest: updatedAt,
      count: 1,
      categoryId: ev.categoryId || '',
    });
  });

  loadEventTitleHistory().forEach(addSuggestion);

  return [...suggestions.values()]
    .sort((a, b) => (b.score - a.score) || (b.latest - a.latest) || a.title.localeCompare(b.title, 'ja'));
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
      const deleted = deleteEvent(event.id);
      if (!deleted) {
        toast('削除できませんでした。予定は保持されています', 'error');
        return;
      }
      toast('削除しました', 'success');
      closeChoice();
      closeModalGlobal();
      redrawAfterEventChange(event.id);
    };
    body.querySelector('#del-future').onclick = () => {
      const removed = deleteFutureRecurring(event.recurringId, event.start);
      if (!removed.length) {
        toast('削除できませんでした。予定は保持されています', 'error');
        return;
      }
      toast(`${removed.length}件を削除してTrashへ移動しました`, 'success');
      closeChoice();
      closeModalGlobal();
      redrawAfterEventChange(event.id);
    };
  } else {
    if (await confirmGlobal(`「${event.title}」を削除しますか？`, { danger: true, okLabel: '削除' })) {
      const deleted = deleteEvent(event.id);
      if (!deleted) {
        toast('削除できませんでした。予定は保持されています', 'error');
        return;
      }
      pushUndo({ type: 'delete_event', event: deleted });
      closeModalGlobal();
      redrawAfterEventChange(event.id);
      undoToast(`「${event.title.slice(0, 20)}」を削除しました`, () => {
        applyUndo();
        redrawAfterEventChange();
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
    const saved = addEvent({
      title: parsed.title || text,
      start: parsed.start,
      end:   parsed.end,
      categoryId:  cat.id,
      isTentative: parsed.isTentative || false,
      isRoutine:   false,
    });
    if (!saved) throw new Error('予定を端末に保存できませんでした');

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
      <span class="modal-title"></span>
      <button class="modal-close" aria-label="閉じる">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
      </button>
    </div>
    <div class="modal-body"></div>
    ${opts.footer !== null ? '<div class="modal-footer"></div>' : ''}
  `;

  modal.querySelector('.modal-title').textContent = String(opts.title || '');
  modal.querySelector('.modal-body').appendChild(opts.body);
  if (opts.footer && modal.querySelector('.modal-footer')) {
    modal.querySelector('.modal-footer').appendChild(opts.footer);
  }

  overlay.appendChild(modal);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    overlay.classList.add('hidden');
    overlay.innerHTML = '';
    document.removeEventListener('keydown', keyH);
    opts.onClose?.();
  };

  modal.querySelector('.modal-close').onclick = close;
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  const keyH = e => { if (e.key === 'Escape') close(); };
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
    const messageEl = document.createElement('p');
    messageEl.style.cssText = 'font-size:15px;line-height:1.6';
    messageEl.textContent = String(message || '');
    body.appendChild(messageEl);

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
