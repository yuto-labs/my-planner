import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeKnowledgeAnswer,
  normalizeKnowledgeRichBlocks,
  knowledgeAnswerText,
  validateKnowledgeEntry,
  buildKnowledgeConceptIndex,
  findKnowledgeConceptMatches,
  findDuplicateKnowledgeEntries,
  hasDistinctKnowledgeQuestion,
  getKnowledgeTimelineBucket,
} from '../js/knowledge-model.js';
import { getLearningCountryCodes } from '../js/data/learning-geography.js';
import { serializeLearningTaxonomyForAI } from '../js/data/learning-taxonomy.js';

function rawAnswer(overrides = {}) {
  const paragraph = '空気中の分子は、太陽光のうち波長が短い青い光を赤い光より強く散乱します。'
    + 'この散乱光が空の広い方向から目に届くため、晴れた昼の空は青く見えます。'
    + 'ただし太陽そのものの色が青く変わったわけではなく、光が大気を通る過程で方向ごとの見え方が変わっています。';
  return {
    title: '空が青く見える理由',
    classification: {
      majorId: 'natural_sciences',
      middleId: 'physics',
      specialty: '光学',
      relatedCategoryIds: ['atmospheric_science'],
    },
    primaryConcept: {
      key: 'rayleigh-scattering',
      label: 'レイリー散乱',
      aliases: ['Rayleigh scattering'],
      role: 'primary',
    },
    concepts: [{
      key: 'rayleigh-scattering',
      label: 'レイリー散乱',
      aliases: ['Rayleigh scattering'],
      role: 'primary',
    }],
    facets: {
      periods: [], regions: [], people: [], organizations: [], works: [], systems: [],
    },
    answer: {
      directAnswer: [{ text: '**空が青いのは**、短い波長の光が強く散乱されるためです。', marks: ['strong'], conceptKey: '' }],
      keyPoints: ['短い波長ほど強く散乱される', '青い光が空の広い方向から目に届く', '夕方は光が通る距離が長くなる'],
      sections: [
        { heading: '光が大気を通るとき', paragraphs: [[{ text: paragraph.repeat(12), marks: ['highlight-blue'], conceptKey: 'rayleigh-scattering' }]] },
      ],
      cautions: [],
    },
    ...overrides,
  };
}

test('hides an original question that merely repeats its generated title', () => {
  assert.equal(hasDistinctKnowledgeQuestion('血が赤い理由', '血が赤い理由って何？'), false);
  assert.equal(hasDistinctKnowledgeQuestion('血液の色を決める仕組み', 'なぜ静脈は青く見えるの？'), true);
  assert.equal(hasDistinctKnowledgeQuestion('空が青い理由', '空が青い理由'), false);
});

test('normalizes structured answers without leaking Markdown', () => {
  const entry = normalizeKnowledgeAnswer(rawAnswer(), 'なぜ空は青いの？');
  assert.equal(entry.answer.directAnswer[0].text.includes('**'), false);
  assert.equal(entry.answer.directAnswer[0].marks[0], 'strong');
  assert.equal(entry.answer.keyPoints.length, 3);
  assert.equal(validateKnowledgeEntry(entry).valid, true);
});

test('normalizes safe rich knowledge blocks without changing legacy paragraphs', () => {
  const raw = rawAnswer();
  raw.answer.sections[0].richBlocks = [
    {
      type: 'list', style: 'numbered', title: '確認順序',
      items: [[{ text: '光源を確認する', conceptKey: 'rayleigh-scattering' }], [{ text: '散乱を見る' }]],
    },
    {
      type: 'table', caption: '波長の比較', headers: ['光', '散乱'],
      rows: [['青', '強い'], ['赤', '弱い', '余分なセル']],
    },
    {
      type: 'equation', latex: 'I \\propto 1 / \\lambda^4',
      plainText: '散乱強度は波長の4乗に反比例する',
      explanation: [{ text: '波長が短いほど強く散乱される' }],
    },
    {
      type: 'flow', title: '見えるまで', altText: '太陽光が散乱して目に届く',
      nodes: [{ id: 'sun', label: '太陽光' }, { id: 'eye', label: '目' }],
      edges: [{ from: 'sun', to: 'eye', label: '散乱して届く' }],
    },
  ];
  const entry = normalizeKnowledgeAnswer(raw, 'なぜ空は青いの？');
  const rich = entry.answer.sections[0].richBlocks;
  assert.deepEqual(rich.map(block => block.type), ['list', 'table', 'equation', 'flow']);
  assert.deepEqual(rich[1].rows[1], ['赤', '弱い']);
  assert.match(knowledgeAnswerText(entry), /散乱強度は波長の4乗に反比例する/);
  assert.equal(validateKnowledgeEntry(entry).valid, true);
});

test('drops malformed rich blocks and keeps valid nearby content', () => {
  const blocks = normalizeKnowledgeRichBlocks([
    { type: 'table', headers: ['only one'], rows: [['x']] },
    { type: 'equation', latex: '', plainText: 'missing formula' },
    { type: 'flow', nodes: [{ id: 'a', label: 'A' }], edges: [] },
    { type: 'callout', tone: 'warning', title: '**注意**', segments: [{ text: '**例外があります**' }] },
    { type: 'unknown', text: '<script>bad</script>' },
  ]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'callout');
  assert.equal(blocks[0].title, '注意');
  assert.equal(blocks[0].segments[0].text, '例外があります');
});

test('validates concept links inside rich block segments', () => {
  const raw = rawAnswer();
  raw.answer.sections[0].richBlocks = [{
    type: 'callout', tone: 'definition', title: '定義',
    segments: [{ text: '未登録概念', conceptKey: 'missing-concept' }],
  }];
  const entry = normalizeKnowledgeAnswer(raw, 'なぜ空は青いの？');
  assert.equal(validateKnowledgeEntry(entry).errors.includes('danglingConceptKey'), true);
});

