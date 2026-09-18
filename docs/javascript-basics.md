# My Plannerを読むためのJavaScript入門

この文書は一般的な教科書ではなく、My Plannerのコードに頻出する文法を、初めてJavaScriptを
読む人向けにまとめています。HTMLとCSSは`html-css-basics.md`を先に読んでください。

## プログラムは上から実行される

基本的には文を上から順に実行します。`;`は一つの文の終わりです。JavaScriptでは省略できる場合も
ありますが、このアプリでは文の区切りを分かりやすくするため多くの場所で付けています。

```js
const title = '研究';
console.log(title);
```

ただし、`function`の中身は定義した時点では実行されません。関数を呼んだ時に実行されます。

```js
function greet() {
  console.log('Hello');
}

greet(); // ここで初めて中身が実行される
```

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

`const`はオブジェクトの中身まで完全に固定する意味ではありません。

```js
const task = { completed: false };
task.completed = true; // 中の項目は変更できる
// task =別のオブジェクト; はできない
```

## 値の種類

```js
const title = '予定';       // string: 文字列
const count = 3;           // number: 数値
const completed = false;   // boolean: trueまたはfalse
const dueDate = null;      // 値が意図的にない
let result;                // undefined: まだ値が設定されていない
```

`null`と`undefined`は似ていますが、`null`は「空であることを入れた」、`undefined`は「値がまだない」
という違いがあります。このアプリでは期限なしを`dueDate: null`のように明示します。

## 配列とオブジェクト

```js
const tags = ['英語', '研究'];
const memo = { id: '123', title: '今日のメモ', tags };
```

配列は複数の値、オブジェクトは名前付きの項目をまとめます。My Plannerの予定、タスク、メモは
ほとんどがオブジェクトとして保存されています。

値を読むには`.`または`[]`を使います。

```js
memo.title;
memo['title'];
tags[0]; // 配列の最初。番号は0から始まる
```

## 比較と論理演算子

```js
task.completed === true;       // 同じ値・同じ型か
task.id !== selectedId;        // 異なるか
count > 0;                     // より大きいか
hasTitle && hasDate;           // 両方trueか
isToday || isSelected;         // どちらかがtrueか
!task.completed;               // true/falseを反転
```

このアプリでは、型変換を伴う`==`より、厳密に比較する`===`を使います。

## if、else、三項演算子

```js
if (task.completed) {
  showCompletedStyle();
} else {
  showPendingStyle();
}
```

短い値の選択は三項演算子で書かれることがあります。

```js
const label = task.completed ? '完了' : '未完了';
```

`?`の前が条件、`:`の左がtrueの場合、右がfalseの場合です。

## 関数

```js
function findMemo(id) {
  return memos.find(memo => memo.id === id);
}
```

`id`が入力、`return`の右側が呼び出し元へ返す結果です。`=>`は短く関数を書く記法です。

```js
const activeTasks = tasks.filter(task => !task.completed);
```

ここで`task => !task.completed`は、配列の各taskを受け取り、未完了ならtrueを返す小さな関数です。

引数に既定値を設定することもできます。

```js
function showToast(message, type = 'info') {
  // typeを省略するとinfoになる
}
```

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

それぞれの戻り値は異なります。

```js
const task = tasks.find(item => item.id === id);       // 一件またはundefined
const active = tasks.filter(item => !item.completed); // 新しい配列
const titles = tasks.map(item => item.title);          // 同じ件数の新しい配列
const hasLate = tasks.some(item => item.dueDate < today); // boolean
```

`forEach`は各項目で処理を行いますが、新しい配列は返しません。

```js
tasks.forEach(task => console.log(task.title));
```

## 分割代入

オブジェクトから必要な項目を同名の変数として取り出します。

```js
const { title, tags, starred } = memo;
```

配列では位置で取り出します。

```js
const [first, second] = tasks;
```

importの`{ getTasks, addTask }`も、名前を指定して受け取る似た見た目です。

## importとexport

