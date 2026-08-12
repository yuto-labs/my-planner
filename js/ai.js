// ============================================================
// ai.js - AI client layer
// Same-origin server API (Gemini on Vercel)
// ============================================================

import {
  getAiCache, setAiCache, getAiRuntime, saveAiRuntime,
  getPendingAIQueue, removeFromPendingAIQueue,
  getKnowledgeMemoById, updateKnowledgeMemo,
} from './storage.js';
import { getActiveUserId, getSession } from './supabase.js';
import { parseJapaneseTimes, today } from './utils.js';
import {
  NUANCE_ATLAS_CATEGORIES,
  normalizeAtlasCategory,
  normalizeAtlasTopic,
  isValidAtlasTopic,
  expressionLookupKeys,
} from './atlas-model.js';
import { atlasSenseFromEntry, mergeAtlasSenseArrays } from './atlas-senses.js';

export { NUANCE_ATLAS_CATEGORIES };

const SERVER_STATUS_URL = '/api/ai/status';
const SERVER_GENERATE_URL = '/api/ai/generate';
// Long-form Atlas and Knowledge responses can legitimately take over a minute.
// Keep this just below the server function budget while preserving cancellation.
const AI_REQUEST_TIMEOUT_MS = 290_000;
const AUTH_SESSION_TIMEOUT_MS = 12_000;

const FAST_MODEL = 'fast';
const QUALITY_MODEL = 'quality';

export async function refreshAiRuntimeStatus({ force = false } = {}) {
  const current = getAiRuntime();
  const cacheDuration = current.configured ? 10 * 60 * 1000 : 30 * 1000;
  if (!force && current.checkedAt && (Date.now() - current.checkedAt) < cacheDuration) {
    return current;
  }

  try {
    const res = await fetch(SERVER_STATUS_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    const next = {
      provider: data.provider || 'gemini',
      mode: data.mode || 'server',
      configured: !!data.configured && data.available !== false,
      models: data.models || null,
      modelAvailability: data.modelAvailability || null,
      limits: null,
      usage: null,
      checkedAt: Date.now(),
      message: data.message || '',
    };
    saveAiRuntime(next);
    return next;
  } catch {
    const next = {
      provider: 'gemini',
      mode: 'server',
      configured: false,
      limits: null,
      checkedAt: Date.now(),
      message: 'server_unavailable',
    };
    saveAiRuntime(next);
    return next;
  }
}

async function callServerAI(
  modelPreference,
  systemText,
  userText,
  maxTokens,
  responseFormat = 'text',
  actionType = 'ai_request',
  { signal } = {}
) {
  const readSession = async () => {
    let timeoutId;
    try {
      return await Promise.race([
        getSession(),
        new Promise((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error('ログイン情報の確認に時間がかかりすぎました。通信状態を確認して、もう一度お試しください。')),
            AUTH_SESSION_TIMEOUT_MS
          );
        }),
      ]);
    } finally {
      clearTimeout(timeoutId);
    }
  };
  const session = await readSession();
  const token = session?.access_token || '';
  const requestUserId = session?.user?.id || getActiveUserId();
  if (!token) {
    throw new Error('AIを使うには、AI設定でログインしてください。');
  }
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  const timeoutId = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
  signal?.addEventListener('abort', abortFromCaller, { once: true });

  let res;
  try {
    res = await fetch(SERVER_GENERATE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        modelPreference,
        systemText,
        userText,
        maxTokens,
        responseFormat,
        actionType,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      if (signal?.aborted) throw new DOMException('AI処理をキャンセルしました。', 'AbortError');
      throw new Error('AIの応答に時間がかかりすぎました。通信状態を確認して、もう一度お試しください。');
    }
    throw new Error('AIサーバーに接続できませんでした。通信状態を確認して、もう一度お試しください。');
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', abortFromCaller);
  }

  if (!res.ok) {
    let msg = `AI Error ${res.status}`;
    let usage = null;
    try {
      const data = await res.json();
      msg = data.error || msg;
      usage = data.usage || null;
    } catch {}
    const err = new Error(getFriendlyAiError(res.status, msg));
    err.status = res.status;
    err.usage = usage;
    throw err;
  }

  const data = await res.json();
  const text = data.text ?? '';
  if (!String(text).trim()) throw new Error('AIの応答が空でした。少し時間を置いてもう一度お試しください。');
  const currentSession = await readSession();
  const currentUserId = currentSession?.user?.id || getActiveUserId();
  if (!requestUserId || currentUserId !== requestUserId) {
    throw new Error('アカウントが切り替わったため、回答は保存していません。元のアカウントで再試行してください。');
  }
  return text;
}

async function callAPI(
  modelPreference,
  systemText,
  userText,
  maxTokens,
  responseFormat = 'text',
  actionType = 'ai_request',
  options
) {
  return callServerAI(modelPreference, systemText, userText, maxTokens, responseFormat, actionType, options);
}

function getFriendlyAiError(status, message) {
  const raw = String(message || '');
  if (/[ぁ-んァ-ヶ一-龠]/.test(raw)) return raw;
  if (status === 401) return 'AIを使うにはログインしてください。';
  if (status === 403) return 'このアカウントではAIを利用できません。';
  if (status === 429) return 'AIの利用が集中しています。少し時間を置いてもう一度お試しください。';
  if (status === 503) {
    const detail = raw && !/^AI Error \d+$/.test(raw) ? ` (${raw.slice(0, 180)})` : '';
    return `AIサーバーを利用できません。Gemini側の一時的な障害または設定エラーの可能性があります。${detail}`;
  }
  if (status >= 500) return 'AIから正常な応答を受け取れませんでした。もう一度お試しください。';
  return raw || `AIエラー (${status})`;
}

export async function streamText({ model = FAST_MODEL, system, userContent, maxTokens = 200, onChunk }) {
  const full = await callAPI(model, system || '', userContent, maxTokens, 'text', 'daily_message');
  let acc = '';
  for (const ch of full) {
    acc += ch;
    onChunk?.(ch, acc);
  }
  return full;
}

export async function streamDailyMessage(tasks = [], events = [], goals = [], onChunk) {
  const todayStr = today();
  const pending = tasks.filter(t => !t.completed).slice(0, 6);
  const todayEvents = events.filter(e => e.start?.slice(0, 10) === todayStr).slice(0, 4);
  const topGoal = goals[0]?.title || '';

  const ctx = `tasks:${pending.map(t => t.title.slice(0, 10)).join(',') || 'none'} | `
    + `events:${todayEvents.map(e => e.title.slice(0, 10)).join(',') || 'none'} | `
    + `goal:${topGoal.slice(0, 20) || 'none'}`;

  return streamText({
    model: FAST_MODEL,
    system: '日本語のみ。50文字以内。前置きなし。絵文字は1個まで。',
    userContent: `要約: ${ctx}`,
    maxTokens: 120,
    onChunk,
  });
}

function tryParseJSON(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  const firstObject = cleaned.indexOf('{');
  const lastObject = cleaned.lastIndexOf('}');
  if (firstObject >= 0 && lastObject > firstObject) {
    try { return JSON.parse(cleaned.slice(firstObject, lastObject + 1)); } catch {}
  }
  const firstArray = cleaned.indexOf('[');
  const lastArray = cleaned.lastIndexOf(']');
  if (firstArray >= 0 && lastArray > firstArray) {
    try { return JSON.parse(cleaned.slice(firstArray, lastArray + 1)); } catch {}
  }
  return null;
}

export async function getDailyMessage(tasks = [], events = [], goals = []) {
  const cacheKey = `daily_${today()}`;
  const cached = getAiCache(cacheKey);
  if (cached) return cached;

  const todayStr = today();
  const pending = tasks.filter(t => !t.completed).slice(0, 6);
  const todayEvents = events.filter(e => e.start?.slice(0, 10) === todayStr).slice(0, 4);
  const topGoal = goals[0]?.title || '';

  const ctx = `tasks:${pending.map(t => `${t.title}[${t.weight?.[0] || 'm'}]`).join(',') || 'none'} | `
    + `events:${todayEvents.map(e => `${e.title}@${e.start?.slice(11, 16)}`).join(',') || 'none'} | `
    + `goal:${topGoal || 'none'}`;

  const result = await callAPI(
    FAST_MODEL,
    'Return JSON only: {"message":"50文字以内","focus":"60文字以内"}',
    ctx,
    160,
    'json',
    'daily_message'
  );

  const parsed = tryParseJSON(result) || {
    message: '今日は優先度の高いことから順に進めましょう。',
    focus: '最優先のタスクに集中',
  };
  setAiCache(cacheKey, parsed, 86_400_000);
  return parsed;
}

export async function parseNaturalLanguageEvent(text, categories = []) {
  const now = new Date();
  const localToday = today();
  const nowStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const catNames = categories.map(c => c.name).join(',');
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  const cacheKey = `nlparse_${localToday}_${catNames}_${text}`;
  const cached = getAiCache(cacheKey);
  if (cached) return cached;

  const result = await callAPI(
    FAST_MODEL,
    [
      `Extract one calendar event. Current local datetime: ${nowStr} (${timeZone}). Categories: ${catNames || 'none'}.`,
      'Return JSON only: {"title":"...","start":"YYYY-MM-DDTHH:mm:00|null","end":"YYYY-MM-DDTHH:mm:00|null","categoryName":"...|null","isTentative":false}.',
      'Use only details stated by the user. Never invent a date, time, duration, category, person, or place.',
      'Choose categoryName only from the supplied categories; otherwise return null.',
      'In Japanese, 10時半 means 10:30, never 22:30. Only 午後, 夕方, or 夜 indicates PM. 午前12時 is 00:00 and 午後12時 is 12:00.',
      'If only one clock time is supplied, use it as start and keep end null unless a duration is explicitly supplied.',
    ].join(' '),
    text,
    200,
    'json',
    'event_parse'
  );

  const parsed = tryParseJSON(result);
  const explicitDate = resolveRelativeDate(text, localToday);
  const explicitTimes = parseJapaneseTimes(text);
  if (parsed && explicitDate && explicitTimes.length) {
    parsed.start = `${explicitDate}T${explicitTimes[0]}:00`;
    if (explicitTimes[1]) parsed.end = `${explicitDate}T${explicitTimes[1]}:00`;
    else if (!/\d+\s*(?:分|時間)/.test(String(text || ''))) parsed.end = null;
  }
  if (parsed) setAiCache(cacheKey, parsed, 3_600_000);
  return parsed;
}

