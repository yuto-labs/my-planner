# My Plannerを読むためのブラウザーAPI入門

この文書では、JavaScriptそのものではなく、JavaScriptからブラウザーへ依頼する処理を扱います。
画面を書き換えるDOM、タップや入力を受け取るイベント、サーバー通信、端末保存、画像処理などです。

My Plannerの不具合を調べるときは、文法を知るだけでは足りません。たとえば「ボタンを押しても
反応しない」という症状は、関数の計算が間違っている場合だけでなく、HTML要素を作り直した結果、
以前の要素に付けたイベントが失われた場合にも起きます。この章では、そのような仕組みと原因を
結び付けて読めることを目標にします。

## JavaScriptとブラウザーAPIの違い

配列、関数、`if`、`Promise`はJavaScriptという言語の機能です。一方、次の名前はブラウザーが
JavaScriptへ提供している機能です。

| 名前 | 役割 |
|---|---|
| `document` | 現在表示しているHTMLを探したり変更したりする |
| `window` | ブラウザー画面、URL、履歴などの大きな入口 |
| `fetch()` | サーバーへHTTPリクエストを送る |
| `localStorage` | 小さな文字列データを端末へ保存する |
| `File` / `Blob` | 画像などのバイナリーデータを扱う |
| `navigator` | 通信状態や端末機能などを参照する |

この区別が大切なのは、実行環境によって使える機能が違うからです。ブラウザーでは`document`を
使えますが、Vercel上のサーバー処理には表示中のHTMLがないため、通常は使えません。

## DOMとは何か

DOM（Document Object Model）は、HTMLをJavaScriptから操作できる「要素の木構造」にしたものです。

```html
<main id="app">
  <button class="save-button">保存</button>
</main>
```

ブラウザーはこれを、概念的には次の親子関係として保持します。

```text
document
└─ main#app
   └─ button.save-button
      └─ "保存"という文字
```

画面上のボタンは単なる文字列ではありません。位置、class、子要素、クリック処理などを持つ
`Element`オブジェクトです。JavaScriptはこのオブジェクトを探して変更します。

## 要素を探す

### `querySelector()`

CSSセレクターに一致する最初の要素を一つ返します。見つからない場合は`null`です。

```js
const saveButton = document.querySelector('.save-button');
saveButton?.addEventListener('click', saveMemo);
```

`?.`を使っているので、要素がない画面でも例外になりません。ただし、本来必ずあるべき要素が
見つからない場合まで黙ってしまう点には注意が必要です。開発中は、次のように明示的に失敗させると
原因を早く見つけられます。

```js
const saveButton = document.querySelector('.save-button');
if (!saveButton) throw new Error('保存ボタンが見つかりません');
```

### `querySelectorAll()`

一致する要素をすべて返します。返り値は配列に似た`NodeList`です。

```js
document.querySelectorAll('.memo-card').forEach((card) => {
  card.classList.remove('is-selected');
});
```

### 探す範囲を狭める

`document`から探すとページ全体が対象です。特定画面の入れ物から探すと、同じclass名が別画面に
存在しても取り違えにくくなります。

```js
const page = document.querySelector('#knowledge-page');
const titleInput = page?.querySelector('.memo-title');
```

## 要素を作る・内容を変更する

### `textContent`

文字として表示します。入力に`<strong>`が含まれていてもHTMLとして実行されません。

```js
title.textContent = memo.title;
```

ユーザー入力を表示するだけなら、基本的にこちらが安全です。

### `innerHTML`

文字列をHTMLとして解析し、子要素をまとめて作り直します。

```js
container.innerHTML = `<button class="save-button">保存</button>`;
```

画面を素早く組み立てられる反面、二つの重要な注意点があります。

1. ユーザー入力をそのまま入れると、意図しないHTMLやスクリプトが実行される危険がある
2. 代入前に存在した子要素は破棄され、その要素へ付けたイベントも失われる

二つ目はMy Plannerの画面不具合を読むうえで特に重要です。

```js
container.innerHTML = '<button id="save">保存</button>';
const firstButton = container.querySelector('#save');
firstButton.addEventListener('click', saveMemo);

container.innerHTML = '<button id="save">保存</button>';
// 見た目は同じでも、これは新しいbutton要素。
// firstButtonへ登録したイベントは新しいbuttonには付いていない。
```

再描画後にはイベントを付け直すか、後述するイベント委譲を使います。

### `createElement()`と`append()`

要素を一つずつ安全に作る方法です。

```js
const button = document.createElement('button');
button.type = 'button';
button.textContent = '保存';
button.addEventListener('click', saveMemo);
container.append(button);
```

長い画面では記述量が増えますが、要素と処理の対応が明確になります。

## イベントとは何か

イベントは「利用者やブラウザーが起こした出来事」です。クリック、入力、キー操作、画面回転、
通信状態の変化などがあります。

