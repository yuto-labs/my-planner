# My Planner

自己管理とナレッジ管理をひとつにまとめた、スマートフォン向けのPWAです。
予定、タスク、目標、学習メモを日々の行動に結びつけて扱えるように設計しています。

## Demo

https://my-planner-five-alpha.vercel.app

## Features

- **Home**: 今日のフォーカス、予定、習慣、学習ブロックを一覧表示
- **Calendar**: 月・週・日表示、カテゴリ色分け、複数日にまたがる予定に対応
- **Tasks**: 締め切り、重要度、サブタスク、メモ、アーカイブを管理
- **Schedule Blocks**: タスクを日ごとの作業ブロックとして配置
- **Knowledge**: タグ付きメモ、KaTeX数式、関連メモ、知識グラフを表示
- **Analytics**: タスクとナレッジの進捗を可視化
- **PWA / Offline**: Service Workerでオフライン利用に対応
- **Cloud Sync**: Supabase AuthとRow Level Securityでユーザーごとにデータを分離

## Architecture

このアプリはビルドツールなしのVanilla JavaScriptで構成しています。
各画面をES Modulesで分割し、`app.js` がルーティングと共通UIを管理します。

```text
index.html
css/style.css
js/
  app.js
  storage.js
  sync.js
  supabase.js
  modules/
    home.js
    calendar.js
    tasks.js
    knowledge.js
    analytics.js
```

## Tech Stack

- Vanilla JavaScript / ES Modules
- CSS Custom Properties
- localStorage
- Service Worker
- Supabase Auth / Database / RLS
- KaTeX
- Vercel

## Security Notes

- ユーザーの予定・タスク・メモはSupabaseの `user_id` ごとに分離されます。
- Supabaseのanon keyはブラウザアプリで利用する公開キーです。
- データ保護はSupabase Row Level Securityを前提にしています。
- Anthropic APIキーはアプリ利用者のブラウザ内に保存され、エクスポートデータには含めません。
- APIキー未設定またはAI OFFの場合、AI関連UIは通常操作から隠れるようにしています。

## Local Development

```bash
npx serve .
```

その後、ブラウザで表示されたローカルURLを開きます。

## Project Goal

個人の予定管理だけではなく、タスク、学習メモ、振り返りをつなげて、
「今日何をするか」と「何を学んできたか」を同じ場所で扱えるアプリを目指しています。
