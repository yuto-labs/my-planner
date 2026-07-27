import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeKnowledgeAnswer,
  validateKnowledgeEntry,
  buildKnowledgeConceptIndex,
  findKnowledgeConceptMatches,
  findDuplicateKnowledgeEntries,
} from '../js/knowledge-model.js';

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
      sections: [
        { heading: '光が大気を通るとき', paragraphs: [[{ text: paragraph.repeat(12), marks: ['highlight-blue'], conceptKey: 'rayleigh-scattering' }]] },
      ],
      cautions: [],
    },
    ...overrides,
  };
}

test('normalizes structured answers without leaking Markdown', () => {
  const entry = normalizeKnowledgeAnswer(rawAnswer(), 'なぜ空は青いの？');
  assert.equal(entry.answer.directAnswer[0].text.includes('**'), false);
  assert.equal(entry.answer.directAnswer[0].marks[0], 'strong');
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
