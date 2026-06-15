// ============================================================
// settings.js - simple user settings + advanced AI settings
// ============================================================

import {
  getSettings, saveSettings, getCategories, saveCategories,
  exportBackup, importBackup, clearAiCache, DEFAULT_CATEGORIES,
  getBatchSettings, saveBatchSettings, getPendingAIQueue, clearPendingAIQueue,
} from '../storage.js';
import { processBatchQueue } from '../ai.js';
import { esc, generateId } from '../utils.js';
import {
  getSession, getUserEmail,
  signInWithEmail, verifyEmailOtp, signOut, isMigrated,
} from '../supabase.js';
import { migrateToSupabase } from '../migrate.js';

const toast = (msg, type) => window.AppNav?.showToast(msg, type);
const nav = (view) => window.AppNav?.navigate(view);

export function initSettings(container) {
  renderMainSettings(container);
}

export function initAISettings(container) {
  renderAISettings(container);
}

function renderMainSettings(container) {
  const settings = getSettings();
  const categories = getCategories();

  container.innerHTML = `
    <div class="settings-page">
      <div class="settings-section">
        <div class="settings-heading">My Schedule</div>
        <div class="my-schedule-color-row">
          <input type="color" id="my-schedule-color-input" value="${esc(settings.myScheduleColor || '#60A5FA')}">
          <div class="my-schedule-color-preview" style="--schedule-color:${esc(settings.myScheduleColor || '#60A5FA')}">
            <span class="my-schedule-preview-time">11:00 - 12:30</span>
            <span class="my-schedule-preview-title">My Schedule</span>
            <span class="my-schedule-preview-chip">My</span>
          </div>
        </div>
        <p class="text-sm text-muted" style="margin-top:8px">
          Color used for My Schedule blocks on Home, Today, and Calendar.
        </p>
      </div>

      <div class="settings-section">
        <div class="settings-heading">Theme</div>
        <div style="display:flex;gap:8px">
          ${[
            { key: 'auto', label: 'Auto' },
            { key: 'dark', label: 'Dark' },
            { key: 'light', label: 'Light' },
          ].map(t =>
            `<button class="theme-btn${settings.theme === t.key ? ' active' : ''}" data-theme="${t.key}">${t.label}</button>`
          ).join('')}
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-heading">Categories</div>
        <div id="cat-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px">
          ${categories.map(renderCategoryRow).join('')}
        </div>
        <button class="btn btn-ghost btn-sm" id="add-cat-btn">
          <svg viewBox="0 0 24 24" fill="currentColor" style="width:14px;height:14px"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
          Add category
        </button>
      </div>

      <div class="settings-section" id="main-account-section">
        ${renderAccountSection()}
      </div>

      <div class="settings-section">
        <button class="settings-link-card" id="open-ai-settings-btn">
          <span>
            <strong>AI Settings</strong>
            <small>AI, backup, and account details</small>
          </span>
          <span class="settings-link-arrow">›</span>
        </button>
      </div>
    </div>
  `;

  wireAppearance(container);
  wireCategories(container);
  wireAccount(container, { hideWhenSignedIn: false, sectionId: 'main-account-section' });
  container.querySelector('#open-ai-settings-btn')?.addEventListener('click', () => nav('ai-settings'));
}

