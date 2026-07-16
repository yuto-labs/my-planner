function readBody(req) {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body || {};
}

function pickModel(pref) {
  const fastModel = process.env.GEMINI_MODEL_FAST || 'gemini-3.5-flash';
  const qualityModel = process.env.GEMINI_MODEL_QUALITY || fastModel;
  const raw = String(pref || '').toLowerCase();
  if (raw.includes('sonnet') || raw === 'quality') return qualityModel;
  return fastModel;
}

function pickThinkingConfig(model, actionType) {
  const complexActions = new Set([
    'analytics_summary',
    'batch_tags',
    'goal_split',
    'memo_format',
    'memo_summary',
    'monthly_report',
    'planner_action',
    'task_schedule',
  ]);
  const isComplex = complexActions.has(String(actionType || ''));
  if (String(model).startsWith('gemini-2.5-')) {
    return { thinkingBudget: isComplex ? 2048 : 512 };
  }
  return { thinkingLevel: isComplex ? 'medium' : 'low' };
}

function nullableString(description) {
  return { type: 'STRING', nullable: true, description };
}

function stringArray(description) {
  return { type: 'ARRAY', description, items: { type: 'STRING' } };
}

function getTaskIdsFromPrompt(userText) {
  try {
    const payload = JSON.parse(String(userText || ''));
    return Array.isArray(payload?.tasks)
      ? [...new Set(payload.tasks.map(task => String(task?.id || '')).filter(Boolean))]
      : [];
  } catch {
    return [];
  }
}

function pickResponseSchema(actionType, body) {
  const action = String(actionType || '');
  if (action === 'task_schedule') {
    const taskIds = getTaskIdsFromPrompt(body.userText);
    const taskId = { type: 'STRING', description: 'An exact task id from the supplied tasks array.' };
    if (taskIds.length) taskId.enum = taskIds;
    return {
      type: 'OBJECT',
      properties: {
        scheduleItems: {
          type: 'ARRAY',
          description: 'Non-overlapping task blocks that fit all supplied constraints.',
          items: {
            type: 'OBJECT',
            properties: {
              taskId,
              title: { type: 'STRING', description: 'The supplied task title.' },
              date: { type: 'STRING', description: 'Local date in YYYY-MM-DD format.' },
              startTime: { type: 'STRING', description: 'Local start time in 24-hour HH:MM format.' },
              endTime: { type: 'STRING', description: 'Local end time in 24-hour HH:MM format.' },
              note: { type: 'STRING', description: 'A short placement reason, or an empty string.' },
            },
            required: ['taskId', 'title', 'date', 'startTime', 'endTime', 'note'],
          },
        },
      },
      required: ['scheduleItems'],
    };
  }

  if (action === 'event_parse') {
    return {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING', description: 'Event title using only supplied details.' },
        start: nullableString('Local start datetime in YYYY-MM-DDTHH:mm:00 format, or null.'),
        end: nullableString('Local end datetime in YYYY-MM-DDTHH:mm:00 format, or null.'),
        categoryName: nullableString('One exact supplied category name, or null.'),
        isTentative: { type: 'BOOLEAN', description: 'True only when the event is tentative.' },
      },
      required: ['title', 'start', 'end', 'categoryName', 'isTentative'],
    };
  }

  if (action === 'memo_format') {
    return {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING', description: 'A short Japanese title grounded in the memo.' },
        blocks: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              type: { type: 'STRING', enum: ['paragraph', 'h1', 'h2', 'h3', 'bullet', 'numbered', 'quote', 'toggle', 'math', 'divider'] },
              text: { type: 'STRING' },
            },
            required: ['type', 'text'],
          },
        },
        tags: stringArray('Up to five short Japanese topic tags grounded in the memo.'),
      },
      required: ['title', 'blocks', 'tags'],
    };
  }

  if (action === 'memo_summary') {
    return {
      type: 'OBJECT',
      properties: {
        summary: { type: 'STRING', description: 'A Japanese summary grounded only in the supplied text.' },
        tags: stringArray('Short Japanese topic tags grounded in the supplied text.'),
      },
      required: ['summary', 'tags'],
    };
  }

  if (action === 'tag_suggest') {
    return { type: 'OBJECT', properties: { tags: stringArray('Up to five short Japanese topic tags.') }, required: ['tags'] };
  }

  return null;
}

function extractText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.map(part => part?.text || '').join('').trim();
}

async function requestGemini(key, model, payload) {
  const upstream = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
  const data = await upstream.json().catch(() => ({}));
  return { upstream, data };
}

const DEFAULT_SUPABASE_URL = 'https://nhgbvlovptelaqcurobv.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5oZ2J2bG92cHRlbGFxY3Vyb2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwMTY2NzcsImV4cCI6MjA5NjU5MjY3N30.Vgsy9--B3d5FoxoHpvjC00OPPzE2WUwzP8GV2LE4-p4';
const USER_DAILY_LIMIT = Number(process.env.AI_USER_DAILY_LIMIT || 50);
const APP_DAILY_LIMIT = Number(process.env.AI_APP_DAILY_LIMIT || 500);
const APP_MINUTE_LIMIT = Number(process.env.AI_APP_MINUTE_LIMIT || 30);

const ACTION_COSTS = {
  event_parse: 1,
  planner_action: 1,
  task_split: 1,
  tag_suggest: 1,
  term_explain: 1,
  daily_message: 1,
  memo_summary: 3,
  memo_format: 3,
  analytics_summary: 3,
  energy_patterns: 3,
  monthly_report: 5,
  goal_split: 5,
  task_schedule: 5,
  batch_tags: 5,
};

