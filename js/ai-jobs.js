// 長時間AIジョブの送信・監視を担当するブラウザー側の通信層。
// 画面を閉じてもジョブ本体はSupabaseに残り、次回起動時に再取得できる。

import { getSession } from './supabase.js';

const JOB_API = '/api/ai/jobs';
const POLL_INTERVAL_MS = 2500;
const ACTIVE_WAIT_LIMIT_MS = 295_000;

/** API呼び出しに使う最新のSupabaseアクセストークンを取得する。 */
async function authToken() {
  const session = await getSession();
  const token = session?.access_token || '';
  if (!token) throw new Error('AIを使うには、AI設定でログインしてください。');
  return token;
}

/** 暗号学的UUIDがない古いブラウザーでも衝突しにくいジョブIDを作る。 */
export function createAIJobId() {
  const random = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return `ai-job-${random}`;
}

/** 認証付きでジョブAPIを呼び、エラー本文を利用者向け例外へ変換する。 */
async function jobRequest(path = '', options = {}) {
  const token = await authToken();
  const response = await fetch(`${JOB_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || `AIジョブを処理できませんでした (${response.status})`);
  return payload;
}

/** 新しいジョブを登録する。同じIDなら失敗・停止ジョブの安全な再開になる。 */
export async function submitAIJob({ id, request, clientContext }) {
  const payload = await jobRequest('', {
    method: 'POST',
    body: JSON.stringify({ id, request, clientContext }),
  });
  return payload.job;
}

/** 一件の最新状態を取得する。 */
export async function getAIJob(id) {
  const payload = await jobRequest(`?id=${encodeURIComponent(id)}`);
  return payload.job;
}

/** ログインユーザーに残っている未取り込みジョブを古い順に取得する。 */
export async function listAIJobs() {
  const payload = await jobRequest('');
  return Array.isArray(payload.jobs) ? payload.jobs : [];
}

/** 保存まで完了したジョブを削除し、巨大なプロンプトや回答を残し続けない。 */
export async function acknowledgeAIJob(id) {
  await jobRequest(`?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** 生成結果のクラウド同期を確認してからジョブを削除し、端末だけに回答が残る事故を防ぐ。 */
export async function acknowledgeAIJobAfterSync(id) {
  const { flushPendingSync } = await import('./sync.js');
  const result = await flushPendingSync();
  if (result.attempted > result.succeeded) {
    throw new Error('生成結果の同期が完了していないため、AIジョブを保持しました。');
  }
  await acknowledgeAIJob(id);
}

/** 指定時間だけ待機する。AbortSignalは監視だけを止め、サーバー生成は止めない。 */
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('AI処理の待機を閉じました。生成はバックグラウンドで続きます。', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('AI処理の待機を閉じました。生成はバックグラウンドで続きます。', 'AbortError'));
    }, { once: true });
  });
}

/** 完了まで状態を確認し、画面を離れた場合はジョブを残したまま待機だけ終了する。 */
export async function waitForAIJob(id, { signal } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < ACTIVE_WAIT_LIMIT_MS) {
    const job = await getAIJob(id);
    if (job?.status === 'completed') return job;
    if (job?.status === 'failed') throw new Error(job.error || 'AI生成に失敗しました。');
    await delay(POLL_INTERVAL_MS, signal);
  }
  throw new DOMException(
    '画面での待機を終了しました。生成はバックグラウンドで続きます。',
    'AbortError',
  );
}

/** 長時間生成を登録し、現在画面が開いている間は完成まで待って本文を返す。 */
export async function runAIJob(request, clientContext, { signal, jobState } = {}) {
  const id = createAIJobId();
  if (jobState) jobState.id = id;
  const submitted = await submitAIJob({ id, request, clientContext });
  let completed;
  try {
    completed = submitted?.status === 'completed'
      ? submitted
      : await waitForAIJob(id, { signal });
  } catch (error) {
    // 画面の破棄で待機が中断されても、アプリ自体が開いているなら裏で完了を検知する。
    // 完成通知だけを発火し、保存は共通の復帰処理へ任せる。
    if (error?.name === 'AbortError') {
      waitForAIJob(id)
        .then(() => document.dispatchEvent(new CustomEvent('ai:job-ready', { detail: { id } })))
        .catch(() => {});
    }
    throw error;
  }
  if (!String(completed?.resultText || '').trim()) {
    throw new Error('AIの完成結果を取得できませんでした。');
  }
  return completed.resultText;
}
