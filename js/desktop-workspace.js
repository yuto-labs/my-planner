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
let currentView = '';
let currentMode = '';
let currentSelectedId = '';
let allItems = [];
let query = '';
let openOverride = null;

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
  if (!mode) { syncOpenState(); return; }

  // スマホでは補助欄用の全件走査を行わない。PCへの切替時にまとめて作る。
  if (!window.matchMedia(desktop).matches) {
    syncOpenState();
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
}

/** PC補助一覧の検索・開閉・項目選択を一度だけ接続する。 */
export function initDesktopWorkspace() {
  const panel = document.getElementById('desktop-context');
  const toggle = document.getElementById('desktop-context-toggle');
  if (!panel || !toggle) return;
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
}
