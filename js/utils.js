// ============================================================
// utils.js — Date helpers, formatting, misc utilities
// ============================================================

export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// HTML escaping
export function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---- Date utilities ----

export function today() {
  return toDateStr(new Date());
}

export function tomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return toDateStr(d);
}

/** Returns YYYY-MM-DD */
export function toDateStr(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Returns HH:MM */
export function toTimeStr(date) {
  const d = new Date(date);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Returns value suitable for datetime-local input (in LOCAL time) */
export function toDateTimeLocal(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d)) return '';
  const y  = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${dd}T${hh}:${mm}`;
}

/** Parses datetime-local value to ISO string */
export function fromDateTimeLocal(str) {
  if (!str) return '';
  return new Date(str).toISOString();
}

/** YYYY-MM-DD → Date object (local midnight) */
export function parseDate(str) {
  if (!str) return null;
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function sameDay(a, b) {
  const da = new Date(a), db = new Date(b);
  return da.getFullYear() === db.getFullYear()
    && da.getMonth() === db.getMonth()
    && da.getDate() === db.getDate();
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function startOfWeek(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function startOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function endOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

/** Get this week's start and end (Sun–Sat) */
export function thisWeekRange() {
  const start = startOfWeek();
  const end = addDays(start, 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/** This month range */
export function thisMonthRange() {
  const start = startOfMonth();
  const end = endOfMonth();
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

// ---- Formatting ----

const WEEKDAYS_SHORT = ['日', '月', '火', '水', '木', '金', '土'];

export function formatDate(dateOrStr, style = 'short') {
  const d = new Date(dateOrStr);
  if (isNaN(d)) return '';
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const wd = WEEKDAYS_SHORT[d.getDay()];

  if (style === 'short') return `${m}/${day}(${wd})`;
  if (style === 'medium') return `${y}年${m}月${day}日(${wd})`;
  if (style === 'month') return `${y}年${m}月`;
  if (style === 'ymd') return `${y}/${m}/${day}`;
  return `${m}/${day}`;
}

export function formatTime(isoStr) {
  if (!isoStr) return '';
  // Special sentinel for "end of day" display in multi-day events
  if (typeof isoStr === 'string' && isoStr.includes('T24:00')) return '24:00';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Get events for a specific date, including multi-day events.
 * Returns events with _displayStart/_displayEnd properties for multi-day cases.
 * Middle days of 3+ day spans are marked _isAllDay = true.
 */
export function getEventsForDate(events, dateStr) {
  return events
    .filter(ev => {
      if (!ev.start) return false;
      const sd = toDateStr(new Date(ev.start));
      const ed = ev.end ? _effectiveEventEndDateStr(ev) : sd;
      return sd <= dateStr && ed >= dateStr;
    })
    .map(ev => _clampEventForDay(ev, dateStr))
    .sort((a, b) => (a._displayStart || a.start || '').localeCompare(b._displayStart || b.start || ''));
}

function _effectiveEventEndDateStr(ev) {
  if (!ev.end) return toDateStr(new Date(ev.start));
  const startDateStr = toDateStr(new Date(ev.start));
  const end = new Date(ev.end);
  if (isNaN(end.getTime())) return startDateStr;

  const endsAtMidnight =
    end.getHours() === 0 &&
    end.getMinutes() === 0 &&
    end.getSeconds() === 0 &&
    end.getMilliseconds() === 0;

  if (endsAtMidnight) {
    const endDateStr = toDateStr(end);
    if (endDateStr > startDateStr) {
      const previousDay = new Date(end);
      previousDay.setDate(previousDay.getDate() - 1);
      return toDateStr(previousDay);
    }
  }

  return toDateStr(end);
}

function _clampEventForDay(ev, dateStr) {
  if (!ev.end) return ev;
  const sd = toDateStr(new Date(ev.start));
  const actualEd = toDateStr(new Date(ev.end));
  const ed = _effectiveEventEndDateStr(ev);
  if (sd === actualEd) return ev; // same-day, no clamping needed

  const isFirst  = sd === dateStr;
  const isLast   = ed === dateStr;
  const isMiddle = !isFirst && !isLast;

  if (isMiddle) {
    return { ...ev, _multiDay: true, _isAllDay: true };
  }
  if (isFirst) {
    // Show: original start → 24:00
    return { ...ev, _multiDay: true, _isFirstDay: true,
             _displayStart: ev.start, _displayEnd: `${dateStr}T24:00:00` };
  }
  // Last day: 0:00 → original end
  return { ...ev, _multiDay: true, _isLastDay: true,
           _displayStart: `${dateStr}T00:00:00`, _displayEnd: ev.end };
}

export function getGreeting() {
  const h = new Date().getHours();
  if (h < 5) return 'おやすみなさい 🌙';
  if (h < 10) return 'おはようございます ☀️';
  if (h < 17) return 'こんにちは 🌤';
  if (h < 21) return 'こんばんは 🌆';
  return 'お疲れさまです 🌙';
}

// ---- Event generation for recurring events ----

/**
 * Given a master recurring event, generate all instances between start and end dates.
 * Instances list in storage should just be individual events with recurringId set.
 * This is used if you want on-the-fly generation (not used in this v1 — we store individually).
 */
export function getRecurringInstances(masterEvent, windowStart, windowEnd) {
  const instances = [];
  if (!masterEvent.recurring) return instances;

  const { type, days, endDate } = masterEvent.recurring;
  const until = endDate ? new Date(endDate) : windowEnd;
  let cursor = new Date(masterEvent.start);

  while (cursor <= until && cursor <= windowEnd) {
    if (cursor >= windowStart) {
      const duration = new Date(masterEvent.end) - new Date(masterEvent.start);
      instances.push({
        ...masterEvent,
        id: `${masterEvent.id}_${toDateStr(cursor)}`,
        start: cursor.toISOString(),
        end: new Date(cursor.getTime() + duration).toISOString(),
        isMasterInstance: false,
      });
    }
    if (type === 'daily') {
      cursor = addDays(cursor, 1);
    } else if (type === 'weekly') {
      cursor = addDays(cursor, 7);
    } else if (type === 'monthly') {
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate(),
        cursor.getHours(), cursor.getMinutes());
    } else {
      break;
    }
  }
  return instances;
}

// ---- Debounce ----
export function debounce(fn, ms = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
