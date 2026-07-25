-- Prevent shared_busy events from exposing private text in the RPC payload.
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
    case
      when e.user_id <> auth.uid() and e.share_visibility = 'shared_busy' then '予定あり'
      else e.title
    end as title,
    e.start_at,
    e.end_at,
    case when e.user_id <> auth.uid() and e.share_visibility = 'shared_busy' then null else e.category_id end,
    case when e.user_id <> auth.uid() and e.share_visibility = 'shared_busy' then false else e.is_tentative end,
    case when e.user_id <> auth.uid() and e.share_visibility = 'shared_busy' then false else e.is_routine end,
    case when e.user_id <> auth.uid() and e.share_visibility = 'shared_busy' then null else e.recurring_id end,
    case when e.user_id <> auth.uid() and e.share_visibility = 'shared_busy' then array[]::text[] else e.tags end,
    case
      when e.user_id <> auth.uid() and e.share_visibility = 'shared_busy' then ''
      else e.memo
    end as memo,
    e.share_visibility,
    case when e.user_id <> auth.uid() and e.share_visibility = 'shared_busy' then array[]::text[] else e.shared_group_ids end,
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

revoke all on function get_shared_calendar_events(text) from public;
grant execute on function get_shared_calendar_events(text) to authenticated;
