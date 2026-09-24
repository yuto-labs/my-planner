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

/** `markdownBlockType`: Markdown記号から対応する既存メモブロック種別を返す。 */
export function markdownBlockType(marker) {
  return markdownBlockShortcut(marker)?.type || null;
}

/** `markdownBlockShortcut`: 行頭のMarkdown記号を解析し、ブロック変換内容を返す。 */
export function markdownBlockShortcut(marker) {
  const value = String(marker || '').trim();
  const type = BLOCK_MARKERS.get(value);
  if (type) return { type, checked: value === '[x]' || value === '- [x]' };
  if (/^\d+\.$/.test(value)) return { type: 'numbered', checked: false };
  const fence = value.match(/^```([a-z0-9_+-]+)?$/i);
  if (fence) return { type: 'codeblock', checked: false, language: fence[1] || '' };
  return null;
}

/** `completedInlineMarkdown`: 入力済み文字列の末尾に完成したインラインMarkdown装飾があるか解析する。 */
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

/**
 * 保存済みのブロック種別を、編集画面で見せるMarkdownの行頭記号へ変換する。
 * 閲覧用データへ記号を混ぜず、編集時だけ表現を変えることで既存メモとの互換性を保つ。
 */
export function markdownPrefixForBlock(block, listNumber = 1) {
  const type = block?.type || 'paragraph';
  if (/^h[1-6]$/.test(type)) return `${'#'.repeat(Number(type.slice(1)))} `;
  if (type === 'bullet') return '- ';
  if (type === 'numbered') {
    const number = Number.isFinite(Number(block?.listNumber))
      ? Number(block.listNumber)
      : listNumber;
    return `${Math.max(1, number || 1)}. `;
  }
  if (type === 'checklist') return `- [${block?.checked ? 'x' : ' '}] `;
  if (type === 'quote') return '> ';
  if (type === 'toggle') return '>> ';
  return '';
}

/**
 * 編集画面の一行をブロック種別と本文へ戻す。
 * 行頭記号がなければ段落として扱うため、`##`を消せば通常本文へ戻せる。
 */
export function parseMarkdownBlockSource(source) {
  const value = String(source || '').replace(/\u200B/g, '');
  if (value.trim() === '---') return { type: 'divider', text: '', checked: false };
  const heading = value.match(/^(#{1,6})[ \t]+([\s\S]*)$/);
  if (heading) return { type: `h${heading[1].length}`, text: heading[2], checked: false };
  const checklist = value.match(/^-\s+\[([ xX])\]\s*([\s\S]*)$/);
  if (checklist) return { type: 'checklist', text: checklist[2], checked: checklist[1].toLowerCase() === 'x' };
  const numbered = value.match(/^(\d+)\.\s+([\s\S]*)$/);
  if (numbered) {
    return {
      type: 'numbered',
      text: numbered[2],
      checked: false,
      listNumber: Math.max(1, Number(numbered[1]) || 1),
    };
  }
  const toggle = value.match(/^>>\s+([\s\S]*)$/);
  if (toggle) return { type: 'toggle', text: toggle[1], checked: false };
  const quote = value.match(/^>\s+([\s\S]*)$/);
  if (quote) return { type: 'quote', text: quote[1], checked: false };
  const bullet = value.match(/^[-*+]\s+([\s\S]*)$/);
  if (bullet) return { type: 'bullet', text: bullet[1], checked: false };
  return { type: 'paragraph', text: value, checked: false };
}

/** GPT等が全項目を`1.`で表すMarkdownリストを、貼り付け時だけ連番へ直す。 */
export function resolvePastedOrderedListNumber(requestedNumber, previousNumber = 0) {
  const requested = Math.max(1, Number(requestedNumber) || 1);
  const previous = Math.max(0, Number(previousNumber) || 0);
  return requested === 1 && previous >= 1 ? previous + 1 : requested;
}

/** ツールバーの行内装飾を、編集画面へ挿入するMarkdown記号へ対応付ける。 */
export function markdownDelimitersForCommand(command) {
  return {
    bold: ['**', '**'],
    italic: ['*', '*'],
    underline: ['<u>', '</u>'],
    strikeThrough: ['~~', '~~'],
  }[command] || null;
}
