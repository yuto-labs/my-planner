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
const DELETE_GRACE_MS = 250;
const DELETE_TOMBSTONE_KEY = 'mp_sync_pending_deletes';
const DELETE_TOMBSTONE_TTL_MS = 10 * 60 * 1000;
const RECENT_UPSERT_KEY = 'mp_sync_recent_upserts';
const RECENT_UPSERT_TTL_MS = 20 * 1000;
const PUSH_RETRY_MS = 2500;
let _realtimeChannel = null;
let _realtimeUserId = null;
let _realtimePullTimer = null;

// ---- init ----

export function initSync() {
  // storage.js から書き込み通知を受け取る
  registerSyncHook((table) => {
    _markRecentUpserts(table);
    clearTimeout(_timers[table]);
    _timers[table] = setTimeout(() => {
      _timers[table] = null;
      _pushTable(table);
    }, 800);
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

export function hasPendingSyncWork() {
  return Object.values(_timers).some(Boolean) || _deleteTimers.size > 0;
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

  if (error) {
    console.warn(`[Sync] push ${tableKey} failed:`, error.message);
    _schedulePushRetry(tableKey);
    return false;
  }

  _clearRecentUpsertsForTable(tableKey);
  return true;
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
    _pullMemos(client, userId, forceReplace),
    _pullTrash(client, userId, forceReplace),
    _pullSchedule(client, userId, forceReplace),
    _pullTags(client, userId, forceReplace),
  ]);

  return results.some(r => r.status === 'fulfilled' && r.value === true);
}

// ---- Pull helpers ----

async function _pullTasks(client, userId, forceReplace = false) {
  const { data, error } = await client
    .from('tasks').select('*').eq('user_id', userId);
  if (error || !data) return;

  const remoteActive  = _filterPendingDeletes('tasks', data.filter(r => !r.archived_at).map(rowToTask));
  const remoteArchive = _filterPendingDeletes('tasks', data.filter(r =>  r.archived_at).map(rowToTask));

  const nextActive = forceReplace ? _mergeProtectedLocalItems('tasks', 'mp_tasks', remoteActive) : _merge(_ls('mp_tasks', []), remoteActive);
  const nextArchive = forceReplace ? _mergeProtectedLocalItems('tasks_archive', 'mp_task_archive', remoteArchive) : _merge(_ls('mp_task_archive', []), remoteArchive);
  const changedActive = _writeIfChanged('mp_tasks', nextActive);
  const changedArchive = _writeIfChanged('mp_task_archive', nextArchive);
  return changedActive || changedArchive;
}

async function _pullEvents(client, userId, forceReplace = false) {
  const { data, error } = await client
    .from('events').select('*').eq('user_id', userId);
  if (error || !data) return;
  const remote = _filterPendingDeletes('events', data.map(rowToEvent));
  return _writeIfChanged('mp_events', forceReplace ? _mergeProtectedLocalItems('events', 'mp_events', remote) : _merge(_ls('mp_events', []), remote));
}

async function _pullGoals(client, userId, forceReplace = false) {
  const { data, error } = await client
    .from('goals').select('*').eq('user_id', userId);
  if (error || !data) return;
  const remote = _filterPendingDeletes('goals', data.map(rowToGoal));
  return _writeIfChanged('mp_goals', forceReplace ? _mergeProtectedLocalItems('goals', 'mp_goals', remote) : _merge(_ls('mp_goals', []), remote));
}

async function _pullMemos(client, userId, forceReplace = false) {
  const { data, error } = await client
    .from('knowledge_memos').select('*').eq('user_id', userId);
  if (error || !data) return;
  const remote = _filterPendingDeletes('knowledge_memos', data.map(rowToMemo));
  return _writeIfChanged('mp_knowledge', forceReplace
    ? _mergeProtectedLocalItems('knowledge_memos', 'mp_knowledge', remote)
    : _merge(_ls('mp_knowledge', []), remote));
}

async function _pullTrash(client, userId, forceReplace = false) {
  const { data, error } = await client
    .from('trash_items').select('*').eq('user_id', userId);
  if (error || !data) return;
  const remote = _filterPendingDeletes('trash_items', data.map(rowToTrash));
  return _writeIfChanged('mp_trash', forceReplace ? _mergeProtectedLocalItems('trash_items', 'mp_trash', remote) : _merge(_ls('mp_trash', []), remote));
}

async function _pullSchedule(client, userId, forceReplace = false) {
  const { data, error } = await client
    .from('schedule_items').select('*').eq('user_id', userId);
  if (error || !data) return;
  const remote = _filterPendingDeletes('schedule_items', data.map(rowToSchedItem));
  return _writeIfChanged('mp_schedule', forceReplace
    ? _mergeProtectedLocalItems('schedule_items', 'mp_schedule', remote)
    : _merge(_ls('mp_schedule', []), remote));
}

async function _pullTags(client, userId, forceReplace = false) {
  const { data, error } = await client
    .from('tags').select('name').eq('user_id', userId);
  if (error || !data) return;
  const remoteTags = _filterPendingTagDeletes(data.map(r => r.name));
  const localTags  = _ls('mp_tags', []);
  const merged = forceReplace
    ? _mergeRecentLocalTags(remoteTags)
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
  _markPendingDelete(payload);
  const key = _deleteKey(payload);
  clearTimeout(_deleteTimers.get(key));
  _deleteTimers.set(key, setTimeout(async () => {
    _deleteTimers.delete(key);
    if (!_isStillDeleted(payload)) {
      _clearPendingDelete(payload);
      return;
    }

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
      _clearPendingDelete(payload);
    } catch (e) {
      console.warn(`[Sync] delete ${payload.table} failed:`, e);
      if (_isStillDeleted(payload)) _scheduleDelete(payload);
      else _clearPendingDelete(payload);
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

function _getPendingDeletes() {
  const now = Date.now();
  const all = _ls(DELETE_TOMBSTONE_KEY, []);
  const filtered = all.filter(entry => {
    if (!entry?.table) return false;
    if ((entry.expiresAt || 0) < now) return false;
    if (!_isStillDeleted(entry)) return false;
    return true;
  });
  if (JSON.stringify(filtered) !== JSON.stringify(all)) {
    localStorage.setItem(DELETE_TOMBSTONE_KEY, JSON.stringify(filtered));
  }
  return filtered;
}

function _savePendingDeletes(entries) {
  localStorage.setItem(DELETE_TOMBSTONE_KEY, JSON.stringify(entries));
}

function _markPendingDelete(payload) {
  const entries = _getPendingDeletes();
  const key = _deleteKey(payload);
  const next = {
    table: payload.table,
    id: payload.id || null,
    name: payload.name || null,
    expiresAt: Date.now() + DELETE_TOMBSTONE_TTL_MS,
  };
  const idx = entries.findIndex(entry => _deleteKey(entry) === key);
  if (idx >= 0) entries[idx] = next;
  else entries.push(next);
  _savePendingDeletes(entries);
}

function _clearPendingDelete(payload) {
  const key = _deleteKey(payload);
  const entries = _getPendingDeletes().filter(entry => _deleteKey(entry) !== key);
  _savePendingDeletes(entries);
}

function _filterPendingDeletes(table, items) {
  const deletedIds = new Set(
    _getPendingDeletes()
      .filter(entry => entry.table === table && entry.id)
      .map(entry => entry.id)
  );
  if (!deletedIds.size) return items;
  return items.filter(item => !deletedIds.has(item.id));
}

function _filterPendingTagDeletes(tags) {
  const deletedNames = new Set(
    _getPendingDeletes()
      .filter(entry => entry.table === 'tags' && entry.name)
      .map(entry => entry.name)
  );
  if (!deletedNames.size) return tags;
  return tags.filter(name => !deletedNames.has(name));
}

function _getRecentUpserts() {
  const now = Date.now();
  const all = _ls(RECENT_UPSERT_KEY, []);
  const filtered = all.filter(entry => {
    if (!entry?.table) return false;
    if ((entry.expiresAt || 0) < now) return false;
    if (!_isStillPresent(entry)) return false;
    return true;
  });
  if (JSON.stringify(filtered) !== JSON.stringify(all)) {
    localStorage.setItem(RECENT_UPSERT_KEY, JSON.stringify(filtered));
  }
  return filtered;
}

function _saveRecentUpserts(entries) {
  localStorage.setItem(RECENT_UPSERT_KEY, JSON.stringify(entries));
}

function _markRecentUpserts(tableKey) {
  const entries = _getRecentUpserts();
  const expiresAt = Date.now() + RECENT_UPSERT_TTL_MS;
  const threshold = Date.now() - RECENT_UPSERT_TTL_MS;

  if (tableKey === 'tags') {
    const names = _ls('mp_tags', []);
    const survivors = entries.filter(entry => entry.table !== 'tags');
    names.forEach(name => {
      survivors.push({ table: 'tags', name, expiresAt });
    });
    _saveRecentUpserts(survivors);
    return;
  }

  const lsKey = LS_KEYS[tableKey];
  if (!lsKey) return;
  const items = _ls(lsKey, []);
  const survivors = entries.filter(entry => entry.table !== tableKey);
  items.forEach(item => {
    if (!item?.id) return;
    const touchedAt = new Date(item.updatedAt || item.createdAt || 0).getTime();
    if (!Number.isFinite(touchedAt) || touchedAt < threshold) return;
    survivors.push({ table: tableKey, id: item.id, expiresAt });
  });
  _saveRecentUpserts(survivors);
}

function _isStillPresent(entry) {
  if (entry.table === 'tags') {
    return _ls('mp_tags', []).includes(entry.name);
  }
  const lsKey = LS_KEYS[entry.table];
  if (!lsKey || !entry.id) return false;
  return _hasId(lsKey, entry.id);
}

function _appendRecentLocalItems(tableKey, lsKey, remoteItems) {
  const recentIds = new Set(
    _getRecentUpserts()
      .filter(entry => entry.table === tableKey && entry.id)
      .map(entry => entry.id)
  );
  if (!recentIds.size) return remoteItems;
  const localItems = _ls(lsKey, []);
  const remoteIds = new Set(remoteItems.map(item => item.id));
  const appended = localItems.filter(item => item?.id && recentIds.has(item.id) && !remoteIds.has(item.id));
  return appended.length ? [...remoteItems, ...appended] : remoteItems;
}

function _mergeProtectedLocalItems(tableKey, lsKey, remoteItems) {
  const localItems = _ls(lsKey, []);
  const localById = new Map(localItems.filter(item => item?.id).map(item => [item.id, item]));
  const recentIds = new Set(
    _getRecentUpserts()
      .filter(entry => entry.table === tableKey && entry.id)
      .map(entry => entry.id)
  );

  const merged = remoteItems.map(remote => {
    const local = localById.get(remote.id);
    if (!local) return remote;
    return _updatedTs(local) >= _updatedTs(remote) ? local : remote;
  });

  const remoteIds = new Set(remoteItems.map(item => item.id));
  const appended = localItems.filter(item => item?.id && recentIds.has(item.id) && !remoteIds.has(item.id));
  return appended.length ? [...merged, ...appended] : merged;
}

function _mergeRecentLocalTags(remoteTags) {
  const recentNames = new Set(
    _getRecentUpserts()
      .filter(entry => entry.table === 'tags' && entry.name)
      .map(entry => entry.name)
  );
  return [...new Set([...remoteTags, ..._ls('mp_tags', []).filter(name => recentNames.has(name))])].sort();
}

function _updatedTs(item) {
  const ts = new Date(item?.updatedAt || item?.createdAt || 0).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function _schedulePushRetry(tableKey) {
  clearTimeout(_timers[tableKey]);
  _timers[tableKey] = setTimeout(() => {
    _timers[tableKey] = null;
    _pushTable(tableKey);
  }, PUSH_RETRY_MS);
}

function _clearRecentUpsertsForTable(tableKey) {
  if (!LS_KEYS[tableKey] && tableKey !== 'tags') return;
  const entries = _getRecentUpserts().filter(entry => entry.table !== tableKey);
  _saveRecentUpserts(entries);
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
