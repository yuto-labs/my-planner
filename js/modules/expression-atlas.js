// ============================================================
// expression-atlas.js - AI-assisted expression nuance library
// ============================================================

import {
  addExpressionEntries,
  deleteExpressionEntry,
  getExpressionEntries,
  isAiAvailable,
  updateExpressionEntry,
} from '../storage.js';
import { generateNuanceEntries } from '../ai.js';
import { esc } from '../utils.js';

const nav = view => window.AppNav?.navigate(view);
const toast = (message, type = 'info') => window.AppNav?.showToast(message, type);

let state = {
  container: null,
  search: '',
  category: '',
  topic: '',
  entryId: '',
  screen: 'library',
  drafts: [],
  selectedDrafts: new Set(),
  generating: false,
  controller: null,
  noteTimer: null,
};

export function initExpressionAtlas(container) {
  state = {
    ...state,
    container,
    screen: 'library',
    entryId: '',
    drafts: [],
    selectedDrafts: new Set(),
    generating: false,
    controller: null,
    noteTimer: null,
  };
  render();
  return () => {
    persistOpenPersonalNote();
    clearTimeout(state.noteTimer);
    state.controller?.abort();
    state.controller = null;
    state.container = null;
  };
}

function render() {
  if (!state.container) return;
  if (state.screen === 'generate') {
    renderGenerator();
    return;
  }
  if (state.entryId) {
    renderDetail();
    return;
  }
  renderLibrary();
}

function renderLibrary() {
  const entries = getExpressionEntries();
  const query = normalize(state.search);
  const matchingEntries = query
    ? entries.filter(entry => searchableText(entry).includes(query))
    : entries;
  const visibleEntries = matchingEntries.filter(entry => (
    (!state.category || entry.category === state.category)
    && (!state.topic || entry.topic === state.topic)
  ));
  const categories = unique(entries.map(entry => entry.category).filter(Boolean));
  const topics = unique(entries
    .filter(entry => !state.category || entry.category === state.category)
    .map(entry => entry.topic)
    .filter(Boolean));
  const level = query || state.topic ? 'entries' : state.category ? 'topics' : 'categories';

  state.container.innerHTML = `
    <section class="atlas-page">
      <header class="atlas-hero">
        <div>
          <div class="atlas-kicker">EXPRESSION ATLAS</div>
          <h1>表現ニュアンス辞典</h1>
          <p>似た表現の意味・温度感・使う場面を、自分の言葉で育てる辞典です。</p>
        </div>
        <button class="btn btn-primary atlas-generate-open" id="atlas-generate-open">
          <span aria-hidden="true">✦</span> AIで表現を追加
        </button>
      </header>

      <nav class="atlas-breadcrumbs" aria-label="辞典の階層">
        <button type="button" data-atlas-level="root">English</button>
        ${state.category ? `<span aria-hidden="true">›</span><button type="button" data-atlas-level="category">${esc(state.category)}</button>` : ''}
        ${state.topic ? `<span aria-hidden="true">›</span><span aria-current="page">${esc(state.topic)}</span>` : ''}
      </nav>

      <div class="atlas-toolbar">
        <label class="atlas-search">
          <span class="sr-only">表現を検索</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z"/></svg>
          <input id="atlas-search" type="search" value="${esc(state.search)}" placeholder="単語・意味・ニュアンスを検索">
        </label>
        <span class="atlas-count">${matchingEntries.length} expressions</span>
      </div>

      <div class="atlas-library" id="atlas-library">
        ${renderLibraryContent({ level, entries: visibleEntries, categories, topics, allEntries: entries })}
      </div>
    </section>
  `;

  state.container.querySelector('#atlas-generate-open')?.addEventListener('click', () => {
    state.screen = 'generate';
    state.drafts = [];
    state.selectedDrafts = new Set();
    render();
  });
  state.container.querySelector('[data-atlas-empty-generate]')?.addEventListener('click', () => {
    state.screen = 'generate';
    render();
  });
  state.container.querySelector('#atlas-search')?.addEventListener('input', event => {
    state.search = event.target.value;
    renderLibrary();
    requestAnimationFrame(() => {
      const input = state.container?.querySelector('#atlas-search');
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    });
  });
  state.container.querySelectorAll('[data-atlas-level]').forEach(button => {
    button.addEventListener('click', () => {
      if (button.dataset.atlasLevel === 'root') {
        state.category = '';
        state.topic = '';
      } else {
        state.topic = '';
      }
      state.search = '';
      render();
    });
  });
  state.container.querySelectorAll('[data-atlas-category]').forEach(card => {
    card.addEventListener('click', () => {
      state.category = card.dataset.atlasCategory;
      state.topic = '';
      render();
      scrollMainToTop();
    });
  });
  state.container.querySelectorAll('[data-atlas-topic]').forEach(card => {
    card.addEventListener('click', () => {
      state.topic = card.dataset.atlasTopic;
      render();
      scrollMainToTop();
    });
  });
  state.container.querySelectorAll('[data-atlas-entry]').forEach(card => {
    card.addEventListener('click', () => {
      state.entryId = card.dataset.atlasEntry;
      render();
      scrollMainToTop();
    });
  });
}

