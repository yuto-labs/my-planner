// ============================================================
// local-store.js - 大きい端末データをIndexedDBへ置く同期型の保存窓口
//
// localStorageは約500万文字で満杯になるため、増え続けるデータだけをIndexedDBへ移す。
// 画面や同期処理は今までどおり同期的に読み書きできるよう、起動時に全件をメモリへ
// 読み込み、書き込みはメモリへ即反映してからIndexedDBへ保存する。
// 対象外のキーと、IndexedDBを使えない環境では従来どおりlocalStorageをそのまま使う。
// ============================================================

// IndexedDBへ移す、増え続ける大きなデータだけを対象にする。
export const MANAGED_KEYS = Object.freeze([
  'mp_knowledge',
  'mp_trash',
  'mp_task_archive',
  'mp_events',
]);
const MANAGED = new Set(MANAGED_KEYS);
const DB_NAME = 'my-planner-local-store';
const STORE_NAME = 'kv';
const CHANNEL_NAME = 'my-planner-local-store';
const RETRY_MS = 1500;

let mode = 'localStorage';
let backend = null;
let channel = null;
let flushPromise = null;
let retryTimer = null;
let lastStamp = 0;
const cache = new Map();
const pending = new Map();
const tabId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** 呼び出し時点のlocalStorageを返す。テストで差し替えた偽物も使えるよう毎回参照する。 */
function legacyStorage() {
  return globalThis.localStorage;
}

/** 同じタブ内で必ず増える書き込み時刻を作る。古い書き込みが新しい内容を上書きしないために使う。 */
function nextStamp() {
  lastStamp = Math.max(Date.now() * 1000, lastStamp + 1);
  return lastStamp;
}

/** IndexedDBへ移したキーか判定する。 */
export function isManagedKey(key) {
  return MANAGED.has(key);
}

/** 現在どちらの保存先を使っているかを返す。設定画面と診断用。 */
export function getLocalStoreMode() {
  return mode;
}

/** 保存失敗を、既存の保存エラー通知と同じ形で画面へ知らせる。 */
function reportWriteError(key) {
  try {
    document.dispatchEvent(new CustomEvent('storage:write-error', { detail: { key, reason: 'indexeddb' } }));
  } catch {}
}

/** 書き込み待ちを一度にIndexedDBへ送り、失敗した分は内容を保持したまま再試行する。 */
async function runFlush() {
  while (pending.size && backend) {
    const batch = [...pending.entries()];
    pending.clear();
    try {
      await backend.putMany(batch);
      batch.forEach(([key, record]) => {
        try { channel?.postMessage({ key, value: record.value, stamp: record.stamp, tabId }); } catch {}
      });
    } catch (error) {
      console.warn('[LocalStore] IndexedDB write failed; retrying:', error);
      batch.forEach(([key, record]) => { if (!pending.has(key)) pending.set(key, record); });
      batch.forEach(([key]) => reportWriteError(key));
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        scheduleFlush();
      }, RETRY_MS);
      break;
    }
  }
}

/** 書き込み待ちがあれば、今の処理の直後にまとめて保存する。 */
function scheduleFlush() {
  if (flushPromise || !pending.size || retryTimer) return flushPromise;
  flushPromise = Promise.resolve()
    .then(runFlush)
    .finally(() => {
      flushPromise = null;
      // 保存処理の終わり際に入った書き込みも取りこぼさない。
      if (pending.size && !retryTimer) scheduleFlush();
    });
  return flushPromise;
}

/** 書き込み待ちをすべてIndexedDBへ送り終えるまで待つ。画面を離れる前などに使う。 */
export async function flushLocalStore() {
  while (pending.size && backend && !retryTimer) {
    await (scheduleFlush() || Promise.resolve());
  }
  if (flushPromise) await flushPromise;
}

/** 他のタブが保存した、より新しい内容だけをメモリへ反映する。 */
function receiveFromOtherTab(message) {
  if (!message || message.tabId === tabId || !MANAGED.has(message.key)) return;
  const current = cache.get(message.key);
  if (current && current.stamp >= message.stamp) return;
  cache.set(message.key, { value: message.value ?? null, stamp: message.stamp });
}

export const localStore = {
  /** localStorage.getItemと同じく文字列またはnullを返す。 */
  getItem(key) {
    if (mode === 'indexeddb' && MANAGED.has(key)) return cache.get(key)?.value ?? null;
    return legacyStorage().getItem(key);
  },
  /** localStorage.setItemと同じ形で保存する。IndexedDB対象はメモリへ即反映して保存を予約する。 */
  setItem(key, value) {
    if (mode === 'indexeddb' && MANAGED.has(key)) {
      const record = { value: String(value), stamp: nextStamp() };
      cache.set(key, record);
      pending.set(key, record);
      scheduleFlush();
      return;
    }
    legacyStorage().setItem(key, value);
  },
  /** localStorage.removeItemと同じく値を消す。 */
  removeItem(key) {
    if (mode === 'indexeddb' && MANAGED.has(key)) {
      const record = { value: null, stamp: nextStamp() };
      cache.set(key, record);
      pending.set(key, record);
      scheduleFlush();
      return;
    }
    legacyStorage().removeItem(key);
  },
};

