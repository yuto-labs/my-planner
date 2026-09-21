# Python学習者のためのMy Planner JavaScript読解ガイド

この章は、Pythonの変数、`if`、`for`、関数などは見たことがある一方、JavaScriptとWebアプリ開発は
初めてという人を対象にしています。

Pythonとの対応を示しますが、「Pythonならこう書く」で終わらせません。JavaScriptの記号が何をし、
関数がいつ実行され、ブラウザーや保存データへどのような影響を与えるかまで説明します。

この章を読み終えた時の目標は、My Plannerの関数を見て次の五点を説明できることです。

1. その関数はどこで定義されているか
2. 何を引数として受け取るか
3. どの順番で何を処理するか
4. 何を返すか
5. 画面、保存データ、通信などを変更するか

## 1. JavaScriptファイルはどこで動くのか

My Plannerには、同じJavaScriptでも二つの実行場所があります。

### ブラウザーで動くJavaScript

`js/`以下の多くのファイルは、ChromeやSafariなど利用者のブラウザーで動きます。ブラウザー上なので、
次の機能を使えます。

- `document`: 表示中のHTMLを探す、追加する、変更する
- `window`: URL、画面、ブラウザー履歴などを扱う
- `localStorage`: そのブラウザー内へ文字列を保存する
- `fetch()`: サーバーへHTTP通信する
- `speechSynthesis`: 英文を音声で読み上げる

Pythonスクリプトには通常`document`がありません。これらはJavaScript言語そのものではなく、
ブラウザーがJavaScriptへ渡しているAPIです。

### サーバーで動くJavaScript

`api/`以下はVercel Functionとしてサーバー上で動きます。ここには画面がないため、`document`や
表示中の入力欄へアクセスできません。一方、Gemini APIキーのようにブラウザーへ公開してはいけない
秘密情報を安全に使えます。

同じ`.js`でも、どこで実行されるファイルかによって使える機能が違います。最初にファイルの場所を
見る理由はここにあります。

## 2. JavaScriptの一行を読むための記号

次の一行を例にします。

```js
const title = memo?.title?.trim() ?? '無題のメモ';
```

この一行には、Pythonにはない、または書き方の異なる記号が複数あります。

### `const`

`title`という名前へ値を代入し、その後`title = 別の値`という再代入を禁止します。

```js
const title = '研究メモ';
// title = '別の題名'; はエラー
```

Pythonの変数には`const`相当の標準構文がありません。JavaScriptでは、後で再代入しない名前を
明示するために使います。ただし、オブジェクト内部の変更まで禁止するわけではありません。

```js
const memo = { title: '研究メモ' };
memo.title = '変更後'; // 可能。memo自体は同じオブジェクトを指している
```

### `let`

後から再代入する変数を宣言します。

```js
let selectedDate = null;
selectedDate = '2026-09-21';
```

My Plannerでは、選択中の日付や開いている項目など、時間とともに変わる画面状態によく使います。

### `;`

文の終わりです。JavaScriptは多くの場合セミコロンを自動補完しますが、補完規則による意図しない
解釈を避け、文の区切りを明確にするため、このアプリでは基本的に書きます。

### `{}`

文脈によって二つの主な意味があります。

```js
if (ready) {
  startApp();
}
```

この`{}`は処理の範囲です。Pythonのインデントされたブロックに相当します。

```js
const memo = { id: 'm1', title: '研究' };
```

こちらはオブジェクトを作る記号です。Pythonの辞書に近いですが、JavaScriptでは文字列キーを
`memo.title`のようにドットで読むことが多くあります。

### `[]`

配列を作る、または番号・動的な項目名で値を読むときに使います。

```js
const tags = ['研究', '英語'];
tags[0];          // '研究'
memo['title'];    // memo.titleと同じ
memo[fieldName];  // fieldNameの中身を項目名として使う
```

### `.`

