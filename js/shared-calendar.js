import { getClient, getUserId } from './supabase.js';
import { getEvents, updateEvent, deleteEvent } from './storage.js';
import { rowToEvent } from './migrate.js';

const CACHE_KEY = 'mp_shared_calendar_groups';

function ls(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}

function saveGroups(groups) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(groups || [])); } catch {}
}

export function getShareGroupsForEventForm() {
  return ls(CACHE_KEY, []);
}

export async function loadSharedGroups() {
  const client = await getClient();
  const userId = await getUserId();
  if (!client || !userId) return getShareGroupsForEventForm();

  const { data: memberships, error } = await client
    .from('shared_calendar_members')
    .select('group_id, role, shared_calendar_groups(id,name,owner_id,created_at,updated_at)')
    .eq('user_id', userId);

  if (error || !memberships) return getShareGroupsForEventForm();

  const groups = memberships
    .map(row => ({
      ...(row.shared_calendar_groups || {}),
      role: row.role || 'member',
    }))
    .filter(group => group.id);

  saveGroups(groups);
  return groups;
}

export async function createSharedGroup(name) {
  const client = await getClient();
  const userId = await getUserId();
  if (!client || !userId) throw new Error('ログインが必要です');

  const now = new Date().toISOString();
  const group = {
    id: crypto.randomUUID(),
    owner_id: userId,
    name: name || '共有カレンダー',
    created_at: now,
    updated_at: now,
  };

  const rpcResult = await client.rpc('create_shared_calendar_group', {
    group_id: group.id,
    group_name: group.name,
  });
  if (!rpcResult.error) {
    await loadSharedGroups();
    return { ...group, ...(rpcResult.data || {}) };
  }
  const rpcMissing = /function .*create_shared_calendar_group|schema cache|not found|does not exist/i
    .test(`${rpcResult.error.message || ''} ${rpcResult.error.details || ''}`);
  if (!rpcMissing) throw rpcResult.error;

  const { error: groupError } = await client.from('shared_calendar_groups').insert(group);
  if (groupError) throw groupError;

  const { error: memberError } = await client.from('shared_calendar_members').insert({
    group_id: group.id,
    user_id: userId,
    role: 'owner',
    created_at: now,
  });
  if (memberError) throw memberError;

  await loadSharedGroups();
  return group;
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
    url: `${window.location.origin}${window.location.pathname}?shareInvite=${encodeURIComponent(token)}#shared-calendar`,
  };
}

export async function acceptSharedInvite(token) {
  const client = await getClient();
  const userId = await getUserId();
  if (!client || !userId) throw new Error('ログインが必要です');
  const { data, error } = await client.rpc('accept_shared_calendar_invite', { invite_token: token });
  if (error) throw error;
  await loadSharedGroups();
  return data;
}

export async function collectSharedCalendarEvents(groupId = '') {
  const client = await getClient();
  const userId = await getUserId();
  const groups = await loadSharedGroups();
  const groupIds = (groupId ? groups.filter(g => g.id === groupId) : groups).map(g => g.id);
  if (!client || !userId || !groupIds.length) return { groups, events: [], userId };

  const { data, error } = await client
    .from('events')
    .select('*')
    .neq('share_visibility', 'private')
    .overlaps('shared_group_ids', groupIds);

  if (error || !data) return { groups, events: [], userId, error };

  const events = data.map(row => {
    const event = rowToEvent(row);
    event.ownerId = row.user_id;
    event.isOwn = row.user_id === userId;
    event.visibleTitle = event.shareVisibility === 'shared_busy' && !event.isOwn
      ? '予定あり'
      : event.title;
    event.visibleMemo = event.shareVisibility === 'shared_detail' || event.isOwn ? event.memo : '';
    event.visibleGroups = row.shared_group_ids || [];
    return event;
  });

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
