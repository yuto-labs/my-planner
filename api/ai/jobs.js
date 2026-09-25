// AIの長時間生成をブラウザーの寿命から切り離すジョブAPI。
// ジョブは既存のknowledge_memosへ内部レコードとして保存するため、
// 新しいDB表を要求せず、Supabaseの認証とRLSをそのまま利用できる。

import { waitUntil } from '@vercel/functions';

export const maxDuration = 300;

const DEFAULT_SUPABASE_URL = 'https://nhgbvlovptelaqcurobv.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5oZ2J2bG92cHRlbGFxY3Vyb2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwMTY2NzcsImV4cCI6MjA5NjU5MjY3N30.Vgsy9--B3d5FoxoHpvjC00OPPzE2WUwzP8GV2LE4-p4';
const JOB_TAG = '__ai_generation_job__';
const JOB_BLOCK_TYPE = 'ai-generation-job';
const BACKGROUND_ACTIONS = new Set([
  'knowledge_answer',
  'nuance_generate',
  'translation_variants',
  'english_question',
]);

/** 外部APIの入れ子エラーを利用者向け文字列へ直し、[object Object]の保存を防ぐ。 */
function errorMessage(value, fallback = 'AI生成に失敗しました。', depth = 0) {
  if (depth > 5 || value == null) return fallback;
  if (typeof value === 'string') {
    const text = value.trim();
    return text && text !== '[object Object]' ? text : fallback;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const messages = value.map(item => errorMessage(item, '', depth + 1)).filter(Boolean);
    return messages.join(' / ') || fallback;
  }
  if (typeof value !== 'object') return fallback;
  for (const key of ['message', 'error', 'detail', 'details', 'hint', 'reason', 'description']) {
    const message = errorMessage(value[key], '', depth + 1);
    if (message) return message;
  }
  return fallback;
}

/** BearerヘッダーからSupabaseアクセストークンだけを取り出す。 */
function bearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  return String(header).match(/^Bearer\s+(.+)$/i)?.[1] || '';
}

/** Vercelが文字列で渡す場合も含め、JSON bodyを一つのオブジェクトへそろえる。 */
function readBody(req) {
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  return req.body && typeof req.body === 'object' ? req.body : {};
}

/** サーバー環境変数またはアプリ既定値からSupabase REST接続先を返す。 */
function supabaseConfig() {
  return {
    url: process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY,
  };
}

/** ユーザーJWTでSupabase REST APIを呼び、RLSを保ったままジョブを操作する。 */
async function supabaseRequest(path, token, options = {}) {
  const cfg = supabaseConfig();
  return fetch(`${cfg.url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: cfg.anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
}

/** JWTをSupabase Authで検証し、ジョブ所有者となるユーザーIDを返す。 */
async function authenticate(token) {
  if (!token) throw Object.assign(new Error('AIを使うにはログインしてください。'), { status: 401 });
  const cfg = supabaseConfig();
  const response = await fetch(`${cfg.url}/auth/v1/user`, {
    headers: { apikey: cfg.anonKey, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw Object.assign(new Error('ログイン状態を確認できませんでした。'), { status: 401 });
  return response.json();
}

/** knowledge_memosの内部ブロックからジョブデータだけを取り出す。 */
function rowToJob(row) {
  const block = Array.isArray(row?.blocks)
    ? row.blocks.find(item => item?.type === JOB_BLOCK_TYPE)
    : null;
  if (!block?.data) return null;
  return {
    id: row.id,
    ...block.data,
    createdAt: row.created_at || block.data.createdAt,
    updatedAt: row.updated_at || block.data.updatedAt,
  };
}

/** ジョブデータを既存knowledge_memos表へ保存できる内部レコードに変換する。 */
function jobToRow(job, userId, previousRow = null) {
  const now = new Date().toISOString();
  const createdAt = previousRow?.created_at || job.createdAt || now;
  const data = { ...job, id: undefined, createdAt, updatedAt: now };
  delete data.id;
  return {
    id: job.id,
    user_id: userId,
    title: 'AI generation job',
    summary: job.status,
    blocks: [{ id: `${job.id}-data`, type: JOB_BLOCK_TYPE, data }],
    tags: [JOB_TAG],
    starred: false,
    url: '',
    created_at: createdAt,
    updated_at: now,
  };
}

/** ID指定で自分のジョブを一件読み、存在しなければnullを返す。 */
async function readJobRow(id, token) {
  const query = `knowledge_memos?id=eq.${encodeURIComponent(id)}&tags=cs.${encodeURIComponent(`{${JOB_TAG}}`)}&select=*`;
  const response = await supabaseRequest(query, token);
  if (!response.ok) throw new Error(`ジョブを読み込めませんでした (${response.status})`);
  const rows = await response.json();
  return rows[0] || null;
}

/** 所有者のジョブをUPSERTし、同じjobIdの再送を一件へまとめる。 */
async function writeJob(job, userId, token, previousRow = null) {
  const response = await supabaseRequest('knowledge_memos?on_conflict=id', token, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(jobToRow(job, userId, previousRow)),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`ジョブを保存できませんでした (${response.status}) ${detail.slice(0, 160)}`);
  }
  const rows = await response.json();
  return rows[0] || null;
}

/** 安全なVercelデプロイURLを作り、内部の既存生成APIだけを呼び出す。 */
export function generationApiUrl(req) {
  // VERCEL_URLはデプロイ固有URLで、Deployment Protectionの対象になることが
  // ある。利用者が到達した公開ホストを優先し、同じ認証済み要求を生成APIへ渡す。
  const host = String(req.headers.host || 'localhost').replace(/[^a-zA-Z0-9.:[\]-]/g, '');
  const protocol = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';
  return `${protocol}://${host}/api/ai/generate`;
}

/** Gemini生成を既存APIへ委譲し、結果または失敗をジョブへ必ず記録する。 */
async function runJob({ row, job, userId, token, generateUrl }) {
  const runStartedAt = Date.now();
  const running = {
    ...job,
    status: 'running',
    attempts: Number(job.attempts || 0) + 1,
    startedAt: new Date().toISOString(),
    error: '',
  };
  try {
    const runningRow = await writeJob(running, userId, token, row);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 270_000);
    let response;
    try {
      response = await fetch(generateUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-AI-Background-Job': job.id,
        },
        body: JSON.stringify(job.request),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !String(payload?.text || '').trim()) {
      throw new Error(errorMessage(payload?.error ?? payload, `AI生成に失敗しました (${response.status})`));
    }
    await writeJob({
      ...running,
      status: 'completed',
      request: null,
      resultText: String(payload.text),
      model: String(payload.model || ''),
      completedAt: new Date().toISOString(),
      error: '',
    }, userId, token, runningRow || row);
    console.info('[ai-job] generation completed', {
      id: job.id,
      actionType: job.actionType,
      model: String(payload.model || ''),
      resultChars: String(payload.text).length,
      durationMs: Date.now() - runStartedAt,
    });
  } catch (error) {
    console.error('[ai-job] generation failed', {
      id: job.id,
      actionType: job.actionType,
      message: errorMessage(error, 'AI生成に失敗しました。'),
    });
    try {
      await writeJob({
        ...running,
        status: 'failed',
        error: error?.name === 'AbortError'
          ? 'AI生成が時間内に完了しませんでした。再試行できます。'
          : errorMessage(error, 'AI生成に失敗しました。'),
        failedAt: new Date().toISOString(),
      }, userId, token, row);
    } catch (writeError) {
      console.error('[ai-job] failed to persist failure', writeError);
    }
  }
}

