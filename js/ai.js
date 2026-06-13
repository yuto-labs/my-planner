// ============================================================
// ai.js — Anthropic API client (browser-direct)
// Prompt design rules:
//   • No preamble — start with the instruction directly
//   • Always request JSON or bullet structured output
//   • Send only summaries + recent diffs, not full data
//   • Explicit max_tokens per function
//   • Simple ops always use Haiku; quality-sensitive ops use Sonnet
// ============================================================

import {
  getApiKey, getAiCache, setAiCache,
  getPendingAIQueue, removeFromPendingAIQueue,
  getKnowledgeMemoById, updateKnowledgeMemo,
} from './storage.js';
import { today } from './utils.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const HAIKU  = 'claude-haiku-4-5';
const SONNET = 'claude-sonnet-4-6';

// ---- Low-level API call ----

async function callAPI(model, systemText, userText, maxTokens) {
  const key = getApiKey();
  if (!key) throw new Error('APIキーが設定されていません。設定画面で入力してください。');

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'x-api-key':     key,
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
    let msg = `API Error ${res.status}`;
    try { const j = await res.json(); msg = j.error?.message || msg; } catch {}
    throw new Error(msg);
  }

  const data = await res.json();
  return data.content?.[0]?.text ?? '';
}

// ============================================================
// STREAMING API
// ============================================================

/**
 * Generic text streaming over Anthropic SSE.
 * onChunk(deltaText, fullText) is called for every token.
 * Returns the full accumulated text when done.
 */
export async function streamText({ model = HAIKU, system, userContent, maxTokens = 200, onChunk }) {
  const key = getApiKey();
  if (!key) throw new Error('APIキーが設定されていません');

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key':    key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      stream: true,
      system: system ? [{ type: 'text', text: system }] : undefined,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!res.ok) {
    let msg = `API Error ${res.status}`;
    try { const j = await res.json(); msg = j.error?.message || msg; } catch {}
    throw new Error(msg);
  }

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  let buf  = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    // Process complete SSE lines
    const lines = buf.split('\n');
    buf = lines.pop() ?? ''; // keep last incomplete line

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') continue;
      try {
        const ev = JSON.parse(raw);
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
          full += ev.delta.text;
          onChunk?.(ev.delta.text, full);
        }
      } catch { /* incomplete JSON fragment — ignore */ }
    }
  }
  return full;
}

/**
 * Stream today's AI message directly, calling onChunk per token.
 * Does NOT use cache — meant for live streaming display.
 */
export async function streamDailyMessage(tasks = [], events = [], goals = [], onChunk) {
  const todayStr = today();
  const pending     = tasks.filter(t => !t.completed).slice(0, 6);
  const todayEvents = events.filter(e => e.start?.slice(0, 10) === todayStr).slice(0, 4);
  const topGoal     = goals[0]?.title || '';

  const ctx = `残タスク:${pending.map(t => t.title.slice(0,10)).join(',') || 'なし'} | `
            + `今日の予定:${todayEvents.map(e => e.title.slice(0,10)).join(',') || 'なし'} | `
            + `目標:${topGoal.slice(0,20) || 'なし'}`;

  return streamText({
    model: HAIKU,
    system: '日本語のみ。50文字以内。前置き・挨拶なし。ポジティブで具体的な一言。絵文字1個まで可。',
    userContent: `状況:${ctx} → 今日への一言メッセージ`,
    maxTokens: 120,
    onChunk,
  });
}

// ---- Parse JSON response safely ----

function tryParseJSON(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  try { return JSON.parse(cleaned); } catch { return null; }
}

// ============================================================
// PUBLIC API — DAILY / PLANNING
// ============================================================

/**
 * Today's AI greeting + focus point. Cached all day (date-keyed).
 */
export async function getDailyMessage(tasks = [], events = [], goals = []) {
  const cacheKey = `daily_${today()}`;
  const cached = getAiCache(cacheKey);
  if (cached) return cached;

  const todayStr = today();
  // Send only what's needed: pending count, today's events (title+time), top goal
  const pending     = tasks.filter(t => !t.completed).slice(0, 6);
  const todayEvents = events.filter(e => e.start?.slice(0, 10) === todayStr).slice(0, 4);
  const topGoal     = goals[0]?.title || '';

  const ctx = `タスク:${pending.map(t => `${t.title}[${t.weight[0]}]`).join(',') || 'なし'} | `
            + `予定:${todayEvents.map(e => `${e.title}@${e.start?.slice(11,16)}`).join(',') || 'なし'} | `
            + `目標:${topGoal || 'なし'}`;

  const result = await callAPI(
    HAIKU,
    `Output ONLY JSON matching this schema — no other text:
{"message":"<励まし50文字以内>","focus":"<今日最優先40文字以内>"}`,
    ctx,
    160
  );

  const parsed = tryParseJSON(result) || {
    message: '今日も一歩ずつ着実に前進しましょう！',
    focus:   '最優先タスクに集中',
  };
  setAiCache(cacheKey, parsed, 86_400_000); // 24h — same-day cache
  return parsed;
}

