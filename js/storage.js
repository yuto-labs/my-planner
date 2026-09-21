// ============================================================
// storage.js - ブラウザ内データの読み書きと、各データ型の更新ルール
//
// このファイルは画面と localStorage の間にある「保存の窓口」です。
// 画面側から localStorage を直接変更すると、更新日時・ごみ箱・同期通知の
// いずれかが抜けやすいため、原則としてここで公開している関数を使います。
//
// 読み方:
//   1. load / save が共通の低レベル処理
//   2. Events / Tasks などの節がデータ型ごとの操作
//   3. 後半の Knowledge 節は、旧形式も壊さず新形式へまとめる互換層
//   4. Snapshot 節は、ログイン切替や同期事故に備える端末内バックアップ
// ============================================================

import { generateId } from './utils.js';
import { normalizePartOfSpeech, withStableClassification } from './atlas-model.js';
import {
  atlasSenseAddsLearningContent,
  atlasSenseFromEntry,
  mergeAtlasList,
  mergeAtlasSenseArrays,
  sameAtlasSense,
} from './atlas-senses.js';
import { stableJsonStringify } from './data-compare.js';

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

// ログアウト・アカウント切替時に保護する「ユーザーが作ったデータ」の一覧。
// 新しい永続データを追加したら、この一覧への追加も検討すること。
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

// 定数の初期化順に依存せず USER_CONTENT_KEYS から参照するため関数にしている。
function SCHED_KEY_SAFE() { return 'mp_schedule'; }
/** `FOCUS_LOG_KEY_SAFE`: 現在のユーザーに対応するフォーカスログ保存キーを返す。 */
function FOCUS_LOG_KEY_SAFE() { return 'mp_focus_logs'; }
/** `HABIT_LOG_KEY_SAFE`: 現在のユーザーに対応する習慣ログ保存キーを返す。 */
function HABIT_LOG_KEY_SAFE() { return 'mp_habit_logs'; }
/** `ENERGY_INSIGHT_KEY_SAFE`: 現在のユーザーに対応するエネルギー分析保存キーを返す。 */
function ENERGY_INSIGHT_KEY_SAFE() { return 'mp_energy_insight'; }
/** `MONTHLY_REPORT_KEY_SAFE`: 現在のユーザーに対応する月次レポート保存キーを返す。 */
function MONTHLY_REPORT_KEY_SAFE() { return 'mp_monthly_reports'; }
/** `REVIEW_KEY_SAFE`: 現在のユーザーに対応する復習予定保存キーを返す。 */
function REVIEW_KEY_SAFE() { return 'mp_reviews'; }
/** `KNOWLEDGE_KEY_SAFE`: 現在のユーザーに対応するメモ・学習データ保存キーを返す。 */
function KNOWLEDGE_KEY_SAFE() { return 'mp_knowledge'; }
/** `REVIEW_LOG_KEY_SAFE`: 現在のユーザーに対応する復習履歴保存キーを返す。 */
function REVIEW_LOG_KEY_SAFE() { return 'mp_knowledge_review_log'; }
/** `ARCHIVE_KEY_SAFE`: 現在のユーザーに対応するアーカイブ保存キーを返す。 */
function ARCHIVE_KEY_SAFE() { return 'mp_task_archive'; }
/** `TRASH_KEY_SAFE`: 現在のユーザーに対応するゴミ箱保存キーを返す。 */
function TRASH_KEY_SAFE() { return 'mp_trash'; }
/** `TAGS_KEY_SAFE`: 現在のユーザーに対応するタグ保存キーを返す。 */
function TAGS_KEY_SAFE() { return 'mp_tags'; }
/** `HABITS_KEY_SAFE`: 現在のユーザーに対応する習慣保存キーを返す。 */
function HABITS_KEY_SAFE() { return 'mp_habits2'; }
/** `HABIT_DONE_KEY_SAFE`: 現在のユーザーに対応する習慣完了履歴の保存キーを返す。 */
function HABIT_DONE_KEY_SAFE() { return 'mp_habit2_done'; }

// ---- Sync hooks (wired by sync.js at startup) ----
// storage.js は sync.js を import しない (循環防止)
// sync.js 側が registerSyncHook / registerSyncDeleteHook で登録する

let _syncHook       = null; // (tableKey: string) => void
let _syncDeleteHook = null; // ({ table, id?, name? }) => void

/** 保存後に呼ぶ同期処理を sync.js から登録する。 */
export function registerSyncHook(fn)       { _syncHook       = fn; }
/** 削除後に呼ぶリモート削除処理を sync.js から登録する。 */
export function registerSyncDeleteHook(fn) { _syncDeleteHook = fn; }

/** `_notifySync`: Syncが変わったことを他の処理へ通知する。 */
function _notifySync(tableKey) {
  if (_syncHook) _syncHook(tableKey);
}
/** `_notifyDelete`: 削除が変わったことを他の処理へ通知する。 */
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

/**
 * JSON として保存された値を読む。
 * 壊れたJSONや初回起動では fallback を返し、画面全体の停止を防ぐ。
 */
function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw !== null ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * 値をJSON化して保存する共通処理。
 * 容量超過などの失敗を呼び出し元へ返し、UIにも通知できるようイベントを出す。
 */
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

// ---- Events（カレンダー予定）----
// 配列全体を保存した後に同期へ通知する。個別操作は必ず updatedAt を更新する。

/** 保存済みの個人予定を配列で返す。初回起動や壊れた保存値では空配列を返す。 */
export function getEvents() { return load(KEY.EVENTS, []); }
/**
 * 個人予定の配列全体を端末へ保存し、成功した場合だけ同期層へ変更を通知する。
 * @returns {boolean} 端末保存まで完了した場合はtrue。容量超過等ではfalse。
 */
export function saveEvents(events) {
  if (!save(KEY.EVENTS, events)) return false;
  _notifySync('events');
  return true;
}

/** 新しい予定にID・作成日時・省略可能フィールドの初期値を補って保存する。 */
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

/** 指定した予定だけを差分更新し、同期の競合判定に使う updatedAt も進める。 */
export function updateEvent(id, updates) {
  const events = getEvents();
  const idx = events.findIndex(e => e.id === id);
  if (idx < 0) return null;
  events[idx] = { ...events[idx], ...updates, updatedAt: new Date().toISOString() };
  return saveEvents(events) ? events[idx] : null;
}