/** ジョブ一覧取得・作成再開・完了後削除を提供する。 */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const token = bearerToken(req);
  let user;
  try {
    user = await authenticate(token);
  } catch (error) {
    res.status(error?.status || 500).json({ error: error?.message || 'Authentication failed.' });
    return;
  }

  try {
    if (req.method === 'GET') {
      const id = String(req.query?.id || '').trim();
      if (id) {
        const row = await readJobRow(id, token);
        res.status(row ? 200 : 404).json({ job: rowToJob(row) });
        return;
      }
      const query = `knowledge_memos?tags=cs.${encodeURIComponent(`{${JOB_TAG}}`)}&select=*&order=updated_at.asc`;
      const response = await supabaseRequest(query, token);
      if (!response.ok) throw new Error(`ジョブ一覧を読み込めませんでした (${response.status})`);
      const rows = await response.json();
      res.status(200).json({ jobs: rows.map(rowToJob).filter(Boolean) });
      return;
    }

    if (req.method === 'DELETE') {
      const id = String(req.query?.id || '').trim();
      if (!id) {
        res.status(400).json({ error: 'job id is required' });
        return;
      }
      const response = await supabaseRequest(`knowledge_memos?id=eq.${encodeURIComponent(id)}`, token, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error(`ジョブを削除できませんでした (${response.status})`);
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const body = readBody(req);
    const id = String(body.id || '').trim();
    const request = body.request && typeof body.request === 'object' ? body.request : null;
    const actionType = String(request?.actionType || body.actionType || '').trim();
    if (!/^ai-job-[a-zA-Z0-9-]{12,80}$/.test(id)) {
      res.status(400).json({ error: 'Invalid job id.' });
      return;
    }
    if (!request || !BACKGROUND_ACTIONS.has(actionType)) {
      res.status(400).json({ error: 'This AI action cannot run as a background job.' });
      return;
    }
    const serializedSize = JSON.stringify(body).length;
    if (serializedSize > 900_000) {
      res.status(413).json({ error: 'AI job is too large to save safely.' });
      return;
    }

    const existingRow = await readJobRow(id, token);
    const existing = rowToJob(existingRow);
    if (existing?.status === 'completed') {
      res.status(200).json({ job: existing });
      return;
    }
    const recentlyRunning = existing?.status === 'running'
      && Date.now() - new Date(existing.updatedAt || 0).getTime() < 285_000;
    if (recentlyRunning) {
      res.status(202).json({ job: existing });
      return;
    }

    const job = {
      id,
      version: 1,
      actionType,
      status: 'queued',
      request,
      clientContext: body.clientContext && typeof body.clientContext === 'object'
        ? body.clientContext
        : {},
      attempts: Number(existing?.attempts || 0),
      resultText: '',
      error: '',
      createdAt: existing?.createdAt || new Date().toISOString(),
    };
    const row = await writeJob(job, user.id, token, existingRow);
    // 受付HTTPを生成完了まで開いたままにすると、モバイル回線やVercelの
    // 接続上限が先に切れ、サーバーでは成功していても画面が失敗と誤認する。
    // queued状態を永続化してから即座に202を返し、生成と結果保存だけを
    // Functionのバックグラウンド寿命へ預ける。生成先は公開Hostを使うため、
    // Deployment Protectionのデプロイ固有URLへ誤接続することもない。
    waitUntil(runJob({
      row,
      job,
      userId: user.id,
      token,
      generateUrl: generationApiUrl(req),
    }));
    res.status(202).json({ job: rowToJob(row) || job });
  } catch (error) {
    console.error('[ai-job] request failed', error);
    res.status(500).json({ error: error?.message || 'AI job request failed.' });
  }
}

export { BACKGROUND_ACTIONS, JOB_BLOCK_TYPE, JOB_TAG, errorMessage, rowToJob };