```js
button.addEventListener('click', (event) => {
  console.log('押されました', event);
});
```

ここで登録した関数は、登録した瞬間には実行されません。将来クリックされた時にブラウザーが
呼び出します。このような「後で呼ばれる関数」がコールバックです。

### `target`と`currentTarget`

ボタン内のアイコンを押した場合、二つは異なることがあります。

```html
<button class="delete-button"><span class="icon">×</span></button>
```

```js
button.addEventListener('click', (event) => {
  console.log(event.target);        // 実際に触れたspanかもしれない
  console.log(event.currentTarget); // 処理を登録したbutton
});
```

ボタン自身のデータを読みたいときは、通常`currentTarget`の方が安定します。

## イベントの伝播

子要素で発生したクリックは、親要素へ順番に伝わります。これをバブリングと呼びます。

```html
<div class="memo-card">
  <button class="delete-button">削除</button>
</div>
```

削除ボタンを押すと、ボタンの`click`だけでなく、親カードの`click`も発生し得ます。そのため
「削除を押したのに詳細画面も開いた」という不具合が起こります。

```js
deleteButton.addEventListener('click', (event) => {
  event.stopPropagation();
  deleteMemo();
});
```

`stopPropagation()`は親への伝播を止めます。一方、`preventDefault()`はリンク遷移やフォーム送信など、
ブラウザー標準の動作を止めます。役割は別です。

| 処理 | 止めるもの |
|---|---|
| `event.stopPropagation()` | 親要素へイベントが伝わること |
| `event.preventDefault()` | リンク遷移、送信などの既定動作 |

## イベント委譲

一覧を再描画するたびに各カードへイベントを付け直す代わりに、消えない親要素へ一つだけ処理を
登録する方法です。

```js
list.addEventListener('click', (event) => {
  const card = event.target.closest('.memo-card');
  if (!card || !list.contains(card)) return;

  openMemo(card.dataset.memoId);
});
```

`closest()`は、自分自身から親方向へセレクターに一致する要素を探します。アイコンや文章を押しても、
それらを含むカードを取得できます。

イベント委譲は動的な一覧に強い一方、次に注意します。

- 削除ボタンなど、カード全体とは別の操作を先に判定する
- `closest()`が一覧の外側の要素を返していないか確認する
- `click`と`pointerdown`を重複登録して同じ操作を二回実行しない

## `dataset`、class、属性

### `dataset`

HTMLの`data-*`属性は、要素とIDを結び付けるときに使います。

```html
<article class="memo-card" data-memo-id="memo-123"></article>
```

```js
const memoId = card.dataset.memoId; // "memo-123"
```

値は常に文字列です。数値が必要なら`Number()`で変換します。

### `classList`

見た目の状態をclassとして切り替えます。

```js
card.classList.add('is-selected');
card.classList.remove('is-loading');
card.classList.toggle('is-open', shouldOpen);
```

JavaScriptで色や寸法を直接指定するより、「状態をclassで表し、見た目はCSSへ任せる」と役割が
分かれて読みやすくなります。

### 属性

```js
button.setAttribute('aria-expanded', String(isOpen));
image.removeAttribute('hidden');
```

`aria-expanded`は支援技術へ開閉状態を伝えます。見た目だけ開閉しても、この値が古いままだと
スクリーンリーダーには正しく伝わりません。

## フォームと入力値

入力欄の現在値は`value`で読みます。

```js
const title = titleInput.value.trim();
```

`input`イベントは入力のたび、`change`は主に値を確定してフォーカスを外した時に発生します。

```js
titleInput.addEventListener('input', () => {
  draft.title = titleInput.value;
});
```

チェックボックスは`value`ではなく`checked`です。

```js
const shouldReview = reviewCheckbox.checked;
```

フォームの`submit`を使う場合、ページの再読み込みを防ぐことが多いです。

```js
form.addEventListener('submit', (event) => {
  event.preventDefault();
  saveMemo();
});
```

## フォーカスとスクロール

`focus()`は入力位置を移しますが、ブラウザーがその要素を見える位置までスクロールするため、
画面が突然動いたように見えることがあります。

```js
input.focus({ preventScroll: true });
```

再描画のたびに`focus()`したり、保存後に先頭要素へフォーカスしたりすると、閲覧中の位置が
勝手に戻る原因になります。フォーカスは「利用者が入力を始める明確な場面」だけで変更します。

## タイマーと画面更新

### `setTimeout()`

指定時間後に一度実行します。

```js
const timerId = setTimeout(() => {
  toast.remove();
}, 4000);
```

画面を離れた後もタイマーが残ると、古い画面を書き換えたり、新しい状態を古い状態で上書きしたり
します。不要になったら解除します。

```js
clearTimeout(timerId);
```