/**
 * 予定をごみ箱へ退避してから本体を削除する。
 * ごみ箱への保存に失敗した場合は予定を残し、取り返せない削除を避ける。
 */
export function deleteEvent(id) {
  const events = getEvents();
  const target = events.find(e => e.id === id);
  if (!target) return null;
  if (!addTrashItem({ entityType: 'event', payload: target, title: target.title })) return null;
  if (!saveEvents(events.filter(e => e.id !== id))) return null;
  _notifyDelete({ table: 'events', id });
  return target;
}

/** 繰り返し予定のうち、指定日時以降だけをごみ箱へ移して削除する。 */
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

// ---- Tasks（タスク）----
// 完了・放棄・並び順・繰り返し生成を一か所で整え、画面ごとの挙動差を防ぐ。

/** 保存済みタスクを配列で返し、未保存時は空配列を返す。 */
export function getTasks() { return load(KEY.TASKS, []); }
/**
 * タスク配列全体を端末へ書き、成功時だけSupabase同期を予約する。
 * 個別更新関数はこの窓口を通すことで、端末保存だけされて同期されない状態を避ける。
 */
export function saveTasks(tasks) {
  if (!save(KEY.TASKS, tasks)) return false;
  _notifySync('tasks');
  return true;
}

/** タスクの既定値と安定した並び順を補って保存する。 */
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

/**
 * タスクを差分更新する。完了時刻などの派生値と、次回の繰り返しタスクもここで扱う。
 * 同じ完了操作が再実行されても、次回分を重複生成しないよう seriesId で確認する。
 */
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

/** ごみ箱への退避が成功した場合にだけ、タスク本体を削除する。 */
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

// ---- Goals（目標）----
// 目標は関連タスクから計算する進捗とは別に、題名・期限・説明を保存する。

/** 保存済みの目標一覧を返し、まだ一件もなければ空配列を返す。 */
export function getGoals() { return load(KEY.GOALS, []); }
/** 目標一覧を端末へ保存し、成功時だけ目標テーブルの同期を予約する。 */
export function saveGoals(goals) {
  if (!save(KEY.GOALS, goals)) return false;
  _notifySync('goals');
  return true;
}

/** 目標へ既定値、ID、作成・更新日時を付けて保存する。 */
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

/** 指定IDの目標へ変更項目だけを重ね、更新日時を進めて保存する。 */
export function updateGoal(id, updates) {
  const goals = getGoals();
  const idx = goals.findIndex(g => g.id === id);
  if (idx < 0) return null;
  goals[idx] = { ...goals[idx], ...updates, updatedAt: new Date().toISOString() };
  saveGoals(goals);
  return goals[idx];
}

/** 目標を復元可能なごみ箱へ移してから削除する。 */
export function deleteGoal(id) {
  const goals = getGoals();
  const target = goals.find(goal => goal.id === id);
  if (!target) return null;
  if (!addTrashItem({ entityType: 'goal', payload: target, title: target.title })) return null;
  if (!saveGoals(goals.filter(goal => goal.id !== id))) return null;
  _notifyDelete({ table: 'goals', id });
  return target;
}

// ---- Categories（予定カテゴリ）----
// 予定はカテゴリIDだけを持ち、表示名と色はこの一覧から引く。

/** 利用者が編集した予定カテゴリを返し、未保存時は組み込みカテゴリを返す。 */
export function getCategories() { return load(KEY.CATS, DEFAULT_CATEGORIES); }
/** 予定カテゴリの表示名と色を端末へ保存する。カテゴリは現在クラウド同期対象外。 */
export function saveCategories(cats) { save(KEY.CATS, cats); }

/**
 * IDに一致する予定カテゴリを利用者設定、組み込み設定の順で探す。
 * 古い予定が未知のIDを持つ場合も表示できるよう、最後は「その他」を返す。
 */
export function getCategoryById(id) {
  return getCategories().find(c => c.id === id)
    || DEFAULT_CATEGORIES.find(c => c.id === id)
    || DEFAULT_CATEGORIES[4]; // fallback to 'other'
}

/** カテゴリIDからカレンダー表示用の色を返し、色が欠けていれば中立色へ戻す。 */
export function getCategoryColor(id) {
  return getCategoryById(id)?.color || '#6b7280';
}

// ---- Settings（端末設定）----
// 設定は部分更新が多いため、saveSettingsは現在値へpatchを重ねて未指定項目を残す。

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

/** 古い保存値に新しい既定値を重ね、設定追加後も欠損なく返す。 */
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
/** 指定された設定だけを更新し、他の設定項目を保持する。 */
export function saveSettings(s) { save(KEY.SETS, { ...getSettings(), ...s }); }

/** 旧版との互換用に端末設定内のAPIキーを返す。現在の本番AIはサーバー側キーを使う。 */
export function getApiKey() { return getSettings().apiKey || ''; }
/**
 * AIサーバーの設定確認結果を返す。旧ポイント・利用枠は復活させないため常にnullへ正規化する。
 */
export function getAiRuntime() {
  const runtime = { ...DEFAULT_AI_RUNTIME, ...load(KEY.AI_RUNTIME, {}) };
  return { ...runtime, limits: null, usage: null };
}
/** AI状態の一部だけを既存値へ重ねて保存し、廃止済みの利用枠情報は破棄する。 */
export function saveAiRuntime(patch) {
  const runtime = { ...getAiRuntime(), ...patch };
  save(KEY.AI_RUNTIME, { ...runtime, limits: null, usage: null });
}
/** 利用者設定でAIが有効、かつサーバー設定確認済みの場合だけtrueを返す。 */
export function isAiAvailable() {
  const settings = getSettings();
  const runtime = getAiRuntime();
  return settings.aiEnabled === true && runtime.configured === true;
}
/** マイスケジュールの表示色を返し、未設定なら組み込みの青色を使う。 */
export function getMyScheduleColor() { return getSettings().myScheduleColor || DEFAULT_SETTINGS.myScheduleColor; }

