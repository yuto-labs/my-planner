# Supabase

Supabase SQL Editorへ貼り付けて実行するデータベース定義をまとめています。

SQLやSupabaseが初めての場合は、先に [`../docs/database-basics.md`](../docs/database-basics.md) を
読んでください。`schema.sql`は新規環境用の基本定義、`migrations/`は後から加えた差分です。

## New project

新しいSupabaseプロジェクトでは、最初に [`schema.sql`](schema.sql) を実行します。
その後、下記の差分と実際の定義を照合してください。基本定義だけですべての後続変更が
適用済みとは限りません。画像StorageやRLSも確認対象です。

## Existing project

既存プロジェクトには、必要なマイグレーションをファイル名の日付順で実行します。

1. [`2026-07-16_authenticated_grants.sql`](migrations/2026-07-16_authenticated_grants.sql)
   - ログインユーザーへ必要なテーブル権限を付与します。
2. [`2026-07-22_personal_calendar_sync.sql`](migrations/2026-07-22_personal_calendar_sync.sql)
   - 個人カレンダー同期用のRLSと取得関数を更新します。
3. [`2026-07-24_private_media.sql`](migrations/2026-07-24_private_media.sql)
   - 予定の添付画像列と、非公開画像Storage bucketを追加します。
4. [`2026-07-25_shared_busy_privacy.sql`](migrations/2026-07-25_shared_busy_privacy.sql)
   - 共有時の予定詳細の公開範囲を制御します。
5. [`2026-07-27_harden_ai_usage.sql`](migrations/2026-07-27_harden_ai_usage.sql)
   - 過去のAI利用枠管理関数を更新します。現在のAI APIはこの関数を呼びません。
     関数本体には上限判定が残っているため、呼び出しを追加する際は内容を確認してください。

各SQLは再実行を考慮して作られていますが、本番環境では内容を確認してから実行してください。
アプリの秘密情報やAPIキーは、このディレクトリへ保存しません。

## 安全確認

- 対象のSupabaseプロジェクト名を確認する
- 実行前にSQL全体を読む
- `drop table`や無条件の`delete`がないことを確認する
- RLSを無効化する変更を入れない
- 実行後にTable EditorとAuthenticationの両方を確認する
- 本番データがある場合はバックアップを用意する
