// 上書きされて二度と効かないCSS宣言を見つけ、--write 指定時は取り除く。
//
// 判定: 同じ@media等の中で、後ろに「まったく同じセレクタ」で同じプロパティを書いた規則があれば、
// 前の宣言は詳細度も同じで順番が先なので、絶対に勝たない(=消しても見た目は変わらない)。
// ただし前の宣言が!importantで後ろがそうでない場合や、後ろの値が新しいCSS機能
// (dvh・env()・color-mix()など)を使っていて前の値が古いブラウザー向けの予備かもしれない場合は残す。
// 使い方: node scripts/css-dead-declarations.mjs css/style.css [--write | --check]
//   --write: 効かない宣言を消して保存する(npm run css:fix)
//   --check: 1つでもあれば失敗する(npm run build で使い、上書きの積み重ねを防ぐ)
import { readFile, writeFile } from 'node:fs/promises';

const MODERN_VALUE = /\b\d*\.?\d+(?:d|s|l)v(?:h|w|b|i|min|max)\b|env\(|color-mix\(|oklch\(|lch\(|lab\(|-webkit-|-moz-/i;

/** コメントと文字列を飛ばしながら、対応する閉じ括弧の位置を探す。 */
function skipBlock(css, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < css.length; i += 1) {
    const ch = css[i];
    if (ch === '/' && css[i + 1] === '*') { i = css.indexOf('*/', i + 2) + 1; continue; }
    if (ch === '"' || ch === "'") { i = endOfString(css, i); continue; }
    if (ch === '{') depth += 1;
    if (ch === '}') { depth -= 1; if (depth === 0) return i; }
  }
  return css.length - 1;
}

/** 引用符で始まる文字列の終わりの位置を返す。 */
function endOfString(css, start) {
  const quote = css[start];
  for (let i = start + 1; i < css.length; i += 1) {
    if (css[i] === '\\') { i += 1; continue; }
    if (css[i] === quote) return i;
  }
  return css.length - 1;
}

/** 規則の中身を宣言ごとに分ける(括弧や文字列の中の ; では区切らない)。 */
function parseDeclarations(css, start, end) {
  const declarations = [];
  let depth = 0;
  let declStart = start;
  /** 区切りまでの1宣言を記録する。 */
  const push = stop => {
    const raw = css.slice(declStart, stop);
    const text = raw.replace(/\/\*[\s\S]*?\*\//g, '').trim();
    const colon = text.indexOf(':');
    if (colon > 0) {
      const offset = raw.length - raw.trimStart().length;
      declarations.push({
        prop: text.slice(0, colon).trim().toLowerCase(),
        value: text.slice(colon + 1).trim(),
        important: /!\s*important\s*$/i.test(text),
        start: declStart + offset,
        end: stop < end ? stop + 1 : stop,
      });
    }
    declStart = stop + 1;
  };
  for (let i = start; i < end; i += 1) {
    const ch = css[i];
    if (ch === '/' && css[i + 1] === '*') { i = css.indexOf('*/', i + 2) + 1; continue; }
    if (ch === '"' || ch === "'") { i = endOfString(css, i); continue; }
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ';' && depth === 0) push(i);
  }
  if (css.slice(declStart, end).trim()) push(end);
  return declarations;
}

/** CSS全体から、@media等の文脈・セレクタ・宣言を持つ通常の規則を順番に集める。 */
export function parseRules(css) {
  const rules = [];
  /** start〜endの範囲を読み、規則やネストした@ブロックを集める。 */
  const walk = (start, end, context) => {
    let preludeStart = start;
    for (let i = start; i < end; i += 1) {
      const ch = css[i];
      if (ch === '/' && css[i + 1] === '*') { i = css.indexOf('*/', i + 2) + 1; if (css.slice(preludeStart, i + 1).trim().startsWith('/*')) preludeStart = i + 1; continue; }
      if (ch === '"' || ch === "'") { i = endOfString(css, i); continue; }
      if (ch === ';') { preludeStart = i + 1; continue; }
      if (ch !== '{') continue;
      const close = skipBlock(css, i);
      const prelude = css.slice(preludeStart, i).replace(/\/\*[\s\S]*?\*\//g, '').trim().replace(/\s+/g, ' ');
      if (prelude.startsWith('@')) {
        // @mediaと@supportsの中は通常の規則として調べる。@keyframes等は対象外。
        if (/^@(media|supports)\b/i.test(prelude)) walk(i + 1, close, `${context}|${prelude}`);
      } else {
        const ruleStart = preludeStart + (css.slice(preludeStart, i).length - css.slice(preludeStart, i).trimStart().length);
        rules.push({ selector: prelude, context, start: ruleStart, open: i, close, declarations: parseDeclarations(css, i + 1, close) });
      }
      i = close;
      preludeStart = close + 1;
    }
  };
  walk(0, css.length, '');
  return rules;
}

/** 後ろの同じセレクタの規則に上書きされて効かない宣言を返す。 */
export function findDeadDeclarations(rules) {
  const dead = [];
  const later = new Map(); // 文脈+セレクタ -> {プロパティ: 後ろの宣言}
  for (let r = rules.length - 1; r >= 0; r -= 1) {
    const rule = rules[r];
    const key = `${rule.context}\u0000${rule.selector}`;
    const seen = later.get(key) || new Map();
    rule.declarations.forEach(declaration => {
      const winner = seen.get(declaration.prop);
      if (!winner) return;
      if (declaration.important && !winner.important) return;
      if (MODERN_VALUE.test(winner.value)) return;
      dead.push({ rule, declaration });
    });
    rule.declarations.forEach(declaration => {
      const current = seen.get(declaration.prop);
      // 同じ規則内に同じプロパティが複数あれば最後のものが代表。!importantは優先して覚える。
      if (!current || declaration.important || !current.important) seen.set(declaration.prop, declaration);
    });
    later.set(key, seen);
  }
  return dead;
}

/** 範囲を消した時に空行が残らないよう、行頭の空白と行末の改行まで含める。 */
function widen(css, start, end) {
  let s = start;
  while (s > 0 && (css[s - 1] === ' ' || css[s - 1] === '\t')) s -= 1;
  let e = end;
  while (e < css.length && (css[e] === ' ' || css[e] === '\t')) e += 1;
  const lineStart = s === 0 || css[s - 1] === '\n';
  if (lineStart && css[e] === '\r') e += 1;
  if (lineStart && css[e] === '\n') return [s, e + 1];
  return [start, end < css.length && css[end] === ' ' ? end + 1 : end];
}

/** 効かない宣言(と、それで空になった規則)を取り除いたCSSを返す。 */
export function removeDeadDeclarations(css) {
  const rules = parseRules(css);
  const dead = findDeadDeclarations(rules);
  const deadSet = new Set(dead.map(item => item.declaration));
  const ranges = [];
  rules.forEach(rule => {
    if (!rule.declarations.length) return;
    const remaining = rule.declarations.filter(declaration => !deadSet.has(declaration));
    if (!remaining.length) ranges.push(widen(css, rule.start, rule.close + 1));
    else rule.declarations.filter(declaration => deadSet.has(declaration)).forEach(declaration => ranges.push(widen(css, declaration.start, declaration.end)));
  });
  ranges.sort((a, b) => b[0] - a[0]);
  let out = css;
  ranges.forEach(([start, end]) => { out = out.slice(0, start) + out.slice(end); });
  return { css: out, removedDeclarations: dead.length, removedRules: rules.filter(rule => rule.declarations.length && rule.declarations.every(d => deadSet.has(d))).length };
}

// コマンドとして直接実行された時だけ、ファイルを読んで結果を表示する(テストからimportした時は動かない)。
if (process.argv[1]?.endsWith('css-dead-declarations.mjs')) {
  const [file, flag] = process.argv.slice(2);
  if (file) {
    const css = await readFile(file, 'utf8');
    const result = removeDeadDeclarations(css);
    if (flag === '--check') {
      if (result.removedDeclarations) {
        console.error(`${file}: 後ろの同じセレクタに上書きされて効かない宣言が${result.removedDeclarations}件あります。前の宣言を直接直すか、npm run css:fix で取り除いてください。`);
        process.exit(1);
      }
      console.log(`CSS dead-declaration check passed (${file}).`);
    } else {
      console.log(`${file}: ${result.removedDeclarations} dead declarations, ${result.removedRules} fully dead rules, ${css.length - result.css.length} chars`);
      if (flag === '--write') await writeFile(file, result.css);
    }
  }
}
