// ============================================================
// expression-atlas.js - AI-assisted expression nuance library
// ============================================================

import {
  addExpressionEntries,
  addTranslationSet,
  deleteExpressionEntry,
  getExpressionEntries,
  getTranslationSets,
  isAiAvailable,
  updateExpressionEntry,
  updateTranslationSet,
} from '../storage.js';
import {
  generateNuanceEntries,
  generateTranslationVariants,
  NUANCE_ATLAS_CATEGORIES,
} from '../ai.js';
import { esc } from '../utils.js';

const nav = view => window.AppNav?.navigate(view);
const toast = (message, type = 'info') => window.AppNav?.showToast(message, type);

let state = {
  container: null,
  search: '',
  category: '',
  topic: '',
  entryId: '',
  translationId: '',
  libraryMode: 'expressions',
  screen: 'library',
  drafts: [],
  translationDraft: null,
  selectedDrafts: new Set(),
  generating: false,
  controller: null,
  noteTimer: null,
  generatorInput: {
    language: 'English',
    category: '',
    topic: '',
    seedTerms: '',
  },
  translationInput: {
    sourceTextJa: '',
    contextJa: '',
  },
};

export function initExpressionAtlas(container) {
  state = {
    ...state,
    container,
    controller: null,
    noteTimer: null,
  };
  render();
  return () => {
    persistOpenPersonalNote();
    persistOpenTranslationNote();
    clearTimeout(state.noteTimer);
    state.controller?.abort();
    state.controller = null;
    state.generating = false;
    state.container = null;
  };
}

export function hasActiveExpressionAtlasWork() {
  return state.generating;
}

export function backFromExpressionAtlas() {
  if (!state.container) {
    nav('knowledge');
    return;
  }
  if (state.screen === 'generate' || state.screen === 'translate') {
    state.controller?.abort();
    state.screen = 'library';
    state.generating = false;
    render();
    scrollMainToTop();
    return;
  }
  if (state.entryId) {
    persistOpenPersonalNote();
    state.entryId = '';
    render();
    scrollMainToTop();
    return;
  }
  if (state.translationId) {
    persistOpenTranslationNote();
    state.translationId = '';
    render();
    scrollMainToTop();
    return;
  }
  if (state.search) {
    state.search = '';
    render();
    return;
  }
  if (state.topic) {
    state.topic = '';
    render();
    scrollMainToTop();
    return;
  }
  if (state.category) {
    state.category = '';
    render();
    scrollMainToTop();
    return;
  }
  nav('knowledge');
}

function render() {
  if (!state.container) return;
  if (state.screen === 'generate') {
    renderGenerator();
    return;
  }
  if (state.screen === 'translate') {
    renderTranslationGenerator();
    return;
  }
  if (state.entryId) {
    renderDetail();
    return;
  }
  if (state.translationId) {
    renderTranslationDetail();
    return;
  }
  renderLibrary();
}

function renderLibrary() {
  if (state.libraryMode === 'translations') {
    renderTranslationLibrary();
    return;
  }
  const view = getLibraryView();
  const { entries, visibleEntries, categories, topics, level } = view;

  state.container.innerHTML = `
    <section class="atlas-page">
      <header class="atlas-hero">
        <p>似た英語表現の意味・温度感・使い分けを保存します。</p>
        <button class="btn btn-primary atlas-generate-open" id="atlas-generate-open">
          <span aria-hidden="true">✦</span> AIで表現を追加
        </button>
      </header>

      ${renderModeSwitch()}

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
        <span class="atlas-count" id="atlas-count">${visibleEntries.length || (!state.search && !state.category ? entries.length : 0)} expressions</span>
      </div>

      <div class="atlas-library" id="atlas-library">
        ${renderLibraryContent({ level, entries: visibleEntries, categories, topics, allEntries: entries })}
      </div>
    </section>
  `;

  wireLibraryShell();
  wireLibraryContent();
  wireModeSwitch();
}

function getLibraryView() {
  const entries = getExpressionEntries();
  const query = normalize(state.search);
  const matchingEntries = query
    ? entries.filter(entry => searchableText(entry).includes(query))
    : entries;
  const visibleEntries = matchingEntries.filter(entry => (
    query || (
      (!state.category || entry.category === state.category)
      && (!state.topic || entry.topic === state.topic)
    )
  ));
  const categories = unique(entries.map(entry => entry.category).filter(Boolean));
  const topics = unique(entries
    .filter(entry => !state.category || entry.category === state.category)
    .map(entry => entry.topic)
    .filter(Boolean));
  const level = query || state.topic ? 'entries' : state.category ? 'topics' : 'categories';
  return { entries, visibleEntries, categories, topics, level };
}

