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

import { getActiveUserId, getClient, getUserId } from './supabase.js';
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
  review_schedule:  'mp_reviews',
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
  review_schedule: ([memoId, entry], uid) => reviewEntryToRow(memoId, entry, uid),
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
  review_schedule: 'review_schedule',
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
  review_schedule: 'user_id,memo_id',
};

// ---- Push デバウンスタイマー ----
const _timers = {};
const _deleteTimers = new Map();
const _pushPromises = new Map();
const DELETE_GRACE_MS = 250;
const DELETE_RETRY_MS = 5000;
const DELETE_TOMBSTONE_KEY = 'mp_sync_pending_deletes';
const RECENT_UPSERT_KEY = 'mp_sync_recent_upserts';
const SYNC_STATUS_KEY = 'mp_sync_status';
const EVENT_BACKFILL_VERSION = 1;
const EVENT_REMOTE_SNAPSHOT_VERSION = 1;
const EVENT_SYNC_BACKUP_LIMIT = 3;
const SYNC_SNAPSHOT_VERSION = 1;
const SYNC_BACKUP_LIMIT = 3;
const REMOTE_MISSING_STATE_VERSION = 1;
const RECENT_UPSERT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RECENT_WRITE_WINDOW_MS = 2 * 60 * 1000;
const PUSH_RETRY_MS = 2500;
const PUSH_DEBOUNCE_MS = {
  events: 200,
  knowledge_memos: 350,
  default: 650,
};
const PULL_PAGE_SIZE = 1000;
let _realtimeChannel = null;
let _realtimeUserId = null;
let _realtimePullTimer = null;
let _syncEpoch = 0;

// ---- init ----

