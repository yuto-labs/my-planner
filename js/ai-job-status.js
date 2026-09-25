// AIジョブの実行状況を、どの画面からでも確認できる小さな共通表示へまとめる。
// 生成完了と保存完了を分け、サーバー回答は得たが端末へ未保存の状態も隠さない。

import { acknowledgeAIJob, listAIJobs } from './ai-jobs.js';
import { getFriendlyAIJobError } from './ai-response.js';

const ACTIVE_POLL_MS = 3000;
const IDLE_POLL_MS = 30000;
const SUCCESS_VISIBLE_MS = 12000;
const FAILURE_VISIBLE_MS = 9000;
const NOTICE_STORAGE_KEY = 'mp_ai_job_notices_v1';
const NOTICE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const NOTICE_LIMIT = 80;

let host = null;
let jobs = new Map();
let terminal = null;
let pollTimer = null;
let elapsedTimer = null;
let refreshPromise = null;

const LABELS = {
  knowledge_answer: 'Knowledgeの回答',
  nuance_generate: '表現帳の解説',
  translation_variants: '英訳',
  english_question: '英語の疑問',
};

/** 保存済み通知履歴を期限・件数で絞り、壊れた値を安全に捨てる。 */
export function normalizeAIJobNoticeHistory(history, now = Date.now()) {
  return Object.fromEntries(Object.entries(history && typeof history === 'object' ? history : {})
    .map(([key, value]) => [String(key), Number(value)])
    .filter(([key, value]) => key && Number.isFinite(value) && now - value < NOTICE_RETENTION_MS)
    .sort((left, right) => right[1] - left[1])
    .slice(0, NOTICE_LIMIT));
}

/** 同じジョブ・同じ失敗段階を過去に通知済みか判定する。 */
export function hasShownAIJobNotice(history, jobId, stage = 'failed', now = Date.now()) {
  const key = `${String(jobId || '')}:${stage}`;
  return Boolean(jobId && normalizeAIJobNoticeHistory(history, now)[key]);
}

/** 通知済みキーを追加し、長期間使っても履歴が増え続けない形へ整える。 */
export function rememberAIJobNotice(history, jobId, stage = 'failed', now = Date.now()) {
  if (!jobId) return normalizeAIJobNoticeHistory(history, now);
  return normalizeAIJobNoticeHistory({ ...(history || {}), [`${jobId}:${stage}`]: now }, now);
}

/** localStorageから通知済み履歴を読み、利用できない環境では空として続行する。 */
function readNoticeHistory() {
  try {
    return normalizeAIJobNoticeHistory(JSON.parse(localStorage.getItem(NOTICE_STORAGE_KEY) || '{}'));
  } catch {
    return {};
  }
}

/** 同じ失敗を次回のポーリングや画面復帰で再表示しないよう端末へ記録する。 */
function markNoticeShown(jobId, stage) {
  const history = rememberAIJobNotice(readNoticeHistory(), jobId, stage);
  try { localStorage.setItem(NOTICE_STORAGE_KEY, JSON.stringify(history)); } catch {}
}

/** 未通知の失敗だけを一度表示し、回答ジョブそのものは再保存用に残す。 */
function showTerminalOnce({ jobId, stage, title, message }) {
  if (!jobId || hasShownAIJobNotice(readNoticeHistory(), jobId, stage)) return false;
  markNoticeShown(jobId, stage);
  terminal = {
    jobId,
    kind: 'error',
    title,
    message,
    expiresAt: Date.now() + FAILURE_VISIBLE_MS,
  };
  return true;
}

/**
 * 失敗を一度だけ表示してから内部ジョブを削除する。
 * 失敗ジョブをクラウドに残すと、再読込や別端末で同じ通知が復活するため、
 * 利用者のメモ等には触れずAIの作業記録だけを終了させる。
 */
function retireFailedJob(job) {
  if (!job?.id) return;
  showTerminalOnce({
    jobId: job.id,
    stage: 'generation-failed',
    title: `${aiJobLabel(job)}に失敗しました`,
    message: getFriendlyAIJobError(job.error, '通信状態を確認して、もう一度お試しください。'),
  });
  jobs.delete(job.id);
  acknowledgeAIJob(job.id).catch(() => {
    // 削除通信だけ失敗しても通知済み履歴が同じ端末での再表示を防ぐ。
    // 次回の一覧取得時にもう一度削除を試せるよう、ここでは通常データを変更しない。
  });
}