export async function analyzeEnergyPatterns(focusLogs) {
  const cacheKey = `energy_${today()}`;
  const cached = getAiCache(cacheKey);
  if (cached) return cached;

  const summary = focusLogs
    .slice(-60)
    .map(l => `${l.hour}h${['日', '月', '火', '水', '木', '金', '土'][l.dayOfWeek]}${l.focusLevel?.[0] || ''}`)
    .join(',');

  const result = await callAPI(
    FAST_MODEL,
    'Analyze focus logs. Return JSON only: {"insight":"80文字以内","peakTime":"例 10-12時","recommendation":"60文字以内"}',
    summary,
    200,
    'json',
    'energy_patterns'
  );

  const parsed = tryParseJSON(result) || {
    insight: '集中度データを集めると傾向を分析できます。',
    peakTime: '記録が増えると表示されます',
    recommendation: 'タスク完了時に集中度を記録してみましょう。',
  };
  setAiCache(cacheKey, parsed, 86_400_000);
  return parsed;
}

export function predictGoalCompletionLocal(goal, allTasks) {
  const goalTasks = allTasks.filter(t => t.goalId === goal.id);
  const done = goalTasks.filter(t => t.completed);
  const remaining = goalTasks.filter(t => !t.completed);

  if (!goalTasks.length) return { status: 'no_tasks', label: null };
  if (!remaining.length) return { status: 'done', label: '全タスク完了' };
  if (!done.length) return { status: 'no_rate', label: null };

  const cutoff = Date.now() - 14 * 86_400_000;
  const recentDone = done.filter(t => new Date(t.updatedAt || t.createdAt).getTime() > cutoff);
  if (!recentDone.length) return { status: 'no_rate', label: null };

  const rate = recentDone.length / 14;
  const daysNeeded = remaining.length / rate;
  const predicted = new Date(Date.now() + daysNeeded * 86_400_000);
  const label = `${predicted.getFullYear()}年${predicted.getMonth() + 1}月${predicted.getDate()}日`;

  const targetDate = goal.targetDate ? new Date(goal.targetDate) : null;
  const daysLate = targetDate ? Math.ceil((predicted - targetDate) / 86_400_000) : 0;

  if (daysLate > 3) return { status: 'late', label, predictedDateStr: label, daysLate };
  if (daysLate < -3) return { status: 'early', label, predictedDateStr: label, daysLate };
  return { status: 'on_track', label, predictedDateStr: label, daysLate: 0 };
}

export async function analyzeHabitCorrelations(habitLogs, focusLogs) {
  const cacheKey = `habit_corr_${today()}`;
  const cached = getAiCache(cacheKey);
  if (cached) return cached;

  const dates = Object.keys(habitLogs).sort();
  if (dates.length < 7) return null;

  const focusScores = dates.map(d => {
    const dayLogs = focusLogs.filter(l => l.timestamp?.startsWith(d));
    if (!dayLogs.length) return null;
    return dayLogs.reduce((s, l) => s + (l.focusLevel === 'high' ? 3 : l.focusLevel === 'medium' ? 2 : 1), 0) / dayLogs.length;
  });

  const valid = dates.map((_, i) => i).filter(i => focusScores[i] !== null);
  if (valid.length < 5) return null;

  const exArr = valid.map(i => habitLogs[dates[i]]?.exercise ? 1 : 0);
  const slArr = valid.map(i => habitLogs[dates[i]]?.sleep || 0);
  const fsArr = valid.map(i => focusScores[i]);

  const exCorr = pearsonR(exArr, fsArr).toFixed(2);
  const slCorr = pearsonR(slArr, fsArr).toFixed(2);
  const exFocus = avg(valid.filter(i => exArr[valid.indexOf(i)] === 1).map(i => fsArr[valid.indexOf(i)])).toFixed(2);
  const noExFocus = avg(valid.filter(i => exArr[valid.indexOf(i)] === 0).map(i => fsArr[valid.indexOf(i)])).toFixed(2);

  const result = await callAPI(
    FAST_MODEL,
    'Write 3 concise Japanese insights with numbers. Return JSON only: {"insights":["...","...","..."],"advice":"80文字以内"}',
    `n=${valid.length} exercise_r=${exCorr} sleep_r=${slCorr} exercise_focus=${exFocus} no_exercise_focus=${noExFocus}`,
    300,
    'json',
    'analytics_summary'
  );

  const parsed = tryParseJSON(result) || { insights: ['データが増えると傾向が見えてきます。'], advice: '' };
  setAiCache(cacheKey, parsed, 86_400_000);
  return parsed;
}

function pearsonR(xs, ys) {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return Math.sqrt(dx * dy) < 1e-10 ? 0 : num / Math.sqrt(dx * dy);
}

function avg(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

export async function generateMonthlyReport(prevMonth, data) {
  const result = await callAPI(
    QUALITY_MODEL,
    'Generate a Japanese monthly review. Return JSON only: {"title":"...","highlights":["...","...","..."],"achievements":"80文字以内","learning":"80文字以内","advice":"100文字以内","score":0}',
    `month:${prevMonth} tasks:${data.tasksCompleted}/${data.tasksTotal} goals:${data.goalsCount} memos:${data.knowledgeMemos} focus:${data.avgFocus || 'n/a'} habitDays:${data.habitDays}`,
    600,
    'json',
    'monthly_report'
  );
  return tryParseJSON(result) || {
    title: `${prevMonth}の振り返り`,
    highlights: ['データを蓄積中です。'],
    achievements: '',
    learning: '',
    advice: '次月も継続して記録していきましょう。',
    score: 70,
  };
}

export async function generateAnalyticsSummary(monthStr, data) {
  const text = await callAPI(
    FAST_MODEL,
    '日本語のみ。3段落以内。数字を含む読みやすい月次サマリーを返してください。',
    `month:${monthStr} ${JSON.stringify(data)}`,
    250,
    'text',
    'analytics_summary'
  );
  return text.trim();
}

export async function suggestKnowledgeTags(title, textPreview) {
  const cacheKey = `kn_tags_${title}_${textPreview.slice(0, 60)}`;
  const cached = getAiCache(cacheKey);
  if (cached) return cached;

  const result = await callAPI(
    FAST_MODEL,
    'Suggest up to 5 Japanese academic/topic tags. Return JSON only: {"tags":["t1","t2","t3"]}',
    `title:${title}\n${textPreview.slice(0, 300)}`,
    120,
    'json',
    'tag_suggest'
  );

  const parsed = tryParseJSON(result);
  const tags = Array.isArray(parsed?.tags) ? parsed.tags.slice(0, 5) : [];
  if (tags.length) setAiCache(cacheKey, tags, 86_400_000);
  return tags;
}

export async function explainTerm(term, context = '') {
  const result = await callAPI(
    FAST_MODEL,
    'Explain the term in Japanese in 80-150 chars. Plain text only.',
    `term:${term}\ncontext:${context.slice(0, 200)}`,
    200,
    'text',
    'term_explain'
  );
  return result.trim();
}

export async function formatKnowledgeMemo(rawText, existingMemosCtx = '', options = {}) {
  const system = [
    'You are a careful Japanese note editor. Turn rough notes into a structured memo without changing their meaning. Return JSON only.',
    'Schema: {"title":"short Japanese title","blocks":[{"type":"h2","text":"heading"},{"type":"paragraph","text":"body"},{"type":"bullet","text":"point"}],"tags":["tag1","tag2"]}.',
    'Use only block types paragraph, h1, h2, h3, bullet, numbered, quote, toggle, math, divider.',
    'Preserve the original order, dates, names, numbers, qualifications, headings, lists, and quoted wording.',
    'Do not invent, infer, correct, or add facts that are not present in the input.',
    'Use one idea per block. Use headings only when they describe a real section. Keep list items as list items.',
    'Do not add generic introductions, conclusions, study advice, or filler.',
    'Use toggle only when the input clearly contains collapsible detail. Use divider only for an explicit topic break.',
    'Choose 1 to 5 short reusable tags from the actual content.',
    'Existing memo context is only vocabulary context for titles and tags. Never copy its facts into the new memo.',
  ].join(' ');
  const sourceLimit = 12_000;
  const sourceText = String(rawText || '');
  const user = 'Text to organize:\n' + sourceText.slice(0, sourceLimit)
    + (existingMemosCtx ? '\n\nExisting memo context:\n' + existingMemosCtx : '');

  const raw = await callAPI(QUALITY_MODEL, system, user, 1800, 'json', 'memo_format', options);
  const parsed = tryParseJSON(raw);
  if (!parsed?.blocks) throw new Error('AIがメモを正しい形式に整えられませんでした。内容を短くしてもう一度お試しください。');
  const allowedTypes = new Set(['paragraph', 'h1', 'h2', 'h3', 'bullet', 'numbered', 'quote', 'toggle', 'math', 'divider']);
  const blocks = Array.isArray(parsed.blocks)
    ? parsed.blocks
      .map(block => ({
        type: allowedTypes.has(block?.type) ? block.type : 'paragraph',
        text: String(block?.text || '').trim(),
      }))
      .filter(block => block.type === 'divider' || block.text)
    : [];
  if (!blocks.length) throw new Error('AIがメモ本文を整理できませんでした。内容を少し具体的にしてもう一度お試しください。');
  return {
    title: String(parsed.title || '').trim(),
    blocks,
    tags: Array.isArray(parsed.tags)
      ? [...new Set(parsed.tags.map(tag => String(tag || '').trim()).filter(Boolean))].slice(0, 5)
      : [],
    sourceWasTrimmed: sourceText.length > sourceLimit,
  };
}

function normalizedTopicText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s・、】【「」『』()（）!?！？、,./]/g, '');
}

