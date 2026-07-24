// ============================================================
// storage.js — localStorage wrapper + data models
// ============================================================

import { generateId } from './utils.js';

const KEY = {
  EVENTS:    'mp_events',
  TASKS:     'mp_tasks',
  GOALS:     'mp_goals',
  CATS:      'mp_categories',
  SETS:      'mp_settings',
  CACHE:     'mp_ai_cache',
  AI_QUEUE:  'mp_pending_ai',   // items waiting for AI processing
  BATCH_CFG: 'mp_batch_config', // batch AI schedule settings
  AI_RUNTIME:'mp_ai_runtime',
};

const USER_CONTENT_KEYS = [
  KEY.EVENTS,
  KEY.TASKS,
  KEY.GOALS,
  KEY.CATS,
  KEY.CACHE,
  KEY.AI_QUEUE,
  SCHED_KEY_SAFE(),
  FOCUS_LOG_KEY_SAFE(),
  HABIT_LOG_KEY_SAFE(),
  ENERGY_INSIGHT_KEY_SAFE(),
  MONTHLY_REPORT_KEY_SAFE(),
  REVIEW_KEY_SAFE(),
  KNOWLEDGE_KEY_SAFE(),
  REVIEW_LOG_KEY_SAFE(),
  ARCHIVE_KEY_SAFE(),
  TRASH_KEY_SAFE(),
  TAGS_KEY_SAFE(),
  HABITS_KEY_SAFE(),
  HABIT_DONE_KEY_SAFE(),
  'mp_shared_calendar_groups',
  'mp_calendar_share_defaults',
  'mp_calendar_event_title_history',
  'mp_task_tag_defaults',
];

function SCHED_KEY_SAFE() { return 'mp_schedule'; }
function FOCUS_LOG_KEY_SAFE() { return 'mp_focus_logs'; }
function HABIT_LOG_KEY_SAFE() { return 'mp_habit_logs'; }
function ENERGY_INSIGHT_KEY_SAFE() { return 'mp_energy_insight'; }
function MONTHLY_REPORT_KEY_SAFE() { return 'mp_monthly_reports'; }
function REVIEW_KEY_SAFE() { return 'mp_reviews'; }
function KNOWLEDGE_KEY_SAFE() { return 'mp_knowledge'; }
function REVIEW_LOG_KEY_SAFE() { return 'mp_knowledge_review_log'; }
function ARCHIVE_KEY_SAFE() { return 'mp_task_archive'; }
function TRASH_KEY_SAFE() { return 'mp_trash'; }
function TAGS_KEY_SAFE() { return 'mp_tags'; }
function HABITS_KEY_SAFE() { return 'mp_habits2'; }
function HABIT_DONE_KEY_SAFE() { return 'mp_habit2_done'; }

// ---- Sync hooks (wired by sync.js at startup) ----
// storage.js は sync.js を import しない (循環防止)
// sync.js 側が registerSyncHook / registerSyncDeleteHook で登録する

let _syncHook       = null; // (tableKey: string) => void
let _syncDeleteHook = null; // ({ table, id?, name? }) => void

export function registerSyncHook(fn)       { _syncHook       = fn; }
export function registerSyncDeleteHook(fn) { _syncDeleteHook = fn; }

function _notifySync(tableKey) {
  if (_syncHook) _syncHook(tableKey);
}
function _notifyDelete(payload) {
  if (_syncDeleteHook) _syncDeleteHook(payload);
}

export const DEFAULT_CATEGORIES = [
  { id: 'research', name: '研究',  color: '#32D49A' },
  { id: 'job',      name: '就活',  color: '#9B8FF0' },
  { id: 'partime',  name: 'バイト', color: '#F5C542' },
  { id: 'play',     name: '遊び',  color: '#F07090' },
  { id: 'other',    name: 'その他', color: '#8B83E8' },
];

export const DEFAULT_ACCENT_RGB = { r: 255, g: 255, b: 255 };
export const DEFAULT_THEME_TUNING = {
  toneLevel: 0,
  cardContrast: 50,
  glowIntensity: 35,
  accentVividness: 45,
};

// ---- Primitive helpers ----

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw !== null ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.error('Storage write failed:', e);
    try {
      document.dispatchEvent(new CustomEvent('storage:write-error', { detail: { key } }));
    } catch {}
    return false;
  }
}

// ---- Events ----

export function getEvents() { return load(KEY.EVENTS, []); }
export function saveEvents(events) {
  if (!save(KEY.EVENTS, events)) return false;
  _notifySync('events');
  return true;
}

export function addEvent(ev) {
  const events = getEvents();
  const now = new Date().toISOString();
  const newEv = {
    memo: '',
    tags: [],
    ...ev,
    id: ev.id || generateId(),
    createdAt: ev.createdAt || now,
    updatedAt: now,
  };
  events.push(newEv);
  saveEvents(events);
  return newEv;
}

export function updateEvent(id, updates) {
  const events = getEvents();
  const idx = events.findIndex(e => e.id === id);
  if (idx < 0) return null;
  events[idx] = { ...events[idx], ...updates, updatedAt: new Date().toISOString() };
  saveEvents(events);
  return events[idx];
}

export function deleteEvent(id) {
  const events = getEvents();
  const target = events.find(e => e.id === id);
  if (!target) return null;
  if (!addTrashItem({ entityType: 'event', payload: target, title: target.title })) return null;
  if (!saveEvents(events.filter(e => e.id !== id))) return null;
  _notifyDelete({ table: 'events', id });
  return target;
}

export function deleteFutureRecurring(recurringId, fromDateISO) {
  if (!recurringId) return [];
  const from = new Date(fromDateISO);
  if (Number.isNaN(from.getTime())) return [];

  const events = getEvents();
  const removed = events.filter(e =>
    e.recurringId === recurringId && new Date(e.start) >= from
  );
  if (!removed.length) return [];

  const backedUp = removed.every(event => (
    !!addTrashItem({ entityType: 'event', payload: event, title: event.title })
  ));
  if (!backedUp) return [];
  if (!saveEvents(events.filter(e =>
    e.recurringId !== recurringId || new Date(e.start) < from
  ))) return [];
  removed.forEach(e => _notifyDelete({ table: 'events', id: e.id }));
  return removed;
}

// ---- Tasks ----

