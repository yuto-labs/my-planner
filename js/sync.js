// ============================================================
// sync.js — Supabase リアルタイム同期レイヤー
//
// 設計方針:
//   - storage.js が書き込むたびに registerSyncHook で通知を受け取り push
//   - push はテーブルごとに 800ms デバウンスでまとめて実行
//   - 削除は registerSyncDeleteHook で通知を受け取り即時 DELETE
//   - 起動時 pullAll() で最新データをマージ (last-write-wins by updated_at)
//   - pull は localStorage に直書き (storage.js を経由しない → 無限ループ防止)
// ============================================================

import { getClient, getUserId } from './supabase.js';
import { registerSyncHook, registerSyncDeleteHook } from './storage.js';
import {
  taskToRow,  rowToTask,
  eventToRow, rowToEvent,
  goalToRow,  rowToGoal,
  memoToRow,  rowToMemo,
  trashToRow, rowToTrash,
  schedItemToRow, rowToSchedItem,
} from './migrate.js';

// ---- localStorage キーマップ ----
const LS_KEYS = {
  tasks:            'mp_tasks',
  tasks_archive:    'mp_task_archive',
  events:           'mp_events',
  goals:            'mp_goals',
  knowledge_memos:  'mp_knowledge',
  trash_items:      'mp_trash',
  schedule_items:   'mp_schedule',
  tags:             'mp_tags',
};

// ---- 変換関数マップ (localData → DB row) ----
const TO_ROW = {
  tasks:           (item, uid) => taskToRow(item, uid, false),
  tasks_archive:   (item, uid) => taskToRow(item, uid, true),
  events:          (item, uid) => eventToRow(item, uid),
  goals:           (item, uid) => goalToRow(item, uid),
  knowledge_memos: (item, uid) => memoToRow(item, uid),
  trash_items:     (item, uid) => trashToRow(item, uid),
  schedule_items:  (item, uid) => schedItemToRow(item, uid),
  tags:            (name, uid) => ({ user_id: uid, name }),
};

// ---- テーブル名マップ (internal key → Supabase table) ----
const DB_TABLE = {
  tasks:           'tasks',
  tasks_archive:   'tasks',
  events:          'events',
  goals:           'goals',
  knowledge_memos: 'knowledge_memos',
  trash_items:     'trash_items',
  schedule_items:  'schedule_items',
  tags:            'tags',
};

const CONFLICT_KEY = {
  tasks:           'id',
  tasks_archive:   'id',
  events:          'id',
  goals:           'id',
  knowledge_memos: 'id',
  trash_items:     'id',
  schedule_items:  'id',
  tags:            'user_id,name',
};

// ---- Push デバウンスタイマー ----
const _timers = {};
const _deleteTimers = new Map();
const DELETE_GRACE_MS = 5600;
let _realtimeChannel = null;
let _realtimeUserId = null;
let _realtimePullTimer = null;

// ---- init ----

export function initSync() {
  // storage.js から書き込み通知を受け取る
  registerSyncHook((table) => {
    clearTimeout(_timers[table]);
    _timers[table] = setTimeout(() => _pushTable(table), 800);
  });

  // storage.js から削除通知を受け取る
  // payload: { table, id } または { table, name } (タグの場合)
  registerSyncDeleteHook(payload => {
    _scheduleDelete(payload);
  });
}

export async function startRealtimeSync() {
  const client = await getClient();
  const userId = await getUserId();
  if (!client || !userId || !client.channel) return false;
  if (_realtimeChannel && _realtimeUserId === userId) return true;

  await stopRealtimeSync();

  const channel = client.channel(`planner-sync-${userId}`);
  const tables = ['tasks', 'events', 'goals', 'knowledge_memos', 'trash_items', 'schedule_items', 'tags'];

  tables.forEach(table => {
    channel.on('postgres_changes', {
      event: '*',
      schema: 'public',
      table,
      filter: `user_id=eq.${userId}`,
    }, () => {
      clearTimeout(_realtimePullTimer);
      _realtimePullTimer = setTimeout(async () => {
        const pulled = await pullAll(true);
        if (pulled) {
          document.dispatchEvent(new CustomEvent('sync:updated', {
            detail: { source: 'realtime', table },
          }));
        }
      }, 300);
    });
  });

  channel.subscribe();
  _realtimeChannel = channel;
  _realtimeUserId = userId;
  return true;
}

