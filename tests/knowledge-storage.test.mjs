import test from 'node:test';
import assert from 'node:assert/strict';

const values = new Map();
globalThis.localStorage = {
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); },
};

const {
  addExpressionEntries,
  addExpressionEntriesWithReport,
  addLearningEntry,
  addTranslationSet,
  deleteLearningEntry,
  getExpressionEntries,
  getLearningEntries,
  getKnowledgeMemos,
  getTranslationSets,
  getTrashItems,
  importBackup,
  restoreTrashItem,
  saveExpressionEntries,
} = await import('../js/storage.js');

function entry(id, title, updatedAt = '2026-07-27T10:00:00.000Z') {
  return {
    id,
    title,
    originalQuestion: `${title}とは？`,
    classification: {
      majorId: 'natural_sciences',
      middleId: 'physics',
      specialty: '',
      relatedCategoryIds: [],
    },
    concepts: [],
    facets: {},
    answer: {
      directAnswer: [{ text: '回答', marks: [], conceptKey: '' }],
      sections: [],
      cautions: [],
    },
    updatedAt,
  };
}

test.beforeEach(() => values.clear());

test('learning writes preserve ordinary memo records', () => {
  localStorage.setItem('mp_knowledge', JSON.stringify([{
    id: 'memo-1',
    title: '既存メモ',
    summary: '残す',
    tags: [],
    blocks: [{ id: 'text-1', type: 'text', content: '本文' }],
    createdAt: '2026-07-27T09:00:00.000Z',
    updatedAt: '2026-07-27T09:00:00.000Z',
  }]));

  assert.ok(addLearningEntry(entry('learning-1', '空の色')));
  assert.equal(getKnowledgeMemos().length, 1);
  assert.equal(getKnowledgeMemos()[0].title, '既存メモ');
  assert.equal(getLearningEntries().length, 1);
});

test('atlas writes preserve memos, learning entries, and other atlas record types', () => {
  localStorage.setItem('mp_knowledge', JSON.stringify([{
    id: 'memo-1',
    title: '既存メモ',
    summary: '残す',
    tags: [],
    blocks: [{ id: 'text-1', type: 'text', content: '本文' }],
    createdAt: '2026-07-27T09:00:00.000Z',
    updatedAt: '2026-07-27T09:00:00.000Z',
  }]));
  assert.ok(addLearningEntry(entry('learning-1', '空の色')));
  assert.equal(addExpressionEntries([{
    term: 'relief',
    lemma: 'relief',
    category: '感情',
    topic: '安心',
    coreMeaningJa: '緊張や苦痛が和らぐこと',
  }]).length, 1);
  assert.ok(addTranslationSet({
    sourceTextJa: 'ほっとした。',
    category: '感情',
    topic: '安心',
    variants: [{ translation: 'I felt relieved.' }],
  }));

  assert.equal(getKnowledgeMemos().length, 1);
  assert.equal(getLearningEntries().length, 1);
  assert.equal(getExpressionEntries().length, 1);
  assert.equal(getTranslationSets().length, 1);
});

test('atlas updates preserve every Japanese and English source query as a search alias', () => {
  const base = {
    term: 'bother',
    lemma: 'bother',
    category: '感情・感覚',
    topic: '面倒・煩わしさ',
    senseId: 'annoy-inconvenience',
    coreMeaningJa: '人の注意や平穏に割り込んで負担を生じさせる。',
  };
  assert.equal(addExpressionEntries([{
    ...base,
    sourceQueryJa: 'bother',
    sourceQueries: ['bother'],
  }]).length, 1);
  assert.equal(addExpressionEntries([{
    ...base,
    sourceQueryJa: '面倒',
    sourceQueries: ['面倒'],
  }]).length, 1);

  const [saved] = getExpressionEntries();
  assert.equal(saved.sourceQueryJa, 'bother');
  assert.deepEqual(saved.sourceQueries.sort(), ['bother', '面倒'].sort());
});

