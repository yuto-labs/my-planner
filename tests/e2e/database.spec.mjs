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

  await page.locator('[data-tool="search"]').click();
  await page.locator('#space-search').fill('zx9');
  await expect(page.locator('.nt tbody tr')).toHaveCount(1);
  // スマホ(タッチ)では名前を押すと、メモ画面へ移らずに行のページが全画面で開く。
  await page.locator('.nt-td--title').click();
  await expect(page.locator('.nt-peek')).toBeVisible();
  await expect(page.locator('#main-content')).toHaveAttribute('data-view', 'memo');
  await expect(page.locator('.nt-peek .nt-prop-value', { hasText: 'ZX987' })).toBeVisible();
  await expect(page.locator('.nt-peek a.nt-url')).toHaveAttribute('href', 'https://example.com/b');
  // 「全画面で開く」でいつものページ。全部の項目が出て、復習の対象にはならない。
  await page.locator('.nt-peek [data-peek-full]').click();
  await expect(page.locator('#main-content')).toHaveAttribute('data-view', 'knowledge-detail');
  await expect(page.locator('.db-row-panel .nt-prop-value', { hasText: 'ZX987' })).toBeVisible();
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
  await page.locator('[data-tool="more"]').click();
  await page.locator('[data-set="layout"]').click();
  await page.locator('[data-layout="list"]').click();
  await page.keyboard.press('Escape');
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
  // データベースの削除は、チップの右クリックからだけ。
  await page.locator('.db-space-chip', { hasText: '就活' }).click({ button: 'right' });
  await page.locator('[data-menu="delete"]').click();
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
  await page.locator('[data-tool="more"]').click();
  await page.locator('[data-set="columns"]').click();
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

test('a new database is named when created and renamed from its chip', async ({ page }) => {
  await openMemoList(page);
  await page.locator('[data-space-add]').click();
  await page.locator('[data-new-db="empty"]').click();
  await page.locator('.confirm-input').fill('うんちく');
  await page.locator('.confirm-input').press('Enter');
  await expect(page.locator('.db-space-chip.active')).toHaveText('うんちく');
  // 名前の変更と削除は、チップの右クリック(スマホは長押し)のメニューから。
  await page.locator('.db-space-chip.active').click({ button: 'right' });
  await page.locator('[data-menu="rename"]').click();
  await page.locator('.confirm-input').fill('ネタ帳');
  await page.locator('.confirm-input').press('Enter');
  await expect(page.locator('.db-space-chip.active')).toHaveText('ネタ帳');
});

test('sort and filter from the one-line toolbar change the table right away', async ({ page }) => {
  await openMemoList(page);
  await importCsv(page);
  // 「メモ」とデータベースで、ビューのタブと道具(検索・フィルター・並べ替え・新規)は同じ1行にある。
  await expect(page.locator('.db-view-bar [data-tool="new"]')).toBeVisible();
  await expect(page.locator('.db-view-bar .db-view-tab.active')).toBeVisible();

  await page.locator('[data-tool="sort"]').click();
  await page.locator('.db-pop-search').fill('ID');
  await page.locator('.db-pop [data-pick]', { hasText: 'ID' }).click();
  await page.locator('[data-sort-dir]').selectOption('desc');
  await expect(page.locator('.nt tbody tr').first()).toContainText('テスト銀行');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-tool="sort"]')).toHaveClass(/is-on/);

  await page.locator('[data-tool="filter"]').click();
  await page.locator('[data-filter-add]').click();
  await page.locator('.db-pop [data-pick]', { hasText: 'ID' }).click();
  await page.locator('.db-pop-rule input[data-filter-value]').fill('ab');
  await expect(page.locator('.nt tbody tr')).toHaveCount(1);
  await expect(page.locator('.nt tbody tr')).toContainText('サンプル電機');
});

test('a row page body is edited in place without leaving the database', async ({ page }) => {
  await openMemoList(page);
  await importCsv(page);
  await page.locator('.nt-td--title').first().click();
  await expect(page.locator('.nt-peek')).toBeVisible();
  // 本文を押してそのまま書く。Enterで次の行。離れた時に保存される。
  await page.locator('.nt-peek .pe-text').first().click();
  await page.keyboard.type('ESの締切は来週');
  await page.keyboard.press('Enter');
  await page.keyboard.type('面接の準備');
  await page.locator('.nt-peek-title').click();
  await expect.poll(async () => page.evaluate(async () => {
    const s = await import('/js/storage.js');
    const memo = s.getKnowledgeMemos().find(item => item.title === 'サンプル電機');
    return (memo?.blocks || []).map(block => block.text);
  })).toEqual(['ESの締切は来週', '面接の準備']);
  // 閉じても、データベースの画面のまま。
  await page.locator('[data-peek-close]').click();
  await expect(page.locator('.nt-peek')).toHaveCount(0);
  await expect(page.locator('.db-space-chip.active')).toHaveText('就活');
});

