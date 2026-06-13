import { getKnowledgeMemos, saveKnowledgeMemos, scheduleFirstReview } from './storage.js';
import { generateId } from './utils.js';

const NOTION_ID_RE = /([0-9a-f]{32})/i;

export async function parseNotionExport(file) {
  const zipLib = await ensureJSZip();
  const zip = await zipLib.loadAsync(file);
  const entries = Object.values(zip.files).filter(f => !f.dir);
  const csvEntries = entries.filter(f => f.name.toLowerCase().endsWith('.csv'));
  const mdEntries = entries.filter(f => f.name.toLowerCase().endsWith('.md'));

  if (!csvEntries.length && !mdEntries.length) {
    throw new Error('CSVまたはMarkdownが見つかりませんでした');
  }

  const allCsv = csvEntries.find(f => /_all\.csv$/i.test(f.name)) || csvEntries[0];
  const rows = allCsv ? parseCsv(await allCsv.async('string')) : [];
  const mdFiles = await Promise.all(mdEntries.map(async entry => {
    const text = await entry.async('string');
    const id = extractNotionId(entry.name);
    const title = extractMarkdownTitle(text) || titleFromFile(entry.name);
    return { entry, id, title, text };
  }));

  const mdByTitle = new Map();
  mdFiles.forEach(m => {
    const key = normalizeTitle(m.title);
    if (key && !mdByTitle.has(key)) mdByTitle.set(key, m);
  });

  const rowItems = rows.map(row => rowToMemo(row, mdByTitle)).filter(Boolean);
  const rowIds = new Set(rowItems.map(item => item.sourceId).filter(Boolean));
  const extras = mdFiles
    .filter(m => !m.id || !rowIds.has(m.id))
    .map(m => mdToMemo({ title: m.title, text: m.text, sourceId: m.id, parentTitle: '', csvTags: [] }));

  const items = [...rowItems, ...extras]
    .filter(item => item.title || item.blocks.length)
    .filter(item => item.title !== 'DB_勉強');

  const existingTitles = new Set(getKnowledgeMemos().map(m => normalizeTitle(m.title)));
  const withDupes = items.map(item => ({
    ...item,
    duplicate: existingTitles.has(normalizeTitle(item.title)),
  }));

  return {
    sourceName: file.name,
    csvName: allCsv?.name || '',
    csvRows: rows.length,
    markdownCount: mdFiles.length,
    items: withDupes,
    importableCount: withDupes.filter(i => !i.duplicate).length,
    duplicateCount: withDupes.filter(i => i.duplicate).length,
  };
}

export function importNotionPreview(preview, { skipDuplicates = true } = {}) {
  const current = getKnowledgeMemos();
  const existingTitles = new Set(current.map(m => normalizeTitle(m.title)));
  const now = new Date().toISOString();
  const imported = [];
  const skipped = [];

  for (const item of preview.items || []) {
    const key = normalizeTitle(item.title);
    if (skipDuplicates && existingTitles.has(key)) {
      skipped.push(item);
      continue;
    }
    const memo = {
      id: generateId(),
      title: item.title || 'Untitled',
      blocks: item.blocks?.length ? item.blocks : [{ id: generateId(), type: 'paragraph', text: '' }],
      tags: item.tags?.length ? item.tags : ['Misc'],
      starred: false,
      url: '',
      summary: item.summary || blocksToText(item.blocks || [], 220),
      source: {
        type: 'notion',
        file: item.sourceFile || preview.sourceName || '',
        notionId: item.sourceId || '',
        parent: item.parentTitle || '',
      },
      createdAt: item.createdAt || now,
      updatedAt: now,
    };
    imported.push(memo);
    existingTitles.add(key);
  }

  if (imported.length) {
    saveKnowledgeMemos([...imported, ...current]);
    imported.forEach(m => scheduleFirstReview(m.id));
  }

  return { imported: imported.length, skipped: skipped.length };
}

function rowToMemo(row, mdByTitle) {
  const title = row['名前'] || row.Name || row.title || '';
  if (!title) return null;
  // Notion CSV relation fields contain other pages' IDs, so title matching must win.
  const md = mdByTitle.get(normalizeTitle(title));
  const sourceId = md?.id || '';
  const parentTitle = parseRelationTitle(row['親アイテム'] || row.Parent || '');
  const csvTags = splitTags(row['タグ'] || row.Tags || '');

  return mdToMemo({
    title,
    text: md?.text || `# ${title}`,
    sourceId: md?.id || sourceId || '',
    sourceFile: md?.entry?.name || '',
    parentTitle,
    csvTags,
  });
}

function mdToMemo({ title, text, sourceId = '', sourceFile = '', parentTitle = '', csvTags = [] }) {
  const metadata = extractMetadata(text);
  const finalTitle = title || extractMarkdownTitle(text) || 'Untitled';
  const parent = parentTitle || metadata.parentTitle || '';
  const tags = unique([
    ...csvTags,
    ...metadata.tags,
    ...(parent ? [parent] : []),
  ]).filter(t => t && !looksLikeFileRef(t));

  const blocks = markdownToBlocks(text, finalTitle);
  return {
    title: finalTitle,
    tags: tags.length ? tags : ['Misc'],
    blocks,
    summary: blocksToText(blocks, 220),
    sourceId,
    sourceFile,
    parentTitle: parent,
  };
}

