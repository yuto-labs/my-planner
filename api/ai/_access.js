// AIを使ってよいアカウントを、サーバー側で一か所だけで判定する。
// ファイル名を_から始めると、Vercelはこれを公開APIとして扱わない(他のAPIから読み込む部品になる)。
//
// 許可するアカウントはVercelの環境変数 AI_ALLOWED_USERS に、メールアドレスかユーザーIDを
// カンマ区切りで書く。ソースに書かないのは、公開リポジトリにメールアドレスを残さないため。
// 設定が無い場合は全員を拒否する。設定漏れで誰でもGeminiキーを使える状態にしないため。

/** 環境変数から許可リストを読み、比較しやすいよう小文字の集合にする。 */
function allowedUsers() {
  return new Set(String(process.env.AI_ALLOWED_USERS || '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean));
}

/**
 * Supabaseで確認済みのユーザーがAIを使えるか確かめ、使えなければ403のエラーを投げる。
 * ログイン確認(401)の後に呼ぶ。新規登録は共有カレンダーの招待で必要なので閉じず、
 * AIだけをここで本人に限定する。
 */
export function assertAiAllowed(user) {
  const allowed = allowedUsers();
  const email = String(user?.email || '').trim().toLowerCase();
  const id = String(user?.id || '').trim().toLowerCase();
  if ((email && allowed.has(email)) || (id && allowed.has(id))) return;
  throw Object.assign(new Error('このアカウントではAI機能を利用できません。'), { status: 403 });
}
