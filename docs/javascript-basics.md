# My Plannerを読むためのJavaScript入門

この文書は、JavaScriptを初めて読む人がMy Plannerのコードを追えるようになるための入門です。
記号を暗記するだけでなく、「値がどこから来て、どこへ渡り、いつ処理が動くか」を理解することを
目標にします。プログラミング自体が初めてなら、先に
[`javascript-first-course.md`](javascript-first-course.md)で、変数と関数を一行ずつ読む練習をしてください。
ブラウザー固有の機能は、次に
[`javascript-browser-apis.md`](javascript-browser-apis.md)を読んでください。

## 最初に持つべき三つの視点

コードを読むときは、各行について次の三つを確認します。

1. **値**: この変数には文字列、配列、HTML要素など、何が入っているか
2. **時点**: アプリ起動時、クリック時、通信完了後など、いつ実行されるか
3. **副作用**: 戻り値を作るだけか、画面・保存データ・通信状態を変更するか

```js
const saveButton = container.querySelector('#save-button');
saveButton?.addEventListener('click', () => saveMemo(container));
```

これは「保存ボタンというHTML要素」を取得し、「クリックされた時点」で`saveMemo()`を呼び、
保存データを変更するコードです。一行ずつ日本語へ置き換えると、長いコードも読みやすくなります。

## JavaScriptが実行される順番

通常の文は上から順に実行されます。`;`は一つの文の終わりです。

```js
const title = '研究';
console.log(title);
```

ただし、関数の中身は定義しただけでは動きません。

```js
function greet() {
  console.log('Hello');
}

greet(); // 丸括弧を付けて呼んだ時に、関数の中へ入る
```

`greet`は関数そのもの、`greet()`は関数を今実行して得た結果です。この違いはイベントで重要です。

```js
button.addEventListener('click', greet);   // 後でクリックされたら実行
button.addEventListener('click', greet()); // 今すぐ実行してしまうので、多くの場合は誤り
```

## 文、式、ブロック

**式**は値になる部分です。`1 + 2`は`3`になり、`task.completed`は`true`または`false`になります。
**文**は代入や分岐など、一つの命令です。波括弧`{}`は複数の文をまとめたブロックです。

```js
const count = tasks.length;

if (count > 0) {
  renderTasks();
}
```

括弧の基本的な役割は次の通りです。

| 記号 | 主な役割 | 例 |
|---|---|---|
| `()` | 関数を呼ぶ、条件をまとめる | `save()`、`if (ready)` |
| `{}` | 処理の範囲、オブジェクト | `if (...) {}`、`{ id: '1' }` |
| `[]` | 配列、番号やキーで値を読む | `['a']`、`tasks[0]` |
| `.` | オブジェクトの項目を読む | `memo.title` |

## 変数: constとlet

変数は、後から値を参照するための名前です。

```js
const pageTitle = 'Calendar';
let selectedDate = null;
```

- `const`: その名前へ別の値を再代入しない
- `let`: 状態の変化に応じて再代入する

基本は`const`を使い、表示モードや選択日のように値そのものが変わる場合だけ`let`を使います。

```js
let mode = 'month';
mode = 'day';
```

`const`は、中身まで凍結する命令ではありません。

```js
const task = { completed: false };
task.completed = true; // 同じオブジェクトの項目変更は可能
// task = { completed: true }; は、別オブジェクトへの再代入なので不可
```

## 値と型

```js
const title = '予定';       // string: 文字列
const count = 3;            // number: 数値
const completed = false;    // boolean: trueまたはfalse
const dueDate = null;       // 意図的に「値なし」とした値
let result;                 // undefined: まだ値が設定されていない
const tags = ['英語'];      // array: 複数の値を順番に保持
const memo = { id: 'm1' };  // object: 名前付き項目を保持
```

`null`と`undefined`は似ています。My Plannerでは、期限なしを`dueDate: null`のように明示します。
一方、存在しないオブジェクト項目を読むと`undefined`になります。

```js
const task = { title: '提出' };
task.dueDate; // undefined
typeof task.title; // 'string'
Array.isArray(tags); // true
```

## truthyとfalsy

`if`はboolean以外も条件にできます。空文字、`0`、`null`、`undefined`、`NaN`はfalse相当です。
それ以外の多くの値はtrue相当です。空配列`[]`と空オブジェクト`{}`はtrue相当なので注意します。

```js
if (title) {
  // titleが空文字でなければ実行
}

if (tasks.length) {
  // 件数が0でなければ実行
}
```

