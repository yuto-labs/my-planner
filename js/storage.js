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
  if (_syncHook) setTimeout(() => _syncHook(tableKey), 0);
}
function _notifyDelete(payload) {
  if (_syncDeleteHook) setTimeout(() => _syncDeleteHook(payload), 0);
}

export const DEFAULT_CATEGORIES = [
  { id: 'research', name: '研究',  color: '#32D49A' },
  { id: 'job',      name: '就活',  color: '#9B8FF0' },
  { id: 'partime',  name: 'バイト', color: '#F5C542' },
  { id: 'play',     name: '遊び',  color: '#F07090' },
  { id: 'other',    name: 'その他', color: '#8B83E8' },
];

export const DEFAULT_ACCENT_RGB = { r: 190, g: 230, b: 216 };
export const DEFAULT_THEME_TUNING = {
  toneLevel: 55,
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
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {
    console.error('Storage write failed:', e);
  }
}

// ---- Events ----

export function getEvents() { return load(KEY.EVENTS, []); }
export function saveEvents(events) { save(KEY.EVENTS, events); _notifySync('events'); }

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
  if (target) addTrashItem({ entityType: 'event', payload: target, title: target.title });
  saveEvents(events.filter(e => e.id !== id));
  _notifyDelete({ table: 'events', id });
}

export function deleteFutureRecurring(recurringId, fromDateISO) {
  const from    = new Date(fromDateISO);
  const removed = getEvents().filter(e =>
    e.recurringId === recurringId && new Date(e.start) >= from
  );
  saveEvents(getEvents().filter(e =>
    e.recurringId !== recurringId || new Date(e.start) < from
  ));
  // Notify delete for each removed event
  removed.forEach(e => _notifyDelete({ table: 'events', id: e.id }));
}

// ---- Tasks ----

export function getTasks() { return load(KEY.TASKS, []); }
export function saveTasks(tasks) { save(KEY.TASKS, tasks); _notifySync('tasks'); }

export function addTask(task) {
  const tasks = getTasks();
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
      const { id: _id, createdAt: _c, updatedAt: _u, completedAt: _ca, completed: _co, ...rest } = prev;
      addTask({ ...rest, dueDate: nextDue, completed: false, completedAt: null });
    }
  }

  return tasks[idx];
}

export function deleteTask(id) {
  const tasks = getTasks();
  const target = tasks.find(t => t.id === id);
  if (target) addTrashItem({ entityType: 'task', payload: target, title: target.title });
  saveTasks(tasks.filter(t => t.id !== id));
  _notifyDelete({ table: 'tasks', id });
}

/** 完了済みタスクを一括削除 */
export function deleteCompletedTasks() {
  saveTasks(getTasks().filter(t => !t.completed));
}

/** タスクの順序を変更（ドラッグ&ドロップ用）*/
export function reorderTask(draggedId, targetId) {
  const tasks = getTasks();
  const from  = tasks.findIndex(t => t.id === draggedId);
  const to    = tasks.findIndex(t => t.id === targetId);
  if (from < 0 || to < 0 || from === to) return;
  const [moved] = tasks.splice(from, 1);
  tasks.splice(to, 0, moved);
  saveTasks(tasks);
}

/** 繰り返しタスクの次の日付を計算 */
function calcNextDueDate(currentDueDate, recurrence) {
  if (!recurrence || !recurrence.freq) return null;
  const base = currentDueDate ? new Date(currentDueDate) : new Date();
  const next = new Date(base);
  switch (recurrence.freq) {
    case 'daily':    next.setDate(next.getDate() + 1); break;
    case 'weekdays': {
      next.setDate(next.getDate() + 1);
      while ([0, 6].includes(next.getDay())) next.setDate(next.getDate() + 1);
      break;
    }
    case 'weekly':   next.setDate(next.getDate() + 7); break;
    case 'monthly':  next.setMonth(next.getMonth() + 1); break;
    default: return null;
  }
  return toDateStr_simple(next);
}

// ---- Goals ----

export function getGoals() { return load(KEY.GOALS, []); }
export function saveGoals(goals) { save(KEY.GOALS, goals); _notifySync('goals'); }

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
  saveGoals(getGoals().filter(g => g.id !== id));
  _notifyDelete({ table: 'goals', id });
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
  theme: 'dark',
  aiEnabled: false,
  myScheduleColor: '#60A5FA',
  accentRgb: DEFAULT_ACCENT_RGB,
  themeTuning: DEFAULT_THEME_TUNING,
};
const DEFAULT_AI_RUNTIME = {
  provider: 'gemini',
  mode: 'server',
  configured: false,
  checkedAt: 0,
  message: '',
};

export function getSettings() { return { ...DEFAULT_SETTINGS, ...load(KEY.SETS, {}) }; }
export function saveSettings(s) { save(KEY.SETS, { ...getSettings(), ...s }); }

