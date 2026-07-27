import { LEARNING_MAJOR_BY_ID, LEARNING_MIDDLE_BY_ID } from './data/learning-taxonomy.js';

const ALLOWED_MARKS = new Set(['strong', 'highlight-yellow', 'highlight-blue', 'warning']);
const MARKDOWN_NOISE = /(\*\*|__|```|<\/?[a-z][^>]*>)/gi;

export function normalizeKnowledgeKey(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase()
    .replace(/[’'"]/g, '')
    .replace(/[‐‑‒–—―_\s]+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .replace(/^-+|-+$/g, '');
}

export function cleanKnowledgeText(value) {
  return String(value || '')
    .replace(MARKDOWN_NOISE, '')
    .replace(/\r\n?/g, '\n')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .trim();
}

function normalizeMarks(marks) {
  return [...new Set((Array.isArray(marks) ? marks : []).filter(mark => ALLOWED_MARKS.has(mark)))];
}

export function normalizeKnowledgeSegments(segments) {
  const input = Array.isArray(segments) ? segments : [{ text: segments }];
  return input
    .map(segment => ({
      text: cleanKnowledgeText(segment?.text ?? segment),
      marks: normalizeMarks(segment?.marks),
      conceptKey: normalizeKnowledgeKey(segment?.conceptKey),
    }))
    .filter(segment => segment.text);
}

function normalizeConcept(concept) {
  const label = cleanKnowledgeText(concept?.label || concept?.name);
  const key = normalizeKnowledgeKey(concept?.key || label);
  if (!key || !label) return null;
  return {
    key,
    label,
    aliases: [...new Set((Array.isArray(concept?.aliases) ? concept.aliases : [])
      .map(cleanKnowledgeText)
      .filter(Boolean))].slice(0, 8),
    role: ['primary', 'related'].includes(concept?.role) ? concept.role : 'related',
  };
}

function normalizeClassification(value = {}) {
  let majorId = String(value.majorId || '');
  let middleId = String(value.middleId || '');
  const middle = LEARNING_MIDDLE_BY_ID.get(middleId);
  if (!middle || middle.majorId !== majorId) {
    majorId = 'interdisciplinary';
    middleId = 'unclassified';
  }
  return {
    majorId,
    middleId,
    specialty: cleanKnowledgeText(value.specialty).slice(0, 60),
    relatedCategoryIds: [...new Set((Array.isArray(value.relatedCategoryIds)
      ? value.relatedCategoryIds
      : [])
      .filter(id => LEARNING_MIDDLE_BY_ID.has(id) && id !== middleId))].slice(0, 3),
  };
}

function normalizeFacets(value = {}) {
  const array = key => [...new Set((Array.isArray(value[key]) ? value[key] : [])
    .map(cleanKnowledgeText)
    .filter(Boolean))].slice(0, 12);
  return {
    periods: array('periods'),
    regions: array('regions'),
    people: array('people'),
    organizations: array('organizations'),
    works: array('works'),
    systems: array('systems'),
  };
}

export function normalizeKnowledgeAnswer(raw, question = '') {
  const concepts = (Array.isArray(raw?.concepts) ? raw.concepts : [])
    .map(normalizeConcept)
    .filter(Boolean);
  const primaryRaw = normalizeConcept(raw?.primaryConcept);
  const primaryConcept = primaryRaw
    || concepts.find(concept => concept.role === 'primary')
    || null;
  if (primaryConcept && !concepts.some(concept => concept.key === primaryConcept.key)) {
    concepts.unshift({ ...primaryConcept, role: 'primary' });
  }

  const sections = (Array.isArray(raw?.answer?.sections) ? raw.answer.sections : [])
    .map(section => ({
      heading: cleanKnowledgeText(section?.heading).slice(0, 80),
      paragraphs: (Array.isArray(section?.paragraphs) ? section.paragraphs : [])
        .map(normalizeKnowledgeSegments)
        .filter(paragraph => paragraph.length),
    }))
    .filter(section => section.paragraphs.length);

  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    title: cleanKnowledgeText(raw?.title || question).slice(0, 80),
    originalQuestion: cleanKnowledgeText(question || raw?.originalQuestion),
    titleSource: 'ai',
    titleEditedByUser: false,
    status: 'complete',
    classification: normalizeClassification(raw?.classification),
    primaryConcept,
    concepts,
    facets: normalizeFacets(raw?.facets),
    answer: {
      directAnswer: normalizeKnowledgeSegments(raw?.answer?.directAnswer),
      sections,
      cautions: (Array.isArray(raw?.answer?.cautions) ? raw.answer.cautions : [])
        .map(cleanKnowledgeText)
        .filter(Boolean)
        .slice(0, 6),
    },
    fieldUpdatedAt: {
      title: now,
      answer: now,
      classification: now,
    },
  };
}

export function knowledgeAnswerText(entry) {
  return [
    ...(entry?.answer?.directAnswer || []).map(segment => segment.text),
    ...(entry?.answer?.sections || []).flatMap(section => [
      section.heading || '',
      ...(section.paragraphs || []).flatMap(paragraph => paragraph.map(segment => segment.text)),
    ]),
    ...(entry?.answer?.cautions || []),
  ].filter(Boolean).join('\n');
}

export function validateKnowledgeEntry(entry) {
  const errors = [];
  if (!entry?.title) errors.push('title');
  if (!entry?.originalQuestion) errors.push('originalQuestion');
  if (!LEARNING_MAJOR_BY_ID.has(entry?.classification?.majorId)) errors.push('majorId');
  if (!LEARNING_MIDDLE_BY_ID.has(entry?.classification?.middleId)) errors.push('middleId');
  if (!(entry?.answer?.directAnswer || []).length) errors.push('directAnswer');
  if (!(entry?.answer?.sections || []).length) errors.push('sections');
  const conceptKeys = new Set((entry?.concepts || []).map(concept => concept?.key).filter(Boolean));
  if (!entry?.primaryConcept?.key) errors.push('primaryConcept');
  if (!conceptKeys.size) errors.push('concepts');
  if (entry?.primaryConcept?.key && !conceptKeys.has(entry.primaryConcept.key)) {
    errors.push('primaryConceptMissing');
  }
  const referencedKeys = [
    ...(entry?.answer?.directAnswer || []),
    ...(entry?.answer?.sections || []).flatMap(section => (
      (section.paragraphs || []).flatMap(paragraph => paragraph || [])
    )),
  ].map(segment => segment?.conceptKey).filter(Boolean);
  if (referencedKeys.some(key => !conceptKeys.has(key))) errors.push('danglingConceptKey');
  if (knowledgeAnswerText(entry).length < 900) errors.push('answerLength');
  return { valid: errors.length === 0, errors };
}

export function buildKnowledgeConceptIndex(entries) {
  const index = new Map();
  (Array.isArray(entries) ? entries : []).forEach(entry => {
    (entry.concepts || []).forEach(concept => {
      const keys = [concept.key, concept.label, ...(concept.aliases || [])]
        .map(normalizeKnowledgeKey)
        .filter(Boolean);
      keys.forEach(key => {
        if (!index.has(key)) index.set(key, []);
        if (!index.get(key).some(match => match.id === entry.id)) {
          index.get(key).push(entry);
        }
      });
    });
  });
  return index;
}

export function findKnowledgeConceptMatches(index, concept) {
  const keys = [concept?.key, concept?.label, ...(concept?.aliases || [])]
    .map(normalizeKnowledgeKey)
    .filter(Boolean);
  const matches = new Map();
  keys.forEach(key => (index.get(key) || []).forEach(entry => matches.set(entry.id, entry)));
  return [...matches.values()];
}

export function findDuplicateKnowledgeEntries(entries, question) {
  const key = normalizeKnowledgeKey(question);
  if (!key) return [];
  return (Array.isArray(entries) ? entries : []).filter(entry => (
    normalizeKnowledgeKey(entry.originalQuestion) === key
  ));
}