function renderLibraryContent({ level, entries, categories, topics, allEntries }) {
  if (!allEntries.length) {
    return `
      <div class="atlas-empty">
        <div class="atlas-empty-icon" aria-hidden="true">Aa</div>
        <h2>最初のテーマを作りましょう</h2>
        <p>たとえば「感情 › 喜び」を指定すると、happy・pleased・delighted などを比較できる形で追加できます。</p>
        <button class="btn btn-primary" data-atlas-empty-generate>AIで追加する</button>
      </div>
    `;
  }
  if (level === 'categories') {
    return `<div class="atlas-folder-grid">${categories.map(category => {
      const count = allEntries.filter(entry => entry.category === category).length;
      const topicCount = unique(allEntries.filter(entry => entry.category === category).map(entry => entry.topic)).length;
      return `
        <button class="atlas-folder-card" type="button" data-atlas-category="${esc(category)}">
          <span class="atlas-folder-mark" aria-hidden="true"></span>
          <span class="atlas-folder-title">${esc(category)}</span>
          <span class="atlas-folder-meta">${topicCount} themes · ${count} expressions</span>
        </button>
      `;
    }).join('')}</div>`;
  }
  if (level === 'topics') {
    return `<div class="atlas-folder-grid">${topics.map(topic => {
      const topicEntries = allEntries.filter(entry => entry.category === state.category && entry.topic === topic);
      return `
        <button class="atlas-folder-card atlas-folder-card--topic" type="button" data-atlas-topic="${esc(topic)}">
          <span class="atlas-folder-mark" aria-hidden="true"></span>
          <span class="atlas-folder-title">${esc(topic)}</span>
          <span class="atlas-folder-meta">${topicEntries.length} expressions</span>
          <span class="atlas-folder-preview">${topicEntries.slice(0, 4).map(entry => esc(entry.term)).join(' · ')}</span>
        </button>
      `;
    }).join('')}</div>`;
  }
  if (!entries.length) {
    return `
      <div class="atlas-empty atlas-empty--compact">
        <h2>一致する表現がありません</h2>
        <p>検索語を短くするか、別のカテゴリを選んでください。</p>
      </div>
    `;
  }
  return `<div class="atlas-entry-grid">${entries.map(renderEntryCard).join('')}</div>`;
}

function renderEntryCard(entry) {
  return `
    <button class="atlas-entry-card" type="button" data-atlas-entry="${esc(entry.id)}">
      <span class="atlas-entry-topline">
        <strong>${esc(entry.term)}</strong>
        ${entry.partOfSpeech ? `<span>${esc(entry.partOfSpeech)}</span>` : ''}
      </span>
      <span class="atlas-entry-meaning">${esc(entry.coreMeaningJa || entry.nuanceJa || '説明を追加してください')}</span>
      <span class="atlas-entry-path">${esc(entry.category)} › ${esc(entry.topic)}</span>
    </button>
  `;
}