## 配列とオブジェクト

配列は同種の項目を順番に並べる用途、オブジェクトは一件のデータに名前付きの項目を持たせる用途です。

```js
const tags = ['英語', '研究'];
const memo = {
  id: 'm1',
  title: '今日のメモ',
  tags,
};
```

項目名と変数名が同じなら`tags: tags`を`tags`と短く書けます。値は`.`または`[]`で読みます。
配列の番号は0から始まります。

```js
memo.title;
memo['title'];
tags[0];
memo[fieldName]; // 項目名が変数に入っている場合
```

## 参照、変更、コピー

オブジェクトと配列を変数へ代入すると、データ本体ではなく同じデータを指す参照が渡ります。

```js
const original = { completed: false };
const same = original;
same.completed = true;
console.log(original.completed); // true
```

元データを変えたくない場合はコピーします。

```js
const updated = { ...original, completed: true };
const copiedTags = [...tags];
```

このコピーは一段目だけです。入れ子のオブジェクトまで完全に別にする「深いコピー」とは異なります。
同期処理で不用意な上書きを避けるため、この違いは重要です。

## 比較と論理演算子

```js
task.completed === true; // 値と型が同じ
task.id !== selectedId;  // 異なる
count > 0;               // より大きい
hasTitle && hasDate;     // 両方がtrue
isToday || isSelected;   // どちらかがtrue
!task.completed;         // trueとfalseを反転
```

`==`は文字列`'1'`と数値`1`を同じと扱うなど、自動変換が入ります。このアプリでは原則`===`を使います。
`&&`と`||`は左から評価し、答えが決まった時点で右側を実行しません。

```js
memo && renderMemo(memo); // memoがなければrenderMemoは呼ばれない
```

## if、else、switch、三項演算子

```js
if (task.completed) {
  showCompletedStyle();
} else if (task.abandoned) {
  showAbandonedStyle();
} else {
  showPendingStyle();
}
```

同じ値を複数候補と比べる場合は`switch`も使えます。

```js
switch (mode) {
  case 'month': renderMonth(); break;
  case 'week': renderWeek(); break;
  default: renderDay();
}
```

短い値の選択は三項演算子で書きます。

```js
const label = task.completed ? '完了' : '未完了';
```

## 関数、引数、戻り値

関数は、入力を受け取り、処理し、必要なら結果を返すまとまりです。

```js
function findMemo(id) {
  return memos.find(memo => memo.id === id);
}

const found = findMemo('m1');
```

- `id`: 関数定義側のparameter（仮引数）
- `'m1'`: 呼び出し側のargument（実引数）
- `return`: 呼び出し元へ結果を返し、その時点で関数を終了

戻り値がない関数も、実際には`undefined`を返します。画面変更や保存だけを行う関数は、副作用を目的に
呼ばれています。

### 既定値と名前付きオプション

```js
function showToast(message, type = 'info') {
  // typeを省略するとinfo
}

function openViewer({ path = '', caption = '', trigger = null } = {}) {
  // 引数の順番を覚えず、名前で指定できる
}

openViewer({ path: image.path, caption: image.caption });
```

## アロー関数とコールバック

次の二つは近い意味です。

```js
function isActive(task) {
  return !task.completed;
}

const isActive = task => !task.completed;
```

アロー関数は、短い処理や別の関数へ渡すコールバックでよく使います。

```js
const activeTasks = tasks.filter(task => !task.completed);
```

`filter`が配列の各要素でコールバックを呼び、trueになった要素だけを残します。コールバックは
「今ここで実行する関数」ではなく、「相手へ渡して必要な時に呼んでもらう関数」です。

波括弧を付けたアロー関数では、戻り値に`return`が必要です。

```js
const titles = tasks.map(task => {
  return task.title;
});
```

## スコープとクロージャ

変数には参照できる範囲があります。波括弧の内側で宣言した`const`や`let`は、通常その外から読めません。

```js
if (ready) {
  const message = '準備完了';
}
// messageはここでは使えない
```

内側の関数は、外側の関数が終わった後も外側の変数を覚えられます。これをクロージャと呼びます。

```js
function makeCounter() {
  let count = 0;
  return () => {
    count += 1;
    return count;
  };
}

const next = makeCounter();
next(); // 1
next(); // 2
```

モーダルの`close()`が、そのモーダル固有の要素やタイマーを覚えているのも同じ仕組みです。

## 早期return

