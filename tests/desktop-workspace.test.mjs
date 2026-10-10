import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { getDesktopContextMode } from '../js/desktop-workspace.js';

const [responsiveCss, calendarSource, homeSource, indexHtml] = await Promise.all([
  readFile(new URL('../css/responsive.css', import.meta.url), 'utf8'),
  readFile(new URL('../js/modules/calendar.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/modules/home.js', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
]);

test('only detail screens with a selected item receive a desktop context list', () => {
  assert.equal(getDesktopContextMode('knowledge-detail'), 'memo');
  assert.equal(getDesktopContextMode('learning-detail'), 'knowledge');
  assert.equal(getDesktopContextMode('expression-atlas', 'entry-1'), 'atlas');
  for (const view of ['home', 'calendar', 'tasks', 'memo', 'knowledge', 'expression-atlas']) {
    assert.equal(getDesktopContextMode(view), '');
  }
});

test('PC workspace stays behind a fine-pointer breakpoint and mobile calendar agenda stays hidden', () => {
  assert.match(responsiveCss, /#desktop-context,\s*\.cal-desktop-agenda\s*\{\s*display:\s*none/);
  assert.match(responsiveCss, /@media \(min-width: 1000px\) and \(pointer: fine\)\s*\{/);
  assert.match(responsiveCss, /#app\[data-desktop-context-open="true"\] > #desktop-context/);
  assert.match(indexHtml, /<aside id="desktop-context"[^>]*hidden><\/aside>/);
});

test('calendar agenda does not replace the existing two-step day interaction', () => {
  assert.match(calendarSource, /calendarDayTapAction\(_selectedDate, dateStr\)/);
  assert.match(calendarSource, /if \(action === 'open'\)\s*\{\s*openDaySheet\(dateStr\)/);
  assert.match(calendarSource, /else if \(action === 'select'\)[\s\S]*?updateDesktopAgenda\(dateStr\)/);
  assert.match(calendarSource, /getEventsForDate\(agendaEvents, dateStr\)/);
});

test('home places existing focus and schedule controls together without duplicating them', () => {
  assert.match(homeSource, /<div class="home-dashboard-grid">[\s\S]*?id="focus-card"[\s\S]*?id="schedule-card"[\s\S]*?<\/div>\s*<!-- 今日の復習 -->/);
  assert.match(responsiveCss, /\.home-dashboard-grid\s*\{\s*display:\s*grid/);
});
