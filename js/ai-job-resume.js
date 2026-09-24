// アプリを閉じている間に完成したAIジョブを、既存の保存形式へ取り込む。
// 各生成関数へ完成済み本文を戻すことで、通常生成と同じ検証・正規化を必ず通す。

import {
  addExpressionEntriesWithReport,
  addLearningEntry,
  addTranslationSet,
  getEnglishQuestions,
  getLearningEntries,
  updateEnglishQuestion,
} from './storage.js';
import {
  answerEnglishLearningQuestion,
  generateKnowledgeAnswer,
  generateNuanceEntries,
  generateTranslationVariants,
} from './ai.js';
import {
  acknowledgeAIJobAfterSync,
  listAIJobs,
  submitAIJob,
} from './ai-jobs.js';
import {
  findDuplicateKnowledgeEntries,
  normalizeKnowledgeAnswer,
  validateKnowledgeEntry,
} from './knowledge-model.js';

let resumePromise = null;

/** 完成済みKnowledge回答を通常保存時と同じ検証へ通し、固定IDで一度だけ保存する。 */
async function applyKnowledgeJob(job) {
  const context = job.clientContext || {};
  const raw = await generateKnowledgeAnswer(context.question, context.taxonomy, {
    completedText: job.resultText,
  });
  const entry = normalizeKnowledgeAnswer(raw, context.question);
  const validation = validateKnowledgeEntry(entry);
  if (!validation.valid) throw new Error(`Knowledge回答の検証に失敗しました (${validation.errors.join(', ')})`);
  // 通常画面で保存できた後にジョブ削除だけ失敗した場合、同じ質問を二重保存しない。
  if (findDuplicateKnowledgeEntries(getLearningEntries(), context.question).length) return 0;
  const saved = addLearningEntry({ ...entry, id: `ai-result-${job.id}` });
  if (!saved) throw new Error('Knowledge回答を端末へ保存できませんでした。');
  return 1;
}

/** 完成済み表現セットを既存の見出し語・sense統合へ渡し、重複保存を防ぐ。 */
async function applyNuanceJob(job) {
  const input = job.clientContext?.input || {};
  const entries = await generateNuanceEntries(input, { completedText: job.resultText });
  const deterministic = entries.map((entry, index) => ({
    ...entry,
    id: entry.id || `ai-result-${job.id}-${index}`,
  }));
  const report = addExpressionEntriesWithReport(deterministic);
  if (!report.entries.length) throw new Error('表現セットを端末へ保存できませんでした。');
  return report.entries.length;
}

/** 完成済み英訳を元の日本語文で重複判定し、同じ生成の再適用を一件へ保つ。 */
async function applyTranslationJob(job) {
  const input = job.clientContext?.input || {};
  const set = await generateTranslationVariants(input, { completedText: job.resultText });
  const saved = addTranslationSet({ ...set, id: set.id || `ai-result-${job.id}` });
  if (!saved) throw new Error('英訳を端末へ保存できませんでした。');
  return 1;
}

/** 完成した英語の疑問回答を、先に保存したpending質問へ書き戻す。 */
async function applyEnglishQuestionJob(job) {
  const context = job.clientContext || {};
  const question = getEnglishQuestions().find(item => item.id === context.questionId);
  if (!question) throw new Error('英語の疑問の保存先を確認できませんでした。');
  const answer = await answerEnglishLearningQuestion(context.question || question.questionJa, {
    completedText: job.resultText,
  });
  const saved = updateEnglishQuestion(question.id, {
    status: 'ready',
    answer,
    errorMessage: '',
  });
  if (!saved) throw new Error('英語の疑問回答を端末へ保存できませんでした。');
  return question.status === 'ready' ? 0 : 1;
}

/** ジョブ種別に合う既存保存処理を選び、未知の種別はデータを消さず保留する。 */
async function applyCompletedJob(job) {
  if (job.clientContext?.kind === 'knowledge') return applyKnowledgeJob(job);
  if (job.clientContext?.kind === 'nuance') return applyNuanceJob(job);
  if (job.clientContext?.kind === 'translation') return applyTranslationJob(job);
  if (job.clientContext?.kind === 'english-question') return applyEnglishQuestionJob(job);
  throw new Error('このAIジョブの保存先を確認できませんでした。');
}

/** 途中停止または一時失敗したジョブを、最大二回まで同じIDで再開する。 */
async function restartRecoverableJob(job) {
  const age = Date.now() - new Date(job.updatedAt || job.createdAt || 0).getTime();
  const stalled = ['queued', 'running'].includes(job.status) && age > 310_000;
  const retryableFailure = job.status === 'failed' && Number(job.attempts || 0) < 2;
  if ((!stalled && !retryableFailure) || !job.request) return false;
  await submitAIJob({
    id: job.id,
    request: job.request,
    clientContext: job.clientContext,
  });
  return true;
}

/** 全端末共通の未処理ジョブを確認し、完成分を保存してからジョブを削除する。 */
export async function resumeCompletedAIJobs({ quiet = false } = {}) {
  if (resumePromise) return resumePromise;
  resumePromise = (async () => {
    const jobs = await listAIJobs();
    let applied = 0;
    let restarted = 0;
    for (const job of jobs) {
      if (job.status === 'completed' && String(job.resultText || '').trim()) {
        try {
          applied += await applyCompletedJob(job);
          await acknowledgeAIJobAfterSync(job.id);
          document.dispatchEvent(new CustomEvent('ai:job-applied', { detail: { job } }));
        } catch (error) {
          console.warn('[ai-job] completed result could not be applied:', job.id, error);
          document.dispatchEvent(new CustomEvent('ai:job-apply-failed', { detail: { job, error } }));
        }
      } else {
        try {
          if (await restartRecoverableJob(job)) restarted++;
        } catch (error) {
          console.warn('[ai-job] restart failed:', job.id, error);
        }
      }
    }
    if (applied && !quiet) {
      window.AppNav?.showToast?.(`バックグラウンドで完成したAI回答を${applied}件保存しました`, 'success');
      window.AppNav?.refreshCurrentView?.({ preserveScroll: true });
    } else if (restarted && !quiet) {
      window.AppNav?.showToast?.('途中だったAI生成を再開しました', 'info');
    }
    return { applied, restarted };
  })().finally(() => { resumePromise = null; });
  return resumePromise;
}
