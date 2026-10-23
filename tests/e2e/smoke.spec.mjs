// スマホ画面で、主な画面が表示できることと、手作業でしか確かめられなかった操作(長押し並べ替え・
// マーカー・下書きの復元)が本物のブラウザーで動くことを確かめる。ログインはしない(同期は対象外)。
import { test, expect } from '@playwright/test';

/** アプリを開いて起動が終わるのを待ち、出たエラーを集める。 */
async function openApp(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#home');
  await expect(page.locator('#loading-screen')).toHaveClass(/hidden/);
  return errors;
}

/** アプリ内の画面移動(下のナビと同じ処理)。 */
async function go(page, view) {
  await page.evaluate(v => window.AppNav.navigate(v), view);
  await expect(page.locator('#main-content')).toHaveAttribute('data-view', view);
}

test('every main screen opens without script errors', async ({ page }) => {
  const errors = await openApp(page);
  for (const view of ['calendar', 'tasks', 'memo', 'knowledge', 'expression-atlas', 'settings', 'goals', 'archive', 'home']) {
    await go(page, view);
  }
  await expect(page.locator('#main-content')).not.toBeEmpty();
  expect(errors).toEqual([]);
});

test('long-pressing a task and dragging it onto another reorders them', async ({ page }) => {
  await openApp(page);
  await page.evaluate(async () => {
    const s = await import('/js/storage.js');
    s.addTask({ title: '並べ替えA', dueDate: '2030-01-01' });
    s.addTask({ title: '並べ替えB', dueDate: '2030-01-01' });
  });
  await go(page, 'home');
  await go(page, 'tasks');
  const order = () => page.locator('[data-task-id]').allInnerTexts().then(texts => texts.filter(t => /並べ替え[AB]/.test(t)).map(t => t.match(/並べ替え([AB])/)[1]).join(''));
  expect(await order()).toBe('AB');

  // 本物のタッチ操作と同じ順に、押す → 0.5秒待つ → Bの上へ動かす → 離す。
  const a = await page.locator('[data-task-id]', { hasText: '並べ替えA' }).boundingBox();
  const b = await page.locator('[data-task-id]', { hasText: '並べ替えB' }).boundingBox();
  const touch = async (type, x, y) => page.evaluate(([type, x, y]) => {
    const target = document.elementFromPoint(x, y);
    const point = new Touch({ identifier: 1, target, clientX: x, clientY: y });
    target.dispatchEvent(new TouchEvent(type, {
      bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [point], changedTouches: [point],
    }));
  }, [type, x, y]);
  // 行の左端は完了チェックのボタンで、そこを長押ししても並べ替えは始まらない(仕様)。行の中央を押す。
  await touch('touchstart', a.x + a.width / 2, a.y + a.height / 2);
  await page.waitForTimeout(550);
  await touch('touchmove', b.x + b.width / 2, b.y + b.height / 2);
  await touch('touchend', b.x + b.width / 2, b.y + b.height / 2);
  await expect.poll(order).toBe('BA');
  // 並べ替えの直後に編集画面が開いてしまわない。
  await expect(page.locator('#modal-overlay')).toHaveClass(/hidden/);
});

test('a marker does not continue onto a new line and can be cleared only where selected', async ({ page }) => {
  await openApp(page);
  await go(page, 'memo');
  await page.getByRole('button', { name: '新規' }).click();
  const editor = page.locator('.kn-block-focusable[contenteditable="true"]').first();
  await editor.click();
  await page.keyboard.type('AAAABBBB');
  // 先頭4文字を選んで黄色のマーカー。
  const mark = async (id, start, end) => {
    await editor.evaluate((el, [start, end]) => {
      const text = el.firstChild;
      const range = document.createRange();
      range.setStart(text, start); range.setEnd(text, end);
      getSelection().removeAllRanges(); getSelection().addRange(range);
    }, [start, end]);
    await page.locator('#kn-highlight-btn').click();
    await page.locator(`[data-highlight-id="${id}"]`).click();
  };
  await mark('yellow', 0, 4);
  await expect(editor.locator('mark')).toHaveText('AAAA');

  // マーカーの末尾で改行して入力した文字は、マーカーなし。
  await editor.evaluate(el => {
    const text = el.querySelector('mark').lastChild;
    const range = document.createRange(); range.setStart(text, text.length); range.collapse(true);
    getSelection().removeAllRanges(); getSelection().addRange(range);
  });
  await page.keyboard.press('Enter');
  await page.keyboard.type('next');
  const lines = page.locator('.kn-block-focusable[contenteditable="true"]');
  // スマホのEnterは同じブロック内の改行なので、ブロック単位ではなく「nextがマーカーの中にないか」を見る。
  await expect(lines.first()).toContainText('next');
  expect(await page.evaluate(() => [...document.querySelectorAll('mark')].some(m => m.textContent.includes('next')))).toBe(false);

  // 真ん中の2文字だけ選んで解除すると、その2文字だけマーカーが外れる。
  await lines.first().evaluate(el => {
    const text = el.querySelector('mark').firstChild;
    const range = document.createRange(); range.setStart(text, 1); range.setEnd(text, 3);
    getSelection().removeAllRanges(); getSelection().addRange(range);
  });
  await page.locator('#kn-highlight-btn').click();
  await page.locator('[data-highlight-id="clear"]').click();
  await expect(lines.first().locator('mark')).toHaveText(['A', 'A']);
});

test('an unsaved memo draft survives a reload and can be restored', async ({ page }) => {
  await openApp(page);
  await go(page, 'memo');
  await page.getByRole('button', { name: '新規' }).click();
  await page.locator('#kn-edit-title').fill('下書きE2E');
  await page.locator('.kn-block-focusable[contenteditable="true"]').first().click();
  await page.keyboard.type('閉じても残る本文');
  await page.waitForTimeout(1200); // 下書きは入力が止まって0.8秒後に保存される
  await page.reload();
  await expect(page.locator('#loading-screen')).toHaveClass(/hidden/);
  await go(page, 'memo');
  await page.getByRole('button', { name: '新規' }).click();
  await page.locator('.kn-draft-banner [data-draft="restore"]').click();
  await expect(page.locator('#kn-edit-title')).toHaveValue('下書きE2E');
  await expect(page.locator('.kn-block-focusable[contenteditable="true"]').first()).toContainText('閉じても残る本文');
});

test('the month calendar fills the screen and hides the source switch when only the personal calendar exists', async ({ page }) => {
  await openApp(page);
  await go(page, 'calendar');
  // 共有グループが無ければ「個人」しか選べないので、切り替えの行は出さない。
  await expect(page.locator('.cal-source-bar')).toHaveCount(0);
  // 6週目の下端が、画面(スクロールする欄)の下端の近くまで届く。
  const gap = await page.evaluate(() => {
    const main = document.getElementById('main-content');
    const last = [...document.querySelectorAll('#cal-grid .cal-cell')].at(-1);
    return main.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom;
  });
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThan(60);
});
