// ============================================================
// space-ai.js - メモ欄の右下のAI。今開いているデータベース(またはメモ)について聞ける
//
// 例: うんちくデータベースで「工場のあれってなんだっけ」→ 中身から探して答え、URLがあれば案内し、
// 必要なら一般的な知識で少し補足する(ネット検索はサーバーの設定で有効な時だけ、出典付き)。
// 答えに出てきた行の名前は押せるボタンになり、その行のページ(PCは右側、スマホは全画面)が開く。
// PCは右下に浮かぶ小さな窓、スマホは下から出るシート。やり取りは欄ごとに、アプリを閉じるまで覚える。
// ============================================================
import { getDatabase, getDatabaseRowIds, getKnowledgeMemos, isAiAvailable } from '../storage.js';
import { formatValue, looksSecret } from '../database-model.js';
import { memoBlocksToText } from '../memo-model.js';
import { pickContext, renderAnswer } from '../space-ai-model.js';
import { askSpaceAI } from '../ai.js';
import { esc } from '../utils.js';
import { MEMO_SPACE, getActiveSpaceId, openRowFromAI } from './database.js';
import { openKnowledgeAiOrganizer } from './memo.js';

const histories = new Map();   // 欄ごとのやり取り(アプリを閉じるまで)
let panel = null;

/** 今の欄の名前・種類と、AIへ渡す「行ごとの文」の一覧を作る。パスワードらしい列は渡さない。 */
function collectDocs() {
  const spaceId = getActiveSpaceId();
  const memos = getKnowledgeMemos();
  if (spaceId !== MEMO_SPACE) {
    const db = getDatabase(spaceId);
    if (db) {
      const byId = new Map(memos.map(memo => [memo.id, memo]));
      const props = db.properties.filter(prop => !looksSecret(prop.name));
      return {
        key: db.id, name: db.name, kind: 'table',
        docs: db.order.map(id => byId.get(id)).filter(Boolean).map(memo => {
          const values = props.map(prop => [prop.name, formatValue(prop.type, db.rows[memo.id]?.[prop.id])]).filter(([, value]) => value);
          const body = memoBlocksToText(memo.blocks || [], 800);
          return { id: memo.id, title: memo.title || '無題', text: `【${memo.title || '無題'}】 ${values.map(([name, value]) => `${name}: ${value}`).join(' / ')}${body ? ` / 本文: ${body}` : ''}` };
        }),
      };
    }
  }
  const rowIds = getDatabaseRowIds();
  return {
    key: MEMO_SPACE, name: 'メモ', kind: 'memos',
    docs: memos.filter(memo => !rowIds.has(memo.id)).map(memo => ({
      id: memo.id,
      title: memo.title || '無題',
      text: `【${memo.title || '無題'}】 タグ: ${(memo.tags || []).join(', ') || 'なし'} / 更新: ${String(memo.updatedAt || '').slice(0, 10)} / 本文: ${memoBlocksToText(memo.blocks || [], 600)}`,
    })),
  };
}

/** 入口のおすすめの質問(押すとそのまま聞く)。「メモ」では、文章をメモに整理するAIもここから使える。 */
function suggestions(kind) {
  return kind === 'memos'
    ? ['最近書いたメモは？', 'タグごとにどんなメモがある？']
    : ['どんな内容が入ってる？', 'URLが入っている行は？', '最近追加したのは？'];
}

/** やり取りの欄を描き直す。 */
function drawLog() {
  if (!panel) return;
  const { key, name, kind, docs } = collectDocs();
  const history = histories.get(key) || [];
  panel.querySelector('.sai-title').textContent = `${name}について聞く`;
  const log = panel.querySelector('.sai-log');
  if (!isAiAvailable()) {
    log.innerHTML = '<p class="sai-note">このアカウントではAIを使えません。設定の「AI」で状態を確認できます。</p>';
    return;
  }
  log.innerHTML = history.length ? history.map(item => (item.role === 'user'
    ? `<div class="sai-msg sai-msg--user">${esc(item.text)}</div>`
    : `<div class="sai-msg sai-msg--ai${item.error ? ' is-error' : ''}">${item.pending ? '<span class="sai-typing">考えています…</span>' : renderAnswer(item.text, docs)}</div>`)).join('') : `
    <p class="sai-note">「${esc(name)}」の中身(${docs.length}件)から答えます。答えに出た名前を押すと、その${kind === 'memos' ? 'メモ' : '行'}が開きます。</p>
    <div class="sai-suggest">
      ${suggestions(kind).map(text => `<button class="sai-chip" type="button" data-ask="${esc(text)}">${esc(text)}</button>`).join('')}
      ${kind === 'memos' ? '<button class="sai-chip" type="button" data-organize>文章をメモに整理する</button>' : ''}
    </div>`;
  log.scrollTop = log.scrollHeight;
}