test('a row page body supports toggles, headings, and the slash menu like a memo', async ({ page }) => {
  await openMemoList(page);
  await importCsv(page);
  await page.locator('.nt-td--title').first().click();
  await page.locator('.nt-peek .pe-text').first().click();
  // 「# 」で見出し、Enterで次の行。
  await page.keyboard.type('# 会社メモ');
  await page.keyboard.press('Enter');
  // 「>> 」でトグル。開いたトグルでEnterを押すと、中身の行になる。
  await page.keyboard.type('>> 面接で聞かれたこと');
  await page.keyboard.press('Enter');
  await page.keyboard.type('志望動機');
  await page.keyboard.press('Enter');
  // 空の行で「/」→ メニューからチェックリスト。
  await page.keyboard.type('/');
  await page.locator('.pe-menu [data-pe-type="checklist"]').click();
  await page.keyboard.type('お礼メールを送る');
  await page.locator('.nt-peek-title').click();
  const blocks = () => page.evaluate(async () => {
    const s = await import('/js/storage.js');
    const memo = s.getKnowledgeMemos().find(item => item.title === 'サンプル電機');
    /** 確かめやすいよう、種類・文字・中身だけにする。 */
    const pick = list => (list || []).map(block => ({ type: block.type, text: block.text, ...(block.children ? { children: pick(block.children) } : {}) }));
    return pick(memo?.blocks);
  });
  await expect.poll(blocks).toEqual([
    { type: 'h1', text: '会社メモ' },
    { type: 'toggle', text: '面接で聞かれたこと', children: [{ type: 'paragraph', text: '志望動機' }, { type: 'checklist', text: 'お礼メールを送る' }] },
  ]);
  // ▸ で閉じると、中身が隠れる。
  await page.locator('.nt-peek [data-toggle-block]').click();
  await expect(page.locator('.nt-peek .pe-text', { hasText: '志望動機' })).toHaveCount(0);
});

test('view settings hide columns, and the AI button opens a panel about the open database', async ({ page }) => {
  await openMemoList(page);
  await importCsv(page);
  await page.locator('[data-tool="more"]').click();
  await expect(page.locator('.db-pop--settings')).toContainText('ビューの設定');
  await page.locator('[data-set="props"]').click();
  await page.locator('[data-toggle-prop]', { hasText: 'URL' }).click();
  await expect(page.locator('.nt thead')).not.toContainText('URL');
  await page.keyboard.press('Escape');
  // 右下のAIは、開いているデータベースについて聞く窓を開く(このテストではAIは使えない状態)。
  await page.locator('#fab').click();
  await expect(page.locator('.sai-title')).toHaveText('就活について聞く');
  await expect(page.locator('.sai-log')).toContainText('AI');
  await page.locator('[data-sai-close]').click();
  await expect(page.locator('.sai')).toHaveCount(0);
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
  test('deleting asks in a dialog at the center of the screen, over the editor without closing it', async ({ page }) => {
    await openMemoList(page);
    await importCsv(page);
    // 列の削除: 確認の窓が出ても、下の「データベースの編集」は閉じない。「やめる」で何も消えない。
    await page.locator('[data-tool="more"]').click();
  await page.locator('[data-set="columns"]').click();
    await page.locator('.db-schema-col').first().locator('[data-col-remove]').click();
    const dialog = page.locator('.confirm-dialog');
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    const view = page.viewportSize();
    expect(Math.abs(box.y + box.height / 2 - view.height / 2)).toBeLessThan(40);
    expect(Math.abs(box.x + box.width / 2 - view.width / 2)).toBeLessThan(40);
    await page.locator('.confirm-dialog [data-answer="no"]').click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.db-schema-col')).toHaveCount(2);
    await page.keyboard.press('Escape');
    // 行の削除: 「削除」で行がごみ箱へ移る。
    await page.locator('.nt tbody tr').first().hover();
    await page.locator('.nt tbody tr').first().locator('[data-row-delete]').click();
    await page.locator('.confirm-dialog [data-answer="yes"]').click();
    await expect(page.locator('.nt tbody tr')).toHaveCount(1);
  });
});