オブジェクトが持つ項目や関数へ進みます。

```js
memo.title
title.trim()
tasks.filter(...)
```

左側の値が何かを確認してから右へ進みます。`tasks.filter(...)`なら、`tasks`は配列で、配列が持つ
`filter`という関数を呼んでいます。

### `?.` optional chaining

左側が`null`または`undefined`なら、エラーにせず`undefined`を返します。

```js
memo?.title
```

Python風に意味を展開すると、概念的には次の分岐です。

```python
memo.title if memo is not None else None
```

さらに`memo?.title?.trim()`と続く場合、memoがない場合だけでなく、titleがない場合も安全に停止します。

optional chainingは便利ですが、本来必ず存在すべき要素まで黙って`undefined`にすると、不具合の原因を
隠すことがあります。「なくても正常」な値に使うものです。

### `??` nullish coalescing

左側が`null`または`undefined`のときだけ、右側を使います。

```js
const title = memo.title ?? '無題';
```

空文字`''`や数値`0`は有効な値として残します。`||`とはこの点が違います。

```js
'' || '無題'; // '無題'
'' ?? '無題'; // ''
```

入力した空文字にも意味がある場合、`??`の方が意図に合います。

### `===`と`!==`

型と値の両方を比較します。

```js
task.id === selectedId
task.type !== 'memo'
```

JavaScriptの`==`は自動型変換を行い、`'1' == 1`をtrueにします。予想しにくいため、このアプリでは
原則として`===`と`!==`を使います。Pythonの`==`に近い感覚で使うのはJavaScriptの`===`です。

### 三項演算子 `条件 ? A : B`

短い条件分岐を一つの値として書きます。

```js
const label = task.completed ? '完了' : '未完了';
```

Pythonの条件式なら次に近い意味です。

```python
label = '完了' if task.completed else '未完了'
```

三項演算子が何重にも入ると読みにくいため、複雑な条件は`if`へ分けます。

### テンプレート文字列

バッククォートで囲み、`${}`の中へ値や式を埋め込みます。

```js
const message = `${task.title}の期限は${task.dueDate}です`;
```

Pythonのf-stringに近い機能です。

```python
message = f'{task.title}の期限は{task.dueDate}です'
```

HTMLを組み立てる関数では複数行のテンプレート文字列も使います。ただし、ユーザー入力を直接埋めると
HTMLとして解釈される危険があるため、`escapeHTML()`などで安全な文字へ変換します。

## 3. JavaScriptの関数定義を形ごとに読む

JavaScriptには関数を書く形が複数あります。機能が完全に同じとは限りませんが、My Plannerを読む
最初の段階では「名前、引数、処理、戻り値」を見つけることが重要です。

### function宣言

```js
function findMemo(id) {
  return memos.find((memo) => memo.id === id);
}
```

構造を分解します。

- `function`: 関数を定義するキーワード
- `findMemo`: 関数名
- `(id)`: 呼び出し側から受け取る引数の受取名
- `{ ... }`: 呼び出された時に実行する本体
- `return`: 呼び出し元へ返す値

呼び出しは次の形です。

```js
const memo = findMemo('memo-123');
```

`'memo-123'`が`id`へ入り、関数が返したメモが変数`memo`へ入ります。

Pythonとの違いは、ブロックをインデントだけでなく`{}`で囲むこと、行末に`;`を書くこと、
関数宣言に型注釈がないことです。

### 関数式

```js
const findMemo = function (id) {
  return memos.find((memo) => memo.id === id);
};
```

匿名関数を作り、それを`findMemo`へ代入しています。`function findMemo(...)`と似ていますが、関数式は
代入が実行される前には呼べません。My Plannerではコールバックや局所的な関数で見かけます。

### アロー関数

```js
const findMemo = (id) => {
  return memos.find((memo) => memo.id === id);
};
```

`=>`の左が引数、右が処理です。引数が一つなら括弧を省略できます。

