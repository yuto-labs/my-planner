// ============================================================
// ai.js - AI client layer
// Preferred path: same-origin server API (Gemini on Vercel)
// Legacy fallback: browser-direct Anthropic when an old local key exists
// ============================================================

import {
  getApiKey, getAiCache, setAiCache, getAiRuntime, saveAiRuntime,
  getPendingAIQueue, removeFromPendingAIQueue,
  getKnowledgeMemoById, updateKnowledgeMemo,
} from './storage.js';
import { today } from './utils.js';

const SERVER_STATUS_URL = '/api/ai/status';
const SERVER_GENERATE_URL = '/api/ai/generate';

const LEGACY_API_URL = 'https://api.anthropic.com/v1/messages';
const HAIKU = 'claude-haiku-4-5';
const SONNET = 'claude-sonnet-4-6';

export async function refreshAiRuntimeStatus({ force = false } = {}) {
  const current = getAiRuntime();
  if (!force && current.checkedAt && (Date.now() - current.checkedAt) < 10 * 60 * 1000) {
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
      checkedAt: Date.now(),
      message: 'server_unavailable',
    };
    saveAiRuntime(next);
    return next;
  }
}

async function callServerAI(modelPreference, systemText, userText, maxTokens, responseFormat = 'text') {
  const res = await fetch(SERVER_GENERATE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      modelPreference,
      systemText,
      userText,
      maxTokens,
      responseFormat,
    }),
  });

  if (!res.ok) {
    let msg = `AI Error ${res.status}`;
    try {
      const data = await res.json();
      msg = data.error || msg;
    } catch {}
    throw new Error(msg);
  }

  const data = await res.json();
  return data.text ?? '';
}

async function callLegacyAnthropic(model, systemText, userText, maxTokens) {
  const key = getApiKey();
  if (!key) throw new Error('AI is not configured.');

  const res = await fetch(LEGACY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userText }],
    }),
  });

  if (!res.ok) {
    let msg = `AI Error ${res.status}`;
    try {
      const data = await res.json();
      msg = data.error?.message || msg;
    } catch {}
    throw new Error(msg);
  }

  const data = await res.json();
  return data.content?.[0]?.text ?? '';
}

async function callAPI(modelPreference, systemText, userText, maxTokens, responseFormat = 'text') {
  const runtime = getAiRuntime();
  const legacyKey = getApiKey();
  const shouldTryServer = runtime.configured || !legacyKey;

  let serverError = null;
  if (shouldTryServer) {
    try {
      return await callServerAI(modelPreference, systemText, userText, maxTokens, responseFormat);
    } catch (err) {
      serverError = err;
    }
  }

  if (legacyKey) {
    return callLegacyAnthropic(modelPreference, systemText, userText, maxTokens);
  }

  throw serverError || new Error('AI is not available.');
}

export async function streamText({ model = HAIKU, system, userContent, maxTokens = 200, onChunk }) {
  const full = await callAPI(model, system || '', userContent, maxTokens, 'text');
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
    model: HAIKU,
    system: '日本語のみ。50文字以内。前置きなし。絵文字は1個まで。',
    userContent: `要約: ${ctx}`,
    maxTokens: 120,
    onChunk,
  });
}

function tryParseJSON(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  try { return JSON.parse(cleaned); } catch { return null; }
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
    HAIKU,
    'Return JSON only: {"message":"50文字以内","focus":"60文字以内"}',
    ctx,
    160,
    'json'
  );

  const parsed = tryParseJSON(result) || {
    message: '今日は優先度の高いことから順に進めましょう。',
    focus: '最優先のタスクに集中',
  };
  setAiCache(cacheKey, parsed, 86_400_000);
  return parsed;
}

export async function parseNaturalLanguageEvent(text, categories = []) {
  const cacheKey = `nlparse_${text}`;
  const cached = getAiCache(cacheKey);
  if (cached) return cached;

  const now = new Date();
  const nowStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const catNames = categories.map(c => c.name).join(',');

  const result = await callAPI(
    HAIKU,
    `Extract event info. Current datetime: ${nowStr}. Categories: ${catNames}. Return JSON only: {"title":"...","start":"YYYY-MM-DDTHH:mm:00","end":"YYYY-MM-DDTHH:mm:00","categoryName":"...","isTentative":false}`,
    text,
    200,
    'json'
  );

  const parsed = tryParseJSON(result);
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
    HAIKU,
    'Analyze focus logs. Return JSON only: {"insight":"80文字以内","peakTime":"例 10-12時","recommendation":"60文字以内"}',
    summary,
    200,
    'json'
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
    HAIKU,
    'Write 3 concise Japanese insights with numbers. Return JSON only: {"insights":["...","...","..."],"advice":"80文字以内"}',
    `n=${valid.length} exercise_r=${exCorr} sleep_r=${slCorr} exercise_focus=${exFocus} no_exercise_focus=${noExFocus}`,
    300,
    'json'
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
    SONNET,
    'Generate a Japanese monthly review. Return JSON only: {"title":"...","highlights":["...","...","..."],"achievements":"80文字以内","learning":"80文字以内","advice":"100文字以内","score":0}',
    `month:${prevMonth} tasks:${data.tasksCompleted}/${data.tasksTotal} goals:${data.goalsCount} memos:${data.knowledgeMemos} focus:${data.avgFocus || 'n/a'} habitDays:${data.habitDays}`,
    600,
    'json'
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
    HAIKU,
    '日本語のみ。3段落以内。数字を含む読みやすい月次サマリーを返してください。',
    `month:${monthStr} ${JSON.stringify(data)}`,
    250,
    'text'
  );
  return text.trim();
}

