# 最初の30分

## このアプリは何でできているか

My Plannerは、ブラウザで動くWebアプリです。中心になる言語は三つです。

- HTML: 画面に何を置くか
- CSS: それをどこに、どんな見た目で置くか
- JavaScript: 押したときに何をするか、何を保存するか

データ同期にはSupabase、AIにはVercel上のAPIとGeminiを使います。最初は外部サービスまで
理解しなくても、画面表示の流れだけ追えます。

## VS Codeでフォルダを開く

VS Codeでは、単一ファイルではなく`my-planner`フォルダを開きます。

```text
ファイル > フォルダーを開く > my-planner
```

左側のExplorerに`index.html`、`js`、`css`、`api`などが並べば正しい状態です。
検索は`Ctrl+Shift+F`です。ファイルが分からないときは、画面に表示されている文言や
HTMLの`class`名をプロジェクト全体から検索します。

## ローカルで動かす

VS Codeのターミナルを開き、`my-planner`で次を実行します。

```powershell
npx serve .
```

表示された`http://localhost:...`をブラウザで開きます。HTMLファイルを直接ダブルクリックするより、
Webサーバー経由の方がES ModulesやService Workerを本番に近い形で試せます。

## 最初に見る4ファイル

1. `index.html`: 固定の画面枠と読み込むファイル
2. `js/app.js`: URLを見て表示画面を決める
3. `js/modules/tagspage.js`: 比較的小さい画面の例
4. `js/storage.js`: データ保存の共通窓口

`calendar.js`や`knowledge.js`から始めると、文法より機能量で迷いやすくなります。

## コードを読むときの一単位

一度にファイル全体を理解しようとせず、次の五つを一組として追います。

```text
画面上のボタン
  -> HTML上のidまたはclass
  -> addEventListener
  -> 呼ばれる関数
  -> storage.jsの保存関数
```

例えば「タスクを追加」を追う場合は、`task-add-btn`を検索し、クリック処理から`handleAdd()`、
さらに`addTask()`へ進みます。ここまで追えれば一つの機能を読めたことになります。

## 変更前に守ること

- 変更前に`git status`で現在の差分を確認する
- 保存処理を直接`localStorage`へ追加せず、まず`storage.js`を見る
- 同期コードで「クラウドに無いから削除」と短絡しない
- 変更後は`npm run lint`と`npm test`を実行する
- 分からない既存処理を削って動かす方法は選ばない

## エラーを読む最初の場所

ブラウザで`F12`を押してDeveloper Toolsを開き、Consoleを見ます。

- 赤い行: 例外や読み込み失敗
- 黄色い行: 警告。直ちに停止しない場合もある
- `ファイル名:行番号`: クリックすると該当コードへ移動できる
- Networkタブ: AI、Supabase、画像通信が成功したか確認できる

エラーメッセージは省略せず、そのまま検索または質問に渡すのが重要です。
