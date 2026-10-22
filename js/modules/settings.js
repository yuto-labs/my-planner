// ============================================================
// settings.js - 外観・アカウント・同期・AIの設定画面
//
// 値の保存だけでなく、ログイン切替前の同期完了と端末スナップショット保護も担当する。
// 認証自体はsupabase.js、データ同期はsync.jsの公開関数を通して操作する。
// ============================================================

import {
  getSettings, saveSettings, getCategories, saveCategories,
  exportBackup, importBackup, clearAiCache, DEFAULT_CATEGORIES,
  getPendingAIQueue, clearPendingAIQueue, getAiRuntime,
  clearUserContentLocal, hasUserContentLocal,
  preserveUserContentSnapshot,
  restoreUserContentSnapshot,
  classifyKnowledgeRecord,
} from '../storage.js';
import {
  formatCharCount,
  measureEntries,
  measureKnowledgeRecords,
  measureLocalStorage,
} from '../storage-usage.js';
import { getLocalStoreMode, getManagedEntries, localStore } from '../local-store.js';
import { processBatchQueue, refreshAiRuntimeStatus } from '../ai.js';
import { esc, generateId } from '../utils.js';
import {
  getSession, getUserEmail,
  signInWithEmail, getAuthSendErrorMessage, verifyEmailOtp, signOut, isMigratedForCurrentUser,
  getActiveUserId, setActiveUserId,
} from '../supabase.js';
import { migrateToSupabase } from '../migrate.js';
import { getSyncStatus, pullAll, startRealtimeSync, flushPendingSync, resetSyncForUserSwitch } from '../sync.js';
import { consumePendingSharedInvite } from '../shared-calendar.js';
import { downloadBackup } from '../backup-reminder.js';
import {
  normalizeReminderSettings, notificationPermission, replanReminders,
  requestNotificationPermission, sendTestReminder,
} from '../reminders.js';
import { openSharedCalendarSettings } from './shared-calendar.js';

/** `toast`: 短い通知メッセージを画面へ表示する。 */
const toast = (msg, type) => window.AppNav?.showToast(msg, type);
/** `nav`: 指定したハッシュ画面へ移動し、必要なら遷移元の状態を引き継ぐ。 */
const nav = (view) => window.AppNav?.navigate(view);

/** 一般設定、外観、アカウント、同期状態を表示する。 */
export function initSettings(container) {
  renderMainSettings(container);
}

/** AI接続状態と詳細設定だけを表示する設定サブページ。 */
export function initAISettings(container) {
  renderAISettings(container);
  refreshAiRuntimeStatus().then(() => {
    if (container.isConnected) renderAISettings(container);
  }).catch(() => {});
}

/** 一般設定を現在値から描画し、各コントロールの変更イベントを接続する。 */
function renderMainSettings(container) {
  const settings = getSettings();
  const categories = getCategories();
  // テーマはブラックとホワイトの2つだけ(以前の「自動」はブラック/ホワイトのどちらかに置き換え済み)。
  const themeMode = settings.theme === 'light' ? 'light' : 'dark';

  container.innerHTML = `
    <div class="settings-page">
      <div class="settings-section">
        <div class="settings-heading">テーマ</div>
        <div class="theme-choice">
          <button class="theme-choice-btn${themeMode === 'dark' ? ' active' : ''}" data-theme-mode="dark" type="button" aria-pressed="${themeMode === 'dark'}">
            <span class="theme-choice-swatch theme-choice-swatch--dark" aria-hidden="true"><span></span></span>
            ブラック
          </button>
          <button class="theme-choice-btn${themeMode === 'light' ? ' active' : ''}" data-theme-mode="light" type="button" aria-pressed="${themeMode === 'light'}">
            <span class="theme-choice-swatch theme-choice-swatch--light" aria-hidden="true"><span></span></span>
            ホワイト
          </button>
        </div>
      </div>

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

      <div class="settings-section" id="reminder-section">
        ${renderReminderSettings(settings.reminders)}
      </div>

      <div class="settings-section">
        <div class="settings-heading">Calendar Sharing</div>
        <button class="settings-link-card" id="open-shared-calendar-settings-btn">
          <span>
            <strong>共有カレンダー設定</strong>
            <small>共有グループの作成、招待リンク、参加中グループの確認</small>
          </span>
          <span class="settings-link-arrow">›</span>
        </button>
        <p class="text-sm text-muted" style="margin-top:8px">
          共有画面では予定を保存せず、個人カレンダーの共有対象だけをまとめて表示します。
        </p>
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

      <div class="settings-section" id="storage-usage-section">
        ${renderStorageUsage()}
      </div>

      <div class="settings-section" id="main-account-section">
        ${renderAccountSection()}
      </div>

      <div class="settings-section">
        <button class="settings-link-card" id="open-ai-settings-btn">
          <span>
            <strong>AI設定</strong>
            <small>AI、バックアップ、アカウント</small>
          </span>
          <span class="settings-link-arrow">›</span>
        </button>
      </div>
    </div>
  `;

  wireAppearance(container);
  wireReminderSettings(container);
  wireCategories(container);
  wireStorageUsage(container);
  wireAccount(container, { hideWhenSignedIn: false, sectionId: 'main-account-section' });
  container.querySelector('#open-ai-settings-btn')?.addEventListener('click', () => nav('ai-settings'));
  container.querySelector('#open-shared-calendar-settings-btn')?.addEventListener('click', () => {
    openSharedCalendarSettings().catch(e => toast(e?.message || '共有設定を開けませんでした', 'error'));
  });
}

