# HTMLとCSSを最初から読む

## HTMLは入れ子の箱

HTMLは、開始タグと終了タグで内容を囲みます。

```html
<button id="save-button" class="btn btn-primary">保存</button>
```

- `button`: 要素の種類
- `id="save-button"`: 画面内で一つを指定する名前
- `class="btn btn-primary"`: 複数要素で共有できる見た目の名前
- `保存`: 利用者に見える内容
- `</button>`: buttonの終わり

`input`や`img`のように終了タグを持たない要素もあります。

## 親、子、兄弟

```html
<section class="card">
  <h2>今日の予定</h2>
  <button>追加</button>
</section>
```

`section`が親、`h2`と`button`が子です。`h2`と`button`は同じ親を持つ兄弟です。
CSSで位置を決めるとき、この関係が重要になります。

## My Plannerの固定HTMLと動的HTML

`index.html`には、ヘッダー、本文を入れる`main-content`、下部ナビなど、どの画面でも使う枠があります。
カレンダーやメモの中身はJavaScriptがあとから作ります。

```js
container.innerHTML = `<button id="add-button">追加</button>`;
```

この行は、`container`というHTML要素の中身を新しいHTML文字列へ置き換えます。
再描画すると古い子要素はなくなるため、イベントも再登録する必要があります。

## 属性とdata属性

```html
<button data-task-id="abc123">完了</button>
```

`data-`から始まる属性は、表示要素へIDなどの情報を持たせる方法です。

```js
const id = button.dataset.taskId;
```

HTMLの`data-task-id`はJavaScriptでは`dataset.taskId`になります。

## CSSの基本形

```css
.btn {
  padding: 8px 12px;
  color: #222;
  background: #fff;
}
```

`.btn`が対象を選ぶセレクタ、その中が適用する規則です。

- `padding`: 要素の内側の余白
- `margin`: 要素の外側の余白
- `color`: 文字色
- `background`: 背景
- `border`: 枠線
- `font-size`: 文字サイズ

## よく使うセレクタ

```css
#main-content { }       /* idがmain-content */
.task-item { }          /* classがtask-item */
.task-item button { }   /* task-itemの中にあるbutton */
.task-item.active { }   /* 二つのclassを同時に持つ */
button:hover { }        /* マウスが重なった状態 */
```

同じ要素へ複数の規則が当たると、より具体的なセレクタや、後に書かれた規則が優先されます。

## FlexboxとGrid

横並びや縦並びにはFlexboxを使います。

```css
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}
```

規則的な行と列にはGridを使います。

```css
.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
}
```

これは同じ幅の列を7本作る指定です。

## 画面幅への対応

```css
@media (min-width: 700px) and (min-height: 600px) {
  .app-shell { max-width: 1100px; }
}
```

条件を満たす画面でだけ中の規則を適用します。My Plannerではスマートフォンの既存表示を守るため、
タブレット・PC向け変更を`responsive.css`へ分離しています。

## CSS変数

```css
:root {
  --text: #222;
  --surface: #fff;
}

.card {
  color: var(--text);
  background: var(--surface);
}
```

色を変数にすると、テーマ変更時に一か所の値から全体へ反映できます。

## アクセシビリティ属性

- `aria-label`: アイコンだけのボタンを読み上げる名前
- `aria-expanded`: トグルが開いているか
- `role="button"`: 本来buttonでない要素の役割
- `tabindex="0"`: キーボードでも選択可能にする

見た目に影響しなくても、キーボード操作やスクリーンリーダーには必要です。

## CSSを調べる手順

1. Developer Toolsで対象要素を選ぶ
2. `class`名を確認する
3. VS Codeでそのclass名を検索する
4. `style.css`と`responsive.css`の両方を見る
5. 打ち消し線になった規則があれば、別の規則に上書きされている

最初から`style.css`を上から読む必要はありません。画面上の一要素から逆向きに探します。
