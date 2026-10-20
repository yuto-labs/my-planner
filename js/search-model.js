// ============================================================
// search-model.js - 横断検索の照合(画面に触れない純粋な処理)
//
// 題名だけでなく、メモ本文・タスクのメモ・表現帳の意味や例文・Knowledgeの回答文も探す。
// 全角/半角や大文字/小文字の違いは無視する。題名で一致したものを上に並べ、本文だけで
// 一致したものには「どこに書いてあったか」が分かる抜粋を付ける。
// ============================================================
import { memoBlocksToText } from './memo-model.js';

/** 全角英数を半角に、英字を小文字にそろえ、表記の違いで見落とさないようにする。 */
export function normalizeSearchText(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase();
}

/**
 * 本文の一致箇所の前後だけを切り出す。正規化で文字数が変わらない前提で位置を使うため、
 * 元の文字列も同じ正規化を通してから切り出す(表示は正規化後の文字になる)。
 */
export function makeSnippet(text, normalizedQuery, radius = 28) {
  const source = String(text ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  const index = source.toLowerCase().indexOf(normalizedQuery);
  if (index < 0) return '';
  const start = Math.max(0, index - radius);
  const end = Math.min(source.length, index + normalizedQuery.length + radius);
  return `${start > 0 ? '…' : ''}${source.slice(start, end)}${end < source.length ? '…' : ''}`;
}

/** 文字列・配列が混ざった本文候補を、照合用の一本の文章にまとめる。 */
function joinText(parts) {
  return parts.flat(Infinity).filter(part => typeof part === 'string' && part.trim()).join(' / ');
}

/** Knowledgeの回答(結論・要点・各節の段落)を文字だけにする。 */
function learningText(entry) {
  /** 強調などで分割された文の断片から、文字だけを取り出す。 */
  const segments = list => (Array.isArray(list) ? list : []).map(segment => segment?.text || '');
  return joinText([
    entry.originalQuestion,
    segments(entry.answer?.directAnswer).join(''),
    entry.answer?.keyPoints || [],
    (entry.answer?.sections || []).map(section => [
      section.heading,
      (section.paragraphs || []).map(paragraph => segments(paragraph).join('')),
    ]),
    (entry.concepts || []).map(concept => concept?.label),
  ]);
}

/** 表現帳の単語(意味ごとの核心・ニュアンス・例文)と自分のメモを文字だけにする。 */
function atlasText(word) {
  const senses = Array.isArray(word.senses) && word.senses.length ? word.senses : [word];
  return joinText([
    word.lemma, word.aliases || [], word.personalNote,
    senses.map(sense => [
      sense.coreMeaningJa, sense.nuanceJa,
      (sense.examples || []).map(example => [example?.english, example?.japanese]),
    ]),
  ]);
}

/**
 * 種類ごとに「題名・本文・補足表示」の取り出し方を決めた表。
 * open は結果を押した時の開き方を画面側へ伝えるための値。
 */
const KINDS = [
  { kind: 'memo', label: 'メモ', pick: data => data.memos, title: m => m.title || '無題のメモ',
    body: m => joinText([m.tags || [], memoBlocksToText(m.blocks || [])]), meta: m => (m.tags || []).slice(0, 3).map(tag => `#${tag}`).join(' ') },
  { kind: 'learning', label: 'Knowledge', pick: data => data.learning, title: e => e.title || e.originalQuestion || '無題',
    body: learningText, meta: () => '' },
  { kind: 'atlas', label: '表現帳', pick: data => data.atlas, title: w => w.term || w.lemma || '表現',
    body: atlasText, meta: w => (w.senses?.[0] || w).coreMeaningJa || '' },
  { kind: 'task', label: 'タスク', pick: data => data.tasks, title: t => t.title,
    body: t => joinText([t.memo, t.tags || [], (t.subtasks || []).map(sub => sub?.title)]), meta: t => t.dueDate || '' },
  { kind: 'event', label: '予定', pick: data => data.events, title: e => e.title,
    body: e => joinText([e.memo, e.location, e.tags || []]), meta: e => e.start || '' },
  { kind: 'goal', label: '目標', pick: data => data.goals, title: g => g.title,
    body: g => joinText([g.description, g.memo]), meta: g => `${g.progress ?? 0}%` },
];

/**
 * 全種類を検索し、一致があった種類だけを [{ kind, label, items }] で返す。
 * items は { id, title, snippet, meta, titleHit, raw }。題名一致が先、次に本文一致。
 */
export function searchAll(query, data) {
  const q = normalizeSearchText(String(query ?? '').trim());
  if (!q) return [];
  return KINDS.map(({ kind, label, pick, title, body, meta }) => {
    const items = (pick(data) || []).flatMap(raw => {
      const itemTitle = String(title(raw) || '');
      const titleHit = normalizeSearchText(itemTitle).includes(q);
      const bodyText = titleHit ? '' : body(raw);
      if (!titleHit && !normalizeSearchText(bodyText).includes(q)) return [];
      return [{ id: raw.id, title: itemTitle, snippet: titleHit ? '' : makeSnippet(bodyText, q), meta: meta(raw), titleHit, raw }];
    });
    // 並び替えは安定なので、同じ一致の種類の中では元の並び(新しい順など)が保たれる。
    items.sort((a, b) => Number(b.titleHit) - Number(a.titleHit));
    return { kind, label, items };
  }).filter(group => group.items.length);
}