```js
function saveMemo(memo) {
  if (!memo) return false;
  if (!memo.title.trim()) return false;

  writeMemo(memo);
  return true;
}
```

必要な値がなければすぐ終了することで、残りの処理を正常系として浅く書けます。

## 配列を扱う主要メソッド

元配列を変えるか、何を返すかを意識します。

| メソッド | 戻り値 | 主な用途 | 元配列 |
|---|---|---|---|
| `find` | 最初の一件または`undefined` | IDから一件探す | 変えない |
| `filter` | 条件に合う新しい配列 | 未完了だけ残す | 変えない |
| `map` | 同じ件数の新しい配列 | 表示用の形へ変換 | 変えない |
| `some` | boolean | 一件でも条件を満たすか | 変えない |
| `every` | boolean | 全件が条件を満たすか | 変えない |
| `forEach` | `undefined` | 各項目で副作用を行う | 処理次第 |
| `sort` | 並べ替えた同じ配列 | 日付順など | **変える** |
| `push` | 追加後の件数 | 末尾へ追加 | **変える** |
| `slice` | 切り出した新しい配列 | 一部だけ読む | 変えない |
| `splice` | 取り除いた配列 | 途中を追加・削除 | **変える** |

```js
const task = tasks.find(item => item.id === id);
const active = tasks.filter(item => !item.completed);
const titles = tasks.map(item => item.title);
const hasLate = tasks.some(item => item.dueDate < today);
```

`sort`は元配列を変更するので、保存順を守りたい場合は先にコピーします。

```js
const sorted = [...tasks].sort((a, b) => a.order - b.order);
```

## ループ

```js
for (const task of tasks) {
  if (task.completed) continue; // この一件だけ飛ばす
  if (task.id === targetId) break; // ループ全体を終了
  console.log(task.title);
}
```

`for...of`は値を順に読みます。`for...in`はオブジェクトのキーを読む別の構文なので混同しません。

## 分割代入、スプレッド、rest

```js
const { title, tags, starred } = memo;
const [first, second] = tasks;
const updated = { ...task, completed: true };
const allItems = [...events, ...scheduleItems];
```

スプレッド`...`は中身を展開します。関数の引数側で使うと、残りをまとめるrestになります。

```js
function logAll(first, ...rest) {
  console.log(first, rest);
}
```

## optional chainingとnull合体

```js
const title = memo?.title ?? '無題';
```

`memo?.title`は、`memo`が`null`や`undefined`ならエラーにせず`undefined`を返します。`??`は左側が
`null`または`undefined`の時だけ右側を使います。

```js
0 || 10;  // 10: 0もfalse相当だから
0 ?? 10;  // 0: 0は有効な値だから
```

## 文字列とテンプレート文字列

バッククォートの文字列は、`${...}`で値を埋め込め、改行も保持できます。

```js
const html = `
  <button data-id="${task.id}">
    ${esc(task.title)}
  </button>
`;
```

ユーザー入力は必ず`esc()`を通します。そうしないと`<script>`などがHTMLとして解釈される危険があります。

```js
title.trim();              // 前後の空白を除く
title.toLowerCase();       // 小文字化
tags.join(', ');           // 配列を文字列へ結合
text.split('\n');          // 文字列を改行で配列へ分割
text.includes('予定');     // 含むか
text.replace('旧', '新');  // 置換
```

文字列は変更不能です。`trim()`は元文字列を変えず、新しい文字列を返します。

## 正規表現

正規表現は、文字列の形を検索・置換する規則です。

```js
const normalized = text.replace(/\s+/g, ' ').trim();
```

- `/.../`: 正規表現
- `\s`: 空白文字
- `+`: 一文字以上の連続
- `g`: 最初だけでなく全箇所

強力ですが読みにくいため、複雑な式は「何を許可・削除するか」をコメントで説明します。

## importとexport

```js
// storage.js
export function getTasks() {
  return loadTasks();
}

// modules/tasks.js
import { getTasks } from '../storage.js';
```

`export`した機能だけを他ファイルが`import`できます。`../`は一つ上のフォルダです。importは単なる
文字列コピーではなく、同じ関数定義への接続です。

モジュールの最上位コードは、通常そのモジュールが最初に読み込まれた時に一度実行されます。そのため
モジュール変数は、画面の再描画をまたいで状態を保持する場合があります。

## 非同期処理とPromise

通信、画像読み込み、DB保存はすぐ完了しません。Promiseは「将来、成功値か失敗理由が決まる約束」です。

