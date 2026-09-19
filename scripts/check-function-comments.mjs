// ============================================================
// check-function-comments.mjs - 名前付き関数の説明漏れを検出する保守用検査
//
// js/、api/、scripts/、sw.jsを走査し、関数宣言と名前付きアロー関数の
// 直前にJSDocまたは説明コメントがあることを確認する。実行時コードは変更しない。
// ============================================================

import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const sourceRoots = ['js', 'api', 'scripts'];
const rootSources = ['sw.js'];
const functionPattern = /^(\s*)(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(|^(\s*)(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/;

/** 指定ディレクトリ以下のJavaScriptファイルを再帰的に集める。 */
async function collectJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectJavaScriptFiles(path);
    return ['.js', '.mjs'].includes(extname(entry.name)) ? [path] : [];
  }));
  return nested.flat();
}

/** 関数の直前に、JSDocまたは意図を説明する行コメントがあるか判定する。 */
function hasLeadingExplanation(lines, index) {
  let cursor = index - 1;
  while (cursor >= 0 && !lines[cursor].trim()) cursor -= 1;
  if (cursor < 0) return false;

  const previous = lines[cursor].trim();
  if (previous.startsWith('//')) return true;
  if (previous.endsWith('*/')) {
    while (cursor >= 0) {
      const line = lines[cursor].trim();
      if (line.startsWith('/**') || line.startsWith('/*')) return true;
      cursor -= 1;
    }
  }
  return false;
}

/** 本番ソースを走査し、説明がない名前付き関数を一覧化する。 */
async function findUndocumentedFunctions() {
  const nestedFiles = (await Promise.all(sourceRoots.map(name => collectJavaScriptFiles(join(root, name))))).flat();
  const files = [...nestedFiles, ...rootSources.map(name => join(root, name))];
  const missing = [];

  for (const file of files) {
    const lines = (await readFile(file, 'utf8')).split(/\r?\n/);
    lines.forEach((line, index) => {
      const match = line.match(functionPattern);
      if (!match || hasLeadingExplanation(lines, index)) return;
      missing.push({
        file: relative(root, file).replaceAll('\\', '/'),
        line: index + 1,
        name: match[2] || match[4],
      });
    });
  }
  return missing;
}

const missing = await findUndocumentedFunctions();
if (missing.length) {
  console.error(`Function comment check failed (${missing.length} missing):`);
  missing.forEach(item => console.error(`${item.file}:${item.line} ${item.name}`));
  process.exitCode = 1;
} else {
  console.log('Function comment check passed.');
}
