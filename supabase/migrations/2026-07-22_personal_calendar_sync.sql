-- Personal calendar sync fix (safe to run more than once).
-- Shared calendar reads continue through get_shared_calendar_events().

alter table events enable row level security;

drop policy if exists "events: own data only" on events;
drop policy if exists "events: read own or shared group" on events;
drop policy if exists "events: read own only" on events;

create policy "events: read own only" on events
  for select using (user_id = auth.uid());

drop function if exists get_personal_calendar_events();
create or replace function get_personal_calendar_events()
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
  where e.user_id = auth.uid()
  order by e.start_at asc;
$$;

revoke all on function get_personal_calendar_events() from public;
grant execute on function get_personal_calendar_events() to authenticated;
