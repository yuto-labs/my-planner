// ============================================================
// shared-calendar.js - 共有カレンダーのDB操作と端末キャッシュ
//
// modules/shared-calendar.js が画面を担当し、このファイルはグループ・招待・
// 共有予定の通信を担当する。個人予定そのものはstorage.jsを通して更新する。
// ============================================================

import { getClient, getUserId } from './supabase.js';
import { getEvents, updateEvent, deleteEvent } from './storage.js';
import { rowToEvent } from './migrate.js';

const CACHE_KEY = 'mp_shared_calendar_groups';
const PENDING_INVITE_KEY = 'mp_pending_shared_calendar_invite';

/** `ls`: 共有カレンダー用の端末保存領域を安全に読み書きする窓口を返す。 */
function ls(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}

/** 参加中の共有グループ一覧を、オフライン表示用の端末キャッシュへ保存する。 */
function saveGroups(groups) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(groups || [])); } catch {}
}

/** 未ログイン時に受け取った招待トークンを、ログイン後に再処理できるよう端末へ保管する。 */
function savePendingInvite(token) {
  try { localStorage.setItem(PENDING_INVITE_KEY, String(token || '')); } catch {}
}

/** ログイン待ちとして保存していた共有招待トークンを端末から削除する。 */
function clearPendingInvite() {
  try { localStorage.removeItem(PENDING_INVITE_KEY); } catch {}
}

/** 共有グループ一覧が変化したことをカレンダー画面へカスタムイベントで知らせる。 */
function notifyGroupsChanged() {
  try { document.dispatchEvent(new CustomEvent('shared-calendar:groups-changed')); } catch {}
}

/** 取得した共有グループをIDで端末キャッシュへ追加・更新し、他グループを残す。 */
function mergeGroupInCache(group) {
  if (!group?.id) return;
  const groups = getShareGroupsForEventForm();
  const next = [
    { role: 'owner', ...group },
    ...groups.filter(item => item.id !== group.id),
  ];
  saveGroups(next);
  notifyGroupsChanged();
}

/** `rpcNeedsSqlRefresh`: Supabase関数のエラーが、古いSQL定義の更新を必要とする内容か判定する。 */
function rpcNeedsSqlRefresh(error, functionName) {
  const message = `${error?.message || ''} ${error?.details || ''}`;
  return new RegExp(`function .*${functionName}|schema cache|not found|does not exist|ambiguous`, 'i')
    .test(message);
}

/** 新旧どちらのSQL引数名にも対応して共有グループ作成RPCを呼び、最初の成功結果を返す。 */
async function callCreateGroupRpc(client, group) {
  const attempts = [
    { p_group_id: group.id, p_group_name: group.name },
    { group_id: group.id, p_group_name: group.name },
    { group_id: group.id, group_name: group.name },
  ];
  let lastError = null;
  for (const args of attempts) {
    const { data, error } = await client.rpc('create_shared_calendar_group', args);
    if (!error) return data;
    lastError = error;
    if (!rpcNeedsSqlRefresh(error, 'create_shared_calendar_group')) break;
  }
  throw lastError;
}

/** `callDeleteGroupRpc`: 削除・グループ・データベース関数を呼び出し、応答を返す。 */
async function callDeleteGroupRpc(client, groupId) {
  const attempts = [
    { p_group_id: groupId },
    { group_id: groupId },
  ];
  let lastError = null;
  for (const args of attempts) {
    const { error } = await client.rpc('delete_shared_calendar_group', args);
    if (!error) return true;
    lastError = error;
    if (!rpcNeedsSqlRefresh(error, 'delete_shared_calendar_group')) break;
  }
  throw lastError;
}

