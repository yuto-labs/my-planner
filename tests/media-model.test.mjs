// 画像アップロード前の入力整形と所有者境界を守るテスト。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  escapeMediaAttribute,
  escapeMediaHtml,
  isOwnedMediaPath,
  sanitizeMediaKind,
  scaledImageDimensions,
} from '../js/media-model.js';

test('sanitizes media folder kinds without allowing path separators', () => {
  assert.equal(sanitizeMediaKind('home'), 'home');
  assert.equal(sanitizeMediaKind('../Home Photos'), 'HomePhotos');
  assert.equal(sanitizeMediaKind(''), 'misc');
  assert.equal(sanitizeMediaKind('a'.repeat(40)).length, 32);
});

test('scales large images down without enlarging small images', () => {
  assert.deepEqual(scaledImageDimensions(3200, 2400), { width: 1600, height: 1200 });
  assert.deepEqual(scaledImageDimensions(800, 1200), { width: 800, height: 1200 });
  assert.deepEqual(scaledImageDimensions(1, 4000), { width: 1, height: 1600 });
});

test('allows deletion only below the signed-in user folder', () => {
  assert.equal(isOwnedMediaPath('user-1/memos/photo.jpg', 'user-1'), true);
  assert.equal(isOwnedMediaPath('user-10/memos/photo.jpg', 'user-1'), false);
  assert.equal(isOwnedMediaPath('../user-1/photo.jpg', 'user-1'), false);
  assert.equal(isOwnedMediaPath('', 'user-1'), false);
});

test('escapes viewer captions and removes newlines from attributes', () => {
  assert.equal(escapeMediaHtml('<b>"photo" & note</b>'), '&lt;b&gt;&quot;photo&quot; &amp; note&lt;/b&gt;');
  assert.equal(escapeMediaAttribute('line 1\nline 2'), 'line 1 line 2');
});
