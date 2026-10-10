// PCでは本文を主役にし、詳細画面だけに検索可能な補助一覧を添える。
// 保存データは変更せず、既存の各画面の「開く」操作を再利用する。
import { getExpressionEntries, getKnowledgeMemos, getLearningEntries } from './storage.js';
import { esc } from './utils.js';
import { confirmDiscardKnowledgeChanges, openKnowledgeMemo } from './modules/memo.js';
import { getSelectedLearningEntryId, openLearningEntry } from './modules/learning-library.js';
import { getAtlasDesktopSelectedId, openAtlasDesktopEntry } from './modules/expression-atlas.js';

const wideDesktop = '(min-width: 1280px) and (pointer: fine)';
const desktop = '(min-width: 1000px) and (pointer: fine)';
const MAX_VISIBLE = 80;
const CONTEXT_WIDTH_KEY = 'planner.desktopContextWidth';
const PAGE_WIDTH_KEY = 'planner.desktopPageWidth';
let currentView = '';
let currentMode = '';
let currentSelectedId = '';
let allItems = [];
let query = '';
let openOverride = null;

/** PCの幅設定だけを端末内から読み、未保存・保存不可なら初期幅を使う。 */
function readWidth(key, fallback) {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  } catch { return fallback; }
}

/** ドラッグ後の表示幅を保存する。メモや同期データには書き込まない。 */
function saveWidth(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* Private browsing may block storage. */ }
}

let contextWidth = readWidth(CONTEXT_WIDTH_KEY, 250);
let pageWidth = readWidth(PAGE_WIDTH_KEY, 1480);

/** 主領域が狭くなりすぎない範囲に幅を収める。 */
function clampWidth(value, min, max) {
  return Math.round(Math.max(min, Math.min(value, max)));
}

/** 現在の画面幅に収まる実効値をCSSへ渡す。保存値自体は変えない。 */
function applyWidths() {
  const app = document.getElementById('app');
  if (!app) return;
  const effectiveContextWidth = clampWidth(contextWidth, 190, Math.max(190, Math.min(420, window.innerWidth - 720)));
  const effectivePageWidth = clampWidth(pageWidth, 700, Math.max(700, window.innerWidth - 112));
  app.style.setProperty('--desktop-context-width', `${effectiveContextWidth}px`);
  app.style.setProperty('--desktop-page-width', `${effectivePageWidth}px`);
  const separator = app.querySelector('.desktop-context-resizer');
  separator?.setAttribute('aria-valuenow', String(effectiveContextWidth));
  separator?.setAttribute('aria-valuemax', String(Math.max(190, Math.min(420, window.innerWidth - 720))));
  const pageSeparator = document.getElementById('desktop-page-resizer');
  pageSeparator?.setAttribute('aria-valuenow', String(effectivePageWidth));
  pageSeparator?.setAttribute('aria-valuemin', '700');
  pageSeparator?.setAttribute('aria-valuemax', String(Math.max(700, window.innerWidth - 112)));
  positionPageResizer();
}

/** ホームまたはカレンダーの右端へ幅調整ハンドルを重ねる。 */
function positionPageResizer() {
  const separator = document.getElementById('desktop-page-resizer');
  if (!separator) return;
  const active = window.matchMedia(desktop).matches && ['home', 'calendar'].includes(currentView);
  separator.hidden = !active;
  if (!active) return;
  const main = document.getElementById('main-content');
  const target = main?.querySelector(currentView === 'home' ? '.home-page' : '#cal-view');
  if (!target) { separator.hidden = true; return; }
  separator.style.left = `${Math.min(window.innerWidth - 16, target.getBoundingClientRect().right - 6)}px`;
}

/** マウスドラッグを捕捉し、一覧か主領域の幅を連続更新する。 */
function startResize(event, kind, separator = event.currentTarget) {
  if (event.button !== 0) return;
  const startX = event.clientX;
  const startWidth = Number(separator.getAttribute('aria-valuenow'))
    || (kind === 'context' ? contextWidth : pageWidth);
  separator.setPointerCapture(event.pointerId);
  event.preventDefault();
  /** ポインタが動いた分だけ幅を変え、主領域は中央寄せなので移動量を二倍にする。 */
  const move = moveEvent => {
    if (moveEvent.pointerId !== event.pointerId) return;
    if (kind === 'context') contextWidth = startWidth + moveEvent.clientX - startX;
    else pageWidth = startWidth + 2 * (moveEvent.clientX - startX);
    applyWidths();
  };
  /** ドラッグを終了して幅を端末内へ保存する。 */
  const stop = stopEvent => {
    if (stopEvent.pointerId !== event.pointerId) return;
    separator.removeEventListener('pointermove', move);
    separator.removeEventListener('pointerup', stop);
    separator.removeEventListener('pointercancel', stop);
    saveWidth(kind === 'context' ? CONTEXT_WIDTH_KEY : PAGE_WIDTH_KEY,
      kind === 'context' ? contextWidth : pageWidth);
  };
  separator.addEventListener('pointermove', move);
  separator.addEventListener('pointerup', stop);
  separator.addEventListener('pointercancel', stop);
}

