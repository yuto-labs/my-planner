-- Claudeのコネクタ(api/mcp.js)が、サーバー側でservice roleとして予定・タスク・メモを読めるようにする。
-- このプロジェクトでは表を作った時にservice_roleへ権限が付いておらず「permission denied」になっていた。
-- 読み取り(SELECT)だけを、コネクタが読む4つの表にだけ与える。書き込み・削除の権限は与えない。
grant usage on schema public to service_role;
grant select on public.tasks, public.events, public.schedule_items, public.knowledge_memos to service_role;
