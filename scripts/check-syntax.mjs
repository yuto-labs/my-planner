// js/とapi/以下のJavaScriptを再帰的に集め、Node.jsの構文検査へ一件ずつ渡す。
// ブラウザを開く前に、括弧漏れや不正な構文でアプリ全体が起動しない事故を検出する。
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = ['js', 'api'];
const files = [];

/** 指定フォルダをたどり、検査対象の.jsファイルをfilesへ集める。 */
function collect(path) {
  for (const name of readdirSync(path)) {
    const full = join(path, name);
    if (statSync(full).isDirectory()) collect(full);
    else if (name.endsWith('.js')) files.push(full);
  }
}

roots.forEach(collect);

// --checkはコードを実行せず、構文として読めるかだけを確認する。
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(`Syntax error: ${relative(process.cwd(), file)}\n`);
    process.stderr.write(result.stderr || result.stdout || '');
    process.exit(result.status || 1);
  }
}

process.stdout.write(`Syntax check passed (${files.length} JavaScript files).\n`);