```js
const isCompleted = task => task.completed;
```

波括弧を省略すると、右側の式を自動的にreturnします。

```js
const isCompleted = task => task.completed;
```

これは次と同じ結果です。

```js
const isCompleted = (task) => {
  return task.completed;
};
```

一方、波括弧を付けて`return`を書かなければ`undefined`を返します。

```js
const isCompleted = (task) => {
  task.completed; // 読んでいるだけ。返していない
};
```

### アロー関数がよく使われる理由

JavaScriptでは関数を別の関数へ値として渡すことが多いため、短く書けるアロー関数が頻出します。

```js
tasks.filter((task) => !task.completed);
```

`filter`へ「各taskについて未完了か判定する関数」を渡しています。Pythonのリスト内包表記に近い結果を
得ますが、JavaScriptでは処理そのものを引数として渡している点を意識します。

### `async function`

```js
async function requestAnswer(question) {
  const response = await fetch('/api/ai/generate', {
    method: 'POST',
    body: JSON.stringify({ question }),
  });
  return response.json();
}
```

`async`を付けた関数は必ずPromiseを返します。`await`はPromiseの結果が決まるまで、その関数の続きだけを
待ちます。Pythonの`async def`と`await`に近い構文ですが、ブラウザーではクリックや描画と並行して
非同期処理が進むため、待機中に画面状態が変わる点が重要です。

### `export function`

```js
export function getEvents() {
  return load(KEY.EVENTS, []);
}
```

`export`は、このファイルの外からimportできる公開関数にする指定です。

```js
import { getEvents } from '../storage.js';
```

Pythonの`from storage import get_events`に近い役割ですが、JavaScriptのES Modulesでは拡張子`.js`まで
書き、ブラウザーが依存ファイルを読み込みます。

`export`されていない関数は、そのモジュール内部だけで使う実装詳細です。My Plannerで`load()`が非公開、
`getEvents()`が公開なのは、画面側に保存キーやJSON解析を意識させないためです。

## 4. 引数の書き方

### 通常の引数

```js
function updateTask(id, changes) {
  // idとchangesを使う
}

updateTask('task-1', { completed: true });
```

JavaScriptは通常、引数の型や個数を実行前に強制しません。足りない引数は`undefined`になり、余分な
引数は無視されます。そのため、関数内の検証とJSDocが重要です。

### 既定値

```js
function renderPreview(blocks, maxBlocks = 7) {
  // maxBlocksを省略した場合は7
}
```

`renderPreview(blocks)`なら7、`renderPreview(blocks, 3)`なら3を使います。

既定値が使われるのは、引数が省略されたか`undefined`のときです。明示的な`null`には適用されません。

### 分割代入でオプションを受け取る

```js
function navigate(view, {
  preserveScroll = false,
  skipUnsavedGuard = false,
} = {}) {
  // ...
}
```

呼び出し側は次のように、必要なオプションだけ名前付きで渡せます。

```js
navigate('memo', { preserveScroll: true });
```

`= {}`は、二つ目の引数自体を省略しても分割代入でエラーにならないための既定値です。Pythonの
キーワード引数に似た読みやすさを、JavaScriptではオブジェクトを渡すことで実現しています。

### rest parameter

```js
function joinTags(...tags) {
  return tags.join(', ');
}
```

`...tags`は残りの引数を一つの配列として受け取ります。

```js
joinTags('英語', '研究', '重要');
```

関数内の`tags`は`['英語', '研究', '重要']`です。Pythonの`*args`に近い機能です。

## 5. 戻り値と副作用を分けて考える

### 値を返す関数

```js
function formatTitle(memo) {
  return memo.title.trim() || '無題のメモ';
}
```

この関数は入力から文字列を計算して返します。呼び出しただけでは画面や保存データを変えません。

### 外部を変更する関数

```js
function saveEvents(events) {
  localStorage.setItem('events', JSON.stringify(events));
}
```

