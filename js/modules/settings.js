// ============================================================
// settings.js — Settings: API key, theme, backup/restore
// ============================================================

import {
  getSettings, saveSettings, getCategories, saveCategories,
  exportBackup, importBackup, clearAiCache, DEFAULT_CATEGORIES,
  getBatchSettings, saveBatchSettings, getPendingAIQueue, clearPendingAIQueue,
} from '../storage.js';
import { processBatchQueue } from '../ai.js';
import { esc, generateId } from '../utils.js';
import {
  getStoredConfig, saveConfig, getSession, getUserEmail,
  signInWithEmail, signInWithMagicLinkUrl, verifyEmailOtp, signOut, testConnection, isMigrated,
} from '../supabase.js';
import { migrateToSupabase } from '../migrate.js';

const toast = (msg, type) => window.AppNav?.showToast(msg, type);

export function initSettings(container) {
  render(container);
}

function render(container) {
  const settings     = getSettings();
  const categories   = getCategories();
  const batchCfg     = getBatchSettings();
  const pendingQueue = getPendingAIQueue();

  container.innerHTML = `
    <!-- My Schedule color -->
    <div class="settings-section">
      <div class="settings-heading">🗓️ My Schedule</div>
      <div class="my-schedule-color-row">
        <input type="color" id="my-schedule-color-input" value="${esc(settings.myScheduleColor || '#60A5FA')}">
        <div class="my-schedule-color-preview" style="--schedule-color:${esc(settings.myScheduleColor || '#60A5FA')}">
          <span class="my-schedule-preview-time">11:00 – 12:30</span>
          <span class="my-schedule-preview-title">My Schedule</span>
          <span class="my-schedule-preview-chip">My</span>
        </div>
      </div>
      <p class="text-sm text-muted" style="margin-top:8px">
        カレンダー・Today・Home に表示されるマイスケジュールの色です。
      </p>
    </div>

    <!-- Theme -->
    <div class="settings-section">
      <div class="settings-heading">🎨 テーマ</div>
      <div style="display:flex;gap:8px">
        ${[
          { key: 'auto',  label: '自動（OS設定）' },
          { key: 'dark',  label: 'ダーク' },
          { key: 'light', label: 'ライト' },
        ].map(t =>
          `<button class="theme-btn${settings.theme===t.key?' active':''}" data-theme="${t.key}">${t.label}</button>`
        ).join('')}
      </div>
    </div>

    <!-- Categories -->
    <div class="settings-section">
      <div class="settings-heading">🏷️ カテゴリ</div>
      <div id="cat-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px">
        ${categories.map(renderCategoryRow).join('')}
      </div>
      <button class="btn btn-ghost btn-sm" id="add-cat-btn">
        <svg viewBox="0 0 24 24" fill="currentColor" style="width:14px;height:14px"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
        カテゴリを追加
      </button>
    </div>

    <!-- AI visibility -->
    <div class="settings-section">
      <div class="settings-heading">🤖 AI機能</div>
      <div class="ai-toggle-row" style="margin-top:4px">
        <div>
          <label for="ai-enabled-toggle">AI機能を表示する</label>
          <p class="text-sm text-muted" style="margin-top:4px">
            OFFにすると、APIキーが保存されていてもAI入力欄やAIサマリーを隠します。
          </p>
        </div>
        <input type="checkbox" id="ai-enabled-toggle" ${settings.aiEnabled !== false ? 'checked' : ''}>
      </div>
    </div>

    <!-- Supabase sync -->
    <div class="settings-section" id="supabase-section">
      <div class="settings-heading">☁️ クラウド同期 (Supabase)</div>

      <div class="form-group">
        <label class="form-label">Supabase URL</label>
        <input class="input" id="sb-url-input" type="url"
          value="${esc((getStoredConfig()?.url) || '')}"
          placeholder="https://xxxx.supabase.co">
      </div>

      <div class="form-group">
        <label class="form-label">Anon Key（公開キー）</label>
        <div class="api-key-wrap">
          <input class="input" id="sb-key-input" type="password"
            value="${esc((getStoredConfig()?.anonKey) || '')}"
            placeholder="eyJhbGciOiJIUzI1NiIs...">
          <button class="btn btn-icon" id="sb-key-toggle" title="表示/非表示">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
          </button>
        </div>
        <p class="text-sm text-muted" style="margin-top:4px">
          ⚠️ SERVICE ROLE KEY は絶対に入力しないでください。Anon Key のみ使用してください。
        </p>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
        <button class="btn btn-primary btn-sm" id="sb-save-config">設定を保存</button>
        <button class="btn btn-ghost btn-sm" id="sb-test-btn">接続テスト</button>
      </div>

      <hr style="margin:16px 0;border-color:var(--border)">

      <div id="sb-auth-area">
        <div id="sb-status" class="text-sm text-muted" style="margin-bottom:10px">読み込み中…</div>

        <!-- Not logged in UI -->
        <div id="sb-signin-wrap">
          <div class="form-group">
            <label class="form-label">メールアドレス</label>
            <input class="input" id="sb-email-input" type="email"
              placeholder="you@example.com" autocomplete="email">
          </div>
          <button class="btn btn-primary btn-sm" id="sb-signin-btn">
            コードを送信
          </button>
          <p class="text-sm text-muted" style="margin-top:6px">
            メールに届いた6桁コードでログインできます。パスワード不要です。
          </p>

          <!-- Step 2: OTP code input (shown after email is sent) -->
          <div id="sb-otp-wrap" class="hidden" style="margin-top:16px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:14px">
            <p class="text-sm" style="margin-bottom:10px">✉️ メールを確認して、届いた<strong>ログインコード</strong>を入力してください</p>
            <input class="input" id="sb-otp-input" type="text" inputmode="numeric"
              pattern="[0-9]*" maxlength="8" placeholder="12345678"
              style="font-size:24px;letter-spacing:4px;text-align:center;font-weight:700">
            <button class="btn btn-primary btn-sm btn-full" id="sb-otp-verify-btn" style="margin-top:10px">
              ログイン
            </button>
          </div>

          <!-- Fallback: paste full link -->
          <details style="margin-top:16px">
            <summary class="text-sm text-muted" style="cursor:pointer">リンクを直接貼り付けてログイン（PCなど）</summary>
            <div style="margin-top:10px">
              <textarea class="input" id="sb-link-input" rows="3"
                placeholder="メールの Sign in リンクをコピーして貼り付け"></textarea>
              <button class="btn btn-ghost btn-sm" id="sb-link-login-btn" style="margin-top:8px">
                リンクでログイン
              </button>
            </div>
          </details>
        </div>

        <!-- Logged in UI -->
        <div id="sb-loggedin-wrap" class="hidden">
          <div id="sb-migrate-area" class="hidden" style="margin-bottom:12px">
            <p class="text-sm" style="margin-bottom:8px">
              📦 ローカルデータをクラウドへ移行します（既存データは消去されません）
            </p>
            <button class="btn btn-primary btn-sm" id="sb-migrate-btn">
              データを Supabase へ移行
            </button>
            <div id="sb-migrate-progress" class="hidden text-sm text-muted" style="margin-top:6px"></div>
          </div>
          <button class="btn btn-ghost btn-sm" id="sb-signout-btn">サインアウト</button>
        </div>
      </div>

      <p class="text-sm text-muted" style="margin-top:12px">
        Supabase プロジェクトは
        <a href="https://supabase.com" target="_blank" rel="noopener">supabase.com</a>
        で無料作成できます。<br>
        スキーマ SQL は <code>supabase_schema.sql</code> を Supabase の SQL Editor で実行してください。
      </p>
    </div>

    <!-- Backup -->
    <div class="settings-section">
      <div class="settings-heading">💾 バックアップ</div>

      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-ghost" id="export-btn">
          <svg viewBox="0 0 24 24" fill="currentColor" style="width:16px;height:16px"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
          エクスポート
        </button>
        <button class="btn btn-ghost" id="import-btn">
          <svg viewBox="0 0 24 24" fill="currentColor" style="width:16px;height:16px"><path d="M19 15v4H5v-4H3v4c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-4h-2zM13 9l-1-1V3h-2v5L9 9 7 7l5 5 5-5-2 2z"/></svg>
          インポート
        </button>
      </div>
      <p class="text-sm text-muted" style="margin-top:8px">
        ※ エクスポートにAPIキーは含まれません
      </p>
      <input type="file" id="import-file" accept=".json" class="hidden">
    </div>

    <!-- AI Key -->
    <div class="settings-section">
      <div class="settings-heading">🤖 AI設定</div>

      <div class="form-group">
        <label class="form-label">Anthropic APIキー</label>
        <div class="api-key-wrap">
          <input class="input" id="api-key-input" type="password"
            value="${esc(settings.apiKey || '')}"
            placeholder="sk-ant-api03-…">
          <button class="btn btn-icon" id="api-key-toggle" title="表示/非表示">
            <svg id="eye-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
          </button>
        </div>
        <p class="text-sm text-muted" style="margin-top:6px">
          APIキーは <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a> で取得できます。<br>
          キーはこのデバイスにのみ保存されます。
        </p>
      </div>

      <button class="btn btn-primary" id="save-api-key" style="margin-top:4px">APIキーを保存</button>
      <button class="btn btn-ghost btn-sm" id="clear-ai-cache" style="margin-top:8px;margin-left:8px">AIキャッシュをクリア</button>

      <div class="form-group" style="margin-top:16px">
        <label class="form-label">使用モデル</label>
        <div style="background:var(--bg-hover);border-radius:var(--radius-sm);padding:12px;font-size:13px">
          <div style="display:flex;justify-content:space-between;margin-bottom:6px">
            <span>シンプル処理（メッセージ生成・予定解析）</span>
            <code style="color:var(--primary)">claude-haiku-4-5</code>
          </div>
          <div style="display:flex;justify-content:space-between">
            <span>複雑な処理（目標分解）</span>
            <code style="color:var(--purple)">claude-sonnet-4-6</code>
          </div>
        </div>
      </div>
    </div>

    <!-- Batch AI Processing -->
    <div class="settings-section">
      <div class="settings-heading">⚡ AI処理モード</div>

      <div class="batch-mode-select">
        <button class="batch-mode-btn${batchCfg.aiMode === 'immediate' ? ' active' : ''}" data-ai-mode="immediate">
          <div class="batch-mode-icon">⚡</div>
          <div class="batch-mode-label">即時処理</div>
          <div class="batch-mode-sub">メモ作成時にAIをすぐ呼び出す</div>
        </button>
        <button class="batch-mode-btn${batchCfg.aiMode === 'batch' ? ' active' : ''}" data-ai-mode="batch">
          <div class="batch-mode-icon">🗂️</div>
          <div class="batch-mode-label">まとめて処理</div>
          <div class="batch-mode-sub">指定時刻にまとめてAPI呼び出し</div>
        </button>
      </div>

      <div id="batch-schedule-wrap" style="${batchCfg.aiMode === 'batch' ? '' : 'display:none'}">
        <div class="batch-schedule-row">
          <label class="form-label" style="margin:0">バッチ実行時刻</label>
          <input class="input" id="batch-time" type="time" value="${esc(batchCfg.batchTime || '22:00')}"
            style="width:120px">
          <label class="batch-toggle-wrap">
            <input type="checkbox" id="batch-enabled" ${batchCfg.batchEnabled ? 'checked' : ''}>
            <span class="batch-toggle-label">有効</span>
          </label>
        </div>
        <p class="text-sm text-muted" style="margin-top:6px">
          毎日この時刻に、未処理メモのタグ付け・分類をまとめてAI処理します。
        </p>
      </div>

      ${pendingQueue.length ? `
        <div class="batch-queue-status">
          <span>🤖 AI処理待ち: <strong>${pendingQueue.length}件</strong></span>
          <div style="display:flex;gap:8px">
            <button class="btn btn-primary btn-sm" id="run-batch-now-btn">今すぐ処理</button>
            <button class="btn btn-ghost btn-sm" id="clear-queue-btn">キューをクリア</button>
          </div>
        </div>
      ` : `<p class="text-sm text-muted" style="margin-top:8px">AI処理待ちキュー: なし</p>`}
    </div>

    <!-- App info -->
    <div class="settings-section">
      <div class="settings-heading">ℹ️ アプリ情報</div>
      <p class="text-sm text-muted">マイプランナー v1.0.0 — 自己管理・知識ベースアプリ</p>
      <p class="text-sm text-muted" style="margin-top:4px">データはすべてこのデバイスの localStorage に保存されます。</p>
    </div>
  `;

  wireSettings(container);
}