test('repeated Atlas queries keep distinct same-POS senses despite classification drift', () => {
  const [first] = addExpressionEntries([{
    term: 'nudge',
    lemma: 'nudge',
    partOfSpeech: 'verb',
    category: 'Action',
    topic: 'Gentle movement',
    senseId: 'small-push',
    sourceQueryJa: 'nudge',
    sourceQueries: ['nudge'],
    coreMeaningJa: 'A',
  }]);
  const [second] = addExpressionEntries([{
    term: 'nudge',
    lemma: 'nudge',
    partOfSpeech: 'verb',
    category: 'Communication',
    topic: 'Gentle prompting',
    senseId: 'prompt-gently',
    sourceQueryJa: 'nudge',
    sourceQueries: ['nudge'],
    coreMeaningJa: 'B',
  }]);

  assert.equal(second.id, first.id);
  assert.equal(getExpressionEntries().filter(entry => entry.lemma === 'nudge').length, 1);
  assert.equal(getExpressionEntries().find(entry => entry.id === first.id)?.senses.length, 2);
});

test('same sense id cannot merge physical and figurative uses', () => {
  addExpressionEntries([{
    term: 'nudge', lemma: 'nudge', partOfSpeech: 'verb', senseId: 'gentle-movement',
    coreMeaningJa: '人や物を身体的にそっと押す', nuanceJa: 'physical'.repeat(30),
    senseFingerprint: {
      semanticDomain: 'movement', actionType: 'light-contact', physicality: 'physical',
      argumentPatterns: ['nudge someone'], typicalObjects: ['person', 'object'],
      implicationTags: ['gentle'], registerTags: ['neutral'],
    },
  }]);
  addExpressionEntries([{
    term: 'nudge', lemma: 'nudge', partOfSpeech: 'verb', senseId: 'gentle-movement',
    coreMeaningJa: '相手に控えめな働きかけをして行動を促す', nuanceJa: 'figurative'.repeat(30),
    senseFingerprint: {
      semanticDomain: 'influence', actionType: 'indirect-prompting', physicality: 'figurative',
      argumentPatterns: ['nudge someone to do'], typicalObjects: ['person', 'decision'],
      implicationTags: ['indirect'], registerTags: ['neutral'],
    },
  }]);

  const [saved] = getExpressionEntries().filter(item => item.lemma === 'nudge');
  assert.equal(saved.senses.length, 2);
  assert.deepEqual(saved.senses.map(sense => sense.senseFingerprint.physicality).sort(), ['figurative', 'physical']);
});

test('physicality label variants normalize before sense comparison', () => {
  addExpressionEntries([{
    term: 'frame', lemma: 'frame', partOfSpeech: 'verb', senseId: 'present-perspective',
    coreMeaningJa: '見方を形づくる', nuanceJa: 'first'.repeat(30),
    senseFingerprint: {
      semanticDomain: 'communication', actionType: 'presentation', physicality: 'metaphorical',
      argumentPatterns: ['frame something as'], typicalObjects: ['idea'],
    },
  }]);
  addExpressionEntries([{
    term: 'frame', lemma: 'frame', partOfSpeech: 'verb', senseId: 'present-perspective',
    coreMeaningJa: 'ある見方になるよう情報を提示する', nuanceJa: 'second'.repeat(40),
    senseFingerprint: {
      semanticDomain: 'communication', actionType: 'presentation', physicality: '比喩的',
      argumentPatterns: ['frame something as'], typicalObjects: ['idea'],
    },
  }]);

  const [saved] = getExpressionEntries().filter(item => item.lemma === 'frame');
  assert.equal(saved.senses.length, 1);
  assert.equal(saved.senses[0].senseFingerprint.physicality, 'figurative');
});