/**
 * Parse natural language → event object. Cached by input text (1h).
 */
export async function parseNaturalLanguageEvent(text, categories = []) {
  const cacheKey = `nlparse_${text}`;
  const cached = getAiCache(cacheKey);
  if (cached) return cached;

  const now    = new Date();
  const nowStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const catNames = categories.map(c => c.name).join(',');

  const result = await callAPI(
    HAIKU,
    `Extract event info from Japanese text. Current datetime: ${nowStr}. Categories: ${catNames}.
Output ONLY JSON — no other text:
{"title":"...","start":"YYYY-MM-DDTHH:mm:00","end":"YYYY-MM-DDTHH:mm:00","categoryName":"...","isTentative":false}
If end time missing, add 1 hour. Infer date from context words like 明日/今日/来週.`,
    text,
    200
  );

  const parsed = tryParseJSON(result);
  if (parsed) setAiCache(cacheKey, parsed, 3_600_000); // 1h
  return parsed;
}

// ============================================================
// ANALYTICS — ENERGY / HABITS / REPORTS
// ============================================================

/**
 * Energy pattern analysis from focus logs. Cached daily.
 */
export async function analyzeEnergyPatterns(focusLogs) {
  const cacheKey = `energy_${today()}`;
  const cached = getAiCache(cacheKey);
  if (cached) return cached;

  // Compact log: "10時火高,14時月中,..." — only hour/day/level
  const summary = focusLogs
    .slice(-60) // cap at 60 entries
    .map(l => `${l.hour}h${['日','月','火','水','木','金','土'][l.dayOfWeek]}${l.focusLevel[0]}`)
    .join(',');

  const result = await callAPI(
    HAIKU,
    `Analyze focus logs (h=hour, day abbr, 高=high/中=medium/低=low). Find patterns.
Output ONLY JSON:
{"insight":"<発見60文字>","peakTime":"<例:午前10-12時>","recommendation":"<アドバイス60文字>"}`,
    summary,
    200
  );

  const parsed = tryParseJSON(result) || {
    insight: '集中度のパターンを分析しました',
    peakTime: '記録を続けると表示されます',
    recommendation: '継続して記録しましょう',
  };
  setAiCache(cacheKey, parsed, 86_400_000);
  return parsed;
}

/**
 * Local-only goal completion prediction. No API call.
 */
export function predictGoalCompletionLocal(goal, allTasks) {
  const goalTasks = allTasks.filter(t => t.goalId === goal.id);
  const done      = goalTasks.filter(t => t.completed);
  const remaining = goalTasks.filter(t => !t.completed);

  if (!goalTasks.length)  return { status: 'no_tasks', label: null };
  if (!remaining.length)  return { status: 'done', label: '✅ 全タスク完了' };
  if (!done.length)       return { status: 'no_rate', label: null };

  // Tasks completed per day over last 14 days
  const cutoff     = Date.now() - 14 * 86_400_000;
  const recentDone = done.filter(t => new Date(t.updatedAt || t.createdAt).getTime() > cutoff);
  if (!recentDone.length) return { status: 'no_rate', label: null };

  const rate       = recentDone.length / 14;
  const daysNeeded = remaining.length / rate;
  const predicted  = new Date(Date.now() + daysNeeded * 86_400_000);
  const label      = `${predicted.getFullYear()}年${predicted.getMonth()+1}月${predicted.getDate()}日`;

  const targetDate = goal.targetDate ? new Date(goal.targetDate) : null;
  const daysLate   = targetDate ? Math.ceil((predicted - targetDate) / 86_400_000) : 0;

  if (daysLate > 3)  return { status: 'late',     label, predictedDateStr: label, daysLate };
  if (daysLate < -3) return { status: 'early',    label, predictedDateStr: label, daysLate };
  return               { status: 'on_track', label, predictedDateStr: label, daysLate: 0 };
}

/**
 * Habit correlation analysis. Cached daily.
 */
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
    `Given habit-focus correlation data, write 3 concrete Japanese insights with numbers.
Output ONLY JSON:
{"insights":["<気づき1>","<気づき2>","<気づき3>"],"advice":"<総合アドバイス80文字>"}`,
    `n=${valid.length}日 運動r=${exCorr} 睡眠r=${slCorr} 運動後集中=${exFocus} 運動なし=${noExFocus}`,
    300
  );

  const parsed = tryParseJSON(result) || { insights: ['データが蓄積されました'], advice: '' };
  setAiCache(cacheKey, parsed, 86_400_000);
  return parsed;
}

