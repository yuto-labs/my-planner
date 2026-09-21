# JavaScriptを初めて読む人のための基礎講座

この章は、プログラミングをほとんど知らない状態から、My Plannerの短い関数を自分で読めるように
なるための教材です。用語を一文で暗記することは目的にしません。コードが実行される様子を頭の中で
追えるようになることを優先します。

Pythonの変数、条件分岐、関数をすでに学んでいる場合は、この章を最初から読む必要はありません。
[`javascript-for-python-learners.md`](javascript-for-python-learners.md)を主教材にし、一般概念で
分からない部分が出た時だけこの章へ戻ってください。

最初からすべて覚える必要はありません。まず第1部から第7部までを順に読み、その後で実際の
`js/storage.js`を開いてください。分からない記号が出たときだけ、この章へ戻れば十分です。

## 第1部: コードは「上から読む文章」ではなく「実行される指示」

JavaScriptのコードは、コンピューターへ処理を指示する文章です。ただし、説明文のように読んだだけで
意味が決まるのではなく、**どの順番で実行されたか**によって結果が変わります。

```js
const first = 10;
const second = first + 5;
console.log(second);
```

コンピューターは通常、次の順番で処理します。

1. `10`という数値を作り、`first`という名前で覚える
2. `first`の現在値`10`を取り出し、`5`を足す
3. 計算結果`15`を`second`という名前で覚える
4. `second`の現在値をConsoleへ表示する

人間には三行しかありませんが、各行では「値を作る」「名前を付ける」「値を取り出す」「関数を
呼ぶ」という複数の動作が起きています。コードが読めないときは、一行をさらに小さな動作へ分けます。

### 実行されないコードもある

次のコードは、上から読んでも`保存しました`を表示しません。

```js
function announceSave() {
  console.log('保存しました');
}
```

これは関数の**定義**だからです。「後で`announceSave`という名前を呼ばれたら、この処理を行う」と
登録しただけです。実行するには呼び出しが必要です。

```js
announceSave();
```

関数名の後ろの`()`は「この関数を今実行する」という意味です。この区別はMy Plannerを読むうえで
最重要です。画面を開いたときに定義された関数と、ボタンを押したときに初めて実行される関数を
混同すると、処理の時点が分からなくなります。

## 第2部: 値と変数

### 値とは何か

値は、プログラムが扱う具体的な情報です。

```js
'英語の勉強'  // 文字列
45             // 数値
true           // 真偽値
null           // 意図的に「値なし」
```

値には種類があります。種類によって可能な操作が違います。数値なら足し算でき、文字列なら文字を
つなげられます。`true`と`false`は、「完了しているか」「画面が開いているか」など、二択の状態を
表します。

```js
10 + 5;                  // 15
'My ' + 'Planner';       // 'My Planner'
```

一見似ていても、`'10'`は文字列、`10`は数値です。

```js
'10' + 5; // '105'。文字列としてつながる
10 + 5;   // 15。数値として足される
```

この違いは入力欄を扱うときによく現れます。HTMLの入力欄から読んだ値は、数字に見えても最初は文字列
です。計算に使うなら`Number(input.value)`のように数値へ変換します。

### 変数は「箱」より「名前付きの付箋」と考える

```js
const title = '英語の勉強';
```

この行は次の四つに分けられます。

- `const`: `title`へ別の値を再代入しないと宣言する
- `title`: 後から値を参照するための名前
- `=`: 右側の値を左側の名前へ関連付ける
- `'英語の勉強'`: 実際の値

数学の`=`は左右が等しいことを表しますが、JavaScriptの代入に使う`=`は「右の計算結果を左へ入れる」
という命令です。

```js
let count = 1;
count = count + 1;
```

数学なら`count = count + 1`は成立しません。コードでは、まず右側の古い`count`を読み、`1`を足した
結果`2`を、左側の`count`へ改めて代入します。

### `const`と`let`の役割

`const`は、その名前を別の値へ付け替えません。

```js
const appName = 'My Planner';
```

`let`は、後から値を付け替える必要がある状態に使います。

```js
let selectedDate = null;
selectedDate = '2026-09-21';
```

最初は`const`を使い、本当に再代入が必要な場合だけ`let`にすると、どの値が途中で変わるか読みやすく
なります。

ただし、`const`はオブジェクトの中身まで変更禁止にする機能ではありません。

```js
const task = { title: '提出', completed: false };
task.completed = true; // 可能
```