/** SQL定義差を吸収しながら共有招待作成RPCを呼び、更新が必要なエラーだけ再試行する。 */
async function callCreateInviteRpc(client, payload) {
  const attempts = [
    {
      p_invite_id: payload.id,
      p_group_id: payload.group_id,
      p_email: payload.email,
      p_token: payload.token,
      p_expires_at: payload.expires_at,
    },
    {
      invite_id: payload.id,
      group_id: payload.group_id,
      email: payload.email,
      token: payload.token,
      expires_at: payload.expires_at,
    },
  ];
  let lastError = null;
  for (const args of attempts) {
    const { data, error } = await client.rpc('create_shared_calendar_invite', args);
    if (!error) return data;
    lastError = error;
    if (!rpcNeedsSqlRefresh(error, 'create_shared_calendar_invite')) break;
  }
  throw lastError;
}

/** DBの共有グループ行を、画面側が期待する既定値付きオブジェクトへ揃える。 */
function normalizeGroup(group) {
  return {
    id: group.id,
    name: group.name || '共有カレンダー',
    owner_id: group.owner_id,
    created_at: group.created_at,
    updated_at: group.updated_at,
    role: group.role || 'member',
  };
}

/** RPCが返す共有予定行を、カレンダー画面共通の予定オブジェクトへ変換する。 */
function mapSharedEvent(row, userId) {
  const event = rowToEvent(row);
  event.ownerId = row.user_id;
  event.isOwn = row.user_id === userId;
  event.visibleTitle = event.shareVisibility === 'shared_busy' && !event.isOwn
    ? '予定あり'
    : event.title;
  event.visibleMemo = event.shareVisibility === 'shared_detail' || event.isOwn ? event.memo : '';
  event.visibleGroups = row.shared_group_ids || [];
  return event;
}

/** 自分のローカル予定を共有カレンダー表示と同じフィールド構成へ変換する。 */
function mapLocalSharedEvent(event, userId) {
  return {
    ...event,
    ownerId: userId,
    isOwn: true,
    visibleTitle: event.title,
    visibleMemo: event.memo || '',
    visibleGroups: Array.isArray(event.sharedGroupIds) ? event.sharedGroupIds : [],
  };
}

/** `isEventSharedToGroups`: 予定が選択した共有グループのいずれかへ公開されているか判定する。 */
function isEventSharedToGroups(event, groupIds) {
  if (!event || event.shareVisibility === 'private') return false;
  const ids = Array.isArray(event.sharedGroupIds) ? event.sharedGroupIds : [];
  return ids.some(id => groupIds.includes(id));
}

/** 予定フォームですぐ表示できる共有グループ一覧を端末キャッシュから返す。 */
export function getShareGroupsForEventForm() {
  return ls(CACHE_KEY, []);
}

/** 参加中グループを取得し、オフライン表示用キャッシュも更新する。 */
export async function loadSharedGroups() {
  const client = await getClient();
  const userId = await getUserId();
  if (!client || !userId) return getShareGroupsForEventForm();

  const { data: rpcGroups, error: rpcError } = await client.rpc('get_shared_calendar_groups');
  if (!rpcError && Array.isArray(rpcGroups)) {
    const groups = rpcGroups.map(normalizeGroup).filter(group => group.id);
    saveGroups(groups);
    return groups;
  }

  const { data: memberships, error } = await client
    .from('shared_calendar_members')
    .select('group_id, role, shared_calendar_groups(id,name,owner_id,created_at,updated_at)')
    .eq('user_id', userId);

  if (error || !memberships) return getShareGroupsForEventForm();

  let groups = memberships
    .map(row => normalizeGroup({ ...(row.shared_calendar_groups || {}), role: row.role || 'member' }))
    .filter(group => group.id);

  if (!groups.length && memberships.length) {
    const ids = memberships.map(row => row.group_id).filter(Boolean);
    const { data: rawGroups } = await client
      .from('shared_calendar_groups')
      .select('id,name,owner_id,created_at,updated_at')
      .in('id', ids);
    groups = (rawGroups || []).map(group => normalizeGroup({
      ...group,
      role: memberships.find(row => row.group_id === group.id)?.role || 'member',
    }));
  }

  saveGroups(groups);
  return groups;
}

