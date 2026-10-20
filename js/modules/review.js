// ============================================================
// review.js - 間隔反復の復習セッション
//
// 通常メモに加え、「復習に追加」した表現帳の単語とKnowledgeの回答も同じカードで扱う。
// 評価結果はstorage.jsの復習スケジュールへ保存する(ID単位なので種類を問わない)。
// ============================================================
import {
  getReviewsForDate, createReviewItemResolver,
  rateReview, addReviewLog, previewReviewIntervals,
} from '../storage.js';
import { renderBlocksView } from './memo.js';
import { esc, fmtDays, today } from '../utils.js';

// カード表面に出す、種類ごとの見出しと思い出す内容のヒント。
const KIND_LABELS = {
  memo: { badge: '', hint: '内容を思い出してからタップ' },
  atlas: { badge: '表現帳', hint: '意味とニュアンスを思い出してからタップ' },
  learning: { badge: 'Knowledge', hint: '答えの要点を思い出してからタップ' },
};

/** 表現帳の単語の答え面。意味ごとに核心の意味・ニュアンス・例文を短く並べる。 */
function atlasAnswerHtml(word) {
  const senses = Array.isArray(word.senses) && word.senses.length ? word.senses : [word];
  return senses.slice(0, 4).map(sense => {
    const examples = (Array.isArray(sense.examples) ? sense.examples : []).slice(0, 2);
    return `
      <section class="rv-answer-block">
        ${sense.partOfSpeech ? `<div class="rv-answer-kicker">${esc(sense.partOfSpeech)}</div>` : ''}
        ${sense.coreMeaningJa ? `<p class="rv-answer-main">${esc(sense.coreMeaningJa)}</p>` : ''}
        ${sense.nuanceJa ? `<p>${esc(sense.nuanceJa)}</p>` : ''}
        ${examples.map(example => `
          <p class="rv-answer-example" lang="en">${esc(example.english || example.sentence || '')}
            <span lang="ja">${esc(example.japanese || example.translation || '')}</span></p>`).join('')}
      </section>`;
  }).join('');
}

/** Knowledgeの回答の答え面。結論と要点だけを出す(全文は詳細画面で読む)。 */
function learningAnswerHtml(entry) {
  const direct = (entry.answer?.directAnswer || []).map(segment => segment.text || '').join('');
  const points = entry.answer?.keyPoints || [];
  return `
    ${entry.originalQuestion && entry.originalQuestion !== entry.title
      ? `<p class="rv-answer-kicker">元の質問: ${esc(entry.originalQuestion)}</p>` : ''}
    ${direct ? `<p class="rv-answer-main">${esc(direct)}</p>` : ''}
    ${points.length ? `<ul class="rv-answer-points">${points.map(point => `<li>${esc(point)}</li>`).join('')}</ul>` : ''}`;
}

/** 種類に合わせて答え面の本文を作る。 */
function answerHtml(item) {
  if (item.kind === 'atlas') return atlasAnswerHtml(item.data);
  if (item.kind === 'learning') return learningAnswerHtml(item.data);
  return `<div class="kn-view-content">${renderBlocksView(item.data.blocks || [])}</div>`;
}

/** カード上部の種類バッジとタグを返す。 */
function cardMeta(item) {
  const badge = KIND_LABELS[item.kind]?.badge;
  const chips = [
    badge ? `<span class="kn-tag-chip rv-kind-chip">${esc(badge)}</span>` : '',
    ...item.tags.map(tag => `<span class="kn-tag-chip">${esc(tag)}</span>`),
  ].filter(Boolean);
  return chips.length ? `<div class="rv-tags">${chips.join('')}</div>` : '';
}

/** `nav`: 指定したハッシュ画面へ移動し、必要なら遷移元の状態を引き継ぐ。 */
const nav = (view) => window.AppNav?.navigate(view);
let reviewSession = null;