export function canonicalTopicKey(value) {
  const text = normalizedTopicText(value);
  if (/(怖がらせ|恐怖を与|脅|威圧|scare|frighten|intimidat)/.test(text)) return 'intimidation-frightening';
  if (/(恐怖|恐れ|怖|こわ|不安|anxiety|fear|scare|frighten)/.test(text)) return 'fear-anxiety';
  if (/(面倒|煩|負担|bother|burden|trouble)/.test(text)) return 'burden-bother';
  if (/(喜び|嬉し|幸せ|happy|joy|delight)/.test(text)) return 'joy-happiness';
  if (/(怒り|腹立|苛立|angry|anger|annoy)/.test(text)) return 'anger-irritation';
  if (/(悲し|寂し|sad|sorrow|lonely)/.test(text)) return 'sadness-loneliness';
  return text;
}

export function detectAtlasQueryMode(value) {
  const text = String(value || '').trim();
  if (!text) return 'japanese_concept';
  const hasJapanese = /[\u3040-\u30ff\u3400-\u9fff]/u.test(text);
  const englishWords = text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || [];
  const onlyEnglishExpression = !hasJapanese
    && englishWords.length > 0
    && englishWords.length <= 6
    && /^[A-Za-z\s'’.,!?-]+$/u.test(text);
  return onlyEnglishExpression ? 'english_seed' : 'japanese_concept';
}

export function extractRequestedAtlasExpressions(value) {
  const text = String(value || '').normalize('NFKC');
  return [...new Set((text.match(/[A-Za-z]+(?:['’][A-Za-z]+)?(?:\s+[A-Za-z]+(?:['’][A-Za-z]+)?){0,4}/g) || [])
    .map(term => term.trim())
    .filter(Boolean))];
}

export function reuseEquivalentAtlasTopic(existingTaxonomy, category, topic, context = '') {
  const targetKey = canonicalTopicKey(`${topic} ${context}`);
  const normalizedCategory = normalizeAtlasCategory(category, `${topic} ${context}`);
  if (!targetKey) return { category: normalizedCategory, topic };
  const categories = Array.isArray(existingTaxonomy) ? existingTaxonomy : [];
  const preferred = categories.filter(item => (
    normalizeAtlasCategory(item?.category || '', `${topic} ${context}`) === normalizedCategory
  ));
  const candidates = [...preferred, ...categories.filter(item => !preferred.includes(item))];
  for (const item of candidates) {
    const records = Array.isArray(item?.topicRecords) ? item.topicRecords : [];
    const match = records.find(record => canonicalTopicKey([
      record?.label,
      ...(Array.isArray(record?.aliases) ? record.aliases : []),
      ...(Array.isArray(record?.terms) ? record.terms : []),
    ].filter(Boolean).join(' ')) === targetKey);
    if (match?.label) {
      return {
        category: normalizeAtlasCategory(item.category || normalizedCategory, `${topic} ${context}`),
        topic: match.label,
      };
    }
  }
  return { category: normalizedCategory, topic };
}

function resolveAtlasTopic(value, category, fallback = '') {
  const candidate = normalizeAtlasTopic(value, category);
  if (isValidAtlasTopic(candidate, category)) return candidate;
  const fallbackTopic = normalizeAtlasTopic(fallback, category);
  if (isValidAtlasTopic(fallbackTopic, category)) return fallbackTopic;
  return '関連表現';
}

function normalizeNuanceIntensity(value, fallback = '') {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 1 && numeric <= 5) return Math.round(numeric);
  const match = String(value || fallback || '').match(/[1-5]/);
  return match ? Number(match[0]) : 3;
}

export async function answerEnglishLearningQuestion(questionJa, options = {}) {
  const question = String(questionJa || '').trim();
  if (!question) throw new Error('英語についての疑問を入力してください。');
  const system = [
    'You are a careful English-learning tutor for a Japanese learner.',
    'Return JSON only and follow the response schema exactly.',
    'Answer the learner\'s actual question directly before adding detail. Do not ask them to rephrase a short or ambiguous question; state a reasonable interpretation and answer it.',
    'Distinguish verified historical etymology from a learning image. Never invent etymology, usage rules, or exceptions.',
    'For phrasal verbs, explain the particle image, literal versus idiomatic meaning, transitivity, separability, and object placement when relevant.',
    'For prepositions and conjunctions, explain the core relationship or connection, the basic sentence pattern, and a decisive contrast with a nearby form when useful.',
    'Use Japanese for explanations and natural English only for examples, terms, and grammar labels.',
    'Give two or three short natural examples. Include an irregular form or countability detail only when it actually helps the question.',
    'Keep uncertainty visible. Do not claim a single rule if the choice depends on context.',
    'Return no greeting, Markdown, or text outside the JSON object.',
  ].join(' ');
  const raw = await callAPI(
    QUALITY_MODEL,
    system,
    JSON.stringify({ questionJa: question, language: 'English', learnerLevel: 'intermediate' }),
    3800,
    'json',
    'english_question',
    options
  );
  const parsed = tryParseJSON(raw) || {};
  const examples = (Array.isArray(parsed.examples) ? parsed.examples : [])
    .map(example => ({
      english: String(example?.english || '').trim(),
      japanese: String(example?.japanese || '').trim(),
      noteJa: String(example?.noteJa || '').trim(),
    }))
    .filter(example => example.english && example.japanese)
    .slice(0, 3);
  const answer = {
    shortAnswerJa: String(parsed.shortAnswerJa || '').trim(),
    intuitionJa: String(parsed.intuitionJa || '').trim(),
    explanationJa: String(parsed.explanationJa || '').trim(),
    examples,
    relatedTerms: normalizeStringList(parsed.relatedTerms, 8),
    cautionsJa: normalizeStringList(parsed.cautionsJa, 5),
    suggestedCategory: String(parsed.suggestedCategory || 'usage').trim(),
  };
  if (!answer.shortAnswerJa || !answer.intuitionJa || !answer.explanationJa || examples.length < 2) {
    throw new Error('学習用の回答を十分に作れませんでした。もう一度お試しください。');
  }
  return answer;
}