// 通知のタイミングの選択肢(分)。0は「ちょうどの時刻」。
const REMINDER_LEAD_OPTIONS = [0, 5, 10, 15, 30, 60];

/** リマインダー設定欄。オンにした時だけ詳しい選択肢を出す。 */
function renderReminderSettings(value) {
  const reminders = normalizeReminderSettings(value);
  const permission = notificationPermission();
  const permissionNote = permission === 'denied'
    ? '<p class="text-sm reminder-warning">この端末の通知がブロックされています。ブラウザーや端末の設定で通知を許可してください。</p>'
    : permission === 'unsupported'
      ? '<p class="text-sm reminder-warning">この端末・ブラウザーは通知に対応していません。iPhoneではホーム画面に追加したアプリで使えます。</p>'
      : '';
  return `
    <div class="settings-heading">リマインダー</div>
    <label class="reminder-row">
      <input type="checkbox" id="reminder-enabled"${reminders.enabled ? ' checked' : ''}>
      <span>予定とタスクの締切を通知する</span>
    </label>
    <div class="reminder-options"${reminders.enabled ? '' : ' hidden'}>
      <label class="reminder-row">
        <span>通知のタイミング</span>
        <select class="input reminder-lead" id="reminder-lead">
          ${REMINDER_LEAD_OPTIONS.map(minutes => `
            <option value="${minutes}"${minutes === reminders.leadMinutes ? ' selected' : ''}>${minutes ? `${minutes}分前` : 'ちょうどの時刻'}</option>
          `).join('')}
        </select>
      </label>
      <label class="reminder-row">
        <input type="checkbox" id="reminder-tasks"${reminders.includeTasks ? ' checked' : ''}>
        <span>時刻を決めたタスクの締切も通知する</span>
      </label>
      <button class="btn btn-ghost btn-sm" id="reminder-test" type="button">テスト通知を送る</button>
    </div>
    ${permissionNote}
    <p class="text-sm text-muted" style="margin-top:8px">
      この端末だけの設定です。アプリを開いている間（裏に回した直後を含む）に通知し、完全に閉じている間は届きません。
    </p>`;
}

/**
 * リマインダー設定の操作を接続する。オンにする時に通知の許可を求め、
 * 断られたらオフに戻す。変更のたびに通知予定を作り直す。
 */
