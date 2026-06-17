// ============================================================
// supabase.js — Supabase クライアント初期化 & 認証管理
//
// ⚠ SERVICE ROLE KEY はここに絶対に置かないでください。
//   anon key のみ使用 (RLS で行レベルセキュリティ保護)
// ============================================================

const CONFIG_KEY  = 'mp_supabase_config';   // { url, anonKey }
const MIGRATE_KEY = 'mp_supabase_migrated'; // 'true' when done
const ACTIVE_USER_KEY = 'mp_active_user_id';
const DEFAULT_CONFIG = {
  url: 'https://nhgbvlovptelaqcurobv.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5oZ2J2bG92cHRlbGFxY3Vyb2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwMTY2NzcsImV4cCI6MjA5NjU5MjY3N30.Vgsy9--B3d5FoxoHpvjC00OPPzE2WUwzP8GV2LE4-p4',
};

let _client = null;

// ---- Config ----

export function getStoredConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
    return saved?.url && saved?.anonKey ? saved : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(cfg) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  _client = null; // reset cached client
}

export function isMigrated() {
  return localStorage.getItem(MIGRATE_KEY) === 'true';
}

export function setMigrated() {
  localStorage.setItem(MIGRATE_KEY, 'true');
}

export async function isMigratedForCurrentUser() {
  const userId = await getUserId();
  if (!userId) return isMigrated();
  return localStorage.getItem(`${MIGRATE_KEY}:${userId}`) === 'true'
    || localStorage.getItem(MIGRATE_KEY) === 'true';
}

export async function setMigratedForCurrentUser() {
  const userId = await getUserId();
  if (userId) localStorage.setItem(`${MIGRATE_KEY}:${userId}`, 'true');
  localStorage.setItem(MIGRATE_KEY, 'true');
}

export function getActiveUserId() {
  return localStorage.getItem(ACTIVE_USER_KEY) || null;
}

export function setActiveUserId(userId) {
  if (userId) localStorage.setItem(ACTIVE_USER_KEY, userId);
  else localStorage.removeItem(ACTIVE_USER_KEY);
}

// ---- Client (lazy-loaded from CDN ESM) ----

export async function getClient() {
  if (_client) return _client;

  const cfg = getStoredConfig();
  if (!cfg?.url || !cfg?.anonKey) return null;

  let createClient;
  try {
    ({ createClient } = await import(
      'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'
    ));
  } catch (e) {
    console.error('[Supabase] SDK の読み込みに失敗:', e);
    return null;
  }

  _client = createClient(cfg.url, cfg.anonKey, {
    auth: {
      persistSession:   true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'implicit',
      storage:          localStorage,
      storageKey:       'mp_supabase_session',
    },
  });
  return _client;
}

// ---- Auth ----

export async function getSession() {
  const client = await getClient();
  if (!client) return null;
  const { data: { session } } = await client.auth.getSession();
  return session;
}

export async function handleAuthRedirect() {
  const client = await getClient();
  if (!client) return { handled: false, session: null };

  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const isAuthCallback = url.searchParams.get('auth') === 'callback';
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const accessToken = hashParams.get('access_token');
  const refreshToken = hashParams.get('refresh_token');

  let handled = false;
  let session = null;

  if (code) {
    const { data, error } = await client.auth.exchangeCodeForSession(code);
    if (error) throw error;
    session = data?.session ?? null;
    handled = true;
  } else if (accessToken && refreshToken) {
    const { data, error } = await client.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) throw error;
    session = data?.session ?? null;
    handled = true;
  } else if (isAuthCallback) {
    session = await getSession();
    handled = true;
  }

  if (handled) {
    const cleanUrl = `${window.location.origin}${window.location.pathname}#settings`;
    window.history.replaceState({}, document.title, cleanUrl);
  }

  return { handled, session };
}

export async function signInWithMagicLinkUrl(linkText) {
  const client = await getClient();
  if (!client) throw new Error('Supabase URL / Anon Key を設定してください');

  let url;
  try {
    url = new URL(String(linkText || '').trim());
  } catch {
    throw new Error('メールのSign inリンクをそのまま貼ってください');
  }

  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
  const accessToken = hashParams.get('access_token');
  const refreshToken = hashParams.get('refresh_token');
  if (accessToken && refreshToken) {
    const { data, error } = await client.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) throw error;
    return data?.session ?? null;
  }

  const code = url.searchParams.get('code');
  if (code) {
    const { data, error } = await client.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return data?.session ?? null;
  }

  const tokenHash = url.searchParams.get('token_hash') || url.searchParams.get('token');
  const rawType = url.searchParams.get('type') || 'magiclink';
  const type = rawType === 'email' ? 'magiclink' : rawType;
  if (tokenHash) {
    const { data, error } = await client.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    if (error) throw error;
    return data?.session ?? null;
  }

  throw new Error('リンク内にログイン用の token / code が見つかりません');
}

export async function getUserId() {
  const session = await getSession();
  return session?.user?.id ?? null;
}

export async function getUserEmail() {
  const session = await getSession();
  return session?.user?.email ?? null;
}

/**
 * メールアドレスにマジックリンクを送信してサインイン/サインアップ
 */
export async function signInWithEmail(email) {
  const client = await getClient();
  if (!client) throw new Error('Supabase URL / Anon Key を設定してください');

  const emailRedirectTo = `${window.location.origin}${window.location.pathname}`;
  const { error } = await client.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, emailRedirectTo },
  });
  if (error) throw error;
}

export async function verifyEmailOtp(email, token) {
  const client = await getClient();
  if (!client) throw new Error('Supabase URL / Anon Key を設定してください');
  const { data, error } = await client.auth.verifyOtp({
    email,
    token: String(token).trim(),
    type: 'email',
  });
  if (error) throw error;
  return data?.session ?? null;
}

export async function signOut() {
  const client = await getClient();
  if (client) await client.auth.signOut();
  _client = null;
  setActiveUserId(null);
}

// ---- Connection test ----

export async function testConnection() {
  const client = await getClient();
  if (!client) throw new Error('Supabase URL / Anon Key を設定してください');

  // auth.getSession() で URL が疎通しているかを確認
  const { error } = await client.auth.getSession();
  if (error) throw error;
  return true;
}
