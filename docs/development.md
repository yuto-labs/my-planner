# 開発・検証・公開手順

## 実行環境

検証基準はNode.js 24とnpmです。フロントエンドにバンドラーはなく、ブラウザが
`index.html`からES Modulesを直接読み込みます。`npm run build`は配信用ファイルを
生成するコマンドではなく、公開前の検査です。`dist/`がないのはこの構成によります。

```sh
npm ci
npm run build
npm test
```

`npm ci`は`package-lock.json`に記録された依存関係を使います。
テストは外部通信をモックしており、Geminiのキーや本番アカウントは不要です。
ただし、実際のAI品質・認証・端末間同期・タッチ操作を保証するものではありません。

## 画面だけをローカルで確認する

```sh
npx serve .
```

表示されたlocalhostのURLを開きます。Windows用の`start.bat`も用意しています。
静的サーバーでは`/api/ai/*`は実行されないため、AI機能の確認には次の手順が必要です。
通常使っているブラウザの保存データを使わないよう、検証専用プロファイルを推奨します。

## AIと同期も含めて確認する

1. 検証用のSupabaseプロジェクトを用意し、[SQLの説明](../supabase/README.md)を確認します。
2. ルートの`.env.example`を`.env.local`へ複製し、検証用の値を設定します。
3. `js/supabase.js`の接続先も同じ検証用プロジェクトに合わせます。
4. `npx vercel dev`を実行し、表示されたURLで検証用アカウントにログインします。

ブラウザ側は`.env.local`を直接読みません。`js/supabase.js`の`DEFAULT_CONFIG`、
または端末に保存した`mp_supabase_config`を読みます。サーバー側だけ接続先を変えると、
ブラウザが発行する認証トークンとAPIの接続先が一致しなくなります。
既定値は運用中のプロジェクトを指すので、別環境では両方を確認してください。

| 設定 | 役割 |
| --- | --- |
| `GEMINI_API_KEY` | サーバーだけが使う秘密のAPIキー |
| `SUPABASE_URL` | APIの接続先 |
| `SUPABASE_ANON_KEY` | 公開クライアント用キー。ユーザー認証とRLSを併用 |
| `GEMINI_MODEL_FAST` / `GEMINI_MODEL_QUALITY` | 任意のモデル上書き |
| `GEMINI_FALLBACK_MODEL` | 任意の代替モデル上書き |
| `GEMINI_ENABLE_SEARCH_GROUNDING` | 検索参照の設定。詳細は生成APIの実装を確認 |

Service Role Keyをブラウザへ入れてはいけません。`.env.local`はGit管理対象外です。
Vercel上ではローカルファイルではなく、プロジェクトの環境変数として設定します。

## 変更前後の確認

- 保存キー・DB列・URLは、ファイル名を整理するだけの目的では変更しません。
- JSを移動したらimport、動的import、テスト、資料、`sw.js`を合わせて更新します。
- ブラウザへ配信するファイルを変えたら`sw.js`の`CACHE_VER`を進めます。
- メモ編集、カレンダーの日付選択、タスク、Knowledge、表現帳を検証用データで確認します。
- 本番DBの削除・初期化や、ブラウザの全保存データの消去をテスト手順にしません。

`npm run modules:check`は、ブラウザコードを実行せずにimport/exportと事前キャッシュ一覧を
照合します。NodeのVM Modulesを使うためExperimentalWarningが出ますが、アプリが実行時に
この機能を使うわけではありません。計算で組み立てる動的importや画面操作は検査対象外です。

GitHub ActionsでもWindowsとLinuxで同じ検査・テストを実行します。
CIは本番データやAPIキーを使わず、デプロイも行いません。

## 本番公開

```sh
npm run build
npm test
git diff --check
git status --short
```

変更内容と検査結果を確認して対象ファイルをコミット・pushした後、
リンク先が正しいVercelプロジェクトであることを確認して公開します。

```sh
npx vercel --prod --yes
```

この操作は実際の公開です。出力の`Aliased`に意図した公開URLが出ているか確認し、
本番の再読み込み後に主要画面とキャッシュ更新を確認します。通常の公開にSQL実行は不要です。
DB変更を伴う場合は別途レビューとバックアップが必要です。
