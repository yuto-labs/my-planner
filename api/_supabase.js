// サーバー側のAPIが共通で使う、Supabaseへの接続先とログイン確認。
// ファイル名が_で始まるので、Vercelはこれを公開APIにしない(他のAPIから読み込む部品)。
//
// anon keyは公開してよい鍵(ブラウザのアプリにも入っている)。
// service role keyはRLSを通り越して全員のデータを読めるため、環境変数からだけ読み、絶対にブラウザへ渡さない。

const DEFAULT_SUPABASE_URL = 'https://nhgbvlovptelaqcurobv.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5oZ2J2bG92cHRlbGFxY3Vyb2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwMTY2NzcsImV4cCI6MjA5NjU5MjY3N30.Vgsy9--B3d5FoxoHpvjC00OPPzE2WUwzP8GV2LE4-p4';

/** 環境変数があればそれを、なければアプリと同じ既定のSupabase接続先を返す。 */
export function supabaseConfig() {
  return {
    url: process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY,
  };
}

/** ブラウザから届いたログイン用トークンをSupabaseに確かめ、本人のユーザー情報を返す。 */
export async function fetchSupabaseUser(token) {
  if (!token) throw Object.assign(new Error('ログインしてください。'), { status: 401 });
  const cfg = supabaseConfig();
  const response = await fetch(`${cfg.url}/auth/v1/user`, {
    headers: { apikey: cfg.anonKey, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw Object.assign(new Error('ログイン状態を確認できませんでした。'), { status: 401 });
  return response.json();
}

/** service role keyを返す。未設定なら「サーバーの準備ができていない」エラーにする。 */
export function serviceRoleKey() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw Object.assign(new Error('SUPABASE_SERVICE_ROLE_KEY が設定されていません。'), { status: 503 });
  return key;
}

/**
 * service role keyで表を読む(読み取り専用)。RLSが効かないので、呼び出す側が必ず
 * user_id=eq.<本人> の条件を付ける。path は "events?select=..." のようなREST APIの形。
 */
export async function serviceSelect(path) {
  const key = serviceRoleKey();
  // 旧形式の鍵(eyJ…で始まるJWT)はAuthorizationにも入れる。新形式(sb_secret_…)はJWTではないので
  // Authorizationに入れると拒否される。apikeyだけで管理者として読める。
  const headers = { apikey: key, ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}) };
  const response = await fetch(`${supabaseConfig().url}/rest/v1/${path}`, { headers });
  if (!response.ok) {
    // Supabaseが返した理由(権限不足・鍵の形式違いなど)を添えて、原因を追えるようにする。鍵そのものは含まれない。
    const reason = (await response.text().catch(() => '')).slice(0, 300);
    throw Object.assign(new Error(`データを読めませんでした (${response.status}) ${reason}`), { status: 502 });
  }
  return response.json();
}