// ---- AI Result Cache ----
// 同じ短いAI要求の再通信を減らす期限付きキャッシュ。正式なメモ本文とは別物。

/** 有効期限内のAIキャッシュだけを返し、期限切れはその場で除去する。 */
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

/** 結果と有効期限を組にして保存する。 */
export function setAiCache(key, val, ttlMs = 86_400_000) {
  const cache = load(KEY.CACHE, {});
  cache[key] = { val, exp: Date.now() + ttlMs };
  save(KEY.CACHE, cache);
}

/** 正式保存データには触れず、再通信を減らすための一時AIキャッシュだけを空にする。 */
export function clearAiCache() {
  save(KEY.CACHE, {});
}

// ---- Pending AI Queue ----
// すぐ処理しないAI依頼を、再読み込み後も再開できるよう端末へ残す。
// Items awaiting AI processing (created offline or in batch mode)
// Shape: { id, type, title, queuedAt }
// type: 'memo_tags'

/** オフライン時などに処理できなかったAI依頼の待機列を返す。 */
export function getPendingAIQueue() {
  return load(KEY.AI_QUEUE, []);
}

/** 同じID・種類を重複させずAI待機列へ追加する。 */
export function addToPendingAIQueue(item) {
  const queue = getPendingAIQueue();
  // Deduplicate by id+type
  if (queue.some(q => q.id === item.id && q.type === item.type)) return;
  queue.push({ ...item, queuedAt: new Date().toISOString() });
  save(KEY.AI_QUEUE, queue);
}

/** 指定した対象IDと処理種別に一致するAI依頼だけを待機列から取り除く。 */
export function removeFromPendingAIQueue(id, type) {
  const queue = getPendingAIQueue().filter(q => !(q.id === id && q.type === type));
  save(KEY.AI_QUEUE, queue);
}

/** AI待機列をすべて空にする。生成済み回答やメモ本文は削除しない。 */
export function clearPendingAIQueue() {
  save(KEY.AI_QUEUE, []);
}

// ---- Batch AI Settings ----
// { aiMode: 'immediate'|'batch', batchEnabled: bool, batchTime: 'HH:MM' }

/** AI依頼を即時処理するか指定時刻にまとめるかという端末設定を返す。 */
export function getBatchSettings() {
  return load(KEY.BATCH_CFG, {
    aiMode:       'immediate', // 'immediate' | 'batch'
    batchEnabled: false,
    batchTime:    '22:00',
  });
}

/** 一括AI設定の指定項目だけを更新し、未指定項目と既定値を保持する。 */
export function saveBatchSettings(patch) {
  const current = getBatchSettings();
  save(KEY.BATCH_CFG, { ...current, ...patch });
}

// ---- マイスケジュール（個人の一日用時間ブロック）----
// カレンダー予定とは別データだが、Today画面では同じ時間軸に表示する。

const SCHED_KEY = 'mp_schedule';

/** マイスケジュールの時間ブロックを返す。カレンダー予定とは別の保存領域。 */
export function getScheduleItems() { return load(SCHED_KEY, []); }
/** マイスケジュール全体を端末へ保存し、成功時だけクラウド同期を予約する。 */
export function saveScheduleItems(items) {
  if (!save(SCHED_KEY, items)) return false;
  _notifySync('schedule_items');
  return true;
}

/** 日付、開始・終了時刻、由来タスクなどを持つ時間ブロックを追加する。 */
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

/** 指定した時間ブロックへ題名・時刻等の差分を重ね、更新日時を進めて保存する。 */
export function updateScheduleItem(id, updates) {
  const items = getScheduleItems();
  const idx = items.findIndex(i => i.id === id);
  if (idx < 0) return null;
  items[idx] = { ...items[idx], ...updates, updatedAt: new Date().toISOString() };
  return saveScheduleItems(items) ? items[idx] : null;
}

/** マイスケジュール項目をごみ箱へ退避してから削除する。 */
export function deleteScheduleItem(id) {
  const items = getScheduleItems();
  const target = items.find(item => item.id === id);
  if (!target) return null;
  if (!addTrashItem({ entityType: 'schedule', payload: target, title: target.title })) return null;
  if (!saveScheduleItems(items.filter(item => item.id !== id))) return null;
  _notifyDelete({ table: 'schedule_items', id });
  return target;
}

/**
 * 条件に合うAI生成案などを新しい一覧へ置換する。
 * 条件外の手動項目は残し、置換対象だけをごみ箱・同期削除へ送る。
 */
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

/** 毎日表示する項目と、指定日専用の項目を合わせて返す。 */
export function getScheduleItemsForDate(dateStr) {
  return getScheduleItems().filter(i => !i.date || i.date === dateStr);
}

// ---- Focus Logs (Energy Pattern) ----
// Shape: [{id, taskId, taskTitle, focusLevel:'high'|'medium'|'low', hour:0-23, dayOfWeek:0-6, timestamp}]
const FOCUS_LOG_KEY = 'mp_focus_logs';
/** タスク完了時などに記録した集中度・時刻・曜日の履歴を返す。 */
export function getFocusLogs()           { return load(FOCUS_LOG_KEY, []); }
/** 集中度分析用ログを端末へ保存する。これは端末内分析用で同期対象外。 */
export function saveFocusLogs(logs)      { save(FOCUS_LOG_KEY, logs); }
/** 集中度記録へIDと現在時刻を付け、直近60日分だけを残して保存する。 */
export function addFocusLog(entry) {
  const logs = getFocusLogs();
  const newEntry = { ...entry, id: entry.id || generateId(), timestamp: new Date().toISOString() };
  logs.push(newEntry);
  // keep last 60 days
  const cutoff = Date.now() - 60 * 86400000;
  saveFocusLogs(logs.filter(l => new Date(l.timestamp).getTime() > cutoff));
  return newEntry; // return so caller can store ID for undo
}

/** Undo時などに、指定IDの集中度記録だけを取り除く。 */
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
/** 現在時刻から指定日数以内に記録された集中度ログだけを返す。 */
export function getFocusLogsForDays(days) {
  const cutoff = Date.now() - days * 86400000;
  return getFocusLogs().filter(l => new Date(l.timestamp).getTime() > cutoff);
}

