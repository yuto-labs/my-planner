# ファイルの役割一覧

## ルート

- `index.html`: アプリ共通のHTMLと読み込み順
- `sw.js`: オフラインキャッシュとPWA更新
- `manifest.json`: ホーム画面へインストールするPWA情報
- `vercel.json`: Vercel Functionの実行設定
- `package.json`: テスト、構文確認、ビルド用コマンド

## js直下

- `app.js`: SPAルーター、共通ナビ、起動、画面切り替え
- `storage.js`: ローカルデータの読み書きとデータ保護
- `sync.js`: Supabaseとの双方向同期と競合統合
- `supabase.js`: Supabaseクライアントと認証状態
- `migrate.js`: 既存ローカルデータの初回移行
- `ai.js`: ブラウザからAIサーバーを呼ぶ共通処理
- `media.js`: 画像のアップロード、取得、キャッシュ、拡大表示
- `datepicker.js`: 日付選択UI
- `holidays.js`: 日本の祝日判定
- `utils.js`: 日付や文字列などの共通関数
- `planning-time.js`: カレンダーとタスク配分で共有する時刻変換・重複判定
- `calendar-gesture.js`: カレンダーのタップと左右スワイプの境界判定
- `task-planning.js`: AI時間配分JSONの正規化、重複検査、見積時間計算
- `shared-calendar.js`: 共有カレンダーのデータ操作
- `notion-import.js`: Notion由来データの変換
- `markdown-shortcuts.js`: メモのMarkdown入力判定
- `atlas-model.js`: 表現帳の保存形式と統合
- `atlas-senses.js`: 英単語の意味・品詞・重複判定
- `knowledge-model.js`: Knowledge回答の表示用正規化

## js/modules

- `home.js`: ホーム画面
- `calendar.js`: 個人カレンダー
- `shared-calendar.js`: 共有カレンダー画面
- `tasks.js`: タスク一覧、編集、締切、サブタスク
- `goals.js`: 目標管理
- `today.js`: 今日の予定とタスク
- `knowledge.js`: 通常メモの一覧・編集・復習
- `expression-atlas.js`: 英語表現帳と和文英訳
- `learning-library.js`: Knowledgeの一覧と質問入力
- `knowledge-graph.js`: メモ同士の関係表示
- `review.js`: 復習セッション
- `analytics.js`: タスク分析
- `settings.js`: 設定、ログイン、AI状態
- `search.js`: 横断検索
- `archive.js`: ゴミ箱
- `tagspage.js`: タグ一覧

## api

- `api/ai/generate.js`: AIリクエストのサーバー処理
- `api/ai/status.js`: AI設定・モデル到達性の確認

## supabase

- `schema.sql`: 新規環境を作る基本スキーマ
- `migrations/`: 既存環境へ後から加えた変更

## tests

不具合の再発を防ぐ自動テストです。ファイル名は、主に何を守るテストかを表します。
機能を変えた時は、関連テストに加えて`npm test`ですべて実行します。

## docs

コードを読むための教材です。アプリの実行には使われません。

- `README.md`: 学習順序の入口
- `start-here.md`: VS Codeと最初の操作
- `html-css-basics.md`: HTML/CSSの基礎
- `css-reading-guide.md`: 長いCSSから対象規則を探す方法
- `javascript-basics.md`: JavaScriptの基礎
- `first-walkthrough.md`: 起動処理の実コード追跡
- `feature-walkthroughs.md`: 機能をファイル横断で追う練習
- `architecture.md`: 全体構造
- `data-and-sync.md`: 保存と同期
- `database-basics.md`: SupabaseとSQL
- `ai-flow.md`: AI処理
- `function-map.md`: 関数名、状態変数、機能ごとの呼び出し順
- `debugging-and-tests.md`: 調査とテスト
- `glossary.md`: 用語集
- `project-config.md`: JSON設定、PWA、Vercel