明示的なreturnがなくても、localStorageを変更する役割があります。このような外部変更を副作用と
呼びます。主な副作用は次の通りです。

- DOMを書き換えて画面表示を変える
- localStorageやSupabaseへ保存する
- APIへ通信する
- URLやブラウザー履歴を変える
- 音声を再生する
- module上部の共有変数を書き換える

関数名だけでなく、本体で何へ代入し、どのAPIを呼んでいるかを確認します。

### booleanで成否を返す関数

```js
function saveEvents(events) {
  if (!save(KEY.EVENTS, events)) return false;
  notifySync('events');
  return true;
}
```

この関数には副作用と戻り値の両方があります。保存に失敗すれば`false`を返して終了し、成功時だけ同期へ
通知して`true`を返します。呼び出し側は戻り値を見て通知内容を変えられます。

## 6. 配列メソッドという「関数」

Pythonでは`for`やリスト内包表記で書く処理を、JavaScriptでは配列メソッドとコールバックで書くことが
よくあります。どの関数も「何を引数に受け、何を返し、元配列を変更するか」を覚えます。

### `find()`

条件に合う最初の一件を返します。見つからなければ`undefined`です。

```js
const memo = memos.find((item) => item.id === memoId);
```

`item`にはmemosの各要素が順番に入ります。callbackが初めてtrueを返した時点で探索を終了します。

### `filter()`

条件に合う要素だけを含む新しい配列を返します。元配列は変更しません。

```js
const activeTasks = tasks.filter((task) => !task.completed);
```

Pythonなら`[task for task in tasks if not task.completed]`に近い結果です。

### `map()`

各要素を別の値へ変換し、同じ件数の新しい配列を返します。

```js
const titles = tasks.map((task) => task.title);
```

元配列が3件ならcallbackも3回呼ばれ、結果配列も3件です。

### `some()`と`every()`

```js
const hasOverdue = tasks.some((task) => task.isOverdue);
const allCompleted = tasks.every((task) => task.completed);
```

`some`は一件でもtrueならtrue、`every`は全件trueならtrueです。結果は配列ではなくbooleanです。

### `sort()`

```js
tasks.sort((a, b) => a.dueAt - b.dueAt);
```

比較関数が負ならaを前、正ならbを前、0なら同順位とします。他のメソッドと違い、`sort()`は元配列を
直接変更します。保存済み順序を壊したくない場合はコピーしてから並べます。

```js
const sorted = [...tasks].sort(compareTasks);
```

### `forEach()`

各要素で処理を実行しますが、新しい配列は返しません。

```js
buttons.forEach((button) => {
  button.disabled = true;
});
```

変換結果が必要なら`map()`、副作用を各要素へ行うなら`forEach()`という使い分けです。

## 7. オブジェクトの展開とコピー

### spread syntax

```js
const updated = {
  ...task,
  completed: true,
};
```

`...task`でtaskの各項目を新しいオブジェクトへ展開し、その後の`completed: true`で同名項目を上書き
します。元のtaskを直接変更せず、新しいオブジェクトを作ります。

配列でも使えます。

```js
const nextTasks = [...tasks, newTask];
```

既存要素を展開し、末尾へnewTaskを加えた新しい配列です。

ただし、これは一段目だけのshallow copyです。

```js
const copy = { ...memo };
copy.tags.push('重要');
```

`copy.tags`と`memo.tags`は同じ内側配列を参照しているため、元memoのtagsも変わります。内側も変えるなら
次のようにコピーします。

```js
const copy = {
  ...memo,
  tags: [...memo.tags, '重要'],
};
```

## 8. DOM関数: 画面を探し、変更する

DOMはHTMLをJavaScriptから扱う仕組みです。Pythonの標準機能ではなく、ブラウザーAPIです。

### `document.querySelector()`

```js
const saveButton = document.querySelector('#save-button');
```