function renderCategoryRow(cat) {
  return `
    <div class="cat-row" data-cat-id="${esc(cat.id)}" style="display:flex;align-items:center;gap:10px">
      <input type="color" class="cat-color-input" value="${cat.color}"
        style="width:32px;height:32px;border-radius:50%;border:2px solid var(--border);padding:2px;cursor:pointer;background:none">
      <input class="input cat-name-input" value="${esc(cat.name)}" placeholder="カテゴリ名"
        style="flex:1">
      <button class="btn-icon cat-delete-btn" title="削除">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
      </button>
    </div>
  `;
}

function wireSettings(container) {
  // API key toggle visibility
  const apiInput = container.querySelector('#api-key-input');
  container.querySelector('#api-key-toggle')?.addEventListener('click', () => {
    apiInput.type = apiInput.type === 'password' ? 'text' : 'password';
  });

  // AI enabled toggle (immediate save)
  container.querySelector('#ai-enabled-toggle')?.addEventListener('change', (e) => {
    saveSettings({ aiEnabled: e.target.checked });
    toast(e.target.checked ? 'AI機能を有効にしました' : 'AI機能を無効にしました', 'info');
  });

  // Save API key
  container.querySelector('#save-api-key')?.addEventListener('click', () => {
    const key = apiInput?.value.trim() || '';
    saveSettings({ apiKey: key });
    toast('APIキーを保存しました', 'success');
  });

  // Clear AI cache
  container.querySelector('#clear-ai-cache')?.addEventListener('click', () => {
    clearAiCache();
    toast('AIキャッシュをクリアしました', 'info');
  });

  // AI Mode toggle
  container.querySelectorAll('[data-ai-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.aiMode;
      saveBatchSettings({ aiMode: mode });
      container.querySelectorAll('[data-ai-mode]').forEach(b =>
        b.classList.toggle('active', b.dataset.aiMode === mode)
      );
      const scheduleWrap = container.querySelector('#batch-schedule-wrap');
      if (scheduleWrap) scheduleWrap.style.display = mode === 'batch' ? '' : 'none';
      toast(`AIモードを「${btn.querySelector('.batch-mode-label').textContent}」に変更しました`, 'info');
    });
  });

  // Batch time + enable
  container.querySelector('#batch-time')?.addEventListener('change', e => {
    saveBatchSettings({ batchTime: e.target.value });
    toast('バッチ実行時刻を保存しました', 'success');
  });
  container.querySelector('#batch-enabled')?.addEventListener('change', e => {
    saveBatchSettings({ batchEnabled: e.target.checked });
    toast(e.target.checked ? 'バッチ処理を有効にしました' : 'バッチ処理を無効にしました', 'info');
  });

  // Run batch now
  container.querySelector('#run-batch-now-btn')?.addEventListener('click', async () => {
    const btn = container.querySelector('#run-batch-now-btn');
    if (!btn) return;
    btn.innerHTML = '<span class="ai-spinner"></span> 処理中…';
    btn.disabled = true;
    try {
      const result = await processBatchQueue();
      toast(`AI処理完了: ${result.processed}件を処理しました ✓`, 'success');
      render(container); // refresh to show updated queue count
    } catch (e) {
      toast('エラー: ' + e.message, 'error');
      btn.disabled = false;
      btn.textContent = '今すぐ処理';
    }
  });

  // Clear queue
  container.querySelector('#clear-queue-btn')?.addEventListener('click', () => {
    clearPendingAIQueue();
    toast('AI処理キューをクリアしました', 'info');
    render(container);
  });

  // Theme
  container.querySelectorAll('[data-theme]').forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.theme;
      saveSettings({ theme });
      window.AppTheme?.apply(theme);
      container.querySelectorAll('[data-theme]').forEach(b =>
        b.classList.toggle('active', b.dataset.theme === theme)
      );
      toast(`テーマを「${btn.textContent}」に変更しました`, 'info');
    });
  });

  // My Schedule color
  container.querySelector('#my-schedule-color-input')?.addEventListener('input', e => {
    const color = e.target.value || '#60A5FA';
    saveSettings({ myScheduleColor: color });
    const preview = container.querySelector('.my-schedule-color-preview');
    if (preview) preview.style.setProperty('--schedule-color', color);
  });

  // Category save on change
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

  container.querySelector('#cat-list')?.addEventListener('change', saveCats);
  container.querySelector('#cat-list')?.addEventListener('input', saveCats);

  // Delete category
  container.querySelector('#cat-list')?.addEventListener('click', (e) => {
    const delBtn = e.target.closest('.cat-delete-btn');
    if (!delBtn) return;
    const row = delBtn.closest('.cat-row');
    if (!row) return;
    const catId = row.dataset.catId;
    if (DEFAULT_CATEGORIES.map(c => c.id).includes(catId)) {
      toast('デフォルトカテゴリは削除できません', 'error');
      return;
    }
    row.remove();
    saveCats();
    toast('カテゴリを削除しました', 'info');
  });

  // Add category
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
      <input class="input cat-name-input" value="" placeholder="カテゴリ名" style="flex:1">
      <button class="btn-icon cat-delete-btn" title="削除">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
      </button>
    `;
    catList?.appendChild(div);
    div.querySelector('.cat-name-input')?.focus();
    saveCats();
  });

  // Export
  container.querySelector('#export-btn')?.addEventListener('click', () => {
    const json = exportBackup();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `my-planner-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('エクスポートしました', 'success');
  });

  // Import
  container.querySelector('#import-btn')?.addEventListener('click', () => {
    container.querySelector('#import-file')?.click();
  });

  container.querySelector('#import-file')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        importBackup(ev.target.result);
        toast('インポートしました。ページをリロードして反映します。', 'success');
        setTimeout(() => location.reload(), 1500);
      } catch (err) {
        toast('インポートエラー: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
  });

  // ---- Supabase section ----
  wireSupabase(container);
}