function renderAISettings(container) {
  const settings = getSettings();
  const batchCfg = getBatchSettings();
  const pendingQueue = getPendingAIQueue();

  container.innerHTML = `
    <div class="settings-page">
      <div class="settings-section">
        <div class="settings-heading">AI Visibility</div>
        <div class="ai-toggle-row" style="margin-top:4px">
          <div>
            <label for="ai-enabled-toggle">Show AI features</label>
            <p class="text-sm text-muted" style="margin-top:4px">
              When off, AI inputs and AI summary actions stay hidden even if an API key is saved.
            </p>
          </div>
          <input type="checkbox" id="ai-enabled-toggle" ${settings.aiEnabled === true ? 'checked' : ''}>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-heading">Backup</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn btn-ghost" id="export-btn">
            <svg viewBox="0 0 24 24" fill="currentColor" style="width:16px;height:16px"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
            Export
          </button>
          <button class="btn btn-ghost" id="import-btn">
            <svg viewBox="0 0 24 24" fill="currentColor" style="width:16px;height:16px"><path d="M19 15v4H5v-4H3v4c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-4h-2zM13 9l-1-1V3h-2v5L9 9 7 7l5 5 5-5-2 2z"/></svg>
            Import
          </button>
        </div>
        <p class="text-sm text-muted" style="margin-top:8px">
          Exported backups do not include the Anthropic API key.
        </p>
        <input type="file" id="import-file" accept=".json" class="hidden">
      </div>

      <div class="settings-section">
        <div class="settings-heading">AI API Key</div>
        <div class="form-group">
          <label class="form-label">Anthropic API key</label>
          <div class="api-key-wrap">
            <input class="input" id="api-key-input" type="password"
              value="${esc(settings.apiKey || '')}"
              placeholder="sk-ant-api03-...">
            <button class="btn btn-icon" id="api-key-toggle" title="Show / hide">
              <svg id="eye-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
            </button>
          </div>
          <p class="text-sm text-muted" style="margin-top:6px">
            The key is stored only in this browser.
          </p>
        </div>
        <button class="btn btn-primary" id="save-api-key" style="margin-top:4px">Save API key</button>
        <button class="btn btn-ghost btn-sm" id="clear-ai-cache" style="margin-top:8px;margin-left:8px">Clear AI cache</button>
      </div>

      <div class="settings-section">
        <div class="settings-heading">AI Processing Mode</div>
        <div class="batch-mode-select">
          <button class="batch-mode-btn${batchCfg.aiMode === 'immediate' ? ' active' : ''}" data-ai-mode="immediate">
            <div class="batch-mode-icon">Now</div>
            <div class="batch-mode-label">Immediate</div>
            <div class="batch-mode-sub">Run AI when an item needs it.</div>
          </button>
          <button class="batch-mode-btn${batchCfg.aiMode === 'batch' ? ' active' : ''}" data-ai-mode="batch">
            <div class="batch-mode-icon">Batch</div>
            <div class="batch-mode-label">Batch</div>
            <div class="batch-mode-sub">Queue AI work and process it together.</div>
          </button>
        </div>

        <div id="batch-schedule-wrap" style="${batchCfg.aiMode === 'batch' ? '' : 'display:none'}">
          <div class="batch-schedule-row">
            <label class="form-label" style="margin:0">Batch time</label>
            <input class="input" id="batch-time" type="time" value="${esc(batchCfg.batchTime || '22:00')}"
              style="width:120px">
            <label class="batch-toggle-wrap">
              <input type="checkbox" id="batch-enabled" ${batchCfg.batchEnabled ? 'checked' : ''}>
              <span class="batch-toggle-label">Enabled</span>
            </label>
          </div>
        </div>

        ${pendingQueue.length ? `
          <div class="batch-queue-status">
            <span>Waiting: <strong>${pendingQueue.length}</strong></span>
            <div style="display:flex;gap:8px">
              <button class="btn btn-primary btn-sm" id="run-batch-now-btn">Run now</button>
              <button class="btn btn-ghost btn-sm" id="clear-queue-btn">Clear queue</button>
            </div>
          </div>
        ` : `<p class="text-sm text-muted" style="margin-top:8px">AI queue: empty</p>`}
      </div>

      <div class="settings-section" id="ai-account-section">
        ${renderAccountSection()}
      </div>
    </div>
  `;

  wireAISettings(container);
  wireBackup(container);
  wireAccount(container, { hideWhenSignedIn: false, sectionId: 'ai-account-section' });
}

function renderCategoryRow(cat) {
  return `
    <div class="cat-row" data-cat-id="${esc(cat.id)}" style="display:flex;align-items:center;gap:10px">
      <input type="color" class="cat-color-input" value="${esc(cat.color)}"
        style="width:32px;height:32px;border-radius:50%;border:2px solid var(--border);padding:2px;cursor:pointer;background:none">
      <input class="input cat-name-input" value="${esc(cat.name)}" placeholder="Category name" style="flex:1">
      <button class="btn-icon cat-delete-btn" title="Delete category">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
      </button>
    </div>
  `;
}

function renderAccountSection() {
  return `
    <div class="settings-heading">Account</div>
    <div id="sb-auth-area">
      <div id="sb-status" class="text-sm text-muted" style="margin-bottom:10px">Checking...</div>

      <div id="sb-signin-wrap">
        <div class="form-group">
          <label class="form-label">Email address</label>
          <input class="input" id="sb-email-input" type="email"
            placeholder="you@example.com" autocomplete="email">
        </div>
        <button class="btn btn-primary btn-sm" id="sb-signin-btn">Send login code</button>
        <p class="text-sm text-muted" style="margin-top:6px">
          Enter the code sent to your email. No password is needed.
        </p>

        <div id="sb-otp-wrap" class="hidden" style="margin-top:16px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:14px">
          <p class="text-sm" style="margin-bottom:10px">Check your email and enter the login code.</p>
          <input class="input" id="sb-otp-input" type="text" inputmode="numeric"
            pattern="[0-9]*" maxlength="8" placeholder="12345678"
            style="font-size:24px;letter-spacing:4px;text-align:center;font-weight:700">
          <button class="btn btn-primary btn-sm btn-full" id="sb-otp-verify-btn" style="margin-top:10px">Sign in</button>
        </div>
      </div>

      <div id="sb-loggedin-wrap" class="hidden">
        <div id="sb-migrate-area" class="hidden" style="margin-bottom:12px">
          <p class="text-sm" style="margin-bottom:8px">
            Move local data on this device to your cloud account. Local data will not be deleted.
          </p>
          <button class="btn btn-primary btn-sm" id="sb-migrate-btn">Move local data to cloud</button>
          <div id="sb-migrate-progress" class="hidden text-sm text-muted" style="margin-top:6px"></div>
        </div>
        <button class="btn btn-ghost btn-sm" id="sb-signout-btn">Sign out</button>
      </div>
    </div>
  `;
}

function wireAppearance(container) {
  container.querySelectorAll('[data-theme]').forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.theme;
      saveSettings({ theme });
      window.AppTheme?.apply(theme);
      container.querySelectorAll('[data-theme]').forEach(b =>
        b.classList.toggle('active', b.dataset.theme === theme)
      );
      toast(`Theme changed to ${btn.textContent}`, 'info');
    });
  });

  container.querySelector('#my-schedule-color-input')?.addEventListener('input', e => {
    const color = e.target.value || '#60A5FA';
    saveSettings({ myScheduleColor: color });
    const preview = container.querySelector('.my-schedule-color-preview');
    if (preview) preview.style.setProperty('--schedule-color', color);
  });
}

