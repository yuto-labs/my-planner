// テーマ(ブラック/ホワイト)の決まりが、見た目の整理で崩れないための回帰テスト。
// ブラックは本当に黒で文字は白、色はCSSの [data-theme] だけで決まり、設定は2択だけであることを守る。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [styleCss, appJs, settingsJs, indexHtml, serviceWorker] = await Promise.all([
  readFile(new URL('../css/style.css', import.meta.url), 'utf8'),
  readFile(new URL('../js/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/modules/settings.js', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../sw.js', import.meta.url), 'utf8'),
]);

/** CSSの中の、あるセレクタの { } の中身を返す。 */
function block(css, selector) {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `${selector} が見つからない`);
  return css.slice(start, css.indexOf('}', start));
}

/** #RRGGBB の相対輝度(WCAGの式)。 */
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

test('black theme is really black with white text, and text stays readable on both themes', () => {
  const dark = block(styleCss, '[data-theme="dark"]');
  const light = block(styleCss, '[data-theme="light"]');
  const pick = (css, name) => css.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`))[1];
  /** 2色のコントラスト比。 */
  const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
  assert.ok(luminance(pick(dark, '--bg')) < 0.015, 'ブラックの背景はほぼ黒');
  assert.ok(contrast(pick(dark, '--text'), pick(dark, '--bg-card')) > 12, 'ブラックの文字は白に近い');
  assert.ok(contrast(pick(light, '--text'), pick(light, '--bg-card')) > 12, 'ホワイトの文字は黒に近い');
});

test('colors come only from CSS tokens: no tuning sliders, accent mixing, or auto mode', () => {
  assert.match(styleCss, /#app-header\s*\{[\s\S]*?background:\s*var\(--app-band\)/);
  assert.match(styleCss, /#bottom-nav\s*\{[\s\S]*?background:\s*var\(--app-band\)/);
  assert.doesNotMatch(appJs, /setProperty\('--(bg|text|primary|app-band)/);
  assert.match(appJs, /querySelectorAll\('meta\[name="theme-color"\]'\)/);
  assert.doesNotMatch(settingsJs, /data-theme-mode="auto"|tune-tone-level|accent-r\b/);
  assert.match(settingsJs, /data-theme-mode="dark"/);
  assert.match(settingsJs, /data-theme-mode="light"/);
});

test('the saved theme is applied before the first paint, and offline CSS is refreshed', () => {
  assert.match(indexHtml, /localStorage\.getItem\('mp_settings'\)[\s\S]*setAttribute\('data-theme'/);
  const version = serviceWorker.match(/const CACHE_VER\s*=\s*'v(\d+)'/);
  assert.ok(version && Number(version[1]) >= 448, 'cache version must include the theme update');
});