async function wireSupabase(container) {
  // Anon key visibility toggle
  const sbKeyInput = container.querySelector('#sb-key-input');
  container.querySelector('#sb-key-toggle')?.addEventListener('click', () => {
    sbKeyInput.type = sbKeyInput.type === 'password' ? 'text' : 'password';
  });

  // Save config
  container.querySelector('#sb-save-config')?.addEventListener('click', () => {
    const url    = container.querySelector('#sb-url-input')?.value.trim() || '';
    const anonKey = sbKeyInput?.value.trim() || '';
    if (url && anonKey) {
      saveConfig({ url, anonKey });
      toast('Supabase 設定を保存しました', 'success');
    } else {
      toast('URL と Anon Key の両方を入力してください', 'error');
    }
    // Refresh auth status
    _refreshSupabaseStatus(container);
  });

  // Connection test
  container.querySelector('#sb-test-btn')?.addEventListener('click', async () => {
    const btn = container.querySelector('#sb-test-btn');
    btn.disabled = true;
    btn.textContent = '接続中…';
    try {
      await testConnection();
      toast('✓ Supabase に接続できました', 'success');
    } catch (e) {
      toast('接続エラー: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '接続テスト';
    }
  });

  // Step 1: send OTP code
  container.querySelector('#sb-signin-btn')?.addEventListener('click', async () => {
    const email = container.querySelector('#sb-email-input')?.value.trim();
    if (!email) { toast('メールアドレスを入力してください', 'error'); return; }
    const btn = container.querySelector('#sb-signin-btn');
    btn.disabled = true;
    btn.textContent = '送信中…';
    try {
      await signInWithEmail(email);
      // Show OTP input step
      container.querySelector('#sb-otp-wrap')?.classList.remove('hidden');
      container.querySelector('#sb-otp-input')?.focus();
      toast(`✉️ ${email} にコードを送りました`, 'success');
    } catch (e) {
      toast('送信エラー: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'コードを再送信';
    }
  });

  // Step 2: verify OTP code
  container.querySelector('#sb-otp-verify-btn')?.addEventListener('click', async () => {
    const email = container.querySelector('#sb-email-input')?.value.trim();
    const code  = container.querySelector('#sb-otp-input')?.value.trim();
    if (!email) { toast('メールアドレスを入力してください', 'error'); return; }
    if (!code || code.length < 6) { toast('コードを入力してください', 'error'); return; }
    const btn = container.querySelector('#sb-otp-verify-btn');
    btn.disabled = true;
    btn.textContent = 'ログイン中…';
    try {
      const session = await verifyEmailOtp(email, code);
      if (!session) throw new Error('セッションを取得できませんでした');
      toast('ログインしました', 'success');
      container.querySelector('#sb-otp-wrap')?.classList.add('hidden');
      container.querySelector('#sb-otp-input').value = '';
      await _refreshSupabaseStatus(container);
    } catch (e) {
      toast('コードが違うか期限切れです: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'ログイン';
    }
  });

  // Enter key on OTP input
  container.querySelector('#sb-otp-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') container.querySelector('#sb-otp-verify-btn')?.click();
  });

  container.querySelector('#sb-link-login-btn')?.addEventListener('click', async () => {
    const link = container.querySelector('#sb-link-input')?.value.trim();
    if (!link) { toast('メール内のSign inリンクを貼ってください', 'error'); return; }
    const btn = container.querySelector('#sb-link-login-btn');
    btn.disabled = true;
    btn.textContent = 'ログイン中…';
    try {
      const session = await signInWithMagicLinkUrl(link);
      if (!session) throw new Error('セッションを取得できませんでした');
      toast('ログインしました', 'success');
      container.querySelector('#sb-link-input').value = '';
      await _refreshSupabaseStatus(container);
    } catch (e) {
      toast('リンクログインエラー: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'リンクでログイン';
    }
  });

  // Sign out
  container.querySelector('#sb-signout-btn')?.addEventListener('click', async () => {
    await signOut();
    toast('サインアウトしました', 'info');
    _refreshSupabaseStatus(container);
  });

  // Migrate data
  container.querySelector('#sb-migrate-btn')?.addEventListener('click', async () => {
    const btn      = container.querySelector('#sb-migrate-btn');
    const progress = container.querySelector('#sb-migrate-progress');
    btn.disabled = true;
    progress?.classList.remove('hidden');

    try {
      await migrateToSupabase((step, pct) => {
        if (progress) progress.textContent = `${step}… (${pct}%)`;
      });
      toast('✓ データを Supabase へ移行しました', 'success');
      if (progress) progress.textContent = '移行完了 ✓';
      container.querySelector('#sb-migrate-area')?.classList.add('hidden');
    } catch (e) {
      toast('移行エラー: ' + e.message, 'error');
      if (progress) progress.textContent = 'エラー: ' + e.message;
      btn.disabled = false;
    }
  });

  // Reflect current auth status
  await _refreshSupabaseStatus(container);
}

async function _refreshSupabaseStatus(container) {
  const statusEl    = container.querySelector('#sb-status');
  const signinWrap  = container.querySelector('#sb-signin-wrap');
  const loggedinWrap = container.querySelector('#sb-loggedin-wrap');
  const migrateArea = container.querySelector('#sb-migrate-area');

  try {
    const session = await getSession();
    if (session) {
      const email = await getUserEmail();
      if (statusEl) statusEl.innerHTML =
        `<span style="color:var(--success)">✓ サインイン済み</span>: ${esc(email || session.user.id)}`;
      signinWrap?.classList.add('hidden');
      loggedinWrap?.classList.remove('hidden');
      // Show migrate button if not yet migrated
      if (!isMigrated()) {
        migrateArea?.classList.remove('hidden');
      } else {
        migrateArea?.classList.add('hidden');
      }
    } else {
      if (statusEl) statusEl.textContent = '未サインイン';
      signinWrap?.classList.remove('hidden');
      loggedinWrap?.classList.add('hidden');
    }
  } catch {
    if (statusEl) statusEl.textContent = 'ステータス取得失敗（URL / Anon Key を確認してください）';
    signinWrap?.classList.remove('hidden');
    loggedinWrap?.classList.add('hidden');
  }
}
