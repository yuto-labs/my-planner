// ============================================================
// app.js - Main SPA router and app shell
// ============================================================
// ブラウザが最初に読み込むJavaScriptです。
// URLのハッシュ（#home、#calendarなど）と画面モジュールを結び付け、
// 共通ヘッダー、下部ナビ、モーダル、テーマ、同期の開始を管理します。
// 個別画面の中身は js/modules/ に委ね、このファイルは全体の交通整理をします。

import {
  getSettings, getPendingAIQueue, autoArchiveTasks, purgeExpiredTrashPayloads, isAiAvailable,
  getEvents, getTasks, applySharedSettingsFromSync, ensureSharedSettings, extendRecurringSeries,
  clearUserContentLocal, hasUserContentLocal,
  preserveUserContentSnapshot, restoreUserContentSnapshot, saveSettings,
} from './storage.js';
import { processBatchQueue, refreshAiRuntimeStatus } from './ai.js';
import { backfillLocalEvents, initSync, pullAll, pullIfStale, pullIfRemoteChanged, startRealtimeSync, hasPendingSyncWork, flushPendingSync, resetSyncForUserSwitch } from './sync.js';
import { getSession, handleAuthRedirect, getActiveUserId, setActiveUserId, isMigratedForCurrentUser, getStoredSessionUserId } from './supabase.js';
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
} from './modules/memo.js';
import { openSpaceAI } from './modules/space-ai.js';
import { initReview } from './modules/review.js';
import { initKnowledgeGraph } from './modules/memo-graph.js';
import { initExpressionAtlasLazily, loadedAtlasModule } from './atlas-loader.js';
import { initAnalytics } from './modules/analytics.js';
import {
  initLearningLibrary,
  initLearningDetail,
  backFromLearningDetail,
  hasActiveKnowledgeWork,
} from './modules/learning-library.js';
import { openSearch, closeSearch } from './modules/search.js';
import { initArchive } from './modules/archive.js';
import { initTagsPage, setTagFilter } from './modules/tags.js';
import { captureHorizontalTableScroll, restoreHorizontalTableScroll } from './horizontal-scroll-state.js';
import { flushLocalStore, initLocalStore, requestPersistentStorage } from './local-store.js';
import { startReminders } from './reminders.js';
import { initDesktopWorkspace, refreshDesktopWorkspace } from './desktop-workspace.js';

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
  // 表現帳はKnowledge(下のタブ)の中から開く。大きいので、初めて開いた時に読み込む(atlas-loader.js)。
  'expression-atlas':{ title: 'NUANCE ATLAS', init: initExpressionAtlasLazily, back: 'knowledge',
    backAction: () => { const atlas = loadedAtlasModule(); if (atlas) atlas.backFromExpressionAtlas(); else navigate('knowledge'); },
    navRoot: 'knowledge' },
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
let pendingChangeCheck = false;
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
  const shouldCheckChanges = pendingChangeCheck && !shouldPull;
  const shouldRefresh = pendingSyncRefresh || shouldPull;
  pendingForcedPull = false;
  pendingChangeCheck = false;
  pendingSyncRefresh = false;
  if (shouldPull || shouldCheckChanges) {
    getSession().then(session => {
      if (!session) return;
      // 定期確認が延期されただけなら軽い変化検出で済ませ、編集のたびの全件取得を避ける。
      const pull = shouldPull ? pullAll(true) : pullIfRemoteChanged();
      pull.then(async pulled => {
        await startRealtimeSync();
        if (pulled) refreshCurrentView({ preserveScroll: true });
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
function deferSyncWhileEditing({ needsPull = false, needsChangeCheck = false } = {}) {
  if (!needsChangeCheck || needsPull) pendingSyncRefresh = true;
  pendingForcedPull = pendingForcedPull || needsPull;
  pendingChangeCheck = pendingChangeCheck || needsChangeCheck;
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

  document.addEventListener('storage:write-error', event => {
    const message = event.detail?.reason === 'quota'
      ? 'ブラウザー内の保存領域が不足しています。元のデータは残しています。'
      : '端末への保存に失敗しました。入力内容は消さず、ブラウザーの保存設定を確認してください。';
    showToast(message, 'error');
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
  // PCでは、戻る先のある画面(設定・詳細など)だけ上の帯を出す。主な画面では帯を消して広く使う(CSS側で判定)。
  document.body.classList.toggle('has-back', !!MODULES[view].back);
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
  const preservedTables = shouldRestoreScroll ? captureHorizontalTableScroll(main) : [];
  main.style.scrollBehavior = 'auto';
  if (!preserveScroll) main.scrollTop = 0;
  main.innerHTML = '';
  main.dataset.view = view; // for CSS glow on home
  cleanupFn = MODULES[view].init(main) || null;
  refreshDesktopWorkspace(view, { force: true });
  restoreHorizontalTableScroll(main, preservedTables);
  if (shouldRestoreScroll) main.scrollTop = preservedScrollTop;
  else if (!preserveScroll) main.scrollTop = 0;
  requestAnimationFrame(() => {
    if (shouldRestoreScroll) main.scrollTop = preservedScrollTop;
    else if (!preserveScroll) main.scrollTop = 0;
    restoreHorizontalTableScroll(main, preservedTables);
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
  // 同期の取得後に呼ばれるので、別の端末で変えた外観・カテゴリが届いていればここで反映する。
  if (applySharedSettingsFromSync()) applyTheme(getSettings().theme);
  if (!currentView) return;
  if (currentView === 'expression-atlas' && loadedAtlasModule()?.shouldPreserveExpressionAtlasView()) {
    refreshDesktopWorkspace(currentView, { force: true });
    return;
  }
  if (isUserEditing()) {
    deferSyncWhileEditing();
    return;
  }
  const v = currentView;
  currentView = null;
  navigate(v, options);
}

// ---- Toast ----

/** 数秒で消える短い通知を表示する。 */
export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const normalizedMessage = String(message || '');
  // 同じ失敗を複数の非同期経路が同時に報告しても、通知を積み重ねない。
  const duplicate = [...container.querySelectorAll('.toast')].some(item => (
    item.dataset.message === normalizedMessage && item.dataset.type === type
  ));
  if (duplicate) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.dataset.message = normalizedMessage;
  toast.dataset.type = type;
  toast.textContent = normalizedMessage;
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
export function openModal({ title, body, footer, onClose, wide = false, autoFocus = true }) {
  const modal = document.createElement('div');
  modal.className = 'modal' + (wide ? ' modal-wide' : '');
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
  return mountModal(modal, { onClose, autoFocus });
}

/**
 * 画面ごとに組み立てたモーダル要素を、共通の背景(#modal-overlay)へ表示する。
 * 閉じる操作(×ボタン・背景タップ・Esc)、Tabの循環、閉じた後のフォーカス復帰と、
 * 登録したイベントの後片付けをここ一か所で行う。以前は画面ごとに同じ処理を持ち、
 * 背景へのクリック監視が開くたびに増え続けていた。
 * autoFocus=false は、開いた瞬間にスマホのキーボードが出ないようにしたい画面用。
 * @returns {Function} 呼び出し側からモーダルを閉じるための関数
 */
export function mountModal(modal, { onClose, autoFocus = true } = {}) {
  const overlay = document.getElementById('modal-overlay');
  if (modalClose) modalClose();
  const previouslyFocused = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  overlay.innerHTML = '';
  overlay.classList.remove('hidden');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
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

  modal.querySelector('.modal-close')?.addEventListener('click', close);
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
  if (autoFocus) {
    requestAnimationFrame(() => {
      modal.querySelector('input, textarea, select, button, [tabindex]:not([tabindex="-1"])')?.focus?.();
    });
  }

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
 * 「削除しますか？」のような二択の確認を、画面の真ん中の小さな窓で出す。
 * ブラウザの window.confirm は画面の上の方に出て、見た目もアプリと揃わないため、こちらを使う。
 * 共通モーダルとは別の重ね板に出すので、編集画面(モーダル)の上に重ねても下の画面は閉じない。
 * 背景を押す・Escは「やめる」と同じ扱い。message は文字としてそのまま表示する(HTMLとしては読まない)。
 * @returns {Promise<boolean>} 実行するならtrue、やめるならfalse
 */
export function confirm(message, opts = {}) {
  return new Promise(resolve => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-dialog" role="alertdialog" aria-modal="true">
        <p class="confirm-message"></p>
        <div class="confirm-actions">
          <button class="btn btn-ghost btn-sm" type="button" data-answer="no"></button>
          <button class="btn btn-sm ${opts.danger ? 'btn-danger' : 'btn-primary'}" type="button" data-answer="yes"></button>
        </div>
      </div>`;
    overlay.querySelector('.confirm-message').textContent = String(message || '');
    overlay.querySelector('[data-answer="no"]').textContent = opts.cancelLabel || 'やめる';
    overlay.querySelector('[data-answer="yes"]').textContent = opts.okLabel || 'OK';

    /** 答えを返して窓を消す。 */
    const finish = answer => {
      window.removeEventListener('keydown', onKey, true);
      overlay.remove();
      previouslyFocused?.focus?.({ preventScroll: true });
      resolve(answer);
    };
    /** Escで「やめる」。下の編集画面のEsc(閉じる)まで届かないよう、ここで止める。 */
    const onKey = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      finish(false);
    };
    overlay.addEventListener('click', event => {
      const button = event.target.closest('[data-answer]');
      if (button) finish(button.dataset.answer === 'yes');
      else if (event.target === overlay) finish(false);
    });
    window.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
    // 誤って消さないよう、最初は「やめる」にフォーカスを置く(Enterだけでは削除されない)。
    overlay.querySelector('[data-answer="no"]').focus();
  });
}

/**
 * 名前などを1つ入力してもらう、画面の真ん中の小さな窓(confirm と同じ見た目)。
 * Enterで決定、Esc・背景・「やめる」で取り消し。空のまま決定した時も取り消し扱い。
 * @returns {Promise<string|null>} 入力した文字(前後の空白は除く)。取り消しならnull
 */
export function prompt(message, opts = {}) {
  return new Promise(resolve => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <form class="confirm-dialog" role="dialog" aria-modal="true">
        <label class="confirm-message" for="app-prompt-input"></label>
        <input class="input confirm-input" id="app-prompt-input" autocomplete="off">
        <div class="confirm-actions">
          <button class="btn btn-ghost btn-sm" type="button" data-answer="no">やめる</button>
          <button class="btn btn-primary btn-sm" type="submit"></button>
        </div>
      </form>`;
    const input = overlay.querySelector('input');
    overlay.querySelector('.confirm-message').textContent = String(message || '');
    overlay.querySelector('[type="submit"]').textContent = opts.okLabel || '決定';
    input.value = opts.value || '';
    input.placeholder = opts.placeholder || '';

    /** 答えを返して窓を消す。 */
    const finish = answer => {
      window.removeEventListener('keydown', onKey, true);
      overlay.remove();
      previouslyFocused?.focus?.({ preventScroll: true });
      resolve(answer);
    };
    /** Escで取り消し。下の画面のEscまで届かないよう、ここで止める。 */
    const onKey = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      finish(null);
    };
    overlay.querySelector('form').addEventListener('submit', event => {
      event.preventDefault();
      finish(input.value.trim() || null);
    });
    overlay.addEventListener('click', event => {
      if (event.target.closest('[data-answer="no"]') || event.target === overlay) finish(null);
    });
    window.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
    input.focus();
    input.select();
  });
}

// ---- Theme management ----

// スマホのステータスバーなど、アプリの外枠の色。上下の帯と同じ色にそろえる。
const THEME_BAND_COLORS = { light: '#F7F7F5', dark: '#191919' };

/** 保存値を 'light'(ホワイト)か 'dark'(ブラック)にそろえる。以前の「自動」は端末の設定で決める。 */
function resolveThemeMode(theme) {
  if (theme === 'light' || theme === 'dark') return theme;
  return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light';
}

/**
 * テーマ(ブラック/ホワイト)を適用する。色はすべて style.css の [data-theme] に決めてあるので、
 * ここでは html に data-theme を付けて、外枠の色を合わせるだけ。
 */
function applyTheme(theme) {
  const mode = resolveThemeMode(theme);
  document.documentElement.setAttribute('data-theme', mode);
  document.querySelectorAll('meta[name="theme-color"]').forEach(meta => meta.setAttribute('content', THEME_BAND_COLORS[mode]));
}

// ---- App init ----

/**
 * アプリ起動時に一度だけ実行する最上位の初期化処理。
 * AI状態、認証、データ保護付きアカウント切替、同期、テーマ、PWA、共通操作を順に開始します。
 */
async function init() {
  // 大きい端末データをIndexedDBから読み込む。同期や画面がデータを読む前に必ず済ませる。
  // 失敗した場合は何も消さず、従来どおりlocalStorageで動く。
  try { await initLocalStore(); } catch (error) { console.warn('[LocalStore] init failed:', error); }
  requestPersistentStorage();
  // AIの状態確認は通信が必要なので待たない。前回の結果で画面を出し、使える/使えないが
  // 変わった時だけ表示を合わせる(毎回描き直すと起動直後に画面がちらつく)。
  const aiWasAvailable = isAiAvailable();
  refreshAiRuntimeStatus({ force: true })
    .then(() => {
      if (isAiAvailable() !== aiWasAvailable && currentView && !isUserEditing()) refreshCurrentView({ preserveScroll: true });
    })
    .catch(() => {});

  // 前回と同じ人のログイン情報が端末にあり、ログイン用リンクから戻ったのでもなければ、
  // アカウントの入れ替えは起きない。その場合はログイン確認(期限切れなら通信で更新)を待たずに
  // 画面を出し、確認と同期は裏で進める。入れ替えが起こりうる時だけ、データ保護のため待つ。
  const url = new URL(window.location.href);
  const returningFromAuthLink = url.searchParams.has('code') || url.searchParams.get('auth') === 'callback'
    || /access_token=|refresh_token=/.test(window.location.hash);
  const storedUserId = getStoredSessionUserId();
  const sameUserAsBefore = !!storedUserId && storedUserId === getActiveUserId() && !returningFromAuthLink;

  // Supabase sync: register hooks and pull on startup.
  const sessionWork = (async () => { try {
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
          // ログイン後の取得が終わってから、まだ誰も作っていなければ外観設定の写しを作る。
          // 取得前に作ると、空の新しい端末の既定値で他の端末の設定を上書きしてしまう。
          if (applySharedSettingsFromSync()) applyTheme(getSettings().theme);
          else ensureSharedSettings();
          // 繰り返し予定の先の分を作り足すのは、他の端末での削除を取り込んだ後にする。
          if (extendRecurringSeries() > 0) pulled = true;
          if (!pulled || !currentView) return;
          refreshCurrentView();
        }).catch(e => console.warn('[Sync] login sync failed:', e));
      }
    }
  } catch (e) {
    console.warn('[Sync] init failed:', e);
  } })();
  if (!sameUserAsBefore) await sessionWork;
  // ログインしていない(同期しない)端末では、取り込みを待たずに繰り返し予定を作り足す。
  if (!getActiveUserId()) {
    try { extendRecurringSeries(); } catch (error) { console.warn('[Recurrence] extend failed:', error); }
  }

  // Auto-archive: move completed tasks from previous days to archive store
  try { autoArchiveTasks(); } catch {}
  // 保持期限を過ぎたごみ箱の中身を捨てる。同期用の削除記録は残る。
  try { purgeExpiredTrashPayloads(); } catch {}

  // 保存したテーマを適用する。以前の「自動」は、今の端末の設定でブラック/ホワイトに決めて保存し直す。
  const settings = getSettings();
  if (settings.theme !== 'light' && settings.theme !== 'dark') saveSettings({ theme: resolveThemeMode(settings.theme) });
  applyTheme(getSettings().theme);

  // Register service worker (relative path works whether served from root or subdirectory)
  if ('serviceWorker' in navigator) {
    setupServiceWorkerAutoUpdate().catch(() => {});
  }

  // Show UI
  document.getElementById('loading-screen').classList.add('hidden');
  document.getElementById('app-header').classList.remove('hidden');
  document.getElementById('bottom-nav').classList.remove('hidden');
  initDesktopWorkspace();
  initAIJobStatus();
  // リマインダー(既定オフ)。設定でオンにして通知を許可した端末だけ実際に通知する。
  startReminders(() => ({ events: getEvents(), tasks: getTasks(), settings: getSettings().reminders }));

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

  // 検索・設定・ごみ箱。スマホは上の帯のボタン、PCは左の帯の下の小さなボタン(どちらも同じ動き)。
  ['header-search-btn', 'nav-search-btn'].forEach(id => document.getElementById(id)?.addEventListener('click', openSearch));
  ['header-settings-btn', 'nav-settings-btn'].forEach(id => document.getElementById(id)?.addEventListener('click', () => navigate('settings')));
  ['header-trash-btn', 'nav-trash-btn'].forEach(id => document.getElementById(id)?.addEventListener('click', () => navigate('archive')));

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
      // アプリが裏に回った後にOSが終了させても、端末保存の書き込み待ちを残さない。
      flushLocalStore().catch(() => {});
      flushPendingSync().catch(() => {});
      return;
    }
    try { autoArchiveTasks(); } catch {}
    try { purgeExpiredTrashPayloads(); } catch {}
    try { navigator.serviceWorker?.getRegistration?.().then(reg => reg?.update?.()).catch(() => {}); } catch {}
    getSession().then(session => {
      if (!session) {
        // 同期しない端末でも、日をまたいで開いた時に繰り返し予定の先の分を作り足す。
        if (extendRecurringSeries() > 0) refreshCurrentView({ preserveScroll: true });
        return;
      }
      // Editing and pending writes may defer a cloud pull, but must never
      // prevent finished AI jobs from being imported after app suspension.
      resumeCompletedAIJobs().catch(error => console.warn('[AI jobs] foreground resume failed:', error));
      if (isUserEditing() || hasPendingSyncWork()) {
        deferSyncWhileEditing({ needsPull: true });
        return;
      }
      pullIfStale(30_000, true).then(pulled => {
        // 取り込みの後で、繰り返し予定の先の分が足りなければ作り足す。
        if (extendRecurringSeries() > 0) pulled = true;
        if (pulled) refreshCurrentView({ preserveScroll: true });
      }).catch(() => {});
    }).catch(() => {});
  });

  window.addEventListener('pagehide', () => {
    flushLocalStore().catch(() => {});
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
      // 通知が来ても全種類は取り直さず、変化検出で「変わった種類だけ」を取得する。
      pullIfRemoteChanged().then(pulled => {
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
  // updateViaCache:noneにより、iOSのホーム画面アプリでもService Worker本体を
  // HTTPキャッシュから読まず、本番の最新版を毎回確認できるようにする。
  const registration = await navigator.serviceWorker.register('./sw.js?v=362', {
    updateViaCache: 'none',
  });
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
      // 端末保存の書き込みが終わってから再読み込みする。
      flushLocalStore().catch(() => {}).finally(() => window.location.reload());
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
window.AppNav = {
  navigate, refreshCurrentView, showToast, showUndoToast, openSearch, closeSearch, openModal, mountModal, closeModal, confirm, prompt,
  refreshDesktopContext: options => refreshDesktopWorkspace(currentView, options),
};
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

// 他端末の変更を確認する間隔。毎回の全件取得ではなく件数と更新時刻だけを読み、
// 変化した種類だけを取得するので、以前の3秒間隔に戻しても通信量は以前よりずっと少ない。
const FOREGROUND_CHANGE_CHECK_MS = 3_000;
let foregroundCheckInFlight = false;

/**
 * アプリを開いている間、一定間隔でクラウド変更を確認する。
 * 変化があった時だけ全件取得し、入力中や送信待ちがある場合は取得と再描画を延期します。
 */
function setupForegroundSync() {
  if (foregroundSyncIntervalId) clearInterval(foregroundSyncIntervalId);
  foregroundSyncIntervalId = setInterval(() => {
    if (document.hidden || foregroundCheckInFlight) return;
    if (isUserEditing() || hasPendingSyncWork()) {
      deferSyncWhileEditing({ needsChangeCheck: true });
      return;
    }
    foregroundCheckInFlight = true;
    getSession().then(session => {
      if (!session) return;
      return pullIfRemoteChanged().then(pulled => {
        if (pulled) refreshCurrentView({ preserveScroll: true });
      });
    }).catch(() => {}).finally(() => { foregroundCheckInFlight = false; });
  }, FOREGROUND_CHANGE_CHECK_MS);
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
      // メモ欄では、開いているデータベース(またはメモ)についてAIに聞く(文章の整理もその中から使える)。
      fab.setAttribute('aria-label', 'AIに聞く');
      fab.title = 'AIに聞く';
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
        openSpaceAI();
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


