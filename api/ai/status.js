export default async function handler(req, res) {
  const configured = !!process.env.GEMINI_API_KEY;
  const fastModel = process.env.GEMINI_MODEL_FAST || 'gemini-3.5-flash';
  const qualityModel = process.env.GEMINI_MODEL_QUALITY || fastModel;
  const userDailyLimit = Number(process.env.AI_USER_DAILY_LIMIT || 50);
  const appDailyLimit = Number(process.env.AI_APP_DAILY_LIMIT || 500);
  const appMinuteLimit = Number(process.env.AI_APP_MINUTE_LIMIT || 30);

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    provider: 'gemini',
    mode: 'server',
    configured,
    models: {
      fast: fastModel,
      quality: qualityModel,
    },
    limits: {
      userDaily: userDailyLimit,
      appDaily: appDailyLimit,
      appMinute: appMinuteLimit,
    },
    message: configured ? 'ok' : 'missing_gemini_api_key',
  });
}