export async function generateKnowledgeAnswer(question, taxonomy, options = {}) {
  const cleanQuestion = String(question || '').trim();
  if (!cleanQuestion) throw new Error('質問を入力してください。');
  const system = [
    'You create a durable Japanese learning-library entry from the user question.',
    'Return JSON only and follow the response schema exactly.',
    'Answer the question directly first, then explain it carefully in a coherent flow.',
    'After the direct answer, provide three to five concise keyPoints. Each point must capture a distinct idea the reader should retain, not merely repeat a section heading.',
    'Target roughly 1500-2500 Japanese characters. Add explanatory depth, not decorative wording or repeated conclusions.',
    'Build a readable chain from definitions and premises to mechanisms, causes, consequences, and concrete examples that answer this exact question.',
    'Explain why each important step follows from the previous one. Distinguish facts, interpretations, and useful analogies instead of blending them together.',
    'Choose one primary disciplinary lens that best answers the question, then add two to four secondary lenses only when they change, test, qualify, or usefully extend the explanation. Do not give every lens equal space: develop the primary explanation most fully.',
    'Useful secondary lenses may supply a different scale, a competing explanation, a historical origin, an application, an exception, or a genuinely parallel structure in another field. Never attach an unrelated discipline merely to appear interdisciplinary.',
    'For historical questions, make chronology, multiple causes, actors, and later interpretation explicit. For scientific or technical questions, explain observations, mechanism, evidence, scale, and limits. For economics, separate assumptions, causal effects, time horizons, and who gains or bears costs. For abstract concepts, explain its core, boundary cases, counterexamples, and nearest confusing alternatives.',
    'Use three to seven natural paragraphs across two to five content-specific sections. Keep each paragraph focused on one connected idea so the answer remains easy to scan.',
    'Organize the sections around the subject itself rather than a fixed template. Do not expose framework labels such as macro, micro, critique, analogy, multiple perspectives, synthesis, camera, or lens as headings.',
    'Headings must state the actual claim or question developed in that section. Prefer a plain informative heading over a theatrical heading or a one-word method label.',
    'Use analogies only to clarify a verified structure. Explicitly mention the important point where an analogy stops matching, and never replace the real mechanism with the analogy.',
    'Do not describe oxygen binding to hemoglobin as rusting or ordinary iron oxidation. More generally, do not turn a memorable metaphor into a factual identity.',
    'Avoid claims of inevitability, absolute certainty, complete proof, or exact equivalence unless the evidence truly supports them. Distinguish established findings, reasonable inference, debated interpretation, and illustrative comparison.',
    'Write in calm, direct, contemporary Japanese. Avoid self-conscious drama, grand finales, intellectual-performance language, and sales or business lessons added without request.',
    'Add a heading only when the topic genuinely changes; do not use generic headings such as 概要, 理由1, まとめ.',
    'Use the user question and its concrete subject throughout the explanation. Avoid generic textbook filler that could be pasted into an unrelated answer.',
    'Do not greet, praise the question, repeat the conclusion, or append generic suggestions.',
    'Do not output Markdown, HTML, **, __, code fences, or raw formatting symbols.',
    'Formatting must use segment marks only: strong, highlight-yellow, highlight-blue, warning.',
    'Use marks sparingly: strong for essential terms, one to three highlights across the whole answer, warning only for a real caveat.',
    'Classify with only the supplied majorId and middleId values. Never invent category IDs.',
    'Choose exactly one primary majorId and one of its child middleIds from the supplied taxonomy.',
    'Classify by the central question being explained, not by a place, person, or example that appears only as context.',
    'Use relatedCategoryIds only for genuinely useful secondary viewpoints. Do not repeat middleId there.',
    'Use interdisciplinary/unclassified only when no supplied specific category reasonably fits.',
    'Also classify time and geography conservatively. Use ISO 3166-1 alpha-2 country codes only when the country is genuinely central. Use region ids only from the supplied list. A concept with no meaningful date must use timeless; a long-running concept must use cross_period; never invent exact years.',
    'Create stable lowercase ASCII concept keys with hyphens when possible. Include aliases for Japanese/English naming differences.',
    'Put every concept mentioned as a future learning target in concepts, but keep the list focused.',
    'If the question is ambiguous, state the most reasonable interpretation in the answer instead of asking for clarification.',
    'Avoid unsupported precision. Put genuine uncertainty or disputed points in cautions.',
  ].join('\n');
  const raw = await callAPI(
    QUALITY_MODEL,
    system,
    JSON.stringify({
      question: cleanQuestion,
      taxonomy,
      geography: {
        regionIds: ['world', 'europe', 'north_america', 'latin_america_caribbean', 'africa', 'west_asia', 'central_asia', 'south_asia', 'east_asia', 'southeast_asia', 'oceania', 'polar_ocean'],
        countryCodeFormat: 'ISO 3166-1 alpha-2',
      },
      timeline: {
        modes: ['timeless', 'cross_period', 'dated', 'unclassified'],
        note: 'For dated items use non-zero integer startYear and endYear. BCE is negative; use no year zero.',
      },
    }),
    4800,
    'json',
    'knowledge_answer',
    options
  );
  const parsed = tryParseJSON(raw);
  if (!parsed) throw new Error('AIの回答形式を確認できませんでした。もう一度お試しください。');
  return parsed;
}

