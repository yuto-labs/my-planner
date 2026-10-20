// 外観とカテゴリが端末間で揃い、端末ごとの設定(リマインダー)は同期されず、往復しないことを守るテスト。
import test from 'node:test';
import assert from 'node:assert/strict';

const values = new Map();
globalThis.localStorage = {
  get length() { return values.size; },
  key(index) { return [...values.keys()][index] ?? null; },
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); },
};

const {
  applySharedSettingsFromSync, ensureSharedSettings, getAppMediaPreferences, getCategories,
  getSettings, saveAppMediaPreferences, saveCategories, saveSettings, writeSharedSettingsNow,
} = await import('../js/storage.js');

test.beforeEach(() => values.clear());

test('the shared copy holds appearance and categories but not per-device settings', () => {
  saveSettings({ theme: 'dark', myScheduleColor: '#123456', reminders: { enabled: true } });
  saveCategories([{ id: 'study', name: '勉強', color: '#00ff00' }]);
  assert.ok(writeSharedSettingsNow());
  const shared = getAppMediaPreferences().sharedSettings;
  assert.equal(shared.theme, 'dark');
  assert.equal(shared.myScheduleColor, '#123456');
  assert.deepEqual(shared.categories.map(cat => cat.id), ['study']);
  assert.equal('reminders' in shared, false);
  // 自分で書いた写しは「適用済み」なので、取り込み直さない。
  assert.equal(applySharedSettingsFromSync(), false);
});

test('a newer copy from another device is applied once and keeps local-only settings', () => {
  saveSettings({ theme: 'light', reminders: { enabled: true, leadMinutes: 5 } });
  saveAppMediaPreferences({
    sharedSettings: { theme: 'auto', myScheduleColor: '#abcdef', categories: [{ id: 'job', name: '就活', color: '#f00' }], updatedAt: '2999-01-01T00:00:00.000Z' },
  });
  assert.equal(applySharedSettingsFromSync(), true);
  assert.equal(getSettings().theme, 'auto');
  assert.equal(getSettings().myScheduleColor, '#abcdef');
  assert.equal(getSettings().reminders.leadMinutes, 5);
  assert.deepEqual(getCategories().map(cat => cat.id), ['job']);
  assert.equal(applySharedSettingsFromSync(), false);
});

test('the first copy is created only when no device has made one', () => {
  assert.ok(ensureSharedSettings());
  const first = getAppMediaPreferences().sharedSettings.updatedAt;
  assert.equal(ensureSharedSettings(), false);
  assert.equal(getAppMediaPreferences().sharedSettings.updatedAt, first);
});