// ---- Habit Logs (sleep, exercise per day) ----
// Shape: { 'YYYY-MM-DD': { sleep: number, exercise: boolean, note: '' } }
const HABIT_LOG_KEY = 'mp_habit_logs';
/** 日付をキーにした睡眠・運動等の生活ログを返す。 */
export function getHabitLogs()                    { return load(HABIT_LOG_KEY, {}); }
/** 指定日の生活ログを返し、記録がなければnullを返す。 */
export function getHabitLogForDate(dateStr)        { return getHabitLogs()[dateStr] || null; }
/** 指定日の生活ログへ変更項目を重ね、同じ日の未変更項目を保持して保存する。 */
export function setHabitLog(dateStr, data) {
  const logs = getHabitLogs();
  logs[dateStr] = { ...logs[dateStr], ...data };
  save(HABIT_LOG_KEY, logs);
}

// ---- Energy Insight Cache (AI-generated) ----
const ENERGY_INSIGHT_KEY = 'mp_energy_insight';
/** AIが生成した集中しやすい時間帯等の分析キャッシュを返す。 */
export function getEnergyInsight()    { return load(ENERGY_INSIGHT_KEY, null); }
/** 最新のエネルギー分析を端末キャッシュへ置き換える。 */
export function setEnergyInsight(d)   { save(ENERGY_INSIGHT_KEY, d); }

// ---- Monthly Reports ----
const MONTHLY_REPORT_KEY = 'mp_monthly_reports';
/** `YYYY-MM`に一致する月次レポートを返し、未生成ならnullを返す。 */
export function getMonthlyReport(yyyymm)        { return (load(MONTHLY_REPORT_KEY, {}))[yyyymm] || null; }
/** 対象月のレポートへ生成日時を付け、他の月を残して保存する。 */
export function setMonthlyReport(yyyymm, report) {
  const all = load(MONTHLY_REPORT_KEY, {});
  all[yyyymm] = { ...report, generatedAt: new Date().toISOString() };
  save(MONTHLY_REPORT_KEY, all);
}

// ---- Spaced Repetition Review Schedule（メモの間隔反復）----
// memoIdをキーに、段階・前回日・次回日を保存する。復習なしはstage=-1で表す。
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

/** メモIDをキーにした復習段階・前回日・次回日の対応表を返す。 */
export function getReviewSchedule()              { return load(REVIEW_KEY, {}); }
/** 復習予定の対応表を端末へ保存し、成功時だけ端末間同期を予約する。 */
export function saveReviewSchedule(schedule) {
  if (!save(REVIEW_KEY, schedule)) return false;
  _notifySync('review_schedule');
  return true;
}
/** 復習対象にしたメモへ、最初の復習予定を作る。 */
export function scheduleFirstReview(memoId) {
  const schedule = getReviewSchedule();
  if (schedule[memoId]) return;
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  schedule[memoId] = { stage: 0, nextReview: toDateStr_simple(tomorrow), lastReview: null };
  saveReviewSchedule(schedule);
}

/** 明示的に「復習なし」にしたメモ以外を復習対象として扱う。 */
export function isMemoReviewEnabled(memoId) {
  return getReviewSchedule()[memoId]?.stage !== REVIEW_DISABLED_STAGE;
}

/** 復習対象の切替を行い、無効時もメモ本文自体は変更しない。 */
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

/** Again/Hard/Good/Easyの評価から段階と次回日を更新する。 */
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

/** 各評価を押した場合の次回間隔を、保存せずプレビューする。 */
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

/** 復習段階を有効範囲へ収め、段階に応じた次回日を再計算して保存する。 */
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

