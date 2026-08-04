import test from 'node:test';
import assert from 'node:assert/strict';

const { reuseEquivalentAtlasTopic } = await import('../js/ai.js');

test('keeps expressions that cause fear distinct from fear and anxiety', () => {
  const taxonomy = [{
    category: '感情',
    topicRecords: [{ label: '恐怖・不安', aliases: ['恐れ'] }],
  }];

  const result = reuseEquivalentAtlasTopic(
    taxonomy,
    '感情',
    '怖がらせる・恐怖を与える表現',
    '人を怖がらせる英語表現'
  );

  assert.deepEqual(result, { category: '感情・感覚', topic: '怖がらせる・恐怖を与える表現' });
});

test('keeps a new topic when no equivalent taxonomy topic exists', () => {
  const result = reuseEquivalentAtlasTopic(
    [{ category: '感情', topicRecords: [{ label: '喜び', aliases: [] }] }],
    '感情',
    '驚き',
    'surprise expressions'
  );

  assert.deepEqual(result, { category: '感情・感覚', topic: '驚き' });
});