test('matching fingerprints enrich a sense despite a changed generated sense id', () => {
  addExpressionEntries([{
    term: 'nudge', lemma: 'nudge', partOfSpeech: 'verb', senseId: 'prompt-gently',
    coreMeaningJa: '相手に控えめに働きかけて行動を促す', nuanceJa: 'first'.repeat(30),
    senseFingerprint: {
      semanticDomain: 'influence', actionType: 'indirect-prompting', physicality: 'figurative',
      argumentPatterns: ['nudge someone to do'], typicalObjects: ['person'],
      implicationTags: ['indirect'], registerTags: ['neutral'],
    },
  }]);
  addExpressionEntries([{
    term: 'nudge', lemma: 'nudge', partOfSpeech: 'verb', senseId: 'encourage-subtly',
    coreMeaningJa: '強制せずに控えめな働きかけで相手の行動を促す', nuanceJa: 'second'.repeat(50),
    senseFingerprint: {
      semanticDomain: 'influence', actionType: 'indirect-prompting', physicality: 'figurative',
      argumentPatterns: ['nudge someone to do'], typicalObjects: ['person'],
      implicationTags: ['indirect', 'gentle'], registerTags: ['neutral'],
    },
  }]);

  const [saved] = getExpressionEntries().filter(item => item.lemma === 'nudge');
  assert.equal(saved.senses.length, 1);
  assert.equal(saved.senses[0].nuanceJa, 'second'.repeat(50));
  assert.deepEqual(saved.senses[0].senseFingerprint.implicationTags.sort(), ['gentle', 'indirect']);
});

test('a shared grammar pattern alone does not collapse different same-POS senses', () => {
  addExpressionEntries([{
    term: 'run', lemma: 'run', partOfSpeech: 'verb', senseId: 'operate-machine',
    coreMeaningJa: '機械や仕組みを作動させる', nuanceJa: 'machine'.repeat(30),
    senseFingerprint: {
      semanticDomain: 'operation', actionType: 'causing-operation', physicality: 'abstract',
      argumentPatterns: ['run something'], typicalObjects: ['machine'],
      implicationTags: ['operation'], registerTags: ['neutral'],
    },
  }]);
  addExpressionEntries([{
    term: 'run', lemma: 'run', partOfSpeech: 'verb', senseId: 'manage-organization',
    coreMeaningJa: '組織や事業を運営する', nuanceJa: 'business'.repeat(30),
    senseFingerprint: {
      semanticDomain: 'management', actionType: 'causing-operation', physicality: 'abstract',
      argumentPatterns: ['run something'], typicalObjects: ['organization'],
      implicationTags: ['management'], registerTags: ['neutral'],
    },
  }]);

  const [saved] = getExpressionEntries().filter(item => item.lemma === 'run');
  assert.equal(saved.senses.length, 2);
});

test('repeating fully covered Atlas content reports already covered instead of failing', () => {
  const item = {
    term: 'bother', lemma: 'bother', partOfSpeech: 'verb', senseId: 'cause-trouble',
    coreMeaningJa: '人に手間や不快感を与える', nuanceJa: 'detail'.repeat(40),
    examples: [{ source: 'Sorry to bother you.', translation: '邪魔をしてすみません。' }],
    senseFingerprint: {
      semanticDomain: 'inconvenience', actionType: 'cause-discomfort', physicality: 'abstract',
      argumentPatterns: ['bother someone'], typicalObjects: ['person'],
      implicationTags: ['inconvenience'], registerTags: ['neutral'],
    },
  };
  const first = addExpressionEntriesWithReport([item]);
  const repeated = addExpressionEntriesWithReport([item]);

  assert.equal(first.created, 1);
  assert.equal(repeated.entries.length, 1);
  assert.equal(repeated.alreadyCovered, 1);
  assert.equal(repeated.enriched, 0);
});