function wireReminderSettings(container) {
  const section = container.querySelector('#reminder-section');
  /** 今の設定へ変更を重ねて保存し、通知予定を作り直す。 */
  const update = patch => {
    saveSettings({ reminders: { ...normalizeReminderSettings(getSettings().reminders), ...patch } });
    replanReminders();
  };
  section?.querySelector('#reminder-enabled')?.addEventListener('change', async event => {
    const enabled = event.target.checked;
    if (enabled && !(await requestNotificationPermission())) {
      event.target.checked = false;
      toast('通知が許可されなかったため、リマインダーはオフのままです', 'error');
      section.innerHTML = renderReminderSettings(getSettings().reminders);
      wireReminderSettings(container);
      return;
    }
    update({ enabled });
    section.querySelector('.reminder-options').hidden = !enabled;
    toast(enabled ? 'リマインダーをオンにしました' : 'リマインダーをオフにしました', 'success');
  });
  section?.querySelector('#reminder-lead')?.addEventListener('change', event => update({ leadMinutes: Number(event.target.value) }));
  section?.querySelector('#reminder-tasks')?.addEventListener('change', event => update({ includeTasks: event.target.checked }));
  section?.querySelector('#reminder-test')?.addEventListener('click', async () => {
    toast(await sendTestReminder() ? 'テスト通知を送りました' : '通知が許可されていません', 'info');
  });
}

/** AIの利用可否・モデル状態・接続診断を表示する。 */
function renderAISettings(container) {
  const settings = getSettings();
  const pendingQueue = getPendingAIQueue();
  const runtime = getAiRuntime();
  const hasLegacyKey = !!(settings.apiKey || '').trim();
  const serverReady = runtime.configured === true;
  const modelLabel = runtime.models?.quality
    ? runtime.models.quality.replace(/^gemini-/, 'Gemini ').replace(/-/g, ' ')
    : 'Gemini';

  container.innerHTML = `
    <div class="settings-page">
      <div class="settings-section">
        <div class="settings-heading">AI機能の表示</div>
        <div class="ai-toggle-row" style="margin-top:4px">
          <div>
            <label for="ai-enabled-toggle">AI機能を表示する</label>
            <p class="text-sm text-muted" style="margin-top:4px">
              オフにすると、AI入力やAI要約などの操作を非表示にします。
            </p>
          </div>
          <input type="checkbox" id="ai-enabled-toggle" ${settings.aiEnabled === true ? 'checked' : ''}>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-heading">AIプロバイダー</div>
        <div class="analytics-info-box" style="display:flex;flex-direction:column;gap:8px">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <strong>Geminiサーバー</strong>
            <span class="chip">${esc(modelLabel)}</span>
            <span class="chip" style="background:${serverReady ? 'rgba(50,212,154,0.14)' : 'rgba(245,197,66,0.14)'};color:${serverReady ? 'var(--success)' : 'var(--warning)'}">
              ${serverReady ? '接続設定済み' : '未設定'}
            </span>
          </div>
          <p class="text-sm text-muted">
            AI処理はアプリのサーバー経由で実行されます。端末ごとのAPIキー入力は必要ありません。
            Google側の分・日単位の利用枠は生成時に判定され、アプリ独自の回数制限はありません。
          </p>
          <p class="text-sm text-muted">
            出典の自動検索: ${runtime.capabilities?.searchGrounding ? '有効' : '無効（無料枠互換）'}
          </p>
          <p class="text-sm text-muted">
            Geminiは入力した内容をその都度解析します。メモを勝手に学習したり、使うほど自動で成長したりはしません。
            メモ整理では見出し・箇条書き・順序を読み取り、元の情報を増やさずに整形します。
          </p>
          ${hasLegacyKey ? `
            <p class="text-sm text-muted">
              旧ブラウザAIキーがこの端末に残っています。現在は使用されません。
            </p>
          ` : ''}
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-ghost btn-sm" id="refresh-ai-status">状態を更新</button>
            ${hasLegacyKey ? `<button class="btn btn-ghost btn-sm" id="clear-legacy-ai-key">旧キーを削除</button>` : ''}
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-heading">バックアップ</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn btn-ghost" id="export-btn">
            <svg viewBox="0 0 24 24" fill="currentColor" style="width:16px;height:16px"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
            書き出す
          </button>
          <button class="btn btn-ghost" id="import-btn">
            <svg viewBox="0 0 24 24" fill="currentColor" style="width:16px;height:16px"><path d="M19 15v4H5v-4H3v4c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-4h-2zM13 9l-1-1V3h-2v5L9 9 7 7l5 5 5-5-2 2z"/></svg>
            読み込む
          </button>
        </div>
        <p class="text-sm text-muted" style="margin-top:8px">
          バックアップにサーバー側のAIキーは含まれません。
        </p>
        <input type="file" id="import-file" accept=".json" class="hidden">
        <button class="btn btn-ghost btn-sm" id="clear-ai-cache" style="margin-top:8px">AIキャッシュを消去</button>
      </div>

      ${pendingQueue.length ? `
        <div class="settings-section">
          <div class="settings-heading">未処理のAI整理</div>
          <div class="batch-queue-status">
            <span>待機中: <strong>${pendingQueue.length}</strong>件</span>
            <div style="display:flex;gap:8px">
              <button class="btn btn-primary btn-sm" id="run-batch-now-btn">今すぐ実行</button>
              <button class="btn btn-ghost btn-sm" id="clear-queue-btn">待機を消去</button>
            </div>
          </div>
        </div>
      ` : ''}

      <div class="settings-section" id="ai-account-section">
        ${renderAccountSection()}
      </div>
    </div>
  `;

  wireAISettings(container);
  wireBackup(container);
  wireAccount(container, { hideWhenSignedIn: false, sectionId: 'ai-account-section' });
}

