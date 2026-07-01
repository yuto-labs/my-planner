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
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

alter table events enable row level security;
create policy "events: own data only" on events
  for all using (user_id = auth.uid());

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
create policy "review_schedule: own data only" on review_schedule
  for all using (user_id = auth.uid());
