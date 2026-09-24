// ============================================================
// app.js - Main SPA router and app shell
// ============================================================
// ブラウザが最初に読み込むJavaScriptです。
// URLのハッシュ（#home、#calendarなど）と画面モジュールを結び付け、
// 共通ヘッダー、下部ナビ、モーダル、テーマ、同期の開始を管理します。
// 個別画面の中身は js/modules/ に委ね、このファイルは全体の交通整理をします。

import {
  getSettings, getPendingAIQueue, autoArchiveTasks, isAiAvailable,
  clearUserContentLocal, hasUserContentLocal,
  preserveUserContentSnapshot, restoreUserContentSnapshot,
  DEFAULT_ACCENT_RGB, DEFAULT_THEME_TUNING,
} from './storage.js';
import { processBatchQueue, refreshAiRuntimeStatus } from './ai.js';
import { backfillLocalEvents, initSync, pullAll, pullIfStale, startRealtimeSync, hasPendingSyncWork, flushPendingSync, resetSyncForUserSwitch } from './sync.js';
import { getSession, handleAuthRedirect, getActiveUserId, setActiveUserId, isMigratedForCurrentUser } from './supabase.js';
import { resumeCompletedAIJobs } from './ai-job-resume.js';
import { initAIJobStatus, refreshAIJobStatus } from './ai-job-status.js';
import { migrateToSupabase } from './migrate.js';
import { initHome }     from './modules/home.js';
import { initCalendar, openCalendarAddFlow } from './modules/calendar.js';
import { initSharedCalendar } from './modules/shared-calendar.js';
import { initTasks }    from './modules/tasks.js';
import { initGoals }    from './modules/goals.js';
import { initSettings, initAISettings } from './modules/settings.js';
import {
  isHorizontalNavigationGesture,
  replaceAppRoute,
  shouldRestoreActiveRoute,
} from './navigation-gesture.js';
import { initToday }    from './modules/today.js';
import {
  initKnowledge, initKnowledgeDetail, openKnowledgeMemo, backFromKnowledgeDetail,
  hasUnsavedKnowledgeChanges, confirmDiscardKnowledgeChanges, isKnowledgeEditorOpen,
  openKnowledgeAiOrganizer,
} from './modules/knowledge.js';
import { initReview } from './modules/review.js';
import { initKnowledgeGraph } from './modules/knowledge-graph.js';
import {
  initExpressionAtlas,
  backFromExpressionAtlas,
  shouldPreserveExpressionAtlasView,
} from './modules/expression-atlas.js';
import { initAnalytics } from './modules/analytics.js';
import {
  initLearningLibrary,
  initLearningDetail,
  backFromLearningDetail,
  hasActiveKnowledgeWork,
} from './modules/learning-library.js';
import { openSearch, closeSearch } from './modules/search.js';
import { initArchive } from './modules/archive.js';
import { initTagsPage, setTagFilter } from './modules/tagspage.js';

// ---- Module registry ----
// URLで使う画面名を、表示タイトルと初期化関数へ対応付けます。
// backは戻り先、navRootは下部ナビで選択状態にする親画面です。
const MODULES = {
  home:              { title: 'My planner', init: initHome },
  calendar:          { title: 'Calendar',   init: initCalendar },
  'shared-calendar': { title: '共有カレンダー', init: initSharedCalendar, back: 'calendar' },
  tasks:             { title: 'Tasks',      init: initTasks },
  goals:             { title: 'Goals',      init: initGoals,          back: 'tasks' },
  settings:          { title: 'Settings',   init: initSettings },
  'ai-settings':     { title: 'AI設定', init: initAISettings,      back: 'settings' },
  today:             { title: 'Today',      init: initToday,          back: 'home' },
  memo:              { title: 'Memo',       init: initKnowledge },
  knowledge:         { title: 'Knowledge',  init: initLearningLibrary },
  'learning-detail': { title: 'Knowledge',  init: initLearningDetail, back: 'knowledge', backAction: backFromLearningDetail, navRoot: 'knowledge' },
  'knowledge-detail':{ title: 'Note',       init: initKnowledgeDetail, back: 'memo', backAction: backFromKnowledgeDetail, navRoot: 'memo' },
  'knowledge-graph': { title: 'Memo Map', init: initKnowledgeGraph, back: 'memo', navRoot: 'memo' },
  'expression-atlas':{ title: 'NUANCE ATLAS', init: initExpressionAtlas, back: 'memo', backAction: backFromExpressionAtlas, navRoot: 'memo' },
  analytics:         { title: 'Task Analytics', init: initAnalytics, back: 'tasks', navRoot: 'tasks' },
  review:            { title: '復習セッション', init: initReview, back: 'home' },
  archive:           { title: 'Trash',      init: initArchive,         back: 'tasks', backAction: backFromArchive },
  tags:              { title: 'Tags',       init: initTagsPage },
};

// 画面をまたいで共有する、アプリ外枠の実行状態です。
let currentView = null;
let cleanupFn = null;
let swUpdateIntervalId = null;
let swReloading = false;
let foregroundSyncIntervalId = null;
let editIdleTimer = null;
let lastEditAt = 0;
let isComposingText = false;
let pendingSyncRefresh = false;
let pendingForcedPull = false;
let archiveReturnRoute = null;
// 現在表示している完全なルートを別に保持する。
// 旧版がブラウザー履歴へ積んだ #tasks などが端末の横スワイプで再生されても、
// その古いURLを画面遷移として採用せず、今いる画面へ戻すために使う。
let currentRouteHash = '';

/** ゴミ箱を開く直前の画面へ戻す。戻り先が不明な場合はTasksへ戻す。 */
function backFromArchive() {
  const route = archiveReturnRoute;
  archiveReturnRoute = null;
  if (!route || route.view === 'archive' || !MODULES[route.view]) {
    navigate('tasks');
    return;
  }
  navigate(route.view, { routeHash: route.hash });
}

/** 最後に文字入力・フォーカス操作があった時刻を記録する。 */
function markUserEditing() {
  lastEditAt = Date.now();
}

/** 共通モーダルが現在表示されているかを返す。 */
function hasOpenModal() {
  const overlay = document.getElementById('modal-overlay');
  return !!overlay && !overlay.classList.contains('hidden') && !!overlay.children.length;
}