CSSセレクターに一致する最初のHTML要素を返します。見つからなければ`null`です。

- `#save-button`: idが`save-button`の要素
- `.memo-card`: classに`memo-card`を持つ要素
- `[data-id="m1"]`: data-id属性がm1の要素

### `querySelectorAll()`

```js
const cards = document.querySelectorAll('.memo-card');
```

一致する全要素をNodeListとして返します。`forEach()`で各要素を処理できます。

### `textContent`と`innerHTML`

```js
titleElement.textContent = memo.title;
```

文字として表示します。`<strong>`が含まれてもタグとして実行されません。

```js
container.innerHTML = '<button>保存</button>';
```

文字列をHTMLとして解析し、子要素を作ります。便利ですが、代入前の子要素を破棄するため、それらに
登録したイベントも失われます。また、ユーザー入力を無加工で入れるとセキュリティ問題になります。

## 9. イベント関数: 操作された時に実行する

```js
saveButton.addEventListener('click', handleSave);
```

`addEventListener()`は次の二つを受け取ります。

1. `'click'`: どの出来事を待つか
2. `handleSave`: 出来事が起きたら呼ぶ関数

ここで`handleSave()`と書かない理由は、今すぐ実行したくないからです。関数そのものを渡し、
ブラウザーに後で呼んでもらいます。

引数を追加して呼びたい場合は、別のアロー関数で包みます。

```js
saveButton.addEventListener('click', () => saveMemo(container));
```

登録時には外側の`() => ...`だけを作ります。クリック時にその関数が実行され、初めて
`saveMemo(container)`が呼ばれます。

event情報を受け取る場合は次の形です。

```js
saveButton.addEventListener('click', (event) => {
  event.preventDefault();
  saveMemo(container);
});
```

`event`には押された要素、座標、キー状態などが入っています。`preventDefault()`はフォーム送信やリンク
遷移など、ブラウザー標準動作を止めます。

## 10. モジュールとライブラリ

### モジュールとは何か

モジュールは、一つの責務を持つJavaScriptファイルです。My Plannerでは次のように分けています。

- `storage.js`: 端末データの読み書き
- `sync.js`: Supabaseとの同期
- `media.js`: 画像の保存と表示
- `modules/calendar.js`: カレンダー画面
- `modules/knowledge.js`: メモ画面

一つの巨大なファイルへ全機能を書くと、同じ関数名が衝突し、変更の影響範囲も分かりません。
`export`で外部へ公開する機能を絞り、`import`で必要なものだけ受け取ります。

```js
// storage.js
export function getTasks() {
  return load(KEY.TASKS, []);
}
```

```js
// modules/tasks.js
import { getTasks } from '../storage.js';
```

### ライブラリとは何か

ライブラリは、自分で一から実装せず利用できる外部コードです。Pythonの`pip install`したパッケージに
近いものです。ブラウザーではnpmパッケージ、CDN、ローカルに含めたファイルなどから読み込みます。

My Plannerは大部分をVanilla JavaScriptで書いています。これはReactやVueのような画面フレームワークを
使わず、DOM APIを直接使っているという意味です。一方、SupabaseクライアントやKaTeXなど、目的が
明確なライブラリは利用しています。

ライブラリ関数を見分けるにはimport元を確認します。

```js
import { createClient } from '@supabase/supabase-js';
```

文字列が`./`や`../`で始まらなければ、通常はプロジェクト外部のパッケージです。

## 11. 保存と通信で使う関数

### `JSON.stringify()`と`JSON.parse()`

localStorageやHTTP本文では、オブジェクトをそのまま保存できないためJSON文字列へ変換します。

```js
const text = JSON.stringify({ title: '研究' });
const object = JSON.parse(text);
```

- `stringify`: JavaScriptの値からJSON文字列へ
- `parse`: JSON文字列からJavaScriptの値へ

