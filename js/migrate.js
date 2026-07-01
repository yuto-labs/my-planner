// ============================================================
// migrate.js — localStorage → Supabase 一括移行 + 変換関数
//
// Settings 画面の「データを移行」ボタンから呼び出される。
// 既存の localStorage データは一切消去しない。
// ============================================================

import { getClient, getUserId, setMigratedForCurrentUser } from './supabase.js';

// ---- Public: run migration ----

/**
 * localStorage の全データを Supabase へ一括アップロード
 * @param {(stepName: string, pct: number) => void} onProgress
 */
export async function migrateToSupabase(onProgress) {
  const client = await getClient();
  if (!client) throw new Error('Supabase が未設定です');
  const userId = await getUserId();
  if (!userId) throw new Error('ログインしてください');

  const steps = [
    ['タスク（アクティブ）', () => _uploadTasks(client, userId)],
    ['タスク（アーカイブ）', () => _uploadArchivedTasks(client, userId)],
    ['予定',               () => _uploadEvents(client, userId)],
    ['目標',               () => _uploadGoals(client, userId)],
    ['ナレッジメモ',        () => _uploadMemos(client, userId)],
    ['Trash',               () => _uploadTrash(client, userId)],
    ['スケジュール',        () => _uploadSchedule(client, userId)],
    ['タグ',               () => _uploadTags(client, userId)],
    ['習慣ログ',           () => _uploadHabitLogs(client, userId)],
    ['復習スケジュール',   () => _uploadReviewSchedule(client, userId)],
  ];

  for (let i = 0; i < steps.length; i++) {
    const [name, fn] = steps[i];
    onProgress?.(name, Math.round((i / steps.length) * 100));
    await fn();
  }

  onProgress?.('完了', 100);
  await setMigratedForCurrentUser();
}

// ---- Upload helpers ----

function _ls(key, fb = []) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fb; } catch { return fb; }
}

async function _upsert(client, table, rows, conflict = 'id') {
  if (!rows.length) return;
  const { error } = await client.from(table).upsert(rows, { onConflict: conflict });
  if (error) throw error;
}

async function _uploadTasks(client, userId) {
  const rows = _ls('mp_tasks', []).map(t => taskToRow(t, userId, false));
  await _upsert(client, 'tasks', rows);
}

async function _uploadArchivedTasks(client, userId) {
  const rows = _ls('mp_task_archive', []).map(t => taskToRow(t, userId, true));
  await _upsert(client, 'tasks', rows);
}

async function _uploadEvents(client, userId) {
  const rows = _ls('mp_events', []).map(e => eventToRow(e, userId));
  await _upsert(client, 'events', rows);
}

async function _uploadGoals(client, userId) {
  const rows = _ls('mp_goals', []).map(g => goalToRow(g, userId));
  await _upsert(client, 'goals', rows);
}

async function _uploadMemos(client, userId) {
  const rows = _ls('mp_knowledge', []).map(m => memoToRow(m, userId));
  await _upsert(client, 'knowledge_memos', rows);
}

async function _uploadTrash(client, userId) {
  const rows = _ls('mp_trash', []).map(item => trashToRow(item, userId));
  await _upsert(client, 'trash_items', rows);
}

async function _uploadSchedule(client, userId) {
  const rows = _ls('mp_schedule', []).map(i => schedItemToRow(i, userId));
  await _upsert(client, 'schedule_items', rows);
}

async function _uploadTags(client, userId) {
  const names = _ls('mp_tags', []);
  const rows  = names.map(name => ({ user_id: userId, name }));
  await _upsert(client, 'tags', rows, 'user_id,name');
}

async function _uploadHabitLogs(client, userId) {
  const logs = _ls('mp_habit_logs', {});
  const rows = Object.entries(logs).map(([date, d]) => ({
    user_id:  userId,
    date,
    sleep:    d.sleep    ?? null,
    exercise: d.exercise ?? false,
    note:     d.note     ?? '',
  }));
  await _upsert(client, 'habit_logs', rows, 'user_id,date');
}

async function _uploadReviewSchedule(client, userId) {
  const schedule = _ls('mp_reviews', {});
  const rows = Object.entries(schedule).map(([memoId, e]) => ({
    user_id:     userId,
    memo_id:     memoId,
    stage:       e.stage       ?? 0,
    next_review: e.nextReview  ?? null,
    last_review: e.lastReview  ?? null,
  }));
  await _upsert(client, 'review_schedule', rows, 'user_id,memo_id');
}

// ================================================================
// Conversion helpers  (camelCase ↔ snake_case)
// ================================================================

const _now = () => new Date().toISOString();

export function taskToRow(task, userId, isArchived) {
  return {
    id:                task.id,
    user_id:           userId,
    title:             task.title             || '',
    weight:            task.weight            || 'medium',
    completed:         task.completed         || false,
    completed_at:      task.completedAt       || null,
    due_date:          task.dueDate           || null,
    due_time:          task.dueTime           || null,
    goal_id:           task.goalId            || null,
    recurrence:        task.recurrence        || null,
    subtasks:          task.subtasks          || [],
    memo:              task.memo              || '',
    tags:              task.tags              || [],
    archived_at:       isArchived ? (task.archivedAt || _now()) : null,
    sort_order:        0,
    task_type:         task.taskType          || 'normal',
    estimated_minutes: task.estimatedMinutes  || null,
    highlight_color:   task.highlightColor    || null,
    abandoned:         task.abandoned         || false,
    abandoned_at:      task.abandonedAt       || null,
    created_at:        task.createdAt         || _now(),
    updated_at:        task.updatedAt         || _now(),
  };
}