export async function stopRealtimeSync() {
  clearTimeout(_realtimePullTimer);
  _realtimePullTimer = null;
  if (!_realtimeChannel) {
    _realtimeUserId = null;
    return;
  }
  try {
    const client = await getClient();
    await client?.removeChannel?.(_realtimeChannel);
  } catch (e) {
    console.warn('[Sync] stopRealtimeSync failed:', e);
  }
  _realtimeChannel = null;
  _realtimeUserId = null;
}

// ---- Push ----

async function _pushTable(tableKey) {
  const client = await getClient();
  const userId = await getUserId();
  if (!client || !userId) return;

  const lsKey     = LS_KEYS[tableKey];
  const dbTable   = DB_TABLE[tableKey];
  const toRow     = TO_ROW[tableKey];
  const conflict  = CONFLICT_KEY[tableKey];
  if (!lsKey || !toRow) return;

  const localData = _ls(lsKey, []);
  if (!localData.length) return;

  const rows = localData.map(item => toRow(item, userId));
  const { error } = await client.from(dbTable)
    .upsert(rows, { onConflict: conflict });

  if (error) console.warn(`[Sync] push ${tableKey} failed:`, error.message);
}

// ---- Pull (起動時 + オンライン復帰時) ----

export async function pullAll(forceReplace = false) {
  const client = await getClient();
  const userId = await getUserId();
  if (!client || !userId) return false;

  const results = await Promise.allSettled([
    _pullTasks(client, userId, forceReplace),
    _pullEvents(client, userId, forceReplace),
    _pullGoals(client, userId, forceReplace),
    _pullMemos(client, userId),
    _pullTrash(client, userId, forceReplace),
    _pullSchedule(client, userId),
    _pullTags(client, userId, forceReplace),
  ]);

  return results.some(r => r.status === 'fulfilled' && r.value === true);
}

// ---- Pull helpers ----

async function _pullTasks(client, userId, forceReplace = false) {
  const { data, error } = await client
    .from('tasks').select('*').eq('user_id', userId);
  if (error || !data) return;

  const remoteActive  = data.filter(r => !r.archived_at).map(rowToTask);
  const remoteArchive = data.filter(r =>  r.archived_at).map(rowToTask);

  const nextActive = forceReplace ? remoteActive : _merge(_ls('mp_tasks', []), remoteActive);
  const nextArchive = forceReplace ? remoteArchive : _merge(_ls('mp_task_archive', []), remoteArchive);
  const changedActive = _writeIfChanged('mp_tasks', nextActive);
  const changedArchive = _writeIfChanged('mp_task_archive', nextArchive);
  return changedActive || changedArchive;
}

async function _pullEvents(client, userId, forceReplace = false) {
  const { data, error } = await client
    .from('events').select('*').eq('user_id', userId);
  if (error || !data) return;
  const remote = data.map(rowToEvent);
  return _writeIfChanged('mp_events', forceReplace ? remote : _merge(_ls('mp_events', []), remote));
}

async function _pullGoals(client, userId, forceReplace = false) {
  const { data, error } = await client
    .from('goals').select('*').eq('user_id', userId);
  if (error || !data) return;
  const remote = data.map(rowToGoal);
  return _writeIfChanged('mp_goals', forceReplace ? remote : _merge(_ls('mp_goals', []), remote));
}

async function _pullMemos(client, userId) {
  const { data, error } = await client
    .from('knowledge_memos').select('*').eq('user_id', userId);
  if (error || !data) return;
  // Remote is authoritative for existence: memos absent from remote were deleted on another device.
  // Prefer local version only when it's newer (unsent edits).
  const remote = data.map(rowToMemo);
  const local  = _ls('mp_knowledge', []);
  const result = remote.map(r => {
    const l = local.find(li => li.id === r.id);
    if (!l) return r;
    const rt = new Date(r.updatedAt || r.createdAt || 0).getTime();
    const lt = new Date(l.updatedAt || l.createdAt || 0).getTime();
    return lt > rt ? l : r;
  });
  return _writeIfChanged('mp_knowledge', result);
}

