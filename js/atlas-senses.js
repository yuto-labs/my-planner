// ============================================================
// atlas-senses.js - 同じ英語見出し語に含まれる意味単位の比較と統合
//
// AIが返すIDだけを信用せず、品詞・意味領域・構文・目的語・含意を比較する。
// 明確に同じ意味は内容を補完し、違う意味は同じ見出し語内の別senseとして残す。
// ============================================================

import { normalizePartOfSpeech } from './atlas-model.js';

export const ATLAS_SENSE_FIELDS = Object.freeze([
  'senseId', 'partOfSpeech', 'pronunciation', 'etymologyJa', 'coreImageJa',
  'coreMeaningJa', 'nuanceJa', 'nuanceTypeJa', 'register', 'emotionalToneJa',
  'useCasesJa', 'collocations', 'usagePatterns', 'examples', 'comparisons',
  'cautionsJa', 'grammarNotes', 'category', 'topic', 'categoryId', 'topicId',
  'categoryAliases', 'topicAliases', 'mapMode', 'mapAxisJa', 'mapLowLabelJa',
  'mapHighLabelJa', 'intensityLevel', 'intensityMin', 'intensityMax', 'intensity',
  'senseFingerprint',
]);

const FINGERPRINT_LIST_FIELDS = Object.freeze([
  'argumentPatterns', 'typicalObjects', 'implicationTags', 'registerTags',
]);

/** `normalized`: 比較前の文字列をUnicode・空白・大文字小文字がそろった形へ直す。 */
function normalized(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase();
}

/** `stableJson`: オブジェクトのキー順に左右されない比較用JSON文字列を作る。 */
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const SENSE_LEARNING_FIELDS = Object.freeze([
  'pronunciation', 'etymologyJa', 'coreImageJa', 'coreMeaningJa', 'nuanceJa',
  'register', 'emotionalToneJa', 'useCasesJa', 'collocations', 'usagePatterns',
  'examples', 'comparisons', 'cautionsJa', 'grammarNotes', 'senseFingerprint',
]);

/** `bigramSimilarity`: 二つの文字列を2文字ずつの組に分け、表記の近さを0から1で返す。 */
function bigramSimilarity(left, right) {
  /** `compact`: 類似度計算の前に、空白と記号を除いた比較文字列を作る。 */
  const compact = value => normalized(value).replace(/[\s\p{P}\p{S}]/gu, '');
  /** `bigrams`: 文字列から隣り合う2文字の集合を作る。 */
  const bigrams = value => {
    const text = compact(value);
    if (text.length < 2) return new Set(text ? [text] : []);
    return new Set(Array.from({ length: text.length - 1 }, (_, index) => text.slice(index, index + 2)));
  };
  const a = bigrams(left);
  const b = bigrams(right);
  if (!a.size || !b.size) return 0;
  const shared = [...a].filter(value => b.has(value)).length;
  return (2 * shared) / (a.size + b.size);
}

/** `normalizedList`: 配列内の文字列を比較用に正規化し、重複を除く。 */
function normalizedList(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map(item => normalized(item))
    .filter(Boolean))];
}

/** `normalizePhysicality`: 物理的・比喩的という意味分類の表記ゆれを統一する。 */
function normalizePhysicality(value) {
  const label = normalized(value);
  if (['physical', 'literal', '物理', '物理的', '文字通り'].includes(label)) return 'physical';
  if (['figurative', 'metaphorical', '比喩', '比喩的'].includes(label)) return 'figurative';
  if (['abstract', '抽象', '抽象的'].includes(label)) return 'abstract';
  if (['mixed', 'both', '複合', '混合'].includes(label)) return 'mixed';
  return label;
}

/** `listsOverlap`: 二つの文字列配列に共通要素があるか判定する。 */
function listsOverlap(left, right) {
  const a = new Set(normalizedList(left));
  return normalizedList(right).some(value => a.has(value));
}

/** 語義比較用の特徴文字列を小文字・空白統一し、表記揺れに強い比較値へ変換する。 */
export function normalizeSenseFingerprint(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    semanticDomain: String(source.semanticDomain || '').trim(),
    actionType: String(source.actionType || '').trim(),
    argumentPatterns: normalizedList(source.argumentPatterns),
    typicalObjects: normalizedList(source.typicalObjects),
    implicationTags: normalizedList(source.implicationTags),
    registerTags: normalizedList(source.registerTags),
    physicality: normalizePhysicality(source.physicality),
  };
}

/** `fingerprintHasData`: 意味特徴に比較可能な情報が一つ以上あるか判定する。 */
function fingerprintHasData(value) {
  const fingerprint = normalizeSenseFingerprint(value);
  return Boolean(
    fingerprint.semanticDomain
    || fingerprint.actionType
    || fingerprint.physicality
    || FINGERPRINT_LIST_FIELDS.some(field => fingerprint[field].length)
  );
}