function renderDetail() {
  const entry = getExpressionEntries().find(item => item.id === state.entryId);
  if (!entry) {
    state.entryId = '';
    render();
    return;
  }

  state.container.innerHTML = `
    <article class="atlas-page atlas-detail-page">
      <nav class="atlas-breadcrumbs" aria-label="辞典の階層">
        <button type="button" id="atlas-detail-root">English</button>
        <span aria-hidden="true">›</span>
        <button type="button" id="atlas-detail-category">${esc(entry.category)}</button>
        <span aria-hidden="true">›</span>
        <button type="button" id="atlas-detail-topic">${esc(entry.topic)}</button>
        <span aria-hidden="true">›</span>
        <span aria-current="page">${esc(entry.term)}</span>
      </nav>

      <header class="atlas-detail-header">
        <div>
          <div class="atlas-kicker">${esc(entry.language || 'English')}</div>
          <h1>${esc(entry.term)}</h1>
          <div class="atlas-detail-badges">
            ${entry.partOfSpeech ? `<span>${esc(entry.partOfSpeech)}</span>` : ''}
            ${entry.register ? `<span>${esc(entry.register)}</span>` : ''}
            ${entry.intensity ? `<span>強さ: ${esc(entry.intensity)}</span>` : ''}
          </div>
        </div>
        <button class="atlas-icon-btn atlas-delete-btn" id="atlas-delete" type="button" aria-label="この表現を削除" title="削除">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5"/></svg>
        </button>
      </header>

      ${detailSection('中心的な意味', entry.coreMeaningJa)}
      ${detailSection('ニュアンス', entry.nuanceJa)}
      ${detailSection('感情の温度', entry.emotionalToneJa)}
      ${listSection('自然に使う場面', entry.useCasesJa)}
      ${chipSection('よく一緒に使う語', entry.collocations)}
      ${examplesSection(entry.examples)}
      ${comparisonsSection(entry.comparisons)}
      ${listSection('注意点', entry.cautionsJa, 'atlas-note-list--warning')}

      <section class="atlas-detail-section">
        <h2>自分のメモ</h2>
        <textarea id="atlas-personal-note" class="atlas-personal-note" rows="4" placeholder="覚え方、使ってみたい場面、自分なりの違いを記録">${esc(entry.personalNote || '')}</textarea>
        <div class="atlas-note-actions">
          <button class="btn btn-primary btn-sm" id="atlas-save-note">メモを保存</button>
        </div>
      </section>
    </article>
  `;

  state.container.querySelector('#atlas-detail-root')?.addEventListener('click', () => returnToLibrary('', ''));
  state.container.querySelector('#atlas-detail-category')?.addEventListener('click', () => returnToLibrary(entry.category, ''));
  state.container.querySelector('#atlas-detail-topic')?.addEventListener('click', () => returnToLibrary(entry.category, entry.topic));
  state.container.querySelector('#atlas-save-note')?.addEventListener('click', () => {
    persistOpenPersonalNote();
    toast('自分のメモを保存しました', 'success');
  });
  state.container.querySelector('#atlas-personal-note')?.addEventListener('input', () => {
    clearTimeout(state.noteTimer);
    state.noteTimer = setTimeout(persistOpenPersonalNote, 500);
  });
  state.container.querySelector('#atlas-delete')?.addEventListener('click', () => {
    if (!window.confirm(`「${entry.term}」を辞典から削除しますか？`)) return;
    if (deleteExpressionEntry(entry.id)) {
      state.entryId = '';
      toast('表現を削除しました');
      render();
    }
  });
}