export async function generateNuanceEntries(
  {
    language = 'English',
    learningTarget = '',
    category = '',
    topic = '',
    seedTerms = [],
    existingExpressions = [],
    referenceExpressions = [],
    existingTaxonomy = [],
  } = {},
  options = {}
) {
  const cleanCategory = String(category || '').trim();
  const cleanTopic = String(topic || '').trim();
  const cleanTarget = String(learningTarget || '').trim();
  const queryMode = detectAtlasQueryMode(cleanTarget);
  const anchorTerm = queryMode === 'english_seed'
    ? cleanTarget.replace(/^[\s'’“”".,!?-]+|[\s'’“”".,!?-]+$/gu, '').trim()
    : '';
  const suppliedTerms = (Array.isArray(seedTerms) ? seedTerms : String(seedTerms || '').split(/[\n,、]/))
    .map(term => String(term || '').trim())
    .filter(Boolean)
    .slice(0, 6);
  const terms = [...new Set([
    ...(anchorTerm ? [anchorTerm] : []),
    ...suppliedTerms,
  ].map(term => term.toLocaleLowerCase()))]
    .map(key => ([anchorTerm, ...suppliedTerms].find(term => term.toLocaleLowerCase() === key) || key))
    .slice(0, 6);
  const knownExpressions = (Array.isArray(existingExpressions) ? existingExpressions : [])
    .map(entry => ({
      term: String(entry?.term || '').trim(),
      lemma: String(entry?.lemma || '').trim(),
      aliases: normalizeStringList(entry?.aliases, 12),
      nuanceTypeJa: String(entry?.nuanceTypeJa || '').trim(),
      intensityLevel: Number(entry?.intensityLevel) || null,
      mapMode: String(entry?.mapMode || '').trim(),
      mapAxisJa: String(entry?.mapAxisJa || '').trim(),
      mapLowLabelJa: String(entry?.mapLowLabelJa || '').trim(),
      mapHighLabelJa: String(entry?.mapHighLabelJa || '').trim(),
    }))
    .filter(entry => entry.term)
    .slice(0, 24);
  const expansionMode = knownExpressions.length > 0;
  const requestedExpressionTerms = [
    anchorTerm,
    ...suppliedTerms,
    ...extractRequestedAtlasExpressions(cleanTarget),
  ].filter(Boolean);
  const requestedExpressionKeys = new Set(requestedExpressionTerms
    .flatMap(term => expressionLookupKeys({ term, lemma: term, aliases: [] })));
  const catalogExpressions = (Array.isArray(referenceExpressions) ? referenceExpressions : [])
    .map(entry => {
      const isRequestedHeadword = expressionLookupKeys(entry)
        .some(key => requestedExpressionKeys.has(key));
      return {
      term: String(entry?.term || '').trim(),
      lemma: String(entry?.lemma || '').trim(),
      aliases: normalizeStringList(entry?.aliases, 8),
      category: String(entry?.category || '').trim(),
      topic: String(entry?.topic || '').trim(),
      isRequestedHeadword,
      senses: (Array.isArray(entry?.senses) && entry.senses.length ? entry.senses : [entry])
        .map(sense => ({
          senseId: String(sense?.senseId || '').trim(),
          partOfSpeech: String(sense?.partOfSpeech || '').trim(),
          coreMeaningJa: String(sense?.coreMeaningJa || '').trim().slice(0, 180),
          coreImageJa: isRequestedHeadword
            ? String(sense?.coreImageJa || '').trim().slice(0, 900)
            : '',
          nuanceSummaryJa: String(sense?.nuanceJa || '').trim()
            .slice(0, isRequestedHeadword ? 1800 : 260),
          usagePatterns: (Array.isArray(sense?.usagePatterns) ? sense.usagePatterns : [])
            .map(pattern => ({
              pattern: String(pattern?.pattern || '').trim(),
              meaningJa: isRequestedHeadword ? String(pattern?.meaningJa || '').trim().slice(0, 220) : '',
            }))
            .filter(pattern => pattern.pattern).slice(0, 6),
          exampleSentences: (Array.isArray(sense?.examples) ? sense.examples : [])
            .map(example => String(example?.source || '').trim()).filter(Boolean)
            .slice(0, isRequestedHeadword ? 4 : 2),
          comparisonTerms: (Array.isArray(sense?.comparisons) ? sense.comparisons : [])
            .map(comparison => String(comparison?.term || '').trim()).filter(Boolean).slice(0, 5),
          senseFingerprint: sense?.senseFingerprint || {},
        }))
        .slice(0, 8),
      };
    })
    .filter(entry => entry.term)
    .slice(0, 80);
  const excludedKeys = new Set(knownExpressions.flatMap(expressionLookupKeys));
  if (!cleanTarget && !cleanCategory && !cleanTopic && !terms.length) {
    throw new Error('知りたい意味・表現を入力してください。');
  }

  const system = [
    'You are a careful bilingual lexicographer for Japanese learners.',
    'Return JSON only and follow the response schema.',
    'Classify the entire expression set with one Japanese category and one concise semantic topic.',
    `When category is blank, choose exactly one category from this fixed list: ${NUANCE_ATLAS_CATEGORIES.join(', ')}.`,
    'Category is the broad reusable domain. Topic is a shorter, more concrete semantic cluster shared by the expressions.',
    'learningTarget may be a Japanese concept request or a directly supplied English word, phrase, phrasal verb, or idiom. Treat it as required semantic intent, not as a category label.',
    'When queryMode is english_seed, treat learningTarget as the anchor expression and add only expressions that are genuinely valuable for comparison. Preserve a valid phrasal verb or idiom as one complete expression. If the input is an inflected form or plural, use the correct dictionary form as term/lemma and keep the supplied form in aliases. If there is an obvious minor spelling error, infer the most likely intended expression, use the corrected form as term/lemma, and keep the exact user input in aliases. Do not ask for clarification when one interpretation is clearly most likely.',
    'Never split phrasal verbs such as drift off, look forward to, put up with, or carry on into unrelated single-word entries. Keep particles and required prepositions in the lemma.',
    'When the user supplies a category or topic, preserve that exact display label. When either is blank, infer it from learningTarget and supplied expressions.',
    'The user will not provide a desired usage situation. Infer several realistic situations for each expression and explain them in useCasesJa.',
    'Always answer when at least a category, topic, or expression is supplied. For a broad or ambiguous request, choose the most useful interpretation and make that interpretation clear instead of asking for more detail.',
    'Prefer an existing category/topic from existingTaxonomy when it is semantically equivalent; otherwise create a clear, reusable label. Never use vague labels such as その他, 一般, 英語表現, 表現の違い, or the category name itself.',
    'Topic must be a compact Japanese noun phrase, usually 2 to 14 characters. Never write a full sentence or a label ending in 表現, 言い方, 場面, 〜を表す表現, or 〜するとき.',
    'Normally create five genuinely useful expressions for the requested semantic topic. Use six when all six add a meaningful contrast, and use four when a fifth would be repetitive. Return only three as a last resort when adding another entry would reduce depth or accuracy. Always include every supplied seed term unless it is already listed in existingExpressions.',
    expansionMode
      ? 'This request expands an existing topic. Do not return expressions already in existingExpressions unless the user directly entered that headword in learningTarget or seedTerms. For a directly requested saved headword, return a complete enriched snapshot when useful coverage is missing. For all other expressions, explore uncovered senses, domains, registers, grammatical roles, and usage boundaries instead of rewriting existing entries. Keep the existing category, topic, map mode, comparison axis, and endpoint labels compatible. Do not pad the result with near-duplicates merely to reach a count.'
      : 'This request creates or extends a normal expression set. Choose the most useful central contrasts for the learner.',
    'When the user directly requests a headword that already exists, that headword is mandatory and is the only count requirement. Return one excellent complete headword entry (or several entries only for genuinely distinct parts of speech or semantic branches). Related comparison expressions are optional and must be omitted when already saved or when adding them would reduce depth. Never invent four or five replacements merely to reach a quota.',
    'Choose mapMode for the whole set. Use scale only when every expression can be compared on one genuinely meaningful continuum. In that case provide a concise theme-specific mapAxisJa plus low and high endpoint labels, and assign each expression exactly one integer star level from 1 to 5. Set intensityLevel, intensityMin, and intensityMax to that same integer; never return a range such as 1-2 or 3-4.',
    'Use groups when forcing the expressions onto one continuum would mislead the learner. In groups mode, mapAxisJa should name the organizing principle and nuanceTypeJa must be a concise reusable group label. Do not invent a strength ranking merely to fill the map.',
    'For scale mode, intensityLevel is one definite position from 1 to 5, chosen by comparing the expressions within this exact set on mapAxisJa. For groups mode it may be 3 for schema compatibility, but it will not be shown. In both modes nuanceTypeJa must explain a qualitative type rather than repeat a number.',
    'Depth matters more than the number of headings. For every expression, write substantial connected Japanese explanations that let the learner form a usable mental model rather than a list of dictionary glosses.',
    'Keep etymologyJa, coreImageJa, coreMeaningJa, and nuanceJa distinct: etymologyJa explains the verified historical path; coreImageJa develops the physical or conceptual image and shows what remains across modern senses; coreMeaningJa traces how the major senses and parts of speech branch from that image; nuanceJa gives a deep connected explanation of speaker psychology, viewpoint, agency, intentionality, emotional temperature, intensity, social distance, register, and the boundary between natural and unnatural usage.',
    'In nuanceJa, explain how the meaning changes with the object, complement, grammatical pattern, or situation whenever the expression has multiple important senses. Identify what the speaker foregrounds, implies, softens, intensifies, accepts, resists, or leaves unsaid. Give concrete selection criteria a learner can actually use, rather than merely listing Japanese translations.',
    'Give each explanation field enough substance to stand on its own. Do not fill several fields with paraphrases of the same sentence, generic advice, or one-line placeholders. All four or five expressions must receive equally deep treatment; never trade explanation quality for count.',
    'For every expression, include pronunciationIpa in standard IPA. Give the most useful General American pronunciation; include a second form only when it materially helps learners.',
    'Etymology must distinguish verified historical origin from a learning mnemonic. Never invent a root or confidently state a disputed origin. When uncertain, explicitly say that the origin is uncertain or leave etymologyJa empty.',
    'Return at least three natural example sentences for every expression, each with a faithful Japanese translation and a short usage note. The examples must be genuinely different in situation, grammar, collocation, and communicative purpose; never reuse or lightly rephrase an example anywhere in the set.',
    'Do not treat different parts of speech as interchangeable. Explicitly explain grammatical differences such as adjective versus noun.',
    'existingCatalog is the learner\'s saved dictionary. Check it before choosing entries. A headword is global across the Atlas, even when an earlier category or topic label differs. Never create a second card for an already saved lemma. When a requested English headword already exists, return a complete improved snapshot for that headword whenever there is a useful missing nuance, construction, example, comparison, part of speech, or dictionary-distinct sense. Include the useful existing coverage as well as the new coverage so the response remains independently complete; the client safely merges it without shortening the saved explanation.',
    'Use a broad pedagogical sense family, not one toggle per tiny translation difference. Variations caused by object choice, complement, construction, register, intensity, or a small contextual shift should normally share one senseId when a learner can understand them as branches of the same core image. Explain those branches together in coreMeaningJa and nuanceJa, and separate their practical use with usagePatterns, examples, collocations, and comparisons.',
    'Create another senseId within the same part of speech only for a dictionary-distinct semantic branch that cannot be taught clearly as a nearby extension of the same core image. A different part of speech remains separate. When several genuinely distinct branches are required, return one complete entries item per branch; otherwise prefer one rich, connected entry over many thin entries.',
    'For every entry, provide senseFingerprint as compact semantic evidence, not display prose. semanticDomain names the broad meaning area; actionType names the event or state; argumentPatterns gives canonical constructions; typicalObjects gives semantic object/complement classes; implicationTags records stable implications; registerTags records register; physicality must be physical, figurative, abstract, or mixed.',
    'Compare the requested use with every matching lemma in existingCatalog. Reuse an existing senseId when the part of speech and underlying semantic branch are the same, even if the new request focuses on another construction, object, implication, or nearby nuance. Expand that sense into a complete richer snapshot. Use a new stable senseId only when the core semantic branch is independently teachable and materially different. If uncertain between a nearby extension and a new sense, prefer enriching the existing family while explicitly explaining the internal contrast.',
    'A new sense is not a paraphrase of an existing coreMeaningJa. Do not rename or rewrite an existing sense merely to satisfy the requested count. Prefer other useful comparison expressions when the catalog already covers the requested headword completely.',
    'Add grammarNotes only when useful: part of speech; countability; irregular plural; irregular past/past participle; meaning-dependent countability such as work/works or experience/experiences; and example forms. Do not pad regular forms with obvious explanations.',
    'When a form is irregular or countability is easy to confuse, use that form naturally in at least one example.',
    'For collocations, return the English combination together with a short natural Japanese meaning for that exact combination. Translate the combination in context, not as isolated dictionary words.',
    'When this sense has characteristic constructions, add three to six usagePatterns. Each pattern must include the English construction, its Japanese function, concrete suitable situations, one or two distinct examples with translations, and a concise nuance or grammar caution. Leave usagePatterns empty rather than inventing patterns for an expression that has none.',
    'Avoid generic statements such as "context matters". State what situation, relationship, intensity, or attitude makes each expression natural.',
    'Return at least three concrete comparisons for every expression. Compare expressions in the returned set when possible, and explain the decisive difference in viewpoint, implication, grammar, strength, or register instead of giving interchangeable dictionary glosses.',
    'Do not invent quotations, statistics, citations, or unsupported claims.',
    'Return no greeting, preface, conclusion, Markdown, or prose outside the JSON object.',
    'Use this exact JSON shape: {"category":"日本語の大分類","topic":"日本語の具体的テーマ","mapMode":"scale or groups","mapAxisJa":"比較軸または分類軸","mapLowLabelJa":"scaleの弱い側。groupsなら空欄","mapHighLabelJa":"scaleの強い側。groupsなら空欄","entries":[{"term":"English expression","lemma":"dictionary headword","pronunciationIpa":"/General American IPA/","aliases":["inflected or alternate form"],"senseId":"short semantic sense key","partOfSpeech":"品詞","senseFingerprint":{"semanticDomain":"short domain","actionType":"short event/state type","argumentPatterns":["canonical pattern"],"typicalObjects":["semantic object class"],"implicationTags":["short implication"],"registerTags":["neutral"],"physicality":"physical or figurative or abstract or mixed"},"etymologyJa":"語源の説明","coreImageJa":"原義から分かる根源的なイメージ","coreMeaningJa":"中心的な意味","nuanceJa":"意味の変化と選択基準まで含む深いニュアンス","nuanceTypeJa":"短いニュアンス分類","intensityMin":2,"intensityMax":2,"intensityLevel":2,"register":"使用域","emotionalToneJa":"感情の温度","useCasesJa":["具体的な場面A","具体的な場面B"],"collocations":[{"expression":"natural English combination","translationJa":"組み合わせとして自然な日本語訳"}],"examples":[{"source":"English sentence","translation":"日本語訳","noteJa":"使い方"}],"comparisons":[{"term":"similar expression","differenceJa":"決定的な違い"}],"cautionsJa":["注意点"],"grammarNotes":{"partOfSpeech":"品詞","countability":"可算性。不要なら空欄","plural":"複数形。特記事項がなければ空欄","past":"過去形。特記事項がなければ空欄","pastParticiple":"過去分詞。特記事項がなければ空欄","usageNotes":["意味で可算性が変わる等"],"exampleForms":["重要な活用形"]}}]}',
  ].join(' ');
  const user = JSON.stringify({
    language: String(language || 'English').trim() || 'English',
    learningTarget: cleanTarget,
    queryMode,
    category: cleanCategory,
    topic: cleanTopic,
    seedTerms: terms,
    expansionMode,
    existingExpressions: knownExpressions,
    existingCatalog: catalogExpressions,
    existingTaxonomy: (Array.isArray(existingTaxonomy) ? existingTaxonomy : []).slice(0, 40),
    allowedCategories: NUANCE_ATLAS_CATEGORIES,
    requestedEntryCount: catalogExpressions.some(entry => entry.isRequestedHeadword)
      ? Math.max(1, requestedExpressionTerms.length)
      : (terms.length ? Math.max(terms.length, 5) : 5),
  });

  const raw = await callAPI(
    QUALITY_MODEL,
    system,
    user,
    14000,
    'json',
    'nuance_generate',
    options
  );
  const parsed = tryParseJSON(raw);
  const mapMode = parsed?.mapMode === 'groups' ? 'groups' : 'scale';
  const mapAxisJa = String(parsed?.mapAxisJa || (mapMode === 'groups' ? 'ニュアンスの種類' : '強さ')).trim();
  const mapLowLabelJa = String(parsed?.mapLowLabelJa || '').trim();
  const mapHighLabelJa = String(parsed?.mapHighLabelJa || '').trim();
  const resolvedCategory = normalizeAtlasCategory(
    cleanCategory || parsed?.category,
    `${cleanTarget} ${cleanTopic} ${terms.join(' ')}`
  );
  const proposedTopic = resolveAtlasTopic(
    cleanTopic || String(parsed?.topic || '').trim(),
    resolvedCategory,
    cleanTarget || terms.join('・')
  );
  const reusedClassification = cleanTopic
    ? { category: resolvedCategory, topic: proposedTopic }
    : reuseEquivalentAtlasTopic(existingTaxonomy, resolvedCategory, proposedTopic, `${cleanTarget} ${terms.join(' ')}`);
  const resolvedTopic = reusedClassification.topic;
  const sourceEntries = Array.isArray(parsed?.entries) ? parsed.entries : [];
  const entries = sourceEntries
    .map(entry => {
      const term = String(entry?.term || '').trim();
      if (!term) return null;
      const intensityLevel = normalizeNuanceIntensity(entry.intensityLevel, entry.intensity);
      return {
        promptVersion: 10,
        language: String(language || 'English').trim() || 'English',
        sourceQueryJa: cleanTarget,
        sourceQueries: cleanTarget ? [cleanTarget] : [],
        queryMode,
        category: reusedClassification.category,
        topic: resolvedTopic,
        mapMode,
        mapAxisJa,
        mapLowLabelJa,
        mapHighLabelJa,
        term,
        lemma: String(entry.lemma || term).trim(),
        pronunciation: String(entry.pronunciationIpa || '').trim(),
        aliases: normalizeStringList(entry.aliases, 12),
        senseId: String(entry.senseId || '').trim(),
        partOfSpeech: String(entry.partOfSpeech || '').trim(),
        senseFingerprint: {
          semanticDomain: String(entry.senseFingerprint?.semanticDomain || '').trim(),
          actionType: String(entry.senseFingerprint?.actionType || '').trim(),
          argumentPatterns: normalizeStringList(entry.senseFingerprint?.argumentPatterns, 8),
          typicalObjects: normalizeStringList(entry.senseFingerprint?.typicalObjects, 8),
          implicationTags: normalizeStringList(entry.senseFingerprint?.implicationTags, 8),
          registerTags: normalizeStringList(entry.senseFingerprint?.registerTags, 6),
          physicality: String(entry.senseFingerprint?.physicality || '').trim().toLocaleLowerCase(),
        },
        etymologyJa: String(entry.etymologyJa || '').trim(),
        coreImageJa: String(entry.coreImageJa || '').trim(),
        coreMeaningJa: String(entry.coreMeaningJa || '').trim(),
        nuanceJa: String(entry.nuanceJa || '').trim(),
        nuanceTypeJa: String(entry.nuanceTypeJa || '').trim(),
        register: String(entry.register || '').trim(),
        intensityLevel,
        intensityMin: intensityLevel,
        intensityMax: intensityLevel,
        intensity: `★${intensityLevel}`,
        emotionalToneJa: String(entry.emotionalToneJa || '').trim(),
        useCasesJa: normalizeStringList(entry.useCasesJa, 6),
        collocations: normalizeCollocations(entry.collocations, 8),
        usagePatterns: (Array.isArray(entry.usagePatterns) ? entry.usagePatterns : [])
          .map(pattern => ({
            pattern: String(pattern?.pattern || pattern?.construction || '').trim(),
            meaningJa: String(pattern?.meaningJa || pattern?.translationJa || '').trim(),
            situationsJa: normalizeStringList(
              pattern?.situationsJa || pattern?.situations || pattern?.useCasesJa,
              4
            ),
            examples: (Array.isArray(pattern?.examples) ? pattern.examples : [])
              .map(example => ({
                source: String(example?.source || example?.english || example?.sentence || '').trim(),
                translation: String(example?.translation || example?.japanese || example?.translationJa || '').trim(),
              }))
              .filter(example => example.source && example.translation)
              .slice(0, 2),
            noteJa: String(pattern?.noteJa || pattern?.note || pattern?.cautionJa || '').trim(),
          }))
          .filter(pattern => pattern.pattern && pattern.meaningJa)
          .slice(0, 6),
        examples: (Array.isArray(entry.examples) ? entry.examples : [])
          .map(example => ({
            source: String(example?.source || '').trim(),
            translation: String(example?.translation || '').trim(),
            noteJa: String(example?.noteJa || '').trim(),
          }))
          .filter(example => example.source && example.translation)
          .slice(0, 4),
        comparisons: (Array.isArray(entry.comparisons) ? entry.comparisons : [])
          .map(comparison => ({
            term: String(comparison?.term || '').trim(),
            differenceJa: String(comparison?.differenceJa || '').trim(),
          }))
          .filter(comparison => comparison.term && comparison.differenceJa)
          .slice(0, 5),
        cautionsJa: normalizeStringList(entry.cautionsJa, 6),
        grammarNotes: {
          partOfSpeech: String(entry.grammarNotes?.partOfSpeech || entry.partOfSpeech || '').trim(),
          countability: String(entry.grammarNotes?.countability || '').trim(),
          plural: String(entry.grammarNotes?.plural || '').trim(),
          past: String(entry.grammarNotes?.past || '').trim(),
          pastParticiple: String(entry.grammarNotes?.pastParticiple || '').trim(),
          usageNotes: normalizeStringList(entry.grammarNotes?.usageNotes, 6),
          exampleForms: normalizeStringList(entry.grammarNotes?.exampleForms, 8),
        },
        classificationSource: cleanCategory || cleanTopic ? 'user' : 'ai',
        manualClassification: Boolean(cleanCategory || cleanTopic),
        personalNote: '',
      };
    })
    .filter(Boolean)
    .filter(entry => !expansionMode || !expressionLookupKeys(entry)
      .some(key => excludedKeys.has(key)) || expressionLookupKeys(entry)
      .some(key => requestedExpressionKeys.has(key)))
    .slice(0, 12);

  if (!entries.length) {
    throw new Error(expansionMode
      ? 'このテーマで新しく追加できる表現が見つかりませんでした。既存の表現は変更していません。'
      : '表現データを作成できませんでした。少し時間を置いて、もう一度お試しください。');
  }
  const grouped = new Map();
  entries.forEach(entry => {
    const key = `${entry.language}|${entry.lemma || entry.term}`.normalize('NFKC').toLocaleLowerCase();
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...entry, senses: [atlasSenseFromEntry(entry)] });
      return;
    }
    existing.senses = mergeAtlasSenseArrays(existing.senses, [atlasSenseFromEntry(entry)]);
    existing.aliases = [...new Set([...(existing.aliases || []), ...(entry.aliases || [])])];
    existing.sourceQueries = [...new Set([...(existing.sourceQueries || []), ...(entry.sourceQueries || [])])];
  });
  return [...grouped.values()];
}

