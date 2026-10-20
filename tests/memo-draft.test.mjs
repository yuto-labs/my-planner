// 保存前に閉じたメモの下書きが端末に残り、保存・破棄で消え、件数と期間が限られることを守るテスト。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { clearMemoDraft, getMemoDraft, saveMemoDraft } from '../js/memo-draft.js';

/** localStorageの代わりに、Mapで読み書きする保存先を作る。 */
function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem: key => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

const content = title => ({ title, blocks: [{ id: 'b1', type: 'paragraph', text: '本文' }], tags: [], url: '', starred: false, reviewEnabled: false });

test('a draft is kept per memo, with new memos sharing one slot, and cleared on demand', () => {
  const storage = memoryStorage();
  saveMemoDraft('memo-1', content('既存'), { storage, now: 1000 });
  saveMemoDraft(null, content('新規'), { storage, now: 2000 });
  assert.equal(getMemoDraft('memo-1', { storage, now: 3000 }).title, '既存');
  assert.equal(getMemoDraft(null, { storage, now: 3000 }).title, '新規');

  clearMemoDraft('memo-1', { storage });
  assert.equal(getMemoDraft('memo-1', { storage, now: 3000 }), null);
  clearMemoDraft(null, { storage });
  // 全部消えたら保存キーそのものも消える。
  assert.equal(storage.values.size, 0);
});

test('only the five newest drafts within 30 days are kept', () => {
  const storage = memoryStorage();
  for (let i = 1; i <= 6; i += 1) saveMemoDraft(`memo-${i}`, content(`m${i}`), { storage, now: i * 1000 });
  assert.equal(getMemoDraft('memo-1', { storage, now: 7000 }), null);
  assert.equal(getMemoDraft('memo-6', { storage, now: 7000 }).title, 'm6');
  assert.equal(getMemoDraft('memo-6', { storage, now: 6000 + 31 * 86_400_000 }), null);
});

test('a broken or full storage never breaks editing', () => {
  const storage = memoryStorage();
  storage.setItem('mp_memo_drafts', '{broken');
  assert.equal(getMemoDraft('memo-1', { storage }), null);
  const full = { ...memoryStorage(), getItem: () => null, setItem() { throw new DOMException('full', 'QuotaExceededError'); } };
  assert.equal(saveMemoDraft('memo-1', content('x'), { storage: full }), false);
});

test('the editor saves drafts on edits and clears them after saving or discarding', async () => {
  const source = await readFile(new URL('../js/modules/memo.js', import.meta.url), 'utf8');
  assert.match(source, /\['input', 'change', 'click', 'keyup'\]\.forEach\(type => editPage\?\.addEventListener\(type, scheduleEditorDraftSave\)\)/);
  assert.equal((source.match(/clearMemoDraft\(draftMemoId\)/g) || []).length, 2);
  assert.match(source, /window\.confirm\('未保存の変更があります。破棄して移動しますか？'\)\) return false;\s+\/\/[^\n]*\s+clearTimeout\(draftSaveTimer\);\s+clearMemoDraft\(edState\.id\);/);
});
