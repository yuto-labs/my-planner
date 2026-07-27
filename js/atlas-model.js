// Shared, side-effect-free helpers for Nuance Atlas records.

const IRREGULAR_LEMMAS = new Map([
  ['am', 'be'], ['are', 'be'], ['is', 'be'], ['was', 'be'], ['were', 'be'], ['been', 'be'],
  ['became', 'become'], ['began', 'begin'], ['begun', 'begin'], ['bought', 'buy'],
  ['brought', 'bring'], ['came', 'come'], ['did', 'do'], ['done', 'do'], ['felt', 'feel'],
  ['found', 'find'], ['gave', 'give'], ['given', 'give'], ['gone', 'go'], ['got', 'get'],
  ['gotten', 'get'], ['had', 'have'], ['has', 'have'], ['knew', 'know'], ['known', 'know'],
  ['led', 'lead'], ['left', 'leave'], ['made', 'make'], ['meant', 'mean'], ['paid', 'pay'],
  ['ran', 'run'], ['said', 'say'], ['saw', 'see'], ['seen', 'see'], ['sent', 'send'],
  ['spoke', 'speak'], ['spoken', 'speak'], ['taught', 'teach'], ['thought', 'think'],
  ['told', 'tell'], ['took', 'take'], ['taken', 'take'], ['understood', 'understand'],
  ['went', 'go'], ['won', 'win'], ['wrote', 'write'], ['written', 'write'],
  ['children', 'child'], ['feet', 'foot'], ['men', 'man'], ['mice', 'mouse'],
  ['people', 'person'], ['teeth', 'tooth'], ['women', 'woman'],
]);

const FUNCTION_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'had', 'has',
  'have', 'he', 'her', 'hers', 'him', 'his', 'i', 'if', 'in', 'is', 'it', 'its', 'me',
  'my', 'nor', 'not', 'of', 'on', 'or', 'our', 'ours', 'she', 'so', 'than', 'that',
  'the', 'their', 'theirs', 'them', 'they', 'this', 'to', 'us', 'was', 'we', 'were',
  'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with', 'you', 'your', 'yours',
]);

