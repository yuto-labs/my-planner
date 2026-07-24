# Supabase

Supabase SQL Editorへ貼り付けて実行するデータベース定義をまとめています。

## New project

新しいSupabaseプロジェクトでは、最初に [`schema.sql`](schema.sql) を実行します。

## Existing project

既存プロジェクトには、必要なマイグレーションをファイル名の日付順で実行します。

1. [`2026-07-16_authenticated_grants.sql`](migrations/2026-07-16_authenticated_grants.sql)
   - ログインユーザーへ必要なテーブル権限を付与します。
2. [`2026-07-22_personal_calendar_sync.sql`](migrations/2026-07-22_personal_calendar_sync.sql)
   - 個人カレンダー同期用のRLSと取得関数を更新します。
3. [`2026-07-24_private_media.sql`](migrations/2026-07-24_private_media.sql)
   - 予定の添付画像列と、非公開画像Storage bucketを追加します。

各SQLは再実行を考慮して作られていますが、本番環境では内容を確認してから実行してください。
アプリの秘密情報やAPIキーは、このディレクトリへ保存しません。