/** API由来の失敗文をHTMLとして解釈させず、そのまま文字として表示する。 */
function escapeStatusText(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

/** actionTypeを利用者向けの短い機能名へ変換する。 */
export function aiJobLabel(job = {}) {
  return LABELS[job.actionType] || 'AI回答';
}

/** 開始からの秒数を、1:08または1:02:03形式へ整える。 */
export function formatAIElapsed(startedAt, now = Date.now()) {
  const start = new Date(startedAt || 0).getTime();
  const total = Number.isFinite(start) && start > 0 ? Math.max(0, Math.floor((now - start) / 1000)) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** 取得済みジョブのうち、まだ生成が終わっていないものだけを返す。 */
function activeJobs() {
  return [...jobs.values()].filter(job => ['submitting', 'queued', 'running'].includes(job?.status));
}

/** 複数生成が同時に動く場合、代表表示に使う最も新しい一件を選ぶ。 */
function latestActiveJob() {
  return activeJobs().sort((a, b) => (
    new Date(b.startedAt || b.createdAt || 0) - new Date(a.startedAt || a.createdAt || 0)
  ))[0] || null;
}

/** 回答生成後、端末保存を確認している最中の最新ジョブを選ぶ。 */
function latestCompletedJob() {
  return [...jobs.values()]
    .filter(job => job?.status === 'completed')
    .sort((a, b) => new Date(b.completedAt || b.updatedAt || 0) - new Date(a.completedAt || a.updatedAt || 0))[0] || null;
}

/** 実行中・成功・失敗に対応する小さな状態アイコンを返す。 */
function iconFor(kind) {
  if (kind === 'success') return '<span class="ai-job-status__icon ai-job-status__icon--success" aria-hidden="true">&#10003;</span>';
  if (kind === 'error') return '<span class="ai-job-status__icon ai-job-status__icon--error" aria-hidden="true">!</span>';
  return '<span class="ai-job-status__spinner" aria-hidden="true"></span>';
}

/** 現在の実行件数または直近の保存結果を表示する。 */
function render() {
  if (!host) return;
  const active = latestActiveJob();
  const count = activeJobs().length;
  if (active) {
    const startedAt = active.startedAt || active.createdAt;
    const detail = active.status === 'submitting'
      ? 'サーバーへ登録中'
      : active.status === 'queued'
        ? 'サーバーへ登録済み・開始待ち'
        : 'バックグラウンドで実行中';
    host.className = 'ai-job-status ai-job-status--running';
    host.innerHTML = `${iconFor('running')}<span class="ai-job-status__copy"><strong>${aiJobLabel(active)}を作成中${count > 1 ? `（ほか${count - 1}件）` : ''}</strong><small>${detail} · <time data-ai-elapsed>${formatAIElapsed(startedAt)}</time></small></span>`;
    host.hidden = false;
    return;
  }
  const completed = latestCompletedJob();
  if (completed && !terminal) {
    host.className = 'ai-job-status ai-job-status--running';
    host.innerHTML = `${iconFor('running')}<span class="ai-job-status__copy"><strong>${aiJobLabel(completed)}を生成しました</strong><small>保存と同期を確認しています</small></span>`;
    host.hidden = false;
    return;
  }
  if (terminal && terminal.expiresAt > Date.now()) {
    host.className = `ai-job-status ai-job-status--${terminal.kind}`;
    host.innerHTML = `${iconFor(terminal.kind)}<span class="ai-job-status__copy"><strong>${escapeStatusText(terminal.title)}</strong><small>${escapeStatusText(terminal.message)}</small></span><button class="ai-job-status__close" type="button" aria-label="閉じる">&times;</button>`;
    host.hidden = false;
    host.querySelector('.ai-job-status__close')?.addEventListener('click', () => {
      terminal = null;
      render();
    }, { once: true });
    return;
  }
  host.hidden = true;
  host.innerHTML = '';
}

/** 実行中は短く、待機中は長い間隔で次の状態確認を予約する。 */
function schedulePoll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(() => {
    refreshAIJobStatus().finally(schedulePoll);
  }, activeJobs().length ? ACTIVE_POLL_MS : IDLE_POLL_MS);
}

/** Supabaseに残るジョブ一覧を読み、別画面・別起動で始まった処理も表示へ戻す。 */
export async function refreshAIJobStatus() {
  if (refreshPromise) return refreshPromise;
  // モバイルOSが裏でタイマーを止めても問題ない。復帰時に最新版を再取得する。
  if (document.hidden) return [];
  refreshPromise = listAIJobs()
    .then(items => {
      jobs = new Map(items.map(job => [job.id, job]));
      const failedJobs = [...jobs.values()].filter(job => job.status === 'failed');
      // 古い失敗が複数残っていても、最新の一件だけを表示して全件を終了扱いにする。
      const latestFailed = failedJobs.at(-1);
      failedJobs.forEach(job => {
        if (job === latestFailed) retireFailedJob(job);
        else {
          jobs.delete(job.id);
          acknowledgeAIJob(job.id).catch(() => {});
        }
      });
      render();
      return items;
    })
    .catch(() => [])
    .finally(() => { refreshPromise = null; });
  return refreshPromise;
}

/** アプリ外枠へ一度だけ監視を取り付ける。 */
export function initAIJobStatus() {
  host = document.getElementById('ai-job-status');
  if (!host || host.dataset.ready === 'true') return;
  host.dataset.ready = 'true';

  document.addEventListener('ai:job-status', event => {
    const job = event.detail?.job;
    if (!job?.id) return;
    jobs.set(job.id, job);
    if (job.status === 'failed') {
      retireFailedJob(job);
    }
    render();
    schedulePoll();
  });
  document.addEventListener('ai:job-applied', event => {
    const job = event.detail?.job || {};
    jobs.delete(job.id);
    terminal = {
      jobId: job.id,
      kind: 'success',
      title: `${aiJobLabel(job)}を保存しました`,
      message: `完了まで ${formatAIElapsed(job.startedAt || job.createdAt, new Date(job.completedAt || Date.now()).getTime())}`,
      expiresAt: Date.now() + SUCCESS_VISIBLE_MS,
    };
    render();
    schedulePoll();
  });
  document.addEventListener('ai:job-apply-failed', event => {
    const job = event.detail?.job || {};
    showTerminalOnce({
      jobId: job.id,
      stage: 'save-failed',
      title: `${aiJobLabel(job)}の保存を完了できませんでした`,
      message: String(event.detail?.error?.message || '回答はサーバーに保持されています。アプリを開き直すと再試行します。'),
    });
    render();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshAIJobStatus().finally(schedulePoll);
  });

  elapsedTimer = setInterval(render, 1000);
  refreshAIJobStatus().finally(schedulePoll);
}

/** テストや将来のアプリ破棄用。通常のSPA動作中は呼ばない。 */
export function destroyAIJobStatus() {
  clearTimeout(pollTimer);
  clearInterval(elapsedTimer);
  pollTimer = null;
  elapsedTimer = null;
}
