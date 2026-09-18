# 機能を縦に追う練習

一つのファイルを最初から最後まで読むのではなく、利用者の一操作がどの関数を通るかを追います。
各段階で関数名を`Ctrl+Shift+F`で検索してください。

## タスクを追加する

### 1. 画面を作る

`js/app.js`の`navigate('tasks')`が`initTasks(container)`を呼びます。
`js/modules/tasks.js`の`render()`が入力欄と追加ボタンをHTMLとして作ります。

### 2. ボタンへ動作を付ける

`wireTaskActions()`などのイベント登録処理が、追加ボタンのclickを`handleAdd()`へつなぎます。
画面を再描画するとボタン要素も作り直されるため、イベント登録も描画後に行います。

### 3. 入力をデータにする

`handleAdd()`は題名、期限、時刻、タグ、重要度を読みます。空の題名を拒否し、入力中の値から
一つのtaskオブジェクトを作ります。

### 4. 保存の共通窓口へ渡す

`addTask(task)`は`js/storage.js`にあります。ここでID、作成日時、更新日時、未指定の既定値を補います。
画面側が毎回同じ初期値を作らなくてよいように、データの決まりを保存層へ集めています。

### 5. 端末保存と同期通知

`saveTasks(tasks)`がlocalStorageへ保存し、成功後に`_notifySync('tasks')`を呼びます。
保存失敗時に同期だけ進めないため、結果を確認してから通知します。

### 6. クラウドへ送る

`sync.js`の`initSync()`で登録されたhookが通知を受けます。短いデバウンス後、`_pushTableNow('tasks')`が
`taskToRow()`でDB形式へ変換し、Supabaseへupsertします。

## メモを一文字変更して保存する

### 1. 正式データを編集用stateへ複製する

`openKnowledgeMemo(id)`で対象を選び、`initKnowledgeDetail()`が保存済みメモを`edState`へ読み込みます。
編集中に直接保存済み配列を書き換えないため、保存を押すまでは下書きです。

### 2. 入力ごとにstateへ反映する

ブロックのinputイベントは、表示中DOMだけでなく`edState.blocks`も更新します。DOMだけ変えると、
再描画や保存時に古いstateから戻ってしまいます。

### 3. Undo履歴を作る

変更前の下書きを`editorUndoHistory`へ積みます。文字入力は一文字ごとに無制限に積まず、連続入力を
適切な単位へまとめます。これはstorage.jsの操作Undoとは別で、メモ編集中だけの履歴です。

### 4. 保存直前にDOMを回収する

`saveMemo(container)`は最初に`syncEditorDomToState(container)`を呼びます。フォーカス中のinputや
表セルなど、まだstateへ反映されていない値を取りこぼさないためです。

### 5. IDを正規化して保存する

`normalizeMemoBlockIds()`が重複ブロックIDを直します。その後、既存なら`updateKnowledgeMemo()`、
新規なら`addKnowledgeMemo()`を呼びます。一文字だけの変更でも`updatedAt`が進み、同期対象になります。

## KnowledgeでAIへ質問する

### 1. 画面側で要求を準備する

`learning-library.js`の`createLearningEntry()`が質問、既存分類、重複候補などを集めます。

### 2. AIクライアントへ渡す

`ai.js`の`generateKnowledgeAnswer()`が、質問と分類辞書をプロンプト用データへします。
`callServerAI()`がログインセッションからアクセストークンを取得し、`/api/ai/generate`へ送ります。

### 3. サーバーで検証する

`api/ai/generate.js`の`handler()`がHTTP方式、認証、action、文字数、出力上限を確認します。
GeminiにはKnowledge用JSON Schemaを渡し、自由な文章だけではなく決めた項目で返すよう求めます。

### 4. 回答を正規化する

AIは項目名や形式を揺らすことがあります。サーバーと`knowledge-model.js`で、許可する段落、強調、表、
数式などへ変換します。危険なHTMLや表示できない構造はそのまま保存しません。

### 5. 保存して同期する

`validateKnowledgeEntry()`が最低限の内容を確認し、`addLearningEntry()`で通常メモと同じ保存領域へ入れます。
`saveLearningEntries()`は通常メモや表現帳を残したままKnowledgeだけを更新します。

## 別端末の変更を受け取る

### 1. Realtimeは変更の存在だけを知らせる

`startRealtimeSync()`はSupabaseを購読します。通知本文をそのまま保存せず、`sync:remote-change`を発行します。
複数の通知は短時間まとめ、画面側から安全なpullを始めます。

### 2. 全ページを取得する

`pullAll()`がデータ型ごとの`_pullXxx()`を呼びます。`selectAllForUser()`は件数上限を越えても、ページを
繰り返し取得して全件を集めます。

### 3. 削除か通信欠けかを分ける

リモート結果にIDがないだけでは削除と判断しません。ごみ箱や削除待ち記録がある場合だけ明示削除として扱い、
一時的な空応答、RLS設定不良、レプリケーション遅延から端末データを守ります。

### 4. pull中のローカル編集を戻す

通信開始後に利用者が編集する可能性があります。書き込み直前にlocalStorageをもう一度読み、開始時点から増えた
新しい変更をpull結果へ再統合します。

### 5. バックアップしてから書く

同期前の値を世代バックアップへ残してからlocalStorageを更新します。画面へ更新イベントを送り、必要な画面だけが
新しいデータを再表示します。

## 読むときの確認質問

各関数で次の五つを自分に問いかけます。

- 入力は何か
- 戻り値は何か
- どのstateまたは保存データを変更するか
- 失敗したら何を返すか
- 誰がこの関数を呼ぶか

この五つが分かれば、文法をすべて暗記していなくても処理の役割を説明できます。
