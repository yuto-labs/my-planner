// スマホ画面で、CSVの取り込み → カード表示 → 検索 → 行のページ → データベースへ戻る、が通ることを確かめる。
// 架空のデータを使う。パスワード列は既定で取り込まれないことも確かめる。
import { test, expect } from '@playwright/test';

const CSV = '名前,URL,ID,password\n'
  + 'サンプル電機,https://example.com/a,AB123,hidden-1\n'
  + 'テスト銀行,https://example.com/b,ZX987,hidden-2\n';

test('import a CSV, browse it as cards, search, and open a row page', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#home');
  await expect(page.locator('#loading-screen')).toHaveClass(/hidden/);
  await page.evaluate(() => window.AppNav.navigate('memo'));
  await page.locator('#kn-db-btn').click();
  await expect(page.locator('#main-content')).toHaveAttribute('data-view', 'databases');

  await page.locator('#db-csv-input').setInputFiles({ name: '就活 0123456789abcdef0123456789abcdef.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
  await expect(page.locator('#db-import-name')).toHaveValue('就活');
  await expect(page.locator('.db-import-warning')).toBeVisible();
  await page.locator('#db-import-run').click();

  await expect(page.locator('#main-content')).toHaveAttribute('data-view', 'database');
  await expect(page.locator('.db-card')).toHaveCount(2);
  await expect(page.locator('.db-card').first()).toContainText('AB123');
  await expect(page.locator('.db-card').first().getByRole('link', { name: /マイページ/ })).toHaveAttribute('href', 'https://example.com/a');
  await expect(page.locator('#main-content')).not.toContainText('hidden-1');

  await page.locator('#db-search').fill('zx9');
  await expect(page.locator('.db-card')).toHaveCount(1);
  await expect(page.locator('.db-card')).toContainText('テスト銀行');

  await page.locator('.db-card-title').click();
  await expect(page.locator('#main-content')).toHaveAttribute('data-view', 'knowledge-detail');
  await expect(page.locator('.db-row-panel input[data-prop-type="text"]')).toHaveValue('ZX987');

  // 行のページから戻ると、メモ一覧ではなくデータベースへ戻る。行のページはメモ一覧には出ない。
  await page.locator('#back-btn').click();
  await expect(page.locator('#main-content')).toHaveAttribute('data-view', 'database');
  await page.evaluate(() => window.AppNav.navigate('memo'));
  await expect(page.locator('#main-content')).not.toContainText('テスト銀行');
  expect(errors).toEqual([]);
});