test('new examples enrich an existing broad sense without adding another sense toggle', () => {
  const base = {
    term: 'bother', lemma: 'bother', partOfSpeech: 'verb', senseId: 'cause-trouble',
    coreMeaningJa: '人に手間や不快感を与える', nuanceJa: 'detail'.repeat(40),
    examples: [{ source: 'Sorry to bother you.', translation: '邪魔をしてすみません。' }],
    senseFingerprint: {
      semanticDomain: 'inconvenience', actionType: 'cause-discomfort', physicality: 'abstract',
      argumentPatterns: ['bother someone'], typicalObjects: ['person'],
      implicationTags: ['inconvenience'], registerTags: ['neutral'],
    },
  };
  addExpressionEntriesWithReport([base]);
  const enriched = addExpressionEntriesWithReport([{
    ...base,
    examples: [
      ...base.examples,
      { source: "Don't bother calling.", translation: 'わざわざ電話しなくていい。' },
    ],
  }]);

  assert.equal(enriched.enriched, 1);
  const [saved] = getExpressionEntries().filter(item => item.lemma === 'bother');
  assert.equal(saved.senses.length, 1);
  assert.equal(saved.senses[0].examples.length, 2);
});

test('repeated Atlas queries keep different parts of speech as senses of one headword', () => {
  addExpressionEntries([{
    term: 'draft', lemma: 'draft', partOfSpeech: 'noun', category: 'Writing', topic: 'Draft',
    senseId: 'preliminary-text', sourceQueryJa: 'draft', sourceQueries: ['draft'],
  }]);
  addExpressionEntries([{
    term: 'draft', lemma: 'draft', partOfSpeech: 'verb', category: 'Writing', topic: 'Draft',
    senseId: 'write-preliminary', sourceQueryJa: 'draft', sourceQueries: ['draft'],
  }]);

  const matches = getExpressionEntries().filter(entry => entry.lemma === 'draft');
  assert.equal(matches.length, 1);
  assert.deepEqual(matches[0].senses.map(sense => sense.partOfSpeech).sort(), ['noun', 'verb']);
});

test('a later range lookup enriches the saved verb and adds the noun to the same card', () => {
  addExpressionEntriesWithReport([{
    term: 'range', lemma: 'range', partOfSpeech: 'verb', senseId: 'arrange-in-line',
    sourceQueryJa: '並ぶ', coreMeaningJa: '物や人が一列に並ぶ', nuanceJa: 'line'.repeat(40),
    examples: [{ source: 'The hills range along the coast.', translation: '丘が海岸沿いに連なる。' }],
    senseFingerprint: {
      semanticDomain: 'spatial-arrangement', actionType: 'forming-a-line', physicality: 'physical',
      argumentPatterns: ['range along'], typicalObjects: ['landform'],
      implicationTags: ['continuous-arrangement'], registerTags: ['neutral'],
    },
  }]);

  const report = addExpressionEntriesWithReport([{
    term: 'range', lemma: 'range', partOfSpeech: 'verb', senseId: 'arrange-in-line',
    sourceQueryJa: 'range', coreMeaningJa: '物や人が一列または一定の広がりをもって並ぶ',
    nuanceJa: 'expanded-line'.repeat(40),
    examples: [
      { source: 'The hills range along the coast.', translation: '丘が海岸沿いに連なる。' },
      { source: 'The books range from basic to advanced.', translation: '本は基礎から上級まで幅がある。' },
    ],
    senseFingerprint: {
      semanticDomain: 'spatial-arrangement', actionType: 'forming-a-line', physicality: 'physical',
      argumentPatterns: ['range along', 'range from A to B'], typicalObjects: ['landform'],
      implicationTags: ['continuous-arrangement'], registerTags: ['neutral'],
    },
  }, {
    term: 'range', lemma: 'range', partOfSpeech: 'noun', senseId: 'extent-between-limits',
    sourceQueryJa: 'range', coreMeaningJa: '二つの限界の間に広がる範囲', nuanceJa: 'extent'.repeat(40),
    examples: [{ source: 'The price range is wide.', translation: '価格帯は広い。' }],
    senseFingerprint: {
      semanticDomain: 'extent', actionType: 'bounded-span', physicality: 'abstract',
      argumentPatterns: ['a range of', 'range between'], typicalObjects: ['value', 'choice'],
      implicationTags: ['limits'], registerTags: ['neutral'],
    },
  }]);

  const matches = getExpressionEntries().filter(entry => entry.lemma === 'range');
  assert.equal(matches.length, 1);
  assert.equal(report.enriched, 2);
  assert.deepEqual(matches[0].senses.map(sense => sense.partOfSpeech).sort(), ['noun', 'verb']);
  assert.equal(matches[0].senses.find(sense => sense.partOfSpeech === 'verb').examples.length, 2);
});