function renderGenerator() {
  const entries = getExpressionEntries();
  const categories = unique(entries.map(entry => entry.category).filter(Boolean));
  const topics = unique(entries.map(entry => entry.topic).filter(Boolean));
  state.container.innerHTML = `
    <section class="atlas-page atlas-generator-page">
      <header class="atlas-generator-header">
        <button class="atlas-back-inline" id="atlas-generator-back" type="button">
          <span aria-hidden="true">←</span> 辞典へ戻る
        </button>
        <div>
          <div class="atlas-kicker">AI DRAFT</div>
          <h1>表現セットを作る</h1>
          <p>カテゴリとテーマを指定し、保存前に必要な表現だけ選べます。</p>
        </div>
      </header>

      <form class="atlas-generator-form" id="atlas-generator-form">
        <label>
          <span>言語</span>
          <select id="atlas-language">
            <option value="English">English</option>
          </select>
        </label>
        <label>
          <span>カテゴリ</span>
          <input id="atlas-category" list="atlas-category-list" required placeholder="例: 感情" value="${esc(state.category)}">
          <datalist id="atlas-category-list">${categories.map(value => `<option value="${esc(value)}">`).join('')}</datalist>
        </label>
        <label>
          <span>テーマ</span>
          <input id="atlas-topic" list="atlas-topic-list" required placeholder="例: 喜び" value="${esc(state.topic)}">
          <datalist id="atlas-topic-list">${topics.map(value => `<option value="${esc(value)}">`).join('')}</datalist>
        </label>
        <label class="atlas-generator-wide">
          <span>含めたい表現 <small>任意</small></span>
          <textarea id="atlas-seed-terms" rows="3" placeholder="happy, pleasure, delighted&#10;空欄ならAIが代表的な表現を選びます"></textarea>
        </label>
        <div class="atlas-generator-wide atlas-generator-actions">
          <button class="btn btn-primary" id="atlas-generate-btn" type="submit" ${state.generating ? 'disabled' : ''}>
            ${state.generating ? '<span class="atlas-spinner" aria-hidden="true"></span> 作成中…' : '表現セットを作成'}
          </button>
          ${state.generating ? '<button class="btn btn-secondary" id="atlas-cancel-generate" type="button">キャンセル</button>' : ''}
          <p>既存の語と重なった場合は、新しい説明で安全に更新されます。</p>
        </div>
      </form>

      ${state.drafts.length ? `
        <section class="atlas-draft-section">
          <div class="atlas-draft-heading">
            <div>
              <h2>保存する表現を選択</h2>
              <p>${state.selectedDrafts.size} / ${state.drafts.length} 件を選択中</p>
            </div>
            <button class="btn btn-primary" id="atlas-save-drafts" ${state.selectedDrafts.size ? '' : 'disabled'}>選択した表現を保存</button>
          </div>
          <div class="atlas-draft-grid">
            ${state.drafts.map((entry, index) => `
              <label class="atlas-draft-card ${state.selectedDrafts.has(index) ? 'is-selected' : ''}">
                <input type="checkbox" data-draft-index="${index}" ${state.selectedDrafts.has(index) ? 'checked' : ''}>
                <span class="atlas-draft-check" aria-hidden="true"></span>
                <span>
                  <strong>${esc(entry.term)}</strong>
                  <small>${esc(entry.partOfSpeech)}</small>
                  <span>${esc(entry.coreMeaningJa)}</span>
                  <em>${esc(entry.nuanceJa)}</em>
                </span>
              </label>
            `).join('')}
          </div>
        </section>
      ` : ''}
    </section>
  `;

  state.container.querySelector('#atlas-generator-back')?.addEventListener('click', () => {
    if (state.generating) state.controller?.abort();
    state.screen = 'library';
    render();
  });
  state.container.querySelector('#atlas-generator-form')?.addEventListener('submit', handleGenerate);
  state.container.querySelector('#atlas-cancel-generate')?.addEventListener('click', () => state.controller?.abort());
  state.container.querySelectorAll('[data-draft-index]').forEach(input => {
    input.addEventListener('change', () => {
      const index = Number(input.dataset.draftIndex);
      if (input.checked) state.selectedDrafts.add(index);
      else state.selectedDrafts.delete(index);
      renderGenerator();
    });
  });
  state.container.querySelector('#atlas-save-drafts')?.addEventListener('click', () => {
    const selected = state.drafts.filter((_, index) => state.selectedDrafts.has(index));
    const saved = addExpressionEntries(selected);
    if (!saved.length) return;
    state.category = saved[0].category;
    state.topic = saved[0].topic;
    state.screen = 'library';
    state.drafts = [];
    state.selectedDrafts = new Set();
    toast(`${saved.length}件の表現を保存しました`, 'success');
    render();
    scrollMainToTop();
  });
}

