// ============================================================
// space-ai-model.js - メモ欄のAIの、画面に触れない処理(テストできるように分けてある)
//
// pickContext: 質問に近い行から順に、AIへ渡す本文を上限まで選ぶ。
// renderAnswer: AIの答えを安全なHTMLにする(URLはリンク、【行の名前】はその行を開くボタン)。
// ============================================================
import { normalizeMemoUrl } from './memo-model.js';
import { esc } from './utils.js';

/**
 * 質問に近い行から順に、上限(文字数)に収まるだけ並べる。近さは「質問の2文字ずつのかたまり」が
 * 行の文にいくつ含まれるかで測る(日本語は単語の区切りが無いので、2文字ずつで比べる)。
 * 同じ近さなら元の並び順を保つ。docs は [{ text }]。
 */
export function pickContext(docs, question, budget = 60_000) {
  const q = String(question || '').toLowerCase().replace(/[\s、。！？!?「」]/g, '');
  const grams = new Set(Array.from({ length: Math.max(0, q.length - 1) }, (_, i) => q.slice(i, i + 2)));
  const scored = docs.map((doc, index) => {
    const text = doc.text.toLowerCase();
    let score = 0;
    grams.forEach(gram => { if (text.includes(gram)) score += 1; });
    return { doc, score, index };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  const picked = [];
  let used = 0;
  for (const { doc } of scored) {
    if (used + doc.text.length > budget) continue;
    picked.push(doc.text);
    used += doc.text.length + 1;
  }
  return picked.join('\n');
}

/** esc() で文字に直した記号を元へ戻す(行の名前と見比べるため)。 */
const unescape = text => text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/**
 * AIの答えを、安全なHTMLにする。答えの文はAIが作ったものなので、最初に必ず全部エスケープしてから、
 * URL(http/httpsだけ)をリンクに、【行の名前】(実在する行だけ)を開くボタンに、**太字** を太字にする。
 * docs は [{ id, title }]。
 */
export function renderAnswer(text, docs) {
  const byTitle = new Map(docs.map(doc => [doc.title, doc.id]));
  return esc(text)
    .replace(/https?:\/\/[^\s<>"'）)]+/g, url => {
      const href = normalizeMemoUrl(unescape(url));
      return href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${url}</a>` : url;
    })
    .replace(/【([^】]{1,80})】/g, (whole, title) => {
      const id = byTitle.get(unescape(title));
      return id ? `<button class="sai-cite" type="button" data-ai-row="${esc(id)}">${title}</button>` : whole;
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}
