// メモ入力の先頭記号をブロック種別へ変換する純粋関数群。
// 画面操作はknowledge.jsが担当し、ここではMarkdown風記法の解釈だけを行う。

const BLOCK_MARKERS = new Map([
  ['#', 'h1'],
  ['##', 'h2'],
  ['###', 'h3'],
  ['####', 'h4'],
  ['#####', 'h5'],
  ['######', 'h6'],
  ['-', 'bullet'],
  ['*', 'bullet'],
  ['+', 'bullet'],
  ['1.', 'numbered'],
  ['>', 'quote'],
  ['>>', 'toggle'],
  ['---', 'divider'],
  ['[ ]', 'checklist'],
  ['[x]', 'checklist'],
  ['- [ ]', 'checklist'],
  ['- [x]', 'checklist'],
  ['```', 'codeblock'],
]);

export function markdownBlockType(marker) {
  return markdownBlockShortcut(marker)?.type || null;
}

export function markdownBlockShortcut(marker) {
  const value = String(marker || '').trim();
  const type = BLOCK_MARKERS.get(value);
  if (type) return { type, checked: value === '[x]' || value === '- [x]' };
  if (/^\d+\.$/.test(value)) return { type: 'numbered', checked: false };
  const fence = value.match(/^```([a-z0-9_+-]+)?$/i);
  if (fence) return { type: 'codeblock', checked: false, language: fence[1] || '' };
  return null;
}

export function completedInlineMarkdown(text) {
  const value = String(text || '');
  const patterns = [
    { tags: ['strong', 'em'], delimiter: '*', pattern: /^(.*)\*\*\*([^*\n]+)\*\*\*$/s },
    { tags: ['strong', 'em'], delimiter: '_', pattern: /^(.*)___([^_\n]+)___$/s },
    { tag: 'strong', delimiter: '*', pattern: /^(.*)\*\*([^*\n]+)\*\*$/s },
    { tag: 'strong', delimiter: '_', pattern: /^(.*)__([^_\n]+)__$/s },
    { tag: 's', pattern: /^(.*)~~([^~\n]+)~~$/s },
    { tag: 'code', pattern: /^(.*)`([^`\n]+)`$/s },
    { tag: 'em', delimiter: '*', pattern: /^(.*)(?<!\*)\*([^*\n]+)\*$/s },
    { tag: 'em', delimiter: '_', pattern: /^(.*)(?<!_)_([^_\n]+)_$/s },
  ];
  const link = value.match(/^(.*)\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)$/s);
  if (link && link[2].trim()) {
    return { prefix: link[1], text: link[2], tag: 'a', href: link[3] };
  }
  const autoLink = value.match(/^(.*)<(https?:\/\/[^\s>]+)>$/s);
  if (autoLink) return { prefix: autoLink[1], text: autoLink[2], tag: 'a', href: autoLink[2] };
  for (const { tag, tags, delimiter, pattern } of patterns) {
    const match = value.match(pattern);
    if (match && !tags && delimiter && match[1].endsWith(delimiter)) continue;
    if (match && match[2].trim()) return { prefix: match[1], text: match[2], ...(tags ? { tags } : { tag }) };
  }
  return null;
}
