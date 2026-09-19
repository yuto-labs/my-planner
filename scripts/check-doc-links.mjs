// Markdown資料のローカルリンク先が存在するかを確認する。
// 外部URL、メール、同じ文書内の見出しリンクはファイル検査の対象外にする。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const roots = ['README.md', 'docs', 'supabase'];
const markdownFiles = [];

/** 指定されたファイルまたはフォルダから、Markdownだけを再帰的に集める。 */
function collectMarkdown(path) {
  if (!existsSync(path)) return;
  if (!statSync(path).isDirectory()) {
    if (path.endsWith('.md')) markdownFiles.push(path);
    return;
  }
  for (const name of readdirSync(path)) collectMarkdown(join(path, name));
}

roots.forEach(collectMarkdown);

const failures = [];
const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g;

for (const file of markdownFiles) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(linkPattern)) {
    // Markdownの任意タイトル `path "title"` は、最初のタイトル区切りより前だけを使う。
    const raw = match[1].trim().replace(/^<|>$/g, '').split(/\s+["']/)[0];
    if (!raw || raw.startsWith('#') || /^(?:https?:|mailto:|tel:)/i.test(raw)) continue;
    const withoutFragment = raw.split('#')[0].split('?')[0];
    let decoded = withoutFragment;
    try { decoded = decodeURIComponent(withoutFragment); } catch {}
    const target = resolve(dirname(file), decoded);
    if (!existsSync(target)) failures.push(`${relative(process.cwd(), file)} -> ${raw}`);
  }
}

if (failures.length) {
  process.stderr.write(`Broken local documentation links:\n${failures.map(item => `- ${item}`).join('\n')}\n`);
  process.exit(1);
}

process.stdout.write(`Documentation link check passed (${markdownFiles.length} Markdown files).\n`);
