# Claudeにマイプランナーを読ませる(カスタムコネクタ)

ClaudeのアプリやClaude Codeから、自分の予定・今日の計画・タスク・メモ(データベースを含む)を
**読む**ためのつなぎ口です。書き換え・削除はできません。

## 仕組み

| 部品 | 役目 |
|---|---|
| `api/mcp.js` | Claudeがつながる入口(MCP)。通行証が無ければ401を返してログインを始めさせる |
| `api/_mcp-data.js` | 読み取りの道具(`get_overview` `list_events` `list_tasks` `search_memos` `get_memo`) |
| `api/oauth/*.js` + `api/_oauth.js` | 許可画面と、引換券・通行証の発行(OAuth) |
| `api/_supabase.js` | Supabaseの接続先と、service role keyでの読み込み |

- 許可画面はアプリと同じドメインなので、アプリのログイン状態をそのまま使います。
  許可できるのは `AI_ALLOWED_USERS` に入っているアカウントだけです。
- 通行証は署名付きの文字列で、サーバーには保存しません。`MCP_TOKEN_VERSION` を変えると発行済みのものが全部無効になります。
- service role keyはRLSを通り越すため、読み込みには必ず `user_id=eq.<本人>` を付けています。
- パスワードらしい名前の列(`looksSecret`)は、データベースの値としてAIに渡しません。

## 準備(最初の1回)

1. Supabaseのダッシュボード → Project Settings → API Keys で **service_role** の鍵をコピーする。
2. Vercelのプロジェクト → Settings → Environment Variables に
   `SUPABASE_SERVICE_ROLE_KEY` として貼り付け(Production)、もう一度デプロイする。
3. claude.ai → 設定 → コネクタ → 「カスタムコネクタを追加」で、URLに
   `https://my-planner-five-alpha.vercel.app/api/mcp` を入れる(OAuthの欄は空でよい)。
4. 「連携」を押すと許可画面が開く。同じブラウザでアプリにログインしていれば「許可する」を押すだけ。

接続を切りたい時は、claude.ai側でコネクタを外すか、Vercelで `MCP_TOKEN_VERSION` を別の値にします。
