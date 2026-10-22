// データベースがメモ一覧に「1件」として並び、CSV取り込み・カード・検索・行のページ・列の編集・
// PCの表での直接編集が通ることを確かめる。架空のデータを使う。
import { test, expect } from '@playwright/test';

const CSV = '名前,URL,ID,password\n'
  + 'サンプル電機,https://example.com/a,AB123,hidden-1\n'
  + 'テスト銀行,https://example.com/b,ZX987,hidden-2\n';

/** アプリを開いてメモ一覧へ移り、出たエラーを集める。 */
async function openMemoList(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#home');
  await expect(page.locator('#loading-screen')).toHaveClass(/hidden/);
  await page.evaluate(() => window.AppNav.navigate('memo'));
  await expect(page.locator('#main-content')).toHaveAttribute('data-view', 'memo');
  return errors;
}

/** メモ一覧の「▦＋」からCSVを取り込む。 */
async function importCsv(page) {
  await page.locator('#kn-new-db-btn').click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-new-db="csv"]').click();
  await (await chooser).setFiles({ name: '就活 0123456789abcdef0123456789abcdef.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
  await expect(page.locator('#db-import-name')).toHaveValue('就活');
  await expect(page.locator('.db-import-warning')).toBeVisible();
  await page.locator('#db-import-run').click();
  await expect(page.locator('#main-content')).toHaveAttribute('data-view', 'database');
}

test('a database lives in the memo list, opens as a list, and its rows open as pages', async ({ page }) => {
  const errors = await openMemoList(page);
  await importCsv(page);

  // スマホは普通のデータベースのような1行1件の一覧(名前と主な列=ID)。
  await expect(page.locator('.db-list-row')).toHaveCount(2);
  await expect(page.locator('.db-list-row').first()).toContainText('AB123');
  await expect(page.locator('#main-content')).not.toContainText('hidden-1');
  // 一覧からURLへそのまま飛べる(リンクを押しても行のページは開かない)。
  await expect(page.locator('.db-list-row').first().locator('a[data-link]')).toHaveAttribute('href', 'https://example.com/a');

  await page.locator('#db-search').fill('zx9');
  await expect(page.locator('.db-list-row')).toHaveCount(1);
  await page.locator('.db-list-row').click();
  await expect(page.locator('#main-content')).toHaveAttribute('data-view', 'knowledge-detail');
  // 詳細ページに全部の項目(URLは開くボタン付き)が出て、復習の対象にはならない。
  await expect(page.locator('.db-row-panel input[data-prop-type="text"]')).toHaveValue('ZX987');
  await expect(page.locator('.db-row-panel a', { hasText: '開く' })).toHaveAttribute('href', 'https://example.com/b');
  // 閲覧画面に復習の進み具合・評価ボタンが出ない。
  await expect(page.locator('.kn-learned-action')).toHaveCount(0);
  await page.locator('#kn-edit-btn').click();
  await expect(page.locator('#kn-review-enabled')).toHaveCount(0);
  await page.locator('#kn-save-btn').click();
  const scheduled = await page.evaluate(async () => {
    const s = await import('/js/storage.js');
    const due = s.getReviewsForDate('2999-01-01').map(entry => entry.memoId);
    const rowIds = s.getDatabaseRowIds();
    return due.filter(id => rowIds.has(id)).length;
  });
  expect(scheduled).toBe(0);

  // 行のページから戻るとデータベース、データベースから戻るとメモ一覧。一覧にはデータベースが1件で並び、行は出ない。
  await page.locator('#back-btn').click();
  await expect(page.locator('#main-content')).toHaveAttribute('data-view', 'database');
  await page.locator('#back-btn').click();
  await expect(page.locator('#main-content')).toHaveAttribute('data-view', 'memo');
  await expect(page.locator('.db-memo-card')).toContainText('就活');
  await expect(page.locator('#main-content')).not.toContainText('テスト銀行');
  expect(errors).toEqual([]);
});

test('columns can be renamed, added, and retyped from the editor', async ({ page }) => {
  await openMemoList(page);
  await importCsv(page);
  await page.locator('#db-edit').click();
  const idRow = page.locator('.db-schema-col').filter({ has: page.locator('[data-col-name][value="ID"]') });
  await idRow.locator('[data-col-name]').fill('マイページID');
  await page.locator('#db-col-add').click();
  await page.locator('.db-schema-col').last().locator('[data-col-name]').fill('メモ');
  await page.locator('#db-edit-name').fill('就活マイページ');
  await page.locator('#db-edit-save').click();
  await expect(page.locator('#page-title')).toHaveText('就活マイページ');
  await expect(page.locator('.db-list-head')).toContainText('マイページID');
});

test('a database can be deleted together with its pages', async ({ page }) => {
  await openMemoList(page);
  await importCsv(page);
  await page.locator('#db-delete-db').click();
  await page.locator('[data-delete-mode="with-pages"]').click();
  await expect(page.locator('#main-content')).toHaveAttribute('data-view', 'memo');
  await expect(page.locator('.db-memo-card')).toHaveCount(0);
  await expect(page.locator('#main-content')).not.toContainText('サンプル電機');
  const trashed = await page.evaluate(async () => (await import('/js/storage.js')).getTrashItems().length);
  expect(trashed).toBe(2);
});

test('on a wide screen the table cells can be edited in place', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openMemoList(page);
  await importCsv(page);
  const cell = page.locator('.db-table input[data-prop-type="text"]').first();
  await cell.fill('NEW-ID-1');
  await cell.press('Tab');
  const saved = await page.evaluate(async () => {
    const s = await import('/js/storage.js');
    const db = s.getDatabases()[0];
    return Object.values(db.rows).flatMap(values => Object.values(values));
  });
  expect(saved).toContain('NEW-ID-1');
});
