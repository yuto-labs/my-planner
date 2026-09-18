# My Planner コード読解ガイド

このディレクトリには、My Plannerを初めて読む人向けの資料を置いています。
JavaScriptやHTMLの文法をすべて覚えてから読む必要はありません。分からない記法が出た時に
`javascript-basics.md`へ戻りながら、実際の画面とコードを対応させて読んでください。

## おすすめの順番

1. [`javascript-basics.md`](javascript-basics.md)
2. [`architecture.md`](architecture.md)
3. [`file-map.md`](file-map.md)
4. `index.html`
5. `js/app.js`
6. 小さい画面モジュール（`tagspage.js`、`archive.js`、`search.js`）
7. [`data-and-sync.md`](data-and-sync.md)
8. `js/storage.js`と`js/sync.js`
9. [`ai-flow.md`](ai-flow.md)
10. `js/ai.js`と`api/ai/generate.js`

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