/** 日付選択オーバーレイが現在表示されているかを返す。 */
function hasOpenDatePicker() {
  const overlay = document.getElementById('dp-picker-overlay');
  return !!overlay && !overlay.classList.contains('hidden') && !!overlay.children.length;
}

/** カレンダーの日別予定シートが開いているかを返す。 */
function hasOpenCalendarSheet() {
  return !!document.querySelector('.cal-day-sheet');
}

/**
 * 要素が文字入力を受け付けるものか判定する。
 * @param {Element|null} el 判定対象
 * @returns {boolean} input、textarea、select、contenteditableならtrue
 */
function isEditableElement(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * 現在の画面に、まだ正式保存されていない入力途中の内容があるか調べる。
 * 同期や自動再描画で入力内容を消さないための防波堤として使います。
 * @returns {boolean} 入力途中の内容があればtrue
 */
function hasUnsavedDraft() {
  if (hasOpenDatePicker()) return true;

  if (currentView === 'tasks') {
    const taskInput = document.getElementById('task-input');
    const recur = document.getElementById('task-recurrence');
    const tagChips = document.getElementById('add-tag-chips');
    if ((taskInput?.value || '').trim()) return true;
    if ((recur?.value || '').trim()) return true;
    if (tagChips?.children?.length) return true;
    if (document.getElementById('task-due-date-btn')?.classList.contains('dp-trigger--set')) return true;
    if (document.getElementById('task-due-time-btn')?.classList.contains('dp-trigger--set')) return true;
    if (document.getElementById('task-estimate-btn')?.classList.contains('dp-trigger--set')) return true;
  }

  if (currentView === 'knowledge-detail' && hasUnsavedKnowledgeChanges()) return true;
  if ((currentView === 'knowledge' || currentView === 'learning-detail') && hasActiveKnowledgeWork()) return true;

  if (currentView === 'calendar' && (hasOpenModal() || hasOpenDatePicker() || hasOpenCalendarSheet())) {
    return true;
  }

  return false;
}

/**
 * ユーザーが現在編集している、または編集直後かをまとめて判定する。
 * 日本語変換中、モーダル入力中、メモ編集画面も編集状態に含めます。
 * @returns {boolean} 自動更新を一時延期すべきならtrue
 */
function isUserEditing() {
  const active = document.activeElement;
  if (isComposingText) return true;
  if (currentView === 'knowledge-detail' && isKnowledgeEditorOpen()) return true;
  if (hasUnsavedDraft()) return true;
  if (isEditableElement(active)) return true;
  if (hasOpenModal() && document.querySelector('#modal-overlay input, #modal-overlay textarea, #modal-overlay select, #modal-overlay [contenteditable="true"]')) {
    return true;
  }
  return (Date.now() - lastEditAt) < 1500;
}

/**
 * 編集中に延期していたクラウド取得・画面更新を、安全になった時点で実行する。
 * 同期処理そのものが残っている間も待ち、古い取得結果で入力を上書きしないようにします。
 */
function flushDeferredSyncWork() {
  if (isUserEditing() || hasPendingSyncWork()) {
    scheduleDeferredSyncWork();
    return;
  }
  const shouldPull = pendingForcedPull;
  const shouldRefresh = pendingSyncRefresh || shouldPull;
  pendingForcedPull = false;
  pendingSyncRefresh = false;
  if (shouldPull) {
    getSession().then(session => {
      if (!session) return;
      pullAll(true).then(async pulled => {
        await startRealtimeSync();
        if (pulled && shouldRefresh) refreshCurrentView({ preserveScroll: true });
      }).catch(() => {});
    }).catch(() => {});
    return;
  }
  if (shouldRefresh) refreshCurrentView({ preserveScroll: true });
}

/** 編集が止まってから延期中の同期処理を再確認するタイマーを設定する。 */
function scheduleDeferredSyncWork() {
  clearTimeout(editIdleTimer);
  editIdleTimer = setTimeout(flushDeferredSyncWork, 1700);
}

/**
 * 同期による再描画を即時実行せず、編集終了後へ回す。
 * @param {object} options
 * @param {boolean} options.needsPull クラウドの再取得も必要ならtrue
 */
function deferSyncWhileEditing({ needsPull = false } = {}) {
  pendingSyncRefresh = true;
  pendingForcedPull = pendingForcedPull || needsPull;
  scheduleDeferredSyncWork();
}

/**
 * アプリ全体の入力・日本語変換・フォーカスを監視し、同期による入力消失を防ぐ。
 * beforeunloadでは未保存メモを閉じる直前にもブラウザの警告を出します。
 */
function setupEditActivityGuard() {
  /** 入力開始を記録し、同期や再描画を編集が落ち着いた後へ延期する。 */
  const markAndDefer = () => {
    markUserEditing();
    scheduleDeferredSyncWork();
  };

  document.addEventListener('focusin', e => {
    if (isEditableElement(e.target)) markAndDefer();
  });

  document.addEventListener('input', e => {
    if (isEditableElement(e.target)) markAndDefer();
  });

  document.addEventListener('compositionstart', e => {
    if (!isEditableElement(e.target)) return;
    isComposingText = true;
    markAndDefer();
  });

  document.addEventListener('compositionend', e => {
    if (!isEditableElement(e.target)) return;
    isComposingText = false;
    markAndDefer();
  });

  document.addEventListener('focusout', e => {
    if (!isEditableElement(e.target)) return;
    markUserEditing();
    scheduleDeferredSyncWork();
  });

  window.addEventListener('beforeunload', e => {
    if (!hasUnsavedKnowledgeChanges()) return;
    e.preventDefault();
    e.returnValue = '';
  });

  document.addEventListener('storage:write-error', () => {
    showToast('保存できませんでした。端末の空き容量を確認してください。元のデータは削除していません。', 'error');
  });
}

// ---- Navigation ----

/**
 * 指定した画面へ移動し、以前の画面を片付けて新しい画面を初期化する。
 * @param {string} view MODULESに登録された画面名
 * @param {object} options
 * @param {boolean} options.preserveScroll 同じ画面の再描画時にスクロール位置を保つ
 * @param {boolean} options.skipUnsavedGuard 未保存確認を呼び出し側で済ませた場合にtrue
 * @param {string} options.routeHash 詳細画面など、URLへ残す完全なハッシュ
 * @returns {boolean|undefined} 移動できた場合true、未保存確認で止めた場合false
 */
export function navigate(view, options = {}) {
  if (!MODULES[view]) view = 'home';
  if (view === currentView) return;
  if (view === 'archive' && currentView && currentView !== 'archive') {
    archiveReturnRoute = {
      view: currentView,
      hash: window.location.hash.replace(/^#/, '') || currentView,
    };
  }
  if (currentView === 'knowledge-detail'
    && !options.skipUnsavedGuard
    && !confirmDiscardKnowledgeChanges()) {
    if (window.location.hash !== `#${currentView}`) {
      window.history.replaceState(null, '', `#${currentView}`);
    }
    return false;
  }
  const preserveScroll = !!options.preserveScroll;

  // Cleanup previous module
  if (cleanupFn) { try { cleanupFn(); } catch {} cleanupFn = null; }

  currentView = view;
  // 画面固有のレスポンシブ調整を、他画面へ漏らさずCSSで指定するための印。
  document.getElementById('app')?.setAttribute('data-view', view);
  const existingRoute = window.location.hash.replace(/^#/, '');
  const routeHash = options.routeHash
    || (existingRoute && getViewFromHash() === view ? existingRoute : view);
  // 下部ナビなどのアプリ内移動をブラウザー履歴へ積むと、iOS/Androidの
  // 画面端スワイプが履歴の「戻る・進む」と解釈され、意図せず別画面へ飛ぶ。
  // アプリには各詳細画面用の戻る処理があるため、URLだけを置換して履歴は増やさない。
  replaceAppRoute(window.history, window.location, routeHash);
  currentRouteHash = routeHash;

  // Update nav active state
  document.querySelectorAll('#bottom-nav .nav-btn').forEach(btn => {
    const active = btn.dataset.view === (MODULES[view].navRoot || view);
    btn.classList.toggle('active', active);
    if (active) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
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
  const shouldRestoreScroll = preserveScroll && main.dataset.view === view;
  const preservedScrollTop = shouldRestoreScroll ? main.scrollTop : 0;
  main.style.scrollBehavior = 'auto';
  if (!preserveScroll) main.scrollTop = 0;
  main.innerHTML = '';
  main.dataset.view = view; // for CSS glow on home
  cleanupFn = MODULES[view].init(main) || null;
  if (shouldRestoreScroll) main.scrollTop = preservedScrollTop;
  else if (!preserveScroll) main.scrollTop = 0;
  requestAnimationFrame(() => {
    if (shouldRestoreScroll) main.scrollTop = preservedScrollTop;
    else if (!preserveScroll) main.scrollTop = 0;
    main.style.scrollBehavior = '';
  });
  document.dispatchEvent(new CustomEvent('appNavigated', { detail: { view } }));
  return true;
}

/**
 * 現在の画面を同じURLのまま作り直し、最新の保存データを表示する。
 * 入力中は再描画せず、編集終了後へ延期します。
 */
export function refreshCurrentView(options = {}) {
  if (!currentView) return;
  if (currentView === 'expression-atlas' && shouldPreserveExpressionAtlasView()) return;
  if (isUserEditing()) {
    deferSyncWhileEditing();
    return;
  }
  const v = currentView;
  currentView = null;
  navigate(v, options);
}

// ---- Toast ----

let toastTimer = null;
/** 数秒で消える短い通知を表示する。 */
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
 * 「元に戻す」ボタン付き通知を5秒間表示する。
 * @param {string} message 表示メッセージ
 * @param {Function} onUndo ボタンが押された時だけ実行する復元処理
 */
export function showUndoToast(message, onUndo) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast toast-info toast--undo';
  const label = document.createElement('span');
  label.textContent = String(message || '');
  const undoButton = document.createElement('button');
  undoButton.className = 'toast-undo-btn';
  undoButton.type = 'button';
  undoButton.textContent = '元に戻す';
  toast.append(label, undoButton);
  container.appendChild(toast);

  const timer = setTimeout(() => toast.remove(), 5000);
  undoButton.addEventListener('click', () => {
    clearTimeout(timer);
    toast.remove();
    onUndo?.();
  });
}

// ---- Modal system ----

let modalCleanup = null;
let modalClose = null;

/**
 * アプリ共通のモーダルを開き、Esc、背景クリック、Tab移動を管理する。
 * @returns {Function} 呼び出し側からモーダルを閉じるための関数
 */
export function openModal({ title, body, footer, onClose, wide = false }) {
  const overlay = document.getElementById('modal-overlay');
  if (modalClose) modalClose();
  const previouslyFocused = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  overlay.innerHTML = '';
  overlay.classList.remove('hidden');

  const modal = document.createElement('div');
  modal.className = 'modal' + (wide ? ' modal-wide' : '');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'app-modal-title');

  modal.innerHTML = `
    <div class="modal-header">
      <span class="modal-title" id="app-modal-title"></span>
      <button class="modal-close" aria-label="Close">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
      </button>
    </div>
    <div class="modal-body"></div>
    ${footer ? '<div class="modal-footer"></div>' : ''}
  `;

  modal.querySelector('.modal-title').textContent = String(title || '');
  modal.querySelector('.modal-body').appendChild(body);
  if (footer) modal.querySelector('.modal-footer').appendChild(footer);

  overlay.appendChild(modal);

  /** 共通モーダルを閉じ、オーバーレイ・キー監視・フォーカス状態を片付ける。 */
  const close = () => {
    if (overlay.classList.contains('hidden')) return;
    overlay.classList.add('hidden');
    overlay.innerHTML = '';
    if (modalCleanup) { modalCleanup(); modalCleanup = null; }
    modalClose = null;
    if (onClose) onClose();
    previouslyFocused?.focus?.({ preventScroll: true });
  };
  modalClose = close;

  modal.querySelector('.modal-close').addEventListener('click', close);
  /** `overlayHandler`: モーダル外側のクリックを受け、許可されていればモーダルを閉じる。 */
  const overlayHandler = e => { if (e.target === overlay) close(); };
  overlay.addEventListener('click', overlayHandler);

  /** `keyHandler`: モーダル表示中のEscapeキーを受け、許可されていれば閉じる。 */
  const keyHandler = e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = [...modal.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    )].filter(el => !el.hidden && el.getClientRects().length);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', keyHandler);
  modalCleanup = () => {
    document.removeEventListener('keydown', keyHandler);
    overlay.removeEventListener('click', overlayHandler);
  };
  requestAnimationFrame(() => {
    modal.querySelector('input, textarea, select, button, [tabindex]:not([tabindex="-1"])')?.focus?.();
  });

  return close; // caller can call close() to dismiss programmatically
}

/** 現在の共通モーダルを閉じ、登録したイベント監視を解除する。 */
export function closeModal() {
  if (modalClose) {
    modalClose();
    return;
  }
  const overlay = document.getElementById('modal-overlay');
  overlay?.classList.add('hidden');
  if (overlay) overlay.innerHTML = '';
  if (modalCleanup) { modalCleanup(); modalCleanup = null; }
}

// ---- Confirm dialog ----
/**
 * 共通モーダルで二択の確認画面を表示する。
 * @returns {Promise<boolean>} OKならtrue、キャンセルならfalse
 */
export function confirm(message, opts = {}) {
  return new Promise((resolve) => {
    const body = document.createElement('div');
    body.innerHTML = `<p style="font-size:15px;line-height:1.6">${message}</p>`;

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;width:100%';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-ghost btn-sm';
    cancelBtn.textContent = opts.cancelLabel || 'Cancel';

    const okBtn = document.createElement('button');
    okBtn.className = 'btn btn-primary btn-sm';
    okBtn.textContent = opts.okLabel || 'OK';
    if (opts.danger) okBtn.className = 'btn btn-danger btn-sm';

    footer.appendChild(cancelBtn);
    footer.appendChild(okBtn);

    const close = openModal({ title: opts.title || 'Confirm', body, footer });

    cancelBtn.onclick = () => { close(); resolve(false); };
    okBtn.onclick = () => { close(); resolve(true); };
  });
}

// ---- Theme management ----

/** 保存済み設定から背景テーマとアクセント色をまとめて適用する。 */
function applyTheme(theme) {
  const html = document.documentElement;
  const settings = getSettings();
  const tuning = settings.themeTuning || DEFAULT_THEME_TUNING;
  const mode = theme === 'light' ? 'light' : 'dark';
  html.setAttribute('data-theme', mode);
  applySurfaceTheme(mode, tuning);
  applyAccentTheme(settings.accentRgb || DEFAULT_ACCENT_RGB, tuning);
}

/** RGBの一要素を0〜255の整数へ収める。 */
function clampRgb(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(255, Math.round(n)));
}

/** 不完全なアクセント色設定を、安全なRGBオブジェクトへ補正する。 */
function normalizeAccentRgb(rgb) {
  return {
    r: clampRgb(rgb?.r, DEFAULT_ACCENT_RGB.r),
    g: clampRgb(rgb?.g, DEFAULT_ACCENT_RGB.g),
    b: clampRgb(rgb?.b, DEFAULT_ACCENT_RGB.b),
  };
}

/** 設定値を0〜100%へ収め、数値でなければ既定値を返す。 */
function clampPercent(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** 背景・コントラスト・鮮やかさの設定を使用可能な範囲へ正規化する。 */
function normalizeThemeTuning(tuning) {
  const fallbackTone = Math.round(((Number(tuning?.blackLevel) || DEFAULT_THEME_TUNING.toneLevel) + (100 - (Number(tuning?.whiteLevel) || 45))) / 2);
  return {
    toneLevel: clampPercent(tuning?.toneLevel, fallbackTone || DEFAULT_THEME_TUNING.toneLevel),
    cardContrast: clampPercent(tuning?.cardContrast, DEFAULT_THEME_TUNING.cardContrast),
    glowIntensity: clampPercent(tuning?.glowIntensity, DEFAULT_THEME_TUNING.glowIntensity),
    accentVividness: clampPercent(tuning?.accentVividness, DEFAULT_THEME_TUNING.accentVividness),
  };
}

/** 二つのRGB色をratioの割合で混ぜ、新しいRGB色を返す。 */
function mixRgb(a, b, ratio) {
  const t = Math.max(0, Math.min(1, ratio));
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

/** RGB色を、色相・彩度・明度で調整しやすいHSL形式へ変換する。 */
function rgbToHsl(rgb) {
  const r = normalizeAccentRgb(rgb).r / 255;
  const g = normalizeAccentRgb(rgb).g / 255;
  const b = normalizeAccentRgb(rgb).b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h;
  let s;
  const l = (max + min) / 2;

  if (max === min) {
    h = 0;
    s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h, s, l };
}

/** HSL形式の色を、CSSで扱いやすいRGBへ戻す。 */
function hslToRgb(h, s, l) {
  let r;
  let g;
  let b;
  if (s === 0) {
    r = g = b = l;
  } else {
    /** `hue2rgb`: HSL色の色相区間をRGB成分へ変換する。 */
    const hue2rgb = (p, q, t) => {
      let tt = t;
      if (tt < 0) tt += 1;
      if (tt > 1) tt -= 1;
      if (tt < 1 / 6) return p + (q - p) * 6 * tt;
      if (tt < 1 / 2) return q;
      if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}

/** RGBオブジェクトをCSSのrgb()/rgba()文字列へ変換する。 */
function rgbToCss(rgb, alpha = 1) {
  const c = normalizeAccentRgb(rgb);
  if (alpha >= 1) return `rgb(${c.r}, ${c.g}, ${c.b})`;
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
}

/** 背景色の明るさに応じて、読みやすい黒または白の文字色を返す。 */
function contrastTextForRgb(rgb) {
  /** `channelLuminance`: RGBの一成分を相対輝度計算用の線形値へ変換する。 */
  const channelLuminance = value => {
    const normalized = value / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  const color = normalizeAccentRgb(rgb);
  const luminance =
    0.2126 * channelLuminance(color.r) +
    0.7152 * channelLuminance(color.g) +
    0.0722 * channelLuminance(color.b);
  const darkLuminance = channelLuminance(13);
  const darkContrast = (luminance + 0.05) / (darkLuminance + 0.05);
  const lightContrast = 1.05 / (luminance + 0.05);
  return darkContrast >= lightContrast ? '#0D0D15' : '#FFFFFF';
}

/**
 * ライト・ダークと調整値から、背景、カード、文字、境界線などのCSS変数を設定する。
 * 設定画面で背景を調整した時に、画面全体が同じ規則で変化する中心処理です。
 */
function applySurfaceTheme(mode, tuningInput) {
  const root = document.documentElement;
  const tuning = normalizeThemeTuning(tuningInput);
  const tone = tuning.toneLevel / 100;
  const contrastStrength = tuning.cardContrast / 100;
  const glowAlpha = 0.04 + (tuning.glowIntensity / 100) * 0.22;
  let bgLight;
  let cardLight;
  let inputLight;
  let textLight;
  let textMutedAlpha;
  let textDimAlpha;
  let hoverAlpha;
  let activeAlpha;
  let borderAlpha;
  let borderLightAlpha;
  let shadowAlpha;
  let scrollbarAlpha;
  let glassAlpha;

  if (mode === 'light') {
    bgLight = 100 - tone * 12;
    cardLight = Math.max(90, Math.min(100, bgLight + 2.2 + contrastStrength * 3.4));
    inputLight = Math.max(84, bgLight - (4.2 + contrastStrength * 3.2));
    textLight = Math.max(14, 19 + tone * 10);
    textMutedAlpha = 0.72 + contrastStrength * 0.14;
    textDimAlpha = 0.62 + contrastStrength * 0.16;
    hoverAlpha = 0.035 + contrastStrength * 0.03;
    activeAlpha = 0.065 + contrastStrength * 0.04;
    borderAlpha = 0.06 + contrastStrength * 0.05;
    borderLightAlpha = 0.035 + contrastStrength * 0.035;
    shadowAlpha = 0.07 + contrastStrength * 0.09;
    scrollbarAlpha = 0.14 + contrastStrength * 0.08;
    glassAlpha = 0.84 + contrastStrength * 0.08;

    root.style.setProperty('--bg', `hsl(240 24% ${bgLight.toFixed(1)}%)`);
    root.style.setProperty('--bg-card', `hsl(0 0% ${cardLight.toFixed(1)}%)`);
    root.style.setProperty('--bg-input', `hsl(242 26% ${inputLight.toFixed(1)}%)`);
    root.style.setProperty('--text', `hsl(250 28% ${textLight.toFixed(1)}%)`);
    root.style.setProperty('--text-muted', `rgba(26, 24, 48, ${textMutedAlpha.toFixed(3)})`);
    root.style.setProperty('--text-dim', `rgba(26, 24, 48, ${textDimAlpha.toFixed(3)})`);
    root.style.setProperty('--bg-hover', `rgba(142, 201, 187, ${hoverAlpha.toFixed(3)})`);
    root.style.setProperty('--bg-active', `rgba(142, 201, 187, ${activeAlpha.toFixed(3)})`);
    root.style.setProperty('--border', `rgba(0, 0, 0, ${borderAlpha.toFixed(3)})`);
    root.style.setProperty('--border-light', `rgba(0, 0, 0, ${borderLightAlpha.toFixed(3)})`);
    root.style.setProperty('--shadow', `0 8px 32px rgba(40, 54, 68, ${shadowAlpha.toFixed(3)})`);
    root.style.setProperty('--shadow-sm', `0 2px 12px rgba(40, 54, 68, ${(shadowAlpha * 0.72).toFixed(3)})`);
    root.style.setProperty('--scrollbar', `rgba(142, 201, 187, ${scrollbarAlpha.toFixed(3)})`);
    root.style.setProperty('--surface-glass', `rgba(242, 241, 253, ${glassAlpha.toFixed(3)})`);
  } else {
    bgLight = 18 - tone * 13.5;
    cardLight = Math.max(8, Math.min(27, bgLight + 5.2 + contrastStrength * 5.2));
    inputLight = Math.max(3, bgLight - (1.2 + contrastStrength * 1.8));
    textLight = Math.min(96, 88 + contrastStrength * 8 - tone * 3);
    textMutedAlpha = 0.56 + contrastStrength * 0.18;
    textDimAlpha = 0.32 + contrastStrength * 0.16;
    hoverAlpha = 0.032 + contrastStrength * 0.03;
    activeAlpha = 0.06 + contrastStrength * 0.04;
    borderAlpha = 0.055 + contrastStrength * 0.045;
    borderLightAlpha = 0.035 + contrastStrength * 0.03;
    shadowAlpha = 0.34 + contrastStrength * 0.20 + tone * 0.10;
    scrollbarAlpha = 0.09 + contrastStrength * 0.08;
    glassAlpha = 0.82 + contrastStrength * 0.10;

    root.style.setProperty('--bg', `hsl(240 24% ${bgLight.toFixed(1)}%)`);
    root.style.setProperty('--bg-card', `hsl(241 28% ${cardLight.toFixed(1)}%)`);
    root.style.setProperty('--bg-input', `hsl(242 26% ${inputLight.toFixed(1)}%)`);
    root.style.setProperty('--text', `hsl(250 32% ${textLight.toFixed(1)}%)`);
    root.style.setProperty('--text-muted', `rgba(237, 236, 249, ${textMutedAlpha.toFixed(3)})`);
    root.style.setProperty('--text-dim', `rgba(237, 236, 249, ${textDimAlpha.toFixed(3)})`);
    root.style.setProperty('--bg-hover', `rgba(255, 255, 255, ${hoverAlpha.toFixed(3)})`);
    root.style.setProperty('--bg-active', `rgba(255, 255, 255, ${activeAlpha.toFixed(3)})`);
    root.style.setProperty('--border', `rgba(255, 255, 255, ${borderAlpha.toFixed(3)})`);
    root.style.setProperty('--border-light', `rgba(255, 255, 255, ${borderLightAlpha.toFixed(3)})`);
    root.style.setProperty('--shadow', `0 8px 32px rgba(0, 0, 0, ${shadowAlpha.toFixed(3)})`);
    root.style.setProperty('--shadow-sm', `0 2px 12px rgba(0, 0, 0, ${(shadowAlpha * 0.72).toFixed(3)})`);
    root.style.setProperty('--scrollbar', `rgba(255, 255, 255, ${scrollbarAlpha.toFixed(3)})`);
    root.style.setProperty('--surface-glass', `rgba(13, 13, 21, ${glassAlpha.toFixed(3)})`);
  }

  root.style.setProperty('--home-glow', `rgba(190,230,216,${glowAlpha.toFixed(3)})`);
}

/**
 * 選択したアクセント色から、ボタン、淡い背景、成功色、グラデーションを派生させる。
 * 白に近い色でもライト背景上で見えなくならないよう明度を補正します。
 */
function applyAccentTheme(rgb, tuningInput) {
  const root = document.documentElement;
  const tuning = normalizeThemeTuning(tuningInput);
  const hsl = rgbToHsl(normalizeAccentRgb(rgb));
  const vividness = tuning.accentVividness / 100;
  const neutralness = Math.max(0, 1 - (hsl.s / 0.28));
  const lightnessLift = 0.16 - vividness * 0.12 - neutralness * 0.12;
  const isDark = root.getAttribute('data-theme') === 'dark';
  // Near-white accents need a darker UI rendering on light surfaces to stay legible.
  const maxBaseLightness = isDark ? 0.8 : 0.8 - neutralness * 0.34;
  const adjustedBase = hslToRgb(
    hsl.h,
    Math.max(0.04, Math.min(0.92, hsl.s * (0.62 + vividness * 0.85))),
    Math.max(0.16, Math.min(maxBaseLightness, hsl.l + lightnessLift)),
  );
  const lighter = mixRgb(adjustedBase, { r: 255, g: 255, b: 255 }, 0.34 - vividness * 0.16 - neutralness * 0.18);
  const lightest = mixRgb(adjustedBase, { r: 255, g: 255, b: 255 }, 0.58 - vividness * 0.18 - neutralness * 0.28);
  const darker = mixRgb(adjustedBase, { r: 20, g: 24, b: 36 }, 0.16 + vividness * 0.07 + neutralness * 0.08);
  const successTarget = neutralness > 0.45 ? { r: 168, g: 176, b: 186 } : { r: 130, g: 220, b: 235 };
  const success = mixRgb(adjustedBase, successTarget, 0.15 + vividness * 0.16 - neutralness * 0.08);

  root.style.setProperty('--primary', rgbToCss(adjustedBase));
  root.style.setProperty('--on-primary', contrastTextForRgb(adjustedBase));
  root.style.setProperty('--primary-dark', rgbToCss(darker));
  root.style.setProperty('--primary-light', rgbToCss(lightest));
  root.style.setProperty('--success', rgbToCss(success));
  root.style.setProperty('--accent', rgbToCss(lighter));
  root.style.setProperty('--gradient', `linear-gradient(135deg, ${rgbToCss(lighter)} 0%, ${rgbToCss(success)} 100%)`);
  root.style.setProperty('--gradient-h', `linear-gradient(90deg, ${rgbToCss(lighter)} 0%, ${rgbToCss(success)} 100%)`);
  root.style.setProperty('--primary-bg', rgbToCss(adjustedBase, 0.12 + vividness * 0.05 - neutralness * 0.04));
  root.style.setProperty('--primary-border', rgbToCss(adjustedBase, 0.18 + vividness * 0.10 - neutralness * 0.05));
  root.style.setProperty('--success-bg', rgbToCss(success, 0.12 - neutralness * 0.03));
  root.style.setProperty('--success-border', rgbToCss(success, 0.22 - neutralness * 0.05));
}

// ---- App init ----

/**
 * アプリ起動時に一度だけ実行する最上位の初期化処理。
 * AI状態、認証、データ保護付きアカウント切替、同期、テーマ、PWA、共通操作を順に開始します。
 */
async function init() {
  try { await refreshAiRuntimeStatus({ force: true }); } catch {}

  // Supabase sync: register hooks and pull on startup.
  try {
    initSync();
    const authResult = await handleAuthRedirect();
    const session = authResult.session || await getSession();
    if (session) {
      const nextUserId = session.user?.id || null;
      const prevUserId = getActiveUserId();
      if (prevUserId && nextUserId && prevUserId !== nextUserId) {
        if (!await preserveUserContentSnapshot(prevUserId)) {
          throw new Error('Account switch stopped because local data could not be backed up');
        }
        setActiveUserId(null);
        await resetSyncForUserSwitch();
        clearUserContentLocal();
        const restored = await restoreUserContentSnapshot(nextUserId);
        if (restored === false) {
          clearUserContentLocal();
          await restoreUserContentSnapshot(prevUserId);
          setActiveUserId(prevUserId);
          throw new Error('Account switch stopped because saved local data could not be restored');
        }
        setActiveUserId(nextUserId);
      } else {
        const restored = nextUserId && !hasUserContentLocal()
          ? await restoreUserContentSnapshot(nextUserId)
          : null;
        if (restored === false) {
          throw new Error('Saved local data could not be restored');
        }
        setActiveUserId(nextUserId);
      }
      if (hasPendingSyncWork()) {
        deferSyncWhileEditing({ needsPull: true });
      } else {
        (async () => {
          const alreadyMigrated = await isMigratedForCurrentUser();
          const eventsBackfilled = await backfillLocalEvents();
          const pulledFirst = await pullAll(alreadyMigrated && eventsBackfilled);
          let pulledAfterMigration = false;
          if (!alreadyMigrated) {
            await migrateToSupabase(() => {});
            pulledAfterMigration = await pullAll(true);
          }
          await startRealtimeSync();
          return pulledFirst || pulledAfterMigration;
        })().then(pulled => {
          if (!pulled || !currentView) return;
          refreshCurrentView();
        }).catch(e => console.warn('[Sync] login sync failed:', e));
      }
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
    setupServiceWorkerAutoUpdate().catch(() => {});
  }

  // Show UI
  document.getElementById('loading-screen').classList.add('hidden');
  document.getElementById('app-header').classList.remove('hidden');
  document.getElementById('bottom-nav').classList.remove('hidden');
  initAIJobStatus();

  // 一部のスマートフォンは横スワイプを、指を離した位置へのclickとして合成する。
  // ナビ以外から始めたスワイプもあるため画面全体を追跡し、その直後のclickだけ止める。
  setupHorizontalSwipeClickGuard();

  // Wire up bottom nav
  document.querySelectorAll('#bottom-nav .nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.remove('nav-btn--tap');
      void btn.offsetWidth;
      btn.classList.add('nav-btn--tap');
      setTimeout(() => btn.classList.remove('nav-btn--tap'), 180);
      navigate(btn.dataset.view);
    });
  });

  // Wire search button in header
  document.getElementById('header-search-btn')?.addEventListener('click', openSearch);

  // Wire settings gear button in header
  document.getElementById('header-settings-btn')?.addEventListener('click', () => navigate('settings'));

  // Wire trash button in header
  document.getElementById('header-trash-btn')?.addEventListener('click', () => navigate('archive'));

  // FAB
  setupFAB();

  // Keyboard shortcuts
  setupKeyboardShortcuts();

  setupEditActivityGuard();

  // Start connectivity monitor and foreground synchronization.
  setupConnectivityMonitor();
  setupForegroundSync();

  // Route to initial view
  const hash = getViewFromHash();
  navigate(MODULES[hash] ? hash : 'home');
  // 初期同期と画面描画を先に済ませ、閉じていた間の完成回答を後から安全に取り込む。
  setTimeout(() => {
    resumeCompletedAIJobs().catch(error => console.warn('[AI jobs] startup resume failed:', error));
  }, 1800);

  // アプリ内の戻る操作は各画面のボタンで管理しており、通常の navigate() は
  // 履歴を増やさない。ここへ来る別ルートへの変更は、主に旧版で残った履歴を
  // 端末の画面端スワイプが再生したものなので、表示中のルートへ戻して無視する。
  // これを画面遷移として扱うと、本文を横に払っただけでTasks等へ飛んでしまう。
  window.addEventListener('hashchange', () => {
    if (!shouldRestoreActiveRoute(currentRouteHash, window.location.hash)) return;
    replaceAppRoute(
      window.history,
      window.location,
      currentRouteHash || currentView || 'home',
    );
  });

  // Pull latest data when returning to foreground so schedule differences appear quickly.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      flushPendingSync().catch(() => {});
      return;
    }
    try { autoArchiveTasks(); } catch {}
    try { navigator.serviceWorker?.getRegistration?.().then(reg => reg?.update?.()).catch(() => {}); } catch {}
    if (isUserEditing() || hasPendingSyncWork()) {
      deferSyncWhileEditing({ needsPull: true });
      return;
    }
    getSession().then(session => {
      if (!session) return;
      resumeCompletedAIJobs().catch(error => console.warn('[AI jobs] foreground resume failed:', error));
      pullIfStale(30_000, true).then(pulled => {
        if (pulled) refreshCurrentView({ preserveScroll: true });
      }).catch(() => {});
    }).catch(() => {});
  });

  window.addEventListener('pagehide', () => {
    flushPendingSync().catch(() => {});
  });

  document.addEventListener('sync:updated', () => {
    if (isUserEditing() || hasPendingSyncWork()) {
      deferSyncWhileEditing();
      return;
    }
    refreshCurrentView({ preserveScroll: true });
  });

  document.addEventListener('sync:remote-change', () => {
    if (isUserEditing() || hasPendingSyncWork()) {
      deferSyncWhileEditing({ needsPull: true });
      return;
    }
    getSession().then(session => {
      if (!session) return;
      pullIfStale(1_000, true).then(pulled => {
        if (pulled) refreshCurrentView({ preserveScroll: true });
      }).catch(() => {});
    }).catch(() => {});
  });

  // AI画面を離れた後にジョブが完成した場合も、現在画面を壊さず保存だけ取り込む。
  document.addEventListener('ai:job-ready', () => {
    refreshAIJobStatus().catch(() => {});
    resumeCompletedAIJobs().catch(error => console.warn('[AI jobs] completion resume failed:', error));
  });
}

/**
 * 画面全体のタッチを追跡し、横スワイプ直後にブラウザーが合成するclickを一度だけ無効にする。
 * タッチ開始地点を下部ナビに限定すると、本文からナビ上へ指を動かした場合を
 * 見逃す端末がある。縦スクロール、小さな指ぶれ、通常タップは通す。
 */
function setupHorizontalSwipeClickGuard() {
  if (document.documentElement.dataset.gestureGuard === 'true') return;
  document.documentElement.dataset.gestureGuard = 'true';

  let gesture = null;
  let suppressClickUntil = 0;

  document.addEventListener('touchstart', event => {
    if (event.touches.length !== 1) {
      gesture = null;
      return;
    }
    const touch = event.touches[0];
    gesture = { startX: touch.clientX, startY: touch.clientY };
  }, { passive: true, capture: true });

  document.addEventListener('touchend', event => {
    const touch = event.changedTouches?.[0];
    if (gesture && touch && isHorizontalNavigationGesture(
      gesture.startX,
      gesture.startY,
      touch.clientX,
      touch.clientY,
    )) {
      suppressClickUntil = Date.now() + 600;
    }
    gesture = null;
  }, { passive: true, capture: true });

  document.addEventListener('touchcancel', () => {
    gesture = null;
  }, { passive: true, capture: true });

  document.addEventListener('click', event => {
    if (Date.now() > suppressClickUntil) return;
    // 合成clickは一度だけ発生するため、止めた時点で解除する。
    // 直後にユーザーが意図して行う通常タップまで塞がないための処理です。
    suppressClickUntil = 0;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, { capture: true });
}

/** URLの`#calendar`のような部分から、画面名だけを取り出す。 */
function getViewFromHash() {
  return window.location.hash.replace(/^#/, '').split('?')[0].trim() || 'home';
}

/**
 * Service Workerを登録し、新版を検出したら編集・同期が安全な時だけ再読み込みする。
 * 更新のために編集中の文章を失わないことが重要です。
 */
async function setupServiceWorkerAutoUpdate() {
  const registration = await navigator.serviceWorker.register('./sw.js');
  /** 待機中のService Workerへ新版への切替要求を送る。 */
  const markWaitingWorker = (worker) => {
    if (!worker) return;
    worker.postMessage({ type: 'SKIP_WAITING' });
  };

  if (registration.waiting) markWaitingWorker(registration.waiting);

  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    if (!installing) return;
    installing.addEventListener('statechange', () => {
      if (installing.state === 'installed' && navigator.serviceWorker.controller) {
        markWaitingWorker(registration.waiting || installing);
      }
    });
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (swReloading) return;
    swReloading = true;
    showToast('Updated to the latest version.', 'success');
    /** `reloadWhenSafe`: 編集中やAI生成中でない時点を待ち、更新済みアプリを再読み込みする。 */
    const reloadWhenSafe = () => {
      if (isUserEditing() || hasPendingSyncWork()) {
        setTimeout(reloadWhenSafe, 1000);
        return;
      }
      window.location.reload();
    };
    setTimeout(reloadWhenSafe, 300);
  });

  try { await registration.update(); } catch {}

  if (swUpdateIntervalId) clearInterval(swUpdateIntervalId);
  swUpdateIntervalId = setInterval(() => {
    registration.update().catch(() => {});
  }, 60 * 1000);
}

// Expose to global for modules without introducing circular imports.
window.AppNav = { navigate, refreshCurrentView, showToast, showUndoToast, openSearch, closeSearch, openModal };
window.AppTheme = { apply: applyTheme };
// Knowledge graph uses this to open memos without circular import
window._knNav = (id) => { openKnowledgeMemo(id); };
// Tag page: open with a pre-selected tag from anywhere in the app
window.AppTags = { open: (tag) => { setTagFilter(tag); navigate('tags'); } };

// ---- Offline / connectivity monitor ----

/**
 * オンライン・オフライン切替を監視する。
 * 復帰時はAI待機キューを処理し、Supabaseの最新データも取得します。
 */
function setupConnectivityMonitor() {
  /** `inject`: 現在のページへ必要なスタイルまたは補助要素を一度だけ挿入する。 */
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

  /** オンライン表示を更新し、復帰時はAI状態確認・待機キュー処理・同期を再開する。 */
  const updateStatus = async () => {
    inject();
    const indicator = document.getElementById('offline-indicator');
    const isOnline = navigator.onLine;

    if (indicator) indicator.classList.toggle('hidden', isOnline);

    if (isOnline) {
      try { await refreshAiRuntimeStatus({ force: true }); } catch {}
      // When back online: process AI queue if in immediate mode
      const queue = getPendingAIQueue();
      if (queue.length && isAiAvailable()) {
        processBatchQueue((done, total) => {
          if (done === total && total > 0) {
            showToast(`Online again: completed ${total} AI jobs.`, 'success');
          }
        }).catch(e => console.warn('[Batch] auto-process failed:', e));
      }
      // Pull latest data from Supabase when coming back online.
      if (isUserEditing() || hasPendingSyncWork()) {
        deferSyncWhileEditing({ needsPull: true });
        return;
      }
      getSession().then(session => {
        if (session) pullAll(true).catch(() => {});
      }).catch(() => {});
    }
  };

  window.addEventListener('online',  updateStatus);
  window.addEventListener('offline', updateStatus);
  updateStatus();
}

/**
 * アプリを開いている間、一定間隔でクラウド変更を確認する。
 * 入力中や送信待ちがある場合は取得と再描画を延期します。
 */
function setupForegroundSync() {
  if (foregroundSyncIntervalId) clearInterval(foregroundSyncIntervalId);
  foregroundSyncIntervalId = setInterval(() => {
    if (document.hidden) return;
    if (isUserEditing() || hasPendingSyncWork()) {
      deferSyncWhileEditing({ needsPull: true });
      return;
    }
    getSession().then(session => {
      if (!session) return;
      pullIfStale(3000, true).then(pulled => {
        if (pulled) refreshCurrentView({ preserveScroll: true });
      }).catch(() => {});
    }).catch(() => {});
  }, 3000);
}

// ---- FAB (Floating Action Button) ----

/**
 * 右下のFloating Action Buttonを、現在の画面に合う役割とアイコンへ切り替える。
 * TasksではAI分配、Calendarでは予定追加、MemoではAI整理を開きます。
 */
function setupFAB() {
  const fab = document.getElementById('fab');
  if (!fab) return;

  // Show/hide based on view
  const updateFab = () => {
    const hidden = ['home', 'settings', 'ai-settings', 'analytics', 'knowledge', 'learning-detail', 'knowledge-graph', 'knowledge-detail', 'expression-atlas', 'goals', 'review', 'archive'];
    fab.classList.toggle('hidden', hidden.includes(currentView));
    if (currentView === 'tasks') {
      fab.setAttribute('aria-label', 'Open AI planner');
      fab.title = 'Open AI planner';
      fab.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M7 2v2H5c-1.1 0-2 .9-2 2v13c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-2V2h-2v2H9V2H7zm12 8H5V8h14v2zm-8 3h2v2h-2v-2zm4 0h2v2h-2v-2zm-8 0h2v2H7v-2z"/></svg>';
    } else if (currentView === 'memo') {
      fab.setAttribute('aria-label', 'AI整理');
      fab.title = 'AI整理';
      fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="25" height="25" aria-hidden="true"><path d="m12 3 1.15 3.35L16.5 7.5l-3.35 1.15L12 12l-1.15-3.35L7.5 7.5l3.35-1.15L12 3Z"/><path d="m18.5 12 1 2.5L22 15.5l-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1 1-2.5Z"/><path d="M4 14v6h8"/></svg>';
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
      case 'memo':
        openKnowledgeAiOrganizer();
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

/** キーボードイベントの発生元が文字入力中の要素か判定する。 */
function isEditingText(target) {
  const el = target instanceof Element ? target : document.activeElement;
  if (!el) return false;
  return !!el.closest?.('input, textarea, select, [contenteditable="true"]');
}

/**
 * 検索や画面移動のグローバルショートカットを登録する。
 * メモや入力欄へ文字を打っている間は、数字キーを含む全ショートカットを無効にします。
 */
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    // Ignore all global shortcuts while typing/editing text, including memo blocks.
    if (isEditingText(e.target) || isEditingText(document.activeElement)) return;
    // Leave browser/system shortcuts alone.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // Ignore when modal is open
    if (!document.getElementById('modal-overlay')?.classList.contains('hidden')) return;
    // Ignore when search is open
    if (!document.getElementById('search-overlay')?.classList.contains('hidden')) return;
    if (hasOpenDatePicker()) return;

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
      case '?':
        e.preventDefault();
        showShortcutsHelp();
        break;
      case '1': e.preventDefault(); navigate('home');      break;
      case '2': e.preventDefault(); navigate('calendar');  break;
      case '3': e.preventDefault(); navigate('tasks');     break;
      case '4': e.preventDefault(); navigate('memo');      break;
      case '5': e.preventDefault(); navigate('knowledge'); break;
    }
  });
}

/** 利用可能なキーボードショートカットを共通モーダルへ表示する。 */
function showShortcutsHelp() {
  const body = document.createElement('div');
  body.innerHTML = `
    <table class="shortcuts-table">
      <tr><td><kbd>/</kbd></td><td>Open search</td></tr>
      <tr><td><kbd>N</kbd></td><td>Add a new task</td></tr>
      <tr><td><kbd>1-5</kbd></td><td>Move between views</td></tr>
      <tr><td><kbd>?</kbd></td><td>Show this help</td></tr>
      <tr><td><kbd>Esc</kbd></td><td>Close modal or search</td></tr>
    </table>
  `;
  openModal({ title: 'Keyboard shortcuts', body });
}

document.addEventListener('DOMContentLoaded', init);


