// ============================================================
// review-toggle.js - 表現帳とKnowledgeの「復習に追加」ボタン
//
// 通常メモは作成時に自動で復習対象になるが、表現帳の単語とKnowledgeの回答は数が多いため、
// 利用者が選んだものだけを復習カードへ入れる。予定はメモと同じ復習スケジュールに入る。
// ============================================================
import { isReviewScheduled, setMemoReviewEnabled } from './storage.js';
import { esc } from './utils.js';

/** ボタンの文言を、今の状態(追加済みか)に合わせて返す。 */
function label(active) {
  return active ? '✓ 復習中' : '＋ 復習に追加';
}

/** 「復習に追加」ボタンのHTMLを返す。表示する画面側で好きな場所へ置く。 */
export function reviewToggleButtonHtml(id) {
  const active = isReviewScheduled(id);
  return `<button type="button" class="btn btn-ghost btn-sm review-toggle-btn${active ? ' is-active' : ''}"
    data-review-toggle="${esc(id)}" aria-pressed="${active}">${label(active)}</button>`;
}

/**
 * 画面内の「復習に追加」ボタンを動くようにする。押すと復習予定を作る(翌日から)か、
 * 「復習なし」にする。notify は各画面の通知関数(toast)。
 */
export function wireReviewToggles(container, notify) {
  container.querySelectorAll('[data-review-toggle]').forEach(button => {
    button.addEventListener('click', () => {
      const id = button.dataset.reviewToggle;
      const next = !isReviewScheduled(id);
      setMemoReviewEnabled(id, next);
      button.classList.toggle('is-active', next);
      button.setAttribute('aria-pressed', String(next));
      button.textContent = label(next);
      notify?.(next ? '復習に追加しました（明日から出題されます）' : '復習から外しました', 'success');
    });
  });
}
