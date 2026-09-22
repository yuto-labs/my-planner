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
const shallowExplanationPatterns = [
  /補助処理を行い/,
  /に関する操作またはイベントを受けて処理する/,
  /安全に終了または削除する/,
  /変わったことを他の処理へ通知する/,
  /条件に合う.+を探して返す/,
  /受け取った情報から.+を作る/,
  /を比較し、表示または処理順を決める/,
  /条件を確認し、結果を真偽値で返す/,
  /取得して呼び出し元へ返す/,
  /後続処理で扱える安全な形にそろえる/,
  /画面・詳細・ダイアログを表示する/,
  /画面操作と処理をイベントで結び付ける/,
  /別の処理で使う形式へ変換する/,
  /必要な数値を計算して返す/,
  /現在の一時状態から、この画面部分のHTMLを描き直す/,
  /入力を解析して.+を取り出す/,
  /複数の.+を既存情報を失わないよう統合する/,
];

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
function getLeadingExplanation(lines, index) {
  let cursor = index - 1;
  while (cursor >= 0 && !lines[cursor].trim()) cursor -= 1;
  if (cursor < 0) return '';

  const previous = lines[cursor].trim();
  if (previous.startsWith('//')) return previous.replace(/^\/\/\s?/, '');
  if (previous.endsWith('*/')) {
    const commentLines = [];
    while (cursor >= 0) {
      const line = lines[cursor].trim();
      commentLines.unshift(line.replace(/^\/\*\*?\s?/, '').replace(/\s?\*\/$/, '').replace(/^\*\s?/, ''));
      if (line.startsWith('/**') || line.startsWith('/*')) return commentLines.join(' ').trim();
      cursor -= 1;
    }
  }
  return '';
}

/** 本番ソースを走査し、説明がない名前付き関数を一覧化する。 */
async function findUndocumentedFunctions() {
  const nestedFiles = (await Promise.all(sourceRoots.map(name => collectJavaScriptFiles(join(root, name))))).flat();
  const files = [...nestedFiles, ...rootSources.map(name => join(root, name))];
  const missing = [];
  const shallow = [];

  for (const file of files) {
    const lines = (await readFile(file, 'utf8')).split(/\r?\n/);
    lines.forEach((line, index) => {
      const match = line.match(functionPattern);
      if (!match) return;
      const explanation = getLeadingExplanation(lines, index);
      const item = {
        file: relative(root, file).replaceAll('\\', '/'),
        line: index + 1,
        name: match[2] || match[4],
      };
      if (!explanation) {
        missing.push(item);
        return;
      }
      if (shallowExplanationPatterns.some(pattern => pattern.test(explanation))) {
        shallow.push({ ...item, explanation });
      }
    });
  }
  return { missing, shallow };
}

const { missing, shallow } = await findUndocumentedFunctions();
if (missing.length) {
  console.error(`Function comment check failed (${missing.length} missing):`);
  missing.forEach(item => console.error(`${item.file}:${item.line} ${item.name}`));
  process.exitCode = 1;
}
if (shallow.length) {
  console.error(`Function comment quality check failed (${shallow.length} shallow):`);
  shallow.forEach(item => console.error(`${item.file}:${item.line} ${item.name}: ${item.explanation}`));
  process.exitCode = 1;
}
if (!missing.length && !shallow.length) {
  console.log('Function comment check passed.');
}