Pythonの`json.dumps()`と`json.loads()`に近い役割です。

### `localStorage.getItem()`と`setItem()`

```js
localStorage.setItem('tasks', JSON.stringify(tasks));
const raw = localStorage.getItem('tasks');
```

localStorageは文字列だけを保存します。同じブラウザー内の保存であり、スマホとPCの同期ではありません。
端末間同期は別途Supabaseとの通信が必要です。

### `fetch()`

```js
const response = await fetch('/api/ai/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
```

- 第1引数: 通信先URL
- 第2引数: HTTPメソッド、ヘッダー、本文などの設定
- 戻り値: HTTP応答を表すPromise

`fetch()`が正常に返っても、サーバー処理が成功したとは限りません。404や500でもResponseは返るため、
`response.ok`を確認します。

```js
if (!response.ok) {
  throw new Error(`HTTP ${response.status}`);
}
```

## 12. My Plannerの実関数を読む

### `load(key, fallback)`

```js
function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw !== null ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
```

#### 定義の書き方

`function 関数名(parameter...) { 本体 }`というfunction宣言です。exportがないため`storage.js`内部だけで
使う補助関数です。

#### 引数

- `key`: localStorageで探す保存名
- `fallback`: データがない、または壊れている場合に返す既定値

#### 処理

1. `localStorage.getItem(key)`で文字列を取得する
2. `null`でなければ`JSON.parse(raw)`で元の配列やオブジェクトへ戻す
3. データがなければfallbackを返す
4. JSONが壊れていてparseに失敗してもcatchでfallbackを返す

#### 戻り値と副作用

読み取りだけなのでlocalStorageを変更しません。保存値またはfallbackを返します。この関数により、
公開関数はJSON解析や初回起動の例外処理を毎回書かずに済みます。

### `getEvents()`

```js
export function getEvents() {
  return load(KEY.EVENTS, []);
}
```

#### 定義の書き方

`export function`なので、別モジュールからimportできる公開関数です。引数はありません。

#### 処理

`KEY.EVENTS`を保存名、空配列`[]`をfallbackとして内部の`load()`を呼びます。初回起動でも呼び出し側は
必ず配列として予定を扱えます。

#### 設計上の意味

画面側はlocalStorageのキー名、JSON、例外処理を知る必要がありません。保存方法をIndexedDBなどへ
変えても、`getEvents()`の契約を保てば画面側の変更を減らせます。

### `saveEvents(events)`

```js
export function saveEvents(events) {
  if (!save(KEY.EVENTS, events)) return false;
  _notifySync('events');
  return true;
}
```

#### 引数

保存する予定オブジェクトの配列です。

#### 処理

1. 内部関数`save()`で端末へ保存する
2. `save()`がfalseなら即座にfalseを返し、同期通知は行わない
3. 成功時は`_notifySync('events')`で同期層へ変更を知らせる
4. 最後にtrueを返す

#### 副作用

localStorageを変更し、同期処理を予約します。「配列を返す関数」ではなく、外部状態を変更する関数です。

### `navigate(view, options = {})`

```js
export function navigate(view, options = {}) {
  if (!MODULES[view]) view = 'home';
  if (view === currentView) return;
  // 以前の画面を片付け、新しい画面を読み込む処理が続く
}
```

#### 引数

- `view`: `'home'`、`'calendar'`などの画面名
- `options`: スクロール維持や未保存確認などの追加設定。省略時は空オブジェクト

#### 最初の二つの分岐

存在しない画面名ならhomeへ補正します。既に同じ画面なら不要な再描画を避けるため終了します。

#### 副作用

現在画面のcleanup、URL更新、DOMの差し替え、新しいmoduleの初期化を行います。単純な値変換より
影響範囲が大きいため、意図しない画面遷移では`navigate()`の呼び出し元を`Shift+F12`で探します。

### `renderMemoCardPreview(blocks, maxBlocks = 7)`