/** `fingerprintConflict`: 二つの意味特徴が、同じ意味として統合できないほど矛盾するか判定する。 */
function fingerprintConflict(left, right) {
  const a = normalizeSenseFingerprint(left);
  const b = normalizeSenseFingerprint(right);
  const physicalConflict = a.physicality && b.physicality && a.physicality !== b.physicality
    && new Set([a.physicality, b.physicality]).has('physical')
    && new Set([a.physicality, b.physicality]).has('figurative');
  if (physicalConflict) return true;

  const actionConflict = a.actionType && b.actionType && normalized(a.actionType) !== normalized(b.actionType);
  const patternConflict = a.argumentPatterns.length && b.argumentPatterns.length
    && !listsOverlap(a.argumentPatterns, b.argumentPatterns);
  const objectConflict = a.typicalObjects.length && b.typicalObjects.length
    && !listsOverlap(a.typicalObjects, b.typicalObjects);
  return Boolean(actionConflict && patternConflict && objectConflict);
}

/** `fingerprintSupportsMatch`: 意味特徴の一致数を数え、同じ意味として扱えるか判定する。 */
function fingerprintSupportsMatch(left, right) {
  if (!fingerprintHasData(left) || !fingerprintHasData(right) || fingerprintConflict(left, right)) return false;
  const a = normalizeSenseFingerprint(left);
  const b = normalizeSenseFingerprint(right);
  let signals = 0;
  if (a.semanticDomain && normalized(a.semanticDomain) === normalized(b.semanticDomain)) signals += 1;
  if (a.actionType && normalized(a.actionType) === normalized(b.actionType)) signals += 2;
  if (a.physicality && a.physicality === b.physicality) signals += 1;
  if (listsOverlap(a.argumentPatterns, b.argumentPatterns)) signals += 2;
  if (listsOverlap(a.typicalObjects, b.typicalObjects)) signals += 1;
  if (listsOverlap(a.implicationTags, b.implicationTags)) signals += 1;
  const hasMeaningAnchor = Boolean(
    (a.semanticDomain && normalized(a.semanticDomain) === normalized(b.semanticDomain))
    || listsOverlap(a.typicalObjects, b.typicalObjects)
    || listsOverlap(a.implicationTags, b.implicationTags)
  );
  return hasMeaningAnchor && signals >= 4;
}