function wireLibraryShell() {
  state.container.querySelector('#atlas-generate-open')?.addEventListener('click', () => {
    state.screen = 'generate';
    state.drafts = [];
    state.selectedDrafts = new Set();
    state.generatorInput = {
      language: 'English',
      category: state.category || '',
      topic: state.topic || '',
      seedTerms: '',
    };
    render();
  });
  state.container.querySelector('#atlas-search')?.addEventListener('input', event => {
    state.search = event.target.value;
    updateLibraryContent();
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
}

function renderModeSwitch() {
  return `
    <div class="atlas-mode-switch" role="tablist" aria-label="NUANCE ATLASの表示">
      <button type="button" role="tab" data-atlas-mode="expressions" aria-selected="${state.libraryMode === 'expressions'}" class="${state.libraryMode === 'expressions' ? 'active' : ''}">
        表現を探す
      </button>
      <button type="button" role="tab" data-atlas-mode="translations" aria-selected="${state.libraryMode === 'translations'}" class="${state.libraryMode === 'translations' ? 'active' : ''}">
        和文を英訳
      </button>
    </div>
  `;
}

function wireModeSwitch() {
  state.container?.querySelectorAll('[data-atlas-mode]').forEach(button => {
    button.addEventListener('click', () => {
      state.libraryMode = button.dataset.atlasMode === 'translations' ? 'translations' : 'expressions';
      state.search = '';
      state.category = '';
      state.topic = '';
      state.entryId = '';
      state.translationId = '';
      render();
      scrollMainToTop();
    });
  });
}

function renderTranslationLibrary() {
  const sets = getTranslationSets();
  const query = normalize(state.search);
  const visible = query
    ? sets.filter(set => searchableTranslationText(set).includes(query))
    : sets;
  state.container.innerHTML = `
    <section class="atlas-page">
      <header class="atlas-hero">
        <p>日本語ごとに、自然な英訳とニュアンスを保存します。</p>
        <button class="btn btn-primary atlas-generate-open" id="atlas-translate-open">
          <span aria-hidden="true">✦</span> 日本語を英訳
        </button>
      </header>

      ${renderModeSwitch()}

      <div class="atlas-toolbar atlas-translation-toolbar">
        <label class="atlas-search">
          <span class="sr-only">和文または英訳を検索</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z"/></svg>
          <input id="atlas-translation-search" type="search" value="${esc(state.search)}" placeholder="日本語・英訳・ニュアンスを検索">
        </label>
        <span class="atlas-count">${visible.length} translations</span>
      </div>

      <div class="atlas-library">
        ${visible.length ? `
          <div class="atlas-entry-grid">
            ${visible.map(renderTranslationCard).join('')}
          </div>
        ` : `
          <div class="atlas-empty">
            <div class="atlas-empty-icon" aria-hidden="true">日→A</div>
            <h2>${sets.length ? '一致する英訳がありません' : '最初の和文を英訳しましょう'}</h2>
            <p>${sets.length ? '検索語を短くして、もう一度探してください。' : '日本語を入力すると、場面や温度感の異なる英訳をまとめて保存できます。'}</p>
            ${sets.length ? '' : '<button class="btn btn-primary" id="atlas-empty-translate">日本語を英訳</button>'}
          </div>
        `}
      </div>
    </section>
  `;
  wireModeSwitch();
  state.container.querySelector('#atlas-translate-open')?.addEventListener('click', openTranslationGenerator);
  state.container.querySelector('#atlas-empty-translate')?.addEventListener('click', openTranslationGenerator);
  const searchInput = state.container.querySelector('#atlas-translation-search');
  let searchTimer = null;
  let composing = false;
  const applySearch = () => {
    state.search = searchInput?.value || '';
    renderTranslationLibrary();
    requestAnimationFrame(() => {
      const input = state.container?.querySelector('#atlas-translation-search');
      if (!input) return;
      input.focus();
      try { input.setSelectionRange(input.value.length, input.value.length); } catch {}
    });
  };
  searchInput?.addEventListener('compositionstart', () => { composing = true; });
  searchInput?.addEventListener('compositionend', () => {
    composing = false;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applySearch, 0);
  });
  searchInput?.addEventListener('input', () => {
    if (composing) return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applySearch, 120);
  });
  state.container.querySelectorAll('[data-translation-id]').forEach(card => {
    card.addEventListener('click', () => {
      state.translationId = card.dataset.translationId;
      render();
      scrollMainToTop();
    });
  });
}

function renderTranslationCard(set) {
  return `
    <button class="atlas-entry-card atlas-translation-card" type="button" data-translation-id="${esc(set.id)}">
      <span class="atlas-entry-topline">
        <strong lang="ja">${esc(set.sourceTextJa)}</strong>
        <span>JA → EN</span>
      </span>
      <span class="atlas-translation-preview">
        ${(set.variants || []).slice(0, 2).map(variant => `<span lang="en">${esc(variant.translation)}</span>`).join('')}
      </span>
      <span class="atlas-entry-path">${esc(set.category)} › ${esc(set.topic)}</span>
    </button>
  `;
}

