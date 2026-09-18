# アプリ全体の構造

## 起動から画面表示まで

```text
index.html
  └─ js/app.js
       ├─ URLの #home や #calendar を読む
       ├─ 共通ヘッダー・下部ナビを管理する
       └─ 対応する js/modules/*.js の init関数を呼ぶ
```

`index.html`が読み込むJavaScriptの入口は`js/app.js`です。`app.js`の`MODULES`には、
URLの名前と各画面を初期化する関数の対応が登録されています。

## レイヤー

### 1. アプリの入口と共通UI

- `index.html`: ブラウザが最初に読む画面の枠
- `js/app.js`: 画面遷移、ヘッダー、下部ナビ、起動処理
- `css/style.css`: 基本の見た目
- `css/responsive.css`: タブレット・PC向けの上書き

### 2. 画面モジュール

`js/modules/`の各ファイルが、一つの画面または一つの機能領域を担当します。
画面モジュールは、保存層からデータを読み、HTMLを表示し、操作イベントを登録します。

### 3. ブラウザ内の保存とデータモデル

- `js/storage.js`: 予定、タスク、メモ、学習データなどの読み書き
- `js/atlas-model.js`: 表現帳データの正規化・統合
- `js/knowledge-model.js`: Knowledgeデータの正規化・関連付け
- `js/atlas-senses.js`: 同じ英単語の意味を重複させず統合する判定

### 4. クラウド同期

- `js/supabase.js`: Supabaseへの接続とログイン状態
- `js/sync.js`: ローカルとクラウドの差分統合
- `js/migrate.js`: 旧ローカルデータを初回だけクラウドへ移す

### 5. AI

- `js/ai.js`: ブラウザ側のAI依頼、待機表示、再試行、回答検証
- `api/ai/generate.js`: Geminiへ送るプロンプト、モデル選択、最終検証
- `api/ai/status.js`: AIサーバーが利用可能かを確認

ブラウザへGemini APIキーを渡さないため、必ずVercel上の`api/ai`を経由します。

### 6. 外部サービス

- Supabase: ログイン、クラウドデータ、画像
- Gemini API: AI回答の生成
- Vercel: Web配信と`api/`の実行
- Google Fonts / jsDelivr: フォントとKaTeX

コードは`my-planner`内にありますが、実データと秘密の環境変数は外部サービス側にあります。

## 画面モジュールの基本形

多くの画面は次の流れです。

```text
initXxx(container)
  ├─ 保存データを取得
  ├─ container.innerHTMLで画面を表示
  ├─ ボタンや入力欄へイベントを登録
  └─ 必要ならcleanup関数を返す
```

別画面へ移動すると`app.js`がcleanup関数を呼び、タイマーやイベント監視を解除します。