/** フォーカス中の矢印キーで幅を変更し、Homeキーで初期幅へ戻す。 */
function resizeByKeyboard(event, kind) {
  if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
  event.preventDefault();
  const current = Number(event.currentTarget.getAttribute('aria-valuenow'))
    || (kind === 'context' ? contextWidth : pageWidth);
  const next = event.key === 'Home' ? (kind === 'context' ? 250 : 1480)
    : current + (event.key === 'ArrowRight' ? 20 : -20);
  if (kind === 'context') contextWidth = next;
  else pageWidth = next;
  applyWidths();
  saveWidth(kind === 'context' ? CONTEXT_WIDTH_KEY : PAGE_WIDTH_KEY,
    kind === 'context' ? contextWidth : pageWidth);
}

/** 一覧と詳細を並べられる画面だけを対象とし、他画面に空欄を作らない。 */
export function getDesktopContextMode(view, atlasSelectedId = '') {
  if (view === 'knowledge-detail') return 'memo';
  if (view === 'learning-detail') return 'knowledge';
  if (view === 'expression-atlas' && atlasSelectedId) return 'atlas';
  return '';
}

/** 保存済みの見出しだけを投影し、本文や画像を一覧DOMへ複製しない。 */
function getContextItems(mode) {
  if (mode === 'memo') {
    return getKnowledgeMemos()
      .sort((a, b) => Number(!!b.starred) - Number(!!a.starred)
        || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
      .map(item => ({
        id: item.id,
        title: item.title || '無題のメモ',
        detail: Array.isArray(item.tags) ? item.tags.join(' · ') : '',
      }));
  }
  if (mode === 'knowledge') {
    return getLearningEntries().map(item => ({
      id: item.id,
      title: item.title || item.originalQuestion || '無題',
      detail: item.originalQuestion && item.originalQuestion !== item.title ? item.originalQuestion : '',
    }));
  }
  if (mode === 'atlas') {
    return getExpressionEntries().map(item => ({
      id: item.id,
      title: item.term || '無題',
      detail: item.coreMeaningJa || item.nuanceJa || '',
    }));
  }
  return [];
}

/** 入力欄とスクロール位置を保ちつつ、検索に合う見出しだけを差し替える。 */
function renderItemList(panel) {
  const list = panel.querySelector('.desktop-context-list');
  const count = panel.querySelector('.desktop-context-count');
  if (!list || !count) return;
  const needle = query.trim().toLocaleLowerCase();
  const matches = needle
    ? allItems.filter(item => `${item.title} ${item.detail}`.toLocaleLowerCase().includes(needle))
    : allItems;
  count.textContent = `${matches.length}件`;
  list.innerHTML = matches.slice(0, MAX_VISIBLE).map(item => `
    <button type="button" class="desktop-context-item${item.id === currentSelectedId ? ' is-current' : ''}"
      data-desktop-item="${esc(item.id)}" ${item.id === currentSelectedId ? 'aria-current="page"' : ''}>
      <strong>${esc(item.title)}</strong>
      ${item.detail ? `<span>${esc(item.detail)}</span>` : ''}
    </button>
  `).join('') || '<p class="desktop-context-empty">一致する項目はありません</p>';
  if (matches.length > MAX_VISIBLE) {
    list.insertAdjacentHTML('beforeend', `<p class="desktop-context-more">最初の${MAX_VISIBLE}件を表示中</p>`);
  }
}

/** 画面幅と手動開閉を合わせ、PCレール・補助一覧の表示状態を同期する。 */
function syncOpenState() {
  const app = document.getElementById('app');
  const toggle = document.getElementById('desktop-context-toggle');
  if (!app || !toggle) return;
  const applicable = !!currentMode && window.matchMedia(desktop).matches;
  const open = applicable && (openOverride ?? window.matchMedia(wideDesktop).matches);
  app.dataset.desktopContextOpen = String(open);
  toggle.classList.toggle('hidden', !applicable);
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? '項目一覧を閉じる' : '項目一覧を表示');
  toggle.title = open ? '項目一覧を閉じる' : '項目一覧を表示';
}