export async function generateTranslationVariants(
  {
    sourceTextJa = '',
    contextJa = '',
    existingTaxonomy = [],
  } = {},
  options = {}
) {
  const source = String(sourceTextJa || '').trim();
  const context = String(contextJa || '').trim();
  if (!source) throw new Error('英訳したい日本語を入力してください。');

  const system = [
    'You are a careful bilingual editor for Japanese learners of English.',
    'Return JSON only and follow the response schema.',
    'Create exactly three natural English translations in this exact order: standard_faithful (明快・忠実), natural_conversational (自然・会話), expressive_polished (洗練・表現).',
    'standard_faithful must be a clear, complete translation that favors common high-frequency vocabulary and straightforward grammar while preserving every fact, relation, condition, degree, and implication in the source.',
    'Never shorten standard_faithful by omitting information. For a long source, keep the necessary length or split it into natural sentences. Plain language must not become childish, vague, overly casual, or a summary.',
    'natural_conversational should sound idiomatic in ordinary modern English and may restructure the sentence while preserving meaning.',
    'expressive_polished may use richer rhythm or more precise vocabulary when the source supports it, but must remain contemporary and genuinely usable. Do not choose archaic, literary, or rare words merely to sound sophisticated, and do not invent facts or emotions.',
    'Each variant must preserve the source meaning while making a meaningful difference in voice, sentence structure, rhythm, register, and intended situation. Do not create superficial synonym swaps.',
    'The user will not provide a target situation. Do not force each translation into a fixed scenario. Explain the register, impression, and situations where each wording naturally fits in overallNuanceJa.',
    'Always answer, even when the Japanese is short, colloquial, fragmentary, or ambiguous. Never refuse or ask the user to provide a more specific sentence solely because context is missing.',
    'For ambiguous wording, choose reasonable interpretations for the three variants and clearly identify each assumption in overallNuanceJa. Keep uncertainty visible instead of returning an empty translation.',
    'Do not invent a person, relationship, event, time, place, emotion, or intention that the user did not supply.',
    'When the Japanese is ambiguous, keep alternatives conditional and explain the ambiguity in Japanese instead of silently choosing one interpretation.',
    'For every variant, overallNuanceJa must be a content-specific Japanese explanation, normally three to five connected sentences. Refer explicitly to what is happening in the source, the speaker viewpoint or causal flow, and at least two actual wording or construction choices in that English variant. Explain how those choices shape emphasis, distance, emotion, rhythm, and suitable register. Never write a reusable stock comment that could be pasted under an unrelated sentence, such as merely saying that the wording is natural, casual, clear, vivid, or suitable for conversation.',
    'For every variant, provide three to five genuinely useful vocabulary or construction notes. Cover the choices that carry the sentence meaning: important lexical items, collocations, tense/aspect, clause connection, emphasis, or information structure. Do not count trivial function words unless their use is genuinely instructive.',
    'Avoid repeating the same explanation across variants. Provide two to four concrete comparisons per variant, choosing plausible alternatives a learner might actually consider. Each comparison must explain how replacing the used wording would alter this sentence, not give a generic dictionary contrast.',
    'Each vocabulary note must explain the expression or construction, its historical etymology when reliably known, its physical/root core image, and its deep nuance specifically in this sentence. Connect the explanation back to the source content instead of discussing the item in isolation.',
    'Never invent an etymology. If the origin is uncertain or not relevant to a construction, leave etymologyJa empty and explain only the grammatical core image or function.',
    'Each comparison must name the expression used, a plausible alternative, and the decisive difference in nuance or usage.',
    'backTranslationJa must reveal any shift in implication rather than merely repeat the original source.',
    'Classify the entire set with one Japanese category and one concise Japanese topic.',
    `Choose the category exactly from this fixed list: ${NUANCE_ATLAS_CATEGORIES.join(', ')}.`,
    'Category is the broad reusable domain. Topic is a short, reusable semantic cluster expressed by the source sentence.',
    'Prefer an existing category/topic from existingTaxonomy when semantically equivalent; otherwise create a clear reusable label. Never use vague labels such as その他, 一般, 英語表現, or the category name itself.',
    'Topic must be a compact Japanese noun phrase, usually 2 to 14 characters. Never use a full sentence or an ending such as 表現, 言い方, 場面, or 〜を表す表現.',
    'Return no greeting, preface, overall sentence dissection, conclusion, Markdown, or prose outside the JSON object.',
    'Use this exact JSON shape: {"category":"日本語の大分類","topic":"日本語の具体的テーマ","variants":[{"style":"standard_faithful","translation":"English translation","backTranslationJa":"和訳（逆翻訳）","overallNuanceJa":"文全体の印象・使用域・自然に合う場面","register":"使用域","vocabularyNotes":[{"expression":"主要語彙または構文","lemma":"dictionary headword","senseHintJa":"この文での短い意味","etymologyJa":"信頼できる語源。該当しなければ空欄","coreImageJa":"原義または構文のコアイメージ","nuanceJa":"この文で生まれる深いニュアンス"}],"comparisons":[{"expression":"使用表現","alternative":"似た表現","differenceJa":"決定的な違い"}]},{"style":"natural_conversational","translation":"English translation","backTranslationJa":"和訳（逆翻訳）","overallNuanceJa":"文全体の印象・使用域・自然に合う場面","register":"使用域","vocabularyNotes":[],"comparisons":[]},{"style":"expressive_polished","translation":"English translation","backTranslationJa":"和訳（逆翻訳）","overallNuanceJa":"文全体の印象・使用域・自然に合う場面","register":"使用域","vocabularyNotes":[],"comparisons":[]}]}',
  ].join(' ');
  const user = JSON.stringify({
    sourceTextJa: source,
    contextJa: context,
    targetLanguage: 'English',
    existingTaxonomy: (Array.isArray(existingTaxonomy) ? existingTaxonomy : []).slice(0, 40),
    allowedCategories: NUANCE_ATLAS_CATEGORIES,
    requestedVariantCount: 3,
    requiredStyles: ['standard_faithful', 'natural_conversational', 'expressive_polished'],
  });

  const raw = await callAPI(
    QUALITY_MODEL,
    system,
    user,
    9000,
    'json',
    'translation_variants',
    options
  );
  const parsed = tryParseJSON(raw);
  const styleDefinitions = [
    { style: 'standard_faithful', labelJa: '明快・忠実' },
    { style: 'natural_conversational', labelJa: '自然・会話' },
    { style: 'expressive_polished', labelJa: '洗練・表現' },
  ];
  const sourceVariants = Array.isArray(parsed?.variants) ? parsed.variants : [];
  const unique = new Set();
  const variants = styleDefinitions
    .map((definition, index) => {
      const item = sourceVariants.find(candidate => candidate?.style === definition.style)
        || sourceVariants[index];
      const translation = String(item?.translation || '').trim();
      const key = translation.toLocaleLowerCase();
      if (!translation || unique.has(key)) return null;
      unique.add(key);
      return {
        style: definition.style,
        translation,
        labelJa: definition.labelJa,
        overallNuanceJa: String(item?.overallNuanceJa || item?.nuanceJa || '').trim(),
        nuanceJa: String(item?.overallNuanceJa || item?.nuanceJa || '').trim(),
        register: String(item?.register || '').trim(),
        backTranslationJa: String(item?.backTranslationJa || '').trim(),
        vocabularyNotes: (Array.isArray(item?.vocabularyNotes) ? item.vocabularyNotes : [])
          .map(note => ({
            expression: String(note?.expression || '').trim(),
            lemma: String(note?.lemma || note?.expression || '').trim(),
            senseHintJa: String(note?.senseHintJa || '').trim(),
            etymologyJa: String(note?.etymologyJa || '').trim(),
            coreImageJa: String(note?.coreImageJa || '').trim(),
            nuanceJa: String(note?.nuanceJa || '').trim(),
          }))
          .filter(note => note.expression && (note.etymologyJa || note.coreImageJa || note.nuanceJa))
          .slice(0, 5),
        comparisons: (Array.isArray(item?.comparisons) ? item.comparisons : [])
          .map(comparison => ({
            expression: String(comparison?.expression || '').trim(),
            alternative: String(comparison?.alternative || '').trim(),
            differenceJa: String(comparison?.differenceJa || '').trim(),
          }))
          .filter(comparison => comparison.expression && comparison.alternative && comparison.differenceJa)
          .slice(0, 4),
        useCasesJa: normalizeStringList(item?.useCasesJa, 5),
        cautionsJa: normalizeStringList(item?.cautionsJa, 5),
      };
    })
    .filter(Boolean)
    .slice(0, 3);
  const category = normalizeAtlasCategory(
    parsed?.category,
    `${source} ${parsed?.topic || ''}`
  );
  const topic = resolveAtlasTopic(
    String(parsed?.topic || '').trim(),
    category,
    String(context || source).replace(/\s+/g, ' ').slice(0, 24)
  );
  const variantsAreComplete = variants.every(variant => (
    variant.overallNuanceJa.length >= 40
    && variant.vocabularyNotes.length >= 3
    && variant.comparisons.length >= 2
  ));
  if (!category || variants.length !== 3 || !variantsAreComplete) {
    throw new Error('3種類の英訳と解説を十分に揃えられませんでした。もう一度お試しください。');
  }
  return {
    promptVersion: 5,
    language: 'English',
    sourceTextJa: source,
    contextJa: context,
    category,
    topic,
    classificationSource: 'ai',
    manualClassification: false,
    summaryJa: '',
    variants,
    personalNote: '',
  };
}

