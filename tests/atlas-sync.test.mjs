// 実際の保存処理で作った表現帳レコード(nuance-data)が、端末間同期で
// 意味を失わず、かつ同じ内容を何度も書き換え合わないことを守るテスト。
import test from 'node:test';
import assert from 'node:assert/strict';

// 端末ごとの保存領域を切り替えられる偽物のlocalStorage。
let values = new Map();
globalThis.localStorage = {
  get length() { return values.size; },
  key(index) { return [...values.keys()][index] ?? null; },
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); },
};

const { addExpressionEntriesWithReport, updateExpressionEntry } = await import('../js/storage.js');
const { mergeAtlasRecordsForSync } = await import('../js/sync.js');

/** Supabaseのjsonb保存と同じく、undefinedを落とした形へ往復させる。 */
const roundTrip = value => JSON.parse(JSON.stringify(value));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/** 指定した端末の保存領域で表現を追加し、その端末の表現帳レコードを返す。 */
function onDevice(device, action) {
  values = device;
  action();
  return JSON.parse(device.get('mp_knowledge') || '[]');
}

function sense(term, overrides) {
  return {
    term,
    lemma: term,
    category: '状態・性質',
    topic: '分布と範囲',
    useCasesJa: ['場面A', '場面B'],
    examples: [{ source: `${term} example.`, translation: '例文', noteJa: '注' }],
    comparisons: [{ term: 'scope', differenceJa: '違い' }],
    ...overrides,
  };
}

const extent = sense('range', {
  senseId: 'extent', partOfSpeech: 'noun',
  coreMeaningJa: '端から端までの幅や範囲', nuanceJa: '上限と下限の間に広がる幅を表します。',
});
const vary = sense('range', {
  senseId: 'vary-between', partOfSpeech: 'verb',
  coreMeaningJa: '一定の範囲の中で変動する', nuanceJa: '値や種類が上限と下限の間で動くことを表します。',
});
const mountains = sense('range', {
  senseId: 'mountain-range', partOfSpeech: 'noun',
  coreMeaningJa: '連なって続く山々のまとまり', nuanceJa: '地形として連続した山並みを指します。',
  senseFingerprint: { semanticDomain: 'geography', physicality: 'physical' },
});

/** pull一回分: 端末側とクラウド側を統合し、結果と送信候補を返す。 */
function pull(local, remote) {
  return mergeAtlasRecordsForSync(roundTrip(local), roundTrip(remote));
}

test('an unchanged Atlas record is not rewritten during synchronization', () => {
  const synced = onDevice(new Map(), () => addExpressionEntriesWithReport([extent]));
  const result = pull(synced, synced);
  assert.equal(result.pushCandidates.length, 0);
  assert.deepEqual(result.items, roundTrip(synced));
});

test('a normal newer cloud update is adopted without an extra write', async () => {
  const deviceA = new Map();
  const base = onDevice(deviceA, () => addExpressionEntriesWithReport([extent]));
  const staleDevice = roundTrip(base);
  await wait(5);
  const updated = onDevice(deviceA, () => addExpressionEntriesWithReport([vary]));

  const result = pull(staleDevice, updated);
  assert.equal(result.pushCandidates.length, 0);
  assert.deepEqual(result.items, roundTrip(updated));
});

test('concurrent sense additions from two devices both survive and settle in one round', async () => {
  const deviceA = new Map();
  const deviceB = new Map();
  const base = onDevice(deviceA, () => addExpressionEntriesWithReport([extent]));
  deviceB.set('mp_knowledge', JSON.stringify(base));

  await wait(5);
  const localA = onDevice(deviceA, () => addExpressionEntriesWithReport([vary]));
  await wait(5);
  const localB = onDevice(deviceB, () => addExpressionEntriesWithReport([mountains]));
  // Bが後から送信したため、クラウドにはBの版だけが残っている。
  let remote = roundTrip(localB);

  const pulledByA = pull(localA, remote);
  assert.equal(pulledByA.pushCandidates.length, 1);
  const merged = pulledByA.items[0].blocks[0].data.senses.map(item => item.senseId).sort();
  assert.deepEqual(merged, ['extent', 'mountain-range', 'vary-between']);
  remote = roundTrip(pulledByA.items);

  const pulledByB = pull(localB, remote);
  assert.equal(pulledByB.pushCandidates.length, 0);
  assert.deepEqual(pulledByB.items, remote);

  const pulledAgainByA = pull(pulledByA.items, remote);
  assert.equal(pulledAgainByA.pushCandidates.length, 0);
});

test('a personal note edited on one device survives a sense added on another', async () => {
  const deviceA = new Map();
  const deviceB = new Map();
  const base = onDevice(deviceA, () => addExpressionEntriesWithReport([extent]));
  deviceB.set('mp_knowledge', JSON.stringify(base));
  const id = base[0].id;

  await wait(5);
  const localA = onDevice(deviceA, () => updateExpressionEntry(id, { personalNote: '試験に出た' }));
  await wait(5);
  const remote = roundTrip(onDevice(deviceB, () => addExpressionEntriesWithReport([vary])));

  const result = pull(localA, remote);
  const data = result.items[0].blocks[0].data;
  assert.equal(data.personalNote, '試験に出た');
  assert.deepEqual(data.senses.map(item => item.senseId).sort(), ['extent', 'vary-between']);
  assert.equal(result.pushCandidates.length, 1);

  const settled = pull(result.items, roundTrip(result.items));
  assert.equal(settled.pushCandidates.length, 0);
});
