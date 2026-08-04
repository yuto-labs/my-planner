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

// Categories are intentionally fixed and semantic. Work, study, and daily
// life remain searchable usage contexts instead of competing taxonomies.
export const NUANCE_ATLAS_CATEGORIES = Object.freeze([
  '感情・感覚',
  '思考・認識',
  '意思・判断',
  '対人・伝達',
  '行動・変化',
  '状態・性質',
  '程度・量・評価',
  '時間・順序・頻度',
  '空間・位置・移動',
  '関係・原因・目的',
]);

const LEGACY_CATEGORY_MAP = new Map([
  ['感情', '感情・感覚'],
  ['対人関係', '対人・伝達'],
  ['意思・判断', '意思・判断'],
  ['程度・評価', '程度・量・評価'],
  ['時間・頻度', '時間・順序・頻度'],
]);

const CATEGORY_RULES = [
  ['空間・位置・移動', /空間|位置|場所|方向|移動|距離|内側|外側|近[いく]|遠[いく]|到達|通過|space|position|movement|direction|distance|inside|outside|arriv|pass/],
  ['時間・順序・頻度', /時間|頻度|期間|順序|時期|一時|反復|継続|直前|直後|遅延|同時|time|frequency|often|always|soon|late|before|after/],
  ['関係・原因・目的', /原因|結果|目的|手段|条件|対比|関係|依存|理由|because|cause|result|purpose|means|condition|contrast|depend/],
  ['程度・量・評価', /程度|量|評価|差|極端|十分|不足|価値|優劣|ばらつき|degree|amount|quality|value|better|worse|variance/],
  ['対人・伝達', /対人|会話|依頼|断り|謝罪|感謝|挨拶|説得|同意|反対|礼儀|polite|request|apolog|thank|conversation|persuad/],
  ['意思・判断', /意思|判断|意見|選択|決定|希望|確信|迷い|賛成|反対|decision|opinion|prefer|intend|choose|certain/],
  ['思考・認識', /思考|認識|理解|気づき|視点|記憶|推測|知識|学習|考え|think|know|understand|notice|view|memory|learn/],
  ['感情・感覚', /感情|喜|悲|怒|恐|不安|安心|眠|疲|痛|驚|emotion|happy|sad|angry|fear|feel|sleep|tired|pain/],
  ['状態・性質', /状態|性質|安定|混乱|準備|疲労|不足|性格|特徴|condition|state|trait|stable|confus|ready|lack/],
  ['行動・変化', /行動|変化|開始|終了|中断|回避|達成|進行|動作|action|change|start|finish|stop|avoid|achiev|move/],
];

function classificationContext(value, context = '') {
  return `${normalizeAtlasLabel(value)} ${normalizeAtlasLabel(context)}`.toLocaleLowerCase();
}

export function normalizeAtlasCategory(value, context = '') {
  const raw = normalizeAtlasLabel(value);
  if (!raw) return '';
  if (NUANCE_ATLAS_CATEGORIES.includes(raw)) return raw;
  if (LEGACY_CATEGORY_MAP.has(raw)) return LEGACY_CATEGORY_MAP.get(raw);

  const text = classificationContext(raw, context);
  if (raw === '行動・状態') {
    const topicText = classificationContext('', context);
    return /状態|性質|安定|混乱|準備|疲労|不足|性格|特徴|眠|condition|state|trait|stable|confus|ready|lack|sleep|tired/.test(topicText)
      ? '状態・性質'
      : '行動・変化';
  }
  if (raw === '仕事・学習') {
    return CATEGORY_RULES.find(([category]) => category === '対人・伝達')?.[1].test(text)
      ? '対人・伝達'
      : '思考・認識';
  }
  if (raw === '日常生活') {
    return CATEGORY_RULES.find(([category]) => category === '状態・性質')?.[1].test(text)
      ? '状態・性質'
      : '行動・変化';
  }
  return CATEGORY_RULES.find(([, pattern]) => pattern.test(text))?.[0] || '状態・性質';
}

export function normalizeAtlasTopic(value, category = '') {
  const raw = normalizeAtlasLabel(value);
  if (!raw) return '';
  const topic = raw
    .replace(/(?:を)?表す(?:英語)?表現$/u, '')
    .replace(/(?:英語)?表現$/u, '')
    .replace(/(?:の)?言い方$/u, '')
    .replace(/(?:の)?場面$/u, '')
    .trim();
  const normalizedCategory = normalizeAtlasLabel(category);
  if (!topic || topic === normalizedCategory) return '';
  return topic;
}

export function isValidAtlasTopic(value, category = '') {
  const topic = normalizeAtlasTopic(value, category);
  return Boolean(topic)
    && Array.from(topic).length >= 2
    && Array.from(topic).length <= 24
    && !/[。！？!?]/u.test(topic);
}

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
  const rawCategory = normalizeAtlasLabel(record.category);
  const category = normalizeAtlasCategory(
    rawCategory,
    [record.topic, record.sourceQueryJa, record.sourceTextJa, record.term, record.lemma].filter(Boolean).join(' ')
  );
  const topic = normalizeAtlasLabel(record.topic);
  const migratedCategory = rawCategory && rawCategory !== category;
  return {
    ...record,
    category,
    topic,
    categoryId: migratedCategory ? stableAtlasId('cat', category) : (record.categoryId || stableAtlasId('cat', category)),
    topicId: record.topicId || stableAtlasId('topic', `${category}-${topic}`),
    categoryAliases: uniqueStrings([
      ...(record.categoryAliases || []),
      ...(migratedCategory ? [rawCategory] : []),
    ]),
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
