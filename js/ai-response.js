// ============================================================
// ai-response.js - AI応答をアプリで扱える形へ変換する純粋関数
//
// 通信そのものはai.jsが担当する。このファイルは、返ってきた文字列から
// JSONを安全に取り出す処理と、HTTPエラーを利用者向けに直す処理だけを持つ。
// ============================================================

/**
 * AIがJSONをコードブロックや短い説明で囲んでも、最初のJSONを取り出す。
 * 読めない場合は例外を投げずnullを返し、呼び出し側が安全に判断できるようにする。
 */
export function tryParseAIJSON(text) {
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

/** サーバーの状態コードと英語メッセージを、画面へ出せる日本語へ変換する。 */
export function getFriendlyAiError(status, message) {
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
