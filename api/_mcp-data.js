// Claude(MCP)から呼ばれる「読み取り専用の道具」の中身。予定・タスク・メモをSupabaseから読み、
// AIが読みやすい形(日本時間の日時、本文はプレーンテキスト)にして返す。
//
// service role keyで読むためRLSが効かない。どの読み込みにも必ず user_id=eq.<本人> を付ける。
// 書き込み・削除の道具は作らない(読むだけ)。
import { serviceSelect } from './_supabase.js';
import { memoBlocksToText } from '../js/memo-model.js';
import { formatValue, looksSecret } from '../js/database-model.js';

const DAY_MS = 86_400_000;
// メモと同じ表に入っている、表現帳・Knowledge・画像設定・AIジョブの内部レコード。中身が大きいので読まない。
const INTERNAL_TAGS = ['__expression_atlas__', '__learning_library__', '__app_media_preferences__', '__ai_generation_job__'];
const DATABASE_TAG = '__database__';
const DATABASE_BLOCK_TYPE = 'database-data';

// ---- 日付(すべて日本時間) ----

const jstFormat = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
/** 保存されている日時(UTC)を、日本時間の「YYYY-MM-DD HH:mm」にする。 */
export const jstText = iso => (iso ? jstFormat.format(new Date(iso)) : null);
/** 今日の日付(日本時間, YYYY-MM-DD)。 */
export const todayJst = (now = Date.now()) => jstFormat.format(new Date(now)).slice(0, 10);
/** YYYY-MM-DD にn日足す。 */
const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
/** 日本時間のその日の0時を、データベースと比べられるUTCの日時にする。 */
const jstDayStart = date => new Date(`${date}T00:00:00+09:00`).toISOString();

/** 「YYYY-MM-DD」の形か確かめ、省略時は既定値、形が違えばエラーにする。 */
function dateArg(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value)) || Number.isNaN(Date.parse(value))) {
    throw Object.assign(new Error(`日付は YYYY-MM-DD で指定してください: ${value}`), { status: 400 });
  }
  return String(value);
}

/** 件数の指定を1〜上限に収める。 */
const limitArg = (value, fallback, max) => Math.min(max, Math.max(1, Number(value) || fallback));

/** 表を読むURLを作る。本人の行だけに絞る条件を必ず先頭に付ける。 */
function query(table, userId, params) {
  const search = new URLSearchParams({ user_id: `eq.${userId}`, ...params });
  return `${table}?${search}`;
}

/** アプリ内部の印(__で始まるタグ)を除いたタグ。 */
const visibleTags = tags => (Array.isArray(tags) ? tags.filter(tag => !String(tag).startsWith('__')) : []);

// ---- 予定・計画・タスク ----

/** 期間内(終了日を含む)にかかる予定を、開始の早い順に返す。 */
async function loadEvents(userId, start, end) {
  const from = jstDayStart(start);
  const rows = await serviceSelect(query('events', userId, {
    select: 'title,start_at,end_at,memo,tags,is_tentative',
    start_at: `lt.${jstDayStart(addDays(end, 1))}`,
    // 期間より前に始まって期間内に終わる予定も含める。日時は記号を含むので""で囲む。
    or: `(end_at.gte."${from}",start_at.gte."${from}")`,
    order: 'start_at.asc',
    limit: '500',
  }));
  return rows.map(row => ({
    title: row.title,
    start: jstText(row.start_at),
    end: jstText(row.end_at),
    ...(row.is_tentative ? { tentative: true } : {}),
    ...(visibleTags(row.tags).length ? { tags: visibleTags(row.tags) } : {}),
    ...(row.memo ? { memo: row.memo } : {}),
  }));
}

/** その日の「今日の計画」(時間割)を返す。 */
async function loadPlan(userId, date) {
  const rows = await serviceSelect(query('schedule_items', userId, {
    select: 'title,start_time,end_time,note', date: `eq.${date}`, order: 'start_time.asc',
  }));
  return rows.map(row => ({ title: row.title, start: row.start_time, end: row.end_time, ...(row.note ? { note: row.note } : {}) }));
}

/** タスク1件を、AIに渡す形(期限は日付と時刻をまとめる)にする。 */
function taskView(row) {
  const subtasks = Array.isArray(row.subtasks) ? row.subtasks : [];
  return {
    title: row.title,
    due: row.due_date ? `${row.due_date}${row.due_time ? ` ${row.due_time}` : ''}` : null,
    ...(row.completed ? { completed: true, completedAt: jstText(row.completed_at) } : {}),
    ...(row.estimated_minutes ? { estimatedMinutes: row.estimated_minutes } : {}),
    ...(visibleTags(row.tags).length ? { tags: visibleTags(row.tags) } : {}),
    ...(row.memo ? { memo: row.memo } : {}),
    ...(subtasks.length ? { subtasks: subtasks.map(item => ({ title: item.title || item.text || '', done: !!(item.completed ?? item.done) })) } : {}),
  };
}