```js
// storage.js側
export function getTasks() { /* ... */ }

// tasks.js側
import { getTasks } from '../storage.js';
```

`export`した機能だけを、別ファイルが`import`して利用できます。これがファイル同士の接続です。

`../storage.js`の`..`は、一つ上のフォルダという意味です。`tasks.js`は`js/modules`内にあるため、
`js/storage.js`へ行くには一つ上へ戻ります。

## DOMとイベント

DOMは、JavaScriptから見た画面上のHTML要素です。

```js
const button = document.getElementById('save-button');
button.addEventListener('click', () => save());
```

ボタンを取得し、クリックされた時に`save`を呼びます。

`querySelector`はCSSと同じ書き方で要素を探します。

```js
container.querySelector('#save-button'); // id
container.querySelector('.task-item');   // 最初のclass
container.querySelectorAll('.task-item'); // すべて
```

存在しない場合、`querySelector`は`null`を返します。

### イベントの情報

```js
button.addEventListener('click', event => {
  const clicked = event.currentTarget;
});
```

`event`には、押された要素やキー、タッチ位置などが入ります。

### イベント委譲

一覧を再描画する画面では、各ボタンではなく親へ一つだけイベントを付ける場合があります。

```js
list.addEventListener('click', event => {
  const button = event.target.closest('[data-task-id]');
  if (!button) return;
  updateTask(button.dataset.taskId, { completed: true });
});
```

あとから作られた子要素にも対応でき、イベントの登録数を減らせます。

## asyncとawait

ネットワーク通信や画像処理など、完了まで時間がかかる処理に使います。

```js
async function loadData() {
  const response = await fetch('/api/data');
  return response.json();
}
```

`await`の場所でその非同期処理の完了を待ちます。画面全体を止めるという意味ではありません。

`async function`は必ずPromiseを返します。失敗するとPromiseがrejectされ、`await`している側の
`catch`へ進みます。

```js
try {
  const result = await uploadPlannerImage(file);
  showImage(result);
} catch (error) {
  showToast(error.message, 'error');
}
```

`await`を書き忘れると、完成した結果ではなくPromiseそのものを扱ってしまいます。

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

配列でも使います。

```js
const allItems = [...events, ...scheduleItems];
```

元の二配列を変更せず、一つの新しい配列へ結合します。

## optional chainingとnull合体

```js
const title = memo?.title ?? '無題';
```

`memo`が存在しない場合でもエラーにせず、代わりに`無題`を使います。

似ている`||`は、空文字や`0`もfalseとして代替します。`??`は`null`と`undefined`だけを代替するため、
数値0を正しい値として残したい場合に向いています。

## テンプレート文字列

```js
const html = `<button data-id="${task.id}">${task.title}</button>`;
```

バッククォート内へ`${...}`で値を埋め込みます。画面モジュールでHTMLを作る時に頻出します。

ユーザーが入力した文字列は、そのままHTMLへ入れず`esc()`を通します。

```js
const html = `<h2>${esc(memo.title)}</h2>`;
```

これにより、入力した`<script>`などがHTMLとして実行されるのを防ぎます。

## SetとMap

`Set`は重複しない値の集まりです。

```js
const ids = new Set(tasks.map(task => task.id));
ids.has(selectedId);
```

`Map`はキーと値の対応です。

```js
const byId = new Map(tasks.map(task => [task.id, task]));
const task = byId.get(id);
```

表現帳の索引や同期時のID比較で使います。

## try/catchで空のcatchがある理由

```js
try {
  localStorage.setItem(key, value);
} catch {}
```

保存容量不足やプライバシー設定で失敗しても、補助的な設定なら画面全体を止めない場合があります。
ただし主要データでは失敗を利用者へ知らせる必要があり、`storage.js`はエラーイベントも送ります。

## コメントを読んだあとに確認すること

コメントは理解を助けますが、実際の仕様はコードとテストです。コメントと処理が違って見えたら、
呼び出し元、戻り値、関連テストを確認します。コメントだけを正しいものとして処理を変更しないでください。
