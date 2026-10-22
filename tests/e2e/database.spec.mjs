// メモ欄が「データベースの集まり」として動くことを確かめる。架空のデータを使う。
// 上のチップで「メモ」と各データベースを切り替え、ビュー(絞り込み・並べ替え)を保存でき、
// メモをデータベースへ移せる。CSV取り込み・行のページ・列の編集・PCの表での直接編集も通す。
import { test, expect, devices } from '@playwright/test';

const CSV = '名前,URL,ID,password\n'
  + 'サンプル電機,https://example.com/a,AB123,hidden-1\n'
  + 'テスト銀行,https://example.com/b,ZX987,hidden-2\n';

/** アプリを開いてメモ欄へ移り、出たエラーを集める。 */
async function openMemoList(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#home');
  await expect(page.locator('#loading-screen')).toHaveClass(/hidden/);
  await page.evaluate(() => window.AppNav.navigate('memo'));
  await expect(page.locator('#main-content')).toHaveAttribute('data-view', 'memo');
  return errors;
}

/** チップの「＋」からCSVを取り込む。取り込んだデータベースがメモ欄で開く。 */
async function importCsv(page) {
  await page.locator('[data-space-add]').click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-new-db="csv"]').click();
  await (await chooser).setFiles({ name: '就活 0123456789abcdef0123456789abcdef.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
  await expect(page.locator('#db-import-name')).toHaveValue('就活');
  await expect(page.locator('.db-import-warning')).toBeVisible();
  await page.locator('#db-import-run').click();
  await expect(page.locator('.db-space-chip.active')).toHaveText('就活');
}

test('a database opens from its chip as a list, and its rows open as pages', async ({ page }) => {
  const errors = await openMemoList(page);
  await importCsv(page);

  // Notionのような表で、全部の列が出る。URLはそのまま飛べるリンク。パスワードの列は取り込まれていない。
  await expect(page.locator('.nt tbody tr')).toHaveCount(2);
  await expect(page.locator('.nt tbody tr').first()).toContainText('AB123');
  await expect(page.locator('#main-content')).not.toContainText('hidden-1');
  await expect(page.locator('.nt tbody tr').first().locator('a[data-link]')).toHaveAttribute('href', 'https://example.com/a');

  await page.locator('#db-search').fill('zx9');
  await expect(page.locator('.nt tbody tr')).toHaveCount(1);
  // スマホ(タッチ)では名前を押すと行のページが開く。
  await page.locator('.nt-td--title').click();
  await expect(page.locator('#main-content')).toHaveAttribute('data-view', 'knowledge-detail');
  // 詳細ページに全部の項目(URLは開くボタン付き)が出て、復習の対象にはならない。
  await expect(page.locator('.db-row-panel .nt-prop-value', { hasText: 'ZX987' })).toBeVisible();
  await expect(page.locator('.db-row-panel a.nt-url')).toHaveAttribute('href', 'https://example.com/b');
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

  // 行のページから戻ると、そのデータベースを開いたメモ欄。「メモ」のチップに戻すと行は出ない。
  await page.locator('#back-btn').click();
  await expect(page.locator('#main-content')).toHaveAttribute('data-view', 'memo');
  await expect(page.locator('.db-space-chip.active')).toHaveText('就活');
  await page.locator('[data-space="memos"]').click();
  await expect(page.locator('.db-space-chip.active')).toHaveText('メモ');
  await expect(page.locator('#main-content')).not.toContainText('テスト銀行');
  expect(errors).toEqual([]);
});

test('a saved view filters and sorts the rows, and is remembered', async ({ page }) => {
  await openMemoList(page);
  await importCsv(page);
  await page.locator('[data-view-add]').click();
  await page.locator('#view-name').fill('Zだけ');
  await page.locator('#view-filter-add').click();
  await page.locator('[data-filter-prop]').selectOption({ label: 'ID' });
  await page.locator('[data-filter-value]').fill('zx');
  await page.locator('#view-save').click();
  await expect(page.locator('.db-view-tab.active')).toHaveText('Zだけ');
  await expect(page.locator('.nt tbody tr')).toHaveCount(1);
  await expect(page.locator('.nt tbody tr')).toContainText('テスト銀行');
  // 「すべて」に切り替えると全行、再読み込みしても選んだビュー(とデータベース)を覚えている。
  await page.locator('.db-view-tab', { hasText: 'すべて' }).click();
  await expect(page.locator('.nt tbody tr')).toHaveCount(2);
  await page.locator('.db-view-tab', { hasText: 'Zだけ' }).click();
  await page.reload();
  await expect(page.locator('#loading-screen')).toHaveClass(/hidden/);
  await page.evaluate(() => window.AppNav.navigate('memo'));
  await expect(page.locator('.db-view-tab.active')).toHaveText('Zだけ');
  await expect(page.locator('.nt tbody tr')).toHaveCount(1);
  // ビューを「リスト」にすると、名前と主な列だけの一覧になる。
  await page.locator('[data-view-edit]').click();
  await page.locator('#view-layout').selectOption('list');
  await page.locator('#view-save').click();
  await expect(page.locator('.db-list-row')).toHaveCount(1);
  await expect(page.locator('.nt')).toHaveCount(0);
});

test('a plain memo has no columns and can be moved into a database', async ({ page }) => {
  await openMemoList(page);
  await importCsv(page);
  // 「メモ」は文章を書く場所なので、列を足すボタンも列の欄も無い。
  await page.evaluate(async () => {
    const s = await import('/js/storage.js');
    s.addKnowledgeMemo({ title: '移すメモ', blocks: [{ id: 'b1', type: 'paragraph', text: '本文' }], tags: [], url: '', starred: false, summary: '' });
  });
  await page.locator('[data-space="memos"]').click();
  await expect(page.locator('[data-columns-edit]')).toHaveCount(0);
  await page.locator('.kn-memo-card', { hasText: '移すメモ' }).click();
  await expect(page.locator('.db-row-panel')).toHaveCount(0);
  // 列が欲しくなったらデータベースへ移す。移すとそのデータベースの列の欄が出る。
  await page.locator('#kn-move-btn').click();
  await page.locator('[data-move-to]', { hasText: '就活' }).click();
  await expect(page.locator('.db-row-panel-db')).toHaveText('就活');
  await page.locator('#back-btn').click();
  await expect(page.locator('.db-space-chip.active')).toHaveText('就活');
  await expect(page.locator('.nt tbody tr')).toHaveCount(3);
});

test('a database can be deleted together with its pages', async ({ page }) => {
  await openMemoList(page);
  await importCsv(page);
  await page.locator('#db-delete-db').click();
  await page.locator('[data-delete-mode="with-pages"]').click();
  await expect(page.locator('.db-space-chip.active')).toHaveText('メモ');
  await expect(page.locator('.db-space-chip', { hasText: '就活' })).toHaveCount(0);
  await expect(page.locator('#main-content')).not.toContainText('サンプル電機');
  const trashed = await page.evaluate(async () => (await import('/js/storage.js')).getTrashItems().length);
  expect(trashed).toBe(2);
});

test('table cells are edited in place, tags get colors, and new rows are typed inline', async ({ page }) => {
  await openMemoList(page);
  await importCsv(page);
  // セルを押すとその場で書ける。Enterで確定する。
  await page.locator('.nt tbody tr').first().locator('td[data-edit]').nth(2).click();
  await page.locator('.nt-editor').fill('NEW-ID-1');
  await page.locator('.nt-editor').press('Enter');
  await expect(page.locator('.nt tbody tr').first()).toContainText('NEW-ID-1');

  // 列の種類を「タグ」にして、色付きのタグを付ける。
  await page.locator('#db-edit').click();
  await page.locator('.db-schema-col').filter({ has: page.locator('[data-col-name][value="ID"]') }).locator('[data-col-type]').selectOption('multi_select');
  await page.locator('#db-edit-save').click();
  await page.locator('.nt tbody tr').nth(1).locator('.nt-td--multi_select').click();
  await page.locator('.nt-tag-input').fill('あるある');
  await page.locator('.nt-tag-input').press('Enter');
  await page.locator('.nt-tag-input').press('Escape');
  await expect(page.locator('.nt tbody tr').nth(1).locator('.nt-tag', { hasText: 'あるある' })).toHaveAttribute('data-c', /\d/);

  // 「＋ 新規」でページを開かずに1行足し、そのまま名前を書ける。
  await page.locator('[data-nt-add]').click();
  await page.locator('.nt-editor').fill('新しい会社');
  await page.locator('.nt-editor').press('Enter');
  await expect(page.locator('.nt tbody tr')).toHaveCount(3);
  await expect(page.locator('.nt tbody tr').last()).toContainText('新しい会社');
});

test.describe('on a PC', () => {
  // マウスのあるPCとして開く(タッチ端末だとサイドピークではなく全画面でページが開く)。
  test.use({ hasTouch: false, isMobile: false, viewport: { width: 1400, height: 900 }, userAgent: devices['Desktop Chrome'].userAgent });

  test('a row opens in a side peek next to the table, and its values can be edited there', async ({ page }) => {
    await openMemoList(page);
    await importCsv(page);
    await page.locator('.nt tbody tr').first().hover();
    await page.locator('.nt tbody tr').first().locator('[data-row-open]').click();
    await expect(page.locator('.nt-peek')).toBeVisible();
    await expect(page.locator('.nt-peek-title')).toContainText('サンプル電機');
    // 列の値を押してその場で書き換えると、表にも反映される。
    await page.locator('.nt-peek .nt-prop-value', { hasText: 'AB123' }).click();
    await page.locator('.nt-peek .nt-editor').fill('AB999');
    await page.locator('.nt-peek .nt-editor').press('Enter');
    await expect(page.locator('.nt tbody tr').first()).toContainText('AB999');
    await page.locator('[data-peek-close]').click();
    await expect(page.locator('.nt-peek')).toHaveCount(0);
  });
});