function openTranslationGenerator() {
  state.screen = 'translate';
  state.translationDraft = null;
  state.translationInput = { sourceTextJa: '', contextJa: '' };
  render();
  scrollMainToTop();
}

function renderTranslationGenerator() {
  const draft = state.translationDraft;
  const input = state.translationInput;
  state.container.innerHTML = `
    <section class="atlas-page atlas-generator-page">
      <header class="atlas-generator-header">
        <button class="atlas-back-inline" id="atlas-translation-back" type="button">
          <span aria-hidden="true">←</span> 英訳ライブラリへ戻る
        </button>
        <div>
          <div class="atlas-kicker">JAPANESE TO ENGLISH</div>
          <h1>和文から英訳を作る</h1>
          <p>日本語の意味を保ちながら、語り・洗練・明瞭さの異なる3つの英訳を比較します。</p>
        </div>
      </header>

      <form class="atlas-translation-form" id="atlas-translation-form">
        <label>
          <span>英訳したい日本語</span>
          <textarea id="atlas-source-ja" rows="4" required placeholder="例: 今日は来てくれて本当にありがとう。">${esc(input.sourceTextJa)}</textarea>
        </label>
        <div class="atlas-generator-actions">
          <button class="btn btn-primary" type="submit" ${state.generating ? 'disabled' : ''}>
            ${state.generating ? '<span class="atlas-spinner" aria-hidden="true"></span> 英訳を作成中…' : '3つの英訳を作る'}
          </button>
          ${state.generating ? '<button class="btn btn-secondary" id="atlas-cancel-translation" type="button">キャンセル</button>' : ''}
          <p>会話・文章・感情的な語りなど、異なる場面をAIが想定して比較します。</p>
        </div>
      </form>

      ${draft ? `
        <section class="atlas-translation-draft">
          <div class="atlas-draft-heading">
            <div>
              <h2>${esc(draft.sourceTextJa)}</h2>
              ${Number(draft.promptVersion || 1) < 2 && draft.summaryJa ? `<p>${esc(draft.summaryJa)}</p>` : ''}
            </div>
            <button class="btn btn-primary" id="atlas-save-translation" type="button">
              ${draft.id ? '分類の変更を保存' : 'この英訳セットを保存'}
            </button>
          </div>
          <div class="atlas-translation-classification">
            <label>
              <span>カテゴリ</span>
              <input id="atlas-translation-category" value="${esc(draft.category)}">
            </label>
            <label>
              <span>テーマ</span>
              <input id="atlas-translation-topic" value="${esc(draft.topic)}">
            </label>
          </div>
          <h2 class="atlas-translation-result-title">ニュアンス別英訳3パターン＆深掘り解説</h2>
          <div class="atlas-translation-variant-list">
            ${(draft.variants || []).map((variant, index) => renderTranslationVariant(variant, index)).join('')}
          </div>
        </section>
      ` : ''}
    </section>
  `;

  state.container.querySelector('#atlas-translation-back')?.addEventListener('click', backFromExpressionAtlas);
  ['atlas-source-ja'].forEach(id => {
    state.container.querySelector(`#${id}`)?.addEventListener('input', syncTranslationInput);
  });
  state.container.querySelector('#atlas-translation-form')?.addEventListener('submit', handleTranslationGenerate);
  state.container.querySelector('#atlas-cancel-translation')?.addEventListener('click', () => state.controller?.abort());
  state.container.querySelector('#atlas-translation-category')?.addEventListener('input', event => {
    if (state.translationDraft && event.target.value.trim()) {
      state.translationDraft.category = event.target.value.trim();
    }
  });
  state.container.querySelector('#atlas-translation-topic')?.addEventListener('input', event => {
    if (state.translationDraft && event.target.value.trim()) {
      state.translationDraft.topic = event.target.value.trim();
    }
  });
  state.container.querySelector('#atlas-save-translation')?.addEventListener('click', () => {
    if (!state.translationDraft) return;
    syncTranslationClassification();
    const saved = addTranslationSet(state.translationDraft);
    if (!saved) {
      toast('英訳セットを保存できませんでした', 'error');
      return;
    }
    state.translationId = saved.id;
    state.translationDraft = null;
    state.screen = 'library';
    toast('英訳セットを保存しました', 'success');
    render();
    scrollMainToTop();
  });
}