async function handleGenerate(event) {
  event.preventDefault();
  if (state.generating) return;
  if (!isAiAvailable()) {
    toast('AIを利用するにはログインとAI設定が必要です', 'error');
    return;
  }
  const form = event.currentTarget;
  const category = form.querySelector('#atlas-category')?.value.trim() || '';
  const topic = form.querySelector('#atlas-topic')?.value.trim() || '';
  const seedTerms = form.querySelector('#atlas-seed-terms')?.value || '';
  if (!category || !topic) return;

  state.generating = true;
  state.controller = new AbortController();
  renderGenerator();
  try {
    const drafts = await generateNuanceEntries({
      language: form.querySelector('#atlas-language')?.value || 'English',
      category,
      topic,
      seedTerms,
    }, { signal: state.controller.signal });
    state.category = category;
    state.topic = topic;
    state.drafts = drafts;
    state.selectedDrafts = new Set(drafts.map((_, index) => index));
  } catch (error) {
    if (error?.name !== 'AbortError') toast(error?.message || '表現セットを作成できませんでした', 'error');
  } finally {
    state.generating = false;
    state.controller = null;
    renderGenerator();
  }
}

function returnToLibrary(category, topic) {
  persistOpenPersonalNote();
  state.entryId = '';
  state.category = category;
  state.topic = topic;
  state.search = '';
  render();
  scrollMainToTop();
}

function persistOpenPersonalNote() {
  clearTimeout(state.noteTimer);
  state.noteTimer = null;
  const textarea = state.container?.querySelector('#atlas-personal-note');
  if (!textarea || !state.entryId) return;
  updateExpressionEntry(state.entryId, { personalNote: textarea.value || '' });
}

function detailSection(title, text) {
  if (!String(text || '').trim()) return '';
  return `<section class="atlas-detail-section"><h2>${esc(title)}</h2><p>${esc(text)}</p></section>`;
}

function listSection(title, items, className = '') {
  if (!Array.isArray(items) || !items.length) return '';
  return `
    <section class="atlas-detail-section">
      <h2>${esc(title)}</h2>
      <ul class="atlas-note-list ${className}">${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>
    </section>
  `;
}

function chipSection(title, items) {
  if (!Array.isArray(items) || !items.length) return '';
  return `
    <section class="atlas-detail-section">
      <h2>${esc(title)}</h2>
      <div class="atlas-chip-list">${items.map(item => `<span>${esc(item)}</span>`).join('')}</div>
    </section>
  `;
}

function examplesSection(examples) {
  if (!Array.isArray(examples) || !examples.length) return '';
  return `
    <section class="atlas-detail-section">
      <h2>例文</h2>
      <div class="atlas-example-list">${examples.map(example => `
        <div class="atlas-example">
          <strong>${esc(example.source)}</strong>
          <span>${esc(example.translation)}</span>
          ${example.noteJa ? `<small>${esc(example.noteJa)}</small>` : ''}
        </div>
      `).join('')}</div>
    </section>
  `;
}

function comparisonsSection(comparisons) {
  if (!Array.isArray(comparisons) || !comparisons.length) return '';
  return `
    <section class="atlas-detail-section">
      <h2>似た表現との違い</h2>
      <div class="atlas-comparison-list">${comparisons.map(comparison => `
        <div><strong>${esc(comparison.term)}</strong><p>${esc(comparison.differenceJa)}</p></div>
      `).join('')}</div>
    </section>
  `;
}

function searchableText(entry) {
  return normalize([
    entry.term,
    entry.partOfSpeech,
    entry.coreMeaningJa,
    entry.nuanceJa,
    entry.register,
    entry.intensity,
    entry.emotionalToneJa,
    entry.category,
    entry.topic,
    ...(entry.useCasesJa || []),
    ...(entry.collocations || []),
    ...(entry.cautionsJa || []),
    ...(entry.examples || []).flatMap(example => [example.source, example.translation, example.noteJa]),
    ...(entry.comparisons || []).flatMap(comparison => [comparison.term, comparison.differenceJa]),
    entry.personalNote,
  ].filter(Boolean).join(' '));
}

function normalize(value) {
  return String(value || '').trim().toLocaleLowerCase();
}

function unique(values) {
  return [...new Set(values)].sort((a, b) => String(a).localeCompare(String(b), 'ja'));
}

function scrollMainToTop() {
  requestAnimationFrame(() => {
    document.getElementById('main-content')?.scrollTo({ top: 0, behavior: 'auto' });
  });
}