function pearsonR(xs, ys) {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx  += (xs[i] - mx) ** 2;
    dy  += (ys[i] - my) ** 2;
  }
  return Math.sqrt(dx * dy) < 1e-10 ? 0 : num / Math.sqrt(dx * dy);
}

function avg(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

/**
 * Monthly report — Sonnet for quality. Not cached (user-triggered).
 */
export async function generateMonthlyReport(prevMonth, data) {
  const result = await callAPI(
    SONNET,
    `Generate a Japanese monthly review. Use numbers. Be encouraging but direct.
Output ONLY JSON:
{"title":"<○月の振り返り>","highlights":["<h1>","<h2>","<h3>"],"achievements":"<達成80文字>","learning":"<学習80文字>","advice":"<来月アドバイス100文字>","score":<0-100>}`,
    `month:${prevMonth} tasks:${data.tasksCompleted}/${data.tasksTotal} goals:${data.goalsCount} memos:${data.knowledgeMemos} focus:${data.avgFocus || 'n/a'} habitDays:${data.habitDays}`,
    600
  );
  return tryParseJSON(result) || {
    title: `${prevMonth}の振り返り`,
    highlights: ['データを分析しました'],
    achievements: '', learning: '',
    advice: '継続しましょう！',
    score: 70,
  };
}

/**
 * Analytics monthly summary — Haiku, once per month, cached externally by caller.
 */
export async function generateAnalyticsSummary(monthStr, data) {
  const text = await callAPI(
    HAIKU,
    '日本語のみ。ユーザーの月次アナリティクスデータをもとに3〜4行の簡潔なサマリーを生成。具体的な数値や変化（例:先月比+15%）を含める。前置き・見出し一切不要。本文のみ。',
    `対象月:${monthStr} ${JSON.stringify(data)}`,
    250
  );
  return text.trim();
}

// ============================================================
// KNOWLEDGE — TAGS / EXPLAIN / SUMMARIZE / GAPS
// ============================================================

/**
 * Suggest tags for a memo. Cached 24h.
 */
export async function suggestKnowledgeTags(title, textPreview) {
  const cacheKey = `kn_tags_${title}_${textPreview.slice(0, 60)}`;
  const cached = getAiCache(cacheKey);
  if (cached) return cached;

  const result = await callAPI(
    HAIKU,
    `Suggest up to 5 Japanese tags (2-8 chars) for a study memo. Academic/topic categories only.
Output ONLY JSON: {"tags":["<t1>","<t2>","<t3>"]}`,
    `title:${title}\n${textPreview.slice(0, 300)}`,
    120
  );

  const parsed = tryParseJSON(result);
  const tags = Array.isArray(parsed?.tags) ? parsed.tags.slice(0, 5) : [];
  if (tags.length) setAiCache(cacheKey, tags, 86_400_000);
  return tags;
}

/**
 * Explain a term inline. Caller manages cache via getTermExplanation/setTermExplanation.
 */
export async function explainTerm(term, context = '') {
  const result = await callAPI(
    HAIKU,
    `Explain the term in Japanese in 80-150 chars. Include a concrete example if helpful.
Output plain text only — no JSON, no preamble.`,
    `term:${term}\ncontext:${context.slice(0, 200)}`,
    200
  );
  return result.trim();
}

/**
 * Format raw notes into structured knowledge memo blocks (Haiku — cost-efficient).
 * Returns { title, blocks: [{type, text}], tags }
 */
export async function formatKnowledgeMemo(rawText, existingMemosCtx = '') {
  const system = `ノート整理アシスタント。入力を以下のJSON形式に整形。JSONのみ返答、前置き・説明一切不要。
{"title":"20字以内のタイトル","blocks":[{"type":"h2","text":"見出し"},{"type":"paragraph","text":"本文 **太字** *斜体* 可"},{"type":"bullet","text":"箇条書き"}],"tags":["タグ1","タグ2","タグ3"]}
ルール: h2大見出し・h3小見出し・重要部分は**太字**・リスト化できる内容はbulletに・タグ3〜5個(日本語)`;

  const user = `整形対象テキスト:\n${rawText.slice(0, 1800)}${existingMemosCtx ? `\n\n【既存メモのタグ(参考)】\n${existingMemosCtx}` : ''}`;

  const raw    = await callAPI(HAIKU, system, user, 1400);
  const parsed = tryParseJSON(raw);
  if (!parsed?.blocks) throw new Error('AI応答の解析に失敗しました');
  return {
    title:  parsed.title || '',
    blocks: Array.isArray(parsed.blocks) ? parsed.blocks : [],
    tags:   Array.isArray(parsed.tags)   ? parsed.tags   : [],
  };
}

/**
 * Summarize pasted text + suggest tags. No cache (content always different).
 */
export async function summarizeAndTagText(text) {
  const result = await callAPI(
    HAIKU,
    `Summarize text in Japanese (150文字以内) and suggest up to 4 tags (2-8 chars each).
Output ONLY JSON: {"summary":"<要約>","tags":["<t1>","<t2>"]}`,
    text.slice(0, 2000),
    250
  );
  return tryParseJSON(result) || { summary: '', tags: [] };
}

/**
 * Detect knowledge gaps for a goal. Cached 12h.
 */
export async function detectKnowledgeGaps(goalTitle, existingTags) {
  const cacheKey = `kngap_${goalTitle}_${[...existingTags].sort().join(',')}`;
  const cached = getAiCache(cacheKey);
  if (cached) return cached;

  const result = await callAPI(
    HAIKU,
    `List 3-5 specific study topics needed for the goal that are NOT in existing tags.
Output ONLY JSON: {"gaps":["<topic1>","<topic2>","<topic3>"]}`,
    `goal:${goalTitle}\nhave:${existingTags.join(',') || 'none'}`,
    150
  );

  const parsed = tryParseJSON(result);
  const gaps = Array.isArray(parsed?.gaps) ? parsed.gaps.slice(0, 5) : [];
  if (gaps.length) setAiCache(cacheKey, gaps, 43_200_000); // 12h
  return gaps;
}

/**
 * Suggest unstudied topics for a goal. Cached 6h.
 */
export async function suggestUnstudiedTopics(goalTitle, knowledgeTags) {
  const cacheKey = `unstudied_${goalTitle}_${[...knowledgeTags].sort().join(',')}`;
  const cached = getAiCache(cacheKey);
  if (cached) return cached;

  const result = await callAPI(
    HAIKU,
    `List 3-5 study topics for the goal not covered by existing tags.
Output ONLY JSON: {"topics":["<t1>","<t2>","<t3>"]}`,
    `goal:${goalTitle}\nhave:${knowledgeTags.join(',') || 'none'}`,
    150
  );

  const parsed = tryParseJSON(result);
  const topics = Array.isArray(parsed?.topics) ? parsed.topics.slice(0, 5) : [];
  if (topics.length) setAiCache(cacheKey, topics, 21_600_000); // 6h
  return topics;
}

/**
 * Goal → task decomposition. Cached 6h per goal version.
 */
export async function splitGoalToTasks(goal) {
  const cacheKey = `goalsplit_${goal.id}_v3`;
  const cached = getAiCache(cacheKey);
  if (cached) return cached;

  const typeLabel = goal.type === 'monthly' ? '月次' : goal.type === 'weekly' ? '週次' : '日次';

  const result = await callAPI(
    SONNET,
    `Break down the goal into specific, actionable tasks with realistic dates.
Output ONLY JSON:
{"tasks":[{"title":"<具体的なタスク>","weight":"large|medium|small","dueDate":"YYYY-MM-DD","description":"<任意>"}],"advice":"<アドバイス100文字>"}`,
    `goal:${goal.title} type:${typeLabel} due:${goal.targetDate || 'none'} desc:${goal.description?.slice(0, 100) || 'none'} today:${today()}`,
    1200
  );

  const parsed = tryParseJSON(result);
  if (parsed) setAiCache(cacheKey, parsed, 21_600_000); // 6h
  return parsed;
}

// ============================================================
// BATCH PROCESSING
// ============================================================

/**
 * Process all pending AI queue items in a single batch API call.
 * Called automatically at batch time or when reconnecting.
 * @param {(done:number, total:number)=>void} [onProgress]
 * @returns {{ processed: number, total: number }}
 */
export async function processBatchQueue(onProgress) {
  const queue = getPendingAIQueue();
  if (!queue.length) return { processed: 0, total: 0 };

  const memoItems = queue.filter(q => q.type === 'memo_tags');
  let processed = 0;

  if (memoItems.length) {
    // Resolve memo data
    const batch = memoItems.map(item => {
      const memo = getKnowledgeMemoById(item.id);
      if (!memo) return null;
      const preview = (memo.blocks || [])
        .map(b => b.content || '').join(' ').slice(0, 150);
      return { id: item.id, title: memo.title || '無題', preview };
    }).filter(Boolean);

    if (batch.length) {
      try {
        const result = await callAPI(
          HAIKU,
          `For each memo, suggest up to 4 Japanese tags (2-8 chars, academic/topic categories).
Output ONLY JSON array: [{"id":"...","tags":["t1","t2"]}]`,
          JSON.stringify(batch),
          Math.min(200 * batch.length, 1500)
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
        // Don't remove from queue — retry next time
      }
    }
  }

  // Handle any remaining item types (future extension point)
  return { processed, total: queue.length };
}
