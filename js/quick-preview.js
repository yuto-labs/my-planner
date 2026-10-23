// ============================================================
// quick-preview.js - 詳しい解説ができるまでの間、先に短い要点を見せる欄
//
// Knowledge・表現帳の生成は時間がかかる(長い解説を深く考えて作るため)。待っている間に、
// 速いモデルで作った3〜5行の要点を、入力欄の下に出す。詳しい解説ができたら、この欄は消える。
// 要点は保存しない(表示するだけ)。要点の作成に失敗しても、詳しい解説の作成には影響しない。
// ============================================================
import { generateQuickPreview } from './ai.js';
import { esc } from './utils.js';

/**
 * anchor(状態表示や入力フォーム)のすぐ下に要点の欄を出し、要点を作り始める。
 * @returns {{ remove: Function }} 詳しい解説ができた時に呼んで、欄を消す
 */
export function startQuickPreview(anchor, kind, text) {
  if (!anchor?.isConnected) return { remove() {} };
  const box = document.createElement('section');
  box.className = 'quick-preview';
  box.setAttribute('aria-live', 'polite');
  box.innerHTML = `
    <p class="quick-preview-label">要点 <span>先に表示しています・詳しい解説を作成中</span></p>
    <div class="quick-preview-body"><span class="quick-preview-wait">要点を作っています…</span></div>`;
  anchor.after(box);
  const controller = new AbortController();
  generateQuickPreview(kind, text, { signal: controller.signal })
    .then(answer => {
      if (!box.isConnected) return;
      if (!answer) { box.remove(); return; }
      // AIが作った文なので、必ずエスケープしてから改行だけを戻す。
      box.querySelector('.quick-preview-body').innerHTML = esc(answer).replace(/\n/g, '<br>');
    })
    .catch(() => box.remove());
  return {
    /** 欄を消し、まだ作っている途中なら要点の作成もやめる。 */
    remove() {
      controller.abort();
      box.remove();
    },
  };
}