export function initSync() {
  // storage.js から書き込み通知を受け取る
  registerSyncHook((table) => {
    _markRecentUpserts(table);
    clearTimeout(_timers[table]);
    _timers[table] = setTimeout(() => {
      _timers[table] = null;
      _pushTable(table);
    }, PUSH_DEBOUNCE_MS[table] ?? PUSH_DEBOUNCE_MS.default);
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
  if (_realtimeChannel && _realtimeUserId === userId) {
    _resumePersistedSyncWork();
    return true;
  }

  await stopRealtimeSync();

  const channel = client.channel(`planner-sync-${userId}`);
  const tables = ['tasks', 'events', 'goals', 'knowledge_memos', 'trash_items', 'schedule_items', 'tags', 'review_schedule'];

  tables.forEach(table => {
    channel.on('postgres_changes', {
      event: '*',
      schema: 'public',
      table,
      filter: `user_id=eq.${userId}`,
    }, () => {
      clearTimeout(_realtimePullTimer);
      _realtimePullTimer = setTimeout(() => {
        document.dispatchEvent(new CustomEvent('sync:remote-change', {
          detail: { source: 'realtime', table },
        }));
      }, 300);
    });
  });

  channel.subscribe();
  _realtimeChannel = channel;
  _realtimeUserId = userId;
  _resumePersistedSyncWork();
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
  return Object.values(_timers).some(Boolean) || _deleteTimers.size > 0 || _pushPromises.size > 0;
}

export async function resetSyncForUserSwitch({ flush = false } = {}) {
  if (flush) {
    try {
      const result = await flushPendingSync();
      if (result.attempted > result.succeeded) return false;
    } catch (error) {
      console.warn('[Sync] could not flush before account change:', error);
      return false;
    }
  }

  _syncEpoch += 1;
  Object.keys(_timers).forEach(table => {
    clearTimeout(_timers[table]);
    _timers[table] = null;
  });
  _deleteTimers.forEach(timer => clearTimeout(timer));
  _deleteTimers.clear();
  clearTimeout(_realtimePullTimer);
  _realtimePullTimer = null;
  await stopRealtimeSync();
  await Promise.allSettled([..._pushPromises.values()]);
  localStorage.removeItem(DELETE_TOMBSTONE_KEY);
  localStorage.removeItem(RECENT_UPSERT_KEY);
  localStorage.removeItem(SYNC_STATUS_KEY);
  return true;
}

export function getSyncStatus() {
  return _ls(SYNC_STATUS_KEY, {
    lastPushAt: null,
    lastPullAt: null,
    lastErrorAt: null,
    lastErrorTable: null,
    lastErrorMessage: null,
    tableErrors: {},
  });
}

export async function backfillLocalEvents() {
  const client = await getClient();
  const userId = await getUserId();
  if (!client || !userId) return false;

  const markerKey = `mp_event_sync_backfill_v${EVENT_BACKFILL_VERSION}:${userId}`;
  if (localStorage.getItem(markerKey) === '1') return true;

  const localEvents = _ls('mp_events', []).filter(event => event?.id);
  if (!localEvents.length) {
    localStorage.setItem(markerKey, '1');
    return true;
  }

  let { data: remoteRows, error } = await _selectAllForUser(
    client,
    'events',
    'id,updated_at',
    userId,
    'id'
  );
  if (error) {
    const rpcResult = await _getPersonalCalendarRows(client);
    if (rpcResult.error) {
      _recordSyncError('events', error, 'pull');
      return false;
    }
    remoteRows = rpcResult.data;
  }

  const remoteById = new Map((remoteRows || []).map(row => [row.id, row]));
  const missingOrNewer = localEvents.filter(event => {
    const remote = remoteById.get(event.id);
    if (!remote) return true;
    const localTime = new Date(event.updatedAt || event.createdAt || 0).getTime();
    const remoteTime = new Date(remote.updated_at || 0).getTime();
    return Number.isFinite(localTime) && Number.isFinite(remoteTime) && localTime > remoteTime;
  });

  if (missingOrNewer.length) {
    const rows = missingOrNewer.map(event => eventToRow(event, userId));
    const result = await _upsertRowsCompat(client, 'events', rows, 'id');
    if (result.error) {
      _recordSyncError('events', result.error);
      return false;
    }
  }

  localStorage.setItem(markerKey, '1');
  _recordSyncSuccess('push', 'events');
  return true;
}

export async function flushPendingSync() {
  const pendingDeletes = _getPendingDeletes();
  const tables = new Set([
    ...Object.entries(_timers).filter(([, timer]) => !!timer).map(([table]) => table),
    ..._getRecentUpserts().map(entry => entry.table).filter(Boolean),
  ]);
  if (!tables.size && !pendingDeletes.length) return { attempted: 0, succeeded: 0 };

  tables.forEach(table => {
    clearTimeout(_timers[table]);
    _timers[table] = null;
  });
  pendingDeletes.forEach(payload => {
    const key = _deleteKey(payload);
    clearTimeout(_deleteTimers.get(key));
    _deleteTimers.delete(key);
  });
  const results = await Promise.all([
    ...[...tables].map(table => _pushTable(table)),
    ...pendingDeletes.map(payload => _executeDelete(payload)),
  ]);
  return {
    attempted: results.length,
    succeeded: results.filter(Boolean).length,
  };
}

// ---- Push ----

function _pushTable(tableKey) {
  if (_pushPromises.has(tableKey)) return _pushPromises.get(tableKey);
  const epoch = _syncEpoch;
  const promise = _pushTableNow(tableKey, epoch).finally(() => {
    if (_pushPromises.get(tableKey) === promise) _pushPromises.delete(tableKey);
  });
  _pushPromises.set(tableKey, promise);
  return promise;
}

async function _pushTableNow(tableKey, epoch = _syncEpoch) {
  const client = await getClient();
  const userId = await getUserId();
  if (!client || !userId || epoch !== _syncEpoch) return false;
  const activeUserId = getActiveUserId();
  if (activeUserId && activeUserId !== userId) {
    _recordSyncError(tableKey, new Error('Active local user does not match the signed-in user'));
    return false;
  }

  const lsKey     = LS_KEYS[tableKey];
  const dbTable   = DB_TABLE[tableKey];
  const toRow     = TO_ROW[tableKey];
  const conflict  = CONFLICT_KEY[tableKey];
  if (!lsKey || !toRow) return;

  const localData = _ls(lsKey, tableKey === 'review_schedule' ? {} : []);
  const sourceItems = tableKey === 'review_schedule' ? Object.entries(localData) : localData;
  if (!sourceItems.length) return;

  const pendingEntries = _getRecentUpserts()
    .filter(entry => entry.table === tableKey);
  const recentIds = new Set(pendingEntries.filter(entry => entry.id).map(entry => entry.id));
  const recentNames = new Set(pendingEntries.filter(entry => entry.name).map(entry => entry.name));
  const dirtyItems = recentIds.size && tableKey !== 'review_schedule'
    ? sourceItems.filter(item => item?.id && recentIds.has(item.id))
    : recentNames.size && tableKey === 'tags'
      ? sourceItems.filter(item => recentNames.has(item))
    : sourceItems;
  if (!dirtyItems.length) return true;
  const rows = dirtyItems.map(item => toRow(item, userId));
  if (epoch !== _syncEpoch) return false;
  const { error } = await _upsertRowsCompat(client, dbTable, rows, conflict);

  if (error) {
    console.warn(`[Sync] push ${tableKey} failed:`, error.message);
    _recordSyncError(tableKey, error);
    _schedulePushRetry(tableKey);
    return false;
  }

  _recordSyncSuccess('push', tableKey);
  _clearSentUpserts(tableKey, pendingEntries);
  if (_getRecentUpserts().some(entry => entry.table === tableKey)) {
    _schedulePushRetry(tableKey);
  }
  return true;
}

async function _upsertRowsCompat(client, dbTable, rows, conflict) {
  let attemptRows = rows;
  const strippedColumns = [];

  const maxAttempts = Math.min(32, Object.keys(attemptRows[0] || {}).length + 1);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const result = await client.from(dbTable)
      .upsert(attemptRows, { onConflict: conflict });
    if (!result.error) {
      if (strippedColumns.length) {
        console.warn(`[Sync] ${dbTable}: skipped unsupported cloud column(s): ${strippedColumns.join(', ')}`);
      }
      return result;
    }

    const missingColumn = _missingColumnFromError(result.error);
    if (!missingColumn || !attemptRows.some(row => Object.hasOwn(row, missingColumn))) {
      return result;
    }
    const dataBearingColumns = new Set([
      'attachments', 'blocks', 'memo', 'shared_group_ids', 'share_visibility',
      'hide_from_month', 'recurrence', 'subtasks', 'tags',
    ]);
    if (dataBearingColumns.has(missingColumn)) {
      return {
        error: new Error(
          `${dbTable}.${missingColumn} is missing in Supabase. Apply the current schema before syncing so data is not discarded.`
        ),
      };
    }

    strippedColumns.push(missingColumn);
    attemptRows = attemptRows.map(row => {
      const next = { ...row };
      delete next[missingColumn];
      return next;
    });
  }

  return {
    error: new Error(`Could not sync ${dbTable}: too many unsupported cloud columns (${strippedColumns.join(', ')})`),
  };
}

function _missingColumnFromError(error) {
  const text = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`;
  const quoted = text.match(/'([^']+)'\s+column/i);
  if (quoted?.[1]) return quoted[1];
  const named = text.match(/column\s+["']?([a-zA-Z0-9_]+)["']?\s+(?:does not exist|not found|could not find)/i);
  return named?.[1] || null;
}

// ---- Pull (起動時 + オンライン復帰時) ----

export async function pullAll(forceReplace = false) {
  const client = await getClient();
  const userId = await getUserId();
  if (!client || !userId) return false;

  const pulls = [
    ['tasks', _pullTasks(client, userId, forceReplace)],
    ['events', _pullEvents(client, userId, forceReplace)],
    ['goals', _pullGoals(client, userId, forceReplace)],
    ['knowledge_memos', _pullMemos(client, userId, forceReplace)],
    ['trash_items', _pullTrash(client, userId, forceReplace)],
    ['schedule_items', _pullSchedule(client, userId, forceReplace)],
    ['tags', _pullTags(client, userId, forceReplace)],
    ['review_schedule', _pullReviewSchedule(client, userId, forceReplace)],
  ];
  const results = await Promise.allSettled(pulls.map(([, promise]) => promise));

  const firstErrorIndex = results.findIndex(r => r.status === 'rejected');
  if (firstErrorIndex >= 0) {
    _recordSyncError(pulls[firstErrorIndex][0], results[firstErrorIndex].reason, 'pull');
  }
  else _recordSyncSuccess('pull');
  return results.some(r => r.status === 'fulfilled' && r.value === true);
}

// ---- Pull helpers ----

export async function selectAllForUser(client, table, columns, userId, orderColumn, pageSize = PULL_PAGE_SIZE) {
  const rows = [];
  let from = 0;

  while (true) {
    let query = client
      .from(table)
      .select(columns)
      .eq('user_id', userId);
    if (orderColumn) query = query.order(orderColumn, { ascending: true });
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) return { data: null, error };

    const page = Array.isArray(data) ? data : [];
    rows.push(...page);
    if (page.length < pageSize) return { data: rows, error: null };
    from += pageSize;
  }
}

const _selectAllForUser = selectAllForUser;

async function _pullTasks(client, userId, forceReplace = false) {
  const { data, error } = await _selectAllForUser(client, 'tasks', '*', userId, 'id');
  if (error) throw error;
  if (!data) return;

  const remote = _filterPendingDeletes('tasks', data.map(rowToTask));
  const confirmedDeleteIds = await _getConfirmedTrashEntityIds(client, userId, ['task']);
  const localActive = _ls('mp_tasks', []);
  const localArchive = _ls('mp_task_archive', []);
  const local = _dedupeById([...localActive, ...localArchive]);
  const next = await _reconcileRemoteCollection({
    client,
    userId,
    collectionKey: 'tasks',
    dbTable: 'tasks',
    local,
    remote,
    toRow: (task, uid) => taskToRow(task, uid, !!task.archivedAt),
    pendingDeleteTable: 'tasks',
    retryKeys: ['tasks', 'tasks_archive'],
    confirmedDeleteIds,
  });
  const nextActive = next.filter(task => !task.archivedAt);
  const nextArchive = next.filter(task => !!task.archivedAt);
  const changedActive = _writeCollectionAfterSync('mp_tasks', localActive, nextActive, userId, 'tasks_active');
  const changedArchive = _writeCollectionAfterSync('mp_task_archive', localArchive, nextArchive, userId, 'tasks_archive');
  return changedActive || changedArchive;
}

async function _pullEvents(client, userId, forceReplace = false) {
  let { data, error } = await _selectAllForUser(client, 'events', '*', userId, 'id');
  if (error) {
    const rpcResult = await _getPersonalCalendarRows(client);
    if (rpcResult.error) throw error;
    data = rpcResult.data;
    console.warn('[Sync] events: direct read failed; used personal calendar RPC fallback.');
  }
  if (!data) return;
  const remote = _filterPendingDeletes('events', data.map(rowToEvent));
  const confirmedDeleteIds = await _getConfirmedTrashEntityIds(client, userId, ['event']);
  const local = _ls('mp_events', []);
  const next = await _reconcileRemoteCollection({
    client,
    userId,
    collectionKey: 'events',
    dbTable: 'events',
    local,
    remote,
    toRow: eventToRow,
    pendingDeleteTable: 'events',
    retryKeys: ['events'],
    confirmedDeleteIds,
  });
  return _writeCollectionAfterSync('mp_events', local, next, userId, 'events');
}

async function _getPersonalCalendarRows(client) {
  const v2 = await client.rpc('get_personal_calendar_events_v2');
  if (!v2.error) return v2;
  return client.rpc('get_personal_calendar_events');
}

// A remote row disappearing is not enough proof that it was intentionally
// deleted. RLS/configuration/network issues can make a valid collection look
// empty. Deletions made by this app always create a trash row first, so only
// that durable record is allowed to remove another device's local copy.
async function _getConfirmedTrashEntityIds(client, userId, entityTypes) {
  const result = await _selectAllForUser(
    client,
    'trash_items',
    'entity_id,entity_type',
    userId,
    'id'
  );
  if (result.error) {
    console.warn('[Sync] could not verify deletion records; preserving local data:', result.error);
    return new Set();
  }
  const accepted = new Set(entityTypes);
  return new Set(
    (result.data || [])
      .filter(item => accepted.has(item.entity_type) && item.entity_id)
      .map(item => item.entity_id)
  );
}

export function reconcileEventCollections(
  local,
  remote,
  knownRemote = {},
  pendingDeleteIds = new Set(),
  protectedMissingIds = new Set(),
  restoreMissingIds = new Set()
) {
  const deletedIds = pendingDeleteIds instanceof Set ? pendingDeleteIds : new Set(pendingDeleteIds);
  const protectedIds = protectedMissingIds instanceof Set
    ? protectedMissingIds
    : new Set(protectedMissingIds);
  const restorableIds = restoreMissingIds instanceof Set
    ? restoreMissingIds
    : new Set(restoreMissingIds);
  const availableRemote = remote.filter(event => event?.id && !deletedIds.has(event.id));
  const remoteById = new Map(availableRemote.map(event => [event.id, event]));
  const localById = new Map(
    local
      .filter(event => event?.id && !deletedIds.has(event.id))
      .map(event => [event.id, event])
  );
  const pushCandidates = new Map();
  const next = availableRemote.map(remoteEvent => {
    const localEvent = localById.get(remoteEvent.id);
    if (!localEvent) return remoteEvent;
    if (_syncVersion(localEvent) > _syncVersion(remoteEvent)) {
      pushCandidates.set(localEvent.id, localEvent);
      return localEvent;
    }
    return remoteEvent;
  });

  for (const localEvent of localById.values()) {
    if (remoteById.has(localEvent.id)) continue;
    if (restorableIds.has(localEvent.id)) {
      next.push(localEvent);
      pushCandidates.set(localEvent.id, localEvent);
      continue;
    }
    const knownVersion = Number(knownRemote[localEvent.id]);
    const localVersion = _syncVersion(localEvent);
    const neverSeenInCloud = !Number.isFinite(knownVersion) || knownVersion <= 0;
    const editedAfterLastCloudCopy = Number.isFinite(localVersion) && localVersion > knownVersion;
    if (protectedIds.has(localEvent.id) && !editedAfterLastCloudCopy) {
      next.push(localEvent);
      continue;
    }
    if (neverSeenInCloud || editedAfterLastCloudCopy) {
      next.push(localEvent);
      pushCandidates.set(localEvent.id, localEvent);
    }
  }

  return { next, pushCandidates: [...pushCandidates.values()] };
}

export function reconcileNamedCollections(
  local,
  remote,
  knownRemote = {},
  pendingDeleteNames = new Set(),
  recentNames = new Set(),
  protectedMissingNames = new Set()
) {
  const deleted = pendingDeleteNames instanceof Set ? pendingDeleteNames : new Set(pendingDeleteNames);
  const recent = recentNames instanceof Set ? recentNames : new Set(recentNames);
  const protectedNames = protectedMissingNames instanceof Set
    ? protectedMissingNames
    : new Set(protectedMissingNames);
  const remoteNames = [...new Set((remote || []).filter(Boolean))].filter(name => !deleted.has(name));
  const next = new Set(remoteNames);
  const pushCandidates = [];

  [...new Set((local || []).filter(Boolean))].forEach(name => {
    if (deleted.has(name) || next.has(name)) return;
    if (protectedNames.has(name) && !recent.has(name)) {
      next.add(name);
      return;
    }
    if (!knownRemote[name] || recent.has(name)) {
      next.add(name);
      pushCandidates.push(name);
    }
  });

  return { next: [...next].sort(), pushCandidates };
}

async function _reconcileRemoteCollection({
  client,
  userId,
  collectionKey,
  dbTable,
  local,
  remote,
  toRow,
  conflict = 'id',
  pendingDeleteTable = dbTable,
  retryKeys = [collectionKey],
  confirmedDeleteIds = new Set(),
  restoreMissingToCloud = false,
}) {
  if (getActiveUserId() !== userId) return local;
  const snapshotKey = _remoteSnapshotKey(collectionKey, userId);
  const knownRemote = _ls(snapshotKey, {});
  const localPendingDeleteIds = _getPendingDeletes()
    .filter(entry => entry.table === pendingDeleteTable && entry.id)
    .map(entry => entry.id);
  const pendingDeleteIds = new Set([
    ...(confirmedDeleteIds instanceof Set ? confirmedDeleteIds : new Set(confirmedDeleteIds)),
    ...localPendingDeleteIds,
  ]);
  const protectedMissingIds = _trackRemoteMissingItems({
    collectionKey,
    userId,
    local,
    remote,
    knownRemote,
    pendingDeleteIds,
  });
  const remoteIds = new Set(remote.filter(item => item?.id).map(item => item.id));
  const restoreMissingIds = restoreMissingToCloud
    ? new Set(
      local
        .filter(item => item?.id && !remoteIds.has(item.id) && !pendingDeleteIds.has(item.id))
        .map(item => item.id)
    )
    : new Set();
  const reconciled = reconcileEventCollections(
    local,
    remote,
    knownRemote,
    pendingDeleteIds,
    protectedMissingIds,
    restoreMissingIds
  );
  const pushCandidates = new Map(reconciled.pushCandidates.map(item => [item.id, item]));
  let pushedIds = new Set();

  if (pushCandidates.size) {
    const rows = [...pushCandidates.values()].map(item => toRow(item, userId));
    const result = await _upsertRowsCompat(client, dbTable, rows, conflict);
    if (result.error) {
      _recordSyncError(dbTable, result.error);
      retryKeys.forEach(_schedulePushRetry);
    } else {
      pushedIds = new Set(pushCandidates.keys());
      retryKeys.forEach(key => _recordSyncSuccess('push', key));
    }
  }

  const nextRemoteSnapshot = Object.fromEntries(
    remote.filter(item => item?.id).map(item => [item.id, _syncVersion(item)])
  );
  pushedIds.forEach(id => {
    nextRemoteSnapshot[id] = _syncVersion(pushCandidates.get(id));
  });
  protectedMissingIds.forEach(id => {
    if (knownRemote[id]) nextRemoteSnapshot[id] = knownRemote[id];
  });
  if (getActiveUserId() !== userId) return local;
  localStorage.setItem(snapshotKey, JSON.stringify(nextRemoteSnapshot));
  return reconciled.next;
}

async function _pullGoals(client, userId, forceReplace = false) {
  const { data, error } = await _selectAllForUser(client, 'goals', '*', userId, 'id');
  if (error) throw error;
  if (!data) return;
  const remote = _filterPendingDeletes('goals', data.map(rowToGoal));
  const confirmedDeleteIds = await _getConfirmedTrashEntityIds(client, userId, ['goal']);
  const local = _ls('mp_goals', []);
  const next = await _reconcileRemoteCollection({
    client, userId, collectionKey: 'goals', dbTable: 'goals', local, remote,
    toRow: goalToRow, pendingDeleteTable: 'goals', retryKeys: ['goals'], confirmedDeleteIds,
  });
  return _writeCollectionAfterSync('mp_goals', local, next, userId, 'goals');
}

async function _pullMemos(client, userId, forceReplace = false) {
  const { data, error } = await _selectAllForUser(client, 'knowledge_memos', '*', userId, 'id');
  if (error) throw error;
  if (!data) return;
  const trashResult = await _selectAllForUser(
    client,
    'trash_items',
    'id,entity_id,entity_type,updated_at',
    userId,
    'id'
  );
  const confirmedDeleteIds = trashResult.error
    ? new Set()
    : new Set(
      _filterPendingDeletes('trash_items', (trashResult.data || []).map(rowToTrash))
        .filter(item => ['memo', 'atlas', 'learning'].includes(item.entityType) && item.entityId)
        .map(item => item.entityId)
    );
  if (trashResult.error) {
    console.warn('[Sync] could not verify note deletion records; preserving local notes:', trashResult.error);
  }
  let remote = _filterPendingDeletes('knowledge_memos', data.map(rowToMemo));
  const local = _ls('mp_knowledge', []);
  const learningMerge = mergeLearningRecordsForSync(local, remote);
  remote = learningMerge.items;
  const atlasMerge = mergeAtlasRecordsForSync(local, remote);
  remote = atlasMerge.items;
  const pushCandidates = [...learningMerge.pushCandidates, ...atlasMerge.pushCandidates];
  if (pushCandidates.length) {
    if (getActiveUserId() !== userId) return false;
    const result = await _upsertRowsCompat(
      client,
      'knowledge_memos',
      pushCandidates.map(item => memoToRow(item, userId)),
      'id'
    );
    if (result.error) {
      _recordSyncError('knowledge_memos', result.error);
      _schedulePushRetry('knowledge_memos');
    } else {
      _recordSyncSuccess('push', 'knowledge_memos');
    }
  }
  const next = await _reconcileRemoteCollection({
    client, userId, collectionKey: 'knowledge_memos', dbTable: 'knowledge_memos', local, remote,
    toRow: memoToRow, pendingDeleteTable: 'knowledge_memos', retryKeys: ['knowledge_memos'],
    confirmedDeleteIds,
    restoreMissingToCloud: true,
  });
  return _writeCollectionAfterSync('mp_knowledge', local, next, userId, 'knowledge_memos');
}

function learningData(record) {
  if (!Array.isArray(record?.tags) || !record.tags.includes('__learning_library__')) return null;
  return record.blocks?.find(block => block?.type === 'learning-entry-data')?.data || null;
}

function fieldVersion(data, field) {
  const time = new Date(data?.fieldUpdatedAt?.[field] || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function stableSyncJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableSyncJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => (
      `${JSON.stringify(key)}:${stableSyncJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function mergeLearningRecord(local, remote) {
  const localData = learningData(local);
  const remoteData = learningData(remote);
  if (!localData || !remoteData) return remote;
  const newerRecord = _syncVersion(local) > _syncVersion(remote) ? local : remote;
  const newerData = newerRecord === local ? localData : remoteData;
  const pickFieldData = field => {
    const localVersion = fieldVersion(localData, field);
    const remoteVersion = fieldVersion(remoteData, field);
    if (localVersion === remoteVersion) return newerData;
    return localVersion > remoteVersion ? localData : remoteData;
  };
  const titleData = pickFieldData('title');
  const answerData = pickFieldData('answer');
  const classificationData = pickFieldData('classification');
  const mergedData = {
    ...newerData,
    originalQuestion: localData.originalQuestion || remoteData.originalQuestion || '',
    title: titleData.title,
    titleSource: titleData.titleSource,
    titleEditedByUser: titleData.titleEditedByUser,
    answer: answerData.answer,
    primaryConcept: answerData.primaryConcept,
    concepts: answerData.concepts,
    facets: answerData.facets,
    status: answerData.status,
    classification: classificationData.classification,
    fieldUpdatedAt: {
      title: titleData.fieldUpdatedAt?.title || '',
      answer: answerData.fieldUpdatedAt?.answer || '',
      classification: classificationData.fieldUpdatedAt?.classification || '',
    },
  };
  if (stableSyncJson(mergedData) === stableSyncJson(remoteData)) return remote;
  const block = newerRecord.blocks?.find(item => item?.type === 'learning-entry-data');
  const merged = {
    ...newerRecord,
    title: mergedData.title || newerRecord.title,
    summary: (mergedData.answer?.directAnswer || []).map(segment => segment?.text || '').join('')
      || newerRecord.summary,
    blocks: (newerRecord.blocks || []).map(item => (
      item === block ? { ...item, data: mergedData } : item
    )),
  };
  merged.updatedAt = new Date().toISOString();
  return merged;
}

export function mergeLearningRecordsForSync(local, remote) {
  const localById = new Map((local || []).filter(item => item?.id).map(item => [item.id, item]));
  const pushCandidates = [];
  const items = (remote || []).map(remoteItem => {
    const localItem = localById.get(remoteItem?.id);
    if (!localItem) return remoteItem;
    const merged = mergeLearningRecord(localItem, remoteItem);
    if (JSON.stringify(merged) !== JSON.stringify(remoteItem)) pushCandidates.push(merged);
    return merged;
  });
  return { items, pushCandidates };
}

function atlasRecordData(record) {
  if (!Array.isArray(record?.tags) || !record.tags.includes('__expression_atlas__')) return null;
  const block = record.blocks?.find(item => [
    'expression-atlas-data',
    'translation-set-data',
    'english-question-data',
  ].includes(item?.type));
  return block?.data && typeof block.data === 'object'
    ? { block, data: block.data }
    : null;
}

function mergeAtlasRecord(local, remote) {
  const localAtlas = atlasRecordData(local);
  const remoteAtlas = atlasRecordData(remote);
  if (!localAtlas || !remoteAtlas || localAtlas.block.type !== remoteAtlas.block.type) return remote;
  const newerRecord = _syncVersion(local) > _syncVersion(remote) ? local : remote;
  const newerData = newerRecord === local ? localAtlas.data : remoteAtlas.data;
  const contentField = localAtlas.block.type === 'expression-atlas-data' ? 'answer' : 'content';
  const pickData = field => {
    const localVersion = fieldVersion(localAtlas.data, field);
    const remoteVersion = fieldVersion(remoteAtlas.data, field);
    if (localVersion === remoteVersion) return newerData;
    return localVersion > remoteVersion ? localAtlas.data : remoteAtlas.data;
  };
  const contentData = pickData(contentField);
  const classificationData = pickData('classification');
  const noteData = pickData('personalNote');
  const classificationKeys = [
    'category', 'topic', 'categoryId', 'topicId', 'categoryAliases', 'topicAliases',
    'classificationSource', 'manualClassification',
  ];
  const mergedData = {
    ...contentData,
    ...Object.fromEntries(classificationKeys.map(key => [key, classificationData[key]])),
    personalNote: noteData.personalNote || '',
    fieldUpdatedAt: {
      ...(contentData.fieldUpdatedAt || {}),
      classification: classificationData.fieldUpdatedAt?.classification || '',
      personalNote: noteData.fieldUpdatedAt?.personalNote || '',
    },
  };
  if (stableSyncJson(mergedData) === stableSyncJson(remoteAtlas.data)) return remote;
  const mergedBlock = newerRecord.blocks?.find(item => item?.type === localAtlas.block.type);
  return {
    ...newerRecord,
    blocks: (newerRecord.blocks || []).map(item => item === mergedBlock ? { ...item, data: mergedData } : item),
    updatedAt: new Date().toISOString(),
  };
}

function mergeAtlasRecordsForSync(local, remote) {
  const localById = new Map((local || []).filter(item => item?.id).map(item => [item.id, item]));
  const pushCandidates = [];
  const items = (remote || []).map(remoteItem => {
    const localItem = localById.get(remoteItem?.id);
    if (!localItem) return remoteItem;
    const merged = mergeAtlasRecord(localItem, remoteItem);
    if (JSON.stringify(merged) !== JSON.stringify(remoteItem)) pushCandidates.push(merged);
    return merged;
  });
  return { items, pushCandidates };
}

async function _pullTrash(client, userId, forceReplace = false) {
  const { data, error } = await _selectAllForUser(client, 'trash_items', '*', userId, 'id');
  if (error) throw error;
  if (!data) return;
  const remote = _filterPendingDeletes('trash_items', data.map(rowToTrash));
  const local = _ls('mp_trash', []);
  const next = await _reconcileRemoteCollection({
    client, userId, collectionKey: 'trash_items', dbTable: 'trash_items', local, remote,
    toRow: trashToRow, pendingDeleteTable: 'trash_items', retryKeys: ['trash_items'],
  });
  return _writeCollectionAfterSync('mp_trash', local, next, userId, 'trash_items');
}

async function _pullSchedule(client, userId, forceReplace = false) {
  const { data, error } = await _selectAllForUser(client, 'schedule_items', '*', userId, 'id');
  if (error) throw error;
  if (!data) return;
  const remote = _filterPendingDeletes('schedule_items', data.map(rowToSchedItem));
  const confirmedDeleteIds = await _getConfirmedTrashEntityIds(client, userId, ['schedule']);
  const local = _ls('mp_schedule', []);
  const next = await _reconcileRemoteCollection({
    client, userId, collectionKey: 'schedule_items', dbTable: 'schedule_items', local, remote,
    toRow: schedItemToRow, pendingDeleteTable: 'schedule_items', retryKeys: ['schedule_items'], confirmedDeleteIds,
  });
  return _writeCollectionAfterSync('mp_schedule', local, next, userId, 'schedule_items');
}

async function _pullTags(client, userId, forceReplace = false) {
  const { data, error } = await _selectAllForUser(client, 'tags', 'name', userId, 'name');
  if (error) throw error;
  if (!data) return;
  const remoteTags = _filterPendingTagDeletes(data.map(r => r.name));
  const localTags  = _ls('mp_tags', []);
  const snapshotKey = _remoteSnapshotKey('tags', userId);
  const knownRemote = _ls(snapshotKey, {});
  const pendingNames = new Set(
    _getPendingDeletes()
      .filter(entry => entry.table === 'tags' && entry.name)
      .map(entry => entry.name)
  );
  const recentNames = new Set(
    _getRecentUpserts()
      .filter(entry => entry.table === 'tags' && entry.name)
      .map(entry => entry.name)
  );
  const protectedMissingNames = _trackRemoteMissingItems({
    collectionKey: 'tags',
    userId,
    local: localTags.map(name => ({ id: name, syncVersion: 1 })),
    remote: remoteTags.map(name => ({ id: name, syncVersion: 1 })),
    knownRemote,
    pendingDeleteIds: pendingNames,
  });
  const reconciled = reconcileNamedCollections(
    localTags,
    remoteTags,
    knownRemote,
    pendingNames,
    recentNames,
    protectedMissingNames
  );
  const pushedNames = new Set();

  if (reconciled.pushCandidates.length) {
    if (getActiveUserId() !== userId) return false;
    const rows = reconciled.pushCandidates.map(name => ({ user_id: userId, name }));
    const result = await _upsertRowsCompat(client, 'tags', rows, 'user_id,name');
    if (result.error) {
      _recordSyncError('tags', result.error);
      _schedulePushRetry('tags');
    } else {
      reconciled.pushCandidates.forEach(name => pushedNames.add(name));
      _recordSyncSuccess('push', 'tags');
    }
  }

  const nextSnapshot = Object.fromEntries(remoteTags.map(name => [name, 1]));
  pushedNames.forEach(name => { nextSnapshot[name] = 1; });
  protectedMissingNames.forEach(name => {
    if (knownRemote[name]) nextSnapshot[name] = knownRemote[name];
  });
  if (getActiveUserId() !== userId) return false;
  localStorage.setItem(snapshotKey, JSON.stringify(nextSnapshot));
  return _writeCollectionAfterSync('mp_tags', localTags, reconciled.next, userId, 'tags');
}

async function _pullReviewSchedule(client, userId, forceReplace = false) {
  const { data, error } = await _selectAllForUser(client, 'review_schedule', '*', userId, 'memo_id');
  if (error) throw error;
  if (!data) return;
  const remote = Object.fromEntries(data.map(rowToReviewEntry));
  const local = _ls('mp_reviews', {});
  const recentIds = new Set(
    _getRecentUpserts()
      .filter(entry => entry.table === 'review_schedule' && entry.id)
      .map(entry => entry.id)
  );
  const localItems = Object.entries(local).map(([id, entry]) => ({
    id,
    entry,
    syncVersion: recentIds.has(id) ? Number.MAX_SAFE_INTEGER : _reviewEntryVersion(entry),
  }));
  const remoteItems = Object.entries(remote).map(([id, entry]) => ({
    id, entry, syncVersion: _reviewEntryVersion(entry),
  }));
  const nextItems = await _reconcileRemoteCollection({
    client,
    userId,
    collectionKey: 'review_schedule',
    dbTable: 'review_schedule',
    local: localItems,
    remote: remoteItems,
    toRow: (item, uid) => reviewEntryToRow(item.id, item.entry, uid),
    conflict: 'user_id,memo_id',
    pendingDeleteTable: 'review_schedule',
    retryKeys: ['review_schedule'],
  });
  const next = Object.fromEntries(nextItems.map(item => [item.id, item.entry]));
  return _writeObjectAfterSync('mp_reviews', local, next, userId, 'review_schedule');
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

function _resumePersistedSyncWork() {
  _getPendingDeletes().forEach(payload => _scheduleDelete(payload));
  const pendingTables = new Set(
    _getRecentUpserts()
      .map(entry => entry.table)
      .filter(table => LS_KEYS[table] || table === 'tags')
  );
  pendingTables.forEach(table => _schedulePushRetry(table));
}

function _scheduleDelete(payload, delayMs = DELETE_GRACE_MS) {
  const scopedPayload = { ...payload, userId: payload.userId || getActiveUserId() || null };
  _markPendingDelete(scopedPayload);
  const key = _deleteKey(scopedPayload);
  const epoch = _syncEpoch;
  clearTimeout(_deleteTimers.get(key));
  _deleteTimers.set(key, setTimeout(async () => {
    _deleteTimers.delete(key);
    await _executeDelete(scopedPayload, epoch);
  }, delayMs));
}

async function _executeDelete(scopedPayload, epoch = _syncEpoch) {
  if (epoch !== _syncEpoch || (scopedPayload.userId && scopedPayload.userId !== getActiveUserId())) return false;
  if (!_isStillDeleted(scopedPayload)) {
    _clearPendingDelete(scopedPayload);
    return true;
  }

  const client = await getClient();
  const userId = await getUserId();
  if (!client || !userId || epoch !== _syncEpoch || (scopedPayload.userId && scopedPayload.userId !== userId)) {
    return false;
  }

  try {
    let result = null;
    if (scopedPayload.table === 'knowledge_memos' && scopedPayload.id) {
      const deletionRecord = _ls('mp_trash', []).find(item => (
        item?.entityId === scopedPayload.id
        && ['memo', 'atlas', 'learning'].includes(item.entityType)
      ));
      if (deletionRecord) {
        const tombstoneResult = await _upsertRowsCompat(
          client,
          'trash_items',
          [trashToRow(deletionRecord, userId)],
          'id'
        );
        if (tombstoneResult.error) throw tombstoneResult.error;
      }
    }
    if (scopedPayload.table === 'tags' && scopedPayload.name) {
      result = await client.from('tags')
        .delete()
        .eq('user_id', userId)
        .eq('name', scopedPayload.name);
    } else if (scopedPayload.table === 'review_schedule' && scopedPayload.id) {
      result = await client.from('review_schedule')
        .delete()
        .eq('memo_id', scopedPayload.id)
        .eq('user_id', userId);
    } else if (scopedPayload.id) {
      result = await client.from(scopedPayload.table)
        .delete()
        .eq('id', scopedPayload.id)
        .eq('user_id', userId);
    }
    if (result?.error) throw result.error;
    _clearPendingDelete(scopedPayload);
    _recordSyncSuccess('push', scopedPayload.table);
    return true;
  } catch (error) {
    console.warn(`[Sync] delete ${scopedPayload.table} failed:`, error);
    _recordSyncError(scopedPayload.table, error);
    if (_isStillDeleted(scopedPayload)) _scheduleDelete(scopedPayload, DELETE_RETRY_MS);
    else _clearPendingDelete(scopedPayload);
    return false;
  }
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

  if (table === 'review_schedule') {
    return !_ls('mp_reviews', {})[id];
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
  const activeUserId = getActiveUserId();
  const all = _ls(DELETE_TOMBSTONE_KEY, []);
  const filtered = all.filter(entry => {
    if (!entry?.table) return false;
    if (entry.userId && activeUserId && entry.userId !== activeUserId) return false;
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
    userId: payload.userId || getActiveUserId() || null,
    createdAt: Date.now(),
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
  const activeUserId = getActiveUserId();
  const all = _ls(RECENT_UPSERT_KEY, []);
  const filtered = all.filter(entry => {
    if (!entry?.table) return false;
    if (entry.userId && activeUserId && entry.userId !== activeUserId) return false;
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
  const userId = getActiveUserId() || null;
  const expiresAt = Date.now() + RECENT_UPSERT_TTL_MS;
  const threshold = Date.now() - RECENT_WRITE_WINDOW_MS;

  if (tableKey === 'tags') {
    const names = _ls('mp_tags', []);
    const survivors = entries.filter(entry => entry.table !== 'tags');
    names.forEach(name => {
      survivors.push({ table: 'tags', name, version: name, expiresAt, userId });
    });
    _saveRecentUpserts(survivors);
    return;
  }

  const lsKey = LS_KEYS[tableKey];
  if (!lsKey) return;
  if (tableKey === 'review_schedule') {
    const schedule = _ls(lsKey, {});
    const survivors = entries.filter(entry => entry.table !== tableKey);
    Object.entries(schedule).forEach(([memoId, entry]) => {
      survivors.push({ table: tableKey, id: memoId, version: String(_reviewEntryVersion(entry)), expiresAt, userId });
    });
    _saveRecentUpserts(survivors);
    return;
  }
  const items = _ls(lsKey, []);
  const survivors = entries.filter(entry => entry.table !== tableKey);
  const pendingById = new Map(
    entries
      .filter(entry => entry.table === tableKey && entry.id && _isStillPresent(entry))
      .map(entry => [entry.id, entry])
  );
  items.forEach(item => {
    if (!item?.id) return;
    const touchedAt = new Date(item.updatedAt || item.createdAt || 0).getTime();
    if (!Number.isFinite(touchedAt) || touchedAt < threshold) return;
    pendingById.set(item.id, {
      table: tableKey,
      id: item.id,
      version: String(item.updatedAt || item.createdAt || ''),
      expiresAt,
      userId,
    });
  });
  survivors.push(...pendingById.values());
  _saveRecentUpserts(survivors);
}

function _isStillPresent(entry) {
  if (entry.table === 'tags') {
    return _ls('mp_tags', []).includes(entry.name);
  }
  if (entry.table === 'review_schedule') {
    return !!_ls('mp_reviews', {})[entry.id];
  }
  const lsKey = LS_KEYS[entry.table];
  if (!lsKey || !entry.id) return false;
  return _hasId(lsKey, entry.id);
}

function _reviewEntryTs(entry) {
  const lastReview = new Date(entry?.lastReview || 0).getTime();
  if (Number.isFinite(lastReview) && lastReview > 0) return lastReview;
  const nextReview = new Date(entry?.nextReview || 0).getTime();
  return Number.isFinite(nextReview) ? nextReview : 0;
}

export function reviewEntryVersion(entry) {
  return _reviewEntryVersion(entry);
}

function _reviewEntryVersion(entry) {
  const rawStage = Number(entry?.stage);
  const stage = Math.max(-1, Math.min(9, Number.isFinite(rawStage) ? rawStage : 0));
  return (_reviewEntryTs(entry) * 16) + stage + 1;
}

function reviewEntryToRow(memoId, entry, userId) {
  return {
    user_id: userId,
    memo_id: memoId,
    stage: entry?.stage ?? 0,
    next_review: entry?.nextReview ?? null,
    last_review: entry?.lastReview ?? null,
  };
}

function rowToReviewEntry(row) {
  return [row.memo_id, {
    stage: row.stage ?? 0,
    nextReview: row.next_review ?? null,
    lastReview: row.last_review ?? null,
  }];
}

function _updatedTs(item) {
  const ts = new Date(item?.updatedAt || item?.createdAt || 0).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function _syncVersion(item) {
  const explicit = Number(item?.syncVersion);
  return Number.isFinite(explicit) ? explicit : _updatedTs(item);
}

function _schedulePushRetry(tableKey) {
  clearTimeout(_timers[tableKey]);
  _timers[tableKey] = setTimeout(() => {
    _timers[tableKey] = null;
    _pushTable(tableKey);
  }, PUSH_RETRY_MS);
}

function _syncEntryToken(entry) {
  return `${entry?.table || ''}:${entry?.id || entry?.name || ''}:${entry?.version ?? 'legacy'}`;
}

function _clearSentUpserts(tableKey, sentEntries) {
  if (!LS_KEYS[tableKey] && tableKey !== 'tags') return;
  const sent = new Set((sentEntries || []).map(_syncEntryToken));
  const entries = _getRecentUpserts().filter(entry => (
    entry.table !== tableKey || !sent.has(_syncEntryToken(entry))
  ));
  _saveRecentUpserts(entries);
}

function _eventRemoteSnapshotKey(userId) {
  return `mp_event_remote_snapshot_v${EVENT_REMOTE_SNAPSHOT_VERSION}:${userId}`;
}

function _remoteSnapshotKey(collectionKey, userId) {
  if (collectionKey === 'events') return _eventRemoteSnapshotKey(userId);
  return `mp_sync_remote_snapshot_v${SYNC_SNAPSHOT_VERSION}:${collectionKey}:${userId}`;
}

function _remoteMissingStateKey(collectionKey, userId) {
  return `mp_sync_remote_missing_v${REMOTE_MISSING_STATE_VERSION}:${collectionKey}:${userId}`;
}

export function resolveRemoteMissingProtection({
  local = [],
  remote = [],
  knownRemote = {},
  pendingDeleteIds = new Set(),
  previousState = {},
  now = Date.now(),
} = {}) {
  const pending = pendingDeleteIds instanceof Set
    ? pendingDeleteIds
    : new Set(pendingDeleteIds);
  const remoteIds = new Set(remote.filter(item => item?.id).map(item => item.id));
  const protectedIds = new Set();
  const nextState = {};

  local.forEach(item => {
    const id = item?.id;
    if (!id || pending.has(id) || remoteIds.has(id)) return;

    const knownVersion = Number(knownRemote[id]);
    const localVersion = _syncVersion(item);
    if (!Number.isFinite(knownVersion) || knownVersion <= 0 || localVersion > knownVersion) return;

    // Never treat an absent cloud row as a confirmed deletion. The matching
    // trash row is passed through pendingDeleteIds by the caller when a user
    // actually deleted an item. This keeps temporary empty responses, RLS
    // misconfiguration, and delayed replication from erasing device data.
    const previous = previousState[id];
    nextState[id] = {
      firstSeenAt: Number(previous?.firstSeenAt) || now,
      lastSeenAt: now,
      count: (Number(previous?.count) || 0) + 1,
    };
    protectedIds.add(id);
  });

  return { protectedIds, nextState };
}

function _trackRemoteMissingItems({
  collectionKey,
  userId,
  local,
  remote,
  knownRemote,
  pendingDeleteIds,
}) {
  const key = _remoteMissingStateKey(collectionKey, userId);
  const previousState = _ls(key, {});
  const result = resolveRemoteMissingProtection({
    local,
    remote,
    knownRemote,
    pendingDeleteIds,
    previousState,
  });
  try {
    localStorage.setItem(key, JSON.stringify(result.nextState));
  } catch (error) {
    console.warn(`[Sync] could not persist ${collectionKey} missing-item protection:`, error);
    return new Set(
      local
        .filter(item => item?.id && !remote.some(remoteItem => remoteItem?.id === item.id))
        .map(item => item.id)
    );
  }
  return result.protectedIds;
}

function _syncBackupKey(collectionKey, userId) {
  if (collectionKey === 'events') return `mp_event_sync_backups:${userId}`;
  return `mp_sync_backups:${collectionKey}:${userId}`;
}

function _writeSyncBackup(collectionKey, userId, value) {
  try {
    const key = _syncBackupKey(collectionKey, userId);
    const backups = _ls(key, []);
    const payload = collectionKey === 'events'
      ? { at: new Date().toISOString(), events: value }
      : { at: new Date().toISOString(), data: value };
    backups.unshift(payload);
    const limit = collectionKey === 'events' ? EVENT_SYNC_BACKUP_LIMIT : SYNC_BACKUP_LIMIT;
    localStorage.setItem(key, JSON.stringify(backups.slice(0, limit)));
  } catch (error) {
    console.warn(`[Sync] could not create local ${collectionKey} backup:`, error);
  }
}

function _writeCollectionAfterSync(key, previous, next, userId, collectionKey) {
  if (getActiveUserId() !== userId) return false;
  const fresh = _ls(key, []);
  const resolved = mergeFreshLocalCollection(key, previous, fresh, next);
  const prevJson = JSON.stringify(fresh);
  const nextJson = JSON.stringify(resolved);
  if (prevJson === nextJson) return false;

  if (fresh.length > resolved.length) {
    _writeSyncBackup(collectionKey, userId, fresh);
  }

  localStorage.setItem(key, nextJson);
  return true;
}

function _writeObjectAfterSync(key, previous, next, userId, collectionKey) {
  if (getActiveUserId() !== userId) return false;
  const fresh = _ls(key, {});
  const resolved = { ...(next || {}) };
  if (JSON.stringify(fresh) !== JSON.stringify(previous)) {
    const ids = new Set([
      ...Object.keys(previous || {}),
      ...Object.keys(fresh || {}),
    ]);
    ids.forEach(id => {
      const before = previous?.[id];
      const current = fresh?.[id];
      if (JSON.stringify(before) === JSON.stringify(current)) return;
      if (current) resolved[id] = current;
      else delete resolved[id];
    });
  }
  const prevJson = JSON.stringify(fresh);
  const nextJson = JSON.stringify(resolved);
  if (prevJson === nextJson) return false;
  if (Object.keys(fresh || {}).length > Object.keys(resolved || {}).length) {
    _writeSyncBackup(collectionKey, userId, fresh);
  }
  localStorage.setItem(key, nextJson);
  return true;
}

export function mergeFreshLocalCollection(key, previous, fresh, pulled) {
  if (JSON.stringify(fresh) === JSON.stringify(previous)) return pulled;

  if (key === 'mp_tags') {
    const previousNames = new Set(previous || []);
    const freshNames = new Set(fresh || []);
    const resolved = new Set(pulled || []);
    previousNames.forEach(name => {
      if (!freshNames.has(name)) resolved.delete(name);
    });
    freshNames.forEach(name => {
      if (!previousNames.has(name)) resolved.add(name);
    });
    return [...resolved].sort();
  }

  const table = {
    mp_tasks: 'tasks',
    mp_task_archive: 'tasks',
    mp_events: 'events',
    mp_goals: 'goals',
    mp_knowledge: 'knowledge_memos',
    mp_trash: 'trash_items',
    mp_schedule: 'schedule_items',
  }[key];
  const deletedIds = new Set(
    _getPendingDeletes()
      .filter(entry => entry.table === table && entry.id)
      .map(entry => entry.id)
  );
  const previousById = new Map(
    (previous || []).filter(item => item?.id).map(item => [item.id, item])
  );
  const freshById = new Map(
    (fresh || []).filter(item => item?.id).map(item => [item.id, item])
  );
  const byId = new Map(
    (pulled || [])
      .filter(item => item?.id && !deletedIds.has(item.id))
      .map(item => [item.id, item])
  );

  const allIds = new Set([...previousById.keys(), ...freshById.keys()]);
  allIds.forEach(id => {
    if (deletedIds.has(id)) {
      byId.delete(id);
      return;
    }
    const before = previousById.get(id);
    const current = freshById.get(id);
    if (JSON.stringify(before) === JSON.stringify(current)) return;
    if (!current) {
      byId.delete(id);
      return;
    }
    const remote = byId.get(id);
    if (
      key === 'mp_knowledge'
      && remote
      && learningData(current)
      && learningData(remote)
    ) {
      const merged = mergeLearningRecordsForSync([current], [remote]).items[0];
      byId.set(id, merged || current);
    } else if (key === 'mp_knowledge' && remote && atlasRecordData(current) && atlasRecordData(remote)) {
      const merged = mergeAtlasRecordsForSync([current], [remote]).items[0];
      byId.set(id, merged || current);
    } else {
      byId.set(id, current);
    }
  });
  return [...byId.values()];
}

function _dedupeById(items) {
  const byId = new Map();
  (items || []).forEach(item => {
    if (!item?.id) return;
    const existing = byId.get(item.id);
    if (!existing || _syncVersion(item) >= _syncVersion(existing)) byId.set(item.id, item);
  });
  return [...byId.values()];
}

function _recordSyncSuccess(type, table = null) {
  const current = getSyncStatus();
  const tableErrors = { ...(current.tableErrors || {}) };
  if (table) delete tableErrors[`${type}:${table}`];
  else Object.entries(tableErrors).forEach(([key, value]) => {
    if ((value?.type || 'push') === type) delete tableErrors[key];
  });
  const remaining = Object.values(tableErrors)
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))[0] || null;
  const next = {
    ...current,
    [type === 'pull' ? 'lastPullAt' : 'lastPushAt']: new Date().toISOString(),
    lastErrorAt: remaining?.at || null,
    lastErrorTable: remaining?.table || null,
    lastErrorMessage: remaining?.message || null,
    tableErrors,
  };
  localStorage.setItem(SYNC_STATUS_KEY, JSON.stringify(next));
}

function _recordSyncError(table, error, type = 'push') {
  const current = getSyncStatus();
  const at = new Date().toISOString();
  const message = error?.message || String(error || 'Unknown sync error');
  const tableErrors = {
    ...(current.tableErrors || {}),
    [`${type}:${table}`]: { table, type, at, message },
  };
  const next = {
    ...current,
    lastErrorAt: at,
    lastErrorTable: table,
    lastErrorMessage: message,
    tableErrors,
  };
  localStorage.setItem(SYNC_STATUS_KEY, JSON.stringify(next));
}

function _ls(key, fb) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fb; }
  catch { return fb; }
}
