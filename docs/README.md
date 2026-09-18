# My Planner コード読解ガイド

このディレクトリには、My Plannerを初めて読む人向けの資料を置いています。
JavaScriptやHTMLをまったく触ったことがない人を想定しています。
最初から巨大なファイルを読む必要はありません。資料で一つ理解したら、実際の画面と短いコードを
一つだけ対応させる、という順番で進めてください。

## おすすめの順番

1. [`start-here.md`](start-here.md) - 開発環境と最初の30分
2. [`html-css-basics.md`](html-css-basics.md) - 画面の骨組みと見た目
3. [`javascript-basics.md`](javascript-basics.md) - 動作を作る文法
4. [`first-walkthrough.md`](first-walkthrough.md) - 起動から画面表示まで実コードを追う
5. [`architecture.md`](architecture.md) - アプリ全体の設計
6. [`file-map.md`](file-map.md) - ファイルを探す地図
7. 小さい画面モジュール（`tagspage.js`、`archive.js`、`search.js`）
8. [`data-and-sync.md`](data-and-sync.md) - 端末保存と同期
9. [`database-basics.md`](database-basics.md) - SupabaseとSQL
10. [`ai-flow.md`](ai-flow.md) - AI回答の生成と保存
11. [`debugging-and-tests.md`](debugging-and-tests.md) - 不具合の調べ方
12. [`glossary.md`](glossary.md) - 分からない単語を引く場所
13. [`project-config.md`](project-config.md) - package、PWA、Vercel設定

## コード内コメントの読み方

- ファイル冒頭のコメント: そのファイルが何を担当するか
- `// ---- ... ----`: 処理を機能単位に分ける見出し
- `/** ... */`: 関数、引数、戻り値、副作用の説明（JSDoc）
- 処理途中のコメント: コードを見ただけでは分からない「なぜ」を説明

関数の定義にあるJSDocは、VS Codeで関数名にマウスを置いた時にも表示されます。

## VS Codeで迷子にならない操作

- `F12`: 関数の定義へ移動
- `Alt+F12`: 定義をその場に表示
- `Shift+F12`: 使用箇所を一覧表示
- `Ctrl+Shift+O`: 現在のファイルの関数一覧
- `Alt+Left`: 一つ前に見ていた場所へ戻る

大きな関数を上から全部読むより、画面で操作を一つ決めて、その操作に関わる関数を
`Shift+F12`で追う方が理解しやすくなります。

## 最初は読まなくてよいもの

- `node_modules`: 外部ライブラリ本体。このリポジトリには通常保存しません
- 長い組み込み教材データ: `js/data/etymology-core.js`など
- `supabase/migrations`: DB構造を変更するときに読む履歴
- `api/ai/generate.js`内の巨大なJSON Schema: AIの形式エラーを調べる段階で読む
- `css/style.css`の全行: 調べたい要素のclass名を検索して、その周辺だけ読む