`task`という名前は同じオブジェクトを指したままです。そのオブジェクト内の`completed`だけを変えて
います。この「名前の再代入」と「中身の変更」の違いは、同期処理を理解する際にも重要です。

## 第3部: 配列とオブジェクトで情報をまとめる

実際のアプリでは、単独の文字列だけでなく、予定、タスク、メモなど複数の情報をまとめて扱います。

### オブジェクトは一件分の名前付きデータ

```js
const task = {
  id: 'task-1',
  title: 'ESを提出する',
  completed: false,
  dueDate: '2026-09-25',
};
```

波括弧`{}`の中に、`項目名: 値`をカンマで区切って並べています。このオブジェクトは一件のタスクを
表します。値を読むには、変数名の後ろへ`.`と項目名を付けます。

```js
task.title;      // 'ESを提出する'
task.completed;  // false
```

`task.title`は「taskというオブジェクトのtitle項目を読む」と左から解釈します。

項目名が変数に入っている場合は角括弧を使います。

```js
const fieldName = 'title';
task[fieldName]; // task.titleと同じ結果
```

### 配列は複数件を順番に並べる

```js
const tasks = [
  { id: 'task-1', title: 'ESを提出する' },
  { id: 'task-2', title: '英語を復習する' },
];
```

角括弧`[]`は配列です。この例では二件のタスクオブジェクトを順番に持っています。位置を表す番号は
`0`から始まります。

```js
tasks[0].title; // 一件目のtitle
tasks[1].title; // 二件目のtitle
tasks.length;   // 件数なので2
```

`tasks[0].title`は一度に理解しなくても構いません。

1. `tasks`は配列
2. `tasks[0]`で一件目のオブジェクトを得る
3. その結果の`.title`を読む

このように左から一段ずつ型を考えると読めます。

### 配列を探す

```js
const target = tasks.find((task) => task.id === 'task-2');
```

この一行を分解します。

1. `tasks.find(...)`は、配列から条件に合う最初の一件を探す
2. `find`は各要素を一件ずつ`task`という名前で関数へ渡す
3. `task.id === 'task-2'`が`true`になるか確認する
4. 最初に`true`となったタスクを`target`へ代入する
5. 一件もなければ`target`は`undefined`になる

最初はこの一行を「task-2というIDのタスクを探している」と読めれば十分です。後で関数と
コールバックを学ぶと、丸括弧の中まで説明できるようになります。

## 第4部: 条件分岐

アプリは、同じ処理を常に行うわけではありません。「データがある場合だけ表示する」「未完了なら
チェックを付けない」のように条件で処理を変えます。

```js
if (task.completed) {
  console.log('完了済み');
} else {
  console.log('未完了');
}
```

読む順番は次の通りです。

1. 丸括弧内の`task.completed`を評価する
2. `true`なら最初の波括弧内を実行する
3. `false`なら`else`側を実行する
4. 選ばれなかった側は実行しない

### 比較演算子

```js
task.id === selectedId   // 同じ型・同じ値か
task.id !== selectedId   // 異なるか
tasks.length > 0         // 0より大きいか
count >= 5               // 5以上か
```

`===`は比較であり、`=`は代入です。ここを取り違えると意味が完全に変わります。

### 複数条件

```js
if (task.title && !task.completed) {
  showTask(task);
}
```

- `&&`: 左右の両方が成立するとき
- `||`: 左右のどちらかが成立するとき
- `!`: trueとfalseを反転する

上の条件は「タイトルが空でなく、かつ、完了していないなら」と読めます。

### 値がない場合を先に終わらせる

```js
function openTask(task) {
  if (!task) return;
  console.log(task.title);
}
```

`task`が存在しないときに、その後の`task.title`を読むとエラーになります。そこで先に関数を終了させます。
これをearly returnと呼びます。長い関数では「どんな場合に途中終了するか」を先に読むと、正常時の
処理を理解しやすくなります。

## 第5部: 関数を本当に理解する

関数はMy Plannerのコードを読む中心です。関数は単なる「処理の集まり」ではなく、**入力と出力と
副作用の境界**です。

### 最小の関数

```js
function double(number) {
  const result = number * 2;
  return result;
}
```

一行ずつ読みます。

```js
function double(number) {
```

- `function`: これから関数を定義する
- `double`: 関数名。処理内容を表す名前
- `(number)`: 呼び出し元から一つ値を受け取り、関数内では`number`と呼ぶ
- `{`: 関数の処理範囲の開始

```js
const result = number * 2;
```

受け取った`number`を2倍にし、その一時的な計算結果へ`result`という名前を付けます。

