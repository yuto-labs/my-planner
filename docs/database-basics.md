# SupabaseとSQLを読むための基礎

## データベースとは

このアプリでは、クラウド上のデータを表形式で保存します。表をtable、横一行をrow、縦の項目をcolumnと呼びます。

```text
tasks table
------------------------------------------------
id | user_id | title | completed | updated_at
```

一つのタスクが一行です。`user_id`によって、どの利用者のデータかを区別します。

## Supabaseの役割

- Auth: メールログインとセッション
- Database: タスク、予定、メモなど
- Row Level Security: 自分の行だけを読める制限
- Storage: メモやホームの画像ファイル
- Realtime: 別端末で変更されたことを通知

## SQLの基本

SQLはデータベースへ構造や操作を指示する言語です。

```sql
create table tasks (...);
```

テーブルを作ります。

```sql
alter table tasks add column memo text;
```

既存テーブルへ列を追加します。

```sql
create policy "Users read own tasks"
on tasks for select
using (auth.uid() = user_id);
```

ログインユーザーのIDと行の`user_id`が一致するときだけ読めるRLSポリシーです。

## schemaとmigrationの違い

- `schema.sql`: 新しいSupabase環境をゼロから作る完成形
- `migrations/*.sql`: すでに動いている環境へ、あとから差分だけ加える履歴

本番DBに対して毎回`schema.sql`全体を実行するものではありません。既存環境では未適用のmigrationだけを
日付順に適用します。

## JavaScriptとの変換

JavaScriptは`updatedAt`、DBは`updated_at`のように名前の慣習が違います。
`migrate.js`の`taskToRow()`と`rowToTask()`が相互変換します。

```text
アプリのtask
  -> taskToRow
  -> Supabaseのtasks行
  -> rowToTask
  -> アプリのtask
```

列を追加するときは、SQLだけでなく変換関数と同期対象も確認します。

## RLSを外さない理由

ブラウザには公開用のanon keyが入っています。このキー単体を秘密にする設計ではありません。
安全性は、ログイン情報とRLSによって「自分の行以外へアクセスできない」ことで守ります。
動かないからとRLSを無効にすると、別ユーザーのデータへアクセスできる危険があります。

## 画像の保存

画像本体はDatabaseではなくStorageの`planner-media`バケットへ入ります。Databaseやメモブロックには
画像の`path`だけを保存し、表示時に期限付きURLへ変換します。
