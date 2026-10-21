-- 他の端末での変更を、3秒ごとの確認を待たずにすぐ届けるための設定(Supabase Realtime)。
-- アプリ(js/sync.js の startRealtimeSync)は既にこれらの表の変更通知を待ち受けているが、
-- 表がRealtimeの配信対象(supabase_realtime)に入っていないと通知は一つも来ない。
--
-- 何度実行しても安全: 既に配信対象の表は飛ばす。データは一切変更しない。
-- 実行方法: Supabaseの管理画面 → SQL Editor → この内容を貼り付けて Run。

do $$
declare
  t text;
begin
  foreach t in array array[
    'tasks', 'events', 'goals', 'knowledge_memos',
    'trash_items', 'schedule_items', 'tags', 'review_schedule'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
    -- 削除の通知にも user_id を含めるため、削除前の行全体を記録させる。
    -- (これがないと削除通知が「本人の行」の条件に合わず届かない。届かなくても3秒ごとの確認で反映される)
    execute format('alter table public.%I replica identity full', t);
  end loop;
end $$;

-- 確認用: 配信対象になった表の一覧(8つ並べば完了)
select tablename from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public'
order by tablename;