### `setInterval()`

一定間隔で繰り返します。解除し忘れると、画面を開くたびに処理が増えます。

```js
const intervalId = setInterval(refreshClock, 60_000);
clearInterval(intervalId);
```

### `requestAnimationFrame()`

次の画面描画に合わせて処理します。アニメーションや、DOM更新後の寸法計測に向いています。

```js
requestAnimationFrame(() => {
  panel.classList.add('is-visible');
});
```

タイマーと違い「約16ms後」を保証するものではありません。タブが背面にあると頻度が下がります。

## `fetch()`とHTTP通信

```js
const response = await fetch('/api/ai/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt }),
});
```

ここでは次の順序で処理が進みます。

1. JavaScriptのオブジェクトをJSON文字列へ変換する
2. ブラウザーがHTTPリクエストを送る
3. サーバーから応答ヘッダーが届く
4. `fetch()`のPromiseが`Response`を返す
5. `response.json()`で本文を読み、JavaScriptの値へ戻す

重要なのは、`fetch()`が完了してもHTTP処理が成功したとは限らないことです。404や500でも通常は
`Response`が返ります。

```js
if (!response.ok) {
  const message = await response.text();
  throw new Error(`AI request failed: ${response.status} ${message}`);
}

const data = await response.json();
```

通信失敗、HTTPエラー、JSON形式エラー、アプリ固有の検証エラーは別の段階です。すべてを
「AIが答えなかった」と一括りにすると原因を特定できません。

## 通信の中断とタイムアウト

`AbortController`を使うと、不要になった通信を中断できます。

```js
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 60_000);

try {
  const response = await fetch(url, { signal: controller.signal });
  return await response.json();
} finally {
  clearTimeout(timeoutId);
}
```

画面を移動しただけで生成を中断すべきか、背後で続けるべきかは機能要件です。AI生成のように
時間がかかる処理は、画面モジュールだけに状態を置くと、移動時に結果を受け取れなくなります。
アプリ全体で管理する処理と、画面を離れたら中断する処理を意識して分けます。

## `localStorage`

ブラウザーに文字列を保存する簡単な仕組みです。

```js
localStorage.setItem('theme', 'light');
const theme = localStorage.getItem('theme');
localStorage.removeItem('theme');
```

オブジェクトはそのまま保存できないためJSONへ変換します。

```js
localStorage.setItem('draft', JSON.stringify(draft));

const raw = localStorage.getItem('draft');
const restored = raw ? JSON.parse(raw) : null;
```

注意点は次の通りです。

- 保存できる容量には限りがある
- 同期APIではないため、大量データの読み書きは画面を止め得る
- 同じブラウザー・同じオリジン内の保存であり、端末間同期ではない
- 削除や壊れたJSONを考慮して既定値を用意する

My Plannerでは、ローカル保存とSupabase同期は別の層です。`localStorage`に存在することだけで
別端末にも保存済みとは判断できません。

## Cache StorageとService Worker

Service Workerは、ページとは別に動き、通信を横取りできるブラウザー機能です。PWAのオフライン表示や
静的ファイルのキャッシュに使います。

```js
self.addEventListener('fetch', (event) => {
  event.respondWith(caches.match(event.request));
});
```

古いJavaScriptが表示され続ける場合、原因がアプリのデータではなくService Workerのキャッシュである
ことがあります。一方、更新のたびに全キャッシュを消す設計では、弱い通信環境で使えません。

キャッシュ設計では次を分けます。

- `index.html`: 更新を早く検出したい入口
- JS/CSS: ファイル内容に応じて更新する静的資産
- ユーザー画像: 必要なものを端末内へ保持するが、容量管理が必要
- API応答: 古い回答を表示してよいか、機能ごとに判断する

## `File`、`Blob`、画像

`File`は名前や更新日時を持つファイル、`Blob`は画像などのバイト列を表します。

```js
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  console.log(file.name, file.type, file.size);
});
```

画像を表示する方法には主に三つあります。

| 方法 | 特徴 |
|---|---|
| Data URL | 文字列へ埋め込む。大きくなりやすい |
| Object URL | `Blob`を一時URLとして表示。高速だが解放が必要 |
| 通常のURL | Supabase Storageなどへ保存した画像を取得する |

Object URLの例です。

```js
const objectUrl = URL.createObjectURL(file);
image.src = objectUrl;

image.addEventListener('load', () => {
  URL.revokeObjectURL(objectUrl);
}, { once: true });
```

`revokeObjectURL()`を呼ばないと、画像を閉じてもメモリーが解放されにくくなります。反対に、画像が
読み終わる前に解放すると表示できません。

画像の「読み込み中」は保存データそのものではなくUI状態です。ブロック追加の再描画で一時URLや
読み込み状態を初期化すると、画像が消えたように見えることがあります。永続的な画像IDと一時的な
表示URLを分けて管理する必要があります。