test('keeps legacy knowledge answers valid without generated key points', () => {
  const raw = rawAnswer();
  delete raw.answer.keyPoints;
  const entry = normalizeKnowledgeAnswer(raw, 'なぜ空は青いの？');
  assert.deepEqual(entry.answer.keyPoints, []);
  assert.equal(validateKnowledgeEntry(entry).valid, true);
});

test('invalid classification safely falls back to unclassified', () => {
  const raw = rawAnswer();
  raw.classification = { majorId: 'invented', middleId: 'also-invented' };
  const entry = normalizeKnowledgeAnswer(raw, '質問');
  assert.deepEqual(
    [entry.classification.majorId, entry.classification.middleId],
    ['interdisciplinary', 'unclassified']
  );
});

test('a mismatched major and middle classification safely falls back', () => {
  const raw = rawAnswer();
  raw.classification = { majorId: 'humanities', middleId: 'physics' };
  const entry = normalizeKnowledgeAnswer(raw, '質問');
  assert.deepEqual(
    [entry.classification.majorId, entry.classification.middleId],
    ['interdisciplinary', 'unclassified']
  );
});

test('AI taxonomy includes readable labels and valid child relationships', () => {
  const taxonomy = serializeLearningTaxonomyForAI();
  const naturalSciences = taxonomy.find(group => group.id === 'natural_sciences');
  assert.equal(naturalSciences.label, '自然科学');
  assert.deepEqual(
    naturalSciences.children.find(item => item.id === 'physics'),
    { id: 'physics', label: '物理学' }
  );
});

test('normalizes dated geography for the new knowledge browser', () => {
  const raw = rawAnswer({
    timeline: { mode: 'dated', startYear: 1961, endYear: 1963, precision: 'year', label: 'early space age' },
    geography: { scope: 'country', regionIds: ['north_america'], countryCodes: ['us', 'zz'] },
  });
  const entry = normalizeKnowledgeAnswer(raw, 'timeline question');
  assert.deepEqual(entry.geography.countryCodes, ['US']);
  assert.deepEqual(entry.geography.regionIds, ['north_america']);
  assert.deepEqual(getKnowledgeTimelineBucket(entry), {
    mode: 'dated', era: 'ce', century: 20, decade: 1960, startYear: 1961, endYear: 1963,
  });
});

test('ships the complete country code set without pseudo-region codes', () => {
  const codes = getLearningCountryCodes();
  assert.equal(codes.length, 249);
  assert.equal(new Set(codes).size, 249);
  assert.equal(codes.includes('KP'), true);
  assert.equal(codes.includes('MU'), true);
});

test('country metadata wins over contradictory world scope', () => {
  const entry = normalizeKnowledgeAnswer(rawAnswer({
    geography: { scope: 'global', regionIds: ['world'], countryCodes: ['JP'] },
  }), 'country scope');
  assert.equal(entry.geography.scope, 'country');
  assert.deepEqual(entry.geography.regionIds, ['east_asia']);
  assert.deepEqual(entry.geography.countryCodes, ['JP']);
});

test('keeps malformed timeline metadata safely unclassified', () => {
  const entry = normalizeKnowledgeAnswer(rawAnswer({
    timeline: { mode: 'dated', startYear: 0, endYear: 1960 },
    geography: { scope: 'country', countryCodes: ['invalid'] },
  }), 'safe legacy fallback');
  assert.equal(entry.timeline.mode, 'unclassified');
  assert.deepEqual(entry.geography.countryCodes, []);
});

test('a concept becomes linkable after a matching entry is added later', () => {
  const first = normalizeKnowledgeAnswer(rawAnswer(), 'なぜ空は青いの？');
  first.id = 'sky';
  const second = normalizeKnowledgeAnswer(rawAnswer({ title: 'レイリー散乱', concepts: [{
    key: 'rayleigh-scattering',
    label: 'レイリー散乱',
    aliases: ['Rayleigh scattering'],
    role: 'primary',
  }] }), 'レイリー散乱とは？');
  second.id = 'rayleigh';
  const index = buildKnowledgeConceptIndex([first, second]);
  const matches = findKnowledgeConceptMatches(index, {
    key: 'rayleigh-scattering',
    label: 'レイリー散乱',
  });
  assert.deepEqual(matches.map(entry => entry.id).sort(), ['rayleigh', 'sky']);
});

test('finds exact duplicate questions without matching unrelated wording', () => {
  const entry = normalizeKnowledgeAnswer(rawAnswer(), 'なぜ空は青いの？');
  entry.id = 'sky';
  assert.equal(findDuplicateKnowledgeEntries([entry], ' なぜ空は青いの？ ').length, 1);
  assert.equal(findDuplicateKnowledgeEntries([entry], '夕焼けはなぜ赤いの？').length, 0);
});

test('an edited display title does not block a distinct new question', () => {
  const entry = normalizeKnowledgeAnswer(rawAnswer(), 'なぜ空は青いの？');
  entry.id = 'sky';
  entry.title = '光の散乱';
  assert.equal(findDuplicateKnowledgeEntries([entry], '光の散乱').length, 0);
});

test('rejects concept links that are absent from the concept list', () => {
  const raw = rawAnswer();
  raw.answer.sections[0].paragraphs[0][0].conceptKey = 'missing-concept';
  const entry = normalizeKnowledgeAnswer(raw, 'なぜ空は青いの？');
  assert.equal(validateKnowledgeEntry(entry).errors.includes('danglingConceptKey'), true);
});
