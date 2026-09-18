# 実コードで追う最初の画面表示

## 1. ブラウザがindex.htmlを読む

ブラウザは`index.html`を上から読みます。`<link>`でCSSやPWA情報を読み、`body`内に
ヘッダー、`main-content`、下部ナビを作ります。

最後に次の行でJavaScriptの入口を読みます。

```html
<script type="module" src="js/app.js"></script>
```

`type="module"`があるため、`app.js`は`import`を使って別ファイルを読み込めます。

## 2. app.jsのimportが先に解決される

`app.js`先頭の`import`は、「このファイルで後から使う関数を別ファイルから受け取る」という宣言です。

```js
import { initHome } from './modules/home.js';
```

この時点でホーム画面を表示するわけではありません。`initHome`という関数を使える状態にします。

## 3. MODULESがURLと画面を対応させる

`MODULES`は、URLの`#home`などと初期化関数の対応表です。

```js
const MODULES = {
  home: initHome,
  calendar: initCalendar,
};
```

`MODULES['home']`を読むと`initHome`関数が得られます。大きな`if`を何個も並べず、対応表から
画面を選べるようにしています。

## 4. initが一度だけ全体を準備する

`init()`はアプリ開始時の総合入口です。おおまかに次を行います。

```text
テーマを適用
共通ボタンを接続
同期を初期化
URLから最初の画面を決定
該当画面へnavigate
```

`async function init()`となっているのは、ログイン確認や同期など、完了まで待つ処理が含まれるためです。

## 5. navigateが画面を切り替える

`navigate(view)`は、現在画面のcleanupを呼んでから、新しい画面の初期化関数を呼びます。

```text
以前のタイマーやイベントを解除
URLのハッシュを更新
ヘッダーとナビの選択状態を更新
main-contentを新画面用に準備
`MODULES`から選んだ画面関数へ`container`を渡して呼ぶ
```

cleanupがないと、画面を往復するたびに同じクリック処理やタイマーが増えてしまいます。

## 6. 画面モジュールがHTMLを作る

たとえば`initHome(container)`は、保存データを取得し、`container.innerHTML`へホーム画面を入れます。
そのあとボタンを`querySelector`で探し、`addEventListener`で動作を登録します。

```js
const button = container.querySelector('#example-button');
button?.addEventListener('click', () => {
  // 押したときの処理
});
```

`?.`があるため、対象ボタンがない表示状態でもエラーになりません。

## 7. 保存はstorage.jsを通る

画面でタスクを追加すると、`tasks.js`から`addTask()`が呼ばれます。

```text
tasks.js: handleAdd
  -> storage.js: addTask
  -> storage.js: saveTasks
  -> localStorageへ保存
  -> sync.jsへ変更通知
  -> Supabaseへ送信
```

この一本道を守ることで、画面によって更新日時や同期の有無が変わる事故を防ぎます。

## 8. 次に自分で追う練習

次の順で、一つずつ検索してください。

1. `initTagsPage`
2. `render(container)`
3. `data-memo-id`などのdata属性
4. `window.AppNav.navigate`
5. 移動先の`init`関数

分からない記号が出たら`javascript-basics.md`、用語が分からなければ`glossary.md`へ戻ります。
