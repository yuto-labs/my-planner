-- My Planner private image storage migration
-- Safe to run more than once in the Supabase SQL Editor.

alter table public.events
  add column if not exists attachments jsonb not null default '[]'::jsonb;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'planner-media',
  'planner-media',
  false,
  15728640,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "planner media: owner read" on storage.objects;
drop policy if exists "planner media: owner insert" on storage.objects;
drop policy if exists "planner media: owner update" on storage.objects;
drop policy if exists "planner media: owner delete" on storage.objects;

create policy "planner media: owner read" on storage.objects
  for select using (
    bucket_id = 'planner-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "planner media: owner insert" on storage.objects
  for insert with check (
    bucket_id = 'planner-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "planner media: owner update" on storage.objects
  for update using (
    bucket_id = 'planner-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  ) with check (
    bucket_id = 'planner-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "planner media: owner delete" on storage.objects
  for delete using (
    bucket_id = 'planner-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Add a photo-aware fallback without replacing the existing calendar RPC.
create or replace function public.get_personal_calendar_events_v2()
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
  attachments jsonb,
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
    e.attachments,
    e.share_visibility,
    e.shared_group_ids,
    e.created_at,
    e.updated_at
  from public.events e
  where e.user_id = auth.uid()
  order by e.start_at asc;
$$;

revoke all on function public.get_personal_calendar_events_v2() from public;
grant execute on function public.get_personal_calendar_events_v2() to authenticated;