function wireCategories(container) {
  const saveCats = () => {
    const rows = container.querySelectorAll('.cat-row');
    const cats = [];
    rows.forEach(row => {
      const id = row.dataset.catId;
      const name = row.querySelector('.cat-name-input')?.value.trim();
      const color = row.querySelector('.cat-color-input')?.value;
      if (name) cats.push({ id, name, color });
    });
    saveCategories(cats);
  };

  container.querySelector('#cat-list')?.addEventListener('input', saveCats);

  container.querySelector('#cat-list')?.addEventListener('click', e => {
    const delBtn = e.target.closest('.cat-delete-btn');
    if (!delBtn) return;
    const row = delBtn.closest('.cat-row');
    if (!row) return;
    const catId = row.dataset.catId;
    if (DEFAULT_CATEGORIES.map(c => c.id).includes(catId)) {
      toast('Default categories cannot be deleted.', 'error');
      return;
    }
    row.remove();
    saveCats();
    toast('Category deleted.', 'info');
  });

  container.querySelector('#add-cat-btn')?.addEventListener('click', () => {
    const catList = container.querySelector('#cat-list');
    const newId = generateId();
    const colors = ['#06b6d4', '#ec4899', '#f97316', '#84cc16', '#a78bfa'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    const div = document.createElement('div');
    div.className = 'cat-row';
    div.dataset.catId = newId;
    div.style.cssText = 'display:flex;align-items:center;gap:10px';
    div.innerHTML = `
      <input type="color" class="cat-color-input" value="${color}"
        style="width:32px;height:32px;border-radius:50%;border:2px solid var(--border);padding:2px;cursor:pointer;background:none">
      <input class="input cat-name-input" value="" placeholder="Category name" style="flex:1">
      <button class="btn-icon cat-delete-btn" title="Delete category">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
      </button>
    `;
    catList?.appendChild(div);
    div.querySelector('.cat-name-input')?.focus();
    saveCats();
  });
}

function wireAISettings(container) {
  const apiInput = container.querySelector('#api-key-input');
  container.querySelector('#api-key-toggle')?.addEventListener('click', () => {
    if (apiInput) apiInput.type = apiInput.type === 'password' ? 'text' : 'password';
  });

  container.querySelector('#ai-enabled-toggle')?.addEventListener('change', e => {
    saveSettings({ aiEnabled: e.target.checked });
    toast(e.target.checked ? 'AI features are visible.' : 'AI features are hidden.', 'info');
  });

  container.querySelector('#save-api-key')?.addEventListener('click', () => {
    const key = apiInput?.value.trim() || '';
    saveSettings({ apiKey: key });
    toast('API key saved.', 'success');
  });

  container.querySelector('#clear-ai-cache')?.addEventListener('click', () => {
    clearAiCache();
    toast('AI cache cleared.', 'info');
  });

  container.querySelectorAll('[data-ai-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.aiMode;
      saveBatchSettings({ aiMode: mode });
      container.querySelectorAll('[data-ai-mode]').forEach(b =>
        b.classList.toggle('active', b.dataset.aiMode === mode)
      );
      const scheduleWrap = container.querySelector('#batch-schedule-wrap');
      if (scheduleWrap) scheduleWrap.style.display = mode === 'batch' ? '' : 'none';
      toast(`AI mode changed to ${mode}.`, 'info');
    });
  });

  container.querySelector('#batch-time')?.addEventListener('change', e => {
    saveBatchSettings({ batchTime: e.target.value });
    toast('Batch time saved.', 'success');
  });

  container.querySelector('#batch-enabled')?.addEventListener('change', e => {
    saveBatchSettings({ batchEnabled: e.target.checked });
    toast(e.target.checked ? 'Batch processing enabled.' : 'Batch processing disabled.', 'info');
  });

  container.querySelector('#run-batch-now-btn')?.addEventListener('click', async () => {
    const btn = container.querySelector('#run-batch-now-btn');
    if (!btn) return;
    btn.innerHTML = '<span class="ai-spinner"></span> Processing...';
    btn.disabled = true;
    try {
      const result = await processBatchQueue();
      toast(`AI batch complete: ${result.processed} items processed.`, 'success');
      renderAISettings(container);
    } catch (e) {
      toast('Error: ' + e.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Run now';
    }
  });

  container.querySelector('#clear-queue-btn')?.addEventListener('click', () => {
    clearPendingAIQueue();
    toast('AI queue cleared.', 'info');
    renderAISettings(container);
  });
}

