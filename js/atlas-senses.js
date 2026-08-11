import { normalizePartOfSpeech } from './atlas-model.js';

export const ATLAS_SENSE_FIELDS = Object.freeze([
  'senseId', 'partOfSpeech', 'pronunciation', 'etymologyJa', 'coreImageJa',
  'coreMeaningJa', 'nuanceJa', 'nuanceTypeJa', 'register', 'emotionalToneJa',
  'useCasesJa', 'collocations', 'usagePatterns', 'examples', 'comparisons',
  'cautionsJa', 'grammarNotes', 'category', 'topic', 'categoryId', 'topicId',
  'categoryAliases', 'topicAliases', 'mapMode', 'mapAxisJa', 'mapLowLabelJa',
  'mapHighLabelJa', 'intensityLevel', 'intensityMin', 'intensityMax', 'intensity',
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
  return sense;
}

export function sameAtlasSense(existing = {}, incoming = {}) {
  const existingPart = normalizePartOfSpeech(existing.partOfSpeech);
  const incomingPart = normalizePartOfSpeech(incoming.partOfSpeech);
  if (existingPart && incomingPart && existingPart !== incomingPart) return false;

  const existingId = normalized(existing.senseId);
  const incomingId = normalized(incoming.senseId);
  if (existingId && incomingId && existingId === incomingId) return true;

  const existingMeaning = normalized(existing.coreMeaningJa);
  const incomingMeaning = normalized(incoming.coreMeaningJa);
  if (!existingMeaning || !incomingMeaning) return false;
  if (existingMeaning === incomingMeaning) return true;

  // Fuzzy merging is deliberately conservative. Leaving two nearby senses is
  // reversible; merging two genuinely different meanings is not.
  return Math.min(existingMeaning.length, incomingMeaning.length) >= 12
    && bigramSimilarity(existingMeaning, incomingMeaning) >= 0.86;
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