```js
return result;
```

結果を呼び出し元へ返し、この関数の実行を終了します。

```js
}
```

関数の処理範囲を閉じます。

### 定義と呼び出しをつなぐ

```js
const answer = double(5);
```

呼び出し時には次のことが起きます。

1. `5`をargument（実引数）として渡す
2. 関数内のparameter（仮引数）`number`が`5`を指す
3. `number * 2`を計算して`10`を作る
4. `return`で`10`を呼び出し位置へ返す
5. `double(5)`という式全体が`10`になる
6. `answer`へ`10`を代入する

関数呼び出しは「別の場所へ移動して処理し、戻り値を持って元の場所へ帰る」と考えると理解しやすく
なります。

### parameterとargumentを区別する理由

```js
function createLabel(title, count) { // titleとcountがparameter
  return `${title} (${count})`;
}

createLabel('タスク', 3); // 'タスク'と3がargument
```

parameterは関数側が要求する入力の形式、argumentは呼び出す側が渡す具体的な値です。この区別が
分かると、関数定義を見て「何を渡せば使えるか」、呼び出し側を見て「今回は何を渡しているか」を
別々に確認できます。

### 戻り値と画面変更は違う

```js
function getTaskTitle(task) {
  return task.title;
}

function showTaskTitle(task) {
  document.querySelector('#title').textContent = task.title;
}
```

`getTaskTitle()`は文字列を返します。呼び出しただけでは画面を変えません。`showTaskTitle()`は画面を
変えますが、明示的な戻り値はありません。このような画面変更や保存はside effect（副作用）です。

関数を読むときは、必ず次を確認します。

1. 入力は何か
2. 戻り値は何か
3. 外部の画面・データ・通信を変更するか
4. どんな条件で途中終了するか

### 関数内の変数は外から見えない

```js
function buildGreeting(name) {
  const message = `こんにちは、${name}さん`;
  return message;
}

console.log(message); // エラー
```

`message`は関数内で宣言されたため、その関数の中だけで使えます。これがscopeです。関数ごとに作業机が
分かれていると考えてください。別の関数の机にある一時変数を勝手に読むことはできません。

### 同じ関数を複数回呼ぶ

```js
const first = buildGreeting('Yuto');
const second = buildGreeting('Aki');
```

一回目と二回目の`name`や`message`は別物です。同じ関数定義を使いますが、呼び出しごとに新しい
ローカルscopeが作られます。

### 関数から関数を呼ぶ

```js
function saveTask(task) {
  const normalized = normalizeTask(task);
  writeTasks(normalized);
  showSavedMessage();
}
```

`saveTask()`の実行中に`normalizeTask()`へ入り、終わったら`saveTask()`の次の行へ戻ります。さらに
`writeTasks()`へ入り、戻ってきます。この「現在どの関数の何行目へ戻るか」を積み重ねる仕組みが
call stackです。

エラー画面に表示されるstack traceは、この呼び出しの積み重ねです。上から「エラーが発生した場所」、
その下へ「そこを呼んだ関数」が並ぶため、不具合の経路をたどれます。

### 既定値

```js
function showToast(message, type = 'info') {
  console.log(type, message);
}

showToast('保存しました');          // typeは'info'
showToast('保存できません', 'error'); // typeは'error'
```

argumentを省略した場合だけ既定値が使われます。呼び出し側の大半が同じ値を使うときに便利です。

### オプションオブジェクト

argumentが増えると、値の順番だけでは意味が分かりません。

```js
openViewer(image.path, image.caption, true, false);
```

オブジェクトで渡すと、呼び出し側だけでも意味を読めます。

```js
openViewer({
  path: image.path,
  caption: image.caption,
  allowDelete: true,
  startZoomed: false,
});
```

受け取り側では分割代入します。

```js
function openViewer({ path, caption = '', allowDelete = false }) {
  // path、caption、allowDeleteを通常の変数として使える
}
```

## 第6部: アロー関数とコールバック

JavaScriptでは、関数そのものも値として渡せます。

```js
function handleSave() {
  console.log('保存');
}

button.addEventListener('click', handleSave);
```

ここでは`handleSave()`と書かないことが重要です。

- `handleSave`: 関数そのものをブラウザーへ渡す
- `handleSave()`: 今この場で実行し、戻り値を渡す

ブラウザーは渡された関数を覚え、将来クリックされた時に呼びます。この「後で相手に呼んでもらう
関数」がcallbackです。

### アロー関数は別の書き方

