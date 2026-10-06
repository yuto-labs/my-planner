// ブラウザのコードは実行せず、Nodeのモジュール解析でimport/exportの接続を確認する。
// ファイル名変更による起動失敗と、オフライン起動用ファイルの登録漏れを検出する。
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, dirname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SourceTextModule, runInNewContext } from 'node:vm';

/** フォルダ内のJSを列挙する。未使用ファイルも検査し、後から使う際の参照切れを防ぐ。 */
function collectJavaScript(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? collectJavaScript(path) : entry.name.endsWith('.js') ? [path] : [];
  });
}

/** importのリンクと静的ファイル登録を検査する。DOM・通信・ユーザーデータには触れない。 */
export async function checkClientAssets(root) {
  root = resolve(root);
  const modules = new Map();
  /** 同じファイルは同じModuleを返し、循環importも実際のES Modulesと同様に解決する。 */
  function load(path) {
    path = resolve(path);
    assert.ok(path.startsWith(root + sep), `Module outside project: ${path}`);
    if (!modules.has(path)) {
      modules.set(path, new SourceTextModule(readFileSync(path, 'utf8'), { identifier: path }));
    }
    return modules.get(path);
  }
  /** ブラウザ用の静的importは相対ファイル参照だけ。サーバー用npm依存は対象外。 */
  function link(specifier, parent) {
    assert.ok(specifier.startsWith('.'), `Unsupported browser import: ${specifier}`);
    return load(resolve(dirname(parent.identifier), specifier));
  }
  const files = collectJavaScript(resolve(root, 'js'));
  for (const file of files) {
    const module = load(file);
    if (module.status === 'unlinked') await module.link(link);
    // 遅延importはlink()の対象外なので、文字列で指定されたローカル参照も確認する。
    for (const match of readFileSync(file, 'utf8').matchAll(/\bimport\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      assert.ok(statSync(resolve(dirname(file), match[1])).isFile(), `Missing dynamic import: ${match[1]}`);
    }
  }
  // Service Workerのイベントは登録だけに留め、キャッシュ削除や通信を一切実行しない。
  const worker = readFileSync(resolve(root, 'sw.js'), 'utf8');
  const assets = runInNewContext(`${worker}\nAPP_ASSETS`, {
    self: { addEventListener() {} },
  }, { timeout: 1000 });
  const base = 'https://local.invalid/';
  const cacheUrls = new Set(assets.map(asset => new URL(asset, base).href));
  for (const asset of assets) {
    const url = new URL(asset, base);
    assert.equal(url.origin, new URL(base).origin, `Nonlocal app asset: ${asset}`);
    assert.ok(statSync(resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname))).isFile(), `Missing asset: ${asset}`);
  }
  for (const file of files) {
    const path = relative(root, file).split(sep).join('/');
    assert.ok(cacheUrls.has(new URL(path, base).href), `Not precached: ${path}`);
  }
  const html = readFileSync(resolve(root, 'index.html'), 'utf8');
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css|png|json)(?:\?[^"']*)?)["']/g)) {
    const url = new URL(match[1], base);
    if (url.origin === new URL(base).origin) {
      assert.ok(cacheUrls.has(url.href), `HTML/cache URL mismatch: ${match[1]}`);
    }
  }
  const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
  for (const icon of manifest.icons) {
    assert.ok(cacheUrls.has(new URL(icon.src, base).href), `Icon not precached: ${icon.src}`);
  }
  return { modules: modules.size, assets: assets.length };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const result = await checkClientAssets(fileURLToPath(new URL('../', import.meta.url)));
  process.stdout.write(`Client imports and offline assets passed (${result.modules} modules, ${result.assets} assets).\n`);
}