/** 現在の詳細に合う一覧を更新する。選択だけの変化では検索入力を作り直さない。 */
export function refreshDesktopWorkspace(view = currentView, { force = false } = {}) {
  currentView = view;
  const panel = document.getElementById('desktop-context');
  const app = document.getElementById('app');
  if (!panel || !app) return;
  const atlasId = view === 'expression-atlas' ? getAtlasDesktopSelectedId() : '';
  const mode = getDesktopContextMode(view, atlasId);
  const selectedId = mode === 'memo'
    ? new URLSearchParams(window.location.hash.split('?')[1] || '').get('id') || ''
    : mode === 'knowledge' ? getSelectedLearningEntryId() : atlasId;
  const modeChanged = mode !== currentMode;
  const selectionChanged = selectedId !== currentSelectedId;
  currentMode = mode;
  currentSelectedId = selectedId;
  if (modeChanged) {
    query = '';
    openOverride = null;
  }
  app.dataset.desktopContext = mode;
  panel.hidden = !mode;
  if (!mode) {
    syncOpenState();
    applyWidths();
    requestAnimationFrame(positionPageResizer);
    return;
  }

  // スマホでは補助欄用の全件走査を行わない。PCへの切替時にまとめて作る。
  if (!window.matchMedia(desktop).matches) {
    syncOpenState();
    positionPageResizer();
    return;
  }

  if (modeChanged || force || !panel.querySelector('.desktop-context-list')) {
    const scrollTop = modeChanged ? 0 : panel.querySelector('.desktop-context-list')?.scrollTop || 0;
    allItems = getContextItems(mode);
    const label = { memo: 'Memo', knowledge: 'Knowledge', atlas: 'Nuance Atlas' }[mode];
    panel.setAttribute('aria-label', `${label}の項目一覧`);
    panel.innerHTML = `
      <div class="desktop-context-head"><strong>${label}</strong><span class="desktop-context-count"></span></div>
      <label class="desktop-context-search"><span class="sr-only">${label}を検索</span>
        <input type="search" placeholder="一覧を検索" value="${esc(query)}" autocomplete="off">
      </label>
      <div class="desktop-context-list"></div>
      <div class="desktop-context-resizer" role="separator" aria-label="項目一覧の幅を調整"
        aria-orientation="vertical" aria-valuemin="190" aria-valuemax="420" tabindex="0"></div>
    `;
    renderItemList(panel);
    panel.querySelector('.desktop-context-list').scrollTop = scrollTop;
  } else if (selectionChanged) {
    panel.querySelectorAll('[data-desktop-item]').forEach(button => {
      const active = button.dataset.desktopItem === selectedId;
      button.classList.toggle('is-current', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  }
  syncOpenState();
  applyWidths();
  requestAnimationFrame(positionPageResizer);
}

/** PC補助一覧の検索・開閉・項目選択を一度だけ接続する。 */
export function initDesktopWorkspace() {
  const panel = document.getElementById('desktop-context');
  const toggle = document.getElementById('desktop-context-toggle');
  if (!panel || !toggle) return;
  applyWidths();
  const pageSeparator = document.getElementById('desktop-page-resizer');
  pageSeparator?.addEventListener('pointerdown', event => startResize(event, 'page'));
  pageSeparator?.addEventListener('keydown', event => resizeByKeyboard(event, 'page'));
  panel.addEventListener('pointerdown', event => {
    const separator = event.target.closest('.desktop-context-resizer');
    if (separator) startResize(event, 'context', separator);
  });
  panel.addEventListener('keydown', event => {
    if (event.target.matches('.desktop-context-resizer')) resizeByKeyboard(event, 'context');
  });
  toggle.addEventListener('click', () => {
    const app = document.getElementById('app');
    openOverride = app?.dataset.desktopContextOpen !== 'true';
    syncOpenState();
  });
  panel.addEventListener('input', event => {
    if (!event.target.matches('.desktop-context-search input')) return;
    query = event.target.value;
    renderItemList(panel);
  });
  panel.addEventListener('click', event => {
    const button = event.target.closest('[data-desktop-item]');
    if (!button || !panel.contains(button)) return;
    const id = button.dataset.desktopItem;
    if (id === currentSelectedId) return;
    if (currentMode === 'memo') {
      if (!confirmDiscardKnowledgeChanges()) return;
      openKnowledgeMemo(id);
    } else if (currentMode === 'knowledge') {
      openLearningEntry(id);
    } else if (currentMode === 'atlas') {
      openAtlasDesktopEntry(id);
    }
    if (!window.matchMedia(wideDesktop).matches) {
      openOverride = false;
      syncOpenState();
    }
  });
  window.matchMedia(wideDesktop).addEventListener('change', syncOpenState);
  window.matchMedia(desktop).addEventListener('change', () =>
    refreshDesktopWorkspace(currentView, { force: true }));
  window.addEventListener('resize', applyWidths);
}
