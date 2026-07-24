-- Apply after ../schema.sql.
-- RLS policies remain the row-level security boundary.

grant usage on schema public to authenticated;

grant select, insert, update, delete on table
  tasks,
  events,
  shared_calendar_groups,
  shared_calendar_members,
  shared_calendar_invites,
  goals,
  knowledge_memos,
  trash_items,
  schedule_items,
  tags,
  habit_logs,
  review_schedule
to authenticated;

grant select on table ai_usage_events to authenticated;
