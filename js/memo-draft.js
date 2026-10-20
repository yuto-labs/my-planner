// ============================================================
// memo-draft.js - メモ編集中の下書きを端末へ一時保存する
//
// メモは「保存」を押すまでメモリ上にしかないため、スマホがアプリを終了させると
// 編集中の内容が消えていた。編集のたびに少し遅らせてここへ書き、次に同じメモを
// 開いた時に復元できるようにする。保存またはキャンセルで消す。
// 下書きは同期しない(この端末だけの一時データ)。
// ============================================================

const DRAFT_KEY = 'mp_memo_drafts';
const MAX_DRAFTS = 5;
const MAX_AGE_MS = 30 * 86_400_000;

/** メモIDから下書きの置き場所を決める。新規メモ(IDなし)は'new'にまとめる。 */
function slot(memoId) {
  return memoId || 'new';
}

/** 保存済みの下書き一覧を読む。壊れていたり使えない環境では空として扱う。 */
function readAll(storage) {
  try {
    const value = JSON.parse(storage.getItem(DRAFT_KEY) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

/** 下書き一覧を書く。容量不足でも編集自体は続けられるので、失敗は黙って諦める。 */
function writeAll(storage, drafts) {
  try {
    if (Object.keys(drafts).length) storage.setItem(DRAFT_KEY, JSON.stringify(drafts));
    else storage.removeItem(DRAFT_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * 下書きを保存する。古い順に捨てて最大5件・30日以内に保つ。
 * content はタイトル・ブロック・タグなど、編集画面の内容そのもの。
 */
export function saveMemoDraft(memoId, content, { now = Date.now(), storage = globalThis.localStorage } = {}) {
  const drafts = readAll(storage);
  drafts[slot(memoId)] = { ...content, savedAt: now };
  const kept = Object.entries(drafts)
    .filter(([, draft]) => now - (Number(draft?.savedAt) || 0) < MAX_AGE_MS)
    .sort((a, b) => b[1].savedAt - a[1].savedAt)
    .slice(0, MAX_DRAFTS);
  return writeAll(storage, Object.fromEntries(kept));
}

/** 指定メモの下書きを返す。無い・期限切れならnull。 */
export function getMemoDraft(memoId, { now = Date.now(), storage = globalThis.localStorage } = {}) {
  const draft = readAll(storage)[slot(memoId)];
  if (!draft || !Array.isArray(draft.blocks)) return null;
  return now - (Number(draft.savedAt) || 0) < MAX_AGE_MS ? draft : null;
}

/** 指定メモの下書きを消す。保存できた時・利用者が破棄を選んだ時に呼ぶ。 */
export function clearMemoDraft(memoId, { storage = globalThis.localStorage } = {}) {
  const drafts = readAll(storage);
  if (!(slot(memoId) in drafts)) return;
  delete drafts[slot(memoId)];
  writeAll(storage, drafts);
}
