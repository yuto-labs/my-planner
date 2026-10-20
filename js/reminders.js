// ============================================================
// reminders.js - 予定とタスク締切のリマインダー通知
//
// 既定はオフ。設定で有効にした端末だけ、通知の許可をもらってから動く。
// 予定は開始の○分前、タスクは締切(日時が決まっているもの)の○分前に通知する。
//
// 仕組み: 次の24時間ぶんの通知時刻を計算してタイマーを置く。アプリが前面に戻った時は、
// 直近10分以内に鳴るはずだった分(端末が止めていた分)をまとめて出す。
// 送った通知は記録して、タブの重複や再読み込みで二重に鳴らさない。
// サーバーからのプッシュは使わないため、アプリを完全に閉じている間は届かない。
// ============================================================

const FIRED_KEY = 'mp_reminders_fired';
const FIRED_KEEP = 300;
const HORIZON_MS = 24 * 3_600_000;
const CATCH_UP_MS = 10 * 60_000;
const REPLAN_MS = 15 * 60_000;

export const DEFAULT_REMINDER_SETTINGS = Object.freeze({
  enabled: false,
  leadMinutes: 10,
  includeTasks: true,
});

/** 保存済みの設定に既定値を補う。不正な分数は既定の10分に戻す。 */
export function normalizeReminderSettings(value) {
  const merged = { ...DEFAULT_REMINDER_SETTINGS, ...(value || {}) };
  const lead = Number(merged.leadMinutes);
  return {
    enabled: merged.enabled === true,
    leadMinutes: Number.isFinite(lead) && lead >= 0 && lead <= 1440 ? lead : DEFAULT_REMINDER_SETTINGS.leadMinutes,
    includeTasks: merged.includeTasks !== false,
  };
}

/** タスクの締切日(YYYY-MM-DD)と時刻(HH:MM)を、端末の時刻での日時にする。時刻なしはnull。 */
function taskDueTime(task) {
  if (!task?.dueDate || !task?.dueTime) return null;
  const time = new Date(`${task.dueDate}T${task.dueTime}`);
  return Number.isFinite(time.getTime()) ? time.getTime() : null;
}

/** 「開始まで○分」の表示文。0分前なら「開始時刻です」。 */
function leadText(minutes, startWord) {
  return minutes > 0 ? `${minutes}分後に${startWord}` : `${startWord}時刻です`;
}

/**
 * 次に鳴らすべき通知の一覧を作る(画面や通知APIに触れない純粋な計算)。
 * from〜to の間に鳴る分だけを、鳴る時刻順で返す。key は二重通知を防ぐ識別子。
 */
export function planReminders({ events = [], tasks = [], settings, from, to }) {
  const { leadMinutes, includeTasks } = normalizeReminderSettings(settings);
  const leadMs = leadMinutes * 60_000;
  const items = [];
  events.forEach(event => {
    const start = new Date(event?.start || '').getTime();
    if (!Number.isFinite(start)) return;
    items.push({
      key: `event:${event.id}:${start}`,
      fireAt: start - leadMs,
      title: event.title || '予定',
      body: leadText(leadMinutes, '開始'),
      view: 'calendar',
    });
  });
  if (includeTasks) {
    tasks.forEach(task => {
      const due = taskDueTime(task);
      if (due === null || task.completed || task.abandoned) return;
      items.push({
        key: `task:${task.id}:${due}`,
        fireAt: due - leadMs,
        title: task.title || 'タスク',
        body: leadText(leadMinutes, '締切'),
        view: 'tasks',
      });
    });
  }
  return items
    .filter(item => item.fireAt >= from && item.fireAt <= to)
    .sort((a, b) => a.fireAt - b.fireAt);
}

/** 送信済みの通知キーを読む。 */
function readFired(storage) {
  try {
    const list = JSON.parse(storage.getItem(FIRED_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/**
 * まだ送っていない通知なら送信済みとして記録し、trueを返す。
 * 先に記録してから通知するので、同時に動いている別タブとの二重通知も起きにくい。
 */
export function claimReminder(key, storage = globalThis.localStorage) {
  const fired = readFired(storage);
  if (fired.includes(key)) return false;
  try { storage.setItem(FIRED_KEY, JSON.stringify([...fired, key].slice(-FIRED_KEEP))); } catch {}
  return true;
}

/** 通知を表示する。Service Worker経由ならスマホのホーム画面アプリでも出せる。 */
async function showNotification(item) {
  const options = { body: item.body, tag: item.key, data: { view: item.view }, icon: './icon-192.png' };
  const registration = await navigator.serviceWorker?.getRegistration?.().catch(() => null);
  if (registration?.showNotification) return registration.showNotification(item.title, options);
  if (typeof Notification === 'function') new Notification(item.title, options);
}

/** 通知が使える端末で、許可されているか。 */
export function notificationPermission() {
  return typeof Notification === 'function' ? Notification.permission : 'unsupported';
}

/** 通知の許可を求める。許可されたらtrue。 */
export async function requestNotificationPermission() {
  if (typeof Notification !== 'function') return false;
  if (Notification.permission === 'granted') return true;
  return (await Notification.requestPermission()) === 'granted';
}

let timers = [];
let replanTimer = null;
let getSource = null;

/** 置いてあるタイマーを全部止める。 */
function clearTimers() {
  timers.forEach(clearTimeout);
  timers = [];
  clearTimeout(replanTimer);
  replanTimer = null;
}

/** 鳴らす時刻になった通知を、二重にならないよう確認してから表示する。 */
function fire(item) {
  if (!claimReminder(item.key)) return;
  showNotification(item).catch(error => console.warn('[Reminders] notification failed:', error));
}

/**
 * 通知予定を作り直す。設定がオフ・許可なしなら何も置かない。
 * 直近10分以内に鳴るはずだった分はすぐ出し、24時間以内の分はタイマーを置く。
 */
export function replanReminders() {
  clearTimers();
  if (!getSource) return;
  const { events, tasks, settings } = getSource();
  if (!normalizeReminderSettings(settings).enabled || notificationPermission() !== 'granted') return;
  const now = Date.now();
  planReminders({ events, tasks, settings, from: now - CATCH_UP_MS, to: now + HORIZON_MS }).forEach(item => {
    if (item.fireAt <= now) fire(item);
    else timers.push(setTimeout(() => fire(item), item.fireAt - now));
  });
  // 新しく追加された予定も拾えるよう、一定間隔でも作り直す。
  replanTimer = setTimeout(replanReminders, REPLAN_MS);
}

/**
 * 起動時に一度呼ぶ。source は { events, tasks, settings } を返す関数。
 * 画面が前面に戻った時とデータが同期された時にも作り直す。
 */
export function startReminders(source) {
  getSource = source;
  document.addEventListener('visibilitychange', () => { if (!document.hidden) replanReminders(); });
  document.addEventListener('sync:remote-change', replanReminders);
  // 予定やタスクを追加・編集した後は画面を移ることが多いので、その時にも作り直す。
  document.addEventListener('appNavigated', replanReminders);
  // 通知を押した時にService Workerから届く「この画面を開いて」に応える。
  navigator.serviceWorker?.addEventListener?.('message', event => {
    if (event.data?.type === 'reminder-open') window.AppNav?.navigate(event.data.view || 'home');
  });
  replanReminders();
}

/** 設定画面の「テスト通知」。設定や許可が正しいかをその場で確かめる。 */
export async function sendTestReminder() {
  if (!(await requestNotificationPermission())) return false;
  await showNotification({ key: `test:${Date.now()}`, title: 'My Planner', body: 'リマインダーの通知テストです', view: 'home' });
  return true;
}