```js
async function loadData() {
  const response = await fetch('/api/data');
  const data = await response.json();
  return data;
}
```

`await`はその関数の続きだけを一時停止します。ブラウザー全体は止まらず、ほかのクリックや描画を処理できます。
`async function`の戻り値は必ずPromiseになります。

```js
const promise = loadData();    // まだ最終データではない
const data = await loadData(); // 完了したデータ
```

独立した処理をまとめて待つ場合は`Promise.all`を使います。

```js
const [events, tasks] = await Promise.all([loadEvents(), loadTasks()]);
```

一つずつ待つより速い一方、一件でも失敗すると全体が失敗扱いになります。

## try、catch、finally、throw

```js
try {
  const image = await uploadPlannerImage(file);
  showImage(image);
} catch (error) {
  showToast(error.message, 'error');
} finally {
  saveButton.disabled = false;
}
```

- `try`: 失敗する可能性がある処理
- `catch`: 失敗時の処理
- `finally`: 成功・失敗のどちらでも行う後始末
- `throw`: 呼び出し元へ失敗を伝える

```js
if (!title) throw new Error('タイトルが必要です');
```

空の`catch {}`は、補助キャッシュの失敗を無視する場合などに限ります。主要データ保存では利用者へ失敗を
知らせ、入力を画面に残す必要があります。

## JSONと保存可能な値

```js
const text = JSON.stringify(tasks); // JavaScript値 -> JSON文字列
const tasks = JSON.parse(text);      // JSON文字列 -> JavaScript値
```

関数、`undefined`、DOM要素などは通常のJSONへ保存できません。日時もDateオブジェクトのままではなく、
ISO文字列として保存し、必要な時に`new Date(value)`で戻します。

## SetとMap

```js
const ids = new Set(tasks.map(task => task.id));
ids.has(selectedId);

const byId = new Map(tasks.map(task => [task.id, task]));
const task = byId.get(id);
```

大量データからIDで何度も探す場合、毎回`find()`するよりMapを一度作る方が効率的です。

## Dateと時刻の注意

```js
const now = new Date();
const saved = new Date('2026-09-21T10:30:00');
```

Dateは年月日のほか、タイムゾーンも関係します。`toISOString()`はUTCへ変換するため、日本時間の日付だけを
求める場面でそのまま切り出すと一日前になる場合があります。このアプリでは`toDateStr()`などの共通関数を
使い、各画面が独自変換しないようにしています。

```js
const isNewer = new Date(a.updatedAt).getTime() > new Date(b.updatedAt).getTime();
```

## 純粋関数と副作用

```js
function minutesFromHour(hour) {
  return hour * 60;
}
```

同じ入力なら同じ結果を返し、外部を変えない関数を純粋関数と呼びます。テストしやすいため、分類、並び替え、
データ整形は可能な限り`*-model.js`へ分けています。

```js
localStorage.setItem(key, value); // 保存を変更
container.innerHTML = html;       // 画面を変更
await fetch(url);                 // 外部と通信
```

これらは副作用です。副作用が悪いのではなく、どこで起きるかを限定し、失敗時の扱いを明確にします。

## 一つのコードを分解して読む

```js
const visibleTasks = getTasks()
  .filter(task => !task.completed)
  .sort((a, b) => Date.parse(a.dueDate) - Date.parse(b.dueDate))
  .slice(0, 3);
```

1. `getTasks()`でタスク配列を得る
2. `filter`で未完了だけにする
3. `sort`で期限の古い順へ並べる
4. `slice`で先頭3件を得る
5. 最終配列へ`visibleTasks`という名前を付ける

メソッドチェーンが難しければ、一時変数へ分けて考えます。

```js
const allTasks = getTasks();
const incomplete = allTasks.filter(task => !task.completed);
const sorted = incomplete.sort((a, b) => Date.parse(a.dueDate) - Date.parse(b.dueDate));
const visibleTasks = sorted.slice(0, 3);
```

## 読めない行に出会った時の手順

1. 一番外側の代入、`return`、関数呼び出しを見つける
2. 丸括弧の内側を一段ずつ読む
3. 各変数の型を推測する
4. 関数名で定義を検索する
5. 呼び出し元と戻り値を確認する
6. 関連テストで具体例を見る

コメントは理解の手掛かりですが、最終的な仕様はコードとテストです。コメントと処理が違って見えたら、
処理を消す前に呼び出し元、保存形式、同期への影響を確認してください。