export function getTasks() { return load(KEY.TASKS, []); }
export function saveTasks(tasks) {
  if (!save(KEY.TASKS, tasks)) return false;
  _notifySync('tasks');
  return true;
}

export function addTask(task) {
  const tasks = getTasks();
  const nextSortOrder = tasks.reduce((max, item) => {
    const value = Number(item?.sortOrder);
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, -1) + 1;
  const newTask = {
    title: '',
    weight: 'medium',
    completed: false,
    completedAt: null,
    abandoned: false,
    abandonedAt: null,
    dueDate: null,
    dueTime: null,
    estimatedMinutes: null,
    goalId: null,
    recurrence: null, // { freq: 'daily'|'weekdays'|'weekly'|'monthly' } | null
    subtasks: [],     // [{ id, title, completed, createdAt }]
    memo: '',         // free-form text memo
    tags: [],         // string array
    highlightColor: null,
    sortOrder: nextSortOrder,
    ...task,
    id: task.id || generateId(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  tasks.push(newTask);
  saveTasks(tasks);
  return newTask;
}

export function updateTask(id, updates) {
  const tasks = getTasks();
  const idx = tasks.findIndex(t => t.id === id);
  if (idx < 0) return null;
  const now = new Date().toISOString();
  const prev = tasks[idx];
  // Auto-set completedAt when completing
  const extra = {};
  if (updates.completed === true  && !prev.completed)  extra.completedAt  = now;
  if (updates.completed === false && prev.completed)   extra.completedAt  = null;
  if (updates.abandoned === true  && !prev.abandoned)  extra.abandonedAt  = now;
  if (updates.abandoned === false && prev.abandoned)   extra.abandonedAt  = null;
  tasks[idx] = { ...prev, ...updates, ...extra, updatedAt: now };
  saveTasks(tasks);

  // 繰り返しタスク: 完了時に次のインスタンスを自動生成
  if (updates.completed === true && !prev.completed && prev.recurrence) {
    const nextDue = calcNextDueDate(prev.dueDate, prev.recurrence);
    if (nextDue) {
      const seriesId = prev.recurrence.seriesId || prev.id;
      const nextRecurrence = {
        ...prev.recurrence,
        seriesId,
        spawnedFromId: prev.id,
      };
      const alreadyCreated = tasks.some(task =>
        task.id !== prev.id
        && !task.completed
        && task.dueDate === nextDue
        && (task.recurrence?.seriesId || task.id) === seriesId
      );
      const { id: _id, createdAt: _c, updatedAt: _u, completedAt: _ca, completed: _co, ...rest } = prev;
      if (!alreadyCreated) {
        addTask({ ...rest, recurrence: nextRecurrence, dueDate: nextDue, completed: false, completedAt: null });
      }
    }
  }

  return tasks[idx];
}

export function deleteTask(id) {
  const tasks = getTasks();
  const target = tasks.find(t => t.id === id);
  if (!target) return null;
  if (!addTrashItem({ entityType: 'task', payload: target, title: target.title })) return null;
  if (!saveTasks(tasks.filter(t => t.id !== id))) return null;
  _notifyDelete({ table: 'tasks', id });
  return target;
}

/** 完了済みタスクを一括削除 */
export function deleteCompletedTasks() {
  const tasks = getTasks();
  const completed = tasks.filter(task => task.completed);
  const backedUp = completed.every(task => (
    !!addTrashItem({ entityType: 'task', payload: task, title: task.title })
  ));
  if (!backedUp) return 0;
  if (!saveTasks(tasks.filter(task => !task.completed))) return 0;
  completed.forEach(task => _notifyDelete({ table: 'tasks', id: task.id }));
  return completed.length;
}

/** タスクの順序を変更（ドラッグ&ドロップ用）*/
export function reorderTask(draggedId, targetId) {
  const tasks = getTasks();
  const from  = tasks.findIndex(t => t.id === draggedId);
  const to    = tasks.findIndex(t => t.id === targetId);
  if (from < 0 || to < 0 || from === to) return;
  const [moved] = tasks.splice(from, 1);
  tasks.splice(to, 0, moved);
  const now = new Date().toISOString();
  tasks.forEach((task, index) => {
    task.sortOrder = index;
    task.updatedAt = now;
  });
  saveTasks(tasks);
}

/** 繰り返しタスクの次の日付を計算 */
function calcNextDueDate(currentDueDate, recurrence) {
  if (!recurrence || !recurrence.freq) return null;
  const base = currentDueDate
    ? new Date(`${currentDueDate}T00:00:00`)
    : new Date();
  const next = new Date(base);
  switch (recurrence.freq) {
    case 'daily':    next.setDate(next.getDate() + 1); break;
    case 'weekdays': {
      next.setDate(next.getDate() + 1);
      while ([0, 6].includes(next.getDay())) next.setDate(next.getDate() + 1);
      break;
    }
    case 'weekly':   next.setDate(next.getDate() + 7); break;
    case 'monthly': {
      const day = next.getDate();
      next.setDate(1);
      next.setMonth(next.getMonth() + 1);
      const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
      next.setDate(Math.min(day, lastDay));
      break;
    }
    default: return null;
  }
  return toDateStr_simple(next);
}

// ---- Goals ----

export function getGoals() { return load(KEY.GOALS, []); }
export function saveGoals(goals) {
  if (!save(KEY.GOALS, goals)) return false;
  _notifySync('goals');
  return true;
}

export function addGoal(goal) {
  const goals = getGoals();
  const now = new Date().toISOString();
  const newGoal = {
    title: '',
    type: 'weekly',
    targetDate: null,
    progress: 0,
    description: '',
    ...goal,
    id: goal.id || generateId(),
    createdAt: now,
    updatedAt: now,
  };
  goals.push(newGoal);
  saveGoals(goals);
  return newGoal;
}

export function updateGoal(id, updates) {
  const goals = getGoals();
  const idx = goals.findIndex(g => g.id === id);
  if (idx < 0) return null;
  goals[idx] = { ...goals[idx], ...updates, updatedAt: new Date().toISOString() };
  saveGoals(goals);
  return goals[idx];
}

export function deleteGoal(id) {
  const goals = getGoals();
  const target = goals.find(goal => goal.id === id);
  if (!target) return null;
  if (!addTrashItem({ entityType: 'goal', payload: target, title: target.title })) return null;
  if (!saveGoals(goals.filter(goal => goal.id !== id))) return null;
  _notifyDelete({ table: 'goals', id });
  return target;
}

// ---- Categories ----

export function getCategories() { return load(KEY.CATS, DEFAULT_CATEGORIES); }
export function saveCategories(cats) { save(KEY.CATS, cats); }

export function getCategoryById(id) {
  return getCategories().find(c => c.id === id)
    || DEFAULT_CATEGORIES.find(c => c.id === id)
    || DEFAULT_CATEGORIES[4]; // fallback to 'other'
}

export function getCategoryColor(id) {
  return getCategoryById(id)?.color || '#6b7280';
}

// ---- Settings ----

const DEFAULT_SETTINGS = {
  apiKey: '',
  theme: 'light',
  aiEnabled: false,
  myScheduleColor: '#60A5FA',
  accentRgb: DEFAULT_ACCENT_RGB,
  themeTuning: DEFAULT_THEME_TUNING,
};
const DEFAULT_AI_RUNTIME = {
  provider: 'gemini',
  mode: 'server',
  configured: false,
  limits: null,
  usage: null,
  checkedAt: 0,
  message: '',
};

export function getSettings() { return { ...DEFAULT_SETTINGS, ...load(KEY.SETS, {}) }; }
export function saveSettings(s) { save(KEY.SETS, { ...getSettings(), ...s }); }

export function getApiKey() { return getSettings().apiKey || ''; }
export function getAiRuntime() {
  const runtime = { ...DEFAULT_AI_RUNTIME, ...load(KEY.AI_RUNTIME, {}) };
  return { ...runtime, limits: null, usage: null };
}
export function saveAiRuntime(patch) {
  const runtime = { ...getAiRuntime(), ...patch };
  save(KEY.AI_RUNTIME, { ...runtime, limits: null, usage: null });
}
export function isAiAvailable() {
  const settings = getSettings();
  const runtime = getAiRuntime();
  return settings.aiEnabled === true && runtime.configured === true;
}
export function getMyScheduleColor() { return getSettings().myScheduleColor || DEFAULT_SETTINGS.myScheduleColor; }

// ---- AI Result Cache ----

export function getAiCache(key) {
  const cache = load(KEY.CACHE, {});
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() > entry.exp) {
    delete cache[key];
    save(KEY.CACHE, cache);
    return null;
  }
  return entry.val;
}

export function setAiCache(key, val, ttlMs = 86_400_000) {
  const cache = load(KEY.CACHE, {});
  cache[key] = { val, exp: Date.now() + ttlMs };
  save(KEY.CACHE, cache);
}

export function clearAiCache() {
  save(KEY.CACHE, {});
}

// ---- Pending AI Queue ----
// Items awaiting AI processing (created offline or in batch mode)
// Shape: { id, type, title, queuedAt }
// type: 'memo_tags'

export function getPendingAIQueue() {
  return load(KEY.AI_QUEUE, []);
}

export function addToPendingAIQueue(item) {
  const queue = getPendingAIQueue();
  // Deduplicate by id+type
  if (queue.some(q => q.id === item.id && q.type === item.type)) return;
  queue.push({ ...item, queuedAt: new Date().toISOString() });
  save(KEY.AI_QUEUE, queue);
}

export function removeFromPendingAIQueue(id, type) {
  const queue = getPendingAIQueue().filter(q => !(q.id === id && q.type === type));
  save(KEY.AI_QUEUE, queue);
}

export function clearPendingAIQueue() {
  save(KEY.AI_QUEUE, []);
}

// ---- Batch AI Settings ----
// { aiMode: 'immediate'|'batch', batchEnabled: bool, batchTime: 'HH:MM' }

export function getBatchSettings() {
  return load(KEY.BATCH_CFG, {
    aiMode:       'immediate', // 'immediate' | 'batch'
    batchEnabled: false,
    batchTime:    '22:00',
  });
}

export function saveBatchSettings(patch) {
  const current = getBatchSettings();
  save(KEY.BATCH_CFG, { ...current, ...patch });
}

// ---- マイスケジュール (personal daily schedule items) ----

const SCHED_KEY = 'mp_schedule';

export function getScheduleItems() { return load(SCHED_KEY, []); }
export function saveScheduleItems(items) {
  if (!save(SCHED_KEY, items)) return false;
  _notifySync('schedule_items');
  return true;
}

export function addScheduleItem(item) {
  const items = getScheduleItems();
  const now = new Date().toISOString();
  const newItem = {
    title: '',
    startTime: '09:00',
    endTime: '10:00',
    date: null, // null = every day, 'YYYY-MM-DD' = specific day only
    ...item,
    id: item.id || generateId(),
    createdAt: item.createdAt || now,
    updatedAt: now,
  };
  items.push(newItem);
  saveScheduleItems(items);
  return newItem;
}

export function updateScheduleItem(id, updates) {
  const items = getScheduleItems();
  const idx = items.findIndex(i => i.id === id);
  if (idx < 0) return null;
  items[idx] = { ...items[idx], ...updates, updatedAt: new Date().toISOString() };
  saveScheduleItems(items);
  return items[idx];
}

export function deleteScheduleItem(id) {
  const items = getScheduleItems();
  const target = items.find(item => item.id === id);
  if (!target) return null;
  if (!addTrashItem({ entityType: 'schedule', payload: target, title: target.title })) return null;
  if (!saveScheduleItems(items.filter(item => item.id !== id))) return null;
  _notifyDelete({ table: 'schedule_items', id });
  return target;
}

export function getScheduleItemsForDate(dateStr) {
  return getScheduleItems().filter(i => !i.date || i.date === dateStr);
}

// ---- Focus Logs (Energy Pattern) ----
// Shape: [{id, taskId, taskTitle, focusLevel:'high'|'medium'|'low', hour:0-23, dayOfWeek:0-6, timestamp}]
const FOCUS_LOG_KEY = 'mp_focus_logs';
export function getFocusLogs()           { return load(FOCUS_LOG_KEY, []); }
export function saveFocusLogs(logs)      { save(FOCUS_LOG_KEY, logs); }
export function addFocusLog(entry) {
  const logs = getFocusLogs();
  const newEntry = { ...entry, id: entry.id || generateId(), timestamp: new Date().toISOString() };
  logs.push(newEntry);
  // keep last 60 days
  const cutoff = Date.now() - 60 * 86400000;
  saveFocusLogs(logs.filter(l => new Date(l.timestamp).getTime() > cutoff));
  return newEntry; // return so caller can store ID for undo
}

export function removeFocusLogById(id) {
  saveFocusLogs(getFocusLogs().filter(l => l.id !== id));
}

/** Remove all focus logs for a task added after a given ISO timestamp (for undo) */
export function removeFocusLogsAfter(taskId, afterIso) {
  const t = afterIso ? new Date(afterIso).getTime() : 0;
  saveFocusLogs(getFocusLogs().filter(l =>
    !(l.taskId === taskId && new Date(l.timestamp).getTime() >= t)
  ));
}
export function getFocusLogsForDays(days) {
  const cutoff = Date.now() - days * 86400000;
  return getFocusLogs().filter(l => new Date(l.timestamp).getTime() > cutoff);
}

// ---- Habit Logs (sleep, exercise per day) ----
// Shape: { 'YYYY-MM-DD': { sleep: number, exercise: boolean, note: '' } }
const HABIT_LOG_KEY = 'mp_habit_logs';
export function getHabitLogs()                    { return load(HABIT_LOG_KEY, {}); }
export function getHabitLogForDate(dateStr)        { return getHabitLogs()[dateStr] || null; }
export function setHabitLog(dateStr, data) {
  const logs = getHabitLogs();
  logs[dateStr] = { ...logs[dateStr], ...data };
  save(HABIT_LOG_KEY, logs);
}

// ---- Energy Insight Cache (AI-generated) ----
const ENERGY_INSIGHT_KEY = 'mp_energy_insight';
export function getEnergyInsight()    { return load(ENERGY_INSIGHT_KEY, null); }
export function setEnergyInsight(d)   { save(ENERGY_INSIGHT_KEY, d); }

// ---- Monthly Reports ----
const MONTHLY_REPORT_KEY = 'mp_monthly_reports';
export function getMonthlyReport(yyyymm)        { return (load(MONTHLY_REPORT_KEY, {}))[yyyymm] || null; }
export function setMonthlyReport(yyyymm, report) {
  const all = load(MONTHLY_REPORT_KEY, {});
  all[yyyymm] = { ...report, generatedAt: new Date().toISOString() };
  save(MONTHLY_REPORT_KEY, all);
}

// ---- Spaced Repetition Review Schedule ----
// Shape: { [memoId]: { nextReview:'YYYY-MM-DD', stage:0-6, lastReview:'YYYY-MM-DD' } }
const REVIEW_KEY = 'mp_reviews';

export const STAGE_COUNT     = 7;
export const MASTERY_STAGE   = STAGE_COUNT - 1; // 6
export const REVIEW_DISABLED_STAGE = -1;
export const STAGE_INTERVALS = [1, 3, 7, 14, 30, 60, 90]; // base days per stage

// Rating-based intervals (days) indexed by new stage [0-6]
const RATING_INTERVALS = {
  //        s0  s1  s2   s3   s4   s5   s6
  again:  [  1,  2,  3,   5,   7,  14,  21 ],
  hard:   [  1,  3,  7,  14,  30,  60,  90 ],
  good:   [  3,  7, 14,  30,  60,  90, 120 ],
  easy:   [  7, 14, 30,  60,  90, 120, 180 ],
};

// Stage delta per rating (easy = +1 stage but with longer interval than good)
const STAGE_DELTA = { again: -2, hard: 0, good: +1, easy: +1 };

export function getReviewSchedule()              { return load(REVIEW_KEY, {}); }
export function saveReviewSchedule(schedule) {
  if (!save(REVIEW_KEY, schedule)) return false;
  _notifySync('review_schedule');
  return true;
}
export function scheduleFirstReview(memoId) {
  const schedule = getReviewSchedule();
  if (schedule[memoId]) return;
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  schedule[memoId] = { stage: 0, nextReview: toDateStr_simple(tomorrow), lastReview: null };
  saveReviewSchedule(schedule);
}

export function isMemoReviewEnabled(memoId) {
  return getReviewSchedule()[memoId]?.stage !== REVIEW_DISABLED_STAGE;
}

export function setMemoReviewEnabled(memoId, enabled) {
  if (!memoId) return null;
  const schedule = getReviewSchedule();
  if (!enabled) {
    schedule[memoId] = {
      stage: REVIEW_DISABLED_STAGE,
      nextReview: null,
      lastReview: schedule[memoId]?.lastReview || null,
    };
  } else if (schedule[memoId]?.stage === REVIEW_DISABLED_STAGE || !schedule[memoId]) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    schedule[memoId] = {
      stage: 0,
      nextReview: toDateStr_simple(tomorrow),
      lastReview: null,
    };
  }
  saveReviewSchedule(schedule);
  return schedule[memoId];
}

export function rateReview(memoId, rating) {
  const schedule = getReviewSchedule();
  const entry = schedule[memoId];
  if (entry?.stage === REVIEW_DISABLED_STAGE) return;
  const stage = entry?.stage ?? 0;
  if (stage >= MASTERY_STAGE && rating !== 'again') return;
  const delta    = STAGE_DELTA[rating] ?? 1;
  const newStage = Math.max(0, Math.min(stage + delta, MASTERY_STAGE));
  const interval = RATING_INTERVALS[rating][newStage];
  const next = new Date();
  next.setDate(next.getDate() + interval);
  schedule[memoId] = {
    stage: newStage, interval,
    nextReview: newStage >= MASTERY_STAGE ? '9999-12-31' : toDateStr_simple(next),
    lastReview: toDateStr_simple(new Date()),
  };
  saveReviewSchedule(schedule);
}

export function previewReviewIntervals(memoId) {
  const entry = getReviewEntry(memoId);
  const stage = entry?.stage ?? 0;
  return {
    again: RATING_INTERVALS.again[Math.max(0, stage + STAGE_DELTA.again)],
    hard:  RATING_INTERVALS.hard[Math.min(stage, MASTERY_STAGE)],
    good:  RATING_INTERVALS.good[Math.min(stage + STAGE_DELTA.good, MASTERY_STAGE)],
    easy:  RATING_INTERVALS.easy[Math.min(stage + STAGE_DELTA.easy, MASTERY_STAGE)],
  };
}

export function setReviewStage(memoId, stage) {
  const schedule = getReviewSchedule();
  const newStage = Math.max(0, Math.min(stage, MASTERY_STAGE));
  const next = new Date();
  next.setDate(next.getDate() + STAGE_INTERVALS[newStage]);
  schedule[memoId] = {
    lastReview: null,              // default for new entries, overridden by spread below
    ...(schedule[memoId] || {}),
    stage: newStage,
    interval: STAGE_INTERVALS[newStage],
    nextReview: newStage >= MASTERY_STAGE ? '9999-12-31' : toDateStr_simple(next),
  };
  saveReviewSchedule(schedule);
}

export function getReviewsForDate(dateStr) {
  const schedule = getReviewSchedule();
  return Object.entries(schedule)
    .filter(([, v]) => v.stage >= 0 && v.nextReview && v.nextReview <= dateStr && v.stage < MASTERY_STAGE)
    .map(([memoId, v]) => ({ memoId, ...v }));
}
function toDateStr_simple(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ---- Knowledge Memos ----
// Block shape: { id, type, text, color, collapsed, children }
// Memo shape:  { id, title, blocks, tags, starred, url, summary, createdAt, updatedAt }

const KNOWLEDGE_KEY = 'mp_knowledge';
const TERM_KEY      = 'mp_terms';
const EXPRESSION_ATLAS_TAG = '__expression_atlas__';
const EXPRESSION_ATLAS_BLOCK_TYPE = 'nuance-data';

function getAllKnowledgeRecords() {
  const records = load(KNOWLEDGE_KEY, []);
  return Array.isArray(records) ? records : [];
}

function isExpressionAtlasRecord(record) {
  return Array.isArray(record?.tags)
    && record.tags.includes(EXPRESSION_ATLAS_TAG)
    && Array.isArray(record.blocks)
    && record.blocks.some(block => block?.type === EXPRESSION_ATLAS_BLOCK_TYPE);
}

function expressionRecordToEntry(record) {
  const data = record?.blocks?.find(block => block?.type === EXPRESSION_ATLAS_BLOCK_TYPE)?.data;
  if (!data || typeof data !== 'object') return null;
  return {
    ...data,
    id: record.id,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function expressionEntryKey(entry) {
  return [
    String(entry?.language || '').trim().toLocaleLowerCase(),
    String(entry?.category || '').trim().toLocaleLowerCase(),
    String(entry?.topic || '').trim().toLocaleLowerCase(),
    String(entry?.term || '').trim().toLocaleLowerCase(),
  ].join('|');
}

function expressionEntryToRecord(entry, existing = null) {
  const now = new Date().toISOString();
  const id = entry.id || existing?.id || generateId();
  const data = {
    promptVersion: 1,
    language: 'English',
    category: '',
    topic: '',
    term: '',
    partOfSpeech: '',
    coreMeaningJa: '',
    nuanceJa: '',
    register: '',
    intensity: '',
    emotionalToneJa: '',
    useCasesJa: [],
    collocations: [],
    examples: [],
    comparisons: [],
    cautionsJa: [],
    personalNote: '',
    ...entry,
  };
  delete data.id;
  delete data.createdAt;
  delete data.updatedAt;
  return {
    id,
    title: data.term,
    summary: data.coreMeaningJa || data.nuanceJa || '',
    blocks: [{ id: `${id}-nuance`, type: EXPRESSION_ATLAS_BLOCK_TYPE, data }],
    tags: [EXPRESSION_ATLAS_TAG],
    starred: false,
    url: '',
    createdAt: existing?.createdAt || entry.createdAt || now,
    updatedAt: now,
  };
}

export function getKnowledgeMemos() {
  return getAllKnowledgeRecords().filter(record => !isExpressionAtlasRecord(record));
}

export function saveKnowledgeMemos(memos) {
  const currentAtlas = getAllKnowledgeRecords().filter(isExpressionAtlasRecord);
  const incoming = Array.isArray(memos) ? memos : [];
  const incomingAtlas = incoming.filter(isExpressionAtlasRecord);
  const atlasById = new Map(currentAtlas.map(record => [record.id, record]));
  incomingAtlas.forEach(record => atlasById.set(record.id, record));
  const next = [
    ...incoming.filter(record => !isExpressionAtlasRecord(record)),
    ...atlasById.values(),
  ];
  if (!save(KNOWLEDGE_KEY, next)) return false;
  _notifySync('knowledge_memos');
  return true;
}

export function getExpressionEntries() {
  return getAllKnowledgeRecords()
    .filter(isExpressionAtlasRecord)
    .map(expressionRecordToEntry)
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

export function saveExpressionEntries(entries) {
  const regularMemos = getKnowledgeMemos();
  const existingById = new Map(
    getAllKnowledgeRecords()
      .filter(isExpressionAtlasRecord)
      .map(record => [record.id, record])
  );
  const records = (Array.isArray(entries) ? entries : [])
    .filter(entry => entry && String(entry.term || '').trim())
    .map(entry => expressionEntryToRecord(entry, existingById.get(entry.id)));
  if (!save(KNOWLEDGE_KEY, [...regularMemos, ...records])) return false;
  _notifySync('knowledge_memos');
  return true;
}

export function addExpressionEntries(entries) {
  const current = getExpressionEntries();
  const byKey = new Map(current.map(entry => [expressionEntryKey(entry), entry]));
  const saved = [];
  (Array.isArray(entries) ? entries : []).forEach(entry => {
    if (!String(entry?.term || '').trim()) return;
    const existing = byKey.get(expressionEntryKey(entry));
    const merged = existing
      ? { ...existing, ...entry, id: existing.id, personalNote: existing.personalNote || entry.personalNote || '' }
      : { ...entry, id: entry.id || generateId() };
    byKey.set(expressionEntryKey(merged), merged);
    saved.push(merged);
  });
  return saveExpressionEntries([...byKey.values()]) ? saved : [];
}

export function updateExpressionEntry(id, updates) {
  const entries = getExpressionEntries();
  const index = entries.findIndex(entry => entry.id === id);
  if (index < 0) return null;
  entries[index] = { ...entries[index], ...updates, id };
  return saveExpressionEntries(entries) ? entries[index] : null;
}

export function deleteExpressionEntry(id) {
  const allRecords = getAllKnowledgeRecords();
  const target = allRecords.find(record => record.id === id && isExpressionAtlasRecord(record));
  if (!target) return false;
  if (!save(KNOWLEDGE_KEY, allRecords.filter(record => record.id !== id))) return false;
  _notifyDelete({ table: 'knowledge_memos', id });
  return true;
}

export function getKnowledgeMemoById(id) {
  return getKnowledgeMemos().find(m => m.id === id) || null;
}

export function addKnowledgeMemo(memo) {
  const memos = getKnowledgeMemos();
  const now = new Date().toISOString();
  const newMemo = {
    title: '', blocks: [], tags: [], starred: false, url: '', summary: '',
    ...memo,
    id: memo.id || generateId(),
    createdAt: now,
    updatedAt: now,
  };
  memos.unshift(newMemo); // newest first
  saveKnowledgeMemos(memos);
  return newMemo;
}

export function updateKnowledgeMemo(id, updates) {
  const memos = getKnowledgeMemos();
  const idx   = memos.findIndex(m => m.id === id);
  if (idx < 0) return null;
  memos[idx] = { ...memos[idx], ...updates, updatedAt: new Date().toISOString() };
  saveKnowledgeMemos(memos);
  return memos[idx];
}

export function deleteKnowledgeMemo(id) {
  const memos = getKnowledgeMemos();
  const target = memos.find(m => m.id === id);
  if (!target) return null;
  const schedule = getReviewSchedule();
  if (!addTrashItem({
    entityType: 'memo',
    payload: { ...target, __reviewEntry: schedule[id] || null },
    title: target.title,
  })) return null;
  if (!saveKnowledgeMemos(memos.filter(m => m.id !== id))) return null;
  if (schedule[id]) {
    delete schedule[id];
    if (saveReviewSchedule(schedule)) {
      _notifyDelete({ table: 'review_schedule', id });
    }
  }
  _notifyDelete({ table: 'knowledge_memos', id });
  return target;
}

// ---- Trash ----
const TRASH_KEY = 'mp_trash';

export function getTrashItems() {
  return load(TRASH_KEY, []);
}

export function saveTrashItems(items) {
  if (!save(TRASH_KEY, items)) return false;
  _notifySync('trash_items');
  return true;
}

export function addTrashItem({ entityType, payload, title }) {
  if (!entityType || !payload) return null;
  const items = getTrashItems();
  const stableId = `${entityType}:${payload.id || generateId()}`;
  const existingIdx = items.findIndex(entry => entry.id === stableId);
  const item = {
    id: stableId,
    entityType,
    entityId: payload.id || null,
    title: title || payload.title || 'Untitled',
    deletedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    payload,
  };
  if (existingIdx >= 0) items.splice(existingIdx, 1);
  items.unshift(item);
  if (!saveTrashItems(items)) return null;
  return item;
}

export function removeTrashItem(id) {
  const items = getTrashItems();
  const target = items.find(item => item.id === id);
  if (!target) return null;
  if (!saveTrashItems(items.filter(item => item.id !== id))) return null;
  _notifyDelete({ table: 'trash_items', id: target.id });
  return target;
}

export function removeTrashItemByEntity(entityType, entityId) {
  if (!entityType || !entityId) return;
  const items = getTrashItems();
  const removed = items.filter(item => item.entityType === entityType && item.entityId === entityId);
  if (!removed.length) return [];
  if (!saveTrashItems(items.filter(item => !(item.entityType === entityType && item.entityId === entityId)))) return [];
  removed.forEach(item => _notifyDelete({ table: 'trash_items', id: item.id }));
  return removed;
}

export function restoreTrashItem(id) {
  const items = getTrashItems();
  const item = items.find(entry => entry.id === id);
  if (!item) return null;
  const payload = normalizeTrashPayload(item.payload);
  const entityId = item.entityId || payload?.id || null;
  if (!payload || !entityId) return null;
  let restored = false;

  if (item.entityType === 'task') {
    const tasks = getTasks();
    if (!tasks.find(t => t.id === entityId)) {
      const restoredAt = new Date().toISOString();
      const wasArchived = !!payload.archivedAt;
      tasks.push({
        ...payload,
        id: entityId,
        archivedAt: wasArchived ? null : payload.archivedAt,
        completedAt: wasArchived && payload.completed ? restoredAt : payload.completedAt,
        updatedAt: restoredAt,
      });
      tasks.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
      restored = saveTasks(tasks);
    } else restored = true;
  } else if (item.entityType === 'event') {
    const events = getEvents();
    if (!events.find(e => e.id === entityId)) {
      events.push({ ...payload, id: entityId, updatedAt: new Date().toISOString() });
      restored = saveEvents(events);
    } else restored = true;
  } else if (item.entityType === 'memo') {
    const memos = getKnowledgeMemos();
    if (!memos.find(m => m.id === entityId)) {
      const { __reviewEntry, ...memoPayload } = payload;
      const restoredMemo = {
        title: '', blocks: [], tags: [], starred: false, url: '', summary: '',
        ...memoPayload,
        id: entityId,
        updatedAt: new Date().toISOString(),
      };
      restored = saveKnowledgeMemos([restoredMemo, ...memos]);

      if (restored) {
        const schedule = getReviewSchedule();
        if (__reviewEntry) {
          schedule[entityId] = __reviewEntry;
          saveReviewSchedule(schedule);
        } else if (!schedule[entityId]) {
          scheduleFirstReview(entityId);
        }
      }
    } else restored = true;
  } else if (item.entityType === 'goal') {
    const goals = getGoals();
    if (!goals.find(goal => goal.id === entityId)) {
      restored = saveGoals([...goals, { ...payload, id: entityId, updatedAt: new Date().toISOString() }]);
    } else restored = true;
  } else if (item.entityType === 'schedule') {
    const scheduleItems = getScheduleItems();
    if (!scheduleItems.find(scheduleItem => scheduleItem.id === entityId)) {
      restored = saveScheduleItems([
        ...scheduleItems,
        { ...payload, id: entityId, updatedAt: new Date().toISOString() },
      ]);
    } else restored = true;
  } else {
    return null;
  }

  if (!restored) return null;
  removeTrashItem(id);
  return item;
}

function normalizeTrashPayload(payload) {
  if (!payload) return null;
  if (typeof payload === 'object') return payload;
  if (typeof payload !== 'string') return null;
  try {
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function deleteTrashItemsByMonth(yyyymm) {
  const items = getTrashItems();
  const removed = items.filter(item => item.deletedAt && item.deletedAt.slice(0, 7) === yyyymm);
  saveTrashItems(items.filter(item => !item.deletedAt || item.deletedAt.slice(0, 7) !== yyyymm));
  removed.forEach(item => _notifyDelete({ table: 'trash_items', id: item.id }));
}

// ---- Knowledge Review Log ----
// Shape: [{ memoId: 'id', date: 'YYYY-MM-DD', tags: ['tag1', 'tag2'] }]
const REVIEW_LOG_KEY = 'mp_knowledge_review_log';

export function getReviewLog() { return load(REVIEW_LOG_KEY, []); }

export function addReviewLog(memoId, tags) {
  const log = getReviewLog();
  log.push({ memoId, date: toDateStr_simple(new Date()), tags: tags || [] });
  if (log.length > 500) log.splice(0, log.length - 500);
  save(REVIEW_LOG_KEY, log);
}

// ---- Term explanation cache (persistent) ----

export function getTermCache() { return load(TERM_KEY, {}); }

export function getTermExplanation(term) {
  return getTermCache()[term.toLowerCase().trim()] || null;
}

export function setTermExplanation(term, explanation) {
  const cache = getTermCache();
  cache[term.toLowerCase().trim()] = explanation;
  save(TERM_KEY, cache);
}

// ---- Task Archive ----
// Completed tasks older than the retention window are moved here by autoArchiveTasks()
const ARCHIVE_KEY = 'mp_task_archive';
const ARCHIVE_AFTER_DAYS = 7;

export function getArchivedTasks()         { return load(ARCHIVE_KEY, []); }
export function saveArchivedTasks(tasks) {
  if (!save(ARCHIVE_KEY, tasks)) return false;
  _notifySync('tasks_archive');
  return true;
}

/** Move completed tasks older than ARCHIVE_AFTER_DAYS to the archive store */
export function autoArchiveTasks() {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - ARCHIVE_AFTER_DAYS);
  const active   = load(KEY.TASKS, []);
  const toArchive = [];
  const remaining = [];
  const archivedAt = new Date().toISOString();

  active.forEach(t => {
    if (t.completed && t.completedAt && new Date(t.completedAt) < cutoff) {
      toArchive.push({ ...t, archivedAt, updatedAt: archivedAt });
    } else {
      remaining.push(t);
    }
  });

  if (toArchive.length) {
    const archive = getArchivedTasks();
    if (!saveArchivedTasks([...archive, ...toArchive])) return 0;
    if (!save(KEY.TASKS, remaining)) return 0;
  }
  return toArchive.length;
}

/** Delete all archived tasks for a given YYYY-MM month */
export function deleteArchivedByMonth(yyyymm) {
  const archived = getArchivedTasks();
  const removed = archived.filter(t => t.archivedAt?.slice(0, 7) === yyyymm);
  const backedUp = removed.every(task => (
    !!addTrashItem({ entityType: 'task', payload: task, title: task.title })
  ));
  if (!backedUp) return 0;
  if (!saveArchivedTasks(archived.filter(t => !t.archivedAt || t.archivedAt.slice(0, 7) !== yyyymm))) return 0;
  removed.forEach(task => _notifyDelete({ table: 'tasks', id: task.id }));
  return removed.length;
}

// ---- Subtasks ----

export function addSubtask(taskId, title) {
  const tasks = getTasks();
  const idx   = tasks.findIndex(t => t.id === taskId);
  if (idx < 0) return null;
  const subtask = { id: generateId(), title: title.trim(), completed: false, createdAt: new Date().toISOString() };
  tasks[idx].subtasks = [...(tasks[idx].subtasks || []), subtask];
  tasks[idx].updatedAt = new Date().toISOString();
  saveTasks(tasks);
  return subtask;
}

export function updateSubtask(taskId, subtaskId, changes) {
  const tasks = getTasks();
  const idx   = tasks.findIndex(t => t.id === taskId);
  if (idx < 0) return null;
  const subs = tasks[idx].subtasks || [];
  const si   = subs.findIndex(s => s.id === subtaskId);
  if (si < 0) return null;
  subs[si] = { ...subs[si], ...changes };
  tasks[idx].subtasks  = subs;
  tasks[idx].updatedAt = new Date().toISOString();
  saveTasks(tasks);
  return subs[si];
}

export function deleteSubtask(taskId, subtaskId) {
  const tasks = getTasks();
  const idx   = tasks.findIndex(t => t.id === taskId);
  if (idx < 0) return;
  tasks[idx].subtasks  = (tasks[idx].subtasks || []).filter(s => s.id !== subtaskId);
  tasks[idx].updatedAt = new Date().toISOString();
  saveTasks(tasks);
}

// ---- Global Tags ----
const TAGS_KEY = 'mp_tags';

export function getTags()             { return load(TAGS_KEY, []); }
export function saveTags(tags) {
  if (!save(TAGS_KEY, tags)) return false;
  _notifySync('tags');
  return true;
}

export function addTag(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return;
  const tags = getTags();
  if (!tags.includes(trimmed)) {
    tags.push(trimmed);
    tags.sort();
    saveTags(tags);
  }
  return trimmed;
}

export function deleteTag(name) {
  const tags = getTags();
  if (!tags.includes(name)) return false;
  if (!saveTags(tags.filter(tag => tag !== name))) return false;
  _notifyDelete({ table: 'tags', name });
  return true;
}

// ---- Review entry getter (for knowledge memo display) ----
export function getReviewEntry(memoId) {
  return getReviewSchedule()[memoId] || null;
}

// ---- Backup / Restore ----

export function exportBackup() {
  const { apiKey: _, ...safeSettings } = getSettings();
  return JSON.stringify({
    version: 4,
    exportedAt: new Date().toISOString(),
    events: getEvents(),
    tasks: getTasks(),
    goals: getGoals(),
    categories: getCategories(),
    settings: safeSettings,
    memos: getKnowledgeMemos(),
    expressionEntries: getExpressionEntries(),
    trash: getTrashItems(),
    habits: getHabits(),
    habitDone: load(HABIT_DONE_KEY, {}),
    focusLogs: getFocusLogs(),
  }, null, 2);
}

export function importBackup(jsonStr) {
  const data = JSON.parse(jsonStr);
  if (data.events)    saveEvents(data.events);
  if (data.tasks)     saveTasks(data.tasks);
  if (data.goals)     saveGoals(data.goals);
  if (data.categories) saveCategories(data.categories);
  if (data.memos)     saveKnowledgeMemos(data.memos);
  if (data.expressionEntries) addExpressionEntries(data.expressionEntries);
  if (data.trash)     saveTrashItems(data.trash);
  if (data.habits)    saveHabits(data.habits);
  if (data.habitDone) save(HABIT_DONE_KEY, data.habitDone);
  if (data.focusLogs) saveFocusLogs(data.focusLogs);
  // don't overwrite API key on import
}

export function clearUserContentLocal() {
  USER_CONTENT_KEYS.forEach(key => {
    try { localStorage.removeItem(key); } catch {}
  });
}

// ---- Habits (streak-based habit tracker) ----
// Habit shape: { id, title, icon, freq:'daily'|'weekdays'|'weekly', color, streak, createdAt }
// Done shape:  { [habitId]: ['YYYY-MM-DD', ...] }

const HABITS_KEY    = 'mp_habits2';
const HABIT_DONE_KEY = 'mp_habit2_done';

export function getHabits()          { return load(HABITS_KEY, []); }
export function saveHabits(h)        { save(HABITS_KEY, h); }

export function addHabit(h) {
  const habits = getHabits();
  const newHabit = {
    title: '', icon: '⭐', freq: 'daily', color: '#32D49A', streak: 0,
    ...h,
    id: generateId(),
    createdAt: new Date().toISOString(),
  };
  habits.push(newHabit);
  saveHabits(habits);
  return newHabit;
}

export function updateHabit(id, updates) {
  saveHabits(getHabits().map(h => h.id === id ? { ...h, ...updates } : h));
}

export function deleteHabit(id) {
  saveHabits(getHabits().filter(h => h.id !== id));
  const done = load(HABIT_DONE_KEY, {});
  delete done[id];
  save(HABIT_DONE_KEY, done);
}

export function getHabitDoneMap()    { return load(HABIT_DONE_KEY, {}); }

export function isHabitDoneToday(habitId) {
  const todayStr = toDateStr_simple(new Date());
  return (getHabitDoneMap()[habitId] || []).includes(todayStr);
}

/** 今日の完了をトグル。true=完了→未完了, false=未完了→完了 */
export function toggleHabitToday(habitId) {
  const todayStr = toDateStr_simple(new Date());
  const done = getHabitDoneMap();
  const dates = done[habitId] || [];
  const wasDone = dates.includes(todayStr);
  done[habitId] = wasDone
    ? dates.filter(d => d !== todayStr)
    : [...dates, todayStr].sort();
  save(HABIT_DONE_KEY, done);
  // Recompute streak
  const streak = _calcStreak(done[habitId] || []);
  updateHabit(habitId, { streak });
  return !wasDone; // new state: true = now done
}

function _calcStreak(dates) {
  if (!dates.length) return 0;
  let streak = 0;
  const check = new Date();
  // If not done today, start checking from yesterday
  if (!dates.includes(toDateStr_simple(check))) check.setDate(check.getDate() - 1);
  while (dates.includes(toDateStr_simple(check))) {
    streak++;
    check.setDate(check.getDate() - 1);
  }
  return streak;
}

/** 直近 N 日の完了履歴 [{date, done}] */
export function getHabitHistory(habitId, days = 14) {
  const done = getHabitDoneMap()[habitId] || [];
  return Array.from({ length: days }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (days - 1 - i));
    const ds = toDateStr_simple(d);
    return { date: ds, done: done.includes(ds) };
  });
}

// ---- Undo Stack (in-memory — cleared on page reload) ----
// Action shapes:
//   { type:'delete_task',  task }
//   { type:'complete_task', taskId, wasCompleted, completedAt }
//   { type:'delete_event', event }
//   { type:'delete_memo',  memo }

const _undo = [];
const UNDO_MAX = 15;

export function pushUndo(action) {
  _undo.push(action);
  if (_undo.length > UNDO_MAX) _undo.shift();
}

export function popUndo() {
  return _undo.length ? _undo.pop() : null;
}

export function hasUndo() {
  return _undo.length > 0;
}

/** Perform the undo. Returns the action type string or null. */
export function applyUndo() {
  const action = popUndo();
  if (!action) return null;

  if (action.type === 'delete_task') {
    const tasks = getTasks();
    if (!tasks.find(t => t.id === action.task.id)) {
      tasks.push(action.task);
      tasks.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      saveTasks(tasks);
    }
    removeTrashItemByEntity('task', action.task.id);
  } else if (action.type === 'complete_task') {
    updateTask(action.taskId, { completed: action.wasCompleted, completedAt: action.completedAt ?? null });
    if (!action.wasCompleted) {
      const completedAt = new Date(action.completedAt || 0).getTime();
      const spawned = getTasks().filter(task => {
        const createdAt = new Date(task.createdAt || 0).getTime();
        return !task.completed
          && task.recurrence?.spawnedFromId === action.taskId
          && (!Number.isFinite(completedAt) || createdAt >= completedAt);
      });
      if (spawned.length) {
        const spawnedIds = new Set(spawned.map(task => task.id));
        saveTasks(getTasks().filter(task => !spawnedIds.has(task.id)));
        spawned.forEach(task => _notifyDelete({ table: 'tasks', id: task.id }));
      }
    }
    removeFocusLogsAfter(action.taskId, action.completedAt);
  } else if (action.type === 'delete_event') {
    const events = getEvents();
    if (!events.find(e => e.id === action.event.id)) {
      events.push(action.event);
      saveEvents(events);
    }
    removeTrashItemByEntity('event', action.event.id);
  } else if (action.type === 'delete_memo') {
    const memos = getKnowledgeMemos();
    if (!memos.find(m => m.id === action.memo.id)) {
      memos.push(action.memo);
      saveKnowledgeMemos(memos);
    }
    removeTrashItemByEntity('memo', action.memo.id);
  }

  return action.type;
}