test('Japanese and English part-of-speech labels normalize without duplicating a sense', () => {
  addExpressionEntries([{
    term: 'range', lemma: 'range', partOfSpeech: '動詞', category: '動作', topic: '整列',
    senseId: 'stand-in-line', coreMeaningJa: '一列に並ぶ', nuanceJa: 'deep'.repeat(40),
  }]);
  addExpressionEntries([{
    term: 'range', lemma: 'range', partOfSpeech: 'verb', category: 'Action', topic: 'Alignment',
    senseId: 'stand-in-line', coreMeaningJa: '一列に並ぶ', nuanceJa: 'deep'.repeat(30),
  }]);

  const [saved] = getExpressionEntries().filter(entry => entry.lemma === 'range');
  assert.equal(saved.senses.length, 1);
  assert.equal(saved.senses[0].partOfSpeech, 'verb');
  assert.equal(saved.partOfSpeech, 'verb');
});

test('same headword in one topic merges without requiring identical sense ids or queries', () => {
  const [first] = addExpressionEntries([{
    term: 'range', lemma: 'range', partOfSpeech: 'noun', category: '状態・性質', topic: '分布と範囲',
    senseId: 'extent', sourceQueryJa: '分散', coreMeaningJa: '値が広がる範囲',
  }]);
  const [second] = addExpressionEntries([{
    term: 'range', lemma: 'range', partOfSpeech: 'verb', category: '状態・性質', topic: '分布と範囲',
    senseId: 'vary-between', sourceQueryJa: 'range', coreMeaningJa: '一定の範囲にわたる',
  }]);

  assert.equal(second.id, first.id);
  const [saved] = getExpressionEntries().filter(entry => entry.lemma === 'range');
  assert.equal(saved.senses.length, 2);
  assert.deepEqual(saved.senses.map(sense => sense.partOfSpeech).sort(), ['noun', 'verb']);
});

test('overlapping sense-id words do not collapse distinct meanings', () => {
  addExpressionEntries([{
    term: 'range', lemma: 'range', partOfSpeech: 'noun', category: '状態・性質', topic: '分布と範囲',
    senseId: 'extent-span', sourceQueryJa: '範囲', coreMeaningJa: '広がりの端から端までの範囲',
  }]);
  addExpressionEntries([{
    term: 'range', lemma: 'range', partOfSpeech: 'noun', category: '状態・性質', topic: '分布と範囲',
    senseId: 'value-extent', sourceQueryJa: '値の範囲', coreMeaningJa: '値が広がっている範囲',
  }]);
  addExpressionEntries([{
    term: 'range', lemma: 'range', partOfSpeech: 'noun', category: '状態・性質', topic: '分布と範囲',
    senseId: 'line-of-items', sourceQueryJa: '並び', coreMeaningJa: '物が一列に並んだもの',
  }]);

  const [saved] = getExpressionEntries().filter(entry => entry.lemma === 'range');
  assert.equal(saved.senses.length, 3);
  assert.ok(saved.senses.some(sense => sense.senseId === 'extent-span'));
  assert.ok(saved.senses.some(sense => sense.senseId === 'value-extent'));
  assert.ok(saved.senses.some(sense => sense.senseId === 'line-of-items'));
});