function normalizeStringList(value, maxItems) {
  return (Array.isArray(value) ? value : [])
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeCollocations(value, maxItems) {
  return (Array.isArray(value) ? value : [])
    .map(item => {
      if (typeof item === 'string') {
        const expression = item.trim();
        return expression ? { expression, translationJa: '' } : null;
      }
      const expression = String(item?.expression || item?.text || '').trim();
      if (!expression) return null;
      return {
        expression,
        translationJa: String(item?.translationJa || item?.meaningJa || '').trim(),
      };
    })
    .filter(Boolean)
    .slice(0, maxItems);
}

export async function summarizeAndTagText(text) {
  const result = await callAPI(
    FAST_MODEL,
    'Summarize in Japanese and suggest tags. Return JSON only: {"summary":"150文字以内","tags":["t1","t2"]}',
    text.slice(0, 2000),
    250,
    'json',
    'memo_summary'
  );
  return tryParseJSON(result) || { summary: '', tags: [] };
}

export async function detectKnowledgeGaps(goalTitle, existingTags) {
  const cacheKey = `kngap_${goalTitle}_${[...existingTags].sort().join(',')}`;
  const cached = getAiCache(cacheKey);
  if (cached) return cached;

  const result = await callAPI(
    FAST_MODEL,
    'List missing study topics. Return JSON only: {"gaps":["topic1","topic2","topic3"]}',
    `goal:${goalTitle}\nhave:${existingTags.join(',') || 'none'}`,
    150,
    'json'
  );

  const parsed = tryParseJSON(result);
  const gaps = Array.isArray(parsed?.gaps) ? parsed.gaps.slice(0, 5) : [];
  if (gaps.length) setAiCache(cacheKey, gaps, 43_200_000);
  return gaps;
}

export async function suggestUnstudiedTopics(goalTitle, knowledgeTags) {
  const cacheKey = `unstudied_${goalTitle}_${[...knowledgeTags].sort().join(',')}`;
  const cached = getAiCache(cacheKey);
  if (cached) return cached;

  const result = await callAPI(
    FAST_MODEL,
    'List unstudied topics. Return JSON only: {"topics":["t1","t2","t3"]}',
    `goal:${goalTitle}\nhave:${knowledgeTags.join(',') || 'none'}`,
    150,
    'json'
  );

  const parsed = tryParseJSON(result);
  const topics = Array.isArray(parsed?.topics) ? parsed.topics.slice(0, 5) : [];
  if (topics.length) setAiCache(cacheKey, topics, 21_600_000);
  return topics;
}

export async function splitGoalToTasks(goal) {
  const cacheKey = `goalsplit_${goal.id}_v3`;
  const cached = getAiCache(cacheKey);
  if (cached) return cached;

  const typeLabel = goal.type === 'monthly' ? '月次' : goal.type === 'weekly' ? '週次' : '日次';

  const result = await callAPI(
    QUALITY_MODEL,
    'Break down the goal into actionable tasks. Return JSON only: {"tasks":[{"title":"...","weight":"large|medium|small","dueDate":"YYYY-MM-DD","description":"..."},{"title":"...","weight":"medium","dueDate":"YYYY-MM-DD","description":"..."}],"advice":"100文字以内"}',
    `goal:${goal.title} type:${typeLabel} due:${goal.targetDate || 'none'} desc:${goal.description?.slice(0, 100) || 'none'} today:${today()}`,
    1200,
    'json',
    'goal_split'
  );

  const parsed = tryParseJSON(result);
  if (parsed) setAiCache(cacheKey, parsed, 21_600_000);
  return parsed;
}

export async function processBatchQueue(onProgress) {
  const queue = getPendingAIQueue();
  if (!queue.length) return { processed: 0, total: 0 };

  const memoItems = queue.filter(q => q.type === 'memo_tags');
  let processed = 0;

  if (memoItems.length) {
    const batch = memoItems.map(item => {
      const memo = getKnowledgeMemoById(item.id);
      if (!memo) return null;
      const preview = (memo.blocks || []).map(b => b.content || b.text || '').join(' ').slice(0, 150);
      return { id: item.id, title: memo.title || '無題', preview };
    }).filter(Boolean);

    if (batch.length) {
      try {
        const result = await callAPI(
          FAST_MODEL,
          'For each memo, suggest up to 4 Japanese tags. Return JSON only: [{"id":"...","tags":["t1","t2"]}]',
          JSON.stringify(batch),
          Math.min(200 * batch.length, 1500),
          'json',
          'batch_tags'
        );

        const parsed = tryParseJSON(result);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (!item.id || !Array.isArray(item.tags)) continue;
            const memo = getKnowledgeMemoById(item.id);
            if (memo && item.tags.length) {
              const merged = [...new Set([...(memo.tags || []), ...item.tags.slice(0, 4)])];
              updateKnowledgeMemo(item.id, { tags: merged, pendingAI: false });
            }
            removeFromPendingAIQueue(item.id, 'memo_tags');
            processed++;
            onProgress?.(processed, queue.length);
          }
        }
      } catch (e) {
        console.warn('[AI] Batch processing error:', e);
      }
    }
  }

  return { processed, total: queue.length };
}


