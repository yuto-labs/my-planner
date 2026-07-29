# AGENTS.md — my-planner

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
**ファイルを変更したら必ず `sw.js` の `CACHE_VER` を上げる（`vNN` → `vNN+1`）。**
**`css/style.css?vNN` のバージョンも `sw.js` の `APP_ASSETS` と `index.html` の `<link>` で一致させる。**

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

## カレンダー（`js/modules/calendar.js`）の重要な設計

### タップフロー（月ビュー）
1. **1回目タップ** → 日付が選択状態（`cal-cell--selected`）になる。`_selectedDate = dateStr`。
2. **2回目タップ（同じ日）** → `openDaySheet(dateStr)` でボトムシートを開く。
3. **シート内の予定をタップ** → 予定エディタを開く。

予定チップ（`.cal-event-chip`）を直接タップした場合も同じ 2 ステップを踏む（iOS Safari 対応で独自ハンドラあり）。

### モジュールレベル変数
```js
let state = { mode: 'month', cursor: new Date(), ... };
let _selectedDate = null;  // 選択中の日付文字列
```
`initCalendar()` が呼ばれるたびに `state.mode = 'month'` と `_selectedDate = null` にリセットされる。

### `.cal-day-sheet`（ボトムシート）の CSS 注意点
```css
.cal-day-sheet {
  position: fixed; inset: 0; z-index: 300;
  opacity: 0;
  pointer-events: none;   /* 透明時はタップをブロックしない */
  transition: opacity 0.25s ease;
}
.cal-day-sheet--open { opacity: 1; pointer-events: auto; }
```
`pointer-events: none` がデフォルト必須。透明状態で全画面をブロックしてアプリが「固まる」現象を防ぐ。

シートを開く際は **double `requestAnimationFrame`** を使う（iOS Safari の CSS transition 起動に必要）:
```js
requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add('cal-day-sheet--open')));
```

シートを閉じる際は `pointer-events: none` を明示的にセットしてから remove:
```js
sheet.classList.remove('cal-day-sheet--open');
sheet.style.pointerEvents = 'none';
setTimeout(() => sheet.remove(), 290);
```

---

## SRS（スペースド・リピティション）

`storage.js` に実装。ナレッジメモと復習セッション（`review.js`）が使う。

```
Stage 0: 1日   Stage 1: 3日   Stage 2: 7日   Stage 3: 14日
Stage 4: 30日  Stage 5: 60日  Stage 6: 習得済み（9999-12-31）
STAGE_DELTA = { again: -2, hard: 0, good: +1, easy: +1 }
```

---

## セキュリティ制約（絶対に破らない）

- **Anthropic API キーをフロントに直書き禁止**。ユーザーが設定画面から入力し localStorage に保存する
- **Supabase SERVICE ROLE KEY 絶対禁止**。フロントには anon key のみ（RLS で保護）

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
```

### 日付文字列
`'YYYY-MM-DD'` 形式で文字列比較（`<=` / `>=`）が成立するよう統一されている。

---

## コーディング規約

- コメントは WHY が非自明なときだけ書く（WHAT は書かない）
- エラーハンドリングは外部境界（ユーザー入力・外部 API）のみ
- ビルドなし・型チェックなし → 変数名・関数名で意図を伝える
- 新しいヘルパーを作る前に `utils.js` に既存のものがないか確認する