export function normalizeAtlasLabel(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

export function stableAtlasId(prefix, value) {
  const normalized = normalizeAtlasLabel(value)
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${prefix}-${normalized || 'uncategorized'}`;
}

export function withStableClassification(record = {}) {
  const category = normalizeAtlasLabel(record.category);
  const topic = normalizeAtlasLabel(record.topic);
  return {
    ...record,
    category,
    topic,
    categoryId: record.categoryId || stableAtlasId('cat', category),
    topicId: record.topicId || stableAtlasId('topic', `${category}-${topic}`),
    categoryAliases: uniqueStrings(record.categoryAliases),
    topicAliases: uniqueStrings(record.topicAliases),
    classificationSource: record.classificationSource || 'legacy',
  };
}

export function collectStableTaxonomy(records = []) {
  const categoryMap = new Map();
  records.forEach(raw => {
    const record = withStableClassification(raw);
    if (!record.category) return;
    const category = categoryMap.get(record.categoryId) || {
      id: record.categoryId,
      label: record.category,
      aliases: new Set(),
      topics: new Map(),
    };
    record.categoryAliases.forEach(alias => category.aliases.add(alias));
    if (record.topic) {
      const topic = category.topics.get(record.topicId) || {
        id: record.topicId,
        label: record.topic,
        aliases: new Set(),
      };
      record.topicAliases.forEach(alias => topic.aliases.add(alias));
      category.topics.set(record.topicId, topic);
    }
    categoryMap.set(record.categoryId, category);
  });
  return [...categoryMap.values()].map(category => ({
    id: category.id,
    label: category.label,
    aliases: [...category.aliases],
    topics: [...category.topics.values()].map(topic => ({
      id: topic.id,
      label: topic.label,
      aliases: [...topic.aliases],
    })),
  }));
}

export function normalizeEnglishToken(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/^[^a-z]+|[^a-z'-]+$/g, '')
    .replace(/[’]/g, "'");
}

export function toEnglishLemma(value) {
  const token = normalizeEnglishToken(value);
  if (!token) return '';
  if (IRREGULAR_LEMMAS.has(token)) return IRREGULAR_LEMMAS.get(token);
  if (token.endsWith("'s")) return toEnglishLemma(token.slice(0, -2));
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 5 && token.endsWith('ing')) {
    const stem = token.slice(0, -3);
    if (/([b-df-hj-np-tv-z])\1$/.test(stem)) return stem.slice(0, -1);
    if (stem.endsWith('mak')) return `${stem}e`;
    return stem;
  }
  if (token.length > 4 && token.endsWith('ied')) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && token.endsWith('ed')) {
    const stem = token.slice(0, -2);
    if (/([b-df-hj-np-tv-z])\1$/.test(stem)) return stem.slice(0, -1);
    if (stem.endsWith('at') || stem.endsWith('iz')) return `${stem}e`;
    return stem;
  }
  if (token.length > 4 && token.endsWith('es') && /(s|x|z|ch|sh)es$/.test(token)) {
    return token.slice(0, -2);
  }
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

function toEnglishPhraseLemma(value) {
  const token = normalizeEnglishToken(value);
  if (!token || !/[\s-]/.test(token)) return toEnglishLemma(token);
  return token
    .split(/([\s-]+)/)
    .map(part => /^[\s-]+$/.test(part) ? part : toEnglishLemma(part))
    .join('');
}

export function expressionLookupKeys(entry = {}) {
  return uniqueStrings([
    entry.term,
    entry.lemma,
    ...(Array.isArray(entry.aliases) ? entry.aliases : []),
    ...(Array.isArray(entry.grammarNotes?.exampleForms) ? entry.grammarNotes.exampleForms : []),
  ]).flatMap(value => {
    const token = normalizeEnglishToken(value);
    const lemma = toEnglishPhraseLemma(value);
    return token === lemma ? [token] : [token, lemma];
  }).filter(Boolean);
}

export function buildExpressionIndex(entries = []) {
  const index = new Map();
  entries.forEach(raw => {
    const entry = withStableClassification(raw);
    expressionLookupKeys(entry).forEach(key => {
      const matches = index.get(key) || [];
      if (!matches.some(match => match.id === entry.id)) matches.push(entry);
      index.set(key, matches);
    });
  });
  return index;
}

export function findExpressionMatches(value, entriesOrIndex = []) {
  const index = entriesOrIndex instanceof Map
    ? entriesOrIndex
    : buildExpressionIndex(entriesOrIndex);
  const token = normalizeEnglishToken(value);
  const lemma = toEnglishPhraseLemma(value);
  const matches = [...(index.get(token) || []), ...(index.get(lemma) || [])];
  return [...new Map(matches.map(entry => [entry.id, entry])).values()];
}

export function isUsefulLinkedToken(value, entriesOrIndex = []) {
  const token = normalizeEnglishToken(value);
  if (!token) return false;
  const matches = findExpressionMatches(token, entriesOrIndex);
  return matches.length > 0 && (!FUNCTION_WORDS.has(token) || matches.some(entry => entry.linkFunctionWord));
}

export function tokenizeEnglishForLinks(text, entriesOrIndex = null) {
  const source = String(text || '');
  if (entriesOrIndex) {
    const index = entriesOrIndex instanceof Map
      ? entriesOrIndex
      : buildExpressionIndex(entriesOrIndex);
    const words = [...source.matchAll(/[A-Za-z]+(?:['’][A-Za-z]+)?/g)];
    if (!words.length) return source ? [{ text: source, token: '' }] : [];

    const parts = [];
    let cursor = 0;
    let wordIndex = 0;
    while (wordIndex < words.length) {
      const start = words[wordIndex].index;
      let matchedEnd = wordIndex;
      let matchedToken = '';
      const maxEnd = Math.min(words.length - 1, wordIndex + 5);

      for (let end = maxEnd; end >= wordIndex; end -= 1) {
        let hasOnlyPhraseSeparators = true;
        for (let gap = wordIndex; gap < end; gap += 1) {
          const between = source.slice(
            words[gap].index + words[gap][0].length,
            words[gap + 1].index
          );
          if (!/^[\s-]+$/.test(between)) {
            hasOnlyPhraseSeparators = false;
            break;
          }
        }
        if (!hasOnlyPhraseSeparators) continue;
        const endOffset = words[end].index + words[end][0].length;
        const candidate = source.slice(start, endOffset);
        if (isUsefulLinkedToken(candidate, index)) {
          matchedEnd = end;
          matchedToken = normalizeEnglishToken(candidate);
          break;
        }
      }

      if (start > cursor) parts.push({ text: source.slice(cursor, start), token: '' });
      const endOffset = words[matchedEnd].index + words[matchedEnd][0].length;
      parts.push({
        text: source.slice(start, endOffset),
        token: matchedToken || normalizeEnglishToken(words[wordIndex][0]),
      });
      cursor = endOffset;
      wordIndex = matchedEnd + 1;
    }
    if (cursor < source.length) parts.push({ text: source.slice(cursor), token: '' });
    return parts;
  }

  const parts = source.split(/([A-Za-z]+(?:['’][A-Za-z]+)?)/g);
  return parts.filter(part => part !== '').map(part => ({
    text: part,
    token: /^[A-Za-z]/.test(part) ? normalizeEnglishToken(part) : '',
  }));
}

export function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(value => normalizeAtlasLabel(value))
    .filter(Boolean))];
}