## URL、ハッシュ、履歴

My Plannerは`#calendar`のようなハッシュで画面を表します。

```js
window.location.hash = '#calendar';
```

ハッシュが変わると`hashchange`イベントが発生します。

```js
window.addEventListener('hashchange', renderCurrentPage);
```

画面遷移のたびにこのイベントを重複登録すると、描画が複数回走ります。アプリ起動時に一度だけ
登録するか、破棄時に`removeEventListener()`します。

ブラウザーの戻る操作を正しく働かせるには、「画面を開く」と「履歴へ新しい状態を追加する」を
混同しないことも重要です。単なる再描画でURLまで変更すると、戻る履歴が大量に増えます。

## ページ状態に関するイベント

### `visibilitychange`

タブが前面・背面へ移ったときに発生します。

```js
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshIfNeeded();
});
```

復帰のたびにサーバーデータを無条件で上書きすると、編集中のローカル内容を失う危険があります。
「新しい版だけ取り込む」「未保存編集中なら保留する」などの競合ルールが必要です。

### `online`と`offline`

```js
window.addEventListener('online', retryPendingSync);
window.addEventListener('offline', showOfflineState);
```

`navigator.onLine === true`でも、特定サーバーへ到達できる保証はありません。接続の目安であり、
最終的には実際のリクエスト結果で判断します。

### `storage`

同じオリジンを開く別タブで`localStorage`が変更されたときに発生します。変更を行った当のタブでは
通常発生しません。

## 後始末が必要な処理

画面モジュールでは、「作る処理」と「片付ける処理」を対で考えます。

| 作ったもの | 後始末 |
|---|---|
| `addEventListener()` | 必要なら`removeEventListener()` |
| `setTimeout()` | `clearTimeout()` |
| `setInterval()` | `clearInterval()` |
| `URL.createObjectURL()` | `URL.revokeObjectURL()` |
| `fetch()` | 不要時に`AbortController.abort()` |
| 音声再生 | 画面移動時に停止・参照解放 |

後始末がないと、古い画面の処理が新しい画面へ干渉したり、同じ操作が複数回実行されたり、長時間の
使用でメモリー消費が増えたりします。

## 実例: 画像をタップして拡大表示する流れ

画像ビューアーを例に、値とイベントの流れを追います。

```js
function openImageViewer(imageUrl, altText = '') {
  const viewer = document.querySelector('#image-viewer');
  const image = viewer?.querySelector('img');
  if (!viewer || !image) return;

  image.src = imageUrl;
  image.alt = altText;
  viewer.hidden = false;
  viewer.classList.add('is-open');
}
```

読む順番は次の通りです。

1. 引数`imageUrl`へ何が渡るか確認する
2. ビューアーと画像要素が実際に存在するか確認する
3. `src`設定後にCSSで非表示のままになっていないか確認する
4. サムネイルのクリックが親カードの操作に奪われていないか確認する
5. 再描画後もクリック処理が有効か確認する
6. 閉じる際に`src`や一時URLを適切に片付ける

「関数が呼ばれた」だけでは表示成功とは限りません。DOM、CSS、イベント、URLの四層を順番に
確認すると、闇雲に修正せずに済みます。

## DevToolsで確認する場所

ブラウザーの開発者ツールは、推測ではなく実際の状態を確かめるために使います。

| 画面 | 確認できること |
|---|---|
| Elements | 現在のHTML、class、CSS、要素サイズ |
| Console | 例外、`console.log()`、警告 |
| Network | APIのURL、時間、状態コード、応答内容 |
| Application | localStorage、Cache、Service Worker |
| Sources | 実行中コード、ブレークポイント、変数 |

症状別の最初の確認場所は次の通りです。

- ボタンが反応しない: Elementsで要素、Consoleで例外、イベント登録箇所
- AIが終わらない: Networkでリクエストが待機中か、失敗か、応答済みか
- 保存した内容が戻る: Applicationのローカル値、Networkの同期、更新日時
- 画像が見えない: Elementsの`src`、Networkの画像応答、CSSの`display`や`z-index`
- 本番だけ古い: ApplicationのService WorkerとCache

## ブラウザー処理を読む手順

実際のコードでは、次の順番で追います。

1. 操作対象のHTML要素をclass名やIDで検索する
2. その要素を作る描画関数を探す
3. `addEventListener()`またはイベント委譲を探す
4. コールバックから呼ばれる関数を追う
5. どの状態を変更し、どこへ保存するか確認する
6. 保存後に再描画や同期が走るか確認する
7. 画面を離れた時の後始末を確認する

この流れを一度に全部理解する必要はありません。「クリックから保存まで」「画像取得から表示まで」
のように一つの経路へ絞ると、長いファイルでも目的を見失いにくくなります。
