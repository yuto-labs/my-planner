# 関数と状態の地図

この資料は、関数名を見つけたときに「どの層の処理か」を判断するための索引です。
関数そのものの細かい引数は、VS Codeで定義へ移動してJSDocと実装を確認します。

## 最初に覚える4種類

- `init...`: 画面を開いた直後に一度呼ばれ、HTMLを描画してイベントを登録する
- `render...`: 現在の状態をHTMLとして表示する。原則として保存はしない
- `wire...` / `setup...`: ボタン、入力、ドラッグなどの操作を関数へ結び付ける
- `get...` / `save...` / `add...` / `update...` / `delete...`: データの取得と変更。画面からは主に`storage.js`の公開関数を使う

`normalize...`は入力の形をそろえ、`merge...`は新旧データを統合します。
`handle...`はクリックや送信に反応する関数です。

## 起動と画面遷移

`js/app.js`がアプリ全体の入口です。

1. `DOMContentLoaded`後に設定、認証、同期の初期化を始める
2. URLの`#home`や`#calendar`をルート名として読む
3. 対応する`js/modules/*.js`を動的に読み込む
4. 各モジュールの`init...`へ`#main-content`を渡す
5. 画面の操作は`window.AppNav`の`navigate`、`showToast`、`showUndoToast`を使う

画面が急に切り替わる問題は、まず`navigate`の呼び出し元を`Shift+F12`で探します。

## 保存の窓口

`js/storage.js`は、ブラウザ内データの一番重要な窓口です。

### 共通の流れ

1. `getEvents`のような`get...`が`localStorage`から配列を読む
2. `add...` / `update...` / `delete...`がIDと`updatedAt`を整える
3. `saveEvents`のような`save...`が配列全体を書く
4. `_notifySync`がsync.jsに「この種類が変わった」と通知する
5. 削除時はゴミ箱記録と`_notifyDelete`の両方が関係する

### 関数のまとまり

- カレンダー: `getEvents` から`deleteFutureRecurring`
- タスク: `getTasks` から`calcNextDueDate`
- 目標とカテゴリ: `getGoals`、`getCategories`付近
- 設定とAIキャッシュ: `getSettings`、`getAiRuntime`、`getAiCache`付近
- マイスケジュール: `getScheduleItems`付近
- 復習: `getReviewSchedule`付近
- メモと表現帳: `getAllKnowledgeRecords`以降
- ゴミ箱: `getTrashItems`以降
- バックアップ: `exportBackup`、`importBackup`、snapshot系
- 習慣とUndo: ファイル終盤

`getAllKnowledgeRecords`の配列には、通常メモ以外も入ります。
`isExpressionAtlasRecord`や`isLearningLibraryRecord`で種類を分け、
専用の`get...`が必要な記録だけを返します。

## 同期

`js/sync.js`は、一方の内容でもう一方を丸ごと置き換えません。

- `initSync`: storage.jsにフックを登録し、初回pullを開始
- `_pushTable`: 短時間の連続変更をまとめる
- `_pushTableNow`: 端末データをDB行へ変換してupsert
- `pullAll`: テーブルごとのpullを順番に実行
- `_pullTasks`等: 端末とリモートをデータ種別ごとに統合
- `resolveRemoteMissingProtection`: リモートで一時的に見えないデータで端末値を消さない
- `_writeSyncBackup`: マージ直前のスナップショットを残す

同期を修正する時は、`migrate.js`の`xxxToRow` / `rowToXxx`と、
Supabaseの列名も一緒に確認します。

## 通常メモ

`js/modules/knowledge.js`は、一覧とブロックエディタの両方を持ちます。

- `renderList` / `renderMemoCard`: 一覧とプレビュー
- `openKnowledgeMemo`: 選択したメモのIDを保って詳細へ移動
- `renderViewMode`: 閲覧用HTML
- `renderEditMode`: 編集用HTML
- `renderBlockEdit`: ブロック1個を編集UIへ変換
- `wireBlocksEdit`: 各ブロックの入力イベント
- `handleBlockKeydown`: Enter、Backspace、Markdown変換の判定
- `wireBlockDrag`: 長押し・ドラッグでの移動
- `handleEditorPaste`: テキスト、リッチHTML、画像の貼り付けを振り分け
- `insertMediaBlock`: 画像ブロックを作成
- `recordEditorHistory` / `restoreEditorHistory`: Undo / Redo
- `syncEditorDomToState`: 画面上の入力を`edState`へ取り込む
- `persistMemo`: storage.jsへ正式保存