export function rowToTask(row) {
  return {
    id:               row.id,
    title:            row.title             || '',
    weight:           row.weight            || 'medium',
    completed:        row.completed         || false,
    completedAt:      row.completed_at      || null,
    dueDate:          row.due_date          || null,
    dueTime:          row.due_time          || null,
    goalId:           row.goal_id           || null,
    recurrence:       row.recurrence        || null,
    subtasks:         row.subtasks          || [],
    memo:             row.memo              || '',
    tags:             row.tags              || [],
    archivedAt:       row.archived_at       || null,
    taskType:         row.task_type         || 'normal',
    estimatedMinutes: row.estimated_minutes || null,
    highlightColor:   row.highlight_color   || null,
    abandoned:        row.abandoned         || false,
    abandonedAt:      row.abandoned_at      || null,
    createdAt:        row.created_at        || _now(),
    updatedAt:        row.updated_at        || _now(),
  };
}

export function eventToRow(event, userId) {
  return {
    id:           event.id,
    user_id:      userId,
    title:        event.title       || '',
    start_at:     event.start       || null,
    end_at:       event.end         || null,
    category_id:  event.categoryId  || null,
    is_tentative: event.isTentative || false,
    is_routine:   event.isRoutine   || false,
    recurring_id: event.recurringId || null,
    tags:         event.tags        || [],
    memo:         event.memo        || '',
    share_visibility: event.shareVisibility || 'private',
    shared_group_ids: Array.isArray(event.sharedGroupIds) ? event.sharedGroupIds : [],
    created_at:   event.createdAt   || _now(),
    updated_at:   event.updatedAt   || _now(),
  };
}

export function rowToEvent(row) {
  return {
    id:          row.id,
    title:       row.title        || '',
    start:       row.start_at     || null,
    end:         row.end_at       || null,
    categoryId:  row.category_id  || null,
    isTentative: row.is_tentative || false,
    isRoutine:   row.is_routine   || false,
    recurringId: row.recurring_id || null,
    tags:        row.tags         || [],
    memo:        row.memo         || '',
    shareVisibility: row.share_visibility || 'private',
    sharedGroupIds:  row.shared_group_ids || [],
    createdAt:   row.created_at   || _now(),
    updatedAt:   row.updated_at   || _now(),
  };
}

export function goalToRow(goal, userId) {
  return {
    id:          goal.id,
    user_id:     userId,
    title:       goal.title       || '',
    type:        goal.type        || 'weekly',
    target_date: goal.targetDate  || null,
    progress:    goal.progress    || 0,
    description: goal.description || '',
    created_at:  goal.createdAt   || _now(),
    updated_at:  goal.updatedAt   || _now(),
  };
}

export function rowToGoal(row) {
  return {
    id:          row.id,
    title:       row.title       || '',
    type:        row.type        || 'weekly',
    targetDate:  row.target_date || null,
    progress:    row.progress    || 0,
    description: row.description || '',
    createdAt:   row.created_at  || _now(),
    updatedAt:   row.updated_at  || _now(),
  };
}

export function memoToRow(memo, userId) {
  return {
    id:         memo.id,
    user_id:    userId,
    title:      memo.title   || '',
    blocks:     memo.blocks  || [],
    tags:       memo.tags    || [],
    starred:    memo.starred || false,
    url:        memo.url     || '',
    summary:    memo.summary || '',
    created_at: memo.createdAt || _now(),
    updated_at: memo.updatedAt || _now(),
  };
}

export function rowToMemo(row) {
  return {
    id:        row.id,
    title:     row.title   || '',
    blocks:    row.blocks  || [],
    tags:      row.tags    || [],
    starred:   row.starred || false,
    url:       row.url     || '',
    summary:   row.summary || '',
    createdAt: row.created_at || _now(),
    updatedAt: row.updated_at || _now(),
  };
}

export function trashToRow(item, userId) {
  return {
    id:          item.id,
    user_id:     userId,
    entity_type: item.entityType || 'item',
    entity_id:   item.entityId || null,
    title:       item.title || '',
    payload:     item.payload || {},
    deleted_at:  item.deletedAt || _now(),
    updated_at:  item.updatedAt || item.deletedAt || _now(),
  };
}

export function rowToTrash(row) {
  return {
    id:         row.id,
    entityType: row.entity_type || 'item',
    entityId:   row.entity_id || null,
    title:      row.title || '',
    payload:    row.payload || {},
    deletedAt:  row.deleted_at || _now(),
    updatedAt:  row.updated_at || row.deleted_at || _now(),
  };
}

export function schedItemToRow(item, userId) {
  return {
    id:         item.id,
    user_id:    userId,
    title:      item.title     || '',
    start_time: item.startTime || null,
    end_time:   item.endTime   || null,
    date:       item.date      || null,
    source:     item.source    || null,
    task_id:    item.taskId    || null,
    note:       item.note      || null,
    created_at: item.createdAt || _now(),
    updated_at: _now(),
  };
}

export function rowToSchedItem(row) {
  return {
    id:        row.id,
    title:     row.title      || '',
    startTime: row.start_time || '',
    endTime:   row.end_time   || '',
    date:      row.date       || null,
    source:    row.source     || null,
    taskId:    row.task_id    || null,
    note:      row.note       || null,
    createdAt: row.created_at || _now(),
    updatedAt: row.updated_at || _now(),
  };
}
