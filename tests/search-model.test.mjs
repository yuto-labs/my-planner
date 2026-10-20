// 横断検索が題名以外(本文・意味・回答)も探し、表記の揺れを無視し、題名一致を上に出すことを守るテスト。
import test from 'node:test';
import assert from 'node:assert/strict';

import { makeSnippet, normalizeSearchText, searchAll } from '../js/search-model.js';

const data = {
  memos: [
    { id: 'm1', title: '研究ノート', tags: ['ゼミ'], blocks: [{ type: 'paragraph', text: '光の散乱について整理した。夕焼けの色はレイリー散乱で決まる。' }] },
    { id: 'm2', title: 'レイリー散乱', tags: [], blocks: [] },
  ],
  learning: [{
    id: 'k1', title: '空が青い理由', originalQuestion: '空はなぜ青い？',
    answer: { directAnswer: [{ text: '短い波長の光ほど強く散乱されるから。' }], keyPoints: ['レイリー散乱'], sections: [] },
  }],
  atlas: [{ id: 'a1', term: 'relief', senses: [{ coreMeaningJa: '安心', nuanceJa: '緊張がほどける', examples: [{ english: 'What a relief!', japanese: 'ほっとした' }] }] }],
  tasks: [{ id: 't1', title: '発表準備', memo: 'Relief の例文を入れる', subtasks: [] }],
  events: [],
  goals: [],
};

test('bodies, meanings, and answers are searched, not only titles', () => {
  const kinds = searchAll('レイリー散乱', data).map(group => [group.kind, group.items.map(item => item.id)]);
  assert.deepEqual(kinds, [['memo', ['m2', 'm1']], ['learning', ['k1']]]);
  // 表現帳は例文の日本語でも見つかる。
  assert.deepEqual(searchAll('ほっと', data).map(group => group.kind), ['atlas']);
});

test('title matches come first and body matches show where the text was found', () => {
  const memos = searchAll('レイリー散乱', data)[0].items;
  assert.equal(memos[0].titleHit, true);
  assert.equal(memos[0].snippet, '');
  assert.match(memos[1].snippet, /レイリー散乱/);
});

test('full-width, half-width, and letter case differences are ignored', () => {
  assert.equal(normalizeSearchText('ＲＥＬＩＥＦ'), 'relief');
  const groups = searchAll('ＲＥＬＩＥＦ', data);
  assert.deepEqual(groups.map(group => group.kind), ['atlas', 'task']);
  assert.deepEqual(searchAll('   ', data), []);
});

test('snippets cut around the match with ellipses only where text was cut', () => {
  assert.equal(makeSnippet('abc', 'b', 5), 'abc');
  assert.equal(makeSnippet(`${'x'.repeat(40)}target${'y'.repeat(40)}`, 'target', 3), '…xxxtargetyyy…');
  assert.equal(makeSnippet('none', 'zzz'), '');
});
