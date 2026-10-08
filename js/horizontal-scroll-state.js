const HORIZONTAL_TABLES = '.kn-view-table-wrap, .kn-table-scroll, .learning-table-scroll';

/** 表ごとの識別子を作り、同じ画面の再描画で別の表へ位置を移さない。 */
function tableScrollKey(element, index) {
  const block = element.closest('[data-view-block-id], [data-block-id]');
  if (block) return `${element.className}:${block.dataset.viewBlockId || block.dataset.blockId}`;
  const heading = element.querySelector('thead')?.textContent || '';
  return `${element.className}:${index}:${heading}`;
}

/** 同期によるDOM交換前に、表の横位置だけを一時的に記録する。 */
export function captureHorizontalTableScroll(container) {
  if (!container) return [];
  return [...container.querySelectorAll(HORIZONTAL_TABLES)].map((element, index) => ({
    key: tableScrollKey(element, index),
    left: element.scrollLeft,
  }));
}

/** DOM交換後、対応する表が残っている場合に限って横位置を戻す。 */
export function restoreHorizontalTableScroll(container, positions) {
  if (!container || !positions?.length) return;
  const byKey = new Map(positions.map(({ key, left }) => [key, left]));
  [...container.querySelectorAll(HORIZONTAL_TABLES)].forEach((element, index) => {
    const left = byKey.get(tableScrollKey(element, index));
    if (Number.isFinite(left)) element.scrollLeft = left;
  });
}
