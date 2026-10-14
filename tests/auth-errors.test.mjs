import test from 'node:test';
import assert from 'node:assert/strict';
import { getAuthSendErrorMessage } from '../js/supabase.js';

test('auth send errors distinguish provider limits from an app limit', () => {
  assert.match(getAuthSendErrorMessage({ status: 429, message: 'Too Many Requests' }), /アプリ独自の制限ではありません/);
  assert.match(getAuthSendErrorMessage({ code: 'over_email_send_rate_limit' }), /上限/);
});

test('auth send errors explain unauthorized addresses and network failures', () => {
  assert.match(getAuthSendErrorMessage({ message: 'Email address not authorized' }), /チーム登録/);
  assert.match(getAuthSendErrorMessage({ message: 'Failed to fetch' }), /通信状態/);
});
