// ============================================================
// review.js - Anki-like spaced repetition review session
// ============================================================
import {
  getReviewsForDate, getKnowledgeMemoById,
  rateReview, addReviewLog, previewReviewIntervals,
} from '../storage.js';
import { renderBlocksView } from './knowledge.js';
import { esc, fmtDays } from '../utils.js';

const nav = (view) => window.AppNav?.navigate(view);

export function initReview(container) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const dueEntries = getReviewsForDate(todayStr);
  const queue = dueEntries.map(e => getKnowledgeMemoById(e.memoId)).filter(Boolean);

  let idx = 0;
  let revealed = false;

  function render() {
    if (queue.length === 0) {
      renderEmpty();
      return;
    }
    if (idx >= queue.length) {
      renderDone();
      return;
    }
    if (revealed) renderBack(queue[idx]);
    else renderFront(queue[idx]);
  }

  function header() {
    const pct = Math.round((idx / queue.length) * 100);
    return `
      <div class="rv-header">
        <button class="btn btn-ghost btn-sm" id="rv-exit">← 終了</button>
        <span class="rv-count">${idx + 1} / ${queue.length}</span>
      </div>
      <div class="rv-progress-track"><div class="rv-progress-fill" style="width:${pct}%"></div></div>
    `;
  }

  function renderEmpty() {
    container.innerHTML = `
      <div class="rv-page rv-done">
        <div class="rv-done-icon">🎴</div>
        <div class="rv-done-title">今日の復習は完了しています</div>
        <div class="rv-done-sub">また明日続けましょう</div>
        <button class="btn btn-primary" id="rv-exit">ホームに戻る</button>
      </div>`;
    container.querySelector('#rv-exit')?.addEventListener('click', () => nav('home'));
  }

  function renderDone() {
    container.innerHTML = `
      <div class="rv-page rv-done">
        <div class="rv-done-icon">✓</div>
        <div class="rv-done-title">今日の復習 完了！</div>
        <div class="rv-done-sub">${queue.length}件のカードを復習しました</div>
        <button class="btn btn-primary" id="rv-exit">ホームに戻る</button>
      </div>`;
    container.querySelector('#rv-exit')?.addEventListener('click', () => nav('home'));
  }

  function renderFront(memo) {
    container.innerHTML = `
      <div class="rv-page">
        ${header()}
        <div class="rv-card rv-card--front">
          ${memo.tags?.length
            ? `<div class="rv-tags">${memo.tags.map(t => `<span class="kn-tag-chip">${esc(t)}</span>`).join('')}</div>`
            : ''}
          <h2 class="rv-title">${esc(memo.title || '無題')}</h2>
          <p class="rv-front-hint">内容を思い出してからタップ</p>
        </div>
        <button class="btn btn-primary rv-reveal-btn" id="rv-reveal">
          答えを見る
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M7 10l5 5 5-5z"/></svg>
        </button>
      </div>`;
    container.querySelector('#rv-exit')?.addEventListener('click', () => nav('home'));
    container.querySelector('#rv-reveal')?.addEventListener('click', () => {
      revealed = true;
      render();
    });
  }

  function renderBack(memo) {
    const ivs = previewReviewIntervals(memo.id);
    container.innerHTML = `
      <div class="rv-page rv-page--back">
        ${header()}
        <div class="rv-card rv-card--back">
          ${memo.tags?.length
            ? `<div class="rv-tags">${memo.tags.map(t => `<span class="kn-tag-chip">${esc(t)}</span>`).join('')}</div>`
            : ''}
          <h2 class="rv-title">${esc(memo.title || '無題')}</h2>
          <div class="rv-divider"></div>
          <div class="rv-content kn-view-content">${renderBlocksView(memo.blocks || [])}</div>
        </div>
        <div class="rv-rating">
          <div class="rv-rating-label">どのくらい思い出せましたか？</div>
          <div class="rv-rating-btns">
            <button class="rv-btn rv-btn--again" data-r="again">
              <span class="rv-btn-label">もう一度</span><span class="rv-btn-interval">${fmtDays(ivs.again)}</span>
            </button>
            <button class="rv-btn rv-btn--hard" data-r="hard">
              <span class="rv-btn-label">難しい</span><span class="rv-btn-interval">${fmtDays(ivs.hard)}</span>
            </button>
            <button class="rv-btn rv-btn--good" data-r="good">
              <span class="rv-btn-label">普通</span><span class="rv-btn-interval">${fmtDays(ivs.good)}</span>
            </button>
            <button class="rv-btn rv-btn--easy" data-r="easy">
              <span class="rv-btn-label">簡単</span><span class="rv-btn-interval">${fmtDays(ivs.easy)}</span>
            </button>
          </div>
        </div>
      </div>`;

    container.querySelector('#rv-exit')?.addEventListener('click', () => nav('home'));
    container.querySelectorAll('.rv-btn[data-r]').forEach(btn => {
      btn.addEventListener('click', () => {
        addReviewLog(memo.id, memo.tags);
        rateReview(memo.id, btn.dataset.r);
        idx++;
        revealed = false;
        render();
      });
    });
  }

  render();
}