function renderTranslationVariant(variant, index) {
  const patternTitle = variant.labelJa || [
    'エモーショナル・ナラティブ',
    'リテラリー・洗練',
    'ロジカル・シンプル',
  ][index] || `パターン ${index + 1}`;
  return `
    <article class="atlas-translation-variant">
      <h3 class="atlas-translation-pattern-title">Pattern ${index + 1}：${esc(patternTitle)}</h3>
      <div class="atlas-translation-variant-top">
        <span class="atlas-translation-number">${String(index + 1).padStart(2, '0')}</span>
        <div>
          <span class="atlas-translation-field-label">英文</span>
          <strong lang="en">${esc(variant.translation)}</strong>
          <div class="atlas-detail-badges">
            ${variant.register ? `<span>${esc(variant.register)}</span>` : ''}
          </div>
        </div>
      </div>
      ${variant.backTranslationJa ? `<div class="atlas-back-translation"><span>和訳（逆翻訳）</span>${esc(variant.backTranslationJa)}</div>` : ''}
      ${detailSection('この文自体の全体ニュアンス', variant.overallNuanceJa || variant.nuanceJa)}
      ${translationVocabularySection(variant.vocabularyNotes)}
      ${translationComparisonSection(variant.comparisons)}
      ${listSection('自然に使う場面', variant.useCasesJa)}
      ${listSection('注意点', variant.cautionsJa, 'atlas-note-list--warning')}
    </article>
  `;
}

async function handleTranslationGenerate(event) {
  event.preventDefault();
  if (state.generating) return;
  if (!isAiAvailable()) {
    toast('AIを利用するにはログインとAI設定が必要です', 'error');
    return;
  }
  syncTranslationInput();
  if (!state.translationInput.sourceTextJa.trim()) {
    toast('英訳したい日本語を入力してください', 'error');
    return;
  }
  const taxonomy = collectAtlasTaxonomy();
  state.generating = true;
  state.controller = new AbortController();
  renderTranslationGenerator();
  try {
    const generated = await generateTranslationVariants({
      ...state.translationInput,
      existingTaxonomy: taxonomy,
    }, { signal: state.controller.signal });
    const saved = addTranslationSet(generated);
    state.translationDraft = saved || generated;
    toast(
      saved
        ? '英訳と元の日本語を自動保存しました'
        : '英訳は作成できましたが、自動保存に失敗しました',
      saved ? 'success' : 'error'
    );
  } catch (error) {
    if (error?.name !== 'AbortError') toast(error?.message || '英訳を作成できませんでした', 'error');
  } finally {
    state.generating = false;
    state.controller = null;
    render();
  }
}

function syncTranslationInput() {
  if (!state.container) return;
  state.translationInput = {
    sourceTextJa: state.container.querySelector('#atlas-source-ja')?.value || state.translationInput.sourceTextJa || '',
    contextJa: '',
  };
}

function syncTranslationClassification() {
  if (!state.translationDraft || !state.container) return;
  const category = state.container.querySelector('#atlas-translation-category')?.value.trim();
  const topic = state.container.querySelector('#atlas-translation-topic')?.value.trim();
  if (category) state.translationDraft.category = category;
  if (topic) state.translationDraft.topic = topic;
}

function collectAtlasTaxonomy() {
  const items = [...getExpressionEntries(), ...getTranslationSets()];
  return items.reduce((result, item) => {
    const found = result.find(entry => entry.category === item.category);
    if (found) {
      if (item.topic && !found.topics.includes(item.topic)) found.topics.push(item.topic);
    } else if (item.category) {
      result.push({ category: item.category, topics: item.topic ? [item.topic] : [] });
    }
    return result;
  }, []);
}

