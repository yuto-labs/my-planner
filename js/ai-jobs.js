// 長時間AIジョブの送信・監視を担当するブラウザー側の通信層。
// 画面を閉じてもジョブ本体はSupabaseに残り、次回起動時に再取得できる。

import { getSession } from './supabase.js';
import { extractAIErrorMessage, getFriendlyAIJobError } from './ai-response.js';

const JOB_API = '/api/ai/jobs';
const POLL_INTERVAL_MS = 2500;
const ACTIVE_WAIT_LIMIT_MS = 295_000;
const FOREGROUND_SAVE_GRACE_MS = 30_000;
const foregroundJobs = new Set();

/** 元画面がまだ完成結果を保存する権利を持つジョブか確認する。 */
export function isAIJobOwnedByForeground(id) {
  return foregroundJobs.has(id);
}

/** ジョブ状態を画面共通の進捗表示へ通知する。Nodeテストでは何もしない。 */
export function emitAIJobStatus(job, phase = '') {
  if (!job || typeof document === 'undefined' || typeof CustomEvent === 'undefined') return;
  document.dispatchEvent(new CustomEvent('ai:job-status', { detail: { job, phase } }));
}

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
  if (!response.ok) {
    throw new Error(extractAIErrorMessage(
      payload?.error ?? payload,
      `AIジョブを処理できませんでした (${response.status})`,
    ));
  }
  return payload;
}

/** 新しいジョブを登録する。同じIDなら失敗・停止ジョブの安全な再開になる。 */
export async function submitAIJob({ id, request, clientContext }, { signal } = {}) {
  const payload = await jobRequest('', {
    method: 'POST',
    body: JSON.stringify({ id, request, clientContext }),
  });
  if (!signal?.aborted) emitAIJobStatus(payload.job, 'submitted');
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
  foregroundJobs.delete(id);
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
    emitAIJobStatus(job, 'polled');
    if (job?.status === 'completed') return job;
    if (job?.status === 'failed') {
      throw new Error(getFriendlyAIJobError(job.error));
    }
    await delay(POLL_INTERVAL_MS, signal);
  }
  throw new DOMException(
    '画面での待機を終了しました。生成はバックグラウンドで続きます。',
    'AbortError',
  );
}

/** 画面を離れた後の完成回答を、現在画面を変えず共通の保存処理へ渡す。 */
function notifyAIJobReady(id) {
  if (typeof document === 'undefined' || typeof CustomEvent === 'undefined') return;
  document.dispatchEvent(new CustomEvent('ai:job-ready', { detail: { id } }));
}

/** 画面を離れたらPOSTの応答待ちだけを止める。サーバー側の生成は継続する。 */
function waitForSubmission(start, signal) {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('画面での待機を閉じました。生成はバックグラウンドで続きます。', 'AbortError'));
  }
  const promise = start();
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    /** 画面の待機だけを解除し、実行中の送信Promiseはそのまま完了させる。 */
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(new DOMException('画面での待機を閉じました。生成はバックグラウンドで続きます。', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    promise.then(
      value => { signal.removeEventListener('abort', onAbort); resolve(value); },
      error => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

/** 長時間生成を登録し、現在画面が開いている間は完成まで待って本文を返す。 */
export async function runAIJob(request, clientContext, { signal, jobState } = {}) {
  const id = createAIJobId();
  foregroundJobs.add(id);
  if (jobState) jobState.id = id;
  const submitting = {
    id,
    actionType: request?.actionType,
    status: 'submitting',
    clientContext,
    createdAt: new Date().toISOString(),
  };
  emitAIJobStatus(submitting, 'submitting');
  if (signal?.aborted) {
    foregroundJobs.delete(id);
    throw new DOMException('画面での待機を閉じました。', 'AbortError');
  }
  let submitted;
  try {
    submitted = await waitForSubmission(() => submitAIJob({ id, request, clientContext }, { signal }), signal);
  } catch (error) {
    if (error?.name === 'AbortError') {
      foregroundJobs.delete(id);
      throw error;
    }
    // POSTはサーバーへ届いた後、応答だけが回線切断で失われることがある。
    // 同じIDを確認せず失敗表示にすると、裏では生成中なのに利用者へ誤報する。
    try {
      submitted = await getAIJob(id);
      if (!submitted) throw error;
      emitAIJobStatus(submitted, 'submit-recovered');
    } catch {
      foregroundJobs.delete(id);
      emitAIJobStatus({ ...submitting, status: 'failed', error: error?.message || 'AIジョブを登録できませんでした。' }, 'submit-failed');
      throw error;
    }
  }
  let completed;
  try {
    completed = submitted?.status === 'completed'
      ? submitted
      : await waitForAIJob(id, { signal });
  } catch (error) {
    // 画面の破棄で待機が中断されても、アプリ自体が開いているなら裏で完了を検知する。
    // 完成通知だけを発火し、保存は共通の復帰処理へ任せる。
    if (error?.name === 'AbortError') {
      foregroundJobs.delete(id);
      waitForAIJob(id)
        .then(() => notifyAIJobReady(id))
        .catch(() => {});
    } else {
      foregroundJobs.delete(id);
    }
    throw error;
  }
  if (!String(completed?.resultText || '').trim()) {
    foregroundJobs.delete(id);
    throw new Error('AIの完成結果を取得できませんでした。');
  }
  // POST応答と画面移動が重なると、完了済み本文が古い画面の処理へ戻る。
  // その場合は通常保存経路へ渡し、Calendar等から勝手に遷移させない。
  if (signal?.aborted) {
    foregroundJobs.delete(id);
    notifyAIJobReady(id);
    throw new DOMException('画面での待機を閉じました。生成はバックグラウンドで続きます。', 'AbortError');
  }
  emitAIJobStatus(completed, 'generated');
  // A caller normally saves and acknowledges promptly. If it crashes after
  // generation, let the shared status monitor reclaim the durable result.
  const graceTimer = setTimeout(() => foregroundJobs.delete(id), FOREGROUND_SAVE_GRACE_MS);
  graceTimer.unref?.();
  // 画面上で待っていた呼び出し元が、この返り値を通常の保存経路へ渡す。
  // ここでも復帰保存イベントを出すと同じ回答を二経路が同時保存し、片方が
  // 「保存できませんでした」と誤表示するため、復帰イベントはAbort時だけにする。
  return completed.resultText;
}
