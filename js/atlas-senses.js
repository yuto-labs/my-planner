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

function normalized(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase();
}

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

function bigramSimilarity(left, right) {
  const compact = value => normalized(value).replace(/[\s\p{P}\p{S}]/gu, '');
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

function normalizedList(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map(item => normalized(item))
    .filter(Boolean))];
}

function normalizePhysicality(value) {
  const label = normalized(value);
  if (['physical', 'literal', '物理', '物理的', '文字通り'].includes(label)) return 'physical';
  if (['figurative', 'metaphorical', '比喩', '比喩的'].includes(label)) return 'figurative';
  if (['abstract', '抽象', '抽象的'].includes(label)) return 'abstract';
  if (['mixed', 'both', '複合', '混合'].includes(label)) return 'mixed';
  return label;
}

function listsOverlap(left, right) {
  const a = new Set(normalizedList(left));
  return normalizedList(right).some(value => a.has(value));
}

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

function fingerprintHasData(value) {
  const fingerprint = normalizeSenseFingerprint(value);
  return Boolean(
    fingerprint.semanticDomain
    || fingerprint.actionType
    || fingerprint.physicality
    || FINGERPRINT_LIST_FIELDS.some(field => fingerprint[field].length)
  );
}

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

function collocationKey(item) {
  const expression = typeof item === 'string' ? item : item?.expression || item?.text;
  return normalized(expression);
}

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

function preferRicherText(existing, incoming) {
  const previous = String(existing || '').trim();
  const next = String(incoming || '').trim();
  if (!next) return existing;
  return next.length >= previous.length ? incoming : existing;
}

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

export function atlasSenseAddsLearningContent(existing = {}, incoming = {}) {
  if (!existing || !Object.keys(existing).length) return true;
  const merged = mergeAtlasSense(existing, incoming);
  const project = sense => Object.fromEntries(SENSE_LEARNING_FIELDS.map(field => [field, sense?.[field]]));
  return stableJson(project(merged)) !== stableJson(project(existing));
}

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
