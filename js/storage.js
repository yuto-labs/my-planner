// ============================================================
// storage.js — localStorage wrapper + data models
// ============================================================

import { generateId } from './utils.js';
import { withStableClassification } from './atlas-model.js';

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
  'mp_sync_pending_deletes',
  'mp_sync_recent_upserts',
  'mp_sync_status',
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
    attachments: [],
    ...ev,
    id: ev.id || generateId(),
    createdAt: ev.createdAt || now,
    updatedAt: now,
  };
  events.push(newEv);
  return saveEvents(events) ? newEv : null;
}

export function updateEvent(id, updates) {
  const events = getEvents();
  const idx = events.findIndex(e => e.id === id);
  if (idx < 0) return null;
  events[idx] = { ...events[idx], ...updates, updatedAt: new Date().toISOString() };
  return saveEvents(events) ? events[idx] : null;
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
  return saveTasks(tasks) ? newTask : null;
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
  if (!saveTasks(tasks)) return null;

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
  aiEnabled: true,
  aiVisibilityConfigured: false,
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

export function getSettings() {
  const stored = load(KEY.SETS, {});
  // Earlier builds wrote the old default (false) into settings even when the
  // user never chose to hide AI. Keep an explicit user choice respected while
  // allowing configured server AI to work after the upgrade.
  const aiEnabled = stored.aiVisibilityConfigured === true
    ? stored.aiEnabled === true
    : true;
  return { ...DEFAULT_SETTINGS, ...stored, aiEnabled };
}
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
  return saveScheduleItems(items) ? newItem : null;
}

