// 検査そのものが壊れたimportやキャッシュ漏れを見逃さないことを、小さな仮のアプリで確認する。
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

/** 一時フォルダだけを書き換えて検査し、成功・失敗のどちらでも片付ける。実アプリには触れない。 */
function inspectFixture(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'planner-assets-'));
  try {
    mkdirSync(join(root, 'js'));
    const files = {
      'js/app.js': "import { value } from './value.js'; export { value };",
      'js/value.js': 'export const value = 1;',
      'index.html': '<script type="module" src="./js/app.js"></script>',
      'manifest.json': JSON.stringify({ icons: [{ src: 'icon.png' }] }),
      'icon.png': 'fixture',
      'sw.js': "const APP_ASSETS = ['./', './index.html', './manifest.json', './icon.png', './js/app.js', './js/value.js'];",
      ...overrides,
    };
    for (const [name, content] of Object.entries(files)) writeFileSync(join(root, name), content);
    const checker = new URL('../scripts/check-client-assets.mjs', import.meta.url).href;
    return spawnSync(process.execPath, [
      '--experimental-vm-modules', '--input-type=module', '-e',
      `import { checkClientAssets } from ${JSON.stringify(checker)}; await checkClientAssets(process.argv[1]);`, root,
    ], { encoding: 'utf8', timeout: 15000 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('client asset check links modules without evaluating browser code', () => {
  const result = inspectFixture({ 'js/value.js': 'throw new Error("must not execute"); export const value = 1;' });
  assert.equal(result.status, 0, result.stderr);
});

test('client asset check rejects missing named exports', () => {
  const result = inspectFixture({ 'js/value.js': 'export const other = 1;' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not provide an export/);
});

test('client asset check rejects offline module omissions', () => {
  const result = inspectFixture({ 'sw.js': "const APP_ASSETS = ['./index.html', './manifest.json', './icon.png', './js/app.js'];" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Not precached: js\/value.js/);
});

test('client asset check rejects missing literal dynamic imports', () => {
  const result = inspectFixture({ 'js/app.js': "export const open = () => import('./missing.js');" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing\.js/);
});

test('client asset check catches different HTML and offline query versions', () => {
  const result = inspectFixture({ 'index.html': '<script src="./js/app.js?v=2"></script>' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /HTML\/cache URL mismatch/);
});

test('client asset check catches missing installed app icons', () => {
  const result = inspectFixture({ 'manifest.json': '{"icons":[{"src":"missing.png"}]}' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Icon not precached/);
});
