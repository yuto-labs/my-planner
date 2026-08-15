import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [responsiveCss, indexHtml, serviceWorker, manifestText] = await Promise.all([
  readFile(new URL('../css/responsive.css', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../sw.js', import.meta.url), 'utf8'),
  readFile(new URL('../manifest.json', import.meta.url), 'utf8'),
]);

test('responsive layout stays isolated from smartphone viewports', () => {
  const withoutComments = responsiveCss.replace(/\/\*[\s\S]*?\*\//g, '').trim();

  assert.match(
    withoutComments,
    /^@media \(min-width: 700px\) and \(min-height: 600px\), \(min-width: 1000px\)/,
  );
  assert.doesNotMatch(responsiveCss, /@media\s*\(max-width:/);
  assert.doesNotMatch(responsiveCss, /@media\s*\(max-height:/);
});

test('installed tablet app supports both orientations', () => {
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.orientation, 'any');
});

test('responsive stylesheet loads after the established design stylesheet', () => {
  const baseIndex = indexHtml.indexOf('css/style.css?v=286');
  const responsiveIndex = indexHtml.indexOf('css/responsive.css?v=4');

  assert.ok(baseIndex >= 0);
  assert.ok(responsiveIndex > baseIndex);
});

test('offline cache includes the responsive stylesheet', () => {
  assert.match(serviceWorker, /const CACHE_VER\s*=\s*'v326'/);
  assert.match(serviceWorker, /'\.\/css\/responsive\.css\?v=4'/);
});

test('knowledge layout uses its current learning classes on larger screens', () => {
  assert.match(responsiveCss, /\.learning-page\s*\{[\s\S]*?max-width:\s*none/);
  assert.match(responsiveCss, /\.learning-detail\s*\{[\s\S]*?max-width:\s*940px/);
  assert.match(responsiveCss, /\.learning-detail\s*\{[\s\S]*?max-width:\s*1000px/);
  assert.match(responsiveCss, /@media \(min-width: 1000px\)[\s\S]*?\.learning-list/);
});

test('home cover and memo chrome can use the wider shell', () => {
  assert.match(responsiveCss, /--responsive-shell-w:\s*1000px/);
  assert.match(responsiveCss, /--responsive-shell-w:\s*1160px/);
  assert.match(responsiveCss, /\.home-cover\s*\{[\s\S]*?width:\s*calc\(100% \+ 56px\)/);
  assert.match(responsiveCss, /\.kn-list-page\s*\{[\s\S]*?max-width:\s*none/);
  assert.match(responsiveCss, /\.kn-memo-list\s*\{[\s\S]*?max-width:\s*960px/);
});

test('responsive stylesheet has balanced blocks', () => {
  let depth = 0;
  for (const character of responsiveCss.replace(/\/\*[\s\S]*?\*\//g, '')) {
    if (character === '{') depth += 1;
    if (character === '}') depth -= 1;
    assert.ok(depth >= 0, 'closing brace appeared before an opening brace');
  }
  assert.equal(depth, 0);
});