export function getApiKey() { return getSettings().apiKey || ''; }
export function getAiRuntime() { return { ...DEFAULT_AI_RUNTIME, ...load(KEY.AI_RUNTIME, {}) }; }
export function saveAiRuntime(patch) { save(KEY.AI_RUNTIME, { ...getAiRuntime(), ...patch }); }
export function isAiAvailable() {
  const settings = getSettings();
  const runtime = getAiRuntime();
  return settings.aiEnabled === true && (runtime.configured === true || !!settings.apiKey);
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
export function saveScheduleItems(items) { save(SCHED_KEY, items); _notifySync('schedule_items'); }

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
  saveScheduleItems(getScheduleItems().filter(i => i.id !== id));
  _notifyDelete({ table: 'schedule_items', id });
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
  save(REVIEW_KEY, schedule);
  _notifySync('review_schedule');
}
export function scheduleFirstReview(memoId) {
  const schedule = getReviewSchedule();
  if (schedule[memoId]) return;
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  schedule[memoId] = { stage: 0, nextReview: toDateStr_simple(tomorrow), lastReview: null };
  saveReviewSchedule(schedule);
}

export function rateReview(memoId, rating) {
  const schedule = getReviewSchedule();
  const entry = schedule[memoId];
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
    .filter(([, v]) => v.nextReview <= dateStr && v.stage < MASTERY_STAGE)
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

export function getKnowledgeMemos()          { return load(KNOWLEDGE_KEY, []); }
export function saveKnowledgeMemos(memos)    { save(KNOWLEDGE_KEY, memos); _notifySync('knowledge_memos'); }

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
  if (target) addTrashItem({ entityType: 'memo', payload: target, title: target.title });
  saveKnowledgeMemos(memos.filter(m => m.id !== id));
  const schedule = getReviewSchedule();
  if (schedule[id]) {
    delete schedule[id];
    saveReviewSchedule(schedule);
    _notifyDelete({ table: 'review_schedule', id });
  }
  _notifyDelete({ table: 'knowledge_memos', id });
}

// ---- Trash ----
const TRASH_KEY = 'mp_trash';

export function getTrashItems() {
  return load(TRASH_KEY, []);
}

export function saveTrashItems(items) {
  save(TRASH_KEY, items);
  _notifySync('trash_items');
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
  saveTrashItems(items);
  return item;
}

export function removeTrashItem(id) {
  const items = getTrashItems();
  const target = items.find(item => item.id === id);
  saveTrashItems(items.filter(item => item.id !== id));
  if (target) _notifyDelete({ table: 'trash_items', id: target.id });
}

export function removeTrashItemByEntity(entityType, entityId) {
  if (!entityType || !entityId) return;
  const items = getTrashItems();
  const removed = items.filter(item => item.entityType === entityType && item.entityId === entityId);
  saveTrashItems(items.filter(item => !(item.entityType === entityType && item.entityId === entityId)));
  removed.forEach(item => _notifyDelete({ table: 'trash_items', id: item.id }));
}

export function restoreTrashItem(id) {
  const items = getTrashItems();
  const item = items.find(entry => entry.id === id);
  if (!item) return null;

  if (item.entityType === 'task') {
    const tasks = getTasks();
    if (!tasks.find(t => t.id === item.entityId)) {
      tasks.push(item.payload);
      tasks.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
      saveTasks(tasks);
    }
  } else if (item.entityType === 'event') {
    const events = getEvents();
    if (!events.find(e => e.id === item.entityId)) {
      events.push(item.payload);
      saveEvents(events);
    }
  } else if (item.entityType === 'memo') {
    const memos = getKnowledgeMemos();
    if (!memos.find(m => m.id === item.entityId)) {
      memos.push(item.payload);
      saveKnowledgeMemos(memos);
    }
  } else {
    return null;
  }

  removeTrashItem(id);
  return item;
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
export function saveArchivedTasks(tasks)   { save(ARCHIVE_KEY, tasks); _notifySync('tasks_archive'); }

/** Move completed tasks older than ARCHIVE_AFTER_DAYS to the archive store */
export function autoArchiveTasks() {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - ARCHIVE_AFTER_DAYS);
  const active   = load(KEY.TASKS, []);
  const toArchive = [];
  const remaining = [];

  active.forEach(t => {
    if (t.completed && t.completedAt && new Date(t.completedAt) < cutoff) {
      toArchive.push({ ...t, archivedAt: new Date().toISOString() });
    } else {
      remaining.push(t);
    }
  });

  if (toArchive.length) {
    save(KEY.TASKS, remaining);
    const archive = getArchivedTasks();
    saveArchivedTasks([...archive, ...toArchive]);
  }
  return toArchive.length;
}

/** Delete all archived tasks for a given YYYY-MM month */
export function deleteArchivedByMonth(yyyymm) {
  saveArchivedTasks(
    getArchivedTasks().filter(t => !t.archivedAt || t.archivedAt.slice(0, 7) !== yyyymm)
  );
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
export function saveTags(tags)        { save(TAGS_KEY, tags); _notifySync('tags'); }

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
  saveTags(getTags().filter(t => t !== name));
  _notifyDelete({ table: 'tags', name });
}

// ---- Review entry getter (for knowledge memo display) ----
export function getReviewEntry(memoId) {
  return getReviewSchedule()[memoId] || null;
}

// ---- Backup / Restore ----

export function exportBackup() {
  const { apiKey: _, ...safeSettings } = getSettings();
  return JSON.stringify({
    version: 3,
    exportedAt: new Date().toISOString(),
    events: getEvents(),
    tasks: getTasks(),
    goals: getGoals(),
    categories: getCategories(),
    settings: safeSettings,
    memos: getKnowledgeMemos(),
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
      save(KNOWLEDGE_KEY, memos);
    }
    removeTrashItemByEntity('memo', action.memo.id);
  }

  return action.type;
}
