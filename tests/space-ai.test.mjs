// メモ欄のAIが、質問に近い行をAIへ渡し、答えを安全に表示することを守るテスト。
import test from 'node:test';
import assert from 'node:assert/strict';

const { pickContext, renderAnswer } = await import('../js/space-ai-model.js');

const DOCS = [
  { id: 'a', title: '朝ラジオ体操', text: '【朝ラジオ体操】 工場では朝ラジオ体操やりがち' },
  { id: 'b', title: '経営の語源', text: '【経営の語源】 「経営」という言葉は仏教由来' },
  { id: 'c', title: '夜中の呼び出し', text: '【夜中の呼び出し】 工場の管理者は夜中に呼ばれる' },
];

test('rows close to the question go first, and the budget is respected', () => {
  const context = pickContext(DOCS, '経営ってどこから来た言葉？');
  assert.ok(context.startsWith('【経営の語源】'));
  // 上限が小さい時は、近い行だけが入る。
  assert.equal(pickContext(DOCS, '工場の夜中', 40), '【夜中の呼び出し】 工場の管理者は夜中に呼ばれる');
});

test('matching ignores kana and width differences, and close rows are sent in full', () => {
  const docs = [
    { id: 'x', title: '別の話', text: '【別の話】 短い', full: '【別の話】 短い' },
    { id: 'y', title: 'ﾗｼﾞｵ体操', text: '【ﾗｼﾞｵ体操】 本文: 朝…', full: '【ﾗｼﾞｵ体操】 本文: 朝に全員でやる。事務員も参加。' },
  ];
  // ひらがなで聞いても、半角カタカナの名前の行が先に、本文を省略せずに入る。
  const context = pickContext(docs, 'らじお体操ってなんだっけ');
  assert.ok(context.startsWith('【ﾗｼﾞｵ体操】 本文: 朝に全員でやる。事務員も参加。'));
  assert.ok(context.includes('【別の話】 短い'));
});

test('answers are escaped, link only http(s) URLs, and cite only existing rows', () => {
  const html = renderAnswer('【経営の語源】 を見て <script>alert(1)</script> https://example.com/a?b=1&c=2 javascript:alert(1) 【ない行】 **大事**', DOCS);
  assert.ok(!html.includes('<script>'));
  assert.match(html, /data-ai-row="b">経営の語源<\/button>/);
  assert.match(html, /<a href="https:\/\/example\.com\/a\?b=1&amp;c=2"/);
  assert.ok(!/href="javascript/.test(html));
  assert.match(html, /【ない行】/);
  assert.match(html, /<strong>大事<\/strong>/);
});