/** タスクを読む。open=未完了(アーカイブ・中止を除く) / completed=完了 / all=全部。 */
async function loadTasks(userId, status = 'open', limit = 200) {
  const filters = {
    open: { completed: 'eq.false', archived_at: 'is.null', abandoned: 'not.is.true', order: 'due_date.asc.nullslast' },
    completed: { completed: 'eq.true', order: 'completed_at.desc.nullslast' },
    all: { order: 'updated_at.desc' },
  }[status];
  if (!filters) throw Object.assign(new Error('status は open / completed / all のどれかです。'), { status: 400 });
  const rows = await serviceSelect(query('tasks', userId, {
    select: 'title,completed,completed_at,due_date,due_time,memo,tags,subtasks,estimated_minutes',
    ...filters,
    limit: String(limit),
  }));
  return rows.map(row => ({ ...taskView(row), _due: row.due_date }));
}

/** _due(並べ替え・振り分け用の内部の値)を外して返す。 */
const stripDue = tasks => tasks.map(({ _due, ...task }) => task);

// ---- メモ・データベース ----

/** メモ本文の文字から、太字やマーカーなどのHTMLの印を外して普通の文字にする。 */
function plain(text) {
  return String(text || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

/** メモのブロックを、見出し・箇条書き・入れ子が分かる複数行の文字にする。 */
export function blocksToLines(blocks, depth = 0) {
  const indent = '  '.repeat(depth);
  return (Array.isArray(blocks) ? blocks : []).flatMap(block => {
    if (!block || block.type === DATABASE_BLOCK_TYPE) return [];
    if (block.type === 'divider') return [`${indent}---`];
    // 表は既存の関数で中身の文字を取り出す(表の形の決まりを二重に書かないため)。
    const text = block.type === 'table' ? memoBlocksToText([block]) : plain(block.text);
    const mark = { h1: '# ', h2: '## ', h3: '### ', bullet: '・', numbered: '・', quote: '> ', toggle: '▸ ' }[block.type]
      || (block.type === 'checklist' ? (block.checked ? '[x] ' : '[ ] ') : '');
    return [...(text ? [`${indent}${mark}${text}`] : []), ...blocksToLines(block.children, depth + 1)];
  });
}

/** データベースの列のうち、AIに見せてよい列(パスワードらしい名前の列は見せない)。 */
const visibleProperties = db => db.properties.filter(prop => !looksSecret(prop.name));

/** データベースの行の値を {列名: 表示用の文字} にする。 */
function rowValues(db, values = {}) {
  return Object.fromEntries(visibleProperties(db)
    .map(prop => [prop.name, formatValue(prop.type, values[prop.id])])
    .filter(([, value]) => value !== ''));
}

/**
 * メモ(通常のメモと、データベースの行のページ)とデータベースをまとめて読む。
 * 内部レコードはSupabase側で除外するので、大きな表現帳データは受け取らない。
 */
async function loadMemoSpace(userId) {
  const records = await serviceSelect(query('knowledge_memos', userId, {
    select: 'id,title,tags,url,blocks,updated_at',
    tags: `not.ov.{${INTERNAL_TAGS.join(',')}}`,
    order: 'updated_at.desc',
    limit: '3000',
  }));
  const databases = records
    .filter(record => record.tags?.includes(DATABASE_TAG))
    .map(record => ({ id: record.id, ...(record.blocks?.find(block => block?.type === DATABASE_BLOCK_TYPE)?.data || {}) }))
    // kind: 'memos' は「メモ」欄のビューや列の設定で、データベースではないので除く。
    .filter(db => !db.deleted && db.kind !== 'memos')
    .map(db => ({ ...db, name: db.name || '無題のデータベース', properties: db.properties || [], rows: db.rows || {}, order: db.order || [] }));
  // 行のページのID → どのデータベースのどの値か。
  const rowOf = new Map(databases.flatMap(db => db.order.map(id => [id, { db, values: db.rows[id] }])));
  const memos = records.filter(record => !record.tags?.includes(DATABASE_TAG));
  return { memos, databases, rowOf };
}

/** 一覧・検索結果用の短い形(本文は冒頭だけ)。 */
function memoSummary(memo, rowOf) {
  const row = rowOf.get(memo.id);
  return {
    id: memo.id,
    title: memo.title || '無題',
    updatedAt: jstText(memo.updated_at),
    ...(visibleTags(memo.tags).length ? { tags: visibleTags(memo.tags) } : {}),
    ...(row ? { database: row.db.name, values: rowValues(row.db, row.values) } : {}),
    snippet: plain(memoBlocksToText(memo.blocks, 160)),
  };
}

/** 検索語が、題名・タグ・本文・(行なら)列の値のどこかに含まれるか。大文字小文字は区別しない。 */
function memoMatches(memo, rowOf, words) {
  const row = rowOf.get(memo.id);
  const haystack = [memo.title, ...(memo.tags || []), memo.url, memoBlocksToText(memo.blocks),
    ...(row ? Object.values(rowValues(row.db, row.values)) : [])].join(' ').toLowerCase();
  return words.every(word => haystack.includes(word));
}

// ---- Claudeに見せる道具の一覧 ----

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const DATE = { type: 'string', description: 'YYYY-MM-DD(日本時間)' };

export const TOOLS = [
  {
    name: 'get_overview',
    title: '1日の概要',
    description: '指定した日(省略時は今日・日本時間)の予定、その日の計画(時間割)、期限がその日の未完了タスク、期限切れの未完了タスク、期限なしの未完了タスクをまとめて返す。朝の確認や「今日やること」を聞かれた時に最初に使う。',
    inputSchema: { type: 'object', properties: { date: DATE } },
    annotations: READ_ONLY,
  },
  {
    name: 'list_events',
    title: '予定の一覧',
    description: '期間内の予定(カレンダー)を開始順に返す。end は終了日を含む。最大92日。',
    inputSchema: { type: 'object', properties: { start: DATE, end: DATE }, required: ['start'] },
    annotations: READ_ONLY,
  },
  {
    name: 'list_tasks',
    title: 'タスクの一覧',
    description: 'タスクを返す。status: open=未完了(既定) / completed=完了済み(新しい順) / all。',
    inputSchema: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['open', 'completed', 'all'] }, limit: { type: 'integer', minimum: 1, maximum: 500 } },
    },
    annotations: READ_ONLY,
  },
  {
    name: 'search_memos',
    title: 'メモの検索',
    description: 'メモ(データベースの行のページを含む)を検索し、ID・題名・タグ・冒頭の文を返す。query はスペース区切りですべて含むものを探す。省略すると更新の新しい順。全文は get_memo で読む。databases にはデータベースの一覧も入る。',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, tag: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } },
    },
    annotations: READ_ONLY,
  },
  {
    name: 'get_memo',
    title: 'メモを読む',
    description: 'メモ1件の全文を返す(データベースの行なら列の値も)。データベースのIDを渡すと、そのデータベースの全行(名前と列の値)を返す。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    annotations: READ_ONLY,
  },
];

