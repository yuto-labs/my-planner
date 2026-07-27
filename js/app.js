// ============================================================
// app.js - Main SPA router and app shell
// ============================================================

import {
  getSettings, getPendingAIQueue, autoArchiveTasks, isAiAvailable,
  clearUserContentLocal, hasUserContentLocal,
  preserveUserContentSnapshot, restoreUserContentSnapshot,
  DEFAULT_ACCENT_RGB, DEFAULT_THEME_TUNING,
} from './storage.js';
import { processBatchQueue, refreshAiRuntimeStatus } from './ai.js';
import { backfillLocalEvents, initSync, pullAll, pullIfStale, startRealtimeSync, hasPendingSyncWork, flushPendingSync, resetSyncForUserSwitch } from './sync.js';
import { getSession, handleAuthRedirect, getActiveUserId, setActiveUserId, isMigratedForCurrentUser } from './supabase.js';
import { migrateToSupabase } from './migrate.js';
import { initHome }     from './modules/home.js';
import { initCalendar, openCalendarAddFlow } from './modules/calendar.js';
import { initSharedCalendar } from './modules/shared-calendar.js';
import { initTasks }    from './modules/tasks.js';
import { initGoals }    from './modules/goals.js';
import { initSettings, initAISettings } from './modules/settings.js';
import { initToday }    from './modules/today.js';
import {
  initKnowledge, initKnowledgeDetail, openKnowledgeMemo, backFromKnowledgeDetail,
  hasUnsavedKnowledgeChanges, confirmDiscardKnowledgeChanges,
} from './modules/knowledge.js';
import { initReview } from './modules/review.js';
import { initKnowledgeGraph } from './modules/knowledge-graph.js';
import {
  initExpressionAtlas,
  backFromExpressionAtlas,
  hasActiveExpressionAtlasWork,
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
  archive:           { title: 'Trash',      init: initArchive,         back: 'tasks' },
  tags:              { title: 'Tags',       init: initTagsPage },
};

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

function markUserEditing() {
  lastEditAt = Date.now();
}

function hasOpenModal() {
  const overlay = document.getElementById('modal-overlay');
  return !!overlay && !overlay.classList.contains('hidden') && !!overlay.children.length;
}

function hasOpenDatePicker() {
  const overlay = document.getElementById('dp-picker-overlay');
  return !!overlay && !overlay.classList.contains('hidden') && !!overlay.children.length;
}

function hasOpenCalendarSheet() {
  return !!document.querySelector('.cal-day-sheet');
}

function isEditableElement(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

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
  if (currentView === 'expression-atlas' && hasActiveExpressionAtlasWork()) return true;
  if ((currentView === 'knowledge' || currentView === 'learning-detail') && hasActiveKnowledgeWork()) return true;

  if (currentView === 'calendar' && (hasOpenModal() || hasOpenDatePicker() || hasOpenCalendarSheet())) {
    return true;
  }

  return false;
}

function isUserEditing() {
  const active = document.activeElement;
  if (isComposingText) return true;
  if (hasUnsavedDraft()) return true;
  if (isEditableElement(active)) return true;
  if (hasOpenModal() && document.querySelector('#modal-overlay input, #modal-overlay textarea, #modal-overlay select, #modal-overlay [contenteditable="true"]')) {
    return true;
  }
  return (Date.now() - lastEditAt) < 1500;
}

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

function scheduleDeferredSyncWork() {
  clearTimeout(editIdleTimer);
  editIdleTimer = setTimeout(flushDeferredSyncWork, 1700);
}

function deferSyncWhileEditing({ needsPull = false } = {}) {
  pendingSyncRefresh = true;
  pendingForcedPull = pendingForcedPull || needsPull;
  scheduleDeferredSyncWork();
}

function setupEditActivityGuard() {
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

export function navigate(view, options = {}) {
  if (!MODULES[view]) view = 'home';
  if (view === currentView) return;
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
  const existingRoute = window.location.hash.replace(/^#/, '');
  const routeHash = options.routeHash
    || (existingRoute && getViewFromHash() === view ? existingRoute : view);
  window.location.hash = routeHash;

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

export function refreshCurrentView(options = {}) {
  if (!currentView) return;
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
 * onUndo() is called if user taps "元に戻す".
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
  const overlayHandler = e => { if (e.target === overlay) close(); };
  overlay.addEventListener('click', overlayHandler);

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

function applyTheme(theme) {
  const html = document.documentElement;
  const settings = getSettings();
  const tuning = settings.themeTuning || DEFAULT_THEME_TUNING;
  const mode = theme === 'light' ? 'light' : 'dark';
  html.setAttribute('data-theme', mode);
  applySurfaceTheme(mode, tuning);
  applyAccentTheme(settings.accentRgb || DEFAULT_ACCENT_RGB, tuning);
}

function clampRgb(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(255, Math.round(n)));
}

function normalizeAccentRgb(rgb) {
  return {
    r: clampRgb(rgb?.r, DEFAULT_ACCENT_RGB.r),
    g: clampRgb(rgb?.g, DEFAULT_ACCENT_RGB.g),
    b: clampRgb(rgb?.b, DEFAULT_ACCENT_RGB.b),
  };
}

function clampPercent(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function normalizeThemeTuning(tuning) {
  const fallbackTone = Math.round(((Number(tuning?.blackLevel) || DEFAULT_THEME_TUNING.toneLevel) + (100 - (Number(tuning?.whiteLevel) || 45))) / 2);
  return {
    toneLevel: clampPercent(tuning?.toneLevel, fallbackTone || DEFAULT_THEME_TUNING.toneLevel),
    cardContrast: clampPercent(tuning?.cardContrast, DEFAULT_THEME_TUNING.cardContrast),
    glowIntensity: clampPercent(tuning?.glowIntensity, DEFAULT_THEME_TUNING.glowIntensity),
    accentVividness: clampPercent(tuning?.accentVividness, DEFAULT_THEME_TUNING.accentVividness),
  };
}

function mixRgb(a, b, ratio) {
  const t = Math.max(0, Math.min(1, ratio));
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

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

function hslToRgb(h, s, l) {
  let r;
  let g;
  let b;
  if (s === 0) {
    r = g = b = l;
  } else {
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

function rgbToCss(rgb, alpha = 1) {
  const c = normalizeAccentRgb(rgb);
  if (alpha >= 1) return `rgb(${c.r}, ${c.g}, ${c.b})`;
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
}

function contrastTextForRgb(rgb) {
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

  // Handle hash changes (back/forward)
  window.addEventListener('hashchange', () => {
    const h = getViewFromHash();
    if (h !== currentView) navigate(MODULES[h] ? h : 'home');
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
}

function getViewFromHash() {
  return window.location.hash.replace(/^#/, '').split('?')[0].trim() || 'home';
}

async function setupServiceWorkerAutoUpdate() {
  const registration = await navigator.serviceWorker.register('./sw.js');
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
      fab.setAttribute('aria-label', 'NUANCE ATLASを開く');
      fab.title = '表現帳';
      fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="25" height="25" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z"/><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5v-16Z"/><path d="M7 7h1.5M15.5 7H17M7 10h1.5M15.5 10H17"/></svg>';
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
        navigate('expression-atlas');
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

function isEditingText(target) {
  const el = target instanceof Element ? target : document.activeElement;
  if (!el) return false;
  return !!el.closest?.('input, textarea, select, [contenteditable="true"]');
}

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


