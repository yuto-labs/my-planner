const BLOCK_MARKERS = new Map([
  ['#', 'h1'],
  ['##', 'h2'],
  ['###', 'h3'],
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
  const type = BLOCK_MARKERS.get(marker);
  return type ? { type, checked: marker === '[x]' || marker === '- [x]' } : null;
}

export function completedInlineMarkdown(text) {
  const value = String(text || '');
  const patterns = [
    { tag: 'strong', pattern: /^(.*)\*\*([^*\n]+)\*\*$/s },
    { tag: 's', pattern: /^(.*)~~([^~\n]+)~~$/s },
    { tag: 'code', pattern: /^(.*)`([^`\n]+)`$/s },
    { tag: 'em', pattern: /^(.*)(?<!\*)\*([^*\n]+)\*$/s },
  ];
  for (const { tag, pattern } of patterns) {
    const match = value.match(pattern);
    if (match && match[2].trim()) return { prefix: match[1], text: match[2], tag };
  }
  return null;
}