test('an exact sense id enriches the existing explanation without creating another toggle', () => {
  addExpressionEntries([{
    term: 'range', lemma: 'range', partOfSpeech: 'noun', category: 'Quantity', topic: 'Extent',
    senseId: 'extent-between-limits', coreMeaningJa: 'extent between limits',
    nuanceJa: 'first'.repeat(40), usagePatterns: [{ pattern: 'a range of + noun', meaningJa: '幅広い名詞', examples: [] }],
  }]);
  addExpressionEntries([{
    term: 'range', lemma: 'range', partOfSpeech: 'noun', category: 'Quantity', topic: 'Extent',
    senseId: 'extent-between-limits', coreMeaningJa: 'the span between lower and upper limits',
    nuanceJa: 'second'.repeat(60), usagePatterns: [{ pattern: 'range from A to B', meaningJa: 'AからBに及ぶ', examples: [] }],
  }]);

  const [saved] = getExpressionEntries().filter(entry => entry.lemma === 'range');
  assert.equal(saved.senses.length, 1);
  assert.equal(saved.senses[0].nuanceJa, 'second'.repeat(60));
  assert.equal(saved.senses[0].usagePatterns.length, 2);
});

test('sense-specific classifications remain available inside one headword', () => {
  addExpressionEntries([{
    term: 'range', lemma: 'range', partOfSpeech: 'noun', category: '状態・性質', topic: '範囲',
    senseId: 'extent-between-limits', coreMeaningJa: '範囲や幅',
  }]);
  addExpressionEntries([{
    term: 'range', lemma: 'range', partOfSpeech: 'verb', category: '行動・変化', topic: '整列',
    senseId: 'arrange-in-line', coreMeaningJa: '一列に並べる',
  }]);

  const [saved] = getExpressionEntries().filter(entry => entry.lemma === 'range');
  assert.equal(saved.senses.length, 2);
  assert.deepEqual(saved.senses.map(sense => `${sense.category}|${sense.topic}`).sort(), [
    '状態・性質|範囲',
    '行動・変化|整列',
  ].sort());
});

test('pre-existing duplicate headword records render as one complete card', () => {
  saveExpressionEntries([
    { id: 'legacy-a', term: 'range', lemma: 'range', category: '状態・性質', topic: '分布と範囲', senseId: 'extent' },
    { id: 'legacy-b', term: 'range', lemma: 'range', category: '状態・性質', topic: '分布と範囲', senseId: 'row' },
  ]);
  addExpressionEntries([{
    term: 'spread', lemma: 'spread', category: '状態・性質', topic: '分布と範囲', senseId: 'distribution',
  }]);

  const matches = getExpressionEntries().filter(entry => entry.lemma === 'range');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].senses.length, 2);
  assert.deepEqual(matches[0].mergedEntryIds, ['legacy-b']);
});

test('same lemma merges globally even when category and topic both differ', () => {
  const [first] = addExpressionEntries([{
    term: 'range', lemma: 'range', partOfSpeech: 'verb', category: 'Action', topic: 'Alignment',
    senseId: 'stand-in-line', coreMeaningJa: 'line up', nuanceJa: 'x'.repeat(120),
  }]);
  const [second] = addExpressionEntries([{
    term: 'range', lemma: 'range', partOfSpeech: 'noun', category: 'Quantity', topic: 'Extent',
    senseId: 'extent-between-limits', coreMeaningJa: 'extent between limits', nuanceJa: 'y'.repeat(140),
  }]);

  assert.equal(second.id, first.id);
  const matches = getExpressionEntries().filter(entry => entry.lemma === 'range');
  assert.equal(matches.length, 1);
  assert.deepEqual(matches[0].senses.map(sense => sense.partOfSpeech).sort(), ['noun', 'verb']);
  assert.equal(matches[0].senses.find(sense => sense.partOfSpeech === 'noun').nuanceJa.length, 140);
});

