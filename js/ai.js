// ============================================================
// ai.js - AI client layer
// Same-origin server API (Gemini on Vercel)
// ============================================================

import {
  getAiCache, setAiCache, getAiRuntime, saveAiRuntime,
  getPendingAIQueue, removeFromPendingAIQueue,
  getKnowledgeMemoById, updateKnowledgeMemo,
} from './storage.js';
import { getSession } from './supabase.js';
import { parseJapaneseTimes, today } from './utils.js';

const SERVER_STATUS_URL = '/api/ai/status';
const SERVER_GENERATE_URL = '/api/ai/generate';
const AI_REQUEST_TIMEOUT_MS = 50_000;

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
      configured: !!data.configured,
      models: data.models || null,
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
  const session = await getSession();
  const token = session?.access_token || '';
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
  if (status === 503) return 'AIサーバーを利用できません。通信状態を確認してもう一度お試しください。';
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
  const user = 'Text to organize:\n' + rawText.slice(0, 1800)
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
  };
}

export async function generateNuanceEntries(
  { language = 'English', category = '', topic = '', seedTerms = [] } = {},
  options = {}
) {
  const cleanCategory = String(category || '').trim();
  const cleanTopic = String(topic || '').trim();
  const terms = (Array.isArray(seedTerms) ? seedTerms : String(seedTerms || '').split(/[\n,、]/))
    .map(term => String(term || '').trim())
    .filter(Boolean)
    .slice(0, 12);
  if (!cleanCategory || !cleanTopic) {
    throw new Error('カテゴリとテーマを入力してください。');
  }

  const system = [
    'You are a careful bilingual lexicographer for Japanese learners.',
    'Return JSON only and follow the response schema.',
    'Create 5 to 8 genuinely useful expressions for the requested semantic topic, unless seed terms are supplied; always include every supplied seed term.',
    'Explain all meanings, nuance, register, emotional tone, grammar cautions, and differences in clear Japanese.',
    'Examples must be natural sentences in the target language with faithful Japanese translations.',
    'Do not treat different parts of speech as interchangeable. Explicitly explain grammatical differences such as adjective versus noun.',
    'Avoid generic statements such as "context matters". State what situation, relationship, intensity, or attitude makes each expression natural.',
    'Keep comparisons concrete and compare only expressions in the returned set when possible.',
    'Do not invent etymology, quotations, statistics, or citations. This is a usage guide, not a factual research report.',
  ].join(' ');
  const user = JSON.stringify({
    language: String(language || 'English').trim() || 'English',
    category: cleanCategory,
    topic: cleanTopic,
    seedTerms: terms,
    requestedEntryCount: terms.length ? Math.max(terms.length, 5) : 6,
  });

  const raw = await callAPI(
    QUALITY_MODEL,
    system,
    user,
    5200,
    'json',
    'nuance_generate',
    options
  );
  const parsed = tryParseJSON(raw);
  const sourceEntries = Array.isArray(parsed?.entries) ? parsed.entries : [];
  const unique = new Set();
  const entries = sourceEntries
    .map(entry => {
      const term = String(entry?.term || '').trim();
      const key = term.toLocaleLowerCase();
      if (!term || unique.has(key)) return null;
      unique.add(key);
      return {
        promptVersion: 1,
        language: String(language || 'English').trim() || 'English',
        category: cleanCategory,
        topic: cleanTopic,
        term,
        partOfSpeech: String(entry.partOfSpeech || '').trim(),
        coreMeaningJa: String(entry.coreMeaningJa || '').trim(),
        nuanceJa: String(entry.nuanceJa || '').trim(),
        register: String(entry.register || '').trim(),
        intensity: String(entry.intensity || '').trim(),
        emotionalToneJa: String(entry.emotionalToneJa || '').trim(),
        useCasesJa: normalizeStringList(entry.useCasesJa, 6),
        collocations: normalizeStringList(entry.collocations, 8),
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
          .slice(0, 6),
        cautionsJa: normalizeStringList(entry.cautionsJa, 6),
        personalNote: '',
      };
    })
    .filter(Boolean)
    .slice(0, 12);

  if (!entries.length) {
    throw new Error('表現データを作成できませんでした。入力を少し具体的にして、もう一度試してください。');
  }
  return entries;
}

function normalizeStringList(value, maxItems) {
  return (Array.isArray(value) ? value : [])
    .map(item => String(item || '').trim())
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
  if (!parsed?.action) throw new Error('AIが操作内容を判断できませんでした。予定名・日付・時刻をもう少し具体的に入力してください。');
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
