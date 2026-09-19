// ============================================================
// atlas-query.js - 表現帳へ入力された質問の種類と保存先を判断する
//
// 通信や画面操作を置かず、文字列と既存分類だけから結果を返す。
// AIへ送る前の判断を単独でテストしやすくするためのファイルである。
// ============================================================

import {
  normalizeAtlasCategory,
  normalizeAtlasTopic,
  isValidAtlasTopic,
} from './atlas-model.js';

// 表示文字列は変えず、同じテーマかを比較する時だけ表記をそろえる。
function normalizedTopicText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s・】【、】【「」『』()（）!?！？、,./]/g, '');
}

/** 表記が少し違っても同じ代表テーマとして比べられるキーを返す。 */
export function canonicalTopicKey(value) {
  const text = normalizedTopicText(value);
  if (/(怖がらせ|恐怖を与|脅|威圧|scare|frighten|intimidat)/.test(text)) return 'intimidation-frightening';
  if (/(恐怖|恐れ|怖|こわ|不安|anxiety|fear|scare|frighten)/.test(text)) return 'fear-anxiety';
  if (/(面倒|煩|負担|bother|burden|trouble)/.test(text)) return 'burden-bother';
  if (/(喜び|嬉し|幸せ|happy|joy|delight)/.test(text)) return 'joy-happiness';
  if (/(怒り|腹立|苛立|angry|anger|annoy)/.test(text)) return 'anger-irritation';
  if (/(悲し|寂し|sad|sorrow|lonely)/.test(text)) return 'sadness-loneliness';
  return text;
}

/** 英語表現そのものの深掘りか、日本語の概念比較かを判定する。 */
export function detectAtlasQueryMode(value) {
  const text = String(value || '').trim();
  if (!text) return 'japanese_concept';
  const hasJapanese = /[\u3040-\u30ff\u3400-\u9fff]/u.test(text);
  const englishWords = text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || [];
  const onlyEnglishExpression = !hasJapanese
    && englishWords.length > 0
    && englishWords.length <= 6
    && /^[A-Za-z\s'’.,!?-]+$/u.test(text);
  return onlyEnglishExpression ? 'english_seed' : 'japanese_concept';
}

/** 日本語を含む依頼文から、既存解説と照合する英語表現を抜き出す。 */
export function extractRequestedAtlasExpressions(value) {
  const text = String(value || '').normalize('NFKC');
  return [...new Set((text.match(/[A-Za-z]+(?:['’][A-Za-z]+)?(?:\s+[A-Za-z]+(?:['’][A-Za-z]+)?){0,4}/g) || [])
    .map(term => term.trim())
    .filter(Boolean))];
}

/** 既存分類に同じ意味のテーマがあれば、その表示名とカテゴリを再利用する。 */
export function reuseEquivalentAtlasTopic(existingTaxonomy, category, topic, context = '') {
  const targetKey = canonicalTopicKey(`${topic} ${context}`);
  const normalizedCategory = normalizeAtlasCategory(category, `${topic} ${context}`);
  if (!targetKey) return { category: normalizedCategory, topic };
  const categories = Array.isArray(existingTaxonomy) ? existingTaxonomy : [];
  const preferred = categories.filter(item => (
    normalizeAtlasCategory(item?.category || '', `${topic} ${context}`) === normalizedCategory
  ));
  const candidates = [...preferred, ...categories.filter(item => !preferred.includes(item))];
  for (const item of candidates) {
    const records = Array.isArray(item?.topicRecords) ? item.topicRecords : [];
    const match = records.find(record => canonicalTopicKey([
      record?.label,
      ...(Array.isArray(record?.aliases) ? record.aliases : []),
      ...(Array.isArray(record?.terms) ? record.terms : []),
    ].filter(Boolean).join(' ')) === targetKey);
    if (match?.label) {
      return {
        category: normalizeAtlasCategory(item.category || normalizedCategory, `${topic} ${context}`),
        topic: match.label,
      };
    }
  }
  return { category: normalizedCategory, topic };
}

/** AIの候補を保存可能なテーマ名へ直し、無効なら安全な既定値を返す。 */
export function resolveAtlasTopic(value, category, fallback = '') {
  const candidate = normalizeAtlasTopic(value, category);
  if (isValidAtlasTopic(candidate, category)) return candidate;
  const fallbackTopic = normalizeAtlasTopic(fallback, category);
  if (isValidAtlasTopic(fallbackTopic, category)) return fallbackTopic;
  return '関連表現';
}