// ---- Whole-app AI helpers ----
export async function interpretPlannerInput(text, context = {}) {
  const localToday = context.today || today();
  const localTomorrow = addDaysToDateString(localToday, 1);
  const localDayAfterTomorrow = addDaysToDateString(localToday, 2);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  const localTime = new Intl.DateTimeFormat('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
  const result = await callAPI(
    QUALITY_MODEL,
    [
      'You are the command brain for a planner app. Decide what the user wants and return JSON only.',
      'Schema: {"action":"task|event|schedule|memo|database|delete_event|delete_task|delete_memo","title":"...","targetTitle":"...","date":"YYYY-MM-DD|null","startTime":"HH:MM|null","endTime":"HH:MM|null","dueDate":"YYYY-MM-DD|null","dueTime":"HH:MM|null","weight":"large|medium|small","estimatedMinutes":number|null,"tags":["..."],"memo":"...","blocks":[{"type":"paragraph|h2|bullet","text":"..."}],"fields":["..."],"rows":[{"...":"..."}],"message":"..."}.',
      'Classify by user intent, not by the mere presence of a date. Use task for a todo or deadline. Use event only for a fixed calendar appointment with a stated date and start time. Use schedule only when the user explicitly asks to reserve a work block with start and end time. Use memo for notes. Use database for table-like collections or when the user asks to create a database.',
      'Preserve the user\'s concrete title words. Do not invent a person, place, category, date, time, duration, tag, or detail that the user did not state or provide in context. When a value is missing, return null, an empty string, or an empty array as appropriate instead of guessing.',
      'Use delete_event, delete_task, or delete_memo only when the user explicitly asks to delete an existing item. Put only the existing item name in targetTitle.',
      'Context is read-only evidence for matching names and categories. Never create facts from context, and never select a different existing item when the match is ambiguous.',
      `The user's local date is ${localToday}, tomorrow is ${localTomorrow}, and the day after tomorrow is ${localDayAfterTomorrow}. The local time is ${localTime} (${timeZone}).`,
      'Resolve Japanese relative dates from those exact local dates. Never use UTC to shift today or tomorrow.',
      'For Japanese clock times, an hour without 午後, 夕方, or 夜 is not PM: 10時半 means 10:30, never 22:30. 夜10時半 and 午後10時半 mean 22:30. 午前12時 means 00:00 and 午後12時 means 12:00.',
      'Use 24-hour HH:MM only after resolving an explicit clock expression. One stated time is startTime; keep endTime null unless an end time or duration is supplied. Never silently choose a typical time.',
      'Dates and times must be concrete only when supported by the input. Never return prose outside JSON.',
    ].join(' '),
    JSON.stringify({ localToday, localTomorrow, localDayAfterTomorrow, localTime, timeZone, text, context }),
    900,
    'json',
    'planner_action'
  );
  const parsed = tryParseJSON(result);
  const allowedActions = new Set([
    'task', 'event', 'schedule', 'memo', 'database',
    'delete_event', 'delete_task', 'delete_memo',
  ]);
  if (!allowedActions.has(parsed?.action)) {
    throw new Error('AIが安全に実行できる操作を判断できませんでした。内容を変えず、もう一度お試しください。');
  }
  if (['delete_event', 'delete_task', 'delete_memo'].includes(parsed.action)
    && !String(parsed.targetTitle || parsed.title || '').trim()) {
    throw new Error('削除対象を特定できなかったため、何も削除していません。');
  }
  const validDate = value => value == null || /^\d{4}-\d{2}-\d{2}$/.test(String(value));
  const validTime = value => value == null || /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value));
  if (!validDate(parsed.date) || !validDate(parsed.dueDate)
    || !validTime(parsed.startTime) || !validTime(parsed.endTime) || !validTime(parsed.dueTime)) {
    throw new Error('AIが返した日付または時刻が不正なため、何も保存していません。');
  }
  if (parsed.action === 'schedule' && parsed.startTime >= parsed.endTime) {
    throw new Error('終了時刻が開始時刻より後になっていないため、何も保存していません。');
  }
  const explicitDate = resolveRelativeDate(text, localToday);
  if (explicitDate) {
    if (parsed.action === 'task' || parsed.action === 'delete_task') parsed.dueDate = explicitDate;
    else parsed.date = explicitDate;
  }
  applyExplicitTimes(parsed, text);
  return parsed;
}

function applyExplicitTimes(parsed, text) {
  const times = parseJapaneseTimes(text);
  if (!times.length) return;

  if (parsed.action === 'task' || parsed.action === 'delete_task') {
    parsed.dueTime = times[0];
    return;
  }

  if (['event', 'schedule', 'delete_event'].includes(parsed.action)) {
    parsed.startTime = times[0];
    if (times[1]) parsed.endTime = times[1];
  }
}

function addDaysToDateString(dateString, days) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function resolveRelativeDate(text, localToday) {
  const value = String(text || '');
  if (value.includes('明後日')) return addDaysToDateString(localToday, 2);
  if (value.includes('明日')) return addDaysToDateString(localToday, 1);
  if (value.includes('今日') || value.includes('本日')) return localToday;
  return null;
}

export async function generateTaskSchedule(payload) {
  const result = await callAPI(
    QUALITY_MODEL,
    [
      'You schedule tasks inside a planner app. Return JSON only.',
      'Output exactly this schema: {"scheduleItems":[{"taskId":"...","title":"...","date":"YYYY-MM-DD","startTime":"HH:MM","endTime":"HH:MM","note":"..."}]}.',
      'Respect activeHours, planningPeriod, todayEarliestStart, dailyBreaks, calendarEvents, existingMySchedule, and task dueDate.',
      'Every block must have endTime later than startTime. Generated blocks must not overlap one another or any supplied break, event, or existing schedule item.',
      'Keep each task on or before its dueDate. Use effectiveMinutes as the total target duration for that task; do not exceed it. Split only when needed and keep split blocks in chronological order.',
      'Use only exact taskId and title values from the provided tasks array. Never fabricate a task, free slot, date, or time. If nothing can fit, return {"scheduleItems":[]}.',
      'Do not return Markdown, prose, comments, or keys outside the schema.',
    ].join(' '),
    JSON.stringify(payload),
    2200,
    'json',
    'task_schedule'
  );
  const parsed = tryParseJSON(result);
  if (Array.isArray(parsed)) return { scheduleItems: parsed };
  if (parsed?.scheduleItems || parsed?.mySchedule || parsed?.blocks || parsed?.plan || parsed?.items) return parsed;
  throw new Error('AIがタスクの割り振り結果を作れませんでした。対象期間や活動時間を広げてもう一度お試しください。');
}
