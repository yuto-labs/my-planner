async function checkModel(key, model) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`,
      {
        headers: { 'x-goog-api-key': key },
        signal: controller.signal,
      }
    );
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

export default async function handler(req, res) {
  const key = process.env.GEMINI_API_KEY;
  const configured = !!key;
  const fastModel = process.env.GEMINI_MODEL_FAST || 'gemini-3.5-flash-lite';
  const qualityModel = process.env.GEMINI_MODEL_QUALITY || 'gemini-3.5-flash';
  let available = configured;
  let message = configured ? 'ok' : 'missing_gemini_api_key';

  let modelAvailability = { fast: false, quality: false };

  // Verify both routes because a temporary outage in one model should not hide
  // the other route. Generation also falls back between them when appropriate.
  if (configured) {
    const [fastAvailable, qualityAvailable] = await Promise.all([
      checkModel(key, fastModel),
      fastModel === qualityModel ? Promise.resolve(false) : checkModel(key, qualityModel),
    ]);
    modelAvailability = {
      fast: fastAvailable,
      quality: fastModel === qualityModel ? fastAvailable : qualityAvailable,
    };
    available = modelAvailability.fast || modelAvailability.quality;
    message = !available
      ? 'gemini_status_unavailable'
      : (modelAvailability.fast && modelAvailability.quality ? 'ok' : 'gemini_model_degraded');
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
    modelAvailability,
    available,
    limits: null,
    message,
  });
}