function renderTranslationDetail() {
  const set = getTranslationSets().find(item => item.id === state.translationId);
  if (!set) {
    state.translationId = '';
    render();
    return;
  }
  state.container.innerHTML = `
    <article class="atlas-page atlas-detail-page">
      <nav class="atlas-breadcrumbs" aria-label="英訳ライブラリの階層">
        <button type="button" id="atlas-translation-root">和文英訳</button>
        <span aria-hidden="true">›</span>
        <span>${esc(set.category)}</span>
        <span aria-hidden="true">›</span>
        <span>${esc(set.topic)}</span>
      </nav>
      <header class="atlas-detail-header atlas-translation-detail-header">
        <div>
          <div class="atlas-kicker">JAPANESE SOURCE</div>
          <h1 lang="ja">${esc(set.sourceTextJa)}</h1>
          <div class="atlas-detail-badges">
            <span>${esc(set.category)}</span>
            <span>${esc(set.topic)}</span>
            <span>${(set.variants || []).length} translations</span>
          </div>
        </div>
        <button class="atlas-icon-btn atlas-delete-btn" id="atlas-delete-translation" type="button" aria-label="この英訳セットを削除" title="削除">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5"/></svg>
        </button>
      </header>
      ${Number(set.promptVersion || 1) < 2 ? detailSection('英訳の考え方', set.summaryJa) : ''}
      ${set.contextJa ? detailSection('指定した場面', set.contextJa) : ''}
      <section class="atlas-detail-section atlas-translation-detail-list">
        <h2>ニュアンス別英訳3パターン＆深掘り解説</h2>
        <div class="atlas-translation-variant-list">
          ${(set.variants || []).map((variant, index) => renderTranslationVariant(variant, index)).join('')}
        </div>
      </section>
      <section class="atlas-detail-section">
        <h2>自分のメモ</h2>
        <textarea id="atlas-translation-note" class="atlas-personal-note" rows="4" placeholder="実際に使った場面や、自分なりの使い分けを記録">${esc(set.personalNote || '')}</textarea>
        <div class="atlas-note-actions">
          <button class="btn btn-primary btn-sm" id="atlas-save-translation-note">メモを保存</button>
        </div>
      </section>
    </article>
  `;
  state.container.querySelector('#atlas-translation-root')?.addEventListener('click', () => {
    persistOpenTranslationNote();
    state.translationId = '';
    render();
    scrollMainToTop();
  });
  state.container.querySelector('#atlas-save-translation-note')?.addEventListener('click', () => {
    persistOpenTranslationNote();
    toast('自分のメモを保存しました', 'success');
  });
  state.container.querySelector('#atlas-translation-note')?.addEventListener('input', () => {
    clearTimeout(state.noteTimer);
    state.noteTimer = setTimeout(persistOpenTranslationNote, 500);
  });
  state.container.querySelector('#atlas-delete-translation')?.addEventListener('click', () => {
    if (!window.confirm(`「${set.sourceTextJa}」の英訳セットを削除しますか？`)) return;
    if (deleteExpressionEntry(set.id)) {
      state.translationId = '';
      toast('英訳セットを削除しました');
      render();
    }
  });
}

function updateLibraryContent() {
  const library = state.container?.querySelector('#atlas-library');
  const count = state.container?.querySelector('#atlas-count');
  if (!library || !count) return;
  const { entries, visibleEntries, categories, topics, level } = getLibraryView();
  count.textContent = `${visibleEntries.length || (!state.search && !state.category ? entries.length : 0)} expressions`;
  library.innerHTML = renderLibraryContent({
    level,
    entries: visibleEntries,
    categories,
    topics,
    allEntries: entries,
  });
  wireLibraryContent();
}