/** 設定画面の容量表示用に、IndexedDBへ移したデータの文字数を返す。 */
export function getManagedEntries() {
  if (mode !== 'indexeddb') return [];
  return MANAGED_KEYS
    .map(key => [key, cache.get(key)?.value ?? null])
    .filter(([, value]) => value !== null);
}

/** IndexedDBを開き、キーと値をまとめて読み書きする最小限の窓口を作る。 */
export function createIndexedDbBackend(indexedDBImpl = globalThis.indexedDB) {
  if (!indexedDBImpl) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDBImpl.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      resolve({
        /** 指定キーの記録をまとめて読む。 */
        getMany(keys) {
          return new Promise((done, fail) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const result = {};
            keys.forEach(key => {
              const get = store.get(key);
              get.onsuccess = () => { if (get.result) result[key] = get.result; };
            });
            tx.oncomplete = () => done(result);
            tx.onerror = () => fail(tx.error);
            tx.onabort = () => fail(tx.error);
          });
        },
        /**
         * 複数キーを一つの処理で保存する。forceでなければ、既に新しい時刻の内容がある
         * キーは書き換えない。値nullは削除を表す。
         */
        putMany(entries, { force = false } = {}) {
          return new Promise((done, fail) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            entries.forEach(([key, record]) => {
              const get = store.get(key);
              get.onsuccess = () => {
                const existing = get.result;
                if (!force && existing && Number(existing.stamp) > Number(record.stamp)) return;
                if (record.value === null) store.delete(key);
                else store.put({ value: record.value, stamp: record.stamp }, key);
              };
            });
            tx.oncomplete = () => done();
            tx.onerror = () => fail(tx.error);
            tx.onabort = () => fail(tx.error);
          });
        },
      });
    };
  });
}

/**
 * 起動時に一度だけ呼ぶ。IndexedDBの内容をメモリへ読み込み、localStorageに残る
 * 旧データは書き込みと読み戻し確認が成功してから消す。どこかで失敗した場合は
 * 何も消さず従来のlocalStorage方式のまま動かす。
 */
export async function initLocalStore({
  backendFactory = createIndexedDbBackend,
  channelFactory = () => (typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME)),
} = {}) {
  if (mode === 'indexeddb') return true;
  let nextBackend = null;
  let records = {};
  try {
    nextBackend = await backendFactory();
    if (!nextBackend) return false;
    records = await nextBackend.getMany(MANAGED_KEYS);
    const storage = legacyStorage();
    for (const key of MANAGED_KEYS) {
      const legacy = storage.getItem(key);
      if (legacy === null) continue;
      const record = { value: legacy, stamp: nextStamp() };
      await nextBackend.putMany([[key, record]], { force: true });
      const verified = (await nextBackend.getMany([key]))[key];
      if (verified?.value !== legacy) throw new Error(`Could not verify ${key} in IndexedDB`);
      records[key] = verified;
    }
  } catch (error) {
    console.warn('[LocalStore] staying on localStorage:', error);
    return false;
  }

  MANAGED_KEYS.forEach(key => {
    const record = records[key];
    cache.set(key, { value: record?.value ?? null, stamp: Number(record?.stamp) || 0 });
    lastStamp = Math.max(lastStamp, Number(record?.stamp) || 0);
  });
  backend = nextBackend;
  mode = 'indexeddb';

  // 読み込みと確認が終わった後で、移し終えた旧データだけを消す。
  const storage = legacyStorage();
  MANAGED_KEYS.forEach(key => {
    try {
      if (storage.getItem(key) === cache.get(key)?.value) storage.removeItem(key);
    } catch {}
  });

  try {
    channel = channelFactory();
    if (channel) channel.onmessage = event => receiveFromOtherTab(event.data);
  } catch {
    channel = null;
  }
  return true;
}

/** OSやブラウザーによる保存データの自動削除を避けるよう、可能なら永続化を求める。 */
export async function requestPersistentStorage() {
  try {
    if (!navigator.storage?.persist || await navigator.storage.persisted?.()) return;
    await navigator.storage.persist();
  } catch {}
}

/** テスト用に状態を初期化する。アプリ本体からは呼ばない。 */
export function resetLocalStoreForTests() {
  mode = 'localStorage';
  backend = null;
  try { channel?.close?.(); } catch {}
  channel = null;
  clearTimeout(retryTimer);
  retryTimer = null;
  flushPromise = null;
  pending.clear();
  cache.clear();
}

/** テスト用に、他タブからの通知を受け取った場合と同じ処理を呼ぶ。 */
export function receiveLocalStoreMessageForTests(message) {
  receiveFromOtherTab(message);
}