/** 今日が期限のメモを一件ずつ復習し、評価から次回日を計算する。 */
export function initReview(container) {
  // 復習日はローカル日付で保存されるため、UTC日付で比べると日本の朝に前日扱いになる。
  const todayStr = today();
  if (!reviewSession || reviewSession.date !== todayStr) {
    reviewSession = {
      date: todayStr,
      queueIds: getReviewsForDate(todayStr).map(entry => entry.memoId),
      idx: 0,
      revealed: false,
    };
  }
  // 削除済みなどで見つからない項目は飛ばす。種類を問わず同じ形のカードにそろえる。
  const queue = reviewSession.queueIds.map(createReviewItemResolver()).filter(Boolean);
  reviewSession.idx = Math.min(reviewSession.idx, queue.length);

  /** 復習セッションを終了し、呼び出し元のメモ一覧へ戻る。 */
  const exitReview = () => {
    reviewSession = null;
    nav('home');
  };

  /** 現在の復習位置と表裏状態から、空・問題・答え・完了のいずれかを描画する。 */
  function render() {
    if (queue.length === 0) {
      renderEmpty();
      return;
    }
    if (reviewSession.idx >= queue.length) {
      renderDone();
      return;
    }
    if (reviewSession.revealed) renderBack(queue[reviewSession.idx]);
    else renderFront(queue[reviewSession.idx]);
  }

  /** 現在位置と総件数を表示する復習セッション共通ヘッダーを返す。 */
  function header() {
    const pct = Math.round((reviewSession.idx / queue.length) * 100);
    return `
      <div class="rv-header">
        <button class="btn btn-ghost btn-sm" id="rv-exit">← 終了</button>
        <span class="rv-count">${reviewSession.idx + 1} / ${queue.length}</span>
      </div>
      <div class="rv-progress-track"><div class="rv-progress-fill" style="width:${pct}%"></div></div>
    `;
  }

  /** 今日復習するメモがない状態を表示し、一覧へ戻る操作を接続する。 */
  function renderEmpty() {
    container.innerHTML = `
      <div class="rv-page rv-done">
        <div class="rv-done-icon">🎴</div>
        <div class="rv-done-title">今日の復習は完了しています</div>
        <div class="rv-done-sub">また明日続けましょう</div>
        <button class="btn btn-primary" id="rv-exit">ホームに戻る</button>
      </div>`;
    container.querySelector('#rv-exit')?.addEventListener('click', exitReview);
  }

  /** 今回の復習をすべて終えた状態と完了件数を表示する。 */
  function renderDone() {
    container.innerHTML = `
      <div class="rv-page rv-done">
        <div class="rv-done-icon">✓</div>
        <div class="rv-done-title">今日の復習 完了！</div>
        <div class="rv-done-sub">${queue.length}件のカードを復習しました</div>
        <button class="btn btn-primary" id="rv-exit">ホームに戻る</button>
      </div>`;
    container.querySelector('#rv-exit')?.addEventListener('click', exitReview);
  }

  /** 復習カードの題名だけを表面に出し、答えを開く操作を接続する。 */
  function renderFront(item) {
    container.innerHTML = `
      <div class="rv-page">
        ${header()}
        <div class="rv-card rv-card--front">
          ${cardMeta(item)}
          <h2 class="rv-title"${item.kind === 'atlas' ? ' lang="en"' : ''}>${esc(item.title)}</h2>
          <p class="rv-front-hint">${esc(KIND_LABELS[item.kind]?.hint || '')}</p>
        </div>
        <button class="btn btn-primary rv-reveal-btn" id="rv-reveal">
          答えを見る
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M7 10l5 5 5-5z"/></svg>
        </button>
      </div>`;
    container.querySelector('#rv-exit')?.addEventListener('click', exitReview);
    container.querySelector('#rv-reveal')?.addEventListener('click', () => {
      reviewSession.revealed = true;
      render();
    });
  }

  /** 答え(メモ本文・単語の意味・Knowledgeの結論)を表示し、評価から次回復習日を更新できるようにする。 */
  function renderBack(item) {
    const ivs = previewReviewIntervals(item.id);
    container.innerHTML = `
      <div class="rv-page rv-page--back">
        ${header()}
        <div class="rv-card rv-card--back">
          ${cardMeta(item)}
          <h2 class="rv-title"${item.kind === 'atlas' ? ' lang="en"' : ''}>${esc(item.title)}</h2>
          <div class="rv-divider"></div>
          <div class="rv-content">${answerHtml(item)}</div>
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

    container.querySelector('#rv-exit')?.addEventListener('click', exitReview);
    container.querySelectorAll('.rv-btn[data-r]').forEach(btn => {
      btn.addEventListener('click', () => {
        addReviewLog(item.id, item.tags);
        rateReview(item.id, btn.dataset.r);
        reviewSession.idx++;
        reviewSession.revealed = false;
        render();
      });
    });
  }

  render();
}