/** ログインユーザーを所有者とする共有グループを作る。 */
export async function createSharedGroup(name) {
  const client = await getClient();
  const userId = await getUserId();
  if (!client || !userId) throw new Error('ログインが必要です');

  const group = {
    id: crypto.randomUUID(),
    owner_id: userId,
    name: name || '共有カレンダー',
  };

  let data = null;
  try {
    data = await callCreateGroupRpc(client, group);
  } catch (error) {
    if (rpcNeedsSqlRefresh(error, 'create_shared_calendar_group')) {
      throw new Error('共有グループ作成用SQLを更新してください');
    }
    throw error;
  }

  const created = normalizeGroup({ ...group, ...(data || {}), role: 'owner' });
  mergeGroupInCache(created);
  await loadSharedGroups().catch(() => getShareGroupsForEventForm());
  return created;
}

/** 所有する共有グループをDBから削除し、端末キャッシュと表示へ反映する。 */
export async function deleteSharedGroup(groupId) {
  const client = await getClient();
  const userId = await getUserId();
  if (!client || !userId) throw new Error('ログインが必要です');
  if (!groupId) throw new Error('削除するグループを選んでください');

  try {
    await callDeleteGroupRpc(client, groupId);
  } catch (error) {
    if (rpcNeedsSqlRefresh(error, 'delete_shared_calendar_group')) {
      throw new Error('共有グループ削除用SQLを更新してください');
    }
    throw error;
  }

  const groups = getShareGroupsForEventForm().filter(group => group.id !== groupId);
  saveGroups(groups);
  notifyGroupsChanged();
  await loadSharedGroups().catch(() => groups);
  return true;
}

/** グループ参加用の期限付き招待トークンを発行する。 */
export async function createSharedInvite(groupId, email = '') {
  const client = await getClient();
  const userId = await getUserId();
  if (!client || !userId) throw new Error('ログインが必要です');
  if (!groupId) throw new Error('共有グループを選んでください');

  const token = `${crypto.randomUUID()}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const payload = {
    id: crypto.randomUUID(),
    group_id: groupId,
    created_by: userId,
    email: email.trim() || null,
    token,
    expires_at: expires,
    created_at: new Date().toISOString(),
  };

  try {
    await callCreateInviteRpc(client, payload);
  } catch (rpcError) {
    if (!rpcNeedsSqlRefresh(rpcError, 'create_shared_calendar_invite')) {
      throw rpcError;
    }
    const { error } = await client.from('shared_calendar_invites').insert(payload);
    if (error) {
      throw new Error('招待リンク作成用SQLを更新してください');
    }
  }

  return {
    token,
    expiresAt: expires,
    url: `${window.location.origin}${window.location.pathname}?shareInvite=${encodeURIComponent(token)}#calendar`,
  };
}

/** 招待を検証して参加する。未ログイン時はトークンを端末へ保留する。 */
export async function acceptSharedInvite(token) {
  const client = await getClient();
  const userId = await getUserId();
  if (!token) throw new Error('招待リンクが無効です');
  if (!client || !userId) {
    savePendingInvite(token);
    return { pendingLogin: true };
  }

  const { data, error } = await client.rpc('accept_shared_calendar_invite', { invite_token: token });
  if (error) throw error;
  clearPendingInvite();
  await loadSharedGroups();
  notifyGroupsChanged();
  return data;
}

/** ログイン後の参加処理を待っている共有招待トークンを端末から返す。 */
export function getPendingSharedInvite() {
  try { return localStorage.getItem(PENDING_INVITE_KEY) || ''; } catch { return ''; }
}

