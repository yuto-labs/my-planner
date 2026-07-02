-- ================================================================
-- マイプランナー Supabase Schema
-- Supabase ダッシュボード > SQL Editor で実行してください
-- ================================================================

-- ================================================================
-- MIGRATIONS (既存DBへの追加列 — 新規セットアップ時は不要)
-- ================================================================
alter table tasks          add column if not exists task_type         text    default 'normal';
alter table tasks          add column if not exists estimated_minutes integer;
alter table tasks          add column if not exists highlight_color   text;
alter table tasks          add column if not exists abandoned         boolean default false;
alter table tasks          add column if not exists abandoned_at      timestamptz;
alter table schedule_items add column if not exists source            text;
alter table schedule_items add column if not exists task_id           text;
alter table schedule_items add column if not exists note              text    default '';
alter table events         add column if not exists memo              text    default '';
alter table events         add column if not exists share_visibility  text    not null default 'private';
alter table events         add column if not exists shared_group_ids  text[]  not null default '{}';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'events_share_visibility_check') then
    alter table events
      add constraint events_share_visibility_check
      check (share_visibility in ('private', 'shared_busy', 'shared_detail'));
  end if;
end $$;

-- ================================================================
-- TASKS (アクティブ + アーカイブ両方を格納 / archived_at で区別)
-- ================================================================
create table if not exists tasks (
  id            text        primary key,
  user_id       uuid        not null references auth.users(id) on delete cascade,
  title         text        not null default '',
  weight        text        default 'medium',
  completed     boolean     default false,
  completed_at  timestamptz,
  due_date      date,
  due_time      text,
  goal_id       text,
  recurrence    jsonb,
  subtasks      jsonb       default '[]'::jsonb,
  memo          text        default '',
  tags          text[]      default '{}',
  archived_at   timestamptz,
  sort_order         integer     default 0,
  task_type          text        default 'normal',
  estimated_minutes  integer,
  highlight_color    text,
  abandoned          boolean     default false,
  abandoned_at       timestamptz,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

alter table tasks enable row level security;
drop policy if exists "tasks: own data only" on tasks;
create policy "tasks: own data only" on tasks
  for all using (user_id = auth.uid());

-- ================================================================
-- EVENTS (カレンダー予定)
-- ================================================================
create table if not exists events (
  id            text        primary key,
  user_id       uuid        not null references auth.users(id) on delete cascade,
  title         text        not null default '',
  start_at      timestamptz not null,
  end_at        timestamptz,
  category_id   text,
  is_tentative  boolean     default false,
  is_routine    boolean     default false,
  recurring_id  text,
  tags          text[]      default '{}',
  memo          text        default '',
  share_visibility text     not null default 'private',
  shared_group_ids text[]   not null default '{}',
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create table if not exists shared_calendar_groups (
  id         text primary key,
  owner_id   uuid not null references auth.users(id) on delete cascade,
  name       text not null default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists shared_calendar_members (
  group_id   text not null references shared_calendar_groups(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'member',
  created_at timestamptz default now(),
  primary key (group_id, user_id)
);

alter table events enable row level security;
drop policy if exists "events: own data only" on events;
drop policy if exists "events: read own or shared group" on events;
drop policy if exists "events: insert own only" on events;
drop policy if exists "events: update own only" on events;
drop policy if exists "events: delete own only" on events;
create policy "events: read own or shared group" on events
  for select using (
    user_id = auth.uid()
    or (
      share_visibility <> 'private'
      and exists (
        select 1 from shared_calendar_members scm
        where scm.user_id = auth.uid()
          and scm.group_id = any(events.shared_group_ids)
      )
    )
  );
create policy "events: insert own only" on events
  for insert with check (user_id = auth.uid());
create policy "events: update own only" on events
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "events: delete own only" on events
  for delete using (user_id = auth.uid());

-- ================================================================
-- SHARED CALENDAR GROUPS
-- Personal events remain the source of truth. Groups only grant a
-- read scope for events whose share_visibility and shared_group_ids
-- explicitly allow it.
-- ================================================================
create table if not exists shared_calendar_invites (
  id         text primary key,
  group_id   text not null references shared_calendar_groups(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  email      text,
  token      text not null unique,
  expires_at timestamptz not null,
  used_at    timestamptz,
  used_by    uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);

alter table shared_calendar_groups enable row level security;
alter table shared_calendar_members enable row level security;
alter table shared_calendar_invites enable row level security;

drop policy if exists "shared groups: member read" on shared_calendar_groups;
drop policy if exists "shared groups: owner insert" on shared_calendar_groups;
drop policy if exists "shared groups: owner update" on shared_calendar_groups;
drop policy if exists "shared groups: owner delete" on shared_calendar_groups;
create policy "shared groups: member read" on shared_calendar_groups
  for select using (
    exists (
      select 1 from shared_calendar_members scm
      where scm.group_id = shared_calendar_groups.id
        and scm.user_id = auth.uid()
    )
  );
create policy "shared groups: owner insert" on shared_calendar_groups
  for insert with check (owner_id = auth.uid());
create policy "shared groups: owner update" on shared_calendar_groups
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "shared groups: owner delete" on shared_calendar_groups
  for delete using (owner_id = auth.uid());

drop policy if exists "shared members: same group read" on shared_calendar_members;
drop policy if exists "shared members: own read" on shared_calendar_members;
drop policy if exists "shared members: owner manages" on shared_calendar_members;
create policy "shared members: own read" on shared_calendar_members
  for select using (user_id = auth.uid());
create policy "shared members: owner manages" on shared_calendar_members
  for all using (
    exists (
      select 1 from shared_calendar_groups scg
      where scg.id = shared_calendar_members.group_id
        and scg.owner_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from shared_calendar_groups scg
      where scg.id = shared_calendar_members.group_id
        and scg.owner_id = auth.uid()
    )
  );

drop policy if exists "shared invites: creator read" on shared_calendar_invites;
drop policy if exists "shared invites: group owner create" on shared_calendar_invites;
create policy "shared invites: creator read" on shared_calendar_invites
  for select using (created_by = auth.uid());
create policy "shared invites: group owner create" on shared_calendar_invites
  for insert with check (
    created_by = auth.uid()
    and exists (
      select 1 from shared_calendar_groups scg
      where scg.id = group_id
        and scg.owner_id = auth.uid()
    )
  );

drop function if exists create_shared_calendar_group(text, text);
create or replace function create_shared_calendar_group(p_group_id text, p_group_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  insert into shared_calendar_groups(id, owner_id, name, created_at, updated_at)
  values (p_group_id, auth.uid(), coalesce(nullif(p_group_name, ''), '共有カレンダー'), now(), now())
  on conflict (id) do update
    set name = excluded.name,
        updated_at = now()
    where shared_calendar_groups.owner_id = auth.uid();

  insert into shared_calendar_members(group_id, user_id, role, created_at)
  values (p_group_id, auth.uid(), 'owner', now())
  on conflict (group_id, user_id) do update
    set role = 'owner';

  return jsonb_build_object('id', p_group_id, 'name', coalesce(nullif(p_group_name, ''), '共有カレンダー'));
end;
$$;

grant execute on function create_shared_calendar_group(text, text) to authenticated;

drop function if exists delete_shared_calendar_group(text);
create or replace function delete_shared_calendar_group(p_group_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  if not exists (
    select 1
    from shared_calendar_groups scg
    where scg.id = p_group_id
      and scg.owner_id = auth.uid()
  ) then
    raise exception 'group owner required';
  end if;

  update events
  set shared_group_ids = array_remove(shared_group_ids, p_group_id),
      share_visibility = case
        when coalesce(array_length(array_remove(shared_group_ids, p_group_id), 1), 0) = 0 then 'private'
        else share_visibility
      end,
      updated_at = now()
  where user_id = auth.uid()
    and p_group_id = any(shared_group_ids);

  delete from shared_calendar_groups
  where id = p_group_id
    and owner_id = auth.uid();

  return jsonb_build_object('deletedGroupId', p_group_id);
end;
$$;

grant execute on function delete_shared_calendar_group(text) to authenticated;

drop function if exists create_shared_calendar_invite(text, text, text, text, timestamptz);
create or replace function create_shared_calendar_invite(
  p_invite_id text,
  p_group_id text,
  p_email text,
  p_token text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  if not exists (
    select 1
    from shared_calendar_groups scg
    where scg.id = p_group_id
      and scg.owner_id = auth.uid()
  ) then
    raise exception 'group owner required';
  end if;

  insert into shared_calendar_invites(
    id,
    group_id,
    created_by,
    email,
    token,
    expires_at,
    created_at
  )
  values (
    p_invite_id,
    p_group_id,
    auth.uid(),
    nullif(p_email, ''),
    p_token,
    p_expires_at,
    now()
  );

  return jsonb_build_object(
    'id', p_invite_id,
    'groupId', p_group_id,
    'expiresAt', p_expires_at
  );
end;
$$;

grant execute on function create_shared_calendar_invite(text, text, text, text, timestamptz) to authenticated;

create or replace function accept_shared_calendar_invite(invite_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite shared_calendar_invites%rowtype;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  select * into v_invite
  from shared_calendar_invites
  where token = invite_token
  for update;

  if not found then
    raise exception 'invite not found';
  end if;
  if v_invite.used_at is not null then
    raise exception 'invite already used';
  end if;
  if v_invite.expires_at < now() then
    raise exception 'invite expired';
  end if;

  v_email := nullif((auth.jwt() ->> 'email'), '');
  if v_invite.email is not null and lower(v_invite.email) <> lower(coalesce(v_email, '')) then
    raise exception 'invite email mismatch';
  end if;

  insert into shared_calendar_members(group_id, user_id, role, created_at)
  values (v_invite.group_id, auth.uid(), 'member', now())
  on conflict (group_id, user_id) do nothing;

  update shared_calendar_invites
  set used_at = now(), used_by = auth.uid()
  where id = v_invite.id;

  return jsonb_build_object('groupId', v_invite.group_id);
end;
$$;

grant execute on function accept_shared_calendar_invite(text) to authenticated;

drop function if exists get_shared_calendar_groups();
create or replace function get_shared_calendar_groups()
returns table (
  id text,
  name text,
  owner_id uuid,
  role text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    scg.id,
    scg.name,
    scg.owner_id,
    scm.role,
    scg.created_at,
    scg.updated_at
  from shared_calendar_members scm
  join shared_calendar_groups scg on scg.id = scm.group_id
  where scm.user_id = auth.uid()
  order by scg.created_at desc;
$$;

grant execute on function get_shared_calendar_groups() to authenticated;

drop function if exists get_shared_calendar_events(text);
create or replace function get_shared_calendar_events(p_group_id text default null)
returns table (
  id text,
  user_id uuid,
  title text,
  start_at timestamptz,
  end_at timestamptz,
  category_id text,
  is_tentative boolean,
  is_routine boolean,
  recurring_id text,
  tags text[],
  memo text,
  share_visibility text,
  shared_group_ids text[],
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    e.id,
    e.user_id,
    e.title,
    e.start_at,
    e.end_at,
    e.category_id,
    e.is_tentative,
    e.is_routine,
    e.recurring_id,
    e.tags,
    e.memo,
    e.share_visibility,
    e.shared_group_ids,
    e.created_at,
    e.updated_at
  from events e
  where e.share_visibility <> 'private'
    and exists (
      select 1
      from shared_calendar_members scm
      where scm.user_id = auth.uid()
        and scm.group_id = any(e.shared_group_ids)
        and (p_group_id is null or scm.group_id = p_group_id)
    )
  order by e.start_at asc;
$$;

grant execute on function get_shared_calendar_events(text) to authenticated;

-- ================================================================
-- GOALS (目標)
-- ================================================================
create table if not exists goals (
  id            text        primary key,
  user_id       uuid        not null references auth.users(id) on delete cascade,
  title         text        not null default '',
  type          text        default 'weekly',
  target_date   date,
  progress      integer     default 0,
  description   text        default '',
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

alter table goals enable row level security;
drop policy if exists "goals: own data only" on goals;
create policy "goals: own data only" on goals
  for all using (user_id = auth.uid());

-- ================================================================
-- KNOWLEDGE MEMOS (ナレッジメモ)
-- ================================================================
create table if not exists knowledge_memos (
  id            text        primary key,
  user_id       uuid        not null references auth.users(id) on delete cascade,
  title         text        not null default '',
  blocks        jsonb       default '[]'::jsonb,
  tags          text[]      default '{}',
  starred       boolean     default false,
  url           text        default '',
  summary       text        default '',
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

alter table knowledge_memos enable row level security;
drop policy if exists "knowledge_memos: own data only" on knowledge_memos;
create policy "knowledge_memos: own data only" on knowledge_memos
  for all using (user_id = auth.uid());

-- ================================================================
-- TRASH ITEMS (deleted tasks, events, and notes)
-- ================================================================
create table if not exists trash_items (
  id           text        primary key,
  user_id      uuid        not null references auth.users(id) on delete cascade,
  entity_type  text        not null,
  entity_id    text,
  title        text        not null default '',
  payload      jsonb       not null default '{}'::jsonb,
  deleted_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

alter table trash_items enable row level security;
drop policy if exists "trash_items: own data only" on trash_items;
create policy "trash_items: own data only" on trash_items
  for all using (user_id = auth.uid());

-- ================================================================
-- SCHEDULE ITEMS (マイスケジュール / 日課)
-- ================================================================
create table if not exists schedule_items (
  id            text        primary key,
  user_id       uuid        not null references auth.users(id) on delete cascade,
  title         text        not null default '',
  start_time    text,
  end_time      text,
  date          date,
  source        text,
  task_id       text,
  note          text        default '',
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

alter table schedule_items enable row level security;
drop policy if exists "schedule_items: own data only" on schedule_items;
create policy "schedule_items: own data only" on schedule_items
  for all using (user_id = auth.uid());

-- ================================================================
-- TAGS (グローバルタグリスト)
-- ================================================================
create table if not exists tags (
  user_id  uuid not null references auth.users(id) on delete cascade,
  name     text not null,
  primary key (user_id, name)
);

alter table tags enable row level security;
drop policy if exists "tags: own data only" on tags;
create policy "tags: own data only" on tags
  for all using (user_id = auth.uid());

-- ================================================================
-- HABIT LOGS (習慣ログ: 睡眠・運動)
-- ================================================================
create table if not exists habit_logs (
  user_id   uuid    not null references auth.users(id) on delete cascade,
  date      date    not null,
  sleep     numeric,
  exercise  boolean default false,
  note      text    default '',
  primary key (user_id, date)
);

alter table habit_logs enable row level security;
drop policy if exists "habit_logs: own data only" on habit_logs;
create policy "habit_logs: own data only" on habit_logs
  for all using (user_id = auth.uid());

-- ================================================================
-- REVIEW SCHEDULE (スペースドリピティション)
-- ================================================================
create table if not exists review_schedule (
  user_id      uuid not null references auth.users(id) on delete cascade,
  memo_id      text not null,
  stage        integer default 0,
  next_review  date,
  last_review  date,
  primary key (user_id, memo_id)
);

alter table review_schedule enable row level security;
drop policy if exists "review_schedule: own data only" on review_schedule;
create policy "review_schedule: own data only" on review_schedule
  for all using (user_id = auth.uid());
