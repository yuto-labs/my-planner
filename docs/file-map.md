# ファイルの役割一覧

## ルート

- `index.html`: アプリ共通のHTMLと読み込み順
- `sw.js`: オフラインキャッシュとPWA更新
- `manifest.json`: ホーム画面へインストールするPWA情報
- `vercel.json`: 静的ファイルの配信元とHTTPヘッダー設定
- `package.json`: テスト、構文確認、ビルド用コマンド

## js直下

- `app.js`: SPAルーター、共通ナビ、起動、画面切り替え
- `storage.js`: ローカルデータの読み書きとデータ保護
- `sync.js`: Supabaseとの双方向同期と競合統合
- `supabase.js`: Supabaseクライアントと認証状態
- `migrate.js`: 既存ローカルデータの初回移行
- `ai.js`: ブラウザからAIサーバーを呼ぶ共通処理
- `ai-response.js`: AIのJSON応答読取と通信エラー表示
- `ai-jobs.js`: 長時間AI生成のジョブ作成・状態確認
- `ai-job-resume.js`: 画面へ戻った際の未処理ジョブの復帰・保存
- `ai-job-status.js`: 生成中・成功・失敗と経過時間の共通表示
- `media.js`: 画像のアップロード、取得、キャッシュ、拡大表示
- `datepicker.js`: 日付選択UI
- `holidays.js`: 日本の祝日判定
- `utils.js`: 日付や文字列などの共通関数
- `planning-time.js`: カレンダーとタスク配分で共有する時刻変換・重複判定
- `calendar-gesture.js`: カレンダーのタップと左右スワイプの境界判定
- `navigation-gesture.js`: ページ全体の誤スワイプ遷移を防ぐ判定
- `task-planning.js`: AI時間配分JSONの正規化、重複検査、見積時間計算
- `data-compare.js`: 保存差分と同期競合で使う安定JSON化・版比較
- `media-model.js`: 画像パスの所有者判定、圧縮寸法、表示用エスケープ
- `memo-model.js`: メモ一覧順、表、本文抽出、画像参照の純粋データ処理
- `shared-calendar.js`: 共有カレンダーのデータ操作
- `markdown-shortcuts.js`: メモのMarkdown入力判定
- `atlas-model.js`: 表現帳の保存形式と統合
- `atlas-query.js`: 表現帳の入力種別判定と既存テーマの再利用
- `atlas-senses.js`: 英単語の意味・品詞・重複判定
- `knowledge-model.js`: Knowledge回答の表示用正規化

## js/modules

- `home.js`: ホーム画面
- `calendar.js`: 個人カレンダー
- `shared-calendar.js`: 共有カレンダー画面
- `tasks.js`: タスク一覧、編集、締切、サブタスク
- `goals.js`: 目標管理
- `today.js`: 今日の予定とタスク
- `memo.js`: 通常メモの一覧・編集・復習
- `expression-atlas.js`: 英語表現帳と和文英訳
- `learning-library.js`: Knowledgeの一覧と質問入力
- `memo-graph.js`: メモ同士の関係表示
- `review.js`: 復習セッション
- `analytics.js`: タスク分析
- `settings.js`: 設定、ログイン、AI状態
- `search.js`: 横断検索
- `archive.js`: ゴミ箱
- `tags.js`: タグ一覧

## api

- `api/ai/generate.js`: AIリクエストのサーバー処理
- `api/ai/jobs.js`: 認証済みユーザーの生成ジョブ受付・実行・結果取得
- `api/ai/status.js`: AI設定・モデル到達性の確認

## supabase

- `schema.sql`: 新規環境を作る基本スキーマ
- `migrations/`: 既存環境へ後から加えた変更

## tests

不具合の再発を防ぐ自動テストです。ファイル名は、主に何を守るテストかを表します。
機能を変えた時は、関連テストに加えて`npm test`ですべて実行します。

## docs

設計資料とコードを読むための教材です。アプリの実行には使われません。

- `README.md`: 学習順序の入口
- `start-here.md`: VS Codeと最初の操作
- `html-css-basics.md`: HTML/CSSの基礎
- `css-reading-guide.md`: 長いCSSから対象規則を探す方法
- `javascript-for-python-learners.md`: Python学習者向けのJavaScriptとWeb機能
- `javascript-first-course.md`: 完全な初学者向けの文法・関数講座
- `javascript-basics.md`: JavaScriptの基礎
- `javascript-browser-apis.md`: DOM、イベント、通信、端末保存、画像処理
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

## scripts

- `check-syntax.mjs`: アプリ、API、テスト、検査スクリプトの構文確認
- `check-function-comments.mjs`: 関数コメントの有無と最低限の記述品質の検査
- `check-doc-links.mjs`: 資料内のローカルリンク切れの検査
- `check-client-assets.mjs`: ブラウザ側import/exportとオフライン用ファイルの整合性検査

## 名前と互換性について

通常メモの画面は`js/modules/memo.js`、一般知識を質問するKnowledge画面は
`js/modules/learning-library.js`です。`knowledge-model.js`は後者のデータ処理です。
一方、`getKnowledgeMemos`など既存の関数名や`#knowledge-detail`、`#knowledge-graph`という
URLは通常メモに由来する名前を維持しています。保存済みデータや既存リンクとの互換性を
守るためで、ファイル名を整理しても保存キー・URLまで一括置換してはいけません。
