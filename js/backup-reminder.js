// ============================================================
// backup-reminder.js - バックアップの書き出しと、30日ごとのお知らせ
//
// Supabaseの無料プランには「過去の時点へ戻す」機能がないため、同期の不具合や操作ミスに
// 備えて、手元へ全データを書き出しておく。最後に書き出してから30日たったら、ホームに
// 小さなお知らせを出す。「あとで」を押すと7日間は出さない。記録は端末ごと(同期しない)。
// ============================================================
import { exportBackup, getSettings, saveSettings } from './storage.js';

const DAY_MS = 86_400_000;
const DUE_AFTER_DAYS = 30;
const SNOOZE_DAYS = 7;

/**
 * お知らせを出すべきか判定する(画面に触れない計算)。
 * 一度も書き出していない端末は、使い始めてから30日後を最初の期限にする
 * (入れたばかりの端末でいきなり出さないため)。
 */
export function isBackupDue(settings, now = Date.now()) {
  const since = Number(settings?.backupReminderSince) || now;
  const last = Number(settings?.lastBackupAt) || since;
  const snoozedUntil = Number(settings?.backupSnoozedUntil) || 0;
  return now - last >= DUE_AFTER_DAYS * DAY_MS && now >= snoozedUntil;
}

/** 使い始めた日を初回だけ記録し、お知らせを出すべきかを返す。ホームの描画時に呼ぶ。 */
export function checkBackupDue(now = Date.now()) {
  const settings = getSettings();
  if (!settings.backupReminderSince) saveSettings({ backupReminderSince: now });
  return isBackupDue({ ...settings, backupReminderSince: settings.backupReminderSince || now }, now);
}

/** 全データをJSONファイルとして書き出し、書き出した日時を記録する。 */
export function downloadBackup() {
  const json = exportBackup();
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `my-planner-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  saveSettings({ lastBackupAt: Date.now(), backupSnoozedUntil: 0 });
}

/** 「あとで」: 7日間はお知らせを出さない。 */
export function snoozeBackupReminder(now = Date.now()) {
  saveSettings({ backupSnoozedUntil: now + SNOOZE_DAYS * DAY_MS });
}