function markdownToBlocks(text, title) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let inMath = false;
  let mathLines = [];

  for (const raw of lines) {
    const line = raw.replace(/\s+$/g, '');
    const trimmed = line.trim();

    if (!trimmed) continue;
    if (trimmed === '$$') {
      if (inMath) {
        blocks.push(block('math', mathLines.join('\n')));
        mathLines = [];
      }
      inMath = !inMath;
      continue;
    }
    if (inMath) {
      mathLines.push(line);
      continue;
    }

    if (isMetadataLine(trimmed)) continue;

    const h = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (h) {
      const textVal = cleanInline(h[2]);
      if (h[1].length === 1 && normalizeTitle(textVal) === normalizeTitle(title)) continue;
      blocks.push(block(h[1].length === 1 ? 'h1' : h[1].length === 2 ? 'h2' : 'h3', textVal));
      continue;
    }

    const quote = trimmed.match(/^>\s+(.+)$/);
    if (quote) {
      blocks.push(block('quote', cleanInline(quote[1])));
      continue;
    }

    const bullet = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (bullet) {
      const level = Math.floor((bullet[1] || '').replace(/\t/g, '    ').length / 4);
      const textVal = cleanInline(bullet[2]);
      const topBold = level === 0 && bullet[2].trim().match(/^\*\*(.+)\*\*$/);
      blocks.push(block(topBold ? 'h2' : 'bullet', `${level ? '　'.repeat(level) : ''}${textVal}`));
      continue;
    }

    const numbered = line.match(/^(\s*)\d+\.\s+(.+)$/);
    if (numbered) {
      const level = Math.floor((numbered[1] || '').replace(/\t/g, '    ').length / 4);
      blocks.push(block('numbered', `${level ? '　'.repeat(level) : ''}${cleanInline(numbered[2])}`));
      continue;
    }

    blocks.push(block('paragraph', cleanInline(trimmed)));
  }

  if (inMath && mathLines.length) blocks.push(block('math', mathLines.join('\n')));
  return blocks.length ? blocks : [block('paragraph', '')];
}

function block(type, text) {
  return { id: generateId(), type, text: text || '' };
}

function extractMetadata(text) {
  const tags = [];
  let parentTitle = '';
  for (const raw of String(text || '').split(/\r?\n/).slice(0, 20)) {
    const line = raw.trim();
    if (line.startsWith('タグ:')) tags.push(...splitTags(line.slice(3)));
    if (line.startsWith('親アイテム:')) parentTitle = parseRelationTitle(line.slice(6));
  }
  return { tags: unique(tags), parentTitle };
}

function isMetadataLine(line) {
  return line.startsWith('タグ:') || line.startsWith('親アイテム:') || line.startsWith('サブアイテム:');
}

function parseRelationTitle(value) {
  return String(value || '').replace(/\s*\(.+\)\s*$/u, '').trim();
}

function splitTags(value) {
  return String(value || '')
    .split(',')
    .map(t => parseRelationTitle(t).trim())
    .filter(Boolean);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const pushCell = () => { row.push(cell); cell = ''; };
  const pushRow = () => { rows.push(row); row = []; };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') pushCell();
    else if (ch === '\n') { pushCell(); pushRow(); }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { pushCell(); pushRow(); }
  if (!rows.length) return [];

  const headers = rows.shift().map(h => h.trim());
  return rows
    .filter(r => r.some(v => String(v || '').trim()))
    .map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] || ''])));
}

function cleanInline(text) {
  return String(text || '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

function extractMarkdownTitle(text) {
  const line = String(text || '').split(/\r?\n/).find(l => /^#\s+/.test(l.trim()));
  return line ? cleanInline(line.replace(/^#\s+/, '')) : '';
}

function titleFromFile(name) {
  const base = name.split('/').pop().replace(/\.md$/i, '');
  return base.replace(/\s+[0-9a-f]{32}$/i, '').trim();
}

function extractNotionId(name) {
  return findFirstId(name);
}

function findFirstId(value) {
  const decoded = safeDecode(value);
  return (decoded.match(NOTION_ID_RE) || [])[1] || '';
}

function safeDecode(value) {
  try { return decodeURIComponent(String(value || '')); }
  catch { return String(value || ''); }
}

function normalizeTitle(value) {
  return String(value || '').trim().toLowerCase();
}

function looksLikeFileRef(value) {
  return /\.md$/i.test(value) || /%[0-9a-f]{2}/i.test(value);
}

function unique(values) {
  return [...new Set(values.map(v => String(v || '').trim()).filter(Boolean))];
}

function blocksToText(blocks, maxLen = 0) {
  const text = (blocks || []).map(b => b.text || '').join('\n').trim();
  return maxLen && text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
}

async function ensureJSZip() {
  if (window.JSZip) return window.JSZip;
  await new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-jszip]');
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
    script.async = true;
    script.dataset.jszip = 'true';
    script.onload = resolve;
    script.onerror = () => reject(new Error('JSZipの読み込みに失敗しました'));
    document.head.appendChild(script);
  });
  return window.JSZip;
}