/** 端末内の保存容量と内訳を、読み取りだけで集計して表示する。 */
function renderStorageUsage() {
  const usage = measureLocalStorage();
  const indexedDbActive = getLocalStoreMode() === 'indexeddb';
  const moved = indexedDbActive ? measureEntries(getManagedEntries()) : null;
  let knowledge = [];
  try {
    knowledge = measureKnowledgeRecords(JSON.parse(localStore.getItem('mp_knowledge') || '[]'), classifyKnowledgeRecord);
  } catch {
    knowledge = [];
  }
  const percent = Math.min(100, Math.round(usage.ratio * 100));
  const level = percent >= 85 ? 'danger' : percent >= 65 ? 'warning' : 'ok';
  /** `row`: 種類名・補足・文字数を一行の内訳表示にする。 */
  const row = (label, chars, detail = '') => `
    <div class="storage-usage-row">
      <span>${esc(label)}${detail ? `<small>${esc(detail)}</small>` : ''}</span>
      <strong>${esc(formatCharCount(chars))}</strong>
    </div>`;
  return `
    <div class="settings-heading">端末の保存容量</div>
    <div class="storage-usage-card storage-usage-card--${level}">
      <div class="storage-usage-summary">
        <strong>${percent}%</strong>
        <span>小容量領域 ${esc(formatCharCount(usage.totalChars))} / 約${esc(formatCharCount(usage.limitChars))}</span>
      </div>
      <div class="storage-usage-bar" role="progressbar" aria-label="小容量領域の使用率" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
        <span style="width:${percent}%"></span>
      </div>
      <div class="storage-usage-list">
        ${usage.groups.map(group => row(group.label, group.chars)).join('')}
      </div>
      ${moved ? `
        <p class="text-sm"><strong>大容量領域（IndexedDB）</strong> ${esc(formatCharCount(moved.totalChars))}・端末の空き容量まで使えます</p>
        <div class="storage-usage-list">
          ${moved.groups.map(group => row(group.label, group.chars)).join('')}
        </div>
      ` : '<p class="text-sm text-muted">この端末では大容量領域を使えないため、すべて小容量領域に保存しています。</p>'}
      ${knowledge.length ? `
        <details class="storage-usage-details">
          <summary>メモ・表現帳・Knowledgeの内訳</summary>
          <div class="storage-usage-list">
            ${knowledge.map(item => row(item.label, item.chars, `${item.count}件`)).join('')}
          </div>
        </details>
      ` : ''}
      <p class="text-sm text-muted" id="storage-usage-browser"></p>
      <p class="text-sm text-muted">上限はブラウザーにより異なる目安です。満杯になると新しい保存や同期の取り込みができなくなります。</p>
      <button class="btn btn-ghost btn-sm" id="storage-usage-refresh" type="button">再計算</button>
    </div>
  `;
}