```js
const double = (number) => {
  return number * 2;
};
```

短い場合は次のように書けます。

```js
const double = number => number * 2;
```

これは一行の式`number * 2`を自動でreturnします。ただし波括弧を付けたら`return`が必要です。

```js
const double = number => {
  number * 2; // 計算はするがreturnしないため、戻り値はundefined
};
```

### 配列とcallback

```js
const incompleteTasks = tasks.filter((task) => {
  return !task.completed;
});
```

`filter()`は次のように動きます。

1. 配列から一件目を取り出す
2. その一件を`task`としてcallbackへ渡す
3. callbackが返したtrue/falseを確認する
4. trueなら新しい配列へ残す
5. 全件で同じことを繰り返す
6. 条件に合った要素の新しい配列を返す

`map()`は、残すかどうかではなく、各要素を別の値へ変換します。

```js
const titles = tasks.map((task) => task.title);
```

二件のtaskがあればcallbackを二回呼び、二件のtitleからなる新しい配列を返します。

## 第7部: エラーを「失敗」ではなく処理の分岐として読む

存在しない項目を無理に読むなど、JavaScriptが処理を続けられないと例外が発生します。

```js
const task = null;
console.log(task.title); // nullにはtitleがないので例外
```

例外が捕捉されなければ、その関数の残りは実行されません。`try`と`catch`は、失敗し得る処理から
安全に回復するために使います。

```js
try {
  const data = JSON.parse(rawText);
  return data;
} catch (error) {
  console.error('JSONを読めませんでした', error);
  return [];
}
```

処理の順番は次の通りです。

1. `try`内の`JSON.parse()`を実行する
2. 成功すれば解析結果をreturnする
3. 失敗して例外が発生したら、残りの`try`を飛ばして`catch`へ移る
4. エラーを記録し、安全な空配列を返す

`catch`を空にすると画面停止は防げますが、原因を知る手掛かりも失います。「想定内の失敗だから
既定値へ戻す」のか、「本来起きない不具合を隠している」のかを区別する必要があります。

## 第8部: 非同期関数の最初の理解

サーバー通信は、結果が返るまで時間がかかります。その間にブラウザー全体を止めると、ボタンも
スクロールも動かなくなります。そこでJavaScriptは、結果を待つ関数の続きだけを一時停止します。

```js
async function loadAnswer() {
  const response = await fetch('/api/answer');
  const data = await response.json();
  return data;
}
```

- `async`: この関数は時間のかかる非同期処理を含み、Promiseを返す
- 最初の`await`: HTTP応答が来るまで、この関数の続きだけ待つ
- 二つ目の`await`: 応答本文を読み終えるまで待つ
- `return data`: Promiseを成功させ、その結果としてdataを返す

待っている間も別の操作はできます。そのため、AI生成中に画面を移動したり、同じ保存を二回押したり
できます。非同期処理の不具合は「待つこと」そのものより、待っている間に状態が変わることで起きます。

呼び出し側も結果を待つ必要があります。

```js
const answer = await loadAnswer();
renderAnswer(answer);
```

`await`を書かなければ、`answer`へ入るのは完成した回答ではなく、将来の結果を表すPromiseです。

## 第9部: My Plannerの実コードを一行ずつ読む

`js/storage.js`には、localStorageからデータを読む次の関数があります。

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

この関数を、知識を省略せずに読みます。

### 1. 関数の入口

```js
function load(key, fallback) {
```

`load`という関数を定義しています。呼び出し側は二つの値を渡します。

- `key`: localStorage内でデータを識別する名前
- `fallback`: データがない、または壊れている場合に返す安全な既定値

たとえば予定一覧なら、概念的には`load('events', [])`と呼びます。`events`データがなければ空配列`[]`を
返して、画面が初回起動でも動くようにします。

### 2. 失敗し得る範囲

```js
try {
```

この後のlocalStorage読取やJSON解析は失敗する可能性があるため、`try`で囲みます。失敗してもアプリ全体を
停止させず、後の`catch`で回復します。

### 3. 保存文字列を読む

```js
const raw = localStorage.getItem(key);
```

左からではなく、右側から考えます。

1. `localStorage`はブラウザー内の文字列保存領域
2. `.getItem`は指定した名前の値を読む関数
3. `(key)`で、今回探す名前をargumentとして渡す
4. 保存があれば文字列、なければ`null`が返る
5. その結果へ`raw`という名前を付ける

`raw`は「まだJSON文字列のまま」という意味の名前です。配列やオブジェクトとして使う前に解析が
必要です。

