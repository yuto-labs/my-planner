// アクセント色とアプリ外枠の連動が、見た目の整理で失われないための回帰テスト。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [styleCss, appJs, settingsJs, serviceWorker] = await Promise.all([
  readFile(new URL('../css/style.css', import.meta.url), 'utf8'),
  readFile(new URL('../js/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/modules/settings.js', import.meta.url), 'utf8'),
  readFile(new URL('../sw.js', import.meta.url), 'utf8'),
]);

test('header and bottom navigation use the accent-derived band token', () => {
  assert.match(styleCss, /#app-header\s*\{[\s\S]*?background:\s*var\(--app-band\)/);
  assert.match(styleCss, /#bottom-nav\s*\{[\s\S]*?background:\s*var\(--app-band\)/);
  assert.match(styleCss, /#app-header\s*\{[\s\S]*?border-bottom:\s*1px solid var\(--app-band-border\)/);
  assert.match(styleCss, /#bottom-nav\s*\{[\s\S]*?border-top:\s*1px solid var\(--app-band-border\)/);
});

test('accent application derives both band colors and updates browser chrome', () => {
  assert.match(appJs, /const bandColor = mixRgb\(bandBase, adjustedBase,/);
  assert.match(appJs, /setProperty\('--app-band', rgbToCss\(bandColor, bandAlpha\)\)/);
  assert.match(appJs, /setProperty\('--app-band-border', rgbToCss\(bandBorder,/);
  assert.match(appJs, /updateBrowserThemeColor\(bandColor\)/);
  assert.match(appJs, /querySelectorAll\('meta\[name="theme-color"\]'\)/);
});

test('settings explain the visible accent scope and release refreshes offline CSS', () => {
  assert.match(settingsJs, /top and bottom bars/);
  assert.match(serviceWorker, /const CACHE_VER\s*=\s*'v380'/);
});