export async function suggestKnowledgeTags(title, textPreview) {
  const cacheKey = `kn_tags_${title}_${textPreview.slice(0, 60)}`;
  const cached = getAiCache(cacheKey);
  if (cached) return cached;

  const result = await callAPI(
    HAIKU,
    'Suggest up to 5 Japanese academic/topic tags. Return JSON only: {"tags":["t1","t2","t3"]}',
    `title:${title}\n${textPreview.slice(0, 300)}`,
    120,
    'json'
  );

  const parsed = tryParseJSON(result);
  const tags = Array.isArray(parsed?.tags) ? parsed.tags.slice(0, 5) : [];
  if (tags.length) setAiCache(cacheKey, tags, 86_400_000);
  return tags;
}

export async function explainTerm(term, context = '') {
  const result = await callAPI(
    HAIKU,
    'Explain the term in Japanese in 80-150 chars. Plain text only.',
    `term:${term}\ncontext:${context.slice(0, 200)}`,
    200,
    'text'
  );
  return result.trim();
}

export async function formatKnowledgeMemo(rawText, existingMemosCtx = '') {
  const system = [
    'Turn rough notes into a useful Japanese knowledge memo. Return JSON only.',
    'Schema: {"title":"short Japanese title","blocks":[{"type":"h2","text":"heading"},{"type":"paragraph","text":"body"},{"type":"bullet","text":"point"}],"tags":["tag1","tag2"]}.',
    'Use only block types paragraph, h1, h2, h3, bullet, numbered, quote, toggle, math, divider.',
    'Do not invent facts. Preserve important details. Make the memo readable even from messy input.',
  ].join(' ');
  const user = 'Text to organize:\n' + rawText.slice(0, 1800)
    + (existingMemosCtx ? '\n\nExisting memo context:\n' + existingMemosCtx : '');

  const raw = await callAPI(HAIKU, system, user, 1400, 'json');
  const parsed = tryParseJSON(raw);
  if (!parsed?.blocks) throw new Error('AI memo format failed');
  return {
    title: parsed.title || '',
    blocks: Array.isArray(parsed.blocks) ? parsed.blocks : [],
    tags: Array.isArray(parsed.tags) ? parsed.tags : [],
  };
}

export async function summarizeAndTagText(text) {
  const result = await callAPI(
    HAIKU,
    'Summarize in Japanese and suggest tags. Return JSON only: {"summary":"150文字以内","tags":["t1","t2"]}',
    text.slice(0, 2000),
    250,
    'json'
  );
  return tryParseJSON(result) || { summary: '', tags: [] };
}

export async function detectKnowledgeGaps(goalTitle, existingTags) {
  const cacheKey = `kngap_${goalTitle}_${[...existingTags].sort().join(',')}`;
  const cached = getAiCache(cacheKey);
  if (cached) return cached;

  const result = await callAPI(
    HAIKU,
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
    HAIKU,
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
    SONNET,
    'Break down the goal into actionable tasks. Return JSON only: {"tasks":[{"title":"...","weight":"large|medium|small","dueDate":"YYYY-MM-DD","description":"..."},{"title":"...","weight":"medium","dueDate":"YYYY-MM-DD","description":"..."}],"advice":"100文字以内"}',
    `goal:${goal.title} type:${typeLabel} due:${goal.targetDate || 'none'} desc:${goal.description?.slice(0, 100) || 'none'} today:${today()}`,
    1200,
    'json'
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
          HAIKU,
          'For each memo, suggest up to 4 Japanese tags. Return JSON only: [{"id":"...","tags":["t1","t2"]}]',
          JSON.stringify(batch),
          Math.min(200 * batch.length, 1500),
          'json'
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
  const now = new Date().toISOString();
  const result = await callAPI(
    SONNET,
    [
      'You are the command brain for a planner app. Decide what the user wants and return JSON only.',
      'Schema: {"action":"task|event|schedule|memo|database","title":"...","date":"YYYY-MM-DD|null","startTime":"HH:MM|null","endTime":"HH:MM|null","dueDate":"YYYY-MM-DD|null","dueTime":"HH:MM|null","weight":"large|medium|small","estimatedMinutes":number|null,"tags":["..."],"memo":"...","blocks":[{"type":"paragraph|h2|bullet","text":"..."}],"fields":["..."],"rows":[{"...":"..."}],"message":"..."}.',
      'Use task for todos, event for calendar appointments, schedule for time blocks, memo for notes, database for table-like collections or when the user asks to create a database.',
      'Dates and times must be concrete when inferable. Never return prose outside JSON.',
    ].join(' '),
    JSON.stringify({ now, text, context }),
    900,
    'json'
  );
  const parsed = tryParseJSON(result);
  if (!parsed?.action) throw new Error('AI response was empty');
  return parsed;
}

export async function generateTaskSchedule(payload) {
  const result = await callAPI(
    SONNET,
    [
      'You schedule tasks inside a planner app. Return JSON only.',
      'Output schema: {"scheduleItems":[{"taskId":"...","title":"...","date":"YYYY-MM-DD","startTime":"HH:MM","endTime":"HH:MM","note":"..."}]}',
      'Respect activeHours, planningPeriod, todayEarliestStart, dailyBreaks, calendarEvents, existingMySchedule, and task dueDate.',
      'Do not overlap blocks. Use task effectiveMinutes as closely as possible. Split only when needed.',
    ].join(' '),
    JSON.stringify(payload),
    2200,
    'json'
  );
  const parsed = tryParseJSON(result);
  if (!parsed?.scheduleItems && !Array.isArray(parsed?.blocks)) throw new Error('AI response was empty');
  return parsed;
}
