// ============================================================
// utils.js - 日付計算・表示整形・HTML安全化など、画面間で共有する小さな関数
//
// 特定画面の状態や保存処理は持たせない。ここへ置く関数は副作用を少なくし、
// カレンダー・タスク・AI解析で同じ日付ルールを共有できるようにする。
// ============================================================

/** 端末内データ用の衝突しにくい短いIDを生成する。 */
export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// HTML escaping
/** ユーザー文字列をHTMLへ埋め込む前に特殊文字を無害化する。 */
export function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---- Date utilities ----

/** 端末のローカル日付を`YYYY-MM-DD`で返す。UTC日付へずれるのを避けるためtoISOStringは使わない。 */
export function today() {
  return toDateStr(new Date());
}

/** 端末の今日を一日進め、ローカル日付の`YYYY-MM-DD`で返す。 */
export function tomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return toDateStr(d);
}

/** Dateまたは変換可能な値を、端末のタイムゾーンにおける`YYYY-MM-DD`へ整形する。 */
export function toDateStr(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Dateまたは変換可能な値から、端末のローカル時刻を24時間制`HH:MM`で返す。 */
export function toTimeStr(date) {
  const d = new Date(date);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * 「10時半」「午後3時」「夜10時半」など、入力に明記された時刻をすべて抽出する。
 * 時間帯がなければ勝手に午前・午後を推測せず、「夜」等がある場合だけ24時間制へ補正する。
 */
export function parseJapaneseTimes(input) {
  const value = String(input || '').normalize('NFKC');
  const pattern = /(?:(午前|午後|朝|昼|夕方|夜)\s*の?\s*)?(\d{1,2})(?::(\d{1,2})|時(?:(\d{1,2})分|(半))?)/g;
  const times = [];
  let match;

  while ((match = pattern.exec(value)) !== null) {
    const period = match[1] || '';
    let hour = Number(match[2]);
    const minute = match[3] !== undefined
      ? Number(match[3])
      : match[4] !== undefined
        ? Number(match[4])
        : match[5]
          ? 30
          : 0;

    if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) continue;

    if (['午後', '昼', '夕方', '夜'].includes(period) && hour < 12) hour += 12;
    if (['午前', '朝'].includes(period) && hour === 12) hour = 0;
    if (hour < 0 || hour > 23) continue;

    times.push(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
  }

  return times;
}

/** ISO日時を、`datetime-local`入力欄へ設定できる端末時刻の文字列へ変換する。 */
export function toDateTimeLocal(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d)) return '';
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${dd}T${hh}:${mm}`;
}

/** `datetime-local`入力値を端末時刻として解釈し、保存用のUTC ISO文字列へ変換する。 */
export function fromDateTimeLocal(str) {
  if (!str) return '';
  return new Date(str).toISOString();
}

/** `YYYY-MM-DD`をUTCではなく端末の午前0時としてDateへ変換する。 */
export function parseDate(str) {
  if (!str) return null;
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** 二つの日付を端末時刻へ直し、時刻部分を無視して同じ年月日か判定する。 */
export function sameDay(a, b) {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear()
    && da.getMonth() === db.getMonth()
    && da.getDate() === db.getDate();
}

/** 元のDateを変更せず複製し、カレンダー上の日数を加えた新しいDateを返す。 */
export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

/** 指定日を含む週の日曜日午前0時を返す。このアプリの週表示は日曜始まり。 */
export function startOfWeek(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** 指定日と同じ年月の1日午前0時を返す。 */
export function startOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** 翌月0日というDateの繰り上がり規則を使い、指定月の最終日を返す。 */
export function endOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

/** 端末の今日を含む日曜0時から土曜23:59:59.999までの範囲を返す。 */
export function thisWeekRange() {
  const start = startOfWeek();
  const end = addDays(start, 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/** 端末の今月について、1日0時から最終日23:59:59.999までの範囲を返す。 */
export function thisMonthRange() {
  const start = startOfMonth();
  const end = endOfMonth();
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

// ---- Formatting ----

const WEEKDAYS_SHORT = ['\u65e5', '\u6708', '\u706b', '\u6c34', '\u6728', '\u91d1', '\u571f'];

/** 日付を短縮・年月付き・月見出し等、指定styleの日本語表示へ整形する。 */
export function formatDate(dateOrStr, style = 'short') {
  const d = new Date(dateOrStr);
  if (isNaN(d)) return '';
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const wd = WEEKDAYS_SHORT[d.getDay()];

  if (style === 'short') return `${m}/${day}(${wd})`;
  if (style === 'medium') return `${y}\u5e74${m}\u6708${day}\u65e5(${wd})`;  
  if (style === 'month') return `${y}\u5e74${m}\u6708`;  
  if (style === 'ymd') return `${y}/${m}/${day}`;
  return `${m}/${day}`;
}

/** ISO日時を端末時刻の`HH:MM`へ変換する。日末表現`T24:00`だけは24:00を保持する。 */
export function formatTime(isoStr) {
  if (!isoStr) return '';
  if (typeof isoStr === 'string' && isoStr.includes('T24:00')) return '24:00';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * 指定日に重なる予定を抽出し、その日だけを描画する開始・終了情報を付けて時刻順に返す。
 * 複数日予定の中間日は終日扱い、初日・最終日は元の時刻を保つ。
 */
export function getEventsForDate(events, dateStr) {
  return events
    .filter((ev) => {
      if (!ev.start) return false;
      const sd = toDateStr(new Date(ev.start));
      const ed = ev.end ? _effectiveEventEndDateStr(ev) : sd;
      return sd <= dateStr && ed >= dateStr;
    })
    .map((ev) => _clampEventForDay(ev, dateStr))
    .sort((a, b) => (a._displayStart || a.start || '').localeCompare(b._displayStart || b.start || ''));
}

/**
 * 日をまたぐ予定が実際に占有する最終日を返す。
 * 翌日0時ちょうどで終わる予定は、空の翌日を含めず前日までとして扱う。
 */
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

/** 複数日予定を一日分の表示へ切り分け、初日・中間日・最終日の印を付けたコピーを返す。 */
function _clampEventForDay(ev, dateStr) {
  if (!ev.end) return ev;
  const sd = toDateStr(new Date(ev.start));
  const actualEd = toDateStr(new Date(ev.end));
  const ed = _effectiveEventEndDateStr(ev);
  if (sd === actualEd) return ev;

  const isFirst = sd === dateStr;
  const isLast = ed === dateStr;
  const isMiddle = !isFirst && !isLast;

  if (isMiddle) {
    return { ...ev, _multiDay: true, _isAllDay: true };
  }
  if (isFirst) {
    return {
      ...ev,
      _multiDay: true,
      _isFirstDay: true,
      _displayStart: ev.start,
      _displayEnd: `${dateStr}T24:00:00`,
    };
  }
  return {
    ...ev,
    _multiDay: true,
    _isLastDay: true,
    _displayStart: `${dateStr}T00:00:00`,
    _displayEnd: ev.end,
  };
}

/** 端末の現在時刻を五つの時間帯へ分け、ホームに表示する日本語の挨拶を返す。 */
export function getGreeting() {
  const h = new Date().getHours();
  if (h < 5) return '\u304a\u3084\u3059\u307f\u306a\u3055\u3044';
  if (h < 10) return '\u304a\u306f\u3088\u3046\u3054\u3056\u3044\u307e\u3059';
  if (h < 17) return '\u3053\u3093\u306b\u3061\u306f';
  if (h < 21) return '\u3053\u3093\u3070\u3093\u306f';
  return '\u304a\u75b2\u308c\u3055\u307e\u3067\u3059';
}

/** 挨拶と同じ時刻境界を使い、背景・アイコン選択用の英語区分を返す。 */
export function getGreetingPeriod() {
  const h = new Date().getHours();
  if (h < 5) return 'night';
  if (h < 10) return 'morning';
  if (h < 17) return 'day';
  if (h < 21) return 'evening';
  return 'night';
}

// ---- Event generation for recurring events ----

/**
 * 繰り返し元予定から、指定した表示期間に入る日次・週次・月次インスタンスを計算する。
 * 現行保存方式は各回を個別保存するため補助用途だが、元予定は変更しない。
 */
export function getRecurringInstances(masterEvent, windowStart, windowEnd) {
  const instances = [];
  if (!masterEvent.recurring) return instances;

  const { type, endDate } = masterEvent.recurring;
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
      cursor = new Date(
        cursor.getFullYear(),
        cursor.getMonth() + 1,
        cursor.getDate(),
        cursor.getHours(),
        cursor.getMinutes(),
      );
    } else {
      break;
    }
  }
  return instances;
}

// ---- Debounce ----
/** 連続呼び出しを最後の一回へまとめ、検索や保存の過剰実行を防ぐ。 */
export function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ---- SRS day formatter ----
/** 復習までの日数を、日・週・月のうち読みやすい単位へ丸めて表示する。 */
export function fmtDays(d) {
  return d === 1 ? '1日後' : d < 7 ? `${d}日後` : d < 30 ? `${Math.round(d / 7)}週後` : `${Math.round(d / 30)}ヶ月後`;
}

// ---- Days elapsed since a date string ('YYYY-MM-DD') ----
/** 指定日時から現在までの経過時間を24時間単位で切り捨てて返す。 */
export function daysSince(dateStr) {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}
