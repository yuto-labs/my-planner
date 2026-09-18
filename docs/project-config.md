# 設定ファイルを読む

JSONファイルは仕様上コメントを書けないため、この文書で各項目を説明します。

## package.json

Node.jsがプロジェクト名と実行コマンドを読むファイルです。

```json
{
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/*.test.mjs"
  }
}
```

- `private`: npmへ誤って公開しない
- `type: module`: Node.jsでもimport/exportを使う
- `scripts`: `npm test`などの短いコマンドと実処理の対応

このアプリはブラウザ側をビルドツールで変換しないため、依存ライブラリ一覧が小さい構成です。

## manifest.json

ブラウザがMy PlannerをPWAとしてインストールするときの情報です。

- `name`: インストール画面などの正式名
- `short_name`: ホーム画面で使う短い名前
- `start_url`: アイコンから開く最初のURL
- `display: standalone`: ブラウザのアドレスバーを出さずアプリ風に開く
- `orientation: any`: タブレットの縦横両方を許可
- `theme_color`: OSが使うテーマ色
- `icons`: インストール用アイコン

## vercel.json

Vercelへの配信設定です。

- `outputDirectory: .`: リポジトリ直下を静的サイトとして配信
- `/sw.js`の`no-cache`: Service Worker本体だけは古い版を固定しない
- `X-Content-Type-Options`: 誤ったファイル形式として解釈されるのを防ぐ
- `X-Frame-Options`: 他サイトから不必要にiframe表示されるのを防ぐ

`api/`内のJavaScriptは静的ファイルではなく、Vercel Functionとして実行されます。

## sw.jsのCACHE_VER

Service Workerはアプリ本体をキャッシュします。JSやCSSを本番へ反映しても、古いキャッシュが残る場合が
あるため、配信内容を変更したら`CACHE_VER`を進めます。

ただし、説明コメントだけの変更ではブラウザ上の動作が変わらないため、必ずしも更新は必要ありません。

## .gitignore

GitHubへ含めないファイルを指定します。秘密鍵、ローカル設定、一時生成物などを対象にします。
GeminiのAPIキーやSupabaseのservice role keyは、Git管理せずVercel等の環境変数へ置きます。
