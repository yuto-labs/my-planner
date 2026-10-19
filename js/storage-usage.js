// ============================================================
// storage-usage.js - 端末内保存領域の使用量を測る読み取り専用の集計
//
// localStorageの各キーの文字数を数え、利用者に分かる種類へまとめる。
// 保存データは読むだけで、変更・削除は一切しない。
// ============================================================

// ブラウザーによって数え方は異なるが、localStorageはおおむね500万文字前後が上限。
export const LOCAL_STORAGE_LIMIT_CHARS = 5_000_000;

const KEY_GROUPS = [
  { id: 'knowledge', label: 'メモ・表現帳・Knowledge', match: key => key === 'mp_knowledge' },
  { id: 'trash', label: 'ゴミ箱', match: key => key === 'mp_trash' },
  { id: 'events', label: '予定', match: key => key === 'mp_events' },
  { id: 'tasks', label: 'タスク', match: key => key === 'mp_tasks' },
  { id: 'archive', label: '完了タスクの保管', match: key => key === 'mp_task_archive' },
  {
    id: 'sync',
    label: '同期の控え・管理情報',
    match: key => key.startsWith('mp_sync') || key.startsWith('mp_event_sync') || key.startsWith('mp_event_remote'),
  },
  { id: 'cache', label: 'AIキャッシュ・用語解説', match: key => key === 'mp_ai_cache' || key === 'mp_terms' },
  { id: 'session', label: 'ログイン情報', match: key => key === 'mp_supabase_session' || key.startsWith('sb-') },
];

export const KNOWLEDGE_RECORD_LABELS = Object.freeze({
  memo: '通常メモ',
  atlas: '表現帳の見出し語',
  translation: '和文英訳',
  question: '英語の疑問',
  learning: 'Knowledge',
  media: 'ホーム画像の設定',
  job: 'AIジョブ',
});

/** キーと値の文字数を数える。localStorageはキー名も容量に含まれる。 */
function entryChars(key, value) {
  return String(key || '').length + String(value ?? '').length;
}

/**
 * localStorage全体を種類ごとに集計し、大きい順で返す。
 * @param {Storage} storage 読み取り対象。テストでは偽物を渡せる。
 */
export function measureLocalStorage(storage = globalThis.localStorage) {
  const groups = new Map(KEY_GROUPS.map(group => [group.id, { id: group.id, label: group.label, chars: 0, keys: 0 }]));
  groups.set('other', { id: 'other', label: '設定・その他', chars: 0, keys: 0 });
  let total = 0;
  let length = 0;
  try { length = storage?.length || 0; } catch { length = 0; }
  for (let index = 0; index < length; index += 1) {
    let key = null;
    let value = '';
    try {
      key = storage.key(index);
      value = key === null ? '' : storage.getItem(key);
    } catch {
      continue;
    }
    if (key === null) continue;
    const chars = entryChars(key, value);
    total += chars;
    const group = KEY_GROUPS.find(item => item.match(key));
    const bucket = groups.get(group?.id || 'other');
    bucket.chars += chars;
    bucket.keys += 1;
  }
  return {
    totalChars: total,
    limitChars: LOCAL_STORAGE_LIMIT_CHARS,
    ratio: total / LOCAL_STORAGE_LIMIT_CHARS,
    groups: [...groups.values()].filter(group => group.chars > 0).sort((a, b) => b.chars - a.chars),
  };
}

/**
 * メモ・表現帳・Knowledgeが同居する保存配列を、記録の種類ごとの文字数へ分ける。
 * @param {Array<object>} records 共通保存配列
 * @param {(record: object) => string} classify 記録の種類を返す関数
 */
export function measureKnowledgeRecords(records, classify) {
  const totals = new Map();
  (Array.isArray(records) ? records : []).forEach(record => {
    const kind = classify(record);
    const current = totals.get(kind) || { kind, label: KNOWLEDGE_RECORD_LABELS[kind] || kind, chars: 0, count: 0 };
    current.chars += JSON.stringify(record).length;
    current.count += 1;
    totals.set(kind, current);
  });
  return [...totals.values()].sort((a, b) => b.chars - a.chars);
}

/** 文字数を「1.23M文字」「450K文字」のような短い表記にする。 */
export function formatCharCount(chars) {
  const value = Number(chars) || 0;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M文字`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K文字`;
  return `${value}文字`;
}