/** `mergeAtlasList`: 複数の表現帳・一覧を既存情報を失わないよう統合する。 */
export function mergeAtlasList(existing, incoming) {
  const seen = new Set();
  return [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]
    .filter(value => {
      const key = stableJson(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** `collocationKey`: コロケーションを重複判定するための正規化キーを返す。 */
function collocationKey(item) {
  const expression = typeof item === 'string' ? item : item?.expression || item?.text;
  return normalized(expression);
}

/** `mergeAtlasCollocations`: 複数の表現帳・よく一緒に使う語を既存情報を失わないよう統合する。 */
function mergeAtlasCollocations(existing, incoming) {
  const merged = [];
  const indexes = new Map();
  [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]
    .forEach(item => {
      const key = collocationKey(item);
      if (!key) return;
      const index = indexes.get(key);
      if (index === undefined) {
        indexes.set(key, merged.length);
        merged.push(item);
        return;
      }
      const previous = merged[index];
      if (typeof item === 'string') return;
      if (typeof previous === 'string') {
        merged[index] = item;
        return;
      }
      merged[index] = {
        ...previous,
        ...item,
        expression: item.expression || previous.expression,
        translationJa: preferRicherText(previous.translationJa, item.translationJa),
        usageNoteJa: preferRicherText(previous.usageNoteJa, item.usageNoteJa),
        examples: mergeAtlasList(previous.examples, item.examples),
      };
    });
  return merged;
}

/** `atlasSenseFromEntry`: 旧形式の表現項目から、品詞・意味単位のデータだけを取り出す。 */
export function atlasSenseFromEntry(entry = {}) {
  const sense = Object.fromEntries(ATLAS_SENSE_FIELDS.map(field => [field, entry[field]]));
  sense.partOfSpeech = normalizePartOfSpeech(sense.partOfSpeech);
  if (sense.grammarNotes && typeof sense.grammarNotes === 'object') {
    sense.grammarNotes = {
      ...sense.grammarNotes,
      partOfSpeech: normalizePartOfSpeech(sense.grammarNotes.partOfSpeech || sense.partOfSpeech),
    };
  }
  sense.sourceQueryJa = entry.sourceQueryJa || '';
  sense.sourceQueries = Array.isArray(entry.sourceQueries) ? entry.sourceQueries : [];
  sense.senseFingerprint = normalizeSenseFingerprint(entry.senseFingerprint);
  return sense;
}

/** 二つの解説が、統合してよい同一senseかを保守的に判定する。 */
export function sameAtlasSense(existing = {}, incoming = {}) {
  const existingPart = normalizePartOfSpeech(existing.partOfSpeech);
  const incomingPart = normalizePartOfSpeech(incoming.partOfSpeech);
  if (existingPart && incomingPart && existingPart !== incomingPart) return false;

  const existingId = normalized(existing.senseId);
  const incomingId = normalized(incoming.senseId);
  if (fingerprintConflict(existing.senseFingerprint, incoming.senseFingerprint)) return false;
  if (existingId && incomingId && existingId === incomingId) return true;

  const existingMeaning = normalized(existing.coreMeaningJa);
  const incomingMeaning = normalized(incoming.coreMeaningJa);
  if (!existingMeaning || !incomingMeaning) return false;
  if (existingMeaning === incomingMeaning) return true;

  const meaningSimilarity = bigramSimilarity(existingMeaning, incomingMeaning);
  // A strong structured match is more stable than wording similarity across
  // independently generated Japanese explanations. Conflicting fingerprints
  // have already returned false above, so this only absorbs paraphrase drift.
  if (fingerprintSupportsMatch(existing.senseFingerprint, incoming.senseFingerprint)) return true;

  // Fuzzy merging is deliberately conservative. Leaving two nearby senses is
  // reversible; merging two genuinely different meanings is not.
  return Math.min(existingMeaning.length, incomingMeaning.length) >= 12
    && meaningSimilarity >= 0.86;
}

/** `preferRicherText`: 既存文と新しい文を比べ、情報量が多い方を残す。 */
function preferRicherText(existing, incoming) {
  const previous = String(existing || '').trim();
  const next = String(incoming || '').trim();
  if (!next) return existing;
  return next.length >= previous.length ? incoming : existing;
}

/** `mergeAtlasSense`: 複数の表現帳・意味を既存情報を失わないよう統合する。 */
export function mergeAtlasSense(existing = {}, incoming = {}) {
  const merged = { ...existing };
  ATLAS_SENSE_FIELDS.forEach(field => {
    if (field === 'partOfSpeech') {
      merged.partOfSpeech = normalizePartOfSpeech(incoming.partOfSpeech || existing.partOfSpeech);
    } else if (field === 'senseFingerprint') {
      const previous = normalizeSenseFingerprint(existing.senseFingerprint);
      const next = normalizeSenseFingerprint(incoming.senseFingerprint);
      merged.senseFingerprint = {
        semanticDomain: next.semanticDomain || previous.semanticDomain,
        actionType: next.actionType || previous.actionType,
        physicality: next.physicality || previous.physicality,
        ...Object.fromEntries(FINGERPRINT_LIST_FIELDS.map(key => [
          key,
          mergeAtlasList(previous[key], next[key]),
        ])),
      };
    } else if (field === 'grammarNotes') {
      merged.grammarNotes = {
        ...(existing.grammarNotes || {}),
        ...(incoming.grammarNotes || {}),
        usageNotes: mergeAtlasList(existing.grammarNotes?.usageNotes, incoming.grammarNotes?.usageNotes),
        exampleForms: mergeAtlasList(existing.grammarNotes?.exampleForms, incoming.grammarNotes?.exampleForms),
        partOfSpeech: normalizePartOfSpeech(
          incoming.grammarNotes?.partOfSpeech
          || incoming.partOfSpeech
          || existing.grammarNotes?.partOfSpeech
          || existing.partOfSpeech
        ),
      };
    } else if (field === 'collocations') {
      merged.collocations = mergeAtlasCollocations(existing.collocations, incoming.collocations);
    } else if (Array.isArray(existing[field]) || Array.isArray(incoming[field])) {
      merged[field] = mergeAtlasList(existing[field], incoming[field]);
    } else if (typeof existing[field] === 'string' || typeof incoming[field] === 'string') {
      merged[field] = preferRicherText(existing[field], incoming[field]);
    } else if (incoming[field] !== undefined && incoming[field] !== null) {
      merged[field] = incoming[field];
    }
  });
  merged.sourceQueryJa = existing.sourceQueryJa || incoming.sourceQueryJa || '';
  merged.sourceQueries = mergeAtlasList(
    [...(existing.sourceQueries || []), existing.sourceQueryJa].filter(Boolean),
    [...(incoming.sourceQueries || []), incoming.sourceQueryJa].filter(Boolean)
  );
  return merged;
}

/** `atlasSenseAddsLearningContent`: 新しい意味データが、既存解説へ実質的な学習内容を追加するか判定する。 */
export function atlasSenseAddsLearningContent(existing = {}, incoming = {}) {
  if (!existing || !Object.keys(existing).length) return true;
  const merged = mergeAtlasSense(existing, incoming);
  /** `project`: 意味データから学習内容の比較に必要な項目だけを取り出す。 */
  const project = sense => Object.fromEntries(SENSE_LEARNING_FIELDS.map(field => [field, sense?.[field]]));
  return stableJson(project(merged)) !== stableJson(project(existing));
}

/** 既存senseを削らず、新規senseまたは追加情報を配列へ統合する。 */
export function mergeAtlasSenseArrays(existing, incoming) {
  const senses = (Array.isArray(existing) ? existing : []).map(sense => atlasSenseFromEntry(sense));
  (Array.isArray(incoming) ? incoming : []).forEach(rawSense => {
    const sense = atlasSenseFromEntry(rawSense);
    const index = senses.findIndex(candidate => sameAtlasSense(candidate, sense));
    if (index >= 0) senses[index] = mergeAtlasSense(senses[index], sense);
    else senses.push(mergeAtlasSense({}, sense));
  });
  return senses;
}