/** `consumePendingSharedInvite`: 保留中・共有・招待を一度だけ読み取り、保留状態から取り除く。 */
export async function consumePendingSharedInvite() {
  const token = getPendingSharedInvite();
  if (!token) return null;
  const client = await getClient();
  const userId = await getUserId();
  if (!client || !userId) return { pendingLogin: true };
  return acceptSharedInvite(token);
}

/** 閲覧可能なグループ予定を集め、共有範囲に応じて詳細を伏せる。 */
export async function collectSharedCalendarEvents(groupId = '') {
  const client = await getClient();
  const userId = await getUserId();
  const groups = await loadSharedGroups();
  const groupIds = (groupId ? groups.filter(g => g.id === groupId) : groups).map(g => g.id);
  if (!client || !userId || !groupIds.length) return { groups, events: [], userId };

  let data = null;
  let error = null;
  const { data: rpcData, error: rpcError } = await client.rpc('get_shared_calendar_events', {
    p_group_id: groupId || null,
  });

  if (!rpcError && Array.isArray(rpcData)) {
    data = rpcData;
  } else {
    const fallback = await client
      .from('events')
      .select('*')
      .neq('share_visibility', 'private')
      .overlaps('shared_group_ids', groupIds);
    data = fallback.data;
    error = fallback.error;
  }

  if (error || !data) return { groups, events: [], userId, error };

  const merged = new Map();
  getEvents()
    .filter(event => isEventSharedToGroups(event, groupIds))
    .map(event => mapLocalSharedEvent(event, userId))
    .forEach(event => merged.set(event.id, event));
  data.map(row => mapSharedEvent(row, userId))
    .forEach(event => {
      if (!event.isOwn || !merged.has(event.id)) merged.set(event.id, event);
    });
  const events = [...merged.values()]
    .sort((a, b) => new Date(a.start || 0) - new Date(b.start || 0));
  return { groups, events, userId };
}

/** 指定期間と共有状態に一致し、一括共有で新たに対象となる個人予定数を返す。 */
export function countShareableLocalEvents(groupId = '', scope = 'future') {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  return getEvents().filter(event => {
    if (!event?.id || !event.start) return false;
    if (scope === 'future' && new Date(event.start) < todayStart) return false;
    const ids = Array.isArray(event.sharedGroupIds) ? event.sharedGroupIds : [];
    return groupId ? !ids.includes(groupId) : true;
  }).length;
}

/** 条件に合う個人予定へ共有設定を一括付与し、通常同期へ流す。 */
export function bulkShareLocalEvents({ groupId, visibility = 'shared_detail', scope = 'future' } = {}) {
  if (!groupId) throw new Error('共有先グループを選んでください');
  const safeVisibility = visibility === 'shared_busy' ? 'shared_busy' : 'shared_detail';
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  let count = 0;

  getEvents().forEach(event => {
    if (!event?.id || !event.start) return;
    if (scope === 'future' && new Date(event.start) < todayStart) return;
    const currentGroups = Array.isArray(event.sharedGroupIds) ? event.sharedGroupIds : [];
    if (currentGroups.includes(groupId) && event.shareVisibility === safeVisibility) return;
    updateEvent(event.id, {
      shareVisibility: safeVisibility,
      sharedGroupIds: [...new Set([...currentGroups, groupId])],
    });
    count += 1;
  });

  return count;
}

/** 自分が所有する共有予定だけをローカル予定経由で更新し、他人の予定編集を拒否する。 */
export async function updateOwnSharedEvent(eventId, updates) {
  const local = getEvents().find(ev => ev.id === eventId);
  if (!local) throw new Error('自分の予定だけ編集できます');
  return updateEvent(eventId, updates);
}

/** 自分が所有する共有予定だけを通常の予定削除経路へ渡し、他人の予定は拒否する。 */
export async function deleteOwnSharedEvent(eventId) {
  const local = getEvents().find(ev => ev.id === eventId);
  if (!local) throw new Error('自分の予定だけ削除できます');
  deleteEvent(eventId);
}
