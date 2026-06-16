// ============================================================
// app.js — Main SPA router & app shell
// ============================================================

import { getSettings, getBatchSettings, getPendingAIQueue, autoArchiveTasks, isAiAvailable } from './storage.js';
import { processBatchQueue, refreshAiRuntimeStatus } from './ai.js';
import { initSync, pullAll, pullIfStale } from './sync.js';
import { getSession, handleAuthRedirect } from './supabase.js';
import { today } from './utils.js';
import { initHome }     from './modules/home.js';
import { initCalendar, openCalendarAddFlow } from './modules/calendar.js';
import { initTasks }    from './modules/tasks.js';
import { initGoals }    from './modules/goals.js';
import { initSettings, initAISettings } from './modules/settings.js';
import { initToday }    from './modules/today.js';
import { initKnowledge, initKnowledgeDetail, openKnowledgeMemo, backFromKnowledgeDetail } from './modules/knowledge.js';
import { initReview } from './modules/review.js';
import { initKnowledgeGraph } from './modules/knowledge-graph.js';
import { initAnalytics } from './modules/analytics.js';
import { openSearch, closeSearch } from './modules/search.js';
import { initArchive } from './modules/archive.js';
import { initTagsPage, setTagFilter } from './modules/tagspage.js';

// ---- Module registry ----
const MODULES = {
  home:              { title: 'My planner', init: initHome },
  calendar:          { title: 'Calendar',   init: initCalendar },
  tasks:             { title: 'Tasks',      init: initTasks },
  goals:             { title: 'Goals',      init: initGoals,          back: 'tasks' },
  settings:          { title: 'Settings',   init: initSettings },
  'ai-settings':     { title: 'AI Settings', init: initAISettings,      back: 'settings' },
  today:             { title: 'Today',      init: initToday,          back: 'home' },
  knowledge:         { title: 'Knowledge Notes', init: initKnowledge },
  'knowledge-detail':{ title: 'Note',       init: initKnowledgeDetail, back: 'knowledge', backAction: backFromKnowledgeDetail },
  'knowledge-graph': { title: 'Knowledge Graph', init: initKnowledgeGraph, back: 'knowledge' },
  analytics:         { title: 'Analytics',  init: initAnalytics },
  review:            { title: '復習セッション', init: initReview, back: 'home' },
  archive:           { title: 'Archive',    init: initArchive,         back: 'tasks' },
  tags:              { title: 'Tags',       init: initTagsPage },
};

let currentView = null;
let cleanupFn = null;

// ---- Navigation ----

export function navigate(view, options = {}) {
  if (!MODULES[view]) view = 'home';
  if (view === currentView) return;
  const preserveScroll = !!options.preserveScroll;

  // Cleanup previous module
  if (cleanupFn) { try { cleanupFn(); } catch {} cleanupFn = null; }

  currentView = view;
  window.location.hash = view;

  // Update nav active state
  document.querySelectorAll('#bottom-nav .nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  // Update title
  document.getElementById('page-title').textContent = MODULES[view].title;

  // Show / hide back button for sub-pages
  const backBtn = document.getElementById('back-btn');
  if (backBtn) {
    const backTarget = MODULES[view].back;
    if (backTarget) {
      backBtn.classList.remove('hidden');
      backBtn.onclick = () => {
        const action = MODULES[view].backAction;
        if (action) action();
        else navigate(backTarget);
      };
    } else {
      backBtn.classList.add('hidden');
      backBtn.onclick = null;
    }
  }

  // Clear & render
  const main = document.getElementById('main-content');
  main.style.scrollBehavior = 'auto';
  if (!preserveScroll) main.scrollTop = 0;
  main.innerHTML = '';
  main.dataset.view = view; // for CSS glow on home
  cleanupFn = MODULES[view].init(main) || null;
  if (!preserveScroll) main.scrollTop = 0;
  requestAnimationFrame(() => {
    if (!preserveScroll) main.scrollTop = 0;
    main.style.scrollBehavior = '';
  });
  document.dispatchEvent(new CustomEvent('appNavigated', { detail: { view } }));
}

// ---- Toast ----

let toastTimer = null;
export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

/**
 * Toast with an undo button. Stays for 5s.
 * onUndo() is called if user taps "取り消し".
 */
export function showUndoToast(message, onUndo) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast toast-info toast--undo';
  toast.innerHTML = `<span>${message}</span><button class="toast-undo-btn">取り消し</button>`;
  container.appendChild(toast);

  const timer = setTimeout(() => toast.remove(), 5000);
  toast.querySelector('.toast-undo-btn')?.addEventListener('click', () => {
    clearTimeout(timer);
    toast.remove();
    onUndo?.();
  });
}

