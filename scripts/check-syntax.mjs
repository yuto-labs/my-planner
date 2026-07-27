import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = ['js', 'api'];
const files = [];

function collect(path) {
  for (const name of readdirSync(path)) {
    const full = join(path, name);
    if (statSync(full).isDirectory()) collect(full);
    else if (name.endsWith('.js')) files.push(full);
  }
}

roots.forEach(collect);

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(`Syntax error: ${relative(process.cwd(), file)}\n`);
    process.stderr.write(result.stderr || result.stdout || '');
    process.exit(result.status || 1);
  }
}

process.stdout.write(`Syntax check passed (${files.length} JavaScript files).\n`);