/** 再計算ボタンと、ブラウザー全体（画像キャッシュ等を含む）の使用量表示を接続する。 */
function wireStorageUsage(container) {
  const section = container.querySelector('#storage-usage-section');
  if (!section) return;
  section.querySelector('#storage-usage-refresh')?.addEventListener('click', () => {
    section.innerHTML = renderStorageUsage();
    wireStorageUsage(container);
  });
  const note = section.querySelector('#storage-usage-browser');
  if (!note || !navigator.storage?.estimate) return;
  Promise.all([
    navigator.storage.estimate(),
    navigator.storage.persisted?.() ?? Promise.resolve(null),
  ]).then(([estimate, persisted]) => {
    if (!note.isConnected) return;
    const usedMb = (Number(estimate?.usage) || 0) / 1024 / 1024;
    const quotaMb = (Number(estimate?.quota) || 0) / 1024 / 1024;
    const persistence = persisted === true ? '保護あり' : persisted === false ? '自動削除の対象になりうる' : '不明';
    note.textContent = `ブラウザー全体（画像キャッシュ等を含む）: ${usedMb.toFixed(1)}MB / ${quotaMb >= 1024 ? `${(quotaMb / 1024).toFixed(1)}GB` : `${quotaMb.toFixed(0)}MB`}・保存の保護: ${persistence}`;
  }).catch(() => {});
}

/** 予定カテゴリ一件を、色・名前の編集と削除ができる設定行へ変換する。 */
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

/** ログイン状態に応じて、認証または同期管理のUIを返す。 */
function renderAccountSection() {
  const syncStatus = getSyncStatus();
  return `
    <div class="settings-heading">アカウント</div>
    <div id="sb-auth-area">
      <div id="sb-status" class="text-sm text-muted" style="margin-bottom:10px">確認中...</div>
      <div id="sb-sync-status" class="text-sm text-muted" style="margin-bottom:10px">
        ${renderSyncStatus(syncStatus)}
      </div>

      <div id="sb-signin-wrap">
        <div class="form-group">
          <label class="form-label">メールアドレス</label>
          <input class="input" id="sb-email-input" type="email"
            placeholder="you@example.com" autocomplete="email">
        </div>
        <button class="btn btn-primary btn-sm" id="sb-signin-btn">ログインメールを送信</button>
        <p id="sb-signin-error" class="text-sm hidden" role="alert" style="color:var(--danger);margin-top:8px"></p>
        <p class="text-sm text-muted" style="margin-top:6px">
          届いたメールの「Sign in」を開くとログインできます。パスワードは不要です。
        </p>

        <details id="sb-otp-wrap" class="hidden" style="margin-top:16px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:14px">
          <summary class="text-sm">コードでログイン（メールに記載がある場合）</summary>
          <input class="input" id="sb-otp-input" type="text" inputmode="numeric"
            pattern="[0-9]*" maxlength="8" placeholder="12345678"
            style="margin-top:10px;font-size:24px;letter-spacing:4px;text-align:center;font-weight:700">
          <button class="btn btn-primary btn-sm btn-full" id="sb-otp-verify-btn" style="margin-top:10px">ログイン</button>
          <button class="btn btn-ghost btn-sm btn-full" id="sb-resend-btn" style="margin-top:6px">メールを再送</button>
        </details>
      </div>

      <div id="sb-loggedin-wrap" class="hidden">
        <div id="sb-migrate-area" class="hidden" style="margin-bottom:12px">
          <p class="text-sm" style="margin-bottom:8px">
            この端末のデータをクラウドへ同期します。端末内のデータは削除されません。
          </p>
          <button class="btn btn-primary btn-sm" id="sb-migrate-btn">端末データをクラウドへ同期</button>
          <div id="sb-migrate-progress" class="hidden text-sm text-muted" style="margin-top:6px"></div>
        </div>
        <button class="btn btn-primary btn-sm" id="sb-sync-now-btn">今すぐ同期</button>
        <button class="btn btn-ghost btn-sm" id="sb-signout-btn">ログアウト</button>
      </div>
    </div>
  `;
}

