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
my-planner/
├─ api/                 Vercel Functions（Gemini API中継）
├─ assets/source/       アイコン制作時の元データ
├─ css/                 共通スタイル
├─ js/
│  ├─ modules/          各画面
│  ├─ app.js            ルーティングと共通UI
│  ├─ storage.js        ローカルデータモデル
│  ├─ sync.js           Supabase同期
│  └─ supabase.js       Supabase接続
├─ supabase/
│  ├─ schema.sql        新規環境用の基本スキーマ
│  └─ migrations/       既存環境へ順番に適用するSQL
├─ index.html
├─ manifest.json
├─ sw.js
└─ vercel.json
```

ルート直下の `icon-192.png` と `icon-512.png` はPWAが直接参照する完成画像です。
編集用の元画像は `assets/source/` に分けています。

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
- Gemini APIキーはVercelの環境変数で管理し、ブラウザへ直接配布しません。
- AI処理は同一オリジンのVercel Functionを通して実行します。

## Supabase Setup

新規環境では `supabase/schema.sql` をSupabase SQL Editorで実行します。
既存環境への追加変更は `supabase/migrations/` をファイル名の日付順に実行してください。
詳しい順序と役割は [`supabase/README.md`](supabase/README.md) にまとめています。

## Local Development

```bash
npx serve .
```

その後、ブラウザで表示されたローカルURLを開きます。
Windowsではルートの `start.bat` も利用できます。

## Project Goal

個人の予定管理だけではなく、タスク、学習メモ、振り返りをつなげて、
「今日何をするか」と「何を学んできたか」を同じ場所で扱えるアプリを目指しています。