/** 指定日までに期限を迎え、未習得かつ復習有効なメモの予定を返す。 */
export function getReviewsForDate(dateStr) {
  const schedule = getReviewSchedule();
  return Object.entries(schedule)
    .filter(([, v]) => v.stage >= 0 && v.nextReview && v.nextReview <= dateStr && v.stage < MASTERY_STAGE)
    .map(([memoId, v]) => ({ memoId, ...v }));
}
/** Dateを端末のローカル日付に基づく`YYYY-MM-DD`へ変換する。 */
function toDateStr_simple(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ---- Knowledge / Memo 共通保存領域 ----
// Block shape: { id, type, text, color, collapsed, children }
// Memo shape:  { id, title, blocks, tags, starred, url, summary, createdAt, updatedAt }
//
// 通常メモ、表現帳、英訳、Knowledge、ホーム画像設定は同じ配列に保存される。
// 内部タグと専用 block.type で種類を判定するため、通常メモ一覧では内部レコードを除外する。
// この構成により既存DBを壊さず機能を追加できるが、保存時に別種類のレコードを落とさないこと。

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

/** 通常メモと内部レコードを区別せず、共通保存配列の全件を返す内部関数。 */
function getAllKnowledgeRecords() {
  const records = load(KNOWLEDGE_KEY, []);
  return Array.isArray(records) ? records : [];
}

/** 内部タグと専用block.typeの両方から、表現帳系レコードか判定する。 */
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

/** ホームカバー等の画像設定を通常メモから区別する。 */
function isAppMediaPreferencesRecord(record) {
  return Array.isArray(record?.tags)
    && record.tags.includes(APP_MEDIA_PREFS_TAG)
    && Array.isArray(record.blocks)
    && record.blocks.some(block => block?.type === APP_MEDIA_PREFS_BLOCK_TYPE);
}

/** 一般Knowledgeの質問回答を保存した内部レコードか判定する。 */
function isLearningLibraryRecord(record) {
  return Array.isArray(record?.tags)
    && record.tags.includes(LEARNING_LIBRARY_TAG)
    && Array.isArray(record.blocks)
    && record.blocks.some(block => block?.type === LEARNING_ENTRY_BLOCK_TYPE);
}

/** 通常メモ一覧へ出さない、表現帳・Knowledge・画像設定の内部レコードか判定する。 */
function isInternalKnowledgeRecord(record) {
  return isExpressionAtlasRecord(record)
    || isLearningLibraryRecord(record)
    || isAppMediaPreferencesRecord(record);
}

/** 表現帳系レコードのうち、英語見出し語とsenseを持つ解説レコードか判定する。 */
function isNuanceRecord(record) {
  return isExpressionAtlasRecord(record)
    && record.blocks.some(block => block?.type === EXPRESSION_ATLAS_BLOCK_TYPE);
}

/** 表現帳系レコードのうち、和文英訳セットを持つものか判定する。 */
function isTranslationSetRecord(record) {
  return isExpressionAtlasRecord(record)
    && record.blocks.some(block => block?.type === TRANSLATION_SET_BLOCK_TYPE);
}

/** 表現帳系レコードのうち、英語の疑問と回答を持つものか判定する。 */
function isEnglishQuestionRecord(record) {
  return isExpressionAtlasRecord(record)
    && record.blocks.some(block => block?.type === ENGLISH_QUESTION_BLOCK_TYPE);
}

/** `expressionRecordToEntry`: 表現・保存レコードを項目へ変換して返す。 */
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

/** `expressionEntryKey`: 表現項目を重複判定するための安定したキーを返す。 */
function expressionEntryKey(entry) {
  const stable = withStableClassification(entry);
  return [
    String(stable.language || 'English').trim().toLocaleLowerCase(),
    String(stable.categoryId || stable.category || '').trim().toLocaleLowerCase(),
    String(stable.topicId || stable.topic || '').trim().toLocaleLowerCase(),
    String(stable.lemma || stable.term || '').trim().toLocaleLowerCase(),
  ].join('|');
}

/** `expressionHeadwordKey`: 英語見出し語を品詞に依存しない比較キーへ正規化する。 */
function expressionHeadwordKey(entry) {
  return [
    String(entry?.language || 'English').trim().toLocaleLowerCase(),
    String(entry?.lemma || entry?.term || '').normalize('NFKC').trim().toLocaleLowerCase(),
  ].join('|');
}

/** `expressionSenses`: 新旧どちらの保存形式からも、表現の意味一覧を取り出す。 */
function expressionSenses(entry = {}) {
  const stored = Array.isArray(entry.senses) ? entry.senses.filter(Boolean) : [];
  return stored.length ? stored.map(atlasSenseFromEntry) : [atlasSenseFromEntry(entry)];
}

/** `mergeUniqueArray`: 複数のUnique・配列を既存情報を失わないよう統合する。 */
function mergeUniqueArray(existing, incoming) {
  return mergeAtlasList(existing, incoming);
}

/**
 * 同じ言語・見出し語の表現を一つの代表レコードへ統合する。
 * 品詞や意味は senses 配列に残すため、統合は内容の削除を意味しない。
 */
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

/** 既存の濃い解説を保ちながら、新しい意味・出典質問・別名を足し合わせる。 */
function mergeExpressionEntry(existing, incoming) {
  const existingSenses = expressionSenses(existing);
  const incomingSenses = expressionSenses(incoming);
  const senses = mergeAtlasSenseArrays(existingSenses, incomingSenses);
  const primaryWasUpdated = incomingSenses.some(sense => sameAtlasSense(existingSenses[0], sense));

  const primary = senses[0] || atlasSenseFromEntry(existing);
  const content = primaryWasUpdated ? { ...existing, ...incoming } : { ...incoming, ...existing };
  return {
    ...content,
    ...atlasSenseFromEntry(primary),
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

/** `normalizedExpressionSourceQueries`: normalized・表現・入力元・Queriesに関する補助処理を行い、結果を呼び出し元へ返す。 */
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

/** 言語と見出し語が同じで、過去にも同一の入力文から生成済みか判定する。 */
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

/** `atlasRecordIsUnchanged`: 表現帳レコードの学習内容が更新前後で同じか判定する。 */
function atlasRecordIsUnchanged(existing, blockType, title, summary, data) {
  if (!existing) return false;
  const previousData = existing.blocks?.find(block => block?.type === blockType)?.data;
  return existing.title === title
    && existing.summary === summary
    && stableJsonStringify(previousData) === stableJsonStringify(data);
}

/** `expressionEntryToRecord`: 表現・項目を保存レコードへ変換して返す。 */
function expressionEntryToRecord(entry, existing = null) {
  const now = new Date().toISOString();
  const id = entry.id || existing?.id || generateId();
  const data = {
    promptVersion: 10,
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
    senseFingerprint: {
      semanticDomain: '',
      actionType: '',
      argumentPatterns: [],
      typicalObjects: [],
      implicationTags: [],
      registerTags: [],
      physicality: '',
    },
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
    usagePatterns: [],
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
  data.partOfSpeech = normalizePartOfSpeech(data.partOfSpeech);
  data.senses = expressionSenses(data);
  data.grammarNotes = {
    ...(data.grammarNotes || {}),
    partOfSpeech: normalizePartOfSpeech(data.grammarNotes?.partOfSpeech || data.partOfSpeech),
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

/** `translationRecordToSet`: 英訳・保存レコードをSetへ変換して返す。 */
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

/** `translationSetKey`: 英訳セットを元の日本語文に基づく重複判定キーへ変換する。 */
function translationSetKey(set) {
  return [
    String(set?.language || 'English').trim().toLocaleLowerCase(),
    String(set?.sourceTextJa || '').trim().toLocaleLowerCase(),
  ].join('|');
}

/** `translationSetToRecord`: 英訳・Setを保存レコードへ変換して返す。 */
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

/** `englishQuestionRecordToEntry`: 英語・質問・保存レコードを項目へ変換して返す。 */
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

/** `englishQuestionToRecord`: 英語・質問を保存レコードへ変換して返す。 */
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

/** `learningRecordToEntry`: 学習・保存レコードを項目へ変換して返す。 */
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

/** `learningEntryToRecord`: 学習・項目を保存レコードへ変換して返す。 */
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

/** 通常のメモだけを返し、表現帳などの内部レコードを一覧へ混ぜない。 */
export function getKnowledgeMemos() {
  return getAllKnowledgeRecords().filter(record => !isInternalKnowledgeRecord(record));
}

/**
 * 貼り付けや複製で重なったブロックIDを付け直す。
 * ID重複は編集対象の取り違えや、画像・トグルの誤更新につながるため保存前に正規化する。
 */
export function normalizeMemoBlockIds(blocks, idFactory = generateId) {
  const seen = new Set();
  /** `nextId`: next・IDに関する補助処理を行い、結果を呼び出し元へ返す。 */
  const nextId = () => {
    let id = String(idFactory() || '').trim();
    while (!id || seen.has(id)) id = String(idFactory() || '').trim();
    return id;
  };
  /** `visit`: visitに関する補助処理を行い、結果を呼び出し元へ返す。 */
  const visit = block => {
    const next = { ...(block || {}) };
    const originalId = String(next.id || '').trim();
    next.id = originalId && !seen.has(originalId) ? originalId : nextId();
    seen.add(next.id);
    if (Array.isArray(next.children)) next.children = next.children.map(visit);
    return next;
  };
  return (Array.isArray(blocks) ? blocks : []).map(visit);
}

/**
 * 通常メモを保存する際、同じ保存領域にある表現帳・Knowledge等を必ず引き継ぐ。
 * incoming が通常メモだけでも内部レコードを消さないことが重要。
 */
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

/** 内部レコードからホームカバー等の画像設定を読み、利用側が変更できるコピーを返す。 */
export function getAppMediaPreferences() {
  const record = getAllKnowledgeRecords().find(isAppMediaPreferencesRecord);
  const data = record?.blocks?.find(block => block?.type === APP_MEDIA_PREFS_BLOCK_TYPE)?.data;
  return data && typeof data === 'object' ? { ...data } : { homeCover: null };
}

/**
 * 画像設定だけを内部レコードへ部分更新する。
 * 通常メモや表現帳と同じ配列を使うため、それらを保持したまま対象レコードだけを置き換える。
 */
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

/** 保存レコードを表現帳entryへ変換する。重複見出し語の統合はまだ行わない。 */
function getRawExpressionEntries() {
  return getAllKnowledgeRecords()
    .filter(isNuanceRecord)
    .map(expressionRecordToEntry)
    .filter(Boolean);
}

/** 同じ見出し語の既存レコードを一件へ統合し、更新が新しい順で返す。 */
export function getExpressionEntries() {
  return consolidateExpressionEntries(getRawExpressionEntries())
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

/** 表現帳全体を同じ見出し語単位へ統合し、通常メモ等を残して保存する。 */
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
    if (stableJsonStringify(atlasEntryIds) === stableJsonStringify(questionBlock.data.atlasEntryIds)) return record;
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

/**
 * AIが生成した表現を既存見出し語へ統合し、追加・更新・重複の結果も返す。
 * UIはこの結果を使い「保存されなかった」のか「既存項目へ追加された」のかを区別する。
 */
export function addExpressionEntriesWithReport(entries) {
  const current = getExpressionEntries();
  const saved = [];
  const report = { created: 0, enriched: 0, alreadyCovered: 0 };
  (Array.isArray(entries) ? entries : []).forEach(entry => {
    if (!String(entry?.term || '').trim()) return;
    const existing = current.find(candidate => expressionHeadwordKey(candidate) === expressionHeadwordKey(entry))
      || current.find(candidate => expressionEntryKey(candidate) === expressionEntryKey(entry))
      || current.find(candidate => isRepeatedExpressionQuery(candidate, entry));
    const existingSenses = existing ? expressionSenses(existing) : [];
    const incomingSenses = expressionSenses(entry);
    const addsLearningContent = !existing || incomingSenses.some(incomingSense => {
      const matching = existingSenses.find(existingSense => sameAtlasSense(existingSense, incomingSense));
      return !matching || atlasSenseAddsLearningContent(matching, incomingSense);
    });
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
    if (!existing) report.created += 1;
    else if (addsLearningContent) report.enriched += 1;
    else report.alreadyCovered += 1;
    saved.push(merged);
  });
  if (!saveExpressionEntries(current)) return { entries: [], created: 0, enriched: 0, alreadyCovered: 0 };
  return { entries: saved, ...report };
}

/** 表現帳の統合結果レポートを省き、保存されたentry配列だけを返す簡易窓口。 */
export function addExpressionEntries(entries) {
  return addExpressionEntriesWithReport(entries).entries;
}

/** 一つの表現カードを更新し、既存senseと他レコードを保持する。 */
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

/** 表現カード全体をごみ箱へ退避してから削除する。 */
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

/** 通常メモだけを対象にID検索し、見つからなければnullを返す。 */
export function getKnowledgeMemoById(id) {
  return getKnowledgeMemos().find(m => m.id === id) || null;
}

/** 通常メモへ既定値と正規化済みブロックIDを付けて保存する。 */
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

/** 小さな変更でもupdatedAtを進め、タグや未変更ブロックを落とさず更新する。 */
export function updateKnowledgeMemo(id, updates) {
  const memos = getKnowledgeMemos();
  const idx   = memos.findIndex(m => m.id === id);
  if (idx < 0) return null;
  memos[idx] = { ...memos[idx], ...updates, updatedAt: new Date().toISOString() };
  return saveKnowledgeMemos(memos) ? memos[idx] : null;
}

/** 通常メモをごみ箱へ退避し、復習予定も整合させて削除する。 */
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

// ---- Trash（全機能共通のごみ箱）----
// payloadへ削除前の完全なオブジェクトを残し、entityTypeで復元先を決める。
const TRASH_KEY = 'mp_trash';

/** 全機能共通のごみ箱項目を、保存された形のまま配列で返す。 */
export function getTrashItems() {
  return load(TRASH_KEY, []);
}

/** ごみ箱全体を端末へ保存し、成功時だけ端末間同期を予約する。 */
export function saveTrashItems(items) {
  if (!save(TRASH_KEY, items)) return false;
  _notifySync('trash_items');
  return true;
}

/** 共通保存配列から和文英訳だけを復元し、更新が新しい順で返す。 */
export function getTranslationSets() {
  return getAllKnowledgeRecords()
    .filter(isTranslationSetRecord)
    .map(translationRecordToSet)
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

/** 共通保存配列から英語の疑問回答だけを復元し、更新が新しい順で返す。 */
export function getEnglishQuestions() {
  return getAllKnowledgeRecords()
    .filter(isEnglishQuestionRecord)
    .map(englishQuestionRecordToEntry)
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

/** 共通保存配列から一般Knowledgeの質問回答だけを復元し、更新が新しい順で返す。 */
export function getLearningEntries() {
  return getAllKnowledgeRecords()
    .filter(isLearningLibraryRecord)
    .map(learningRecordToEntry)
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

/** 一般Knowledge項目をIDで検索し、見つからなければnullを返す。 */
export function getLearningEntryById(id) {
  return getLearningEntries().find(entry => entry.id === id) || null;
}

/** Knowledge項目を通常メモ等と同じ配列へ、安全に戻して保存する。 */
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

/** 一般知識の質問回答を内部Knowledgeレコードとして追加する。 */
export function addLearningEntry(entry) {
  const current = getLearningEntries();
  const nextEntry = { ...entry, id: entry.id || generateId() };
  return saveLearningEntries([nextEntry, ...current]) ? nextEntry : null;
}

/** 指定したKnowledge項目へ題名等の差分を重ね、他の内部レコードを残して保存する。 */
export function updateLearningEntry(id, updates) {
  const entries = getLearningEntries();
  const index = entries.findIndex(entry => entry.id === id);
  if (index < 0) return null;
  entries[index] = { ...entries[index], ...updates, id };
  return saveLearningEntries(entries) ? entries[index] : null;
}

/** Knowledge項目を回答全体ごとごみ箱へ退避する。 */
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

/** 英語の疑問と構造化回答を表現帳領域へ保存する。 */
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

/** 英語の疑問回答へ変更を重ね、ノートと生成内容それぞれの更新時刻も記録する。 */
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

/** 英語の疑問回答を完全削除せず、ごみ箱へ退避してから共通保存配列から外す。 */
export function deleteEnglishQuestion(id) {
  const records = getAllKnowledgeRecords();
  const target = records.find(record => record.id === id && isEnglishQuestionRecord(record));
  if (!target) return false;
  if (!addTrashItem({ entityType: 'atlas', payload: target, title: target.title || '英語の疑問' })) return false;
  if (!save(KNOWLEDGE_KEY, records.filter(record => record.id !== id))) return false;
  _notifyDelete({ table: 'knowledge_memos', id });
  return true;
}

/** 和文英訳レコードだけを置換し、通常メモ・表現帳・Knowledgeを保持して保存する。 */
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

/** 元の日本語と複数英訳を一組のレコードとして保存する。 */
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

/** 保存済み和文英訳セットへ変更を重ね、他の英訳セットを保持して保存する。 */
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

/** 削除対象の完全な payload をごみ箱へ保存し、後から同じ形で復元できるようにする。 */
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

/** ごみ箱の一件を完全削除し、クラウドにも削除を通知する。 */
export function removeTrashItem(id) {
  const items = getTrashItems();
  const target = items.find(item => item.id === id);
  if (!target) return null;
  if (!saveTrashItems(items.filter(item => item.id !== id))) return null;
  _notifyDelete({ table: 'trash_items', id: target.id });
  return target;
}

/** 復元済み対象と同じ種類・元IDを持つごみ箱項目を取り除き、同期削除も通知する。 */
export function removeTrashItemByEntity(entityType, entityId) {
  if (!entityType || !entityId) return;
  const items = getTrashItems();
  const removed = items.filter(item => item.entityType === entityType && item.entityId === entityId);
  if (!removed.length) return [];
  if (!saveTrashItems(items.filter(item => !(item.entityType === entityType && item.entityId === entityId)))) return [];
  removed.forEach(item => _notifyDelete({ table: 'trash_items', id: item.id }));
  return removed;
}

/**
 * ごみ箱の種類に応じて元の保存先へ戻す。
 * 復元先への保存が成功するまでごみ箱側を消さない。
 */
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

/** ごみ箱payloadが旧版のJSON文字列でも、復元処理が扱えるオブジェクトへ戻す。 */
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

/** 指定月に削除されたごみ箱項目を完全削除し、各IDを同期先からも削除する。 */
export function deleteTrashItemsByMonth(yyyymm) {
  const items = getTrashItems();
  const removed = items.filter(item => item.deletedAt && item.deletedAt.slice(0, 7) === yyyymm);
  saveTrashItems(items.filter(item => !item.deletedAt || item.deletedAt.slice(0, 7) !== yyyymm));
  removed.forEach(item => _notifyDelete({ table: 'trash_items', id: item.id }));
}

// ---- Knowledge Review Log ----
// Shape: [{ memoId: 'id', date: 'YYYY-MM-DD', tags: ['tag1', 'tag2'] }]
const REVIEW_LOG_KEY = 'mp_knowledge_review_log';

/** メモ復習を実行した日付とタグの履歴を返す。 */
export function getReviewLog() { return load(REVIEW_LOG_KEY, []); }

/** メモID・当日・タグを復習履歴へ加え、古い履歴を含め最大500件に保つ。 */
export function addReviewLog(memoId, tags) {
  const log = getReviewLog();
  log.push({ memoId, date: toDateStr_simple(new Date()), tags: tags || [] });
  if (log.length > 500) log.splice(0, log.length - 500);
  save(REVIEW_LOG_KEY, log);
}

// ---- Term explanation cache (persistent) ----

/** メモ内の「調べる」で取得した用語解説を、検索語をキーにした対応表で返す。 */
export function getTermCache() { return load(TERM_KEY, {}); }

/** 大文字小文字と前後空白を無視して、保存済み用語解説を探す。 */
export function getTermExplanation(term) {
  return getTermCache()[term.toLowerCase().trim()] || null;
}

/** 用語を検索用の小文字キーへそろえ、取得した解説を端末キャッシュへ保存する。 */
export function setTermExplanation(term, explanation) {
  const cache = getTermCache();
  cache[term.toLowerCase().trim()] = explanation;
  save(TERM_KEY, cache);
}

// ---- Task Archive（完了タスクの長期保管）----
// ごみ箱とは異なり、完了履歴として残す正常な移動先。
// Completed tasks older than the retention window are moved here by autoArchiveTasks()
const ARCHIVE_KEY = 'mp_task_archive';
const ARCHIVE_AFTER_DAYS = 7;

/** 通常一覧から移された古い完了タスクを返す。ごみ箱とは異なり履歴として保持する。 */
export function getArchivedTasks()         { return load(ARCHIVE_KEY, []); }
/** 完了タスクのアーカイブを端末へ保存し、成功時だけ専用テーブルの同期を予約する。 */
export function saveArchivedTasks(tasks) {
  if (!save(ARCHIVE_KEY, tasks)) return false;
  _notifySync('tasks_archive');
  return true;
}

/** Move completed tasks older than ARCHIVE_AFTER_DAYS to the archive store */
/** 一定期間を過ぎた完了タスクを、削除せずアーカイブへ移す。 */
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

/** 親タスク内の指定サブタスクへ変更を重ね、親の更新日時も進めて保存する。 */
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

/** 親タスクから指定サブタスクだけを取り除き、親タスク全体を保存する。 */
export function deleteSubtask(taskId, subtaskId) {
  const tasks = getTasks();
  const idx   = tasks.findIndex(t => t.id === taskId);
  if (idx < 0) return;
  tasks[idx].subtasks  = (tasks[idx].subtasks || []).filter(s => s.id !== subtaskId);
  tasks[idx].updatedAt = new Date().toISOString();
  saveTasks(tasks);
}

// ---- Global Tags（タスクとメモで候補表示するタグ辞書）----
const TAGS_KEY = 'mp_tags';

/** タスクとメモの入力候補に使う共通タグ辞書を返す。 */
export function getTags()             { return load(TAGS_KEY, []); }
/** 共通タグ辞書を端末へ保存し、成功時だけ端末間同期を予約する。 */
export function saveTags(tags) {
  if (!save(TAGS_KEY, tags)) return false;
  _notifySync('tags');
  return true;
}

/** 前後空白を除いた新しいタグだけを候補辞書へ追加する。 */
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

/** 候補辞書からタグ名を削除する。既存タスク・メモに付いたタグまでは外さない。 */
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

/** ユーザー作成データをJSONバックアップとして書き出す。 */
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

/**
 * バックアップの形式を検証してから各保存先へ戻す。
 * 部分的な入力でも、存在しない項目を空配列で上書きしない。
 */
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

/** アカウント切替後に、一覧化されたユーザーデータだけを端末から外す。 */
export function clearUserContentLocal() {
  USER_CONTENT_KEYS.forEach(key => {
    try { localStorage.removeItem(key); } catch {}
  });
}

/**
 * アカウントに属する保存領域のどれかに内容があるか調べる。
 * JSONが壊れていて読めない場合も、消してよい空データとは見なさずtrueを返す。
 */
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

/** アカウント切替時の退避データを置くIndexedDBを開き、必要ならstoreを初期作成する。 */
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

/** 指定ユーザーの端末スナップショットをIndexedDBへ一件丸ごと保存する。 */
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

/** 指定ユーザーの端末スナップショットをIndexedDBから読み、未保存ならnullを返す。 */
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

/** 復元済みユーザーのスナップショットをIndexedDBから削除する。 */
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

/** アカウント切替前の端末データを IndexedDB に退避する。 */
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

/**
 * 同じユーザーの端末スナップショットを復元する。
 * 現在値が空である項目を中心に補完し、新しい編集を古い控えで潰さない。
 */
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

// ---- Habits（連続日数を扱う習慣トラッカー）----
// Habit shape: { id, title, icon, freq:'daily'|'weekdays'|'weekly', color, streak, createdAt }
// Done shape:  { [habitId]: ['YYYY-MM-DD', ...] }

const HABITS_KEY    = 'mp_habits2';
const HABIT_DONE_KEY = 'mp_habit2_done';

/** 登録済みの習慣一覧を返す。日ごとの完了記録は別領域で管理する。 */
export function getHabits()          { return load(HABITS_KEY, []); }
/** 習慣の定義一覧を端末へ保存する。 */
export function saveHabits(h)        { save(HABITS_KEY, h); }

/** 習慣へ既定のアイコン・頻度・色と新しいIDを補い、一覧へ追加する。 */
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

/** 指定習慣へ題名・頻度・連続日数等の変更を重ねて保存する。 */
export function updateHabit(id, updates) {
  saveHabits(getHabits().map(h => h.id === id ? { ...h, ...updates } : h));
}

/** 習慣本体と、その習慣IDに結び付いた日別完了履歴を両方削除する。 */
export function deleteHabit(id) {
  saveHabits(getHabits().filter(h => h.id !== id));
  const done = load(HABIT_DONE_KEY, {});
  delete done[id];
  save(HABIT_DONE_KEY, done);
}

/** 習慣IDごとに完了日文字列を持つ対応表を返す。 */
export function getHabitDoneMap()    { return load(HABIT_DONE_KEY, {}); }

/** 指定習慣の完了日一覧に、端末の今日が含まれるか判定する。 */
export function isHabitDoneToday(habitId) {
  const todayStr = toDateStr_simple(new Date());
  return (getHabitDoneMap()[habitId] || []).includes(todayStr);
}

/** 今日の完了をトグル。true=完了→未完了, false=未完了→完了 */
/** 今日の完了を切り替え、連続日数の計算に使う日付記録を更新する。 */
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

/** 今日、未完了なら昨日から過去へさかのぼり、途切れない完了日数を数える。 */
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

// ---- Undo Stack（再読み込みで消える、直前操作の一時履歴）----
// 永続履歴ではなく、完了・削除直後の「元に戻す」トースト専用。
// Action shapes:
//   { type:'delete_task',  task }
//   { type:'complete_task', taskId, wasCompleted, completedAt }
//   { type:'delete_event', event }
//   { type:'delete_memo',  memo }

const _undo = [];
const UNDO_MAX = 15;

/** 取り消し関数と説明をスタックへ積み、件数上限を越えた古い操作を捨てる。 */
export function pushUndo(action) {
  _undo.push(action);
  if (_undo.length > UNDO_MAX) _undo.shift();
}

/** `popUndo`: 最後に登録した取り消し操作を履歴から取り出す。 */
export function popUndo() {
  return _undo.length ? _undo.pop() : null;
}

/** 現在のセッションに取り消せる操作が一件以上残っているか返す。 */
export function hasUndo() {
  return _undo.length > 0;
}

/** Perform the undo. Returns the action type string or null. */
/** 最新の一件を取り出し、その操作が持つ復元関数を実行する。 */
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