async function _pullTrash(client, userId, forceReplace = false) {
  const { data, error } = await client
    .from('trash_items').select('*').eq('user_id', userId);
  if (error || !data) return;
  const remote = data.map(rowToTrash);
  return _writeIfChanged('mp_trash', forceReplace ? remote : _merge(_ls('mp_trash', []), remote));
}

async function _pullSchedule(client, userId) {
  const { data, error } = await client
    .from('schedule_items').select('*').eq('user_id', userId);
  if (error || !data) return;
  // Remote is authoritative for existence: items absent from remote were deleted on another device.
  // Prefer local version only when it's newer (unsent edits).
  const remote = data.map(rowToSchedItem);
  const local  = _ls('mp_schedule', []);
  const result = remote.map(r => {
    const l = local.find(li => li.id === r.id);
    if (!l) return r;
    const rt = new Date(r.updatedAt || r.createdAt || 0).getTime();
    const lt = new Date(l.updatedAt || l.createdAt || 0).getTime();
    return lt > rt ? l : r;
  });
  return _writeIfChanged('mp_schedule', result);
}

async function _pullTags(client, userId, forceReplace = false) {
  const { data, error } = await client
    .from('tags').select('name').eq('user_id', userId);
  if (error || !data) return;
  const remoteTags = data.map(r => r.name);
  const localTags  = _ls('mp_tags', []);
  const merged = forceReplace
    ? [...new Set(remoteTags)].sort()
    : [...new Set([...localTags, ...remoteTags])].sort();
  return _writeIfChanged('mp_tags', merged);
}

// ---- Merge strategy: last-write-wins by updated_at ----

function _merge(local, remote) {
  const map = new Map(local.map(item => [item.id, item]));
  for (const r of remote) {
    const l = map.get(r.id);
    if (!l) {
      map.set(r.id, r);
    } else {
      const rt = new Date(r.updatedAt  || r.createdAt  || 0).getTime();
      const lt = new Date(l.updatedAt  || l.createdAt  || 0).getTime();
      if (rt > lt) map.set(r.id, r);
    }
  }
  return [...map.values()];
}

// ---- Stale pull (visibilitychange / foreground return) ----

let _lastPullAt = 0;

export async function pullIfStale(minAgeMs = 30_000, forceReplace = false) {
  if (Date.now() - _lastPullAt < minAgeMs) return false;
  const pulled = await pullAll(forceReplace);
  _lastPullAt = Date.now();
  return pulled;
}

// ---- Utils ----

function _scheduleDelete(payload) {
  const key = _deleteKey(payload);
  clearTimeout(_deleteTimers.get(key));
  _deleteTimers.set(key, setTimeout(async () => {
    _deleteTimers.delete(key);
    if (!_isStillDeleted(payload)) return;

    const client = await getClient();
    const userId = await getUserId();
    if (!client || !userId) return;

    try {
      if (payload.table === 'tags' && payload.name) {
        await client.from('tags')
          .delete()
          .eq('user_id', userId)
          .eq('name', payload.name);
      } else if (payload.id) {
        await client.from(payload.table)
          .delete()
          .eq('id', payload.id)
          .eq('user_id', userId);
      }
    } catch (e) {
      console.warn(`[Sync] delete ${payload.table} failed:`, e);
    }
  }, DELETE_GRACE_MS));
}

function _deleteKey({ table, id, name }) {
  return `${table}:${id || name || ''}`;
}

function _isStillDeleted({ table, id, name }) {
  if (table === 'tags') {
    return !_ls('mp_tags', []).includes(name);
  }

  if (!id) return true;

  if (table === 'tasks') {
    return !_hasId('mp_tasks', id) && !_hasId('mp_task_archive', id);
  }

  if (table === 'trash_items') {
    return !_hasId('mp_trash', id);
  }

  const lsKey = LS_KEYS[table];
  if (!lsKey) return true;
  return !_hasId(lsKey, id);
}

function _hasId(key, id) {
  return _ls(key, []).some(item => item?.id === id);
}

function _writeIfChanged(key, value) {
  const next = JSON.stringify(value);
  const prev = localStorage.getItem(key);
  if (prev === next) return false;
  localStorage.setItem(key, next);
  return true;
}

function _ls(key, fb) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fb; }
  catch { return fb; }
}