// ---- Modal system ----

let modalCleanup = null;

export function openModal({ title, body, footer, onClose, wide = false }) {
  const overlay = document.getElementById('modal-overlay');
  overlay.innerHTML = '';
  overlay.classList.remove('hidden');

  const modal = document.createElement('div');
  modal.className = 'modal' + (wide ? ' modal-wide' : '');

  modal.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">${title}</span>
      <button class="modal-close" aria-label="閉じる">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
      </button>
    </div>
    <div class="modal-body"></div>
    ${footer ? '<div class="modal-footer"></div>' : ''}
  `;

  modal.querySelector('.modal-body').appendChild(body);
  if (footer) modal.querySelector('.modal-footer').appendChild(footer);

  overlay.appendChild(modal);

  const close = () => {
    overlay.classList.add('hidden');
    overlay.innerHTML = '';
    if (modalCleanup) { modalCleanup(); modalCleanup = null; }
    if (onClose) onClose();
  };

  modal.querySelector('.modal-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  // Close on Escape
  const keyHandler = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', keyHandler);
  modalCleanup = () => document.removeEventListener('keydown', keyHandler);

  return close; // caller can call close() to dismiss programmatically
}

export function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.add('hidden');
  overlay.innerHTML = '';
  if (modalCleanup) { modalCleanup(); modalCleanup = null; }
}

// ---- Confirm dialog ----
export function confirm(message, opts = {}) {
  return new Promise((resolve) => {
    const body = document.createElement('div');
    body.innerHTML = `<p style="font-size:15px;line-height:1.6">${message}</p>`;

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;width:100%';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-ghost btn-sm';
    cancelBtn.textContent = opts.cancelLabel || 'キャンセル';

    const okBtn = document.createElement('button');
    okBtn.className = 'btn btn-primary btn-sm';
    okBtn.textContent = opts.okLabel || 'OK';
    if (opts.danger) okBtn.className = 'btn btn-danger btn-sm';

    footer.appendChild(cancelBtn);
    footer.appendChild(okBtn);

    const close = openModal({ title: opts.title || '確認', body, footer });

    cancelBtn.onclick = () => { close(); resolve(false); };
    okBtn.onclick = () => { close(); resolve(true); };
  });
}

// ---- Theme management ----

function applyTheme(theme) {
  const html = document.documentElement;
  if (theme === 'dark') html.setAttribute('data-theme', 'dark');
  else if (theme === 'light') html.setAttribute('data-theme', 'light');
  else html.removeAttribute('data-theme'); // 'auto' — follow OS
}

// ---- App init ----

async function init() {
  try { await refreshAiRuntimeStatus({ force: true }); } catch {}

  // Supabase sync: フックを登録して起動時 pull
  try {
    initSync();
    const authResult = await handleAuthRedirect();
    const session = authResult.session || await getSession();
    if (session) {
      pullAll().then(pulled => {
        // Re-render current view with fresh data, but skip if user is actively
        // typing (avoids wiping API key or other form input mid-entry).
        if (!pulled || !currentView) return;
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
        const v = currentView;
        currentView = null;
        navigate(v);
      }).catch(e => console.warn('[Sync] pullAll failed:', e));
    }
  } catch (e) {
    console.warn('[Sync] init failed:', e);
  }

  // Auto-archive: move completed tasks from previous days to archive store
  try { autoArchiveTasks(); } catch {}

  // Apply saved theme
  const settings = getSettings();
  applyTheme(settings.theme || 'auto');

  // Register service worker (relative path works whether served from root or subdirectory)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // Show UI
  document.getElementById('loading-screen').classList.add('hidden');
  document.getElementById('app-header').classList.remove('hidden');
  document.getElementById('bottom-nav').classList.remove('hidden');

  // Wire up bottom nav
  document.querySelectorAll('#bottom-nav .nav-btn').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.view));
  });

  // Wire search button in header
  document.getElementById('header-search-btn')?.addEventListener('click', openSearch);

  // Wire settings gear button in header
  document.getElementById('header-settings-btn')?.addEventListener('click', () => navigate('settings'));

  // Wire focus mode button in header
  document.getElementById('header-focus-btn')?.addEventListener('click', openFocusMode);

  // FAB
  setupFAB();

  // Keyboard shortcuts
  setupKeyboardShortcuts();

  // Focus mode
  setupFocusMode();

  // Start connectivity monitor + batch scheduler
  setupConnectivityMonitor();
  setupBatchScheduler();

  // Route to initial view
  const hash = window.location.hash.replace('#', '').trim() || 'home';
  navigate(MODULES[hash] ? hash : 'home');

  // Handle hash changes (back/forward)
  window.addEventListener('hashchange', () => {
    const h = window.location.hash.replace('#', '').trim() || 'home';
    if (h !== currentView) navigate(MODULES[h] ? h : 'home');
  });

  // フォアグラウンド復帰時に最新データを pull → スケジュール差分を即反映
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    try { autoArchiveTasks(); } catch {}
    getSession().then(session => {
      if (!session) return;
      pullIfStale(30_000).then(pulled => {
        if (pulled && ['home', 'today', 'calendar', 'tasks', 'goals'].includes(currentView)) {
          // currentView に再ナビゲートすることで画面を再描画
          const v = currentView;
          currentView = null; // navigate() の同一ビュー早期リターンを回避
          navigate(v);
        }
      }).catch(() => {});
    }).catch(() => {});
  });
}

// Expose to global (for modules to call — avoids circular imports)
window.AppNav = { navigate, showToast, showUndoToast, openSearch, closeSearch, openModal };
window.AppTheme = { apply: applyTheme };
// Knowledge graph uses this to open memos without circular import
window._knNav = (id) => { openKnowledgeMemo(id); };
// Tag page: open with a pre-selected tag from anywhere in the app
window.AppTags = { open: (tag) => { setTagFilter(tag); navigate('tags'); } };

// ---- Offline / connectivity monitor ----

function setupConnectivityMonitor() {
  const inject = () => {
    // Inject offline indicator if not already there
    if (!document.getElementById('offline-indicator')) {
      const el = document.createElement('div');
      el.id = 'offline-indicator';
      el.className = 'offline-indicator hidden';
      el.innerHTML = `
        <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
          <path d="M24 8.98A16.88 16.88 0 0 0 12 4C7.31 4 3.07 5.9 0 8.98L12 21 24 8.98zM2.92 9.07C5.51 7.08 8.67 6 12 6s6.49 1.08 9.08 3.07L12 18.17 2.92 9.07zm0 0"/>
          <line x1="2" y1="2" x2="22" y2="22" stroke="currentColor" stroke-width="2"/>
        </svg>
        オフライン
      `;
      document.getElementById('app-header')?.appendChild(el);
    }
  };

  const updateStatus = async () => {
    inject();
    const indicator = document.getElementById('offline-indicator');
    const isOnline = navigator.onLine;

    if (indicator) indicator.classList.toggle('hidden', isOnline);

    if (isOnline) {
      try { await refreshAiRuntimeStatus({ force: true }); } catch {}
      // When back online: process AI queue if in immediate mode
      const cfg = getBatchSettings();
      const queue = getPendingAIQueue();
      if (queue.length && cfg.aiMode === 'immediate' && isAiAvailable()) {
        processBatchQueue((done, total) => {
          if (done === total && total > 0) {
            showToast(`オンライン復帰: ${total}件のAI処理を完了しました ✓`, 'success');
          }
        }).catch(e => console.warn('[Batch] auto-process failed:', e));
      }
      // オンライン復帰時に Supabase から最新データを pull
      getSession().then(session => {
        if (session) pullAll().catch(() => {});
      }).catch(() => {});
    }
  };

  window.addEventListener('online',  updateStatus);
  window.addEventListener('offline', updateStatus);
  updateStatus();
}

// ---- Batch AI scheduler ----
// Fires every minute; when wall-clock matches batch time → run once per day

let _batchRanToday = '';

function setupBatchScheduler() {
  setInterval(async () => {
    const cfg = getBatchSettings();
    if (!cfg.batchEnabled || cfg.aiMode !== 'batch') return;

    const queue = getPendingAIQueue();
    if (!queue.length) return;

    if (!isAiAvailable() || !navigator.onLine) return;

    const now   = new Date();
    const todayStr = today();
    if (_batchRanToday === todayStr) return; // already ran

    const [bh, bm] = (cfg.batchTime || '22:00').split(':').map(Number);
    const nowH = now.getHours(), nowM = now.getMinutes();

    // Match within the target minute
    if (nowH !== bh || nowM !== bm) return;

    _batchRanToday = todayStr;
    showToast(`AIバッチ処理を開始します (${queue.length}件)…`, 'info');

    try {
      const result = await processBatchQueue();
      showToast(`バッチ処理完了: ${result.processed}件を処理しました ✓`, 'success');
    } catch (e) {
      showToast('バッチ処理エラー: ' + e.message, 'error');
    }
  }, 60_000); // check every minute
}

// ---- FAB (Floating Action Button) ----

function setupFAB() {
  const fab = document.getElementById('fab');
  if (!fab) return;

  // Show/hide based on view
  const updateFab = () => {
    const hidden = ['home', 'settings', 'ai-settings', 'analytics', 'knowledge-graph', 'knowledge-detail', 'goals'];
    fab.classList.toggle('hidden', hidden.includes(currentView));
    if (currentView === 'tasks') {
      fab.setAttribute('aria-label', 'AIスケジュールを開く');
      fab.title = 'AIスケジュールを開く';
      fab.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M7 2v2H5c-1.1 0-2 .9-2 2v13c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-2V2h-2v2H9V2H7zm12 8H5V8h14v2zm-8 3h2v2h-2v-2zm4 0h2v2h-2v-2zm-8 0h2v2H7v-2z"/></svg>';
    } else {
      fab.setAttribute('aria-label', '追加');
      fab.title = '追加';
      fab.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="26" height="26"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>';
    }
  };

  fab.addEventListener('click', () => {
    switch (currentView) {
      case 'tasks':
        window.dispatchEvent(new CustomEvent('tasks:open-planner'));
        break;
      case 'calendar':
        openCalendarAddFlow();
        break;
      case 'knowledge':
        document.querySelector('#kn-new-btn')?.click();
        break;
      default:
        navigate('tasks');
        setTimeout(() => document.getElementById('task-input')?.focus(), 100);
    }
  });

  // Re-evaluate on every navigation
  const origNavigate = navigate;
  // Patch: re-check FAB after each navigate
  document.addEventListener('appNavigated', updateFab);
  updateFab();
}

// ---- Keyboard shortcuts ----

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    // Ignore when typing in inputs
    const tag = document.activeElement?.tagName;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
    // Ignore when modal is open
    if (!document.getElementById('modal-overlay')?.classList.contains('hidden')) return;
    // Ignore when search is open
    if (!document.getElementById('search-overlay')?.classList.contains('hidden')) return;

    switch (e.key) {
      case '/':
        e.preventDefault();
        openSearch();
        break;
      case 'n':
      case 'N':
        e.preventDefault();
        if (currentView === 'tasks') {
          document.getElementById('task-input')?.focus();
        } else {
          navigate('tasks');
          setTimeout(() => document.getElementById('task-input')?.focus(), 120);
        }
        break;
      case 'f':
      case 'F':
        e.preventDefault();
        openFocusMode();
        break;
      case '?':
        e.preventDefault();
        showShortcutsHelp();
        break;
      case '1': navigate('home');     break;
      case '2': navigate('calendar'); break;
      case '3': navigate('tasks');    break;
      case '4': navigate('knowledge'); break;
      case '5': navigate('analytics'); break;
    }
  });
}

function showShortcutsHelp() {
  const body = document.createElement('div');
  body.innerHTML = `
    <table class="shortcuts-table">
      <tr><td><kbd>/</kbd></td><td>検索を開く</td></tr>
      <tr><td><kbd>N</kbd></td><td>新しいタスクを追加</td></tr>
      <tr><td><kbd>F</kbd></td><td>フォーカスモード</td></tr>
      <tr><td><kbd>1〜5</kbd></td><td>各画面に移動</td></tr>
      <tr><td><kbd>?</kbd></td><td>このヘルプを表示</td></tr>
      <tr><td><kbd>Esc</kbd></td><td>モーダル/検索を閉じる</td></tr>
    </table>
  `;
  openModal({ title: '⌨️ キーボードショートカット', body });
}

// ---- Focus mode ----

let _focusModeEl = null;

function setupFocusMode() {
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _focusModeEl) closeFocusMode();
  });
}

function openFocusMode() {
  if (_focusModeEl) return;
  // Get the top pending task
  let tasks = [];
  try { tasks = JSON.parse(localStorage.getItem('mp_tasks') || '[]'); } catch {}
  const task = tasks
    .filter(t => !t.completed && !t.abandoned)
    .sort((a, b) => {
      const aHasDue = !!a.dueDate;
      const bHasDue = !!b.dueDate;
      if (aHasDue && bHasDue) {
        const aDue = `${a.dueDate}T${a.dueTime || '23:59'}`;
        const bDue = `${b.dueDate}T${b.dueTime || '23:59'}`;
        if (aDue !== bDue) return aDue.localeCompare(bDue);
      } else if (aHasDue !== bHasDue) {
        return aHasDue ? -1 : 1;
      }
      const wo = { large: 0, medium: 1, small: 2 };
      return (wo[a.weight] ?? 1) - (wo[b.weight] ?? 1);
    })[0];

  const overlay = document.createElement('div');
  overlay.className = 'focus-overlay';
  overlay.innerHTML = `
    <div class="focus-overlay-inner">
      <div class="focus-overlay-label">フォーカスモード</div>
      ${task ? `
        <div class="focus-overlay-task">
          <div class="focus-overlay-title">${task.title.replace(/</g, '&lt;')}</div>
          ${task.dueDate ? `<div class="focus-overlay-due">${task.dueDate}</div>` : ''}
          <div class="focus-overlay-weight weight-${task.weight || 'medium'}"></div>
        </div>
        <div class="focus-timer" id="focus-timer">00:00</div>
        <button class="btn btn-primary focus-done-btn" id="focus-finish">End session</button>
      ` : `<div class="focus-overlay-empty">未完了のタスクがありません 🎉</div>`}
      <button class="focus-close" id="focus-close">✕ 閉じる (Esc)</button>
    </div>
  `;

  document.getElementById('app').appendChild(overlay);
  _focusModeEl = overlay;

  // Timer
  if (task) {
    let sec = 0;
    const timerEl = overlay.querySelector('#focus-timer');
    const interval = setInterval(() => {
      if (!overlay.isConnected) { clearInterval(interval); return; }
      sec++;
      const m = String(Math.floor(sec / 60)).padStart(2, '0');
      const s = String(sec % 60).padStart(2, '0');
      timerEl.textContent = `${m}:${s}`;
    }, 1000);
    overlay._timer = interval;

    overlay.querySelector('#focus-finish')?.addEventListener('click', () => {
      clearInterval(interval);
      closeFocusMode();
      showToast(`Focus session ended: ${task.title.slice(0, 20)}`, 'info');
    });
  }

  overlay.querySelector('#focus-close')?.addEventListener('click', closeFocusMode);
}

function closeFocusMode() {
  if (!_focusModeEl) return;
  if (_focusModeEl._timer) clearInterval(_focusModeEl._timer);
  _focusModeEl.classList.add('focus-overlay--closing');
  setTimeout(() => { _focusModeEl?.remove(); _focusModeEl = null; }, 280);
}

// Expose focusMode globally so header button can use it
window.AppFocus = { open: openFocusMode, close: closeFocusMode };

document.addEventListener('DOMContentLoaded', init);