function todayJstStr() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function withUsageDate(usage) {
  return usage ? { ...usage, usageDate: usage.usageDate || todayJstStr() } : null;
}

function getBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match?.[1] || '';
}

function getSupabaseConfig() {
  return {
    url: process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY,
  };
}

function pickCost(body) {
  const action = String(body.actionType || '').trim();
  if (ACTION_COSTS[action]) return ACTION_COSTS[action];
  const maxTokens = Number(body.maxTokens || 300);
  if (maxTokens > 1000) return 5;
  if (maxTokens > 350) return 3;
  return 1;
}

async function requireAuthenticatedUser(token) {
  const cfg = getSupabaseConfig();
  if (!token) throw Object.assign(new Error('AIを使うにはログインしてください。'), { status: 401 });

  const response = await fetch(`${cfg.url}/auth/v1/user`, {
    headers: {
      apikey: cfg.anonKey,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw Object.assign(new Error('ログイン状態を確認できませんでした。もう一度ログインしてください。'), { status: 401 });
  }

  return response.json();
}

async function claimUsage(token, body) {
  const cfg = getSupabaseConfig();
  const cost = pickCost(body);
  const actionType = String(body.actionType || 'ai_request').slice(0, 60);

  const response = await fetch(`${cfg.url}/rest/v1/rpc/claim_ai_usage`, {
    method: 'POST',
    headers: {
      apikey: cfg.anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_cost: cost,
      p_action_type: actionType,
      p_user_daily_limit: USER_DAILY_LIMIT,
      p_app_daily_limit: APP_DAILY_LIMIT,
      p_minute_limit: APP_MINUTE_LIMIT,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg = data?.message || data?.error || 'AI使用量の確認に失敗しました。SupabaseのAI使用量SQLを反映してください。';
    throw Object.assign(new Error(msg), { status: response.status >= 500 ? 503 : response.status });
  }

  if (data?.ok === false) {
    throw Object.assign(new Error(data.message || '今日のAI利用上限に達しました。明日また使えます。'), {
      status: 429,
      usage: data,
    });
  }

  return data;
}

async function refundUsage(token, usage) {
  const claimId = usage?.claimId;
  if (!claimId) return;
  const cfg = getSupabaseConfig();
  try {
    await fetch(`${cfg.url}/rest/v1/rpc/refund_ai_usage`, {
      method: 'POST',
      headers: {
        apikey: cfg.anonKey,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_claim_id: claimId }),
    });
  } catch {
    // Usage refund is best-effort; the user-facing error should stay about AI.
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    res.status(503).json({ error: 'Gemini API key is not configured on the server.' });
    return;
  }

  const body = readBody(req);
  const token = getBearerToken(req);
  let usage = null;
  try {
    await requireAuthenticatedUser(token);
    usage = withUsageDate(await claimUsage(token, body));
  } catch (error) {
    res.status(error?.status || 500).json({
      error: error?.message || 'AI usage check failed.',
      usage: withUsageDate(error?.usage || null),
    });
    return;
  }

  const model = pickModel(body.modelPreference);
  const responseFormat = body.responseFormat === 'json' ? 'json' : 'text';
  const payload = {
    contents: [
      {
        role: 'user',
        parts: [{ text: String(body.userText || '') }],
      },
    ],
    generationConfig: {
      maxOutputTokens: Number(body.maxTokens || 300),
      temperature: responseFormat === 'json' ? 0.2 : 0.4,
      responseMimeType: responseFormat === 'json' ? 'application/json' : 'text/plain',
      thinkingConfig: pickThinkingConfig(model, body.actionType),
    },
  };

  const responseSchema = responseFormat === 'json'
    ? pickResponseSchema(body.actionType, body)
    : null;
  if (responseSchema) payload.generationConfig.responseSchema = responseSchema;

  if (body.systemText) {
    payload.systemInstruction = {
      parts: [{ text: String(body.systemText) }],
    };
  }

  try {
    let { upstream, data } = await requestGemini(key, model, payload);
    if (!upstream.ok) {
      await refundUsage(token, usage);
      const msg = data?.error?.message || `Gemini upstream error ${upstream.status}`;
      res.status(upstream.status).json({ error: msg });
      return;
    }

    let text = extractText(data);
    if (!text) {
      const retryPayload = {
        ...payload,
        generationConfig: {
          ...payload.generationConfig,
          maxOutputTokens: Math.max(Number(body.maxTokens || 300) * 2, 512),
          thinkingConfig: pickThinkingConfig(model, body.actionType),
        },
      };
      ({ upstream, data } = await requestGemini(key, model, retryPayload));
      if (!upstream.ok) {
        await refundUsage(token, usage);
        const msg = data?.error?.message || `Gemini upstream error ${upstream.status}`;
        res.status(upstream.status).json({ error: msg });
        return;
      }
      text = extractText(data);
    }

    if (!text) {
      await refundUsage(token, usage);
      const blockReason = data?.promptFeedback?.blockReason;
      res.status(502).json({ error: blockReason ? `Gemini blocked the request: ${blockReason}` : 'Gemini returned an empty response.' });
      return;
    }

    res.status(200).json({ text, model, usage });
  } catch (error) {
    await refundUsage(token, usage);
    res.status(500).json({ error: error?.message || 'Gemini request failed.' });
  }
}
