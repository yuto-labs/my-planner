# My PlannerのCSSを読む

## 二つのCSSファイル

- `css/style.css`: スマートフォンを基準にした全画面の基本デザイン
- `css/responsive.css`: タブレットとPCだけに適用する追加・上書き

スマートフォンの見た目を調べるときは`style.css`、PCだけ違う場合は両方を見ます。

## style.cssを最初から読まない

`style.css`は非常に長いため、上から順に読む教材ではありません。調べたい画面要素から逆向きに探します。

```text
ブラウザで対象を右クリック
  -> 検証
  -> Elementsでclass名を確認
  -> VS Codeでclass名を検索
  -> style.cssの該当箇所だけ読む
  -> responsive.cssにも同じclassがないか検索
```

たとえばメモカードなら`kn-memo-card`、カレンダーの日付セルなら`cal-day`のようなclassを探します。

## ファイル前半の共通基盤

`style.css`の前半には、全画面で共有する規則があります。

- `:root`: 色、余白、影、角丸などのCSS変数
- テーマ指定: ライト・ダーク・カスタム背景
- `html`, `body`: 画面全体、iOS入力ズーム対策
- `.app-header`: 上部ヘッダー
- `#main-content`: 画面モジュールが中身を入れる場所
- `.bottom-nav`: 下部ナビ
- `.btn`, `.input`, `.card`: 共通部品

共通classを変えると複数画面へ影響します。画面固有の修正なら、より固有の親classを付けて範囲を限定します。

```css
/* 全画面のbuttonへ影響するので範囲が広い */
.btn { min-height: 44px; }

/* メモ編集画面内だけなので範囲が限定される */
.kn-edit-page .btn { min-height: 36px; }
```

## 接頭辞で画面を見分ける

主なclass接頭辞は次の通りです。

- `home-`: ホーム
- `cal-`: カレンダー
- `task-`, `tasks-`: タスク
- `today-`: Today
- `kn-`: 通常メモ
- `atlas-`: 表現帳
- `learning-`: Knowledge
- `settings-`: 設定
- `analytics-`: 分析
- `modal-`: 共通モーダル
- `date-picker-`, `time-picker-`: 日付・時刻選択

## box model

要素の大きさは、content、padding、border、marginから成ります。

```text
margin
  border
    padding
      content
```

`box-sizing: border-box`では、指定したwidthの内側にpaddingとborderを含めます。このアプリの共通設定も
この考え方なので、`width: 100%`へpaddingを足して横にはみ出しにくくなります。

## positionとz-index

- `position: relative`: 子の位置基準になれる通常配置
- `position: absolute`: 基準要素の中で座標指定
- `position: fixed`: 画面に固定
- `position: sticky`: スクロール中、指定位置で留まる
- `z-index`: 重なり順。position等で重なりを作る要素に使う

モーダル、日付選択、画像ビューアは重なり順が重要です。数値だけを無闇に大きくせず、既存のモーダル階層を
確認します。

## overflowと画面崩れ

- `overflow: hidden`: はみ出した内容を隠す
- `overflow-x: auto`: 横方向だけ必要時にスクロール
- `min-width: 0`: Flex/Gridの子が内容幅を理由にはみ出すのを許さず縮める
- `max-width: 100%`: 画像等を親より大きくしない
- `overflow-wrap: anywhere`: 長いURLなどを途中で折り返す

画像貼り付けや長い英単語で画面幅が崩れる場合、この周辺を確認します。

## スマートフォン入力時の注意

iOS Safariは小さい文字の入力欄へフォーカスすると画面を自動拡大します。入力要素の文字サイズを十分確保し、
viewport設定と合わせて対応します。単に画面全体の拡大を禁止するだけでは、アクセシビリティを悪化させる場合が
あるため、入力欄側の寸法を先に確認します。

## 変更の確認幅

最低限、次を確認します。

- 小さいスマートフォン縦
- 大きいスマートフォン縦
- スマートフォン横
- iPad縦
- iPad横
- PC

文字、画像、ソフトウェアキーボード、モーダル表示時も確認対象です。