/** 内部同期状態を、利用者が判断できる短い表示へ変換する。 */
function renderSyncStatus(status) {
  const lastPush = status.lastPushAt ? formatSyncTime(status.lastPushAt) : 'まだありません';
  const lastPull = status.lastPullAt ? formatSyncTime(status.lastPullAt) : 'まだありません';
  const error = status.lastErrorAt
    ? `<br><span style="color:var(--danger)">最終エラー (${esc(status.lastErrorTable || '同期')}): ${esc(status.lastErrorMessage || '')}</span>`
    : '';
  return `最終送信: ${esc(lastPush)} / 最終取得: ${esc(lastPull)}${error}`;
}

/** 同期日時を端末ロケールの短い日時へ変換し、未同期なら案内文を返す。 */
function formatSyncTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || '');
  return date.toLocaleString();
}

/** テーマ(ブラック/ホワイト)と自分の予定の色の入力を、保存とその場の反映へ接続する。 */
function wireAppearance(container) {
  container.querySelector('#my-schedule-color-input')?.addEventListener('input', e => {
    const color = e.target.value || '#60A5FA';
    saveSettings({ myScheduleColor: color });
    const preview = container.querySelector('.my-schedule-color-preview');
    if (preview) preview.style.setProperty('--schedule-color', color);
  });

  container.querySelectorAll('[data-theme-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.themeMode === 'light' ? 'light' : 'dark';
      saveSettings({ theme: mode });
      window.AppTheme?.apply(mode);
      container.querySelectorAll('[data-theme-mode]').forEach(other => {
        const active = other.dataset.themeMode === mode;
        other.classList.toggle('active', active);
        other.setAttribute('aria-pressed', String(active));
      });
    });
  });
}