/** 道具を名前で呼び、結果のデータを返す。userId は通行証で確認済みの本人。 */
export async function runTool(name, args = {}, userId, now = Date.now()) {
  if (name === 'get_overview') {
    const date = dateArg(args.date, todayJst(now));
    const [events, plan, tasks] = await Promise.all([loadEvents(userId, date, date), loadPlan(userId, date), loadTasks(userId, 'open', 500)]);
    return {
      date,
      events,
      plan,
      tasksDue: stripDue(tasks.filter(task => task._due === date)),
      tasksOverdue: stripDue(tasks.filter(task => task._due && task._due < date)),
      tasksWithoutDue: stripDue(tasks.filter(task => !task._due).slice(0, 50)),
    };
  }
  if (name === 'list_events') {
    const start = dateArg(args.start);
    if (!start) throw Object.assign(new Error('start を指定してください。'), { status: 400 });
    const end = dateArg(args.end, start);
    if (end < start || Date.parse(end) - Date.parse(start) > 92 * DAY_MS) {
      throw Object.assign(new Error('期間は start〜end(92日以内)で指定してください。'), { status: 400 });
    }
    return { start, end, events: await loadEvents(userId, start, end) };
  }
  if (name === 'list_tasks') {
    const status = args.status || 'open';
    return { status, tasks: stripDue(await loadTasks(userId, status, limitArg(args.limit, 200, 500))) };
  }
  if (name === 'search_memos') {
    const { memos, databases, rowOf } = await loadMemoSpace(userId);
    const words = String(args.query || '').toLowerCase().split(/\s+/).filter(Boolean);
    const tag = String(args.tag || '').trim();
    const hits = memos.filter(memo => (!tag || memo.tags?.includes(tag)) && memoMatches(memo, rowOf, words));
    return {
      total: hits.length,
      memos: hits.slice(0, limitArg(args.limit, 20, 100)).map(memo => memoSummary(memo, rowOf)),
      databases: databases.map(db => ({ id: db.id, name: db.name, rows: db.order.length })),
    };
  }
  if (name === 'get_memo') {
    const { memos, databases, rowOf } = await loadMemoSpace(userId);
    const db = databases.find(item => item.id === args.id);
    if (db) {
      const titles = new Map(memos.map(memo => [memo.id, memo.title]));
      return {
        database: db.name,
        columns: visibleProperties(db).map(prop => prop.name),
        rows: db.order.filter(id => titles.has(id)).map(id => ({ id, name: titles.get(id) || '無題', ...rowValues(db, db.rows[id]) })),
      };
    }
    const memo = memos.find(item => item.id === args.id);
    if (!memo) throw Object.assign(new Error('そのIDのメモは見つかりません。'), { status: 404 });
    const row = rowOf.get(memo.id);
    return {
      ...memoSummary(memo, rowOf),
      snippet: undefined,
      ...(memo.url ? { url: memo.url } : {}),
      text: blocksToLines(memo.blocks).join('\n'),
      ...(row ? { database: row.db.name } : {}),
    };
  }
  throw Object.assign(new Error(`不明な道具です: ${name}`), { status: 400 });
}
