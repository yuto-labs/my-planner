# My Plannerを読むためのJavaScript・HTML入門

この文書は一般的な教科書ではなく、My Plannerのコードに頻出する文法だけをまとめています。

## HTML、CSS、JavaScriptの役割

- HTML: ボタン、入力欄、表示領域など画面の骨組み
- CSS: 色、余白、大きさ、スマートフォンやPCでの配置
- JavaScript: クリック時の処理、保存、画面切り替え、同期

`index.html`にはアプリ共通の枠があります。各画面の細かなHTMLはJavaScriptが文字列として
組み立て、`#main-content`へ表示します。

## 変数

```js
const name = 'Memo'; // あとから別の値を代入しない
let currentView = null; // 状態に応じて別の値へ更新する
```

基本は`const`を使い、値そのものを入れ替える必要がある時だけ`let`を使います。

## 配列とオブジェクト

```js
const tags = ['英語', '研究'];
const memo = { id: '123', title: '今日のメモ', tags };
```

配列は複数の値、オブジェクトは名前付きの項目をまとめます。My Plannerの予定、タスク、メモは
ほとんどがオブジェクトとして保存されています。

## 関数

```js
function findMemo(id) {
  return memos.find(memo => memo.id === id);
}
```

`id`が入力、`return`の右側が呼び出し元へ返す結果です。`=>`は短く関数を書く記法です。

## 分岐と早期return

```js
if (!memo) return null;
```

対象がない場合にそこで処理を終わらせます。入れ子を深くしないため、この形式が頻出します。

## 配列の代表的な処理

- `find`: 条件に合う最初の一件
- `filter`: 条件に合うものだけを残す
- `map`: 各項目を別の形へ変換
- `some`: 一件でも条件に合うか
- `sort`: 並び順を変更

```js
const activeTasks = tasks.filter(task => !task.completed);
```

## importとexport

```js
// storage.js側
export function getTasks() { /* ... */ }

// tasks.js側
import { getTasks } from '../storage.js';
```

`export`した機能だけを、別ファイルが`import`して利用できます。これがファイル同士の接続です。

## DOMとイベント

DOMは、JavaScriptから見た画面上のHTML要素です。

```js
const button = document.getElementById('save-button');
button.addEventListener('click', () => save());
```

ボタンを取得し、クリックされた時に`save`を呼びます。

## asyncとawait

ネットワーク通信や画像処理など、完了まで時間がかかる処理に使います。

```js
async function loadData() {
  const response = await fetch('/api/data');
  return response.json();
}
```

`await`の場所でその非同期処理の完了を待ちます。画面全体を止めるという意味ではありません。

## tryとcatch

```js
try {
  const data = JSON.parse(text);
} catch (error) {
  console.error(error);
}
```

失敗する可能性がある処理を囲み、アプリ全体が停止しないようにします。

## localStorage

ブラウザ内へ文字列を保存する仕組みです。オブジェクトはそのまま入らないため、JSONへ変換します。

```js
localStorage.setItem('tasks', JSON.stringify(tasks));
const saved = JSON.parse(localStorage.getItem('tasks') || '[]');
```

My Plannerでは`storage.js`がこの処理をまとめて担当します。

## スプレッド構文

```js
const updated = { ...task, completed: true };
```

元の`task`を複製し、`completed`だけを変更します。元データを意図せず壊さないために重要です。

## optional chainingとnull合体

```js
const title = memo?.title ?? '無題';
```

`memo`が存在しない場合でもエラーにせず、代わりに`無題`を使います。

## テンプレート文字列

```js
const html = `<button data-id="${task.id}">${task.title}</button>`;
```

バッククォート内へ`${...}`で値を埋め込みます。画面モジュールでHTMLを作る時に頻出します。