function wireBackup(container) {
  container.querySelector('#export-btn')?.addEventListener('click', () => {
    const json = exportBackup();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `my-planner-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Exported.', 'success');
  });

  container.querySelector('#import-btn')?.addEventListener('click', () => {
    container.querySelector('#import-file')?.click();
  });

  container.querySelector('#import-file')?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        importBackup(ev.target.result);
        toast('Imported. Reloading...', 'success');
        setTimeout(() => location.reload(), 1500);
      } catch (err) {
        toast('Import error: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
  });
}

function wireAccount(container, options = {}) {
  container.querySelector('#sb-signin-btn')?.addEventListener('click', async () => {
    const email = container.querySelector('#sb-email-input')?.value.trim();
    if (!email) {
      toast('Enter your email address.', 'error');
      return;
    }
    const btn = container.querySelector('#sb-signin-btn');
    btn.disabled = true;
    btn.textContent = 'Sending...';
    try {
      await signInWithEmail(email);
      container.querySelector('#sb-otp-wrap')?.classList.remove('hidden');
      container.querySelector('#sb-otp-input')?.focus();
      toast(`Login code sent to ${email}.`, 'success');
    } catch (e) {
      toast('Send error: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send login code again';
    }
  });

  container.querySelector('#sb-otp-verify-btn')?.addEventListener('click', async () => {
    const email = container.querySelector('#sb-email-input')?.value.trim();
    const code = container.querySelector('#sb-otp-input')?.value.trim();
    if (!email) {
      toast('Enter your email address.', 'error');
      return;
    }
    if (!code || code.length < 6) {
      toast('Enter the login code.', 'error');
      return;
    }
    const btn = container.querySelector('#sb-otp-verify-btn');
    btn.disabled = true;
    btn.textContent = 'Signing in...';
    try {
      const session = await verifyEmailOtp(email, code);
      if (!session) throw new Error('Could not create a session.');
      toast('Signed in.', 'success');
      if (!isMigrated()) {
        btn.textContent = 'Syncing…';
        try {
          await migrateToSupabase(() => {});
          toast('Sync complete ✓', 'success');
        } catch (e) {
          console.warn('[Sync] auto-migrate failed:', e);
          toast('Sync failed — tap "Move local data to cloud" in AI Settings to retry.', 'error');
        }
      }
      await refreshAccountStatus(container, options);
    } catch (e) {
      toast('Sign-in error: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  });

  container.querySelector('#sb-otp-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') container.querySelector('#sb-otp-verify-btn')?.click();
  });

  container.querySelector('#sb-signout-btn')?.addEventListener('click', async () => {
    await signOut();
    toast('Signed out.', 'info');
    await refreshAccountStatus(container, options);
  });

  container.querySelector('#sb-migrate-btn')?.addEventListener('click', async () => {
    const btn = container.querySelector('#sb-migrate-btn');
    const progress = container.querySelector('#sb-migrate-progress');
    btn.disabled = true;
    progress?.classList.remove('hidden');
    try {
      await migrateToSupabase((step, pct) => {
        if (progress) progress.textContent = `${step}... (${pct}%)`;
      });
      toast('Local data moved to cloud.', 'success');
      if (progress) progress.textContent = 'Done.';
      container.querySelector('#sb-migrate-area')?.classList.add('hidden');
    } catch (e) {
      toast('Migration error: ' + e.message, 'error');
      if (progress) progress.textContent = 'Error: ' + e.message;
      btn.disabled = false;
    }
  });

  refreshAccountStatus(container, options);
}

async function refreshAccountStatus(container, options = {}) {
  const section = options.sectionId ? container.querySelector(`#${options.sectionId}`) : null;
  const statusEl = container.querySelector('#sb-status');
  const signinWrap = container.querySelector('#sb-signin-wrap');
  const loggedinWrap = container.querySelector('#sb-loggedin-wrap');
  const migrateArea = container.querySelector('#sb-migrate-area');

  try {
    const session = await getSession();
    if (session) {
      const email = await getUserEmail();
      if (options.hideWhenSignedIn && section) {
        section.classList.add('hidden');
        return;
      }
      if (section) section.classList.remove('hidden');
      if (statusEl) {
        statusEl.innerHTML = `<span style="color:var(--success)">Signed in</span>: ${esc(email || session.user.id)}`;
      }
      signinWrap?.classList.add('hidden');
      loggedinWrap?.classList.remove('hidden');
      if (!isMigrated()) migrateArea?.classList.remove('hidden');
      else migrateArea?.classList.add('hidden');
    } else {
      if (section) section.classList.remove('hidden');
      if (statusEl) statusEl.textContent = 'Not signed in';
      signinWrap?.classList.remove('hidden');
      loggedinWrap?.classList.add('hidden');
    }
  } catch {
    if (section) section.classList.remove('hidden');
    if (statusEl) statusEl.textContent = 'Could not check sign-in status.';
    signinWrap?.classList.remove('hidden');
    loggedinWrap?.classList.add('hidden');
  }
}
