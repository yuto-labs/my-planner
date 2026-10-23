// ============================================================
// space-ai-model.js - メモ欄のAIの、画面に触れない処理(テストできるように分けてある)
//
// pickContext: 質問に近い行から順に、AIへ渡す本文を上限まで選ぶ。
// renderAnswer: AIの答えを安全なHTMLにする(URLはリンク、【行の名前】はその行を開くボタン)。
// ============================================================
import { normalizeMemoUrl } from './memo-model.js';
import { esc } from './utils.js';

/**
 * 比べやすい形にする。全角/半角・大文字/小文字・カタカナ/ひらがなの違いをそろえる
 * (「ラジオ」で聞いても「らじお」「ﾗｼﾞｵ」と書いた行が見つかるように)。
 */
export function normalizeForMatch(text) {
  return String(text || '').normalize('NFKC').toLowerCase()
    .replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

/**
 * 質問に近い行から順に、上限(文字数)に収まるだけ並べる。近さは「質問の2文字ずつのかたまり」が
 * 行にいくつ含まれるかで測り(日本語は単語の区切りが無いので2文字ずつ)、名前に含まれる時は重く数える。
 * 特に近い行(上位 fullCount 件)は本文を省略せず(full)、それ以外は短い形(text)で渡す。
 * 同じ近さなら元の並び順を保つ。docs は [{ title, text, full? }]。
 */
export function pickContext(docs, question, budget = 60_000, fullCount = 12) {
  const q = normalizeForMatch(question).replace(/[\s、。！？!?「」『』()（）・,.]/g, '');
  const grams = new Set(Array.from({ length: Math.max(0, q.length - 1) }, (_, i) => q.slice(i, i + 2)));
  const scored = docs.map((doc, index) => {
    const text = normalizeForMatch(doc.full || doc.text);
    const title = normalizeForMatch(doc.title);
    let score = 0;
    grams.forEach(gram => {
      if (title.includes(gram)) score += 3;
      else if (text.includes(gram)) score += 1;
    });
    return { doc, score, index };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  const picked = [];
  let used = 0;
  scored.forEach(({ doc, score }, rank) => {
    const text = rank < fullCount && score > 0 && doc.full ? doc.full : doc.text;
    if (used + text.length > budget) return;
    picked.push(text);
    used += text.length + 1;
  });
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
