# CLAUDE.md — my-planner

## プロジェクト概要

PWA のパーソナルプランナー。ビルドステップなし・バンドラーなしの **Vanilla JS ES Modules** で動く。

- **URL**: https://my-planner-five-alpha.vercel.app
- **デプロイ**: `npx vercel --prod`（実行するたびに Vercel alias が自動で更新される）
- **テスト**: なし（型チェックもなし）。動作確認はブラウザで直接行う

---

## アーキテクチャ

### ルーティング
SPA のハッシュルーティング。`js/app.js` の `MODULES` オブジェクトが全ビューを管理する。

```
#home / #tasks / #calendar / #today / #goals
#knowledge / #knowledge-detail / #knowledge-graph
#review / #analytics / #settings / #ai-settings
#archive / #tags
```

### データ層
- **プライマリ**: `localStorage`（`mp_` プレフィックス）
- **クラウド同期**: Supabase（任意設定）。`js/sync.js` が管理
- 循環依存防止のため `storage.js` は `sync.js` を import しない。`sync.js` 側が `registerSyncHook` で登録する

主な localStorage キー:
```
mp_events, mp_tasks, mp_goals, mp_categories, mp_settings
mp_knowledge, mp_terms, mp_reviews, mp_knowledge_review_log
mp_pending_ai, mp_batch_config
```

### Service Worker
`sw.js` でキャッシュファースト。バージョンは `CACHE_VER = 'vNN'`。
**ファイルを追加したら必ず `sw.js` の `APP_ASSETS` に追記してバージョンを上げる。**

---

## ファイル構成

```
js/
  app.js          — SPAルーター・アプリシェル
  storage.js      — localStorage ラッパー＋全データモデル
  utils.js        — 汎用ヘルパー（esc, fmtDays, daysSince, generateId, ...）
  ai.js           — Anthropic API 呼び出し
  sync.js         — Supabase 双方向同期
  supabase.js     — Supabase クライアント・認証
  migrate.js      — ローカルデータマイグレーション
  datepicker.js   — 日付ピッカー
  modules/
    home.js       — ホーム画面
    tasks.js      — タスク管理
    goals.js      — 目標管理
    calendar.js   — カレンダー
    today.js      — 今日の予定
    knowledge.js  — ナレッジメモ（リスト＋エディタ＋ビューア）
    review.js     — Anki 風復習セッション
    analytics.js  — 分析ダッシュボード
    settings.js   — 設定・アカウント
    knowledge-graph.js
    search.js
    archive.js
    tagspage.js
css/
  style.css       — 全スタイル（CSS 変数ベースのテーマ）
sw.js             — Service Worker
index.html        — エントリポイント
```

---

## SRS（スペースド・リピティション）

`storage.js` に実装。ナレッジメモと復習セッション（`review.js`）が使う。

### ステージ設計（7段階）
```
Stage 0: 1日   Stage 1: 3日   Stage 2: 7日   Stage 3: 14日
Stage 4: 30日  Stage 5: 60日  Stage 6: 習得済み（9999-12-31）
```

定数: `STAGE_COUNT=7`, `MASTERY_STAGE=6`, `STAGE_INTERVALS=[1,3,7,14,30,60,90]`

### 評価ボタン（もう一度 / 難しい / 普通 / 簡単）
```
STAGE_DELTA = { again: -2, hard: 0, good: +1, easy: +1 }
```
- `again` と `easy` は両方 +1 ステージ進む。差は **間隔の長さ** だけ（easy 行は good 行より長い）
- `again` は −2 ステージ後退（最小 0）
- 習得済み（stage 6）では `again` のみ受け付ける → stage 4 に戻る

### 復習ログ
`addReviewLog(memoId, tags)` → `mp_knowledge_review_log`（最大 500 件）に追記。
`rateReview(memoId, rating)` → `mp_reviews` のスケジュールを更新。
両方独立（ログは analytics 用、スケジュールは SRS 用）。

---

## セキュリティ制約（絶対に破らない）

- **Anthropic API キーをフロントに直書き禁止**。ユーザーが設定画面から入力し localStorage に保存する
- **Supabase SERVICE ROLE KEY 絶対禁止**。フロントには anon key のみ（RLS で保護）
- Supabase anon key はフロントに置いてよい

---

## よく使うパターン

### ビュー追加
1. `js/modules/xxx.js` に `export function initXxx(container)` を作る
2. `app.js` の `MODULES` に登録
3. `sw.js` の `APP_ASSETS` に追加してバージョンを上げる

### toast / nav
```js
const nav   = (view) => window.AppNav?.navigate(view);
const toast = (msg, type) => window.AppNav?.showToast(msg, type);
```

### ユーティリティ（utils.js）
```js
import { esc, generateId, today, formatDate, fmtDays, daysSince } from '../utils.js';
// fmtDays(d)   → '1日後' / '3日後' / '2週後' / '1ヶ月後'
// daysSince(dateStr) → 経過日数（Math.floor）
```

### 日付文字列
`'YYYY-MM-DD'` 形式で文字列比較（`<=` / `>=`）が成立するよう統一されている。

---

## コーディング規約

- コメントは WHY が非自明なときだけ書く（WHAT は書かない）
- エラーハンドリングは外部境界（ユーザー入力・外部 API）のみ
- ビルドなし・型チェックなし → 変数名・関数名で意図を伝える
- 新しいヘルパーを作る前に `utils.js` に既存のものがないか確認する
- `fmtDays` / `daysSince` など日付・表示系は utils.js に集約
