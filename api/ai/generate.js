function readBody(req) {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body || {};
}

function pickModel(pref) {
  const fastModel = process.env.GEMINI_MODEL_FAST || 'gemini-2.5-flash';
  const qualityModel = process.env.GEMINI_MODEL_QUALITY || fastModel;
  const raw = String(pref || '').toLowerCase();
  if (raw.includes('sonnet') || raw === 'quality') return qualityModel;
  return fastModel;
}

function extractText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.map(part => part?.text || '').join('').trim();
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
    },
  };

  if (body.systemText) {
    payload.systemInstruction = {
      parts: [{ text: String(body.systemText) }],
    };
  }

  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const msg = data?.error?.message || `Gemini upstream error ${upstream.status}`;
      res.status(upstream.status).json({ error: msg });
      return;
    }

    const text = extractText(data);
    if (!text) {
      const blockReason = data?.promptFeedback?.blockReason;
      res.status(502).json({ error: blockReason ? `Gemini blocked the request: ${blockReason}` : 'Gemini returned an empty response.' });
      return;
    }

    res.status(200).json({ text, model });
  } catch (error) {
    res.status(500).json({ error: error?.message || 'Gemini request failed.' });
  }
}
