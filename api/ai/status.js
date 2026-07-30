export default async function handler(req, res) {
  const key = process.env.GEMINI_API_KEY;
  const configured = !!key;
  const fastModel = process.env.GEMINI_MODEL_FAST || 'gemini-3.5-flash';
  const qualityModel = process.env.GEMINI_MODEL_QUALITY || fastModel;
  const userDailyLimit = 50;
  const appDailyLimit = 500;
  const appMinuteLimit = 30;
  let available = configured;
  let message = configured ? 'ok' : 'missing_gemini_api_key';

  // An environment variable can be present even when its key was revoked or
  // the selected model is temporarily unavailable. Verify the lightweight
  // model metadata endpoint so the client does not advertise a false-ready AI.
  if (configured) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8_000);
    try {
      const upstream = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(fastModel)}`,
        {
          headers: { 'x-goog-api-key': key },
          signal: controller.signal,
        }
      );
      available = upstream.ok;
      message = upstream.ok ? 'ok' : `gemini_status_${upstream.status}`;
    } catch {
      available = false;
      message = 'gemini_status_unavailable';
    } finally {
      clearTimeout(timeoutId);
    }
  }

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    provider: 'gemini',
    mode: 'server',
    configured,
    models: {
      fast: fastModel,
      quality: qualityModel,
    },
    available,
    limits: {
      userDaily: userDailyLimit,
      appDaily: appDailyLimit,
      appMinute: appMinuteLimit,
    },
    message,
  });
}