`edState`は編集中の一時的な下書きです。
保存済みデータは`storage.js`側にあり、再描画のたびに上書きしないよう分離されています。

## 表現帳

`js/modules/expression-atlas.js`は表示、`js/ai.js`は生成、
`atlas-model.js`と`atlas-senses.js`は正規化・統合を担当します。

### 生成から保存まで

1. `handleGenerate`が入力と生成モードを取得
2. `generateNuanceEntries`が既存見出し語の索引と近い解説をAIへ送信
3. `api/ai/generate.js`がJSON Schemaと完全性を検証
4. `normalizeAtlasEntry`がデータ形式をそろえる
5. `addExpressionEntriesWithReport`が新規、追加、重複、変更なしを分類
6. `mergeExpressionEntry`と`mergeAtlasSenseArrays`が同じ見出し語内の新しい意味を統合

### 表示

- `renderLibrary`: カテゴリとテーマの一覧
- `getUnifiedSearchResults`: 表現・意味・例文の横断検索
- `renderDetail`: 見出し語の詳細
- `expressionSensesSection`: 品詞や意味単位ごとのトグル
- `collocationsSection`: よく一緒に使う語
- `examplesSection`: 例文と音声ボタン
- `comparisonsSection`: 似た表現との違い
- `openLinkedExpression`: 関連語の詳細へ移動

## Knowledge

`js/modules/learning-library.js`が一覧と詳細を表示し、
`js/knowledge-model.js`がAI回答の安全な表示形式を作ります。

- `createLearningEntry`: 質問、生成、検証、保存の入口
- `normalizeKnowledgeAnswer`: AIのJSONを標準形式へ変換
- `validateKnowledgeEntry`: 保存に必要な内容があるか確認
- `renderSegments`: 段落内の強調と概念リンクを表示
- `renderKnowledgeRichBlock`: 表、リスト、数式、フローを表示
- `buildKnowledgeConceptIndex`: 保存済み概念を検索する索引
- `openConceptMatches`: 関連概念の接続先を開く

分野、時代、地域、つながりは、別々のコピーではなく同じ一件の分類値です。

## AIサーバー

`api/ai/generate.js`は画面には含まれず、Vercel Functionとして実行されます。

1. `readBody` / `validateRequestBody`: 入力検査
2. `pickModel`: fast / qualityを実モデル名へ変換
3. `pickResponseSchema`: 機能ごとのJSON Schemaを選択
4. `requireAuthenticatedUser`: Supabaseのログインを確認
5. `requestGeminiResilient`: 再試行と代替モデルを含めてGeminiへ送信
6. `normalizeStructuredResponse`: 軽微な形式差を補正
7. `hasCompleteStructuredResponse`: 機能ごとの必須内容を検査
8. HTTPレスポンスをブラウザへ返す

「AIは回答したが保存できない」時は、プロンプトだけでなく
Schema、`normalizeStructuredResponse`、`hasComplete...`、クライアント側の正規化の4か所を追います。

## ファイル内の状態変数

大きな画面モジュールの`let`変数は、サーバーやDBの値ではありません。
その画面を使っている間だけ必要な一時状態です。

- `currentMemoId`: 現在開いているメモ
- `edState`: メモ編集中の下書き
- `selectedEntry`: 現在開いている表現帳エントリ
- `detailHistory`: 関連項目を辿った履歴
- `selectedEntryId`: 現在開いているKnowledge記録
- `_pushTimers`: 同期通信を少し待ってまとめるタイマー

画面の再描画で意図せず閉じる、位置が戻る、入力が消える問題は、
これらの一時状態を`render...`が上書きしていないか確認します。

## 関数を実際に追う手順

1. 画面で調べたいボタンの`id`または`class`を開発者ツールで見る
2. VS Codeの全体検索でその名前を探す
3. `addEventListener`の呼び出し先または`handle...`を開く
4. 関数内の`storage.js`公開関数を`F12`で開く
5. 保存後に`render...`が呼ばれるか確認
6. 同期対象なら、`_notifySync`から`sync.js`も追う

一気に全行を理解する必要はありません。
一つのボタンを「操作 -> 保存 -> 再描画 -> 同期」の順に追うのが最も確実です。