function wireLibraryContent() {
  state.container?.querySelector('[data-atlas-empty-generate]')?.addEventListener('click', () => {
    state.screen = 'generate';
    state.generatorInput = {
      language: 'English',
      category: state.category || '',
      topic: state.topic || '',
      seedTerms: '',
    };
    render();
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
  return `
    ${state.topic && !state.search ? renderNuanceMap(entries) : ''}
    <div class="atlas-entry-grid">${entries.map(renderEntryCard).join('')}</div>
  `;
}

function renderEntryCard(entry) {
  const intensityLevel = getIntensityLevel(entry);
  const intensityLabel = intensityLevel ? intensityStars(intensityLevel) : String(entry.intensity || '').trim();
  return `
    <button class="atlas-entry-card" type="button" data-atlas-entry="${esc(entry.id)}">
      <span class="atlas-entry-topline">
        <strong>${esc(entry.term)}</strong>
        ${entry.partOfSpeech ? `<span>${esc(entry.partOfSpeech)}</span>` : ''}
      </span>
      <span class="atlas-entry-meaning">${esc(entry.coreMeaningJa || entry.nuanceJa || '説明を追加してください')}</span>
      ${intensityLabel || entry.nuanceTypeJa ? `
        <span class="atlas-entry-nuance">
          ${intensityLabel ? `<span${intensityLevel ? ` aria-label="強さ5段階中${intensityLevel}"` : ''}>${esc(intensityLabel)}</span>` : ''}
          ${entry.nuanceTypeJa ? `<small>${esc(entry.nuanceTypeJa)}</small>` : ''}
        </span>
      ` : ''}
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
  const intensityLevel = getIntensityLevel(entry);

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
            ${intensityLevel
              ? `<span aria-label="強さ5段階中${intensityLevel}">強さ ${intensityStars(intensityLevel)}</span>`
              : entry.intensity ? `<span>強さ ${esc(entry.intensity)}</span>` : ''}
            ${entry.nuanceTypeJa ? `<span>${esc(entry.nuanceTypeJa)}</span>` : ''}
          </div>
        </div>
        <button class="atlas-icon-btn atlas-delete-btn" id="atlas-delete" type="button" aria-label="この表現を削除" title="削除">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5"/></svg>
        </button>
      </header>

      ${etymologyCoreSection(entry)}
      ${detailSection('深いニュアンス', entry.nuanceJa)}
      ${comparisonsSection(entry.comparisons)}
      ${listSection('どんな場面で使う？', entry.useCasesJa)}
      ${examplesSection(entry.examples)}
      ${detailSection('感情の温度', entry.emotionalToneJa)}
      ${chipSection('よく一緒に使う語', entry.collocations)}
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
  const topics = unique(entries.map(entry => entry.topic).filter(Boolean));
  const input = state.generatorInput;
  state.container.innerHTML = `
    <section class="atlas-page atlas-generator-page">
      <header class="atlas-generator-header">
        <button class="atlas-back-inline" id="atlas-generator-back" type="button">
          <span aria-hidden="true">←</span> NUANCE ATLASへ戻る
        </button>
        <div>
          <div class="atlas-kicker">AI DRAFT</div>
          <h1>表現セットを作る</h1>
          <p>表現を入力すれば、AIがカテゴリとテーマも整理します。分類は保存前に修正できます。</p>
        </div>
      </header>

      <form class="atlas-generator-form" id="atlas-generator-form">
        <label>
          <span>言語</span>
          <select id="atlas-language">
            <option value="English" ${input.language === 'English' ? 'selected' : ''}>English</option>
          </select>
        </label>
        <label>
          <span>カテゴリ <small>任意・AI判定</small></span>
          <select id="atlas-category">
            <option value="">AIにおまかせ</option>
            ${NUANCE_ATLAS_CATEGORIES.map(value => `
              <option value="${esc(value)}" ${input.category === value ? 'selected' : ''}>${esc(value)}</option>
            `).join('')}
          </select>
          <small class="atlas-field-help">カテゴリは大分類、テーマは「喜び」「やわらかい断り」など具体的な意味です。</small>
        </label>
        <label>
          <span>テーマ <small>任意・AI判定</small></span>
          <input id="atlas-topic" list="atlas-topic-list" placeholder="例: 喜び（空欄ならAI判定）" value="${esc(input.topic)}">
          <datalist id="atlas-topic-list">${topics.map(value => `<option value="${esc(value)}">`).join('')}</datalist>
        </label>
        <label class="atlas-generator-wide">
          <span>含めたい表現 <small>任意</small></span>
          <textarea id="atlas-seed-terms" rows="3" placeholder="happy, pleasure, delighted&#10;空欄ならAIが代表的な表現を選びます">${esc(input.seedTerms)}</textarea>
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
              <p id="atlas-draft-selected-count">${state.selectedDrafts.size} / ${state.drafts.length} 件を選択中</p>
              <p class="atlas-ai-classification">
                AI分類: <strong>${esc(state.drafts[0]?.category || input.category)}</strong>
                <span aria-hidden="true">›</span>
                <strong>${esc(state.drafts[0]?.topic || input.topic)}</strong>
              </p>
            </div>
            <div class="atlas-draft-actions">
              <button class="btn btn-secondary btn-sm" id="atlas-toggle-drafts" type="button">${state.selectedDrafts.size === state.drafts.length ? 'すべて解除' : 'すべて選択'}</button>
              <button class="btn btn-primary" id="atlas-save-drafts" ${state.selectedDrafts.size ? '' : 'disabled'}>選択した表現を保存</button>
            </div>
          </div>
          ${renderNuanceMap(state.drafts, { interactive: false })}
          <div class="atlas-draft-grid">
            ${state.drafts.map((entry, index) => `
              <label class="atlas-draft-card ${state.selectedDrafts.has(index) ? 'is-selected' : ''}">
                <input type="checkbox" data-draft-index="${index}" ${state.selectedDrafts.has(index) ? 'checked' : ''}>
                <span class="atlas-draft-check" aria-hidden="true"></span>
                <span>
                  <strong>${esc(entry.term)}</strong>
                  <small>${esc([
                    entry.partOfSpeech,
                    getIntensityLevel(entry) ? intensityStars(getIntensityLevel(entry)) : entry.intensity,
                    entry.nuanceTypeJa,
                  ].filter(Boolean).join(' · '))}</small>
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
    backFromExpressionAtlas();
  });
  ['atlas-language', 'atlas-category', 'atlas-topic', 'atlas-seed-terms'].forEach(id => {
    state.container.querySelector(`#${id}`)?.addEventListener('input', syncGeneratorInput);
    state.container.querySelector(`#${id}`)?.addEventListener('change', syncGeneratorInput);
  });
  state.container.querySelector('#atlas-generator-form')?.addEventListener('submit', handleGenerate);
  state.container.querySelector('#atlas-cancel-generate')?.addEventListener('click', () => state.controller?.abort());
  state.container.querySelectorAll('[data-draft-index]').forEach(input => {
    input.addEventListener('change', () => {
      const index = Number(input.dataset.draftIndex);
      if (input.checked) state.selectedDrafts.add(index);
      else state.selectedDrafts.delete(index);
      input.closest('.atlas-draft-card')?.classList.toggle('is-selected', input.checked);
      updateDraftSelectionUi();
    });
  });
  state.container.querySelector('#atlas-toggle-drafts')?.addEventListener('click', () => {
    const shouldSelectAll = state.selectedDrafts.size !== state.drafts.length;
    state.selectedDrafts = shouldSelectAll
      ? new Set(state.drafts.map((_, index) => index))
      : new Set();
    state.container.querySelectorAll('[data-draft-index]').forEach(checkbox => {
      checkbox.checked = shouldSelectAll;
      checkbox.closest('.atlas-draft-card')?.classList.toggle('is-selected', shouldSelectAll);
    });
    updateDraftSelectionUi();
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
  syncGeneratorInput();
  const { language, category, topic, seedTerms } = state.generatorInput;
  if (!category && !topic && !String(seedTerms || '').trim()) {
    toast('カテゴリ、テーマ、含めたい表現のどれかを入力してください', 'error');
    return;
  }
  const taxonomy = getExpressionEntries().reduce((items, entry) => {
    const found = items.find(item => item.category === entry.category);
    if (found) {
      if (entry.topic && !found.topics.includes(entry.topic)) found.topics.push(entry.topic);
    } else if (entry.category) {
      items.push({ category: entry.category, topics: entry.topic ? [entry.topic] : [] });
    }
    return items;
  }, []);

  state.generating = true;
  state.controller = new AbortController();
  renderGenerator();
  try {
    const drafts = await generateNuanceEntries({
      language,
      category,
      topic,
      seedTerms,
      existingTaxonomy: taxonomy,
    }, { signal: state.controller.signal });
    state.generatorInput.category = drafts[0]?.category || category;
    state.generatorInput.topic = drafts[0]?.topic || topic;
    state.category = state.generatorInput.category;
    state.topic = state.generatorInput.topic;
    state.drafts = drafts;
    state.selectedDrafts = new Set(drafts.map((_, index) => index));
  } catch (error) {
    if (error?.name !== 'AbortError') toast(error?.message || '表現セットを作成できませんでした', 'error');
  } finally {
    state.generating = false;
    state.controller = null;
    render();
  }
}

function syncGeneratorInput() {
  if (!state.container) return;
  const next = {
    language: state.container.querySelector('#atlas-language')?.value || state.generatorInput.language || 'English',
    category: state.container.querySelector('#atlas-category')?.value.trim() || '',
    topic: state.container.querySelector('#atlas-topic')?.value.trim() || '',
    seedTerms: state.container.querySelector('#atlas-seed-terms')?.value || '',
  };
  state.generatorInput = next;
  if (state.drafts.length && (next.category || next.topic)) {
    state.drafts = state.drafts.map(entry => ({
      ...entry,
      category: next.category || entry.category,
      topic: next.topic || entry.topic,
    }));
    const classification = state.container.querySelector('.atlas-ai-classification');
    if (classification) {
      classification.innerHTML = `AI分類: <strong>${esc(state.drafts[0].category)}</strong> <span aria-hidden="true">›</span> <strong>${esc(state.drafts[0].topic)}</strong>`;
    }
  }
}

function updateDraftSelectionUi() {
  const count = state.container?.querySelector('#atlas-draft-selected-count');
  const saveButton = state.container?.querySelector('#atlas-save-drafts');
  const toggleButton = state.container?.querySelector('#atlas-toggle-drafts');
  if (count) count.textContent = `${state.selectedDrafts.size} / ${state.drafts.length} 件を選択中`;
  if (saveButton) saveButton.disabled = state.selectedDrafts.size === 0;
  if (toggleButton) {
    toggleButton.textContent = state.selectedDrafts.size === state.drafts.length ? 'すべて解除' : 'すべて選択';
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

function persistOpenTranslationNote() {
  clearTimeout(state.noteTimer);
  state.noteTimer = null;
  const textarea = state.container?.querySelector('#atlas-translation-note');
  if (!textarea || !state.translationId) return;
  updateTranslationSet(state.translationId, { personalNote: textarea.value || '' });
}

function detailSection(title, text) {
  if (!String(text || '').trim()) return '';
  return `<section class="atlas-detail-section"><h2>${esc(title)}</h2><p>${esc(text)}</p></section>`;
}

function etymologyCoreSection(entry) {
  const etymology = String(entry?.etymologyJa || '').trim();
  const coreImage = String(entry?.coreImageJa || '').trim();
  const coreMeaning = String(entry?.coreMeaningJa || '').trim();
  if (!etymology && !coreImage && !coreMeaning) return '';
  return `
    <section class="atlas-detail-section">
      <h2>語源とコア（原義）</h2>
      ${etymology ? `<p>${esc(etymology)}</p>` : ''}
      <div class="atlas-core-points">
        ${coreImage ? `
          <div>
            <strong>コアイメージ</strong>
            <p>${esc(coreImage)}</p>
          </div>
        ` : ''}
        ${coreMeaning ? `
          <div>
            <strong>中心義</strong>
            <p>${esc(coreMeaning)}</p>
          </div>
        ` : ''}
      </div>
    </section>
  `;
}

function getIntensityLevel(entry) {
  const numeric = Number(entry?.intensityLevel);
  if (Number.isFinite(numeric) && numeric >= 1 && numeric <= 5) return Math.round(numeric);
  const match = String(entry?.intensity || '').match(/[1-5]/);
  return match ? Number(match[0]) : null;
}

function intensityStars(level) {
  const safeLevel = Math.min(5, Math.max(1, Number(level) || 1));
  return `${'★'.repeat(safeLevel)}${'☆'.repeat(5 - safeLevel)}`;
}

function renderNuanceMap(entries, { interactive = true } = {}) {
  if (!Array.isArray(entries) || !entries.length) return '';
  const sorted = [...entries].sort((a, b) => (
    (getIntensityLevel(a) ?? 6) - (getIntensityLevel(b) ?? 6)
    || String(a.term || '').localeCompare(String(b.term || ''), 'en')
  ));
  return `
    <section class="atlas-nuance-map" aria-labelledby="atlas-nuance-map-title">
      <div class="atlas-nuance-map-heading">
        <h2 id="atlas-nuance-map-title">度合い・ニュアンス全体マップ</h2>
        <p>★はこのテーマ内での強さです。分類と合わせて使い分けを確認できます。</p>
      </div>
      <div class="atlas-nuance-map-list">
        ${sorted.map(entry => {
          const level = getIntensityLevel(entry);
          const intensityLabel = level ? intensityStars(level) : String(entry.intensity || '未設定').trim();
          const tagName = interactive && entry.id ? 'button' : 'div';
          const attributes = interactive && entry.id
            ? `type="button" data-atlas-entry="${esc(entry.id)}"`
            : '';
          const description = entry.nuanceTypeJa || entry.emotionalToneJa || entry.coreMeaningJa || '';
          return `
            <${tagName} class="atlas-nuance-map-row" ${attributes}>
              <span class="atlas-nuance-stars"${level ? ` aria-label="強さ5段階中${level}"` : ''}>${esc(intensityLabel)}</span>
              <strong>${esc(entry.term)}</strong>
              <span>${esc(description)}</span>
            </${tagName}>
          `;
        }).join('')}
      </div>
    </section>
  `;
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

function translationVocabularySection(notes) {
  if (!Array.isArray(notes) || !notes.length) return '';
  return `
    <section class="atlas-detail-section">
      <h2>内部解説：主要語彙・構文の語源と深掘り</h2>
      <div class="atlas-language-note-list">
        ${notes.map(note => `
          <div class="atlas-language-note">
            <strong lang="en">${esc(note.expression)}</strong>
            ${note.etymologyJa ? `<p><span>語源</span>${esc(note.etymologyJa)}</p>` : ''}
            ${note.coreImageJa ? `<p><span>コアイメージ</span>${esc(note.coreImageJa)}</p>` : ''}
            ${note.nuanceJa ? `<p><span>深いニュアンス</span>${esc(note.nuanceJa)}</p>` : ''}
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

function translationComparisonSection(comparisons) {
  if (!Array.isArray(comparisons) || !comparisons.length) return '';
  return `
    <section class="atlas-detail-section">
      <h2>似た表現との使い分け・比較</h2>
      <div class="atlas-comparison-list">
        ${comparisons.map(comparison => `
          <div>
            <strong lang="en">${esc(comparison.expression)} / ${esc(comparison.alternative)}</strong>
            <p>${esc(comparison.differenceJa)}</p>
          </div>
        `).join('')}
      </div>
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
    entry.etymologyJa,
    entry.coreImageJa,
    entry.coreMeaningJa,
    entry.nuanceJa,
    entry.nuanceTypeJa,
    entry.register,
    entry.intensityLevel,
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

function searchableTranslationText(set) {
  return normalize([
    set.sourceTextJa,
    set.contextJa,
    set.category,
    set.topic,
    set.summaryJa,
    ...(set.variants || []).flatMap(variant => [
      variant.translation,
      variant.labelJa,
      variant.style,
      variant.nuanceJa,
      variant.overallNuanceJa,
      variant.register,
      variant.backTranslationJa,
      ...(variant.vocabularyNotes || []).flatMap(note => [
        note.expression,
        note.etymologyJa,
        note.coreImageJa,
        note.nuanceJa,
      ]),
      ...(variant.comparisons || []).flatMap(comparison => [
        comparison.expression,
        comparison.alternative,
        comparison.differenceJa,
      ]),
      ...(variant.useCasesJa || []),
      ...(variant.cautionsJa || []),
    ]),
    set.personalNote,
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
