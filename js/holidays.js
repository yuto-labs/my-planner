// ============================================================
// holidays.js - Japanese public holiday lookup
// ============================================================

import { toDateStr } from './utils.js';

const YEAR_CACHE = new Map();

const SPECIAL_HOLIDAYS = {
  '2019-04-30': { name: '国民の休日', type: 'citizen' },
  '2019-05-01': { name: '天皇の即位の日', type: 'special' },
  '2019-05-02': { name: '国民の休日', type: 'citizen' },
  '2019-10-22': { name: '即位礼正殿の儀', type: 'special' },
};

export function getHolidayInfo(dateLike) {
  const dateStr = typeof dateLike === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateLike)
    ? dateLike
    : toDateStr(new Date(dateLike));
  const year = Number(dateStr.slice(0, 4));
  return getHolidayMap(year).get(dateStr) || null;
}

export function isHoliday(dateLike) {
  return !!getHolidayInfo(dateLike);
}

function getHolidayMap(year) {
  if (YEAR_CACHE.has(year)) return YEAR_CACHE.get(year);

  const map = new Map();
  addBaseHolidays(year, map);
  addCitizensHolidays(year, map);
  addSubstituteHolidays(year, map);

  for (const [dateStr, info] of Object.entries(SPECIAL_HOLIDAYS)) {
    if (Number(dateStr.slice(0, 4)) === year) map.set(dateStr, info);
  }

  YEAR_CACHE.set(year, map);
  return map;
}

function addBaseHolidays(year, map) {
  addHoliday(map, year, 1, 1, '元日');
  addHoliday(map, year, 1, nthWeekdayOfMonth(year, 0, 1, 2), '成人の日');
  addHoliday(map, year, 2, 11, '建国記念の日');

  if (year >= 2020) addHoliday(map, year, 2, 23, '天皇誕生日');
  else if (year <= 2018) addHoliday(map, year, 12, 23, '天皇誕生日');

  addHoliday(map, year, 3, vernalEquinoxDay(year), '春分の日');
  addHoliday(map, year, 4, 29, '昭和の日');
  addHoliday(map, year, 5, 3, '憲法記念日');
  addHoliday(map, year, 5, 4, 'みどりの日');
  addHoliday(map, year, 5, 5, 'こどもの日');

  if (year === 2020) {
    addHoliday(map, year, 7, 23, '海の日');
    addHoliday(map, year, 7, 24, 'スポーツの日');
    addHoliday(map, year, 8, 10, '山の日');
  } else if (year === 2021) {
    addHoliday(map, year, 7, 22, '海の日');
    addHoliday(map, year, 7, 23, 'スポーツの日');
    addHoliday(map, year, 8, 8, '山の日');
  } else {
    addHoliday(map, year, 7, nthWeekdayOfMonth(year, 6, 1, 3), '海の日');
    addHoliday(map, year, 8, 11, '山の日');
    addHoliday(map, year, 10, nthWeekdayOfMonth(year, 9, 1, 2), 'スポーツの日');
  }

  addHoliday(map, year, 9, nthWeekdayOfMonth(year, 8, 1, 3), '敬老の日');
  addHoliday(map, year, 9, autumnEquinoxDay(year), '秋分の日');
  addHoliday(map, year, 11, 3, '文化の日');
  addHoliday(map, year, 11, 23, '勤労感謝の日');
}

function addCitizensHolidays(year, map) {
  const start = new Date(year, 0, 2);
  const end = new Date(year, 11, 30);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = toDateStr(d);
    if (map.has(dateStr)) continue;
    const prev = toDateStr(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1));
    const next = toDateStr(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1));
    if (map.has(prev) && map.has(next)) {
      map.set(dateStr, { name: '国民の休日', type: 'citizen' });
    }
  }
}

function addSubstituteHolidays(year, map) {
  const holidayDates = [...map.keys()].sort();
  for (const dateStr of holidayDates) {
    const d = new Date(`${dateStr}T00:00:00`);
    if (d.getDay() !== 0) continue;
    const sub = new Date(d);
    do {
      sub.setDate(sub.getDate() + 1);
    } while (map.has(toDateStr(sub)));
    if (sub.getFullYear() === year) {
      map.set(toDateStr(sub), { name: '振替休日', type: 'substitute' });
    }
  }
}

function addHoliday(map, year, month, day, name) {
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || (date.getMonth() + 1) !== month || date.getDate() !== day) return;
  map.set(toDateStr(date), { name, type: 'holiday' });
}

function nthWeekdayOfMonth(year, monthIndex, weekday, nth) {
  const first = new Date(year, monthIndex, 1);
  const offset = (7 + weekday - first.getDay()) % 7;
  return 1 + offset + (nth - 1) * 7;
}

function vernalEquinoxDay(year) {
  if (year <= 1979) return Math.floor(20.8357 + 0.242194 * (year - 1980) - Math.floor((year - 1983) / 4));
  return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function autumnEquinoxDay(year) {
  if (year <= 1979) return Math.floor(23.2588 + 0.242194 * (year - 1980) - Math.floor((year - 1983) / 4));
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}