/** 質問を送り、答えが来たら欄に足す。 */
async function ask(question) {
  const text = String(question || '').trim();
  if (!text || !isAiAvailable()) return;
  const { key, name, kind, docs } = collectDocs();
  const history = histories.get(key) || [];
  histories.set(key, history);
  const previous = history.filter(item => !item.pending && !item.error);
  history.push({ role: 'user', text }, { role: 'ai', text: '', pending: true });
  drawLog();
  const answer = history.at(-1);
  try {
    answer.text = await askSpaceAI({ spaceName: name, kind, context: pickContext(docs, text), question: text, history: previous });
  } catch (error) {
    answer.text = `答えを受け取れませんでした。${error?.message || ''}`;
    answer.error = true;
  }
  answer.pending = false;
  drawLog();
}

/** パネルを閉じる。 */
export function closeSpaceAI() {
  panel?.remove();
  panel = null;
  document.body.classList.remove('sai-open');
}

/** 右下のAIボタンから開く。もう開いていれば閉じる(押すたびに開け閉め)。 */
export function openSpaceAI() {
  if (panel) { closeSpaceAI(); return; }
  panel = document.createElement('section');
  panel.className = 'sai';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'AIに聞く');
  panel.innerHTML = `
    <header class="sai-head">
      <span class="sai-spark" aria-hidden="true">✦</span><strong class="sai-title"></strong>
      <button class="sai-icon" type="button" data-sai-reset title="最初から">↺</button>
      <button class="sai-icon" type="button" data-sai-close aria-label="閉じる">×</button>
    </header>
    <div class="sai-log" aria-live="polite"></div>
    <form class="sai-form">
      <textarea class="sai-input" rows="1" placeholder="例: 工場のあれってなんだっけ" aria-label="質問"></textarea>
      <button class="sai-send" type="submit" aria-label="送信">↑</button>
    </form>`;
  document.body.append(panel);
  document.body.classList.add('sai-open');
  const input = panel.querySelector('.sai-input');
  /** 入力に合わせて高さを伸ばす(4行まで)。 */
  const fit = () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 120)}px`; };
  input.addEventListener('input', fit);
  input.addEventListener('keydown', event => {
    // Enterで送信、Shift+Enterで改行。日本語の変換中のEnterでは送らない。
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    panel.querySelector('.sai-form').requestSubmit();
  });
  panel.querySelector('.sai-form').addEventListener('submit', event => {
    event.preventDefault();
    const question = input.value;
    input.value = '';
    fit();
    ask(question);
  });
  panel.addEventListener('click', event => {
    if (event.target.closest('[data-sai-close]')) { closeSpaceAI(); return; }
    if (event.target.closest('[data-sai-reset]')) { histories.delete(collectDocs().key); drawLog(); return; }
    const chip = event.target.closest('[data-ask]');
    if (chip) { ask(chip.dataset.ask); return; }
    if (event.target.closest('[data-organize]')) { closeSpaceAI(); openKnowledgeAiOrganizer(); return; }
    const cite = event.target.closest('[data-ai-row]');
    if (cite) {
      // スマホは行のページが全画面で開くので、AIの欄は閉じる(PCは右側に開くので開いたまま)。
      if (!window.matchMedia?.('(min-width: 1000px)')?.matches) closeSpaceAI();
      openRowFromAI(cite.dataset.aiRow);
    }
  });
  drawLog();
  if (window.matchMedia?.('(hover: hover)')?.matches) input.focus();
}

// 別の画面へ移ったら閉じる(メモ欄の中身についてのAIなので)。
document.addEventListener('appNavigated', () => {
  if (document.getElementById('main-content')?.dataset.view === 'memo') return;
  closeSpaceAI();
  document.body.classList.remove('has-peek');
});