この名前は三つに分けて読めます。

- `render`: 表示用のHTMLを作る
- `MemoCard`: メモ一覧の一枚のカード
- `Preview`: 本文全体ではなく短いプレビュー

`blocks`を受け、最大`maxBlocks`件を表示用に整えます。`maxBlocks = 7`は省略時の既定値です。
`render...`は通常保存を担当しません。保存まで行っているようなら、責務が混ざっていないか確認します。

## 13. 関数名から役割を推測する規則

英語の接頭語は厳密な文法ではなく、このアプリ内の命名規約です。

### `get...`

既存データを取得します。通常は新しい保存を行いません。

```js
getTasks()
getEvents()
getSettings()
```

### `save...`

データ全体を保存します。同期通知を含む場合があります。

### `add...` / `update...` / `delete...`

一件の追加、既存項目の更新、削除を表します。内部では現在の配列を取得し、変更後に`save...`を呼ぶ
構造が多くあります。

### `render...`

現在のstateや保存データから表示を作ります。返り値がHTML文字列の場合と、DOMを直接変更する場合が
あるため、本体を確認します。

### `init...`

画面や機能を初期化します。HTML描画、イベント登録、初回データ取得をまとめる入口です。通常は
画面を開いた直後に一度呼ばれます。

### `wire...` / `setup...`

ボタンや入力欄へevent listenerを登録し、UIと処理を結び付けます。画面が再描画された場合に再登録が
必要か、同じlistenerを重複登録していないかが重要です。

### `handle...`

クリック、入力、貼り付けなどのeventへ反応する関数です。eventを引数に受けることが多くあります。

### `normalize...`

欠けた項目、古い形式、表記揺れを共通形式へそろえます。保存前、比較前、表示前に使われます。

### `validate...`

値が必要条件を満たすか確認します。booleanやエラー一覧を返すことが多く、通常はデータを保存しません。

### `merge...`

複数のデータを統合します。同期では「どちらか一方で上書き」せず、更新日時や項目IDを見て両方の変更を
残す役割があります。

## 14. 初めて見る関数を調べる手順

### 1. 定義へ移動する

VS Codeで関数名へカーソルを置き、`F12`を押します。別ファイルで定義されていれば、そのファイルへ
移動します。

### 2. import元を確認する

ファイル先頭の`import`にあれば、自作moduleまたは外部libraryの関数です。`./`や`../`から始まるなら
プロジェクト内、パッケージ名なら外部libraryです。

### 3. parameterと既定値を書く

関数定義の丸括弧だけを見て、入力を列挙します。分割代入されている場合は、オプション名も書きます。

### 4. returnをすべて探す

成功時だけでなく、途中の`return false`や`return null`も確認します。条件によって返す型が変わる場合、
呼び出し側の扱いも確認します。

### 5. 副作用を探す

次があれば、値を計算するだけの関数ではありません。

- `=`でmodule上部の変数を変更
- `.textContent`や`.innerHTML`へ代入
- `localStorage.setItem()`
- `save...()`や`update...()`
- `fetch()`やSupabase呼び出し
- `window.location`やhistory変更

### 6. 使用箇所へ戻る

`Shift+F12`で呼び出し箇所を一覧表示します。実際のargumentと戻り値の使い方を見ると、関数の契約が
具体的になります。

## 次に読む順番

1. この章でJavaScript固有の記法と関数の形を理解する
2. [`javascript-browser-apis.md`](javascript-browser-apis.md)でDOM、イベント、通信を詳しく読む
3. [`function-map.md`](function-map.md)でMy Plannerの機能別の入口を探す
4. [`feature-walkthroughs.md`](feature-walkthroughs.md)で一つの操作を保存・同期まで追う

一般的なプログラミング概念で迷った場合だけ、より基礎から説明する
[`javascript-first-course.md`](javascript-first-course.md)へ戻ってください。