### 4. データの有無で返す値を変える

```js
return raw !== null ? JSON.parse(raw) : fallback;
```

短い一行ですが、三項演算子を使った条件分岐です。通常の`if`に直すと次の意味です。

```js
if (raw !== null) {
  return JSON.parse(raw);
} else {
  return fallback;
}
```

- `raw !== null`: 保存データが存在するか確認する
- `JSON.parse(raw)`: JSON文字列を配列やオブジェクトへ戻す
- `fallback`: 保存が一度もない場合の既定値

空文字と`null`は違います。空文字が保存されていれば`raw !== null`はtrueですが、空文字は正しいJSON
ではないため`JSON.parse()`が例外を発生させます。その場合は次の`catch`へ移ります。

### 5. 壊れたデータから回復する

```js
} catch {
  return fallback;
}
```

localStorageへ不正なJSONが入っていた場合でも、関数はfallbackを返します。呼び出し側は毎回
`try/catch`を書く必要がなく、最低限使える値を受け取れます。

### 6. この関数の役割をまとめる

`load()`の役割は「localStorageを読む」だけではありません。

- 保存名をargumentとして受け取る
- 保存されたJSON文字列をJavaScriptの値へ戻す
- 初回起動でデータがなくてもfallbackを返す
- 壊れたJSONがあっても画面全体を停止させない
- 呼び出し側へ、利用可能な値を必ず返す

このように、関数の役割は中で呼んでいるAPI名だけで判断しません。**入力をどう扱い、どの失敗を
吸収し、呼び出し側へ何を保証するか**まで含めて説明します。

## 第10部: 知らない関数を読むための手順

実際のコードで関数を見つけたら、次の順序で紙やメモへ書き出します。

### 関数定義から契約を読む

```js
function example(first, second = []) {
```

確認することは、関数名、parameter、既定値です。この時点で「何を受け取る想定か」を推測します。

### early returnを先に探す

```js
if (!first) return false;
```

どんな入力を拒否するか、失敗時に何を返すかが分かります。

### 外部から読む値を探す

parameter以外に、module上部の変数、localStorage、DOM、現在時刻などを読んでいないか確認します。
これらは同じargumentでも結果を変え得ます。

### 外部へ与える変更を探す

`textContent =`、`localStorage.setItem()`、`saveEvents()`、`fetch()`などを探します。これが副作用です。
戻り値だけ見ても関数の役割を説明できない場合があります。

### 最後にreturnを全部確認する

途中returnを含め、どんな条件でどの型を返すか確認します。成功時はオブジェクト、失敗時は`false`の
ように型が変わる関数では、呼び出し側の確認も必要です。

### 呼び出し側を一つ見る

関数定義だけで用途が分からない場合は、VS Codeで関数名を選んで`Shift+F12`を押し、使用箇所を一つ
見ます。実際に何をargumentとして渡し、戻り値をどう使うかを見ると契約が具体化します。

## 練習問題

次の関数を、入力、戻り値、副作用、途中終了の四点で説明してください。

```js
function completeTask(task) {
  if (!task || task.completed) return false;

  task.completed = true;
  task.completedAt = new Date().toISOString();
  saveTasks();
  return true;
}
```

### 解答

- 入力: 一件のtaskオブジェクト
- 途中終了: taskが存在しない場合、または既に完了済みの場合は`false`
- データ変更: 同じtaskオブジェクトの`completed`と`completedAt`を直接変更する
- 副作用: `saveTasks()`を呼び、変更後のタスク一覧を保存する
- 成功時の戻り値: `true`

さらに重要なのは、taskをコピーせず直接変更している点です。呼び出し側も同じオブジェクトを参照して
いれば、保存前から完了状態が見えます。この動作が意図通りかを判断するには、呼び出し側と
`saveTasks()`の中身も確認します。

## 次に読む章

この章で短い関数の流れを追えるようになったら、次の順で進みます。

1. [`javascript-basics.md`](javascript-basics.md): 配列メソッド、コピー、module、非同期処理を広げる
2. [`javascript-browser-apis.md`](javascript-browser-apis.md): DOM、event、通信、画像を理解する
3. [`first-walkthrough.md`](first-walkthrough.md): My Plannerの起動から画面表示まで実コードを追う

分からない文法をすべて覚えてから実コードへ進む必要はありません。`load()`のような短い関数を一つ
選び、この章と行き来しながら「入力、分岐、戻り値、副作用」を説明できるようにする方が身に付きます。
