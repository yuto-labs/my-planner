// 復習セッションが、保存済みの復習日と同じローカル日付で期限を判定することを守るテスト。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('review session uses the local calendar date instead of the UTC date', async () => {
  const source = await readFile(new URL('../js/modules/review.js', import.meta.url), 'utf8');
  const init = source.slice(source.indexOf('export function initReview'), source.indexOf('const queue ='));
  // toISOString() はUTC日付になり、日本時間0〜9時は前日扱いになってホームの件数と食い違う。
  assert.doesNotMatch(init, /toISOString\(\)/);
  assert.match(init, /const todayStr = today\(\);/);
  assert.match(source, /import \{[^}]*\btoday\b[^}]*\} from '\.\.\/utils\.js';/);
});
