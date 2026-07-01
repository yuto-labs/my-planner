import { getClient, getUserId } from './supabase.js';
import { getEvents, updateEvent, deleteEvent } from './storage.js';
import { rowToEvent } from './migrate.js';

const CACHE_KEY = 'mp_shared_calendar_groups';
const PENDING_INVITE_KEY = 'mp_pending_shared_calendar_invite';

function ls(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}

function saveGroups(groups) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(groups || [])); } catch {}
}

function savePendingInvite(token) {
  try { localStorage.setItem(PENDING_INVITE_KEY, String(token || '')); } catch {}
}

function clearPendingInvite() {
  try { localStorage.removeItem(PENDING_INVITE_KEY); } catch {}
}

function notifyGroupsChanged() {
  try { document.dispatchEvent(new CustomEvent('shared-calendar:groups-changed')); } catch {}
}

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

function rpcNeedsSqlRefresh(error, functionName) {
  const message = `${error?.message || ''} ${error?.details || ''}`;
  return new RegExp(`function .*${functionName}|schema cache|not found|does not exist|ambiguous`, 'i')
    .test(message);
}

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

export function getShareGroupsForEventForm() {
  return ls(CACHE_KEY, []);
}

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

export async function createSharedInvite(groupId, email = '') {
  const client = await getClient();
  const userId = await getUserId();
  if (!client || !userId) throw new Error('ログインが必要です');
  if (!groupId) throw new Error('共有グループを選んでください');

  const token = `${crypto.randomUUID()}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await client.from('shared_calendar_invites').insert({
    id: crypto.randomUUID(),
    group_id: groupId,
    created_by: userId,
    email: email.trim() || null,
    token,
    expires_at: expires,
    created_at: new Date().toISOString(),
  });
  if (error) throw error;

  return {
    token,
    expiresAt: expires,
    url: `${window.location.origin}${window.location.pathname}?shareInvite=${encodeURIComponent(token)}#calendar`,
  };
}

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

export function getPendingSharedInvite() {
  try { return localStorage.getItem(PENDING_INVITE_KEY) || ''; } catch { return ''; }
}

export async function consumePendingSharedInvite() {
  const token = getPendingSharedInvite();
  if (!token) return null;
  const client = await getClient();
  const userId = await getUserId();
  if (!client || !userId) return { pendingLogin: true };
  return acceptSharedInvite(token);
}

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
    error = fallback.error || rpcError;
  }

  if (error || !data) return { groups, events: [], userId, error };

  const events = data.map(row => mapSharedEvent(row, userId));
  return { groups, events, userId };
}

export async function updateOwnSharedEvent(eventId, updates) {
  const local = getEvents().find(ev => ev.id === eventId);
  if (!local) throw new Error('自分の予定だけ編集できます');
  return updateEvent(eventId, updates);
}

export async function deleteOwnSharedEvent(eventId) {
  const local = getEvents().find(ev => ev.id === eventId);
  if (!local) throw new Error('自分の予定だけ削除できます');
  deleteEvent(eventId);
}