export function updateScheduleItem(id, updates) {
  const items = getScheduleItems();
  const idx = items.findIndex(i => i.id === id);
  if (idx < 0) return null;
  items[idx] = { ...items[idx], ...updates, updatedAt: new Date().toISOString() };
  return saveScheduleItems(items) ? items[idx] : null;
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

export function replaceScheduleItems(predicate, replacements) {
  const items = getScheduleItems();
  const removed = items.filter(predicate);
  const backedUp = removed.every(item => (
    !!addTrashItem({ entityType: 'schedule', payload: item, title: item.title })
  ));
  if (!backedUp) return null;

  const now = new Date().toISOString();
  const created = replacements.map(item => ({
    title: '',
    startTime: '09:00',
    endTime: '10:00',
    date: null,
    ...item,
    id: item.id || generateId(),
    createdAt: item.createdAt || now,
    updatedAt: now,
  }));
  if (!saveScheduleItems([...items.filter(item => !predicate(item)), ...created])) return null;
  removed.forEach(item => _notifyDelete({ table: 'schedule_items', id: item.id }));
  return created;
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
const TRANSLATION_SET_BLOCK_TYPE = 'translation-set-data';
const ENGLISH_QUESTION_BLOCK_TYPE = 'english-question-data';
const LEARNING_LIBRARY_TAG = '__learning_library__';
const LEARNING_ENTRY_BLOCK_TYPE = 'learning-entry-data';
const APP_MEDIA_PREFS_TAG = '__app_media_preferences__';
const APP_MEDIA_PREFS_BLOCK_TYPE = 'app-media-preferences';

function getAllKnowledgeRecords() {
  const records = load(KNOWLEDGE_KEY, []);
  return Array.isArray(records) ? records : [];
}

function isExpressionAtlasRecord(record) {
  return Array.isArray(record?.tags)
    && record.tags.includes(EXPRESSION_ATLAS_TAG)
    && Array.isArray(record.blocks)
    && record.blocks.some(block => (
      block?.type === EXPRESSION_ATLAS_BLOCK_TYPE
      || block?.type === TRANSLATION_SET_BLOCK_TYPE
      || block?.type === ENGLISH_QUESTION_BLOCK_TYPE
    ));
}

function isAppMediaPreferencesRecord(record) {
  return Array.isArray(record?.tags)
    && record.tags.includes(APP_MEDIA_PREFS_TAG)
    && Array.isArray(record.blocks)
    && record.blocks.some(block => block?.type === APP_MEDIA_PREFS_BLOCK_TYPE);
}

function isLearningLibraryRecord(record) {
  return Array.isArray(record?.tags)
    && record.tags.includes(LEARNING_LIBRARY_TAG)
    && Array.isArray(record.blocks)
    && record.blocks.some(block => block?.type === LEARNING_ENTRY_BLOCK_TYPE);
}

function isInternalKnowledgeRecord(record) {
  return isExpressionAtlasRecord(record)
    || isLearningLibraryRecord(record)
    || isAppMediaPreferencesRecord(record);
}

function isNuanceRecord(record) {
  return isExpressionAtlasRecord(record)
    && record.blocks.some(block => block?.type === EXPRESSION_ATLAS_BLOCK_TYPE);
}

function isTranslationSetRecord(record) {
  return isExpressionAtlasRecord(record)
    && record.blocks.some(block => block?.type === TRANSLATION_SET_BLOCK_TYPE);
}

function isEnglishQuestionRecord(record) {
  return isExpressionAtlasRecord(record)
    && record.blocks.some(block => block?.type === ENGLISH_QUESTION_BLOCK_TYPE);
}

function expressionRecordToEntry(record) {
  const data = record?.blocks?.find(block => block?.type === EXPRESSION_ATLAS_BLOCK_TYPE)?.data;
  if (!data || typeof data !== 'object') return null;
  return withStableClassification({
    ...data,
    id: record.id,
    starred: !!record.starred,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });
}

function expressionEntryKey(entry) {
  const stable = withStableClassification(entry);
  return [
    String(stable.language || 'English').trim().toLocaleLowerCase(),
    String(stable.categoryId || stable.category || '').trim().toLocaleLowerCase(),
    String(stable.topicId || stable.topic || '').trim().toLocaleLowerCase(),
    String(stable.lemma || stable.term || '').trim().toLocaleLowerCase(),
  ].join('|');
}

function expressionHeadwordKey(entry) {
  return [
    String(entry?.language || 'English').trim().toLocaleLowerCase(),
    String(entry?.lemma || entry?.term || '').normalize('NFKC').trim().toLocaleLowerCase(),
  ].join('|');
}

const EXPRESSION_SENSE_FIELDS = [
  'senseId', 'partOfSpeech', 'coreMeaningJa', 'nuanceJa', 'nuanceTypeJa', 'register',
  'emotionalToneJa', 'useCasesJa', 'collocations', 'examples', 'comparisons',
  'cautionsJa', 'grammarNotes',
];

function expressionSenseFromEntry(entry = {}) {
  return Object.fromEntries(EXPRESSION_SENSE_FIELDS.map(field => [field, entry[field]]));
}

function normalizeSenseValue(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase();
}

function senseTokenOverlap(left, right) {
  const tokens = value => new Set(normalizeSenseValue(value).split(/[^a-z0-9]+/).filter(token => token.length > 2));
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  return [...leftTokens].some(token => rightTokens.has(token));
}

function textBigramSimilarity(left, right) {
  const normalize = value => normalizeSenseValue(value).replace(/[\s\p{P}\p{S}]/gu, '');
  const bigrams = value => {
    const text = normalize(value);
    if (text.length < 2) return new Set(text ? [text] : []);
    return new Set(Array.from({ length: text.length - 1 }, (_, index) => text.slice(index, index + 2)));
  };
  const a = bigrams(left);
  const b = bigrams(right);
  if (!a.size || !b.size) return 0;
  const shared = [...a].filter(value => b.has(value)).length;
  return (2 * shared) / (a.size + b.size);
}

function senseQueries(sense = {}) {
  return normalizedExpressionSourceQueries(sense);
}

function expressionSenses(entry = {}) {
  const stored = Array.isArray(entry.senses) ? entry.senses.filter(Boolean) : [];
  return stored.length ? stored : [
    {
      ...expressionSenseFromEntry(entry),
      sourceQueryJa: entry.sourceQueryJa || '',
      sourceQueries: entry.sourceQueries || [],
    },
  ];
}

function sameExpressionSense(existing, incoming) {
  const existingPart = normalizeSenseValue(existing?.partOfSpeech);
  const incomingPart = normalizeSenseValue(incoming?.partOfSpeech);
  if (existingPart && incomingPart && existingPart !== incomingPart) return false;

  const existingId = normalizeSenseValue(existing?.senseId);
  const incomingId = normalizeSenseValue(incoming?.senseId);
  if (existingId && incomingId && existingId === incomingId) return true;
  if (existingId && incomingId && senseTokenOverlap(existingId, incomingId)) return true;

  const existingMeaning = normalizeSenseValue(existing?.coreMeaningJa);
  const incomingMeaning = normalizeSenseValue(incoming?.coreMeaningJa);
  if (existingMeaning && incomingMeaning && (
    existingMeaning === incomingMeaning
    || textBigramSimilarity(existingMeaning, incomingMeaning) >= 0.58
  )) return true;

  // A repeated query alone does not prove that two senses are identical. It is
  // only a legacy fallback when neither response supplied a usable sense key.
  if (!existingId && !incomingId) {
    const existingQueries = senseQueries(existing);
    const incomingQueries = senseQueries(incoming);
    return [...incomingQueries].some(query => existingQueries.has(query));
  }
  return false;
}

function mergeUniqueArray(existing, incoming) {
  const values = [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])];
  const seen = new Set();
  return values.filter(value => {
    const key = stableAtlasJson(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeExpressionSense(existing = {}, incoming = {}) {
  const merged = { ...existing };
  EXPRESSION_SENSE_FIELDS.forEach(field => {
    if (field === 'grammarNotes') {
      merged.grammarNotes = {
        ...(existing.grammarNotes || {}),
        ...(incoming.grammarNotes || {}),
        usageNotes: mergeUniqueArray(existing.grammarNotes?.usageNotes, incoming.grammarNotes?.usageNotes),
        exampleForms: mergeUniqueArray(existing.grammarNotes?.exampleForms, incoming.grammarNotes?.exampleForms),
      };
    } else if (Array.isArray(existing[field]) || Array.isArray(incoming[field])) {
      merged[field] = mergeUniqueArray(existing[field], incoming[field]);
    } else if (String(incoming[field] || '').trim()) {
      const previous = String(existing[field] || '').trim();
      const next = String(incoming[field] || '').trim();
      merged[field] = next.length >= previous.length ? incoming[field] : existing[field];
    }
  });
  merged.sourceQueryJa = existing.sourceQueryJa || incoming.sourceQueryJa || '';
  merged.sourceQueries = mergeUniqueArray(
    [...(existing.sourceQueries || []), existing.sourceQueryJa].filter(Boolean),
    [...(incoming.sourceQueries || []), incoming.sourceQueryJa].filter(Boolean)
  );
  return merged;
}

function consolidateExpressionEntries(entries) {
  const groups = new Map();
  (Array.isArray(entries) ? entries : [])
    .filter(entry => entry && !entry.mergedInto)
    .forEach(entry => {
      const key = expressionHeadwordKey(entry);
      if (!key.endsWith('|')) {
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(entry);
      }
    });

  return [...groups.values()].map(group => {
    const ordered = [...group].sort((left, right) => (
      String(left.createdAt || '').localeCompare(String(right.createdAt || ''))
      || String(left.id || '').localeCompare(String(right.id || ''))
    ));
    const canonical = ordered.shift();
    const merged = ordered.reduce((result, entry) => mergeExpressionEntry(result, entry), canonical);
    return {
      ...merged,
      id: canonical.id,
      mergedEntryIds: [...new Set([
        ...(canonical.mergedEntryIds || []),
        ...ordered.flatMap(entry => [entry.id, ...(entry.mergedEntryIds || [])]),
      ].filter(id => id && id !== canonical.id))],
    };
  });
}

function mergeExpressionEntry(existing, incoming) {
  const existingSenses = expressionSenses(existing);
  const incomingSenses = expressionSenses(incoming);
  const senses = existingSenses.map(sense => ({ ...sense }));
  let primaryWasUpdated = false;

  incomingSenses.forEach(incomingSense => {
    const index = senses.findIndex(existingSense => sameExpressionSense(existingSense, incomingSense));
    if (index >= 0) {
      senses[index] = mergeExpressionSense(senses[index], incomingSense);
      if (index === 0) primaryWasUpdated = true;
    } else {
      senses.push(mergeExpressionSense({}, incomingSense));
    }
  });

  const primary = senses[0] || expressionSenseFromEntry(existing);
  const content = primaryWasUpdated ? { ...existing, ...incoming } : { ...incoming, ...existing };
  return {
    ...content,
    ...expressionSenseFromEntry(primary),
    id: existing.id,
    category: existing.category || incoming.category,
    topic: existing.topic || incoming.topic,
    categoryId: existing.categoryId || incoming.categoryId,
    topicId: existing.topicId || incoming.topicId,
    categoryAliases: mergeUniqueArray(existing.categoryAliases, incoming.categoryAliases),
    topicAliases: mergeUniqueArray(existing.topicAliases, incoming.topicAliases),
    aliases: mergeUniqueArray(existing.aliases, incoming.aliases),
    senses,
    sourceQueryJa: existing.sourceQueryJa || incoming.sourceQueryJa || '',
    sourceQueries: mergeUniqueArray(
      [...(existing.sourceQueries || []), existing.sourceQueryJa].filter(Boolean),
      [...(incoming.sourceQueries || []), incoming.sourceQueryJa].filter(Boolean)
    ),
    personalNote: existing.personalNote || incoming.personalNote || '',
  };
}

function normalizedExpressionSourceQueries(entry) {
  return new Set([
    entry?.sourceQueryJa,
    ...(Array.isArray(entry?.sourceQueries) ? entry.sourceQueries : []),
  ].map(value => String(value || '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase())
    .filter(Boolean));
}

function isRepeatedExpressionQuery(existing, incoming) {
  const existingLemma = String(existing?.lemma || existing?.term || '')
    .normalize('NFKC').trim().toLocaleLowerCase();
  const incomingLemma = String(incoming?.lemma || incoming?.term || '')
    .normalize('NFKC').trim().toLocaleLowerCase();
  if (!existingLemma || existingLemma !== incomingLemma) return false;

  const existingLanguage = String(existing?.language || 'English').trim().toLocaleLowerCase();
  const incomingLanguage = String(incoming?.language || 'English').trim().toLocaleLowerCase();
  if (existingLanguage !== incomingLanguage) return false;

  const existingQueries = normalizedExpressionSourceQueries(existing);
  const incomingQueries = normalizedExpressionSourceQueries(incoming);
  return [...incomingQueries].some(query => existingQueries.has(query));
}

function stableAtlasJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableAtlasJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => (
      `${JSON.stringify(key)}:${stableAtlasJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function atlasRecordIsUnchanged(existing, blockType, title, summary, data) {
  if (!existing) return false;
  const previousData = existing.blocks?.find(block => block?.type === blockType)?.data;
  return existing.title === title
    && existing.summary === summary
    && stableAtlasJson(previousData) === stableAtlasJson(data);
}

function expressionEntryToRecord(entry, existing = null) {
  const now = new Date().toISOString();
  const id = entry.id || existing?.id || generateId();
  const data = {
    promptVersion: 6,
    language: 'English',
    sourceQueryJa: '',
    sourceQueries: [],
    queryMode: 'japanese_concept',
    category: '',
    topic: '',
    categoryId: '',
    topicId: '',
    categoryAliases: [],
    topicAliases: [],
    classificationSource: 'legacy',
    manualClassification: false,
    term: '',
    lemma: '',
    aliases: [],
    senseId: '',
    partOfSpeech: '',
    senses: [],
    mergedInto: '',
    mergedEntryIds: [],
    etymologyJa: '',
    coreImageJa: '',
    coreMeaningJa: '',
    nuanceJa: '',
    nuanceTypeJa: '',
    register: '',
    mapMode: 'scale',
    mapAxisJa: '強さ',
    mapLowLabelJa: '控えめ',
    mapHighLabelJa: '強い',
    intensityLevel: null,
    intensityMin: null,
    intensityMax: null,
    intensity: '',
    emotionalToneJa: '',
    useCasesJa: [],
    collocations: [],
    examples: [],
    comparisons: [],
    cautionsJa: [],
    grammarNotes: {
      partOfSpeech: '',
      countability: '',
      plural: '',
      past: '',
      pastParticiple: '',
      usageNotes: [],
      exampleForms: [],
    },
    etymologyLinks: [],
    personalNote: '',
    ...withStableClassification(entry),
  };
  delete data.id;
  delete data.starred;
  delete data.createdAt;
  delete data.updatedAt;
  const fieldFallback = entry.updatedAt || existing?.updatedAt || now;
  data.fieldUpdatedAt = {
    title: data.fieldUpdatedAt?.title || fieldFallback,
    answer: data.fieldUpdatedAt?.answer || fieldFallback,
    classification: data.fieldUpdatedAt?.classification || fieldFallback,
    personalNote: data.fieldUpdatedAt?.personalNote || fieldFallback,
  };
  const title = data.term;
  const summary = data.coreMeaningJa || data.nuanceJa || '';
  const targetStarred = typeof entry.starred === 'boolean' ? entry.starred : (existing?.starred || false);
  const unchanged = atlasRecordIsUnchanged(
    existing,
    EXPRESSION_ATLAS_BLOCK_TYPE,
    title,
    summary,
    data
  ) && !!existing?.starred === targetStarred;
  return {
    id,
    title,
    summary,
    blocks: [{ id: `${id}-nuance`, type: EXPRESSION_ATLAS_BLOCK_TYPE, data }],
    tags: existing?.tags || [EXPRESSION_ATLAS_TAG],
    starred: targetStarred,
    url: existing?.url || '',
    createdAt: existing?.createdAt || entry.createdAt || now,
    updatedAt: unchanged ? (existing.updatedAt || entry.updatedAt || now) : now,
  };
}

function translationRecordToSet(record) {
  const data = record?.blocks?.find(block => block?.type === TRANSLATION_SET_BLOCK_TYPE)?.data;
  if (!data || typeof data !== 'object') return null;
  return withStableClassification({
    ...data,
    id: record.id,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });
}

function translationSetKey(set) {
  return [
    String(set?.language || 'English').trim().toLocaleLowerCase(),
    String(set?.sourceTextJa || '').trim().toLocaleLowerCase(),
  ].join('|');
}

function translationSetToRecord(set, existing = null) {
  const now = new Date().toISOString();
  const id = set.id || existing?.id || generateId();
  const data = {
    promptVersion: 3,
    language: 'English',
    sourceTextJa: '',
    contextJa: '',
    category: '',
    topic: '',
    categoryId: '',
    topicId: '',
    categoryAliases: [],
    topicAliases: [],
    classificationSource: 'legacy',
    manualClassification: false,
    summaryJa: '',
    variants: [],
    vocabularyLinks: [],
    personalNote: '',
    ...withStableClassification(set),
  };
  delete data.id;
  delete data.createdAt;
  delete data.updatedAt;
  const fieldFallback = set.updatedAt || existing?.updatedAt || now;
  data.fieldUpdatedAt = {
    content: data.fieldUpdatedAt?.content || fieldFallback,
    classification: data.fieldUpdatedAt?.classification || fieldFallback,
    personalNote: data.fieldUpdatedAt?.personalNote || fieldFallback,
  };
  const title = data.sourceTextJa;
  const summary = data.summaryJa || data.variants?.[0]?.translation || '';
  const unchanged = atlasRecordIsUnchanged(
    existing,
    TRANSLATION_SET_BLOCK_TYPE,
    title,
    summary,
    data
  );
  return {
    id,
    title,
    summary,
    blocks: [{ id: `${id}-translation`, type: TRANSLATION_SET_BLOCK_TYPE, data }],
    tags: existing?.tags || [EXPRESSION_ATLAS_TAG],
    starred: existing?.starred || false,
    url: existing?.url || '',
    createdAt: existing?.createdAt || set.createdAt || now,
    updatedAt: unchanged ? (existing.updatedAt || set.updatedAt || now) : now,
  };
}

function englishQuestionRecordToEntry(record) {
  const data = record?.blocks?.find(block => block?.type === ENGLISH_QUESTION_BLOCK_TYPE)?.data;
  if (!data || typeof data !== 'object') return null;
  return {
    ...data,
    id: record.id,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function englishQuestionToRecord(question, existing = null) {
  const now = new Date().toISOString();
  const id = question.id || existing?.id || generateId();
  const data = {
    promptVersion: 1,
    questionJa: '',
    status: 'pending',
    answer: null,
    personalNote: '',
    ...question,
  };
  delete data.id;
  delete data.createdAt;
  delete data.updatedAt;
  const fieldFallback = question.updatedAt || existing?.updatedAt || now;
  data.fieldUpdatedAt = {
    content: data.fieldUpdatedAt?.content || fieldFallback,
    personalNote: data.fieldUpdatedAt?.personalNote || fieldFallback,
  };
  const title = data.questionJa;
  const summary = data.answer?.shortAnswerJa || (data.status === 'failed' ? '回答の再試行が必要です' : 'AIの回答を待っています');
  const unchanged = atlasRecordIsUnchanged(existing, ENGLISH_QUESTION_BLOCK_TYPE, title, summary, data);
  return {
    id,
    title,
    summary,
    blocks: [{ id: `${id}-question`, type: ENGLISH_QUESTION_BLOCK_TYPE, data }],
    tags: existing?.tags || [EXPRESSION_ATLAS_TAG],
    starred: existing?.starred || false,
    url: existing?.url || '',
    createdAt: existing?.createdAt || question.createdAt || now,
    updatedAt: unchanged ? (existing.updatedAt || question.updatedAt || now) : now,
  };
}

function learningRecordToEntry(record) {
  const data = record?.blocks?.find(block => block?.type === LEARNING_ENTRY_BLOCK_TYPE)?.data;
  if (!data || typeof data !== 'object') return null;
  return {
    ...data,
    id: record.id,
    starred: !!record.starred,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function learningEntryToRecord(entry, existing = null) {
  const now = new Date().toISOString();
  const id = entry.id || existing?.id || generateId();
  const data = {
    schemaVersion: 1,
    title: '',
    originalQuestion: '',
    titleSource: 'ai',
    titleEditedByUser: false,
    status: 'complete',
    classification: {
      majorId: 'interdisciplinary',
      middleId: 'general_knowledge',
      specialty: '',
      relatedCategoryIds: [],
    },
    primaryConcept: null,
    concepts: [],
    facets: {
      periods: [],
      regions: [],
      people: [],
      organizations: [],
      works: [],
      systems: [],
    },
    answer: {
      directAnswer: [],
      sections: [],
      cautions: [],
    },
    ...entry,
  };
  delete data.id;
  delete data.starred;
  delete data.createdAt;
  delete data.updatedAt;
  const title = String(data.title || data.originalQuestion || '無題の質問').trim();
  const directText = (data.answer?.directAnswer || [])
    .map(segment => segment?.text || '')
    .join('');
  const summary = directText || String(data.originalQuestion || '').trim();
  const unchanged = atlasRecordIsUnchanged(
    existing,
    LEARNING_ENTRY_BLOCK_TYPE,
    title,
    summary,
    data
  ) && !!existing?.starred === !!entry.starred;
  return {
    id,
    title,
    summary,
    blocks: [{ id: `${id}-learning`, type: LEARNING_ENTRY_BLOCK_TYPE, data }],
    tags: existing?.tags || [LEARNING_LIBRARY_TAG],
    starred: typeof entry.starred === 'boolean' ? entry.starred : !!existing?.starred,
    url: '',
    createdAt: existing?.createdAt || entry.createdAt || now,
    updatedAt: unchanged ? (existing.updatedAt || entry.updatedAt || now) : now,
  };
}

export function getKnowledgeMemos() {
  return getAllKnowledgeRecords().filter(record => !isInternalKnowledgeRecord(record));
}

export function saveKnowledgeMemos(memos) {
  const currentInternal = getAllKnowledgeRecords().filter(isInternalKnowledgeRecord);
  const incoming = Array.isArray(memos) ? memos : [];
  const incomingInternal = incoming.filter(isInternalKnowledgeRecord);
  const internalById = new Map(currentInternal.map(record => [record.id, record]));
  incomingInternal.forEach(record => internalById.set(record.id, record));
  const next = [
    ...incoming.filter(record => !isInternalKnowledgeRecord(record)),
    ...internalById.values(),
  ];
  if (!save(KNOWLEDGE_KEY, next)) return false;
  _notifySync('knowledge_memos');
  return true;
}

export function getAppMediaPreferences() {
  const record = getAllKnowledgeRecords().find(isAppMediaPreferencesRecord);
  const data = record?.blocks?.find(block => block?.type === APP_MEDIA_PREFS_BLOCK_TYPE)?.data;
  return data && typeof data === 'object' ? { ...data } : { homeCover: null };
}

export function saveAppMediaPreferences(updates = {}) {
  const records = getAllKnowledgeRecords();
  const existing = records.find(isAppMediaPreferencesRecord);
  const now = new Date().toISOString();
  const userKey = localStorage.getItem('mp_active_user_id') || 'guest';
  const id = existing?.id || `app-media-${userKey}`;
  const previous = existing?.blocks?.find(block => block?.type === APP_MEDIA_PREFS_BLOCK_TYPE)?.data || {};
  const data = { ...previous, ...updates };
  const record = {
    id,
    title: 'App media preferences',
    summary: '',
    blocks: [{ id: `${id}-data`, type: APP_MEDIA_PREFS_BLOCK_TYPE, data }],
    tags: [APP_MEDIA_PREFS_TAG],
    starred: false,
    url: '',
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  const next = existing
    ? records.map(item => item.id === existing.id ? record : item)
    : [...records, record];
  if (!save(KNOWLEDGE_KEY, next)) return false;
  _notifySync('knowledge_memos');
  return data;
}

function getRawExpressionEntries() {
  return getAllKnowledgeRecords()
    .filter(isNuanceRecord)
    .map(expressionRecordToEntry)
    .filter(Boolean);
}

export function getExpressionEntries() {
  return consolidateExpressionEntries(getRawExpressionEntries())
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

export function saveExpressionEntries(entries) {
  const allRecords = getAllKnowledgeRecords();
  const redirects = new Map();
  (Array.isArray(entries) ? entries : []).forEach(entry => {
    (Array.isArray(entry?.mergedEntryIds) ? entry.mergedEntryIds : [])
      .filter(id => id && id !== entry.id)
      .forEach(id => redirects.set(id, entry.id));
  });
  const preservedRecords = allRecords.filter(record => !isNuanceRecord(record)).map(record => {
    const questionBlock = record.blocks?.find(block => block?.type === ENGLISH_QUESTION_BLOCK_TYPE);
    if (!questionBlock || !Array.isArray(questionBlock.data?.atlasEntryIds)) return record;
    const atlasEntryIds = [...new Set(questionBlock.data.atlasEntryIds.map(id => redirects.get(id) || id))];
    if (stableAtlasJson(atlasEntryIds) === stableAtlasJson(questionBlock.data.atlasEntryIds)) return record;
    return {
      ...record,
      blocks: record.blocks.map(block => block === questionBlock
        ? { ...block, data: { ...block.data, atlasEntryIds } }
        : block),
    };
  });
  const existingById = new Map(
    allRecords
      .filter(isNuanceRecord)
      .map(record => [record.id, record])
  );
  const primaryRecords = (Array.isArray(entries) ? entries : [])
    .filter(entry => entry && String(entry.term || '').trim())
    .map(entry => expressionEntryToRecord(entry, existingById.get(entry.id)));
  const redirectRecords = [...redirects.entries()].map(([id, mergedInto]) => {
    const existingRecord = existingById.get(id);
    const existingEntry = expressionRecordToEntry(existingRecord) || { id, term: mergedInto, lemma: mergedInto };
    return expressionEntryToRecord({
      ...existingEntry,
      id,
      mergedInto,
      fieldUpdatedAt: {
        ...(existingEntry.fieldUpdatedAt || {}),
        answer: new Date().toISOString(),
      },
    }, existingRecord);
  });
  const retainedRedirects = [...existingById.values()].filter(record => {
    const entry = expressionRecordToEntry(record);
    return entry?.mergedInto && !redirects.has(record.id) && !primaryRecords.some(item => item.id === record.id);
  });
  const records = [...primaryRecords, ...redirectRecords, ...retainedRedirects];
  if (!save(KNOWLEDGE_KEY, [...preservedRecords, ...records])) return false;
  _notifySync('knowledge_memos');
  return true;
}

export function addExpressionEntries(entries) {
  const current = getExpressionEntries();
  const saved = [];
  (Array.isArray(entries) ? entries : []).forEach(entry => {
    if (!String(entry?.term || '').trim()) return;
    const existing = current.find(candidate => expressionHeadwordKey(candidate) === expressionHeadwordKey(entry))
      || current.find(candidate => expressionEntryKey(candidate) === expressionEntryKey(entry))
      || current.find(candidate => isRepeatedExpressionQuery(candidate, entry));
    const mergedContent = existing
      ? mergeExpressionEntry(existing, entry)
      : { ...entry, id: entry.id || generateId() };
    const merged = {
      ...mergedContent,
      fieldUpdatedAt: {
        ...(mergedContent.fieldUpdatedAt || {}),
        answer: new Date().toISOString(),
      },
    };
    if (existing) current[current.findIndex(candidate => candidate.id === existing.id)] = merged;
    else current.push(merged);
    saved.push(merged);
  });
  return saveExpressionEntries(current) ? saved : [];
}

export function updateExpressionEntry(id, updates) {
  const entries = getExpressionEntries();
  const index = entries.findIndex(entry => entry.id === id);
  if (index < 0) return null;
  const now = new Date().toISOString();
  const classificationKeys = ['category', 'topic', 'categoryId', 'topicId', 'categoryAliases', 'topicAliases', 'manualClassification', 'classificationSource'];
  entries[index] = {
    ...entries[index],
    ...updates,
    id,
    fieldUpdatedAt: {
      ...(entries[index].fieldUpdatedAt || {}),
      ...(Object.prototype.hasOwnProperty.call(updates, 'personalNote') ? { personalNote: now } : {}),
      ...(classificationKeys.some(key => Object.prototype.hasOwnProperty.call(updates, key)) ? { classification: now } : {}),
      ...(Object.keys(updates).some(key => key !== 'personalNote' && !classificationKeys.includes(key)) ? { answer: now } : {}),
    },
  };
  return saveExpressionEntries(entries) ? entries[index] : null;
}

export function deleteExpressionEntry(id) {
  const allRecords = getAllKnowledgeRecords();
  const target = allRecords.find(record => record.id === id && isExpressionAtlasRecord(record));
  if (!target) return false;
  const linkedRedirectIds = allRecords
    .filter(record => isExpressionAtlasRecord(record))
    .filter(record => expressionRecordToEntry(record)?.mergedInto === id)
    .map(record => record.id);
  if (!addTrashItem({
    entityType: 'atlas',
    payload: target,
    title: target.title || 'NUANCE ATLAS',
  })) return false;
  if (!save(KNOWLEDGE_KEY, allRecords.filter(record => record.id !== id && !linkedRedirectIds.includes(record.id)))) return false;
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
  return saveKnowledgeMemos(memos) ? newMemo : null;
}

export function updateKnowledgeMemo(id, updates) {
  const memos = getKnowledgeMemos();
  const idx   = memos.findIndex(m => m.id === id);
  if (idx < 0) return null;
  memos[idx] = { ...memos[idx], ...updates, updatedAt: new Date().toISOString() };
  return saveKnowledgeMemos(memos) ? memos[idx] : null;
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

export function getTranslationSets() {
  return getAllKnowledgeRecords()
    .filter(isTranslationSetRecord)
    .map(translationRecordToSet)
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

export function getEnglishQuestions() {
  return getAllKnowledgeRecords()
    .filter(isEnglishQuestionRecord)
    .map(englishQuestionRecordToEntry)
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

export function getLearningEntries() {
  return getAllKnowledgeRecords()
    .filter(isLearningLibraryRecord)
    .map(learningRecordToEntry)
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

export function getLearningEntryById(id) {
  return getLearningEntries().find(entry => entry.id === id) || null;
}

export function saveLearningEntries(entries) {
  const records = getAllKnowledgeRecords();
  const preserved = records.filter(record => !isLearningLibraryRecord(record));
  const existingById = new Map(
    records.filter(isLearningLibraryRecord).map(record => [record.id, record])
  );
  const learningRecords = (Array.isArray(entries) ? entries : [])
    .filter(entry => entry && String(entry.originalQuestion || entry.title || '').trim())
    .map(entry => learningEntryToRecord(entry, existingById.get(entry.id)));
  if (!save(KNOWLEDGE_KEY, [...preserved, ...learningRecords])) return false;
  _notifySync('knowledge_memos');
  return true;
}

export function addLearningEntry(entry) {
  const current = getLearningEntries();
  const nextEntry = { ...entry, id: entry.id || generateId() };
  return saveLearningEntries([nextEntry, ...current]) ? nextEntry : null;
}

export function updateLearningEntry(id, updates) {
  const entries = getLearningEntries();
  const index = entries.findIndex(entry => entry.id === id);
  if (index < 0) return null;
  entries[index] = { ...entries[index], ...updates, id };
  return saveLearningEntries(entries) ? entries[index] : null;
}

export function deleteLearningEntry(id) {
  const records = getAllKnowledgeRecords();
  const target = records.find(record => record.id === id && isLearningLibraryRecord(record));
  if (!target) return false;
  if (!addTrashItem({
    entityType: 'learning',
    payload: target,
    title: target.title || 'Knowledge',
  })) return false;
  if (!save(KNOWLEDGE_KEY, records.filter(record => record.id !== id))) return false;
  _notifyDelete({ table: 'knowledge_memos', id });
  return true;
}

export function addEnglishQuestion(question) {
  const text = String(question?.questionJa || '').trim();
  if (!text) return null;
  const records = getAllKnowledgeRecords();
  const existing = records.find(record => record.id === question.id);
  const record = englishQuestionToRecord({ ...question, questionJa: text }, existing);
  const next = existing
    ? records.map(item => item.id === existing.id ? record : item)
    : [record, ...records];
  if (!save(KNOWLEDGE_KEY, next)) return null;
  _notifySync('knowledge_memos');
  return englishQuestionRecordToEntry(record);
}

export function updateEnglishQuestion(id, updates) {
  const records = getAllKnowledgeRecords();
  const existing = records.find(record => record.id === id && isEnglishQuestionRecord(record));
  if (!existing) return null;
  const current = englishQuestionRecordToEntry(existing);
  const now = new Date().toISOString();
  return addEnglishQuestion({
    ...current,
    ...updates,
    id,
    fieldUpdatedAt: {
      ...(current.fieldUpdatedAt || {}),
      ...(Object.prototype.hasOwnProperty.call(updates, 'personalNote') ? { personalNote: now } : {}),
      ...(Object.keys(updates).some(key => key !== 'personalNote') ? { content: now } : {}),
    },
  });
}

export function deleteEnglishQuestion(id) {
  const records = getAllKnowledgeRecords();
  const target = records.find(record => record.id === id && isEnglishQuestionRecord(record));
  if (!target) return false;
  if (!addTrashItem({ entityType: 'atlas', payload: target, title: target.title || '英語の疑問' })) return false;
  if (!save(KNOWLEDGE_KEY, records.filter(record => record.id !== id))) return false;
  _notifyDelete({ table: 'knowledge_memos', id });
  return true;
}

export function saveTranslationSets(sets) {
  const preservedRecords = getAllKnowledgeRecords().filter(record => !isTranslationSetRecord(record));
  const existingById = new Map(
    getAllKnowledgeRecords()
      .filter(isTranslationSetRecord)
      .map(record => [record.id, record])
  );
  const records = (Array.isArray(sets) ? sets : [])
    .filter(set => set && String(set.sourceTextJa || '').trim())
    .map(set => translationSetToRecord(set, existingById.get(set.id)));
  if (!save(KNOWLEDGE_KEY, [...preservedRecords, ...records])) return false;
  _notifySync('knowledge_memos');
  return true;
}

export function addTranslationSet(set) {
  if (!String(set?.sourceTextJa || '').trim()) return null;
  const current = getTranslationSets();
  const key = translationSetKey(set);
  const existing = current.find(item => translationSetKey(item) === key);
  const merged = existing
    ? { ...existing, ...set, id: existing.id, personalNote: existing.personalNote || set.personalNote || '' }
    : { ...set, id: set.id || generateId() };
  const next = existing
    ? current.map(item => item.id === existing.id ? merged : item)
    : [merged, ...current];
  return saveTranslationSets(next) ? merged : null;
}

export function updateTranslationSet(id, updates) {
  const sets = getTranslationSets();
  const index = sets.findIndex(set => set.id === id);
  if (index < 0) return null;
  const now = new Date().toISOString();
  const classificationKeys = ['category', 'topic', 'categoryId', 'topicId', 'categoryAliases', 'topicAliases', 'manualClassification', 'classificationSource'];
  sets[index] = {
    ...sets[index],
    ...updates,
    id,
    fieldUpdatedAt: {
      ...(sets[index].fieldUpdatedAt || {}),
      ...(Object.prototype.hasOwnProperty.call(updates, 'personalNote') ? { personalNote: now } : {}),
      ...(classificationKeys.some(key => Object.prototype.hasOwnProperty.call(updates, key)) ? { classification: now } : {}),
      ...(Object.keys(updates).some(key => key !== 'personalNote' && !classificationKeys.includes(key)) ? { content: now } : {}),
    },
  };
  return saveTranslationSets(sets) ? sets[index] : null;
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
  } else if (item.entityType === 'atlas' || item.entityType === 'learning') {
    const records = getAllKnowledgeRecords();
    if (!records.find(record => record.id === entityId)) {
      restored = save(KNOWLEDGE_KEY, [
        { ...payload, id: entityId, updatedAt: new Date().toISOString() },
        ...records,
      ]);
      if (restored) _notifySync('knowledge_memos');
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
    version: 5,
    exportedAt: new Date().toISOString(),
    events: getEvents(),
    tasks: getTasks(),
    goals: getGoals(),
    categories: getCategories(),
    settings: safeSettings,
    memos: getKnowledgeMemos(),
    expressionEntries: getExpressionEntries(),
    translationSets: getTranslationSets(),
    englishQuestions: getEnglishQuestions(),
    learningEntries: getLearningEntries(),
    appMediaPreferences: getAppMediaPreferences(),
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
  if (data.translationSets) data.translationSets.forEach(addTranslationSet);
  if (data.englishQuestions) data.englishQuestions.forEach(addEnglishQuestion);
  if (data.learningEntries) {
    const mergedLearning = new Map(getLearningEntries().map(entry => [entry.id, entry]));
    data.learningEntries.forEach(entry => {
      if (!entry?.id) return;
      const current = mergedLearning.get(entry.id);
      const currentTime = new Date(current?.updatedAt || 0).getTime() || 0;
      const importedTime = new Date(entry.updatedAt || 0).getTime() || 0;
      if (!current || importedTime >= currentTime) mergedLearning.set(entry.id, entry);
    });
    saveLearningEntries([...mergedLearning.values()]);
  }
  if (data.appMediaPreferences) saveAppMediaPreferences(data.appMediaPreferences);
  if (data.trash) {
    const mergedTrash = new Map(getTrashItems().map(item => [item.id, item]));
    data.trash.forEach(item => {
      if (!item?.id) return;
      const current = mergedTrash.get(item.id);
      const currentTime = new Date(current?.updatedAt || current?.deletedAt || 0).getTime() || 0;
      const importedTime = new Date(item.updatedAt || item.deletedAt || 0).getTime() || 0;
      if (!current || importedTime >= currentTime) mergedTrash.set(item.id, item);
    });
    saveTrashItems([...mergedTrash.values()]);
  }
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

export function hasUserContentLocal() {
  return USER_CONTENT_KEYS.some(key => {
    try {
      const value = localStorage.getItem(key);
      if (value === null) return false;
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.length > 0;
      if (parsed && typeof parsed === 'object') return Object.keys(parsed).length > 0;
      return String(parsed ?? '').trim().length > 0;
    } catch {
      return true;
    }
  });
}

const USER_SNAPSHOT_PREFIX = 'mp_user_snapshot:';
const USER_SNAPSHOT_DB = 'my-planner-user-snapshots';
const USER_SNAPSHOT_STORE = 'snapshots';

function openUserSnapshotDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(USER_SNAPSHOT_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(USER_SNAPSHOT_STORE)) {
        request.result.createObjectStore(USER_SNAPSHOT_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function writeUserSnapshot(userId, snapshot) {
  const db = await openUserSnapshotDb();
  if (!db) return false;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(USER_SNAPSHOT_STORE, 'readwrite');
    tx.objectStore(USER_SNAPSHOT_STORE).put(snapshot, userId);
    tx.oncomplete = () => { db.close(); resolve(true); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
}

async function readUserSnapshot(userId) {
  const db = await openUserSnapshotDb();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(USER_SNAPSHOT_STORE, 'readonly');
    const request = tx.objectStore(USER_SNAPSHOT_STORE).get(userId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

async function deleteUserSnapshot(userId) {
  const db = await openUserSnapshotDb();
  if (!db) return;
  await new Promise((resolve, reject) => {
    const tx = db.transaction(USER_SNAPSHOT_STORE, 'readwrite');
    tx.objectStore(USER_SNAPSHOT_STORE).delete(userId);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
}

export async function preserveUserContentSnapshot(userId) {
  if (!userId) return false;
  const data = {};
  USER_CONTENT_KEYS.forEach(key => {
    const value = localStorage.getItem(key);
    if (value !== null) data[key] = value;
  });
  const snapshot = {
    savedAt: new Date().toISOString(),
    data,
  };
  try {
    if (await writeUserSnapshot(userId, snapshot)) return true;
  } catch (error) {
    console.warn('IndexedDB user snapshot write failed, using fallback:', error);
  }
  try {
    localStorage.setItem(`${USER_SNAPSHOT_PREFIX}${userId}`, JSON.stringify(snapshot));
    return true;
  } catch (error) {
    console.error('User snapshot write failed:', error);
    return false;
  }
}

export async function restoreUserContentSnapshot(userId) {
  if (!userId) return false;
  let snapshot = null;
  try {
    snapshot = await readUserSnapshot(userId);
  } catch (error) {
    console.warn('IndexedDB user snapshot read failed, using fallback:', error);
  }
  if (!snapshot) {
    try {
      snapshot = JSON.parse(localStorage.getItem(`${USER_SNAPSHOT_PREFIX}${userId}`) || 'null');
    } catch {
      return false;
    }
  }
  if (!snapshot) return null;
  if (!snapshot.data || typeof snapshot.data !== 'object') return false;
  try {
    USER_CONTENT_KEYS.forEach(key => {
      const value = snapshot.data[key];
      if (typeof value === 'string') localStorage.setItem(key, value);
    });
    localStorage.removeItem(`${USER_SNAPSHOT_PREFIX}${userId}`);
    try { await deleteUserSnapshot(userId); } catch {}
    return true;
  } catch (error) {
    console.error('User snapshot restore failed:', error);
    return false;
  }
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