test('a shallower repeat cannot shorten an existing sense explanation', () => {
  addExpressionEntries([{
    term: 'range', lemma: 'range', partOfSpeech: 'noun', category: 'Quantity', topic: 'Extent',
    senseId: 'extent-between-limits', coreMeaningJa: 'extent between limits', nuanceJa: 'deep'.repeat(50),
  }]);
  addExpressionEntries([{
    term: 'range', lemma: 'range', partOfSpeech: 'noun', category: 'State', topic: 'Width',
    senseId: 'extent-between-limits', coreMeaningJa: 'extent', nuanceJa: 'short',
  }]);

  const [saved] = getExpressionEntries().filter(entry => entry.lemma === 'range');
  assert.equal(saved.senses.length, 1);
  assert.equal(saved.senses[0].nuanceJa, 'deep'.repeat(50));
});

test('atlas preserves legacy collocations and new Japanese meanings together', () => {
  const [saved] = addExpressionEntries([{
    term: 'monitor',
    lemma: 'monitor',
    category: '行動・状態',
    topic: '監視',
    senseId: 'observe-continuously',
    collocations: [
      'monitor closely',
      { expression: 'monitor progress', translationJa: '進捗を継続的に確認する' },
    ],
  }]);

  assert.deepEqual(saved.collocations, [
    'monitor closely',
    { expression: 'monitor progress', translationJa: '進捗を継続的に確認する' },
  ]);
  assert.deepEqual(getExpressionEntries().find(entry => entry.id === saved.id)?.collocations, saved.collocations);
});

test('a rich collocation upgrades the same legacy phrase without duplication', () => {
  addExpressionEntries([{
    term: 'monitor', lemma: 'monitor', senseId: 'observe-continuously',
    collocations: ['monitor progress'],
  }]);
  addExpressionEntries([{
    term: 'monitor', lemma: 'monitor', senseId: 'observe-continuously',
    collocations: [{
      expression: 'monitor progress',
      translationJa: '進捗を継続的に確認する',
      usageNoteJa: '時間を追って変化を確認するときに自然です。',
      examples: [{
        source: 'We monitor progress every week.',
        translation: '私たちは毎週進捗を確認します。',
        noteJa: '継続的な確認を表します。',
      }],
    }],
  }]);

  const [saved] = getExpressionEntries().filter(entry => entry.lemma === 'monitor');
  assert.equal(saved.senses[0].collocations.length, 1);
  assert.equal(saved.senses[0].collocations[0].examples.length, 1);
  assert.equal(saved.senses[0].collocations[0].usageNoteJa, '時間を追って変化を確認するときに自然です。');
});

test('learning deletion is recoverable from trash', () => {
  addLearningEntry(entry('learning-1', '空の色'));
  assert.equal(deleteLearningEntry('learning-1'), true);
  assert.equal(getLearningEntries().length, 0);
  const trashItem = getTrashItems()[0];
  assert.equal(trashItem.entityType, 'learning');
  assert.ok(restoreTrashItem(trashItem.id));
  assert.equal(getLearningEntries()[0].title, '空の色');
});

test('backup import merges learning entries without deleting local-only data', () => {
  addLearningEntry(entry('local-only', '端末にだけある項目'));
  importBackup(JSON.stringify({
    version: 5,
    learningEntries: [entry('from-backup', 'バックアップの項目')],
  }));
  assert.deepEqual(
    getLearningEntries().map(item => item.id).sort(),
    ['from-backup', 'local-only']
  );
});

test('backup import preserves local trash items omitted from the backup', () => {
  addLearningEntry(entry('learning-trash', '削除対象'));
  deleteLearningEntry('learning-trash');
  const localTrashId = getTrashItems()[0].id;
  importBackup(JSON.stringify({ version: 5, trash: [] }));
  assert.equal(getTrashItems().some(item => item.id === localTrashId), true);
});