/** 予定カテゴリの追加・名称変更・色変更・削除をまとめて保存処理へ接続する。 */
function wireCategories(container) {
  /** 設定画面の全カテゴリ行を読み直し、名前と色をまとめて保存する。 */
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

/** AI有効化、処理モード、実行時刻、キュー操作を設定保存と状態表示へ接続する。 */
function wireAISettings(container) {
  container.querySelector('#ai-enabled-toggle')?.addEventListener('change', e => {
    saveSettings({ aiEnabled: e.target.checked, aiVisibilityConfigured: true });
    toast(e.target.checked ? 'AI機能を表示しました' : 'AI機能を非表示にしました', 'info');
  });

  container.querySelector('#refresh-ai-status')?.addEventListener('click', async () => {
    try {
      await refreshAiRuntimeStatus({ force: true });
      renderAISettings(container);
      toast('AIの状態を更新しました', 'success');
    } catch (e) {
      toast('AIの状態を更新できませんでした: ' + e.message, 'error');
    }
  });

  container.querySelector('#clear-legacy-ai-key')?.addEventListener('click', () => {
    saveSettings({ apiKey: '' });
    renderAISettings(container);
    toast('旧ブラウザAIキーを削除しました', 'info');
  });

  container.querySelector('#clear-ai-cache')?.addEventListener('click', () => {
    clearAiCache();
    toast('AIキャッシュを消去しました', 'info');
  });

  container.querySelector('#run-batch-now-btn')?.addEventListener('click', async () => {
    const btn = container.querySelector('#run-batch-now-btn');
    if (!btn) return;
    btn.innerHTML = '<span class="ai-spinner"></span> 処理中...';
    btn.disabled = true;
    try {
      const result = await processBatchQueue();
      toast(`AI一括処理が完了しました: ${result.processed}件`, 'success');
      renderAISettings(container);
    } catch (e) {
      toast('AI一括処理エラー: ' + e.message, 'error');
      btn.disabled = false;
      btn.textContent = '今すぐ実行';
    }
  });

  container.querySelector('#clear-queue-btn')?.addEventListener('click', () => {
    clearPendingAIQueue();
    toast('待機中のAI処理を消去しました', 'info');
    renderAISettings(container);
  });
}

/** 全データのJSON書き出しと、既存データを消さないマージ取込を各ボタンへ接続する。 */
function wireBackup(container) {
  container.querySelector('#export-btn')?.addEventListener('click', () => {
    // ホームのお知らせと同じ処理で書き出し、書き出した日も記録する(backup-reminder.js)。
    downloadBackup();
    toast('バックアップを書き出しました', 'success');
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
        toast('バックアップを読み込みました。再読み込みします...', 'success');
        setTimeout(() => location.reload(), 1500);
      } catch (err) {
        toast('読み込みエラー: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
  });
}

/** メールログイン、コード確認、ログアウト、初回クラウド移行をアカウント欄へ接続する。 */
function wireAccount(container, options = {}) {
  container.querySelector('#sb-sync-now-btn')?.addEventListener('click', async () => {
    const btn = container.querySelector('#sb-sync-now-btn');
    const status = container.querySelector('#sb-sync-status');
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = '同期中...';
    if (status) status.textContent = 'この端末の変更を送信し、クラウドの最新データを取得しています...';
    try {
      const pushed = await flushPendingSync();
      if (pushed.attempted > pushed.succeeded) throw new Error('一部の変更を送信できませんでした');
      await pullAll(true);
      const syncStatus = getSyncStatus();
      if (syncStatus.lastErrorAt) throw new Error(syncStatus.lastErrorMessage || '一部のデータを取得できませんでした');
      await startRealtimeSync();
      if (status) status.innerHTML = renderSyncStatus(syncStatus);
      window.AppNav?.refreshCurrentView?.({ preserveScroll: true });
      toast('最新のデータに同期しました', 'success');
    } catch (e) {
      if (status) status.innerHTML = renderSyncStatus(getSyncStatus());
      toast('同期エラー: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '今すぐ同期';
    }
  });

  container.querySelector('#sb-signin-btn')?.addEventListener('click', async () => {
    const email = container.querySelector('#sb-email-input')?.value.trim();
    const errorMessage = container.querySelector('#sb-signin-error');
    if (!email) {
      if (errorMessage) {
        errorMessage.textContent = 'メールアドレスを入力してください。';
        errorMessage.classList.remove('hidden');
      }
      return;
    }
    const btn = container.querySelector('#sb-signin-btn');
    errorMessage?.classList.add('hidden');
    btn.disabled = true;
    btn.textContent = '送信中...';
    let sent = false;
    try {
      await signInWithEmail(email);
      sent = true;
      container.querySelector('#sb-otp-wrap')?.classList.remove('hidden');
      toast('ログインメールを送信しました。メール内のリンクを開いてください', 'success');
    } catch (e) {
      if (errorMessage) {
        errorMessage.textContent = getAuthSendErrorMessage(e);
        errorMessage.classList.remove('hidden');
      }
    } finally {
      btn.disabled = false;
      btn.textContent = sent ? 'ログインメールを再送' : 'ログインメールを送信';
    }
  });

  container.querySelector('#sb-otp-verify-btn')?.addEventListener('click', async () => {
    const email = container.querySelector('#sb-email-input')?.value.trim();
    const code = container.querySelector('#sb-otp-input')?.value.trim();
    if (!email) {
      toast('メールアドレスを入力してください', 'error');
      return;
    }
    if (!code || code.length < 6) {
      toast('ログインコードを入力してください', 'error');
      return;
    }
    const btn = container.querySelector('#sb-otp-verify-btn');
    btn.disabled = true;
    btn.textContent = 'ログイン中...';
    try {
      const session = await verifyEmailOtp(email, code);
      if (!session) throw new Error('ログインセッションを作成できませんでした');
      const nextUserId = session.user?.id || null;
      const previousUserId = getActiveUserId();
      if (previousUserId && nextUserId && previousUserId !== nextUserId) {
        if (!await preserveUserContentSnapshot(previousUserId)) {
          throw new Error('端末内データを退避できなかったため、アカウント切替を中止しました');
        }
        setActiveUserId(null);
        await resetSyncForUserSwitch();
        clearUserContentLocal();
        const restored = await restoreUserContentSnapshot(nextUserId);
        if (restored === false) {
          clearUserContentLocal();
          await restoreUserContentSnapshot(previousUserId);
          setActiveUserId(previousUserId);
          throw new Error('保存済みの端末データを復元できなかったため、アカウント切替を中止しました');
        }
        setActiveUserId(nextUserId);
      } else {
        const restored = nextUserId && !hasUserContentLocal()
          ? await restoreUserContentSnapshot(nextUserId)
          : null;
        if (restored === false) {
          throw new Error('保存済みの端末データを復元できなかったため、ログインを中止しました');
        }
        setActiveUserId(nextUserId);
      }
      toast('ログインしました', 'success');
      const alreadyMigrated = await isMigratedForCurrentUser();
      await pullAll(alreadyMigrated);
      if (!alreadyMigrated) {
        btn.textContent = '同期中…';
        try {
          await migrateToSupabase(() => {});
          await pullAll(true);
          toast('同期が完了しました', 'success');
        } catch (e) {
          console.warn('[Sync] auto-migrate failed:', e);
          toast('同期に失敗しました。AI設定の「端末データをクラウドへ同期」から再実行してください', 'error');
        }
      }
      await startRealtimeSync();
      const inviteResult = await consumePendingSharedInvite().catch(e => {
        toast('共有招待の参加に失敗しました: ' + e.message, 'error');
        return null;
      });
      if (inviteResult && !inviteResult.pendingLogin) {
        toast('共有グループに参加しました', 'success');
      }
      window.AppNav?.refreshCurrentView?.({ preserveScroll: true });
    } catch (e) {
      toast('ログインエラー: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'ログイン';
    }
    // refreshAccountStatus は認証エラーと無関係なので外側 try-catch の外で実行
    try {
      await refreshAccountStatus(container, options);
    } catch (e) {
      console.warn('[Account] refreshAccountStatus failed:', e);
    }
  });

  container.querySelector('#sb-otp-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') container.querySelector('#sb-otp-verify-btn')?.click();
  });

  container.querySelector('#sb-resend-btn')?.addEventListener('click', () => {
    container.querySelector('#sb-signin-btn')?.click();
  });

  container.querySelector('#sb-signout-btn')?.addEventListener('click', async () => {
    const activeUserId = getActiveUserId();
    const readyToSignOut = await resetSyncForUserSwitch({ flush: true });
    if (!readyToSignOut) {
      toast('未同期の変更があります。通信を確認して「今すぐ同期」してからログアウトしてください。', 'error');
      return;
    }
    if (activeUserId && !await preserveUserContentSnapshot(activeUserId)) {
      toast('端末内データを安全に退避できなかったため、ログアウトを中止しました。', 'error');
      return;
    }
    try {
      await signOut();
    } catch (error) {
      toast(`ログアウトできませんでした: ${error?.message || '通信を確認してください。'}`, 'error');
      return;
    }
    clearUserContentLocal();
    toast('ログアウトしました', 'info');
    await refreshAccountStatus(container, options);
    window.AppNav?.refreshCurrentView?.({ preserveScroll: true });
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
      toast('端末データをクラウドへ同期しました', 'success');
      if (progress) progress.textContent = '完了しました';
      container.querySelector('#sb-migrate-area')?.classList.add('hidden');
    } catch (e) {
      toast('同期エラー: ' + e.message, 'error');
      if (progress) progress.textContent = 'エラー: ' + e.message;
      btn.disabled = false;
    }
  });

  refreshAccountStatus(container, options);
}

/** Supabaseセッションを確認し、ログイン・ログアウト・移行案内の表示を切り替える。 */
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
        statusEl.innerHTML = `<span style="color:var(--success)">ログイン中</span>: ${esc(email || session.user.id)}`;
      }
      signinWrap?.classList.add('hidden');
      loggedinWrap?.classList.remove('hidden');
      if (!await isMigratedForCurrentUser()) migrateArea?.classList.remove('hidden');
      else migrateArea?.classList.add('hidden');
    } else {
      if (section) section.classList.remove('hidden');
      if (statusEl) statusEl.textContent = 'ログインしていません';
      signinWrap?.classList.remove('hidden');
      loggedinWrap?.classList.add('hidden');
    }
  } catch {
    if (section) section.classList.remove('hidden');
    if (statusEl) statusEl.textContent = 'ログイン状態を確認できませんでした';
    signinWrap?.classList.remove('hidden');
    loggedinWrap?.classList.add('hidden');
  }
}
