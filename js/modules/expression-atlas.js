// ============================================================
// expression-atlas.js - AI-assisted expression nuance library
// ============================================================

import {
  addExpressionEntries,
  addTranslationSet,
  addEnglishQuestion,
  deleteEnglishQuestion,
  deleteExpressionEntry,
  getEnglishQuestions,
  getExpressionEntries,
  getTranslationSets,
  isAiAvailable,
  updateExpressionEntry,
  updateEnglishQuestion,
  updateTranslationSet,
} from '../storage.js';
import {
  generateNuanceEntries,
  answerEnglishLearningQuestion,
  detectAtlasQueryMode,
  generateTranslationVariants,
  NUANCE_ATLAS_CATEGORIES,
  refreshAiRuntimeStatus,
} from '../ai.js';

async function ensureAtlasAiReady() {
  if (isAiAvailable()) return true;
  const runtime = await refreshAiRuntimeStatus({ force: true });
  return runtime.configured === true;
}
import {
  buildExpressionIndex,
  collectStableTaxonomy,
  findExpressionMatches,
  isUsefulLinkedToken,
  isValidAtlasTopic,
  normalizeAtlasCategory,
  normalizeAtlasTopic,
  stableAtlasId,
  tokenizeEnglishForLinks,
  withStableClassification,
} from '../atlas-model.js';
import {
  ETYMOLOGY_CORE,
  ETYMOLOGY_CORE_STATS,
  getEtymologyCoreEntry,
} from '../data/etymology-core.js';
import {
  ENGLISH_USAGE_CORE,
  ENGLISH_USAGE_CORE_STATS,
  getEnglishUsageCoreEntry,
} from '../data/english-usage-core.js';
import { esc } from '../utils.js';

const nav = view => window.AppNav?.navigate(view);
const toast = (message, type = 'info') => window.AppNav?.showToast(message, type);
const ATLAS_RECENT_KEY = 'mp_atlas_recent_entries';
const MAX_RECENT_ENTRIES = 12;

let state = {
  container: null,
  search: '',
  category: '',
  topic: '',
  entryId: '',
  translationId: '',
  questionId: '',
  questionConversionId: '',
  morphemeId: '',
  usageId: '',
  usageTrail: [],
  detailTrail: [],
  libraryScrollTop: 0,
  collapsedDetailSections: new Set(),
  openNativeDetailSections: new Set(),
  openSenseDetailSections: new Map(),
  morphologyType: 'all',
  usageType: 'all',
  libraryMode: 'expressions',
  screen: 'library',
  drafts: [],
  translationDraft: null,
  selectedDrafts: new Set(),
  generating: false,
  controller: null,
  noteTimer: null,
  searchTimer: null,
  speechText: '',
  speechHandler: null,
  generatorInput: {
    language: 'English',
    learningTarget: '',
    category: '',
    topic: '',
    seedTerms: '',
    expansionMode: false,
    existingExpressions: [],
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
    noteTimer: null,
    searchTimer: null,
    detailTrail: [],
    libraryScrollTop: 0,
  };
  state.speechHandler = event => handleSpeakClick(event);
  container.addEventListener('click', state.speechHandler);
  render();
  return () => {
    persistOpenPersonalNote();
    persistOpenTranslationNote();
    clearTimeout(state.noteTimer);
    clearTimeout(state.searchTimer);
    window.speechSynthesis?.cancel?.();
    state.speechText = '';
    container.removeEventListener('click', state.speechHandler);
    state.speechHandler = null;
    if (state.container === container) state.container = null;
  };
}

function speakButton(text) {
  const value = String(text || '').trim();
  if (!value) return '';
  return `<button type="button" class="atlas-speak-btn" data-atlas-speak="${esc(value)}" aria-label="${esc(value)} を再生" title="英語を再生"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6l-5 4H4Zm12.4-2.3a6 6 0 0 1 0 8.6m2.7-11.3a10 10 0 0 1 0 14"/></svg><span class="sr-only">英語を再生</span></button>`;
}

function handleSpeakClick(event) {
  const button = event.target.closest?.('[data-atlas-speak]');
  if (!button || !state.container?.contains(button)) return;
  const text = String(button.dataset.atlasSpeak || '').trim();
  if (!text || !window.speechSynthesis || !window.SpeechSynthesisUtterance) {
    toast('この端末では英語の読み上げを利用できません', 'error');
    return;
  }
  event.preventDefault();
  if (state.speechText === text) {
    window.speechSynthesis.cancel();
    state.speechText = '';
    state.container.querySelectorAll('.atlas-speak-btn.is-speaking').forEach(item => item.classList.remove('is-speaking'));
    return;
  }
  window.speechSynthesis.cancel();
  state.container.querySelectorAll('.atlas-speak-btn.is-speaking').forEach(item => item.classList.remove('is-speaking'));
  const utterance = new SpeechSynthesisUtterance(text);
  const voices = window.speechSynthesis.getVoices?.() || [];
  const voice = voices.find(item => /samantha/i.test(item.name) && /^en/i.test(item.lang))
    || voices.find(item => /^en-US/i.test(item.lang))
    || voices.find(item => /^en/i.test(item.lang));
  if (voice) utterance.voice = voice;
  utterance.lang = voice?.lang || 'en-US';
  utterance.rate = 0.88;
  utterance.pitch = 1;
  state.speechText = text;
  button.classList.add('is-speaking');
  const clear = () => {
    if (state.speechText !== text) return;
    state.speechText = '';
    button.classList.remove('is-speaking');
  };
  utterance.onend = clear;
  utterance.onerror = clear;
  window.speechSynthesis.speak(utterance);
}

export function hasActiveExpressionAtlasWork() {
  return state.generating;
}

function renderIfMounted() {
  if (state.container?.isConnected) render();
}

function markGeneratorBusy(formSelector, message) {
  const form = state.container?.querySelector(formSelector);
  if (!form) return;
  form.setAttribute('aria-busy', 'true');
  const submit = form.querySelector('button[type="submit"]');
  if (!submit) return;
  submit.disabled = true;
  submit.textContent = message;
}

export function backFromExpressionAtlas() {
  if (!state.container) {
    nav('memo');
    return;
  }
  if (state.screen === 'generate' || state.screen === 'translate') {
    const originQuestionId = state.screen === 'generate' ? state.questionConversionId : '';
    state.controller?.abort();
    state.screen = 'library';
    state.generating = false;
    state.questionConversionId = '';
    if (originQuestionId) {
      state.questionId = originQuestionId;
      state.libraryMode = 'questions';
    }
    render();
    scrollMainToTop();
    return;
  }
  if (state.entryId) {
    persistOpenPersonalNote();
    if (!restorePreviousDetail()) {
      state.entryId = '';
      render();
      restoreMainScroll(state.libraryScrollTop);
    }
    return;
  }
  if (state.morphemeId) {
    if (restorePreviousDetail()) return;
    state.morphemeId = '';
    render();
    restoreMainScroll(state.libraryScrollTop);
    return;
  }
  if (state.usageId) {
    if (state.usageTrail.length) {
      state.usageId = state.usageTrail.pop();
      renderUsageDetail();
      scrollMainToTop();
      return;
    }
    if (restorePreviousDetail()) return;
    state.usageId = '';
    render();
    restoreMainScroll(state.libraryScrollTop);
    return;
  }
  if (state.translationId) {
    persistOpenTranslationNote();
    state.translationId = '';
    render();
    restoreMainScroll(state.libraryScrollTop);
    return;
  }
  if (state.questionId) {
    state.questionId = '';
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
  nav('memo');
}

function render() {
  if (!state.container) return;
  clearTimeout(state.searchTimer);
  state.searchTimer = null;
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
  if (state.questionId) {
    renderQuestionDetail();
    return;
  }
  if (state.morphemeId) {
    renderMorphologyDetail();
    return;
  }
  if (state.usageId) {
    renderUsageDetail();
    return;
  }
  if (state.libraryMode === 'morphology') {
    renderMorphologyLibrary();
    return;
  }
  if (state.libraryMode === 'usage') {
    renderUsageLibrary();
    return;
  }
  if (state.libraryMode === 'questions') {
    renderQuestionLibrary();
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
  const { entries, visibleEntries, categories, topics, level, unifiedResults } = view;

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
        <span class="atlas-count" id="atlas-count">${state.search ? unifiedResults.total : (visibleEntries.length || (!state.category ? entries.length : 0))} items</span>
      </div>

      <div class="atlas-library" id="atlas-library">
        ${renderLibraryContent({ level, entries: visibleEntries, categories, topics, allEntries: entries, unifiedResults })}
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
  const unifiedResults = getUnifiedSearchResults(query, entries);
  const matchingEntries = query
    ? entries.filter(entry => searchableText(entry).includes(query))
    : entries;
  const visibleEntries = matchingEntries
    .map(entry => query ? entry : projectExpressionForPlacement(entry, state.category, state.topic))
    .filter(Boolean);
  const placements = entries.flatMap(expressionPlacements);
  const categories = unique(placements.map(item => item.category).filter(Boolean));
  const topics = unique(placements
    .filter(item => !state.category || item.category === state.category)
    .map(item => item.topic)
    .filter(Boolean));
  const level = query || state.topic ? 'entries' : state.category ? 'topics' : 'categories';
  return { entries, visibleEntries, categories, topics, level, unifiedResults };
}

function expressionPlacements(entry) {
  const senses = Array.isArray(entry?.senses) && entry.senses.length ? entry.senses : [entry];
  const placements = senses.map(sense => ({
    sense,
    category: sense.category || entry.category || '',
    topic: sense.topic || entry.topic || '',
  }));
  const seen = new Set();
  return placements.filter(item => {
    const key = `${item.category}|${item.topic}|${item.sense?.senseId || item.sense?.coreMeaningJa || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function projectExpressionForPlacement(entry, category = '', topic = '') {
  const placement = expressionPlacements(entry).find(item => (
    (!category || item.category === category) && (!topic || item.topic === topic)
  ));
  if (!placement) return null;
  return {
    ...entry,
    ...placement.sense,
    id: entry.id,
    term: entry.term,
    lemma: entry.lemma,
    category: placement.category,
    topic: placement.topic,
    senses: entry.senses,
  };
}

function wireLibraryShell() {
  state.container.querySelector('#atlas-generate-open')?.addEventListener('click', () => {
    state.screen = 'generate';
    state.drafts = [];
    state.selectedDrafts = new Set();
    state.generatorInput = {
      language: 'English',
      learningTarget: '',
      category: state.category || '',
      topic: state.topic || '',
      seedTerms: '',
      expansionMode: false,
      existingExpressions: [],
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
      <button type="button" role="tab" data-atlas-mode="morphology" aria-selected="${state.libraryMode === 'morphology'}" class="${state.libraryMode === 'morphology' ? 'active' : ''}">
        単語のしくみ
      </button>
      <button type="button" role="tab" data-atlas-mode="usage" aria-selected="${state.libraryMode === 'usage'}" class="${state.libraryMode === 'usage' ? 'active' : ''}">
        関係のしくみ
      </button>
      <button type="button" role="tab" data-atlas-mode="questions" aria-selected="${state.libraryMode === 'questions'}" class="${state.libraryMode === 'questions' ? 'active' : ''}">
        英語の疑問
      </button>
    </div>
  `;
}

function wireModeSwitch() {
  state.container?.querySelectorAll('[data-atlas-mode]').forEach(button => {
    button.addEventListener('click', () => {
      state.libraryMode = ['translations', 'morphology', 'usage', 'questions'].includes(button.dataset.atlasMode)
        ? button.dataset.atlasMode
        : 'expressions';
      state.search = '';
      state.category = '';
      state.topic = '';
      state.entryId = '';
      state.translationId = '';
      state.questionId = '';
      state.morphemeId = '';
      state.usageId = '';
      render();
      scrollMainToTop();
    });
  });
}

function renderUsageLibrary() {
  const query = normalize(state.search);
  const visible = ENGLISH_USAGE_CORE.filter(entry => {
    if (state.usageType !== 'all' && entry.type !== state.usageType) return false;
    if (!query) return true;
    return usageSearchText(entry).includes(query);
  });
  const labels = {
    all: `すべて ${ENGLISH_USAGE_CORE_STATS.total}`,
    preposition: `前置詞 ${ENGLISH_USAGE_CORE_STATS.prepositions}`,
    conjunction: `接続詞 ${ENGLISH_USAGE_CORE_STATS.conjunctions}`,
    particle: `パーティクル ${ENGLISH_USAGE_CORE_STATS.particles}`,
  };
  state.container.innerHTML = `
    <section class="atlas-page atlas-morphology-page">
      <header class="atlas-hero atlas-morphology-hero">
        <div>
          <p>文の中の位置・方向・時間・つながりを作る、小さくても意味を大きく動かす語の学習マップです。</p>
          <small>PREPOSITIONS · CONJUNCTIONS · PARTICLES</small>
        </div>
      </header>
      ${renderModeSwitch()}
      <div class="atlas-morphology-controls">
        <div class="atlas-segmented" role="group" aria-label="語の種類">
          ${Object.entries(labels).map(([value, label]) => `
            <button type="button" data-usage-type="${value}" class="${state.usageType === value ? 'active' : ''}">${esc(label)}</button>
          `).join('')}
        </div>
        <label class="atlas-search">
          <span class="sr-only">関係語を検索</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z"/></svg>
          <input id="atlas-usage-search" type="search" value="${esc(state.search)}" placeholder="例: out, in, because, 時間, 方向">
        </label>
      </div>
      <div class="atlas-morphology-summary" aria-live="polite">
        <span>${visible.length} 項目</span>
        <p>日本語の一語訳ではなく、核となる関係イメージから使い分けを追います。</p>
      </div>
      <div class="atlas-morphology-grid" id="atlas-usage-grid">
        ${visible.length ? visible.map(renderUsageCard).join('') : `
          <div class="atlas-empty atlas-empty--compact">
            <h2>一致する関係語がありません</h2>
            <p>英語、意味、または種類を変えて検索してください。</p>
          </div>
        `}
      </div>
    </section>
  `;
  wireModeSwitch();
  state.container.querySelectorAll('[data-usage-type]').forEach(button => {
    button.addEventListener('click', () => {
      state.usageType = button.dataset.usageType || 'all';
      renderUsageLibrary();
    });
  });
  const searchInput = state.container.querySelector('#atlas-usage-search');
  searchInput?.addEventListener('input', event => {
    state.search = event.target.value;
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => {
      renderUsageLibrary();
      requestAnimationFrame(() => {
        const input = state.container?.querySelector('#atlas-usage-search');
        if (!input) return;
        input.focus();
        try { input.setSelectionRange(input.value.length, input.value.length); } catch {}
      });
    }, 100);
  });
  state.container.querySelectorAll('[data-usage-id]').forEach(button => {
    button.addEventListener('click', () => {
      state.usageTrail = [];
      state.usageId = button.dataset.usageId;
      render();
      scrollMainToTop();
    });
  });
}

function renderUsageCard(entry) {
  return `
    <button class="atlas-morphology-card atlas-usage-card" type="button" data-usage-id="${esc(entry.id)}">
      <span class="atlas-morphology-card-top">
        <strong lang="en">${esc(entry.form)}</strong>
        <span>${esc(entry.typeLabel)}</span>
      </span>
      <span class="atlas-morphology-meaning">${esc(entry.coreImageJa)}</span>
      <span class="atlas-morphology-words">${esc(entry.patterns.slice(0, 2).join(' · '))}</span>
    </button>
  `;
}

function renderUsageDetail() {
  const entry = getEnglishUsageCoreEntry(state.usageId);
  if (!entry) {
    state.usageId = '';
    render();
    return;
  }
  const related = entry.related
    .flatMap(form => ENGLISH_USAGE_CORE.filter(candidate => candidate.form === form))
    .filter((candidate, index, all) => candidate.id !== entry.id && all.findIndex(item => item.id === candidate.id) === index);
  state.container.innerHTML = `
    <article class="atlas-page atlas-detail-page atlas-morphology-detail atlas-usage-detail">
      <nav class="atlas-breadcrumbs" aria-label="関係のしくみの階層">
        <button type="button" id="atlas-usage-root">関係のしくみ</button>
        ${state.usageTrail.length ? `<span aria-hidden="true">›</span><button type="button" id="atlas-usage-back">前の解説へ</button>` : ''}
        <span aria-hidden="true">›</span>
        <span>${esc(entry.typeLabel)}</span>
        <span aria-hidden="true">›</span>
        <span aria-current="page" lang="en">${esc(entry.form)}</span>
      </nav>
      <header class="atlas-detail-header atlas-morphology-detail-header">
        <div>
          <div class="atlas-kicker">${esc(entry.typeLabel.toUpperCase())}</div>
          <div class="atlas-word-heading"><h1 lang="en">${esc(entry.form)}</h1>${speakButton(entry.form)}</div>
          ${entry.pronunciation ? `<p class="atlas-pronunciation" lang="en">${esc(entry.pronunciation)}</p>` : ''}
          <p>${esc(entry.coreImageJa)}</p>
          <div class="atlas-detail-badges"><span>RELATIONSHIP WORD</span></div>
        </div>
      </header>
      ${renderUsageMotion(entry)}
      ${morphologySection(entry.type === 'particle' ? '句動詞での広がり' : 'コアイメージからの広がり', `<p>${esc(entry.detailJa)}</p>`)}
      ${entry.usageGuideJa ? morphologySection('使うときの考え方', `<p>${esc(entry.usageGuideJa)}</p>`) : ''}
      ${morphologySection('似た語との違い', `<p>${esc(entry.contrastJa)}</p>`)}
      ${morphologySection('よく使う形', `<ul class="atlas-note-list">${entry.patterns.map(pattern => `<li lang="en">${esc(pattern)}</li>`).join('')}</ul>`)}
      ${morphologySection('例文', `<div class="atlas-morphology-senses">${entry.examples.map(([english, japanese]) => `<div><div class="atlas-audio-line"><strong lang="en">${esc(english)}</strong>${speakButton(english)}</div><p>${esc(japanese)}</p></div>`).join('')}</div>`)}
      ${related.length ? morphologySection('関連して見る', `<div class="atlas-related-etymology">${related.map(item => `<button type="button" data-usage-related="${esc(item.id)}"><strong lang="en">${esc(item.form)}</strong><span>${esc(item.coreImageJa)}</span></button>`).join('')}</div>`) : ''}
      ${renderMorphologySources(entry.sourceRefs)}
    </article>
  `;
  state.container.querySelector('#atlas-usage-root')?.addEventListener('click', () => {
    state.usageTrail = [];
    state.usageId = '';
    render();
    scrollMainToTop();
  });
  state.container.querySelector('#atlas-usage-back')?.addEventListener('click', () => {
    state.usageId = state.usageTrail.pop() || '';
    render();
    scrollMainToTop();
  });
  state.container.querySelectorAll('[data-usage-related]').forEach(button => {
    button.addEventListener('click', () => {
      const nextId = button.dataset.usageRelated;
      if (!nextId || nextId === state.usageId) return;
      if (state.usageTrail.at(-1) !== state.usageId) {
        state.usageTrail.push(state.usageId);
        state.usageTrail = state.usageTrail.slice(-20);
      }
      state.usageId = nextId;
      renderUsageDetail();
      scrollMainToTop();
    });
  });
}

function renderRelationMotion(entry) {
  const kind = String(entry?.motionKind || '').trim();
  if (!kind) return '';
  const scenes = {
    point: `<span class="atlas-v-pin"><i></i></span><span class="atlas-v-pin-pulse"></span><span class="atlas-v-map-grid"></span>`,
    container: `<span class="atlas-v-contained-space"><i></i><i></i><i></i></span><span class="atlas-v-contained-focus"></span>`,
    enter: `<span class="atlas-v-room"><i></i></span><span class="atlas-v-person"></span><span class="atlas-v-boundary"></span>`,
    exit: `<span class="atlas-v-room"><i></i></span><span class="atlas-v-person"></span><span class="atlas-v-boundary"></span>`,
    surface: `<span class="atlas-v-shelf"></span><span class="atlas-v-block"><i></i></span><span class="atlas-v-contact"></span>`,
    land: `<span class="atlas-v-shelf"></span><span class="atlas-v-block"><i></i></span><span class="atlas-v-contact"></span>`,
    arrow: `<span class="atlas-v-route"></span><span class="atlas-v-package"></span><span class="atlas-v-destination"><i></i></span>`,
    purpose: `<span class="atlas-v-plane"></span><span class="atlas-v-target"><i></i><b></b></span>`,
    origin: `<span class="atlas-v-source-station"><i></i></span><span class="atlas-v-origin-arrow"></span><span class="atlas-v-origin-parcel"><i></i></span>`,
    portion: `<span class="atlas-v-whole"></span><span class="atlas-v-slice"></span>`,
    companion: `<span class="atlas-v-companion atlas-v-companion--one"><i></i></span><span class="atlas-v-companion atlas-v-companion--two"><i></i></span><span class="atlas-v-companion-link"></span>`,
    beside: `<span class="atlas-v-landmark"><i></i></span><span class="atlas-v-bystander"></span><span class="atlas-v-near-mark"></span>`,
    orbit: `<span class="atlas-v-sun"></span><span class="atlas-v-orbit"></span><span class="atlas-v-planet"></span>`,
    arch: `<span class="atlas-v-obstacle"></span><span class="atlas-v-arc"></span><span class="atlas-v-ball"></span>`,
    shelter: `<span class="atlas-v-roof"></span><span class="atlas-v-sheltered"><i></i></span><span class="atlas-v-rain atlas-v-rain--one"></span><span class="atlas-v-rain atlas-v-rain--two"></span><span class="atlas-v-rain atlas-v-rain--three"></span>`,
    between: `<span class="atlas-v-post atlas-v-post--one"></span><span class="atlas-v-post atlas-v-post--two"></span><span class="atlas-v-between-bead"></span><span class="atlas-v-between-line"></span>`,
    cluster: `<span class="atlas-v-cluster"><i></i><i></i><i></i><i></i><i></i><b class="atlas-v-cluster-focus"></b></span>`,
    tunnel: `<span class="atlas-v-tunnel"></span><span class="atlas-v-train"><i></i><i></i><b></b></span>`,
    cross: `<span class="atlas-v-river"><i></i><i></i><i></i></span><span class="atlas-v-boat"></span>`,
    along: `<svg class="atlas-v-along-map" viewBox="0 0 420 126" preserveAspectRatio="none"><path d="M24 91 C100 91 92 35 176 35 S256 101 396 62"></path></svg><span class="atlas-v-trail-start"></span><span class="atlas-v-trail-end"></span><span class="atlas-v-hiker"><i></i><b></b></span>`,
    press: `<span class="atlas-v-wall"></span><span class="atlas-v-spring"></span><span class="atlas-v-pusher"></span>`,
    'timeline-before': `<span class="atlas-v-timeline"></span><span class="atlas-v-reference"></span><span class="atlas-v-event"></span>`,
    'timeline-after': `<span class="atlas-v-timeline"></span><span class="atlas-v-reference"></span><span class="atlas-v-event"></span>`,
    duration: `<span class="atlas-v-duration-band"></span><span class="atlas-v-clock"><i></i></span>`,
    'timeline-from': `<span class="atlas-v-since-start"></span><span class="atlas-v-since-line"></span><span class="atlas-v-now"></span>`,
    deadline: `<span class="atlas-v-deadline-track"></span><span class="atlas-v-deadline-fill"></span><span class="atlas-v-stop"></span>`,
    absence: `<span class="atlas-v-expected"></span><span class="atlas-v-missing"><i></i></span>`,
    join: `<span class="atlas-v-puzzle atlas-v-puzzle--one"></span><span class="atlas-v-puzzle atlas-v-puzzle--two"></span>`,
    turn: `<svg class="atlas-v-turn-map" viewBox="0 0 420 126" preserveAspectRatio="none"><path d="M70 18 V83 Q70 106 94 106 H356"></path></svg><span class="atlas-v-turn-car"><i></i><b></b></span>`,
    fork: `<span class="atlas-v-fork"></span><span class="atlas-v-choice atlas-v-choice--one"></span><span class="atlas-v-choice atlas-v-choice--two"></span>`,
    result: `<span class="atlas-v-domino atlas-v-domino--one"></span><span class="atlas-v-domino atlas-v-domino--two"></span><span class="atlas-v-domino atlas-v-domino--three"></span><span class="atlas-v-result-star"></span>`,
    cause: `<span class="atlas-v-switch"><i></i></span><span class="atlas-v-wire"></span><span class="atlas-v-lamp"><i></i></span>`,
    contrast: `<span class="atlas-v-contrast-side atlas-v-contrast-side--one"></span><span class="atlas-v-contrast-side atlas-v-contrast-side--two"></span><span class="atlas-v-contrast-divider"></span>`,
    condition: `<span class="atlas-v-key"></span><span class="atlas-v-gate"><i></i></span><span class="atlas-v-gate-result"><i></i></span>`,
    parallel: `<span class="atlas-v-lane atlas-v-lane--one"><i class="atlas-v-activity-card"><b></b></i></span><span class="atlas-v-lane atlas-v-lane--two"><i class="atlas-v-activity-card"><b></b></i></span><span class="atlas-v-parallel-link"></span>`,
    trigger: `<span class="atlas-v-bell"><i></i></span><span class="atlas-v-trigger-wave atlas-v-trigger-wave--one"></span><span class="atlas-v-trigger-wave atlas-v-trigger-wave--two"></span><span class="atlas-v-trigger-result"></span>`,
  };
  const word = String(entry.form || '').toUpperCase();
  return `
    <figure class="atlas-usage-motion atlas-visual-motion" data-motion-kind="${esc(kind)}" aria-label="${esc(`${entry.form} の核イメージ。${entry.motionSummaryJa || entry.coreImageJa || ''}`)}">
      <div class="atlas-usage-motion-stage" aria-hidden="true">
        ${scenes[kind] || scenes.arrow}
        <span class="atlas-motion-word">${esc(word)}</span>
      </div>
      <figcaption>${esc(entry.motionSummaryJa || entry.coreImageJa || '')}</figcaption>
    </figure>
  `;
}

function renderUsageMotion(entry) {
  if (entry.id === 'particle-out') {
    return `
      <figure class="atlas-usage-motion atlas-usage-motion--out" aria-label="out の核イメージ。内側から外側へ連続して出る動き">
        <div class="atlas-usage-motion-stage" aria-hidden="true">
          <span class="atlas-motion-scene-label atlas-motion-scene-label--inside">INSIDE</span>
          <span class="atlas-motion-scene-label atlas-motion-scene-label--outside">VISIBLE</span>
          <span class="atlas-out-box"><i></i><b></b></span>
          <span class="atlas-out-boundary"><i></i></span>
          <span class="atlas-motion-object-label atlas-motion-object-label--stored">STORED</span>
          <span class="atlas-motion-object-label atlas-motion-object-label--boundary">BOUNDARY</span>
          <span class="atlas-motion-object-label atlas-motion-object-label--revealed">REVEALED</span>
          <span class="atlas-out-card atlas-out-card--one"><i></i><i></i><i></i></span>
          <span class="atlas-out-card atlas-out-card--two"><i></i><i></i><i></i></span>
          <span class="atlas-out-spark atlas-out-spark--one">✦</span>
          <span class="atlas-out-spark atlas-out-spark--two">✦</span>
          <span class="atlas-motion-word">OUT</span>
        </div>
        <figcaption>内側にあったものが、境界を越えて外に現れる。</figcaption>
      </figure>
    `;
  }
  if (entry.id === 'particle-up') {
    return `
      <figure class="atlas-usage-motion atlas-usage-motion--up" aria-label="up の核イメージ。下から上へ連続して上がる動き">
        <div class="atlas-usage-motion-stage" aria-hidden="true">
          <span class="atlas-motion-scene-label atlas-motion-scene-label--low">LOW</span>
          <span class="atlas-motion-scene-label atlas-motion-scene-label--higher">HIGHER</span>
          <span class="atlas-up-rail"><i></i><i></i><i></i></span>
          <span class="atlas-up-platform"><i></i></span>
          <span class="atlas-motion-object-label atlas-motion-object-label--lift">LIFT</span>
          <span class="atlas-up-card"><i></i><i></i><i></i></span>
          <span class="atlas-up-finish">✓</span>
          <span class="atlas-motion-word">UP</span>
        </div>
        <figcaption>下から上へ動き、完了・増加・持ち上げる感覚へ広がる。</figcaption>
      </figure>
    `;
  }
  if (entry.motionKind === 'in') {
    return `
      <figure class="atlas-usage-motion atlas-usage-motion--in" aria-label="in の核イメージ。外側のカードが境界を通って収納トレイの中へ入る動き">
        <div class="atlas-usage-motion-stage" aria-hidden="true">
          <span class="atlas-motion-scene-label atlas-motion-scene-label--inside">INSIDE</span>
          <span class="atlas-motion-scene-label atlas-motion-scene-label--outside">OUTSIDE</span>
          <span class="atlas-in-boundary"><i></i></span>
          <span class="atlas-in-tray"><i></i><b></b></span>
          <span class="atlas-motion-object-label atlas-motion-object-label--boundary">BOUNDARY</span>
          <span class="atlas-motion-object-label atlas-motion-object-label--stored">SETTLED</span>
          <span class="atlas-in-card"><i></i><i></i><i></i></span>
          <span class="atlas-motion-word">IN</span>
        </div>
        <figcaption>${esc(entry.motionSummaryJa || entry.coreImageJa)}</figcaption>
      </figure>
    `;
  }
  if (entry.motionKind === 'off') {
    return `
      <figure class="atlas-usage-motion atlas-usage-motion--off" aria-label="off の核イメージ。面に付いていた札が離れて接続が切れる動き">
        <div class="atlas-usage-motion-stage" aria-hidden="true">
          <span class="atlas-motion-scene-label atlas-motion-scene-label--inside">CONNECTED</span>
          <span class="atlas-motion-scene-label atlas-motion-scene-label--outside">SEPARATED</span>
          <span class="atlas-off-surface"><i></i><i></i></span>
          <span class="atlas-off-pin atlas-off-pin--one"></span>
          <span class="atlas-off-pin atlas-off-pin--two"></span>
          <span class="atlas-off-note"><i></i><i></i><i></i></span>
          <span class="atlas-motion-object-label atlas-motion-object-label--stored">CONTACT</span>
          <span class="atlas-motion-object-label atlas-motion-object-label--revealed">RELEASED</span>
          <span class="atlas-motion-word">OFF</span>
        </div>
        <figcaption>${esc(entry.motionSummaryJa || entry.coreImageJa)}</figcaption>
      </figure>
    `;
  }
  if (entry.motionKind === 'through') {
    return `
      <figure class="atlas-usage-motion atlas-usage-motion--through" aria-label="through の核イメージ。カードが通路の中を入口から出口まで通り抜ける動き">
        <div class="atlas-usage-motion-stage" aria-hidden="true">
          <span class="atlas-motion-scene-label atlas-motion-scene-label--inside">ENTER</span>
          <span class="atlas-motion-scene-label atlas-motion-scene-label--outside">EXIT</span>
          <span class="atlas-through-tunnel"><i></i><i></i><i></i><i></i></span>
          <span class="atlas-through-card"><i></i><i></i><i></i></span>
          <span class="atlas-motion-object-label atlas-motion-object-label--boundary">INSIDE THE PATH</span>
          <span class="atlas-motion-word">THROUGH</span>
        </div>
        <figcaption>${esc(entry.motionSummaryJa || entry.coreImageJa)}</figcaption>
      </figure>
    `;
  }
  if (entry.motionKind === 'down') {
    return `
      <figure class="atlas-usage-motion atlas-usage-motion--down" aria-label="down の核イメージ。カードが上から下の面へ降りて固定される動き">
        <div class="atlas-usage-motion-stage" aria-hidden="true">
          <span class="atlas-motion-scene-label atlas-motion-scene-label--higher">ABOVE</span>
          <span class="atlas-motion-scene-label atlas-motion-scene-label--low">SETTLED</span>
          <span class="atlas-down-page"><i></i><i></i><i></i></span>
          <span class="atlas-down-card"><i></i><i></i><i></i></span>
          <span class="atlas-motion-object-label atlas-motion-object-label--boundary">WRITE / FIX</span>
          <span class="atlas-motion-word">DOWN</span>
        </div>
        <figcaption>${esc(entry.motionSummaryJa || entry.coreImageJa)}</figcaption>
      </figure>
    `;
  }
  if (entry.motionKind === 'on') {
    return `
      <figure class="atlas-usage-motion atlas-usage-motion--on" aria-label="on の核イメージ。光の流れが接続を保ちながら前へ続く動き">
        <div class="atlas-usage-motion-stage" aria-hidden="true">
          <span class="atlas-motion-scene-label atlas-motion-scene-label--inside">START</span>
          <span class="atlas-motion-scene-label atlas-motion-scene-label--outside">CONTINUE</span>
          <span class="atlas-on-track"><i></i><i></i><i></i><i></i></span>
          <span class="atlas-on-signal atlas-on-signal--one"></span><span class="atlas-on-signal atlas-on-signal--two"></span>
          <span class="atlas-motion-object-label atlas-motion-object-label--boundary">CONNECTED FLOW</span>
          <span class="atlas-motion-word">ON</span>
        </div>
        <figcaption>${esc(entry.motionSummaryJa || entry.coreImageJa)}</figcaption>
      </figure>
    `;
  }
  if (entry.motionKind === 'over') {
    return `
      <figure class="atlas-usage-motion atlas-usage-motion--over" aria-label="over の核イメージ。カードが障害の上を越えて反対側へ渡る動き">
        <div class="atlas-usage-motion-stage" aria-hidden="true">
          <span class="atlas-motion-scene-label atlas-motion-scene-label--inside">THIS SIDE</span>
          <span class="atlas-motion-scene-label atlas-motion-scene-label--outside">OTHER SIDE</span>
          <span class="atlas-over-bridge"><i></i></span><span class="atlas-over-block"></span>
          <span class="atlas-over-card"><i></i><i></i><i></i></span>
          <span class="atlas-motion-object-label atlas-motion-object-label--boundary">CROSS / REVIEW</span>
          <span class="atlas-motion-word">OVER</span>
        </div>
        <figcaption>${esc(entry.motionSummaryJa || entry.coreImageJa)}</figcaption>
      </figure>
    `;
  }
  if (entry.motionKind === 'away') {
    return `
      <figure class="atlas-usage-motion atlas-usage-motion--away" aria-label="away の核イメージ。カードが中心から離れ、距離を広げていく動き">
        <div class="atlas-usage-motion-stage" aria-hidden="true">
          <span class="atlas-motion-scene-label atlas-motion-scene-label--inside">CENTER</span>
          <span class="atlas-motion-scene-label atlas-motion-scene-label--outside">FARTHER</span>
          <span class="atlas-away-center"></span><span class="atlas-away-ring atlas-away-ring--one"></span><span class="atlas-away-ring atlas-away-ring--two"></span>
          <span class="atlas-away-card"><i></i><i></i><i></i></span>
          <span class="atlas-motion-object-label atlas-motion-object-label--boundary">DISTANCE</span>
          <span class="atlas-motion-word">AWAY</span>
        </div>
        <figcaption>${esc(entry.motionSummaryJa || entry.coreImageJa)}</figcaption>
      </figure>
    `;
  }
  if (entry.motionKind === 'back') {
    return `
      <figure class="atlas-usage-motion atlas-usage-motion--back" aria-label="back の核イメージ。離れたカードが元のホームへ戻る動き">
        <div class="atlas-usage-motion-stage" aria-hidden="true">
          <span class="atlas-motion-scene-label atlas-motion-scene-label--inside">HOME</span>
          <span class="atlas-motion-scene-label atlas-motion-scene-label--outside">AWAY</span>
          <span class="atlas-back-home"><i></i></span><span class="atlas-back-route"><i></i><i></i><i></i></span>
          <span class="atlas-back-card"><i></i><i></i><i></i></span>
          <span class="atlas-motion-object-label atlas-motion-object-label--boundary">RETURN</span>
          <span class="atlas-motion-word">BACK</span>
        </div>
        <figcaption>${esc(entry.motionSummaryJa || entry.coreImageJa)}</figcaption>
      </figure>
    `;
  }
  if (entry.motionKind === 'around') {
    return `
      <figure class="atlas-usage-motion atlas-usage-motion--around" aria-label="around の核イメージ。カードが中心の周囲を回り込む動き">
        <div class="atlas-usage-motion-stage" aria-hidden="true">
          <span class="atlas-motion-scene-label atlas-motion-scene-label--inside">CENTER</span>
          <span class="atlas-motion-scene-label atlas-motion-scene-label--outside">AROUND</span>
          <span class="atlas-around-orbit"></span><span class="atlas-around-center"></span>
          <span class="atlas-around-card"><i></i><i></i><i></i></span>
          <span class="atlas-motion-object-label atlas-motion-object-label--boundary">AROUND THE EDGE</span>
          <span class="atlas-motion-word">AROUND</span>
        </div>
        <figcaption>${esc(entry.motionSummaryJa || entry.coreImageJa)}</figcaption>
      </figure>
    `;
  }
  return renderRelationMotion(entry);
}

function usageSearchText(entry) {
  return normalize([
    entry.form,
    entry.type,
    entry.typeLabel,
    entry.coreImageJa,
    entry.detailJa,
    entry.contrastJa,
    ...(entry.patterns || []),
    ...(entry.related || []),
    ...(entry.examples || []).flat(),
  ].join(' '));
}

function renderMorphologyLibrary() {
  const query = normalize(state.search);
  const visible = ETYMOLOGY_CORE.filter(entry => {
    if (state.morphologyType !== 'all' && entry.type !== state.morphologyType) return false;
    if (!query) return true;
    return morphologySearchText(entry).includes(query);
  });
  state.container.innerHTML = `
    <section class="atlas-page atlas-morphology-page">
      <header class="atlas-hero atlas-morphology-hero">
        <div>
          <p>接頭辞・接尾辞・語根から、単語の意味がどう組み立てられたかをたどります。</p>
        </div>
      </header>
      ${renderModeSwitch()}
      <div class="atlas-morphology-controls">
        <div class="atlas-segmented" role="group" aria-label="語源の種類">
          ${[
            ['all', 'すべて'],
            ['prefix', `接頭辞 ${ETYMOLOGY_CORE_STATS.prefixes}`],
            ['suffix', `接尾辞 ${ETYMOLOGY_CORE_STATS.suffixes}`],
            ['root', `語根 ${ETYMOLOGY_CORE_STATS.roots}`],
          ].map(([value, label]) => `
            <button type="button" data-morphology-type="${value}" class="${state.morphologyType === value ? 'active' : ''}">${label}</button>
          `).join('')}
        </div>
        <label class="atlas-search">
          <span class="sr-only">語源を検索</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z"/></svg>
          <input id="atlas-morphology-search" type="search" value="${esc(state.search)}" placeholder="形・意味・関連語を検索">
        </label>
      </div>
      <div class="atlas-morphology-summary" aria-live="polite">
        <span>${visible.length} 件</span>
        <p>語源は意味を暗記する規則ではなく、意味が広がった道筋を理解する手がかりです。</p>
      </div>
      <div class="atlas-morphology-grid" id="atlas-morphology-grid">
        ${visible.length ? visible.map(renderMorphologyCard).join('') : `
          <div class="atlas-empty atlas-empty--compact">
            <h2>一致する語源がありません</h2>
            <p>形を短くするか、別の種類を選んでください。</p>
          </div>
        `}
      </div>
    </section>
  `;
  wireModeSwitch();
  state.container.querySelectorAll('[data-morphology-type]').forEach(button => {
    button.addEventListener('click', () => {
      state.morphologyType = button.dataset.morphologyType || 'all';
      renderMorphologyLibrary();
    });
  });
  const searchInput = state.container.querySelector('#atlas-morphology-search');
  searchInput?.addEventListener('input', event => {
    state.search = event.target.value;
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => {
      renderMorphologyLibrary();
      requestAnimationFrame(() => {
        const input = state.container?.querySelector('#atlas-morphology-search');
        if (!input) return;
        input.focus();
        try { input.setSelectionRange(input.value.length, input.value.length); } catch {}
      });
    }, 100);
  });
  state.container.querySelectorAll('[data-morpheme-id]').forEach(button => {
    button.addEventListener('click', () => {
      state.morphemeId = button.dataset.morphemeId;
      render();
      scrollMainToTop();
    });
  });
}

function renderMorphologyCard(entry) {
  return `
    <button class="atlas-morphology-card" type="button" data-morpheme-id="${esc(entry.id)}">
      <span class="atlas-morphology-card-top">
        <strong lang="en">${esc(entry.displayForm)}</strong>
        <span>${esc(entry.typeLabel)}</span>
      </span>
      <span class="atlas-morphology-meaning">${esc(entry.senses?.[0]?.labelJa || entry.quickSummaryJa)}</span>
      <span class="atlas-morphology-origin">${esc(entry.origin.language)} · ${esc(entry.origin.form)}</span>
      <span class="atlas-morphology-words">${entry.wordLinks.slice(0, 3).map(link => esc(link.term)).join(' · ')}</span>
    </button>
  `;
}

function renderMorphologyDetail() {
  const entry = getEtymologyCoreEntry(state.morphemeId);
  if (!entry) {
    state.morphemeId = '';
    render();
    return;
  }
  const expressionIndex = buildExpressionIndex(getExpressionEntries());
  const previousDetail = state.detailTrail.at(-1);
  state.container.innerHTML = `
    <article class="atlas-page atlas-detail-page atlas-morphology-detail">
      ${previousDetail ? `
        <button type="button" class="atlas-detail-history-back" id="atlas-morphology-history-back">
          <span aria-hidden="true">‹</span>
          前に見ていた項目へ
        </button>
      ` : ''}
      <nav class="atlas-breadcrumbs" aria-label="語源辞典の階層">
        <button type="button" id="atlas-morphology-root">単語のしくみ</button>
        <span aria-hidden="true">›</span>
        <span>${esc(entry.typeLabel)}</span>
        <span aria-hidden="true">›</span>
        <span aria-current="page">${esc(entry.displayForm)}</span>
      </nav>
      <header class="atlas-detail-header atlas-morphology-detail-header">
        <div>
          <div class="atlas-kicker">${esc(entry.typeLabel.toLocaleUpperCase())}</div>
          <h1 lang="en">${esc(entry.displayForm)}</h1>
          <p>${esc(entry.quickSummaryJa)}</p>
          <div class="atlas-detail-badges">
            <span>${esc(entry.origin.language)}</span>
          </div>
        </div>
      </header>
      ${morphologySection('まずこれだけ', `<p>${esc(entry.quickSummaryJa)}</p><p>${esc(entry.coreImageJa)}</p>`, true)}
      ${morphologySection('語源と原形', `
        <dl class="atlas-origin-grid">
          <div><dt>言語</dt><dd>${esc(entry.origin.language)}</dd></div>
          <div><dt>原形</dt><dd lang="en">${esc(entry.origin.form)}</dd></div>
          <div><dt>原義</dt><dd>${esc(entry.origin.meaningJa)}</dd></div>
        </dl>
        <p>${esc(entry.origin.noteJa)}</p>
      `)}
      ${morphologySection('コアイメージ', `<p>${esc(entry.coreImageJa)}</p><p>${esc(entry.semanticBridgeJa)}</p>`)}
      ${entry.deepDive?.nuanceJa ? morphologySection('ニュアンスの広がり', `<p>${esc(entry.deepDive.nuanceJa)}</p><p>${esc(entry.deepDive.relationJa || '')}</p>`) : ''}
      ${morphologySection('意味の分岐', `
        <div class="atlas-morphology-senses">
          ${(entry.senses || []).map(sense => `<div><strong>${esc(sense.labelJa)}</strong><p>${esc(sense.explanationJa)}</p></div>`).join('')}
        </div>
      `)}
      ${morphologySection('形の変化', `<ul class="atlas-note-list">${entry.formChanges.map(item => `<li>${esc(item)}</li>`).join('')}</ul>`)}
      ${morphologySection('単語分解と関連語', `
        <div class="atlas-word-breakdowns">
          ${entry.wordLinks.map(link => {
            const matches = findExpressionMatches(link.term, expressionIndex);
            return `
              <div class="atlas-word-breakdown">
                <div>
                  ${matches.length === 1
                    ? `<button type="button" class="atlas-inline-word-link" data-linked-entry="${esc(matches[0].id)}">${esc(link.term)}</button>`
                    : `<strong lang="en">${esc(link.term)}</strong>`}
                  <span>${esc(link.breakdownJa)}</span>
                </div>
                <p>${esc(link.bridgeJa)}</p>
                ${link.whatToNoticeJa ? `<small>${esc(link.whatToNoticeJa)}</small>` : ''}
              </div>
            `;
          }).join('')}
        </div>
      `)}
      ${entry.deepDive?.studyGuideJa?.length ? morphologySection('関連語の読み方', `<ul class="atlas-note-list">${entry.deepDive.studyGuideJa.map(item => `<li>${esc(item)}</li>`).join('')}</ul>`) : ''}
      ${entry.comparisons?.length ? morphologySection('似た語源との違い', `
        <div class="atlas-comparison-list">${entry.comparisons.map(item => `<div><strong>${esc(item.form)}</strong><p>${esc(item.differenceJa)}</p></div>`).join('')}</div>
      `) : ''}
      ${morphologySection('間違いやすいポイント', `<ul class="atlas-note-list atlas-note-list--warning">${entry.cautionsJa.map(item => `<li>${esc(item)}</li>`).join('')}</ul>`)}
      ${morphologySection('文法・品詞への作用', `<p>${esc(entry.grammarImpactJa)}</p>`)}
      ${renderRelatedMorphemes(entry.relatedIds)}
      ${renderMorphologySources(entry.sourceRefs)}
    </article>
  `;
  state.container.querySelector('#atlas-morphology-history-back')?.addEventListener('click', restorePreviousDetail);
  state.container.querySelector('#atlas-morphology-root')?.addEventListener('click', () => {
    state.detailTrail = [];
    state.morphemeId = '';
    render();
    scrollMainToTop();
  });
  state.container.querySelectorAll('[data-linked-entry]').forEach(button => {
    button.addEventListener('click', () => {
      openLinkedExpression(button.dataset.linkedEntry);
    });
  });
  state.container.querySelectorAll('[data-core-related]').forEach(button => {
    button.addEventListener('click', () => {
      openMorphologyDetail(button.dataset.coreRelated);
    });
  });
}

function morphologySection(title, content, open = false) {
  if (!String(content || '').trim()) return '';
  return `
    <details class="atlas-detail-section atlas-progressive-section" ${open ? 'open' : ''}>
      <summary>${esc(title)}</summary>
      <div class="atlas-progressive-content">${content}</div>
    </details>
  `;
}

function renderMorphologySources(sourceRefs) {
  if (!Array.isArray(sourceRefs) || !sourceRefs.length) return '';
  return `
    <details class="atlas-detail-section atlas-source-details">
      <summary>出典を見る</summary>
      <div class="atlas-source-list">
        ${sourceRefs.map(source => `
          <a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">
            <strong>${esc(source.title)}</strong>
            <span>${esc(source.organization)}</span>
          </a>
        `).join('')}
      </div>
    </details>
  `;
}

function renderRelatedMorphemes(relatedIds) {
  const related = (Array.isArray(relatedIds) ? relatedIds : [])
    .map(getEtymologyCoreEntry)
    .filter(Boolean);
  if (!related.length) return '';
  return morphologySection('関連する語源', `
    <div class="atlas-related-etymology">
      ${related.map(item => `
        <button type="button" data-core-related="${esc(item.id)}">
          <strong lang="en">${esc(item.displayForm)}</strong>
          <span>${esc(item.senses?.[0]?.labelJa || item.quickSummaryJa)}</span>
        </button>
      `).join('')}
    </div>
  `);
}

function morphologySearchText(entry) {
  return normalize([
    entry.form,
    entry.typeLabel,
    entry.quickSummaryJa,
    entry.origin?.language,
    entry.origin?.form,
    entry.origin?.meaningJa,
    entry.coreImageJa,
    entry.semanticBridgeJa,
    ...(entry.aliases || []),
    ...(entry.senses || []).flatMap(sense => [sense.labelJa, sense.explanationJa]),
    ...(entry.wordLinks || []).flatMap(link => [link.term, link.breakdownJa, link.bridgeJa]),
  ].filter(Boolean).join(' '));
}

function renderTranslationLibrary() {
  const sets = getTranslationSets();
  const query = normalize(state.search);
  const categories = [...new Set(sets.map(set => set.category).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'ja'));
  const visible = sets.filter(set => {
    if (state.category && set.category !== state.category) return false;
    return !query || searchableTranslationText(set).includes(query);
  });
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
        ${categories.length ? `
          <label class="atlas-translation-genre-filter">
            <span class="sr-only">英訳のジャンル</span>
            <select id="atlas-translation-category-filter">
              <option value="">すべてのジャンル</option>
              ${categories.map(category => `<option value="${esc(category)}"${state.category === category ? ' selected' : ''}>${esc(category)}</option>`).join('')}
            </select>
          </label>
        ` : ''}
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
  state.container.querySelector('#atlas-translation-category-filter')?.addEventListener('change', event => {
    state.category = event.target.value || '';
    renderTranslationLibrary();
  });
  const searchInput = state.container.querySelector('#atlas-translation-search');
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
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(applySearch, 0);
  });
  searchInput?.addEventListener('input', () => {
    if (composing) return;
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(applySearch, 120);
  });
  state.container.querySelectorAll('[data-translation-id]').forEach(card => {
    card.addEventListener('click', () => {
      state.translationId = card.dataset.translationId;
      render();
      scrollMainToTop();
    });
  });
}

const ENGLISH_QUESTION_STARTERS = [
  ['句動詞', '句動詞の particle はどういうイメージで覚えるといい？'],
  ['前置詞', 'in / on / at のコアイメージと使い分けを知りたい。'],
  ['接続詞', 'because / since / as のニュアンスの違いを知りたい。'],
  ['可算・不可算', 'work と works の違いを、数えられる意味も含めて知りたい。'],
];

function renderQuestionLibrary() {
  const questions = getEnglishQuestions();
  const query = normalize(state.search);
  const visible = query
    ? questions.filter(item => [item.questionJa, item.answer?.shortAnswerJa, item.answer?.explanationJa, ...(item.answer?.relatedTerms || [])].filter(Boolean).join(' ').toLocaleLowerCase().includes(query))
    : questions;
  state.container.innerHTML = `
    <section class="atlas-page atlas-question-page">
      <header class="atlas-hero">
        <p>学習中に浮かんだ疑問を、答え・例文・関連表現と一緒に残します。</p>
      </header>
      ${renderModeSwitch()}
      <section class="atlas-question-compose" aria-labelledby="atlas-question-heading">
        <div>
          <div class="atlas-kicker">QUESTION INBOX</div>
          <h2 id="atlas-question-heading">英語について聞く</h2>
          <p>質問は先に保存されます。通信が失敗しても、あとから回答を再試行できます。</p>
        </div>
        <form id="atlas-question-form">
          <textarea id="atlas-question-input" rows="3" required placeholder="例: look up と look for はどう違う？"></textarea>
          <div class="atlas-question-actions">
            <button class="btn btn-primary" type="submit" ${state.generating ? 'disabled' : ''}>${state.generating ? '回答を作成中…' : '質問して保存'}</button>
          </div>
        </form>
        <div class="atlas-question-starters" aria-label="質問例">
          ${ENGLISH_QUESTION_STARTERS.map(([label, prompt]) => `<button type="button" data-question-starter="${esc(prompt)}">${esc(label)}</button>`).join('')}
        </div>
      </section>
      <div class="atlas-toolbar atlas-question-toolbar">
        <label class="atlas-search">
          <span class="sr-only">英語の疑問を検索</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z"/></svg>
          <input id="atlas-question-search" type="search" value="${esc(state.search)}" placeholder="質問・回答・関連語を検索">
        </label>
        <span class="atlas-count">${visible.length} questions</span>
      </div>
      <div class="atlas-library">
        ${visible.length ? `<div class="atlas-entry-grid">${visible.map(renderQuestionCard).join('')}</div>` : `<div class="atlas-empty atlas-empty--compact"><h2>${questions.length ? '一致する疑問がありません' : '英語の疑問を残していきましょう'}</h2><p>${questions.length ? '言葉を短くして検索してください。' : '句動詞、前置詞、文法、単語の違いなど、途中で浮かんだ疑問をそのまま書けます。'}</p></div>`}
      </div>
    </section>
  `;
  wireModeSwitch();
  state.container.querySelector('#atlas-question-form')?.addEventListener('submit', handleEnglishQuestionSubmit);
  state.container.querySelectorAll('[data-question-starter]').forEach(button => {
    button.addEventListener('click', () => {
      const input = state.container?.querySelector('#atlas-question-input');
      if (!input) return;
      input.value = button.dataset.questionStarter || '';
      input.focus();
    });
  });
  const search = state.container.querySelector('#atlas-question-search');
  let composing = false;
  const applySearch = () => {
    state.search = search?.value || '';
    renderQuestionLibrary();
    requestAnimationFrame(() => {
      const input = state.container?.querySelector('#atlas-question-search');
      if (!input) return;
      input.focus();
      try { input.setSelectionRange(input.value.length, input.value.length); } catch {}
    });
  };
  search?.addEventListener('compositionstart', () => { composing = true; });
  search?.addEventListener('compositionend', () => {
    composing = false;
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(applySearch, 0);
  });
  search?.addEventListener('input', () => {
    if (composing) return;
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(applySearch, 120);
  });
  state.container.querySelectorAll('[data-question-id]').forEach(button => {
    button.addEventListener('click', () => {
      state.questionId = button.dataset.questionId;
      render();
      scrollMainToTop();
    });
  });
}

function renderQuestionCard(item) {
  const status = item.status === 'ready' ? '回答済み' : item.status === 'failed' ? '再試行できます' : '回答待ち';
  return `<button class="atlas-entry-card atlas-question-card" type="button" data-question-id="${esc(item.id)}">
    <span class="atlas-entry-topline"><strong>${esc(item.questionJa)}</strong><span>${esc(status)}</span></span>
    <span class="atlas-question-preview">${esc(item.answer?.shortAnswerJa || '質問は安全に保存されています。')}</span>
    <span class="atlas-entry-path">${esc(item.answer?.suggestedCategory || 'English question')}</span>
  </button>`;
}

async function handleEnglishQuestionSubmit(event) {
  event.preventDefault();
  if (state.generating) return;
  const questionJa = state.container?.querySelector('#atlas-question-input')?.value.trim() || '';
  if (!questionJa) return;
  const questionKey = questionJa.normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase();
  const existing = getEnglishQuestions().find(item => (
    String(item.questionJa || '').normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase() === questionKey
  ));
  if (existing) {
    state.questionId = existing.id;
    toast('同じ疑問はすでに保存されています。既存の回答を開きます。', 'info');
    render();
    return;
  }
  const saved = addEnglishQuestion({ questionJa, status: 'pending', answer: null });
  if (!saved) {
    toast('質問を保存できませんでした。入力内容は画面に残しています', 'error');
    return;
  }
  state.questionId = saved.id;
  await answerEnglishQuestion(saved);
}

async function answerEnglishQuestion(question) {
  if (!(await ensureAtlasAiReady())) {
    updateEnglishQuestion(question.id, { status: 'failed', errorMessage: 'AI設定またはログインが必要です' });
    toast('質問は保存しました。AI設定後に「回答を作る」で再試行できます。', 'info');
    render();
    return;
  }
  state.generating = true;
  state.controller = new AbortController();
  render();
  try {
    const answer = await answerEnglishLearningQuestion(question.questionJa, { signal: state.controller.signal });
    const updated = updateEnglishQuestion(question.id, { status: 'ready', answer, errorMessage: '' });
    if (!updated) throw new Error('回答を保存できませんでした。入力内容は残して、もう一度お試しください。');
    toast('回答を保存しました', 'success');
  } catch (error) {
    if (error?.name !== 'AbortError') {
      updateEnglishQuestion(question.id, { status: 'failed', errorMessage: error?.message || '回答を作成できませんでした' });
      toast('質問は保存済みです。あとから再試行できます。', 'error');
    }
  } finally {
    state.generating = false;
    state.controller = null;
    renderIfMounted();
  }
}

function renderQuestionDetail() {
  const item = getEnglishQuestions().find(question => question.id === state.questionId);
  if (!item) {
    state.questionId = '';
    render();
    return;
  }
  const answer = item.answer || {};
  const expressionIndex = buildExpressionIndex(getExpressionEntries());
  const createdEntries = getExpressionEntries().filter(entry => (item.atlasEntryIds || []).includes(entry.id));
  const related = (answer.relatedTerms || []).map(term => {
    const matches = findExpressionMatches(term, expressionIndex);
    return matches.length
      ? `<button class="atlas-related-term" type="button" data-question-related="${esc(term)}" data-linked-entries="${esc(matches.map(entry => entry.id).join(','))}" lang="en">${esc(term)}</button>`
      : `<span class="atlas-detail-badges"><span lang="en">${esc(term)}</span></span>`;
  }).join('');
  state.container.innerHTML = `
    <section class="atlas-page atlas-question-detail">
      <button class="atlas-back-inline" id="atlas-question-root" type="button"><span aria-hidden="true">←</span> 英語の疑問へ戻る</button>
      <header class="atlas-detail-header">
        <div><div class="atlas-kicker">ENGLISH QUESTION</div><h1>${esc(item.questionJa)}</h1></div>
        <button class="atlas-icon-btn atlas-delete-btn" id="atlas-delete-question" type="button" aria-label="この質問を削除" title="削除">×</button>
      </header>
      ${state.generating ? '<div class="atlas-question-progress"><span class="atlas-spinner" aria-hidden="true"></span> 回答を整理しています…</div>' : ''}
      ${item.status === 'failed' ? `<div class="atlas-question-error">${esc(item.errorMessage || '回答を作成できませんでした')}</div>` : ''}
      ${answer.shortAnswerJa ? `<section class="atlas-detail-section"><h2>まず答え</h2><p>${esc(answer.shortAnswerJa)}</p></section>` : ''}
      ${answer.intuitionJa ? `<section class="atlas-detail-section"><h2>コアイメージ</h2><p>${esc(answer.intuitionJa)}</p></section>` : ''}
      ${answer.explanationJa ? `<section class="atlas-detail-section"><h2>詳しく見る</h2><p>${esc(answer.explanationJa)}</p></section>` : ''}
      ${(answer.examples || []).length ? `<section class="atlas-detail-section"><h2>例文</h2><div class="atlas-example-list">${answer.examples.map(example => `<div><div class="atlas-audio-line"><strong lang="en">${esc(example.english)}</strong>${speakButton(example.english)}</div><span>${esc(example.japanese)}</span>${example.noteJa ? `<small>${esc(example.noteJa)}</small>` : ''}</div>`).join('')}</div></section>` : ''}
      ${related ? `<section class="atlas-detail-section"><h2>関連して調べる</h2><div class="atlas-detail-badges">${related}</div></section>` : ''}
      ${createdEntries.length ? `<section class="atlas-detail-section"><h2>この疑問から作ったAtlas項目</h2><div class="atlas-detail-badges">${createdEntries.map(entry => `<button class="atlas-related-term" type="button" data-question-atlas-entry="${esc(entry.id)}" lang="en">${esc(entry.term)}</button>`).join('')}</div></section>` : ''}
      ${(answer.cautionsJa || []).length ? listSection('注意点', answer.cautionsJa, 'atlas-note-list--warning') : ''}
      <div class="atlas-question-detail-actions">
        <button class="btn btn-primary" id="atlas-question-retry" type="button" ${state.generating ? 'disabled' : ''}>${answer.shortAnswerJa ? '回答を作り直す' : '回答を作る'}</button>
        ${answer.shortAnswerJa ? '<button class="btn btn-secondary" id="atlas-question-to-atlas" type="button">Atlas項目にする</button>' : ''}
      </div>
    </section>
  `;
  state.container.querySelector('#atlas-question-root')?.addEventListener('click', backFromExpressionAtlas);
  state.container.querySelector('#atlas-question-retry')?.addEventListener('click', () => answerEnglishQuestion(item));
  state.container.querySelector('#atlas-question-to-atlas')?.addEventListener('click', () => openQuestionAtlasConversion(item));
  state.container.querySelectorAll('[data-question-related]').forEach(button => {
    button.addEventListener('click', () => {
      const ids = String(button.dataset.linkedEntries || '').split(',').filter(Boolean);
      const matches = getExpressionEntries().filter(entry => ids.includes(entry.id));
      if (matches.length === 1) openLinkedExpression(matches[0].id);
      else if (matches.length > 1) showWordMatchPicker(button.dataset.questionRelated, matches);
    });
  });
  state.container.querySelectorAll('[data-question-atlas-entry]').forEach(button => {
    button.addEventListener('click', () => openLinkedExpression(button.dataset.questionAtlasEntry));
  });
  wireCollapsibleDetailSections();
  state.container.querySelector('#atlas-delete-question')?.addEventListener('click', () => {
    if (!window.confirm('この質問をTrashへ移動しますか？')) return;
    if (deleteEnglishQuestion(item.id)) {
      state.questionId = '';
      toast('質問をTrashへ移動しました', 'success');
      render();
    }
  });
}

function renderTranslationCard(set) {
  return `
    <button class="atlas-entry-card atlas-translation-card" type="button" data-translation-id="${esc(set.id)}">
      <span class="atlas-entry-topline">
        <strong lang="ja">${esc(set.sourceTextJa)}</strong>
      </span>
      <span class="atlas-entry-path">${esc(set.category)} › ${esc(set.topic)}</span>
    </button>
  `;
}

function openQuestionAtlasConversion(question) {
  const relatedTerms = Array.isArray(question.answer?.relatedTerms) ? question.answer.relatedTerms : [];
  state.questionConversionId = question.id;
  state.questionId = '';
  state.entryId = '';
  state.translationId = '';
  state.libraryMode = 'expressions';
  state.screen = 'generate';
  state.drafts = [];
  state.selectedDrafts = new Set();
  state.generatorInput = {
    language: 'English',
    learningTarget: question.questionJa || '',
    category: '',
    topic: '',
    seedTerms: relatedTerms.slice(0, 8).join(', '),
    expansionMode: false,
    existingExpressions: [],
  };
  render();
  scrollMainToTop();
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
          <p>明快・忠実、自然・会話、洗練・表現の3案を、情報を省かず比較します。</p>
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
          ${renderTranslationStyleGuide()}
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
  wireTranslationVocabularyLinks();
}

const TRANSLATION_STYLE_PRESENTATION = [
  { style: 'standard_faithful', labelJa: '明快・忠実', descriptionJa: '基本的な語彙で、原文の情報を省かず伝える' },
  { style: 'natural_conversational', labelJa: '自然・会話', descriptionJa: '実際の会話で選ばれやすい語順と表現にする' },
  { style: 'expressive_polished', labelJa: '洗練・表現', descriptionJa: '使える自然さを保ちながら、語感と流れを整える' },
];

function renderTranslationStyleGuide() {
  return `
    <div class="atlas-translation-style-guide" aria-label="3つの英訳の違い">
      ${TRANSLATION_STYLE_PRESENTATION.map(item => `
        <div>
          <strong>${esc(item.labelJa)}</strong>
          <span>${esc(item.descriptionJa)}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function renderTranslationVariant(variant, index) {
  const presentation = TRANSLATION_STYLE_PRESENTATION.find(item => item.style === variant.style)
    || TRANSLATION_STYLE_PRESENTATION[index];
  const patternTitle = presentation?.labelJa || variant.labelJa || `パターン ${index + 1}`;
  const expressionIndex = buildExpressionIndex(getExpressionEntries());
  const hasLinkedWords = tokenizeEnglishForLinks(variant.translation, expressionIndex)
    .some(part => part.token && isUsefulLinkedToken(part.token, expressionIndex));
  return `
    <article class="atlas-translation-variant">
      <h3 class="atlas-translation-pattern-title">Pattern ${index + 1}：${esc(patternTitle)}</h3>
      <div class="atlas-translation-variant-top">
        <span class="atlas-translation-number">${String(index + 1).padStart(2, '0')}</span>
        <div>
          <span class="atlas-translation-field-label">英文</span>
          <div class="atlas-audio-line"><strong class="atlas-translation-plain" lang="en">${esc(variant.translation)}</strong>${speakButton(variant.translation)}</div>
          ${hasLinkedWords ? `
            <div class="atlas-linked-translation" lang="en" hidden>${renderLinkedEnglishText(variant.translation, expressionIndex)}</div>
            <button class="atlas-vocabulary-toggle" type="button" aria-pressed="false">語彙を見る</button>
          ` : ''}
          <div class="atlas-detail-badges">
            ${variant.register ? `<span>${esc(variant.register)}</span>` : ''}
          </div>
        </div>
      </div>
      ${variant.backTranslationJa ? `<div class="atlas-back-translation"><span>和訳（逆翻訳）</span>${esc(variant.backTranslationJa)}</div>` : ''}
      ${translationImpression(variant.overallNuanceJa || variant.nuanceJa)}
      ${translationVocabularySection(variant.vocabularyNotes, expressionIndex)}
      ${translationComparisonSection(variant.comparisons, expressionIndex)}
      ${translationCautionsSection(variant.cautionsJa)}
    </article>
  `;
}

function renderLinkedEnglishText(text, expressionIndex) {
  return tokenizeEnglishForLinks(text, expressionIndex).map(part => {
    if (!part.token || !isUsefulLinkedToken(part.token, expressionIndex)) return esc(part.text);
    const matches = findExpressionMatches(part.token, expressionIndex);
    return `<button type="button" class="atlas-linked-token" data-linked-token="${esc(part.token)}" data-linked-entries="${esc(matches.map(entry => entry.id).join(','))}">${esc(part.text)}</button>`;
  }).join('');
}

function wireTranslationVocabularyLinks() {
  state.container?.querySelectorAll('.atlas-vocabulary-toggle').forEach(button => {
    button.addEventListener('click', () => {
      const variant = button.closest('.atlas-translation-variant');
      const plain = variant?.querySelector('.atlas-translation-plain');
      const linked = variant?.querySelector('.atlas-linked-translation');
      if (!plain || !linked) return;
      const active = button.getAttribute('aria-pressed') !== 'true';
      button.setAttribute('aria-pressed', String(active));
      button.textContent = active ? '通常表示に戻す' : '語彙を見る';
      plain.hidden = active;
      linked.hidden = !active;
    });
  });
  state.container?.querySelectorAll('[data-linked-token]').forEach(button => {
    button.addEventListener('click', () => {
      const ids = String(button.dataset.linkedEntries || '').split(',').filter(Boolean);
      const entries = getExpressionEntries().filter(entry => ids.includes(entry.id));
      if (entries.length === 1) {
        openLinkedExpression(entries[0].id);
      } else if (entries.length > 1) {
        showWordMatchPicker(button.dataset.linkedToken, entries);
      }
    });
  });
}

function openLinkedExpression(entryId) {
  persistCurrentDetailNotes();
  const currentDetail = getCurrentDetailState();
  if (currentDetail && !(currentDetail.kind === 'expression' && currentDetail.id === entryId)) {
    pushDetailHistory(currentDetail);
  }
  state.screen = 'library';
  state.libraryMode = 'expressions';
  state.entryId = '';
  state.translationId = '';
  state.questionId = '';
  state.morphemeId = '';
  state.usageId = '';
  state.entryId = entryId;
  render();
  scrollMainToTop();
}

function openMorphologyDetail(morphemeId) {
  if (!morphemeId) return;
  persistCurrentDetailNotes();
  const currentDetail = getCurrentDetailState();
  if (currentDetail && !(currentDetail.kind === 'morphology' && currentDetail.id === morphemeId)) {
    pushDetailHistory(currentDetail);
  }
  state.screen = 'library';
  state.entryId = '';
  state.translationId = '';
  state.questionId = '';
  state.usageId = '';
  state.morphemeId = morphemeId;
  state.libraryMode = 'morphology';
  render();
  scrollMainToTop();
}

function showWordMatchPicker(token, entries) {
  state.container?.querySelector('.atlas-word-picker')?.remove();
  const sheet = document.createElement('div');
  sheet.className = 'atlas-word-picker';
  sheet.innerHTML = `
    <button class="atlas-word-picker-backdrop" type="button" aria-label="閉じる"></button>
    <section role="dialog" aria-modal="true" aria-labelledby="atlas-word-picker-title">
      <div class="atlas-word-picker-handle" aria-hidden="true"></div>
      <header>
        <div><small>語義を選択</small><h2 id="atlas-word-picker-title">${esc(token)}</h2></div>
        <button type="button" class="atlas-icon-btn" data-word-picker-close aria-label="閉じる">×</button>
      </header>
      <div class="atlas-word-picker-options">
        ${entries.map(entry => `
          <button type="button" data-word-picker-entry="${esc(entry.id)}">
            <strong>${esc(entry.coreMeaningJa || entry.term)}</strong>
            <span>${esc([entry.partOfSpeech, entry.topic].filter(Boolean).join(' · '))}</span>
          </button>
        `).join('')}
      </div>
    </section>
  `;
  state.container?.appendChild(sheet);
  const close = () => sheet.remove();
  sheet.addEventListener('keydown', event => {
    if (event.key === 'Escape') close();
  });
  sheet.querySelector('.atlas-word-picker-backdrop')?.addEventListener('click', close);
  sheet.querySelector('[data-word-picker-close]')?.addEventListener('click', close);
  sheet.querySelectorAll('[data-word-picker-entry]').forEach(button => {
    button.addEventListener('click', () => openLinkedExpression(button.dataset.wordPickerEntry));
  });
  sheet.querySelector('[data-word-picker-close]')?.focus();
}

async function handleTranslationGenerate(event) {
  event.preventDefault();
  if (state.generating) return;
  if (!(await ensureAtlasAiReady())) {
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
  try {
    markGeneratorBusy('#atlas-translation-form', '\u82f1\u8a33\u3092\u4f5c\u6210\u4e2d\u2026');
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
    renderIfMounted();
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
  if (category && topic) {
    state.translationDraft = applyManualClassification(state.translationDraft, category, topic);
  }
}

function collectAtlasTaxonomy() {
  const expressionEntries = getExpressionEntries();
  const items = [...expressionEntries, ...getTranslationSets()];
  return collectStableTaxonomy(items).map(category => ({
    category: category.label,
    categoryId: category.id,
    aliases: category.aliases,
    topics: category.topics.map(topic => topic.label),
    topicRecords: category.topics.map(topic => ({
      ...topic,
      terms: unique(expressionEntries
        .filter(entry => entry.categoryId === category.id && entry.topicId === topic.id)
        .flatMap(entry => [entry.term, entry.lemma, ...(entry.aliases || [])])
        .filter(Boolean)),
    })),
  }));
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
      ${classificationEditor(set, 'translation')}
      ${Number(set.promptVersion || 1) < 2 ? detailSection('英訳の考え方', set.summaryJa) : ''}
      <section class="atlas-detail-section atlas-translation-detail-list">
        <h2>ニュアンス別英訳3パターン＆深掘り解説</h2>
        ${renderTranslationStyleGuide()}
        <div class="atlas-translation-variant-list">
          ${(set.variants || []).map((variant, index) => renderTranslationVariant(variant, index)).join('')}
        </div>
      </section>
      <section class="atlas-detail-section">
        <h2>自分のメモ</h2>
        <textarea id="atlas-translation-note" class="atlas-personal-note" rows="4" placeholder="気づいた違いや、覚えておきたい表現を記録">${esc(set.personalNote || '')}</textarea>
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
    persistOpenTranslationNote();
    if (deleteExpressionEntry(set.id)) {
      state.translationId = '';
      toast('英訳セットを削除しました');
      render();
    }
  });
  wireTranslationVocabularyLinks();
  wireClassificationEditor(set, 'translation');
  wireCollapsibleDetailSections();
}

function updateLibraryContent() {
  const library = state.container?.querySelector('#atlas-library');
  const count = state.container?.querySelector('#atlas-count');
  if (!library || !count) return;
  const { entries, visibleEntries, categories, topics, level, unifiedResults } = getLibraryView();
  count.textContent = `${state.search ? unifiedResults.total : (visibleEntries.length || (!state.category ? entries.length : 0))} items`;
  library.innerHTML = renderLibraryContent({
    level,
    entries: visibleEntries,
    categories,
    topics,
    allEntries: entries,
    unifiedResults,
  });
  wireLibraryContent();
}

function wireLibraryContent() {
  state.container?.querySelector('[data-atlas-empty-generate]')?.addEventListener('click', () => {
    state.screen = 'generate';
    state.generatorInput = {
      language: 'English',
      learningTarget: '',
      category: state.category || '',
      topic: state.topic || '',
      seedTerms: '',
      expansionMode: false,
      existingExpressions: [],
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
  state.container.querySelector('[data-atlas-expand-topic]')?.addEventListener('click', () => {
    const topicEntries = getExpressionEntries().filter(entry => (
      entry.category === state.category && entry.topic === state.topic
    ));
    state.screen = 'generate';
    state.drafts = [];
    state.selectedDrafts = new Set();
    state.generatorInput = {
      language: 'English',
      learningTarget: state.topic,
      category: state.category,
      topic: state.topic,
      seedTerms: '',
      expansionMode: true,
      existingExpressions: topicEntries.map(entry => ({
        term: entry.term,
        lemma: entry.lemma,
        aliases: entry.aliases || [],
        nuanceTypeJa: entry.nuanceTypeJa || '',
        intensityLevel: entry.intensityLevel || null,
        mapMode: entry.mapMode || '',
        mapAxisJa: entry.mapAxisJa || '',
        mapLowLabelJa: entry.mapLowLabelJa || '',
        mapHighLabelJa: entry.mapHighLabelJa || '',
      })),
    };
    render();
    scrollMainToTop();
  });
  state.container.querySelectorAll('[data-atlas-entry]').forEach(card => {
    card.addEventListener('click', () => {
      state.libraryScrollTop = getMainScrollTop();
      state.detailTrail = [];
      state.entryId = card.dataset.atlasEntry;
      render();
      scrollMainToTop();
    });
  });
  state.container.querySelectorAll('[data-atlas-translation-result]').forEach(card => {
    card.addEventListener('click', () => {
      state.libraryScrollTop = getMainScrollTop();
      state.detailTrail = [];
      state.translationId = card.dataset.atlasTranslationResult;
      render();
      scrollMainToTop();
    });
  });
  state.container.querySelectorAll('[data-atlas-morpheme-result]').forEach(card => {
    card.addEventListener('click', () => {
      state.libraryScrollTop = getMainScrollTop();
      state.detailTrail = [];
      state.morphemeId = card.dataset.atlasMorphemeResult;
      render();
      scrollMainToTop();
    });
  });
  state.container.querySelectorAll('[data-atlas-usage-result]').forEach(card => {
    card.addEventListener('click', () => {
      state.libraryScrollTop = getMainScrollTop();
      state.detailTrail = [];
      state.usageId = card.dataset.atlasUsageResult;
      render();
      scrollMainToTop();
    });
  });
  state.container.querySelectorAll('[data-atlas-theme-result]').forEach(card => {
    card.addEventListener('click', () => {
      state.category = card.dataset.atlasCategory || '';
      state.topic = card.dataset.atlasThemeResult || '';
      state.search = '';
      render();
      scrollMainToTop();
    });
  });
}

function renderLibraryContent({ level, entries, categories, topics, allEntries, unifiedResults }) {
  if (state.search) {
    return renderUnifiedSearchResults(unifiedResults);
  }
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
    return `${renderPersonalShelves(allEntries)}<div class="atlas-folder-grid">${categories.map(category => {
      const categoryEntries = allEntries
        .map(entry => projectExpressionForPlacement(entry, category, ''))
        .filter(Boolean);
      const count = categoryEntries.length;
      const topicCount = unique(categoryEntries.map(entry => entry.topic)).length;
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
      const topicEntries = allEntries
        .map(entry => projectExpressionForPlacement(entry, state.category, topic))
        .filter(Boolean);
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
    <div class="atlas-topic-actions">
      <button class="btn btn-secondary btn-sm" type="button" data-atlas-expand-topic>
        <span aria-hidden="true">＋</span> 別の表現を追加
      </button>
      <span>既存の${entries.length}語を除いて、このテーマを広げます。</span>
    </div>
    ${state.topic && !state.search ? renderNuanceMap(entries) : ''}
    <div class="atlas-entry-grid">${entries.map(renderEntryCard).join('')}</div>
  `;
}

function renderEntryCard(entry) {
  const intensityLevel = getIntensityLevel(entry);
  const partsOfSpeech = unique((entry.senses || [])
    .map(sense => sense?.partOfSpeech)
    .filter(Boolean));
  const partOfSpeechLabel = partsOfSpeech.length ? partsOfSpeech.join(' / ') : entry.partOfSpeech;
  const intensityLabel = getNuanceMapMode(entry) === 'groups'
    ? ''
    : (intensityLevel ? intensityStars(intensityLevel) : String(entry.intensity || '').trim());
  return `
    <button class="atlas-entry-card" type="button" data-atlas-entry="${esc(entry.id)}">
      <span class="atlas-entry-topline">
        <strong>${esc(entry.term)}</strong>
        ${partOfSpeechLabel ? `<span>${esc(partOfSpeechLabel)}</span>` : ''}
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

function getUnifiedSearchResults(query, entries = getExpressionEntries()) {
  if (!query) {
    return { expressions: [], themes: [], translations: [], morphemes: [], usage: [], total: 0 };
  }
  const expressions = entries.filter(entry => searchableText(entry).includes(query));
  const themeKeys = new Set();
  const themes = entries.reduce((items, entry) => {
    const text = normalize([
      entry.category,
      entry.topic,
      ...(entry.categoryAliases || []),
      ...(entry.topicAliases || []),
    ].join(' '));
    const key = `${entry.category}|${entry.topic}`;
    if (text.includes(query) && !themeKeys.has(key)) {
      themeKeys.add(key);
      items.push({ category: entry.category, topic: entry.topic });
    }
    return items;
  }, []);
  const translations = getTranslationSets().filter(set => searchableTranslationText(set).includes(query));
  const morphemes = ETYMOLOGY_CORE.filter(entry => morphologySearchText(entry).includes(query));
  const usage = ENGLISH_USAGE_CORE.filter(entry => usageSearchText(entry).includes(query));
  return {
    expressions,
    themes,
    translations,
    morphemes,
    usage,
    total: expressions.length + themes.length + translations.length + morphemes.length + usage.length,
  };
}

function renderUnifiedSearchResults(results) {
  if (!results.total) {
    return `
      <div class="atlas-empty atlas-empty--compact">
        <h2>一致する項目がありません</h2>
        <p>検索語を短くするか、別の言葉で検索してください。</p>
      </div>
    `;
  }
  const group = (title, items) => items.length ? `
    <section class="atlas-search-group">
      <h2>${esc(title)} <span>${items.length}</span></h2>
      <div class="atlas-search-result-list">${items.join('')}</div>
    </section>
  ` : '';
  return `<div class="atlas-unified-results">
    ${group('表現', results.expressions.map(renderEntryCard))}
    ${group('テーマ', results.themes.map(item => `
      <button type="button" class="atlas-search-result" data-atlas-theme-result="${esc(item.topic)}" data-atlas-category="${esc(item.category)}">
        <strong>${esc(item.topic)}</strong><span>${esc(item.category)}のテーマ</span>
      </button>
    `))}
    ${group('和文英訳', results.translations.map(item => `
      <button type="button" class="atlas-search-result" data-atlas-translation-result="${esc(item.id)}">
        <strong lang="ja">${esc(item.sourceTextJa)}</strong><span>${esc(item.category)} › ${esc(item.topic)}</span>
      </button>
    `))}
    ${group('単語のしくみ', results.morphemes.map(item => `
      <button type="button" class="atlas-search-result" data-atlas-morpheme-result="${esc(item.id)}">
        <strong lang="en">${esc(item.displayForm || item.form || item.id)}</strong><span>${esc(item.senses?.[0]?.labelJa || item.quickSummaryJa || '')}</span>
      </button>
    `))}
    ${group('関係のしくみ', results.usage.map(item => `
      <button type="button" class="atlas-search-result" data-atlas-usage-result="${esc(item.id)}">
        <strong lang="en">${esc(item.form || item.id)}</strong><span>${esc(item.coreImageJa || '')}</span>
      </button>
    `))}
  </div>`;
}

function renderPersonalShelves(entries) {
  const pinned = entries.filter(entry => entry.starred).slice(0, 6);
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const recent = getRecentEntryIds()
    .map(id => byId.get(id))
    .filter(entry => entry && !entry.starred)
    .slice(0, 6);
  if (!pinned.length && !recent.length) return '';
  const shelf = (title, items) => items.length ? `
    <section class="atlas-personal-shelf">
      <h2>${esc(title)}</h2>
      <div>${items.map(entry => `
        <button type="button" data-atlas-entry="${esc(entry.id)}">
          <strong lang="en">${esc(entry.term)}</strong>
          <span>${esc(entry.topic)}</span>
        </button>
      `).join('')}</div>
    </section>
  ` : '';
  return `<div class="atlas-personal-shelves">${shelf('ピン留め', pinned)}${shelf('最近見た項目', recent)}</div>`;
}

function renderDetail() {
  const entry = getExpressionEntries().find(item => item.id === state.entryId);
  if (!entry) {
    state.entryId = '';
    render();
    return;
  }
  rememberRecentEntry(entry.id);
  const intensityLevel = getIntensityLevel(entry);
  const sameWordElsewhere = findSameWordInOtherThemes(entry);
  const previousDetail = state.detailTrail.at(-1);
  const senses = Array.isArray(entry.senses) ? entry.senses.filter(Boolean) : [];
  const hasMultipleSenses = senses.length > 1;
  const partOfSpeechLabel = unique(senses.map(sense => sense?.partOfSpeech).filter(Boolean)).join(' / ')
    || entry.partOfSpeech;

  state.container.innerHTML = `
    <article class="atlas-page atlas-detail-page">
      ${previousDetail ? `
        <button type="button" class="atlas-detail-history-back" id="atlas-detail-history-back">
          <span aria-hidden="true">‹</span>
          前に見ていた項目へ
        </button>
      ` : ''}
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
          <div class="atlas-word-heading"><h1>${esc(entry.term)}</h1>${speakButton(entry.term)}</div>
          ${entry.pronunciation ? `<p class="atlas-pronunciation" lang="en">${esc(entry.pronunciation)}</p>` : ''}
          ${entry.sourceQueryJa ? `<p class="atlas-source-query">最初に調べたこと: ${esc(entry.sourceQueryJa)}</p>` : ''}
          <div class="atlas-detail-badges">
            ${partOfSpeechLabel ? `<span>${esc(partOfSpeechLabel)}</span>` : ''}
            ${entry.register ? `<span>${esc(entry.register)}</span>` : ''}
            ${getNuanceMapMode(entry) !== 'groups' && intensityLevel
              ? `<span aria-label="強さ5段階中${intensityLevel}">強さ ${intensityStars(intensityLevel)}</span>`
              : getNuanceMapMode(entry) !== 'groups' && entry.intensity ? `<span>強さ ${esc(entry.intensity)}</span>` : ''}
            ${entry.nuanceTypeJa ? `<span>${esc(entry.nuanceTypeJa)}</span>` : ''}
          </div>
        </div>
        <div class="atlas-detail-header-actions">
          <button class="atlas-icon-btn atlas-pin-btn ${entry.starred ? 'is-active' : ''}" id="atlas-pin" type="button" aria-pressed="${entry.starred ? 'true' : 'false'}" aria-label="${entry.starred ? 'ピン留めを外す' : 'ピン留めする'}" title="${entry.starred ? 'ピン留めを外す' : 'ピン留め'}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 4 6 6-3 1-4 4v4l-2 2-2-6-6-2 2-2h4l4-4 1-3Z"/></svg>
          </button>
          <button class="atlas-icon-btn atlas-delete-btn" id="atlas-delete" type="button" aria-label="この表現を削除" title="削除">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5"/></svg>
          </button>
        </div>
      </header>

      ${classificationEditor(entry, 'expression')}
      ${etymologyCoreSection(hasMultipleSenses ? { ...entry, coreMeaningJa: '' } : entry)}
      ${hasMultipleSenses ? expressionSensesSection(entry, senses) : `
        ${detailSection('深いニュアンス', entry.nuanceJa)}
        ${comparisonsSection(entry.comparisons, buildExpressionIndex(getExpressionEntries()))}
        ${listSection('自然に使われる場面', entry.useCasesJa)}
        ${usagePatternsSection(entry.usagePatterns)}
        ${examplesSection(entry.examples)}
        ${grammarNotesSection(entry.grammarNotes)}
        ${detailSection('感情の温度', entry.emotionalToneJa)}
        ${collocationsSection(entry.collocations, buildExpressionIndex(getExpressionEntries()))}
        ${listSection('注意点', entry.cautionsJa, 'atlas-note-list--warning')}
      `}
      ${sameWordElsewhere.length ? sameWordThemeSection(entry, sameWordElsewhere) : ''}
      ${relatedEtymologySection(entry)}

      <section class="atlas-detail-section">
        <h2>自分のメモ</h2>
        <textarea id="atlas-personal-note" class="atlas-personal-note" rows="4" placeholder="覚え方や、自分なりの違いを記録">${esc(entry.personalNote || '')}</textarea>
        <div class="atlas-note-actions">
          <button class="btn btn-primary btn-sm" id="atlas-save-note">メモを保存</button>
        </div>
      </section>
    </article>
  `;

  state.container.querySelector('#atlas-detail-history-back')?.addEventListener('click', restorePreviousDetail);
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
    persistOpenPersonalNote();
    if (deleteExpressionEntry(entry.id)) {
      state.entryId = '';
      toast('表現を削除しました');
      render();
    }
  });
  state.container.querySelector('#atlas-pin')?.addEventListener('click', () => {
    const scrollTop = getMainScrollTop();
    persistOpenPersonalNote();
    const updated = updateExpressionEntry(entry.id, { starred: !entry.starred });
    if (!updated) {
      toast('ピン留めを変更できませんでした', 'error');
      return;
    }
    renderDetail();
    restoreMainScroll(scrollTop);
    toast(updated.starred ? 'ピン留めしました' : 'ピン留めを外しました', 'success');
  });
  state.container.querySelectorAll('[data-atlas-same-word]').forEach(button => {
    button.addEventListener('click', () => openLinkedExpression(button.dataset.atlasSameWord));
  });
  state.container.querySelector('[data-atlas-same-word-more]')?.addEventListener('click', event => {
    const button = event.currentTarget;
    const more = button.previousElementSibling;
    const expanded = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', String(!expanded));
    if (more) more.hidden = expanded;
    button.textContent = expanded
      ? `ほか${more?.querySelectorAll('[data-atlas-same-word]').length || 0}件を見る`
      : '閉じる';
  });
  wireClassificationEditor(entry, 'expression');
  wireTranslationVocabularyLinks();
  wireRelatedEtymologyLinks();
  wireCollapsibleDetailSections();
}

function findSameWordInOtherThemes(entry) {
  const entries = getExpressionEntries();
  const matches = findExpressionMatches(entry.lemma || entry.term, buildExpressionIndex(entries));
  const seenThemes = new Set();
  return matches.filter(candidate => {
    if (candidate.id === entry.id) return false;
    const themeKey = `${candidate.categoryId || candidate.category}|${candidate.topicId || candidate.topic}`;
    const currentThemeKey = `${entry.categoryId || entry.category}|${entry.topicId || entry.topic}`;
    if (themeKey === currentThemeKey || seenThemes.has(themeKey)) return false;
    seenThemes.add(themeKey);
    return true;
  }).sort((a, b) => `${a.category} ${a.topic}`.localeCompare(`${b.category} ${b.topic}`, 'ja'));
}

function sameWordThemeSection(entry, matches) {
  const label = entry.lemma || entry.term;
  const visible = matches.slice(0, 3);
  const hidden = matches.slice(3);
  return `
    <section class="atlas-detail-section atlas-same-word-section">
      <h2>この語を別のテーマでも見る</h2>
      <p class="atlas-same-word-intro"><strong lang="en">${esc(label)}</strong> は、テーマによって焦点や説明が変わります。</p>
      <div class="atlas-same-word-list">
        ${visible.map(match => `
          <button class="atlas-same-word-link" type="button" data-atlas-same-word="${esc(match.id)}">
            <span lang="en">${esc(match.term)}</span>
            <small>${esc(match.category)} › ${esc(match.topic)}</small>
          </button>
        `).join('')}
        ${hidden.length ? `
          <div class="atlas-same-word-more" hidden>
            ${hidden.map(match => `
              <button class="atlas-same-word-link" type="button" data-atlas-same-word="${esc(match.id)}">
                <span lang="en">${esc(match.term)}</span>
                <small>${esc(match.category)} › ${esc(match.topic)}</small>
              </button>
            `).join('')}
          </div>
          <button class="atlas-same-word-more-toggle" type="button" data-atlas-same-word-more aria-expanded="false">
            ほか${hidden.length}件を見る
          </button>
        ` : ''}
      </div>
    </section>
  `;
}

function renderGenerator() {
  const input = state.generatorInput;
  const expansionTerms = (input.existingExpressions || []).map(item => item.term).filter(Boolean);
  state.container.innerHTML = `
    <section class="atlas-page atlas-generator-page">
      <header class="atlas-generator-header">
        <div>
          <div class="atlas-kicker">LANGUAGE WORKSHOP</div>
          <h1>表現を深掘りする</h1>
          <p>知りたい意味や英語表現を起点に、近い表現との違いまで一つのセットにまとめます。分類は内容から自動で整理されます。</p>
        </div>
      </header>

      ${input.expansionMode ? `
        <div class="atlas-expansion-context">
          <strong>${esc(input.category)} › ${esc(input.topic)}</strong>
          <span>既存の${expansionTerms.length}語を除き、まだ扱っていない意味や使用領域を探します。</span>
          <small>${esc(expansionTerms.join(' · '))}</small>
        </div>
      ` : ''}

      <form class="atlas-generator-form" id="atlas-generator-form">
        <label>
          <span>言語</span>
          <select id="atlas-language">
            <option value="English" ${input.language === 'English' ? 'selected' : ''}>English</option>
          </select>
        </label>
        <label class="atlas-generator-wide">
          <span>知りたい意味・表現 <small>必須</small></span>
          <input id="atlas-learning-target" required placeholder="例: 視点 / 遠慮する / bother / look forward to" value="${esc(input.learningTarget)}" ${input.expansionMode ? 'readonly' : ''}>
          <small class="atlas-field-help" id="atlas-query-mode-hint">${renderAtlasQueryModeHint(input.learningTarget)}</small>
        </label>
        <label class="atlas-generator-wide">
          <span>${input.expansionMode ? '追加で含めたい表現' : '含めたい表現'} <small>任意</small></span>
          <textarea id="atlas-seed-terms" rows="3" placeholder="happy, pleasure, delighted&#10;空欄ならAIが代表的な表現を選びます">${esc(input.seedTerms)}</textarea>
        </label>
        <div class="atlas-generator-wide atlas-generator-actions">
          <button class="btn btn-primary" id="atlas-generate-btn" type="submit" ${state.generating ? 'disabled' : ''}>
            ${state.generating ? '<span class="atlas-spinner" aria-hidden="true"></span> 作成中…' : (input.expansionMode ? '新しい表現を追加' : '表現セットを作成')}
          </button>
          ${state.generating ? '<button class="btn btn-secondary" id="atlas-cancel-generate" type="button">キャンセル</button>' : ''}
          <p>${input.expansionMode ? '既存語は除外し、有用な追加候補だけを保存します。' : '既存の語と重なった場合は、新しい説明で安全に更新されます。'}</p>
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
                    getNuanceMapMode(entry) === 'groups'
                      ? ''
                      : (getIntensityLevel(entry) ? intensityStars(getIntensityLevel(entry)) : entry.intensity),
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

  ['atlas-language', 'atlas-learning-target', 'atlas-seed-terms'].forEach(id => {
    state.container.querySelector(`#${id}`)?.addEventListener('input', () => {
      syncGeneratorInput();
      updateAtlasQueryModeHint();
    });
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
    const questionId = state.questionConversionId;
    if (questionId) {
      const question = getEnglishQuestions().find(item => item.id === questionId);
      if (question) {
        const previousIds = Array.isArray(question.atlasEntryIds) ? question.atlasEntryIds : [];
        updateEnglishQuestion(questionId, {
          atlasEntryIds: [...new Set([...previousIds, ...saved.map(entry => entry.id)])],
        });
      }
    }
    state.category = saved[0].category;
    state.topic = saved[0].topic;
    state.screen = 'library';
    state.drafts = [];
    state.selectedDrafts = new Set();
    state.questionConversionId = '';
    if (questionId) {
      state.questionId = questionId;
      state.libraryMode = 'questions';
      toast(`${saved.length}件をAtlasへ追加し、質問に関連付けました`, 'success');
    } else {
      toast(`${saved.length}件の表現を保存しました`, 'success');
    }
    render();
    scrollMainToTop();
  });
}

function renderAtlasQueryModeHint(value) {
  return detectAtlasQueryMode(value) === 'english_seed'
    ? '英語表現を中心語として、関連表現との違いまで深く解説します。'
    : '日本語の意味でも英単語でも、そのまま入力できます。';
}

function updateAtlasQueryModeHint() {
  const hint = state.container?.querySelector('#atlas-query-mode-hint');
  if (hint) hint.textContent = renderAtlasQueryModeHint(state.generatorInput.learningTarget);
}

async function handleGenerate(event) {
  event.preventDefault();
  if (state.generating) return;
  if (!(await ensureAtlasAiReady())) {
    toast('AIを利用するにはログインとAI設定が必要です', 'error');
    return;
  }
  syncGeneratorInput();
  const { language, learningTarget, seedTerms, expansionMode, existingExpressions } = state.generatorInput;
  if (!String(learningTarget || '').trim()) {
    toast('知りたい意味・表現を入力してください', 'error');
    return;
  }
  const taxonomy = collectAtlasTaxonomy();
  const allExpressions = getExpressionEntries();
  const exactReferences = findExpressionMatches(learningTarget, allExpressions);
  const referenceExpressions = [
    ...exactReferences,
    ...allExpressions.filter(entry => !exactReferences.some(match => match.id === entry.id)),
  ];

  state.generating = true;
  state.controller = new AbortController();
  try {
    markGeneratorBusy('#atlas-generator-form', '\u8868\u73fe\u30bb\u30c3\u30c8\u3092\u4f5c\u6210\u4e2d\u2026');
    const drafts = await generateNuanceEntries({
      language,
      learningTarget,
      category: expansionMode ? state.generatorInput.category : '',
      topic: expansionMode ? state.generatorInput.topic : '',
      seedTerms,
      existingExpressions: expansionMode ? existingExpressions : [],
      referenceExpressions,
      existingTaxonomy: taxonomy,
    }, { signal: state.controller.signal });
    state.generatorInput.category = drafts[0]?.category || '';
    state.generatorInput.topic = drafts[0]?.topic || '';
    state.drafts = drafts;
    state.selectedDrafts = new Set(drafts.map((_, index) => index));
    const saved = addExpressionEntries(drafts);
    if (!saved.length) throw new Error('\u751f\u6210\u7d50\u679c\u3092\u4fdd\u5b58\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002\u5165\u529b\u5185\u5bb9\u306f\u753b\u9762\u306b\u6b8b\u3057\u3066\u3044\u307e\u3059\u3002');

    const questionId = state.questionConversionId;
    if (questionId) {
      const question = getEnglishQuestions().find(item => item.id === questionId);
      if (question) {
        const previousIds = Array.isArray(question.atlasEntryIds) ? question.atlasEntryIds : [];
        updateEnglishQuestion(questionId, {
          atlasEntryIds: [...new Set([...previousIds, ...saved.map(entry => entry.id)])],
        });
      }
    }
    state.category = saved[0].category;
    state.topic = saved[0].topic;
    state.screen = 'library';
    state.drafts = [];
    state.selectedDrafts = new Set();
    state.questionConversionId = '';
    if (questionId) {
      state.questionId = questionId;
      state.libraryMode = 'questions';
      toast(`${saved.length}\u4ef6\u3092Atlas\u3078\u4fdd\u5b58\u3057\u3001\u8cea\u554f\u306b\u95a2\u9023\u4ed8\u3051\u307e\u3057\u305f`, 'success');
    } else {
      toast(`${saved.length}\u4ef6\u306e\u8868\u73fe\u3092\u81ea\u52d5\u4fdd\u5b58\u3057\u307e\u3057\u305f`, 'success');
    }
  } catch (error) {
    if (error?.name !== 'AbortError') toast(error?.message || '表現セットを作成できませんでした', 'error');
  } finally {
    state.generating = false;
    state.controller = null;
    renderIfMounted();
  }
}

function syncGeneratorInput() {
  if (!state.container) return;
  const next = {
    language: state.container.querySelector('#atlas-language')?.value || state.generatorInput.language || 'English',
    learningTarget: state.container.querySelector('#atlas-learning-target')?.value.trim() || '',
    category: state.generatorInput.expansionMode ? state.generatorInput.category : '',
    topic: state.generatorInput.expansionMode ? state.generatorInput.topic : '',
    seedTerms: state.container.querySelector('#atlas-seed-terms')?.value || '',
    expansionMode: Boolean(state.generatorInput.expansionMode),
    existingExpressions: state.generatorInput.existingExpressions || [],
  };
  state.generatorInput = next;
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

function getRecentEntryIds() {
  try {
    const value = JSON.parse(localStorage.getItem(ATLAS_RECENT_KEY) || '[]');
    return Array.isArray(value) ? value.filter(Boolean).slice(0, MAX_RECENT_ENTRIES) : [];
  } catch {
    return [];
  }
}

function rememberRecentEntry(entryId) {
  if (!entryId) return;
  const next = [entryId, ...getRecentEntryIds().filter(id => id !== entryId)]
    .slice(0, MAX_RECENT_ENTRIES);
  try {
    localStorage.setItem(ATLAS_RECENT_KEY, JSON.stringify(next));
  } catch {}
}

function getMainScrollTop() {
  return document.getElementById('main-content')?.scrollTop || 0;
}

function restoreMainScroll(scrollTop = 0) {
  requestAnimationFrame(() => {
    const main = document.getElementById('main-content');
    if (!main) return;
    main.scrollTop = Math.max(0, Number(scrollTop) || 0);
  });
}

function restorePreviousDetail() {
  const previous = state.detailTrail.pop();
  if (!previous?.id) return false;
  persistCurrentDetailNotes();
  state.entryId = '';
  state.translationId = '';
  state.questionId = '';
  state.morphemeId = '';
  state.usageId = '';
  state.entryId = previous.kind === 'expression' ? previous.id : '';
  state.translationId = previous.kind === 'translation' ? previous.id : '';
  state.questionId = previous.kind === 'question' ? previous.id : '';
  state.morphemeId = previous.kind === 'morphology' ? previous.id : '';
  state.usageId = previous.kind === 'usage' ? previous.id : '';
  state.libraryMode = previous.kind === 'translation'
    ? 'translations'
    : previous.kind === 'question'
      ? 'questions'
      : previous.kind === 'morphology'
        ? 'morphology'
        : previous.kind === 'usage'
          ? 'usage'
          : 'expressions';
  render();
  restoreMainScroll(previous.scrollTop);
  return true;
}

function getCurrentDetailState() {
  if (state.entryId) return { kind: 'expression', id: state.entryId };
  if (state.translationId) return { kind: 'translation', id: state.translationId };
  if (state.questionId) return { kind: 'question', id: state.questionId };
  if (state.morphemeId) return { kind: 'morphology', id: state.morphemeId };
  if (state.usageId) return { kind: 'usage', id: state.usageId };
  return null;
}

function pushDetailHistory(detail = getCurrentDetailState()) {
  if (!detail?.id) return;
  const previous = state.detailTrail.at(-1);
  if (previous?.kind === detail.kind && previous?.id === detail.id) return;
  state.detailTrail.push({ ...detail, scrollTop: getMainScrollTop() });
  state.detailTrail = state.detailTrail.slice(-20);
}

function persistCurrentDetailNotes() {
  if (state.entryId) persistOpenPersonalNote();
  if (state.translationId) persistOpenTranslationNote();
}

function wireCollapsibleDetailSections() {
  const detail = getCurrentDetailState();
  const detailKey = `${detail?.kind || 'atlas'}:${detail?.id || 'root'}`;
  state.container?.querySelectorAll('.atlas-detail-section').forEach((section, index) => {
    if (section.closest('.atlas-sense-body')) return;
    const heading = section.querySelector(':scope > h2');
    if (!heading || section.classList.contains('atlas-same-word-section')) return;
    const sectionKey = `${detailKey}:${index}:${heading.textContent.trim()}`;
    const content = [...section.children].filter(child => child !== heading);
    if (!content.length) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'atlas-section-toggle';
    button.setAttribute('aria-expanded', String(!state.collapsedDetailSections.has(sectionKey)));
    button.setAttribute('aria-label', `${heading.textContent.trim()}を開閉`);
    button.innerHTML = '<span aria-hidden="true">⌄</span>';
    heading.appendChild(button);
    const apply = expanded => {
      content.forEach(child => {
        child.dataset.atlasCollapsibleContent = '';
        child.hidden = !expanded;
      });
      button.setAttribute('aria-expanded', String(expanded));
      section.classList.toggle('is-collapsed', !expanded);
    };
    apply(!state.collapsedDetailSections.has(sectionKey));
    button.addEventListener('click', () => {
      const expanded = button.getAttribute('aria-expanded') === 'true';
      if (expanded) state.collapsedDetailSections.add(sectionKey);
      else state.collapsedDetailSections.delete(sectionKey);
      apply(!expanded);
    });
  });
  state.container?.querySelectorAll('details.atlas-translation-expandable').forEach((details, index) => {
    const summary = details.querySelector(':scope > summary');
    const sectionKey = `${detailKey}:native:${index}:${summary?.textContent?.trim() || 'section'}`;
    details.open = state.openNativeDetailSections.has(sectionKey);
    details.addEventListener('toggle', () => {
      if (!details.isConnected) return;
      if (details.open) state.openNativeDetailSections.add(sectionKey);
      else state.openNativeDetailSections.delete(sectionKey);
    });
  });
  state.container?.querySelectorAll('details.atlas-sense[data-atlas-sense-key]').forEach((details, index) => {
    const sectionKey = details.dataset.atlasSenseKey;
    const shouldOpen = state.openSenseDetailSections.has(sectionKey)
      ? state.openSenseDetailSections.get(sectionKey)
      : index === 0;
    details.open = shouldOpen;
    details.addEventListener('toggle', () => {
      if (!details.isConnected) return;
      state.openSenseDetailSections.set(sectionKey, details.open);
    });
  });
}

function returnToLibrary(category, topic) {
  persistOpenPersonalNote();
  state.entryId = '';
  state.detailTrail = [];
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
  if (!textarea || !state.entryId) return false;
  return !!updateExpressionEntry(state.entryId, { personalNote: textarea.value || '' });
}

function persistOpenTranslationNote() {
  clearTimeout(state.noteTimer);
  state.noteTimer = null;
  const textarea = state.container?.querySelector('#atlas-translation-note');
  if (!textarea || !state.translationId) return false;
  return !!updateTranslationSet(state.translationId, { personalNote: textarea.value || '' });
}

function classificationEditor(record, kind) {
  const prefix = kind === 'translation' ? 'atlas-translation-detail' : 'atlas-expression-detail';
  return `
    <details class="atlas-classification-editor">
      <summary>分類を整理</summary>
      <div>
        <label><span>カテゴリ</span><select id="${prefix}-category">${NUANCE_ATLAS_CATEGORIES.map(category => `<option value="${esc(category)}" ${record.category === category ? 'selected' : ''}>${esc(category)}</option>`).join('')}</select></label>
        <label><span>テーマ</span><input id="${prefix}-topic" value="${esc(record.topic)}"></label>
        <button class="btn btn-secondary btn-sm" id="${prefix}-save" type="button">分類名を保存</button>
      </div>
      <p>名前を変えても内部IDと以前の名前は保持され、同じ分類として扱われます。</p>
    </details>
  `;
}

function wireClassificationEditor(record, kind) {
  const prefix = kind === 'translation' ? 'atlas-translation-detail' : 'atlas-expression-detail';
  state.container?.querySelector(`#${prefix}-save`)?.addEventListener('click', () => {
    const category = normalizeAtlasCategory(state.container.querySelector(`#${prefix}-category`)?.value.trim(), record.topic);
    const topic = normalizeAtlasTopic(state.container.querySelector(`#${prefix}-topic`)?.value.trim(), category);
    if (!category || !isValidAtlasTopic(topic, category)) {
      toast('テーマはカテゴリと異なる短い意味のまとまりにしてください', 'error');
      return;
    }
    persistCurrentDetailNotes();
    const latest = kind === 'translation'
      ? getTranslationSets().find(item => item.id === record.id)
      : getExpressionEntries().find(item => item.id === record.id);
    if (!latest) {
      toast('項目を読み直せませんでした', 'error');
      return;
    }
    const updates = applyManualClassification(latest, category, topic);
    const saved = kind === 'translation'
      ? updateTranslationSet(record.id, updates)
      : updateExpressionEntry(record.id, updates);
    if (!saved) {
      toast('分類を保存できませんでした', 'error');
      return;
    }
    state.category = category;
    state.topic = topic;
    toast('分類名を保存しました', 'success');
    render();
  });
}

function grammarNotesSection(notes) {
  if (!notes || typeof notes !== 'object') return '';
  const rows = [
    ['品詞', notes.partOfSpeech],
    ['可算性', notes.countability],
    ['複数形', notes.plural],
    ['過去形', notes.past],
    ['過去分詞', notes.pastParticiple],
  ].filter(([, value]) => String(value || '').trim());
  const usageNotes = Array.isArray(notes.usageNotes) ? notes.usageNotes.filter(Boolean) : [];
  const forms = Array.isArray(notes.exampleForms) ? notes.exampleForms.filter(Boolean) : [];
  if (!rows.length && !usageNotes.length && !forms.length) return '';
  return `
    <section class="atlas-detail-section">
      <h2>形・数え方の注意</h2>
      ${rows.length ? `<dl class="atlas-grammar-grid">${rows.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>` : ''}
      ${forms.length ? `<div class="atlas-chip-list">${forms.map(form => `<span lang="en">${esc(form)}</span>`).join('')}</div>` : ''}
      ${usageNotes.length ? `<ul class="atlas-note-list">${usageNotes.map(note => `<li>${esc(note)}</li>`).join('')}</ul>` : ''}
    </section>
  `;
}

function expressionSensesSection(entry, senses) {
  const expressionIndex = buildExpressionIndex(getExpressionEntries());
  return `
    <section class="atlas-detail-section atlas-senses-section">
      <h2>意味・品詞別の解説</h2>
      <div class="atlas-sense-list">
        ${senses.map((sense, index) => {
          const senseKey = `${entry.id}:${sense.senseId || sense.partOfSpeech || 'sense'}:${index}`;
          const isOpen = state.openSenseDetailSections.has(senseKey)
            ? state.openSenseDetailSections.get(senseKey)
            : index === 0;
          return `
          <details class="atlas-sense" data-atlas-sense-key="${esc(senseKey)}" ${isOpen ? 'open' : ''}>
            <summary>
              <span>${esc(sense.partOfSpeech || `意味 ${index + 1}`)}</span>
              ${sense.coreMeaningJa ? `<strong>${esc(sense.coreMeaningJa)}</strong>` : ''}
            </summary>
            <div class="atlas-sense-body">
              ${detailSection('中心的な意味', sense.coreMeaningJa)}
              ${detailSection('深いニュアンス', sense.nuanceJa)}
              ${comparisonsSection(sense.comparisons, expressionIndex)}
              ${listSection('自然に使われる場面', sense.useCasesJa)}
              ${usagePatternsSection(sense.usagePatterns)}
              ${examplesSection(sense.examples)}
              ${grammarNotesSection(sense.grammarNotes)}
              ${detailSection('感情の温度', sense.emotionalToneJa)}
              ${collocationsSection(sense.collocations, expressionIndex)}
              ${listSection('注意点', sense.cautionsJa, 'atlas-note-list--warning')}
            </div>
          </details>
        `;
        }).join('')}
      </div>
    </section>
  `;
}

function relatedCoreEntries(entry) {
  const explicitIds = new Set(Array.isArray(entry.etymologyLinks) ? entry.etymologyLinks : []);
  const terms = new Set([
    String(entry.term || '').trim().toLocaleLowerCase(),
    String(entry.lemma || '').trim().toLocaleLowerCase(),
    ...(Array.isArray(entry.aliases) ? entry.aliases : []).map(value => String(value).trim().toLocaleLowerCase()),
  ].filter(Boolean));
  return ETYMOLOGY_CORE.filter(core => (
    explicitIds.has(core.id)
    || core.wordLinks.some(link => terms.has(String(link.term || '').toLocaleLowerCase()))
  )).slice(0, 8);
}

function relatedEtymologySection(entry) {
  const related = relatedCoreEntries(entry);
  if (!related.length) return '';
  return `
    <section class="atlas-detail-section">
      <h2>つながる語源</h2>
      <div class="atlas-related-etymology">
        ${related.map(core => `
          <button type="button" data-related-morpheme="${esc(core.id)}">
            <strong lang="en">${esc(core.displayForm)}</strong>
            <span>${esc(core.senses?.[0]?.labelJa || core.quickSummaryJa)}</span>
          </button>
        `).join('')}
      </div>
    </section>
  `;
}

function wireRelatedEtymologyLinks() {
  state.container?.querySelectorAll('[data-related-morpheme]').forEach(button => {
    button.addEventListener('click', () => {
      openMorphologyDetail(button.dataset.relatedMorpheme);
    });
  });
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

function getNuanceMapMode(entry) {
  return entry?.mapMode === 'groups' ? 'groups' : 'scale';
}

function getIntensityRange(entry) {
  const fallback = getIntensityLevel(entry);
  if (fallback) return { min: fallback, max: fallback };
  const rawMin = Number(entry?.intensityMin);
  const rawMax = Number(entry?.intensityMax);
  const min = Number.isFinite(rawMin) && rawMin >= 1 && rawMin <= 5
    ? Math.round(rawMin)
    : fallback;
  const max = Number.isFinite(rawMax) && rawMax >= 1 && rawMax <= 5
    ? Math.round(rawMax)
    : fallback;
  if (!min || !max) return null;
  return { min: Math.min(min, max), max: Math.max(min, max) };
}

function intensityRangeLabel(range) {
  if (!range) return '未設定';
  if (range.min === range.max) return intensityStars(range.min);
  return `★${range.min}–${range.max}`;
}

function resolveNuanceMapMeta(entries) {
  const counts = new Map();
  entries.forEach(entry => {
    const mode = getNuanceMapMode(entry);
    const axis = String(entry?.mapAxisJa || (mode === 'groups' ? 'ニュアンスの種類' : '強さ')).trim();
    const low = String(entry?.mapLowLabelJa || (mode === 'scale' ? '控えめ' : '')).trim();
    const high = String(entry?.mapHighLabelJa || (mode === 'scale' ? '強い' : '')).trim();
    const key = JSON.stringify([mode, axis, low, high]);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const [mode, axis, low, high] = best
    ? JSON.parse(best)
    : ['scale', '強さ', '控えめ', '強い'];
  return { mode, axis, low, high };
}

function renderNuanceMap(entries, { interactive = true } = {}) {
  if (!Array.isArray(entries) || !entries.length) return '';
  const meta = resolveNuanceMapMeta(entries);
  const sorted = [...entries].sort((a, b) => (
    (getIntensityRange(a)?.min ?? 6) - (getIntensityRange(b)?.min ?? 6)
    || String(a.term || '').localeCompare(String(b.term || ''), 'en')
  ));
  const renderRow = (entry, grouped = false) => {
    const range = getIntensityRange(entry);
    const tagName = interactive && entry.id ? 'button' : 'div';
    const attributes = interactive && entry.id
      ? `type="button" data-atlas-entry="${esc(entry.id)}"`
      : '';
    const description = entry.emotionalToneJa || entry.coreMeaningJa || '';
    return `
      <${tagName} class="atlas-nuance-map-row${grouped ? ' is-grouped' : ''}" ${attributes}>
        ${grouped ? '' : `<span class="atlas-nuance-stars"${range ? ` aria-label="5段階中${range.min}${range.max !== range.min ? `から${range.max}` : ''}"` : ''}>${esc(intensityRangeLabel(range))}</span>`}
        <strong>${esc(entry.term)}</strong>
        <span>${esc(description)}</span>
      </${tagName}>
    `;
  };
  const mapContent = meta.mode === 'groups'
    ? Object.entries(sorted.reduce((groups, entry) => {
      const label = String(entry.nuanceTypeJa || 'その他').trim();
      if (!groups[label]) groups[label] = [];
      groups[label].push(entry);
      return groups;
    }, {})).map(([label, groupEntries]) => `
      <section class="atlas-nuance-map-group">
        <h3>${esc(label)}</h3>
        ${groupEntries.map(entry => renderRow(entry, true)).join('')}
      </section>
    `).join('')
    : sorted.map(entry => renderRow(entry)).join('');
  return `
    <section class="atlas-nuance-map" aria-labelledby="atlas-nuance-map-title">
      <div class="atlas-nuance-map-heading">
        <h2 id="atlas-nuance-map-title">度合い・ニュアンス全体マップ</h2>
        <p><strong>比較軸: ${esc(meta.axis)}</strong>${meta.mode === 'scale' ? `<span>${esc(meta.low)} ↔ ${esc(meta.high)}</span>` : ''}</p>
      </div>
      <div class="atlas-nuance-map-list">
        ${mapContent}
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

function normalizeCollocationItem(item) {
  if (typeof item === 'string') {
    return { expression: item.trim(), translationJa: '' };
  }
  return {
    expression: String(item?.expression || item?.text || '').trim(),
    translationJa: String(item?.translationJa || item?.meaningJa || '').trim(),
  };
}

function collocationsSection(items, expressionIndex = buildExpressionIndex(getExpressionEntries())) {
  if (!Array.isArray(items) || !items.length) return '';
  const collocations = items.map(normalizeCollocationItem).filter(item => item.expression);
  if (!collocations.length) return '';
  return `
    <section class="atlas-detail-section">
      <h2>よく一緒に使う語</h2>
      <div class="atlas-collocation-list">${collocations.map(item => `
        <span class="atlas-collocation-item">
          ${linkedExpressionTerm(item.expression, expressionIndex)}
          ${item.translationJa ? `<span>${esc(item.translationJa)}</span>` : ''}
        </span>
      `).join('')}</div>
    </section>
  `;
}

function usagePatternsSection(items) {
  const patterns = (Array.isArray(items) ? items : []).filter(item => (
    String(item?.pattern || '').trim() && String(item?.meaningJa || '').trim()
  ));
  if (!patterns.length) return '';
  return `
    <section class="atlas-detail-section atlas-usage-patterns">
      <h2>よく使う構文</h2>
      <div class="atlas-usage-pattern-list">${patterns.map(item => `
        <article class="atlas-usage-pattern">
          <div class="atlas-audio-line"><strong lang="en">${esc(item.pattern)}</strong>${speakButton(item.pattern)}</div>
          <p>${esc(item.meaningJa)}</p>
          ${Array.isArray(item.situationsJa) && item.situationsJa.length
            ? `<ul class="atlas-note-list">${item.situationsJa.map(value => `<li>${esc(value)}</li>`).join('')}</ul>`
            : ''}
          ${(Array.isArray(item.examples) ? item.examples : []).map(example => `
            <div class="atlas-pattern-example">
              <div class="atlas-audio-line"><span lang="en">${esc(example.source)}</span>${speakButton(example.source)}</div>
              <small>${esc(example.translation)}</small>
            </div>
          `).join('')}
          ${item.noteJa ? `<small class="atlas-pattern-note">${esc(item.noteJa)}</small>` : ''}
        </article>
      `).join('')}</div>
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
          <div class="atlas-audio-line"><strong>${esc(example.source)}</strong>${speakButton(example.source)}</div>
          <span>${esc(example.translation)}</span>
          ${example.noteJa ? `<small>${esc(example.noteJa)}</small>` : ''}
        </div>
      `).join('')}</div>
    </section>
  `;
}

function translationVocabularySection(notes, expressionIndex = buildExpressionIndex(getExpressionEntries())) {
  if (!Array.isArray(notes) || !notes.length) return '';
  return `
    <details class="atlas-translation-expandable">
      <summary>主要語彙・構文を詳しく見る</summary>
      <div class="atlas-language-note-list">
        ${notes.map(note => {
          const lookupTerm = note.lemma || note.expression;
          const matches = findExpressionMatches(lookupTerm, expressionIndex);
          const heading = matches.length
            ? `<button type="button" class="atlas-inline-word-link" lang="en" data-linked-token="${esc(lookupTerm)}" data-linked-entries="${esc(matches.map(entry => entry.id).join(','))}">${esc(note.expression)}</button>`
            : `<strong lang="en">${esc(note.expression)}</strong>`;
          return `
          <div class="atlas-language-note">
            ${heading}
            ${note.etymologyJa ? `<p><span>語源</span>${esc(note.etymologyJa)}</p>` : ''}
            ${note.coreImageJa ? `<p><span>コアイメージ</span>${esc(note.coreImageJa)}</p>` : ''}
            ${note.nuanceJa ? `<p><span>深いニュアンス</span>${esc(note.nuanceJa)}</p>` : ''}
          </div>
        `;
        }).join('')}
      </div>
    </details>
  `;
}

function linkedExpressionTerm(term, expressionIndex) {
  const value = String(term || '').trim();
  if (!value) return '';
  const matches = findExpressionMatches(value, expressionIndex);
  if (!matches.length) return `<strong lang="en">${esc(value)}</strong>`;
  return `<button type="button" class="atlas-inline-word-link" lang="en"
    data-linked-token="${esc(value)}" data-linked-entries="${esc(matches.map(entry => entry.id).join(','))}">${esc(value)}</button>`;
}

function translationComparisonSection(comparisons, expressionIndex = buildExpressionIndex(getExpressionEntries())) {
  if (!Array.isArray(comparisons) || !comparisons.length) return '';
  return `
    <details class="atlas-translation-expandable">
      <summary>似た表現との違いを見る</summary>
      <div class="atlas-comparison-list">
        ${comparisons.map(comparison => `
          <div>
            <span class="atlas-comparison-terms">${linkedExpressionTerm(comparison.expression, expressionIndex)} <b aria-hidden="true">/</b> ${linkedExpressionTerm(comparison.alternative, expressionIndex)}</span>
            <p>${esc(comparison.differenceJa)}</p>
          </div>
        `).join('')}
      </div>
    </details>
  `;
}

function translationImpression(text) {
  if (!String(text || '').trim()) return '';
  return `
    <div class="atlas-translation-impression">
      <span>印象・使用域</span>
      <p>${esc(text)}</p>
    </div>
  `;
}

function translationCautionsSection(items) {
  if (!Array.isArray(items) || !items.length) return '';
  return `
    <details class="atlas-translation-expandable">
      <summary>注意点を見る</summary>
      <ul class="atlas-note-list atlas-note-list--warning">${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>
    </details>
  `;
}

function comparisonsSection(comparisons, expressionIndex = buildExpressionIndex(getExpressionEntries())) {
  if (!Array.isArray(comparisons) || !comparisons.length) return '';
  return `
    <section class="atlas-detail-section">
      <h2>似た表現との違い</h2>
      <div class="atlas-comparison-list">${comparisons.map(comparison => `
        <div>${linkedExpressionTerm(comparison.term, expressionIndex)}<p>${esc(comparison.differenceJa)}</p></div>
      `).join('')}</div>
    </section>
  `;
}

function searchableText(entry) {
  const senseText = (entry.senses || []).flatMap(sense => [
    sense.senseId,
    sense.partOfSpeech,
    sense.coreMeaningJa,
    sense.nuanceJa,
    sense.nuanceTypeJa,
    sense.register,
    sense.emotionalToneJa,
    ...(sense.useCasesJa || []),
    ...(sense.collocations || []).flatMap(item => {
      const collocation = normalizeCollocationItem(item);
      return [collocation.expression, collocation.translationJa];
    }),
    ...(sense.examples || []).flatMap(example => [example.source, example.translation, example.noteJa]),
    ...(sense.comparisons || []).flatMap(comparison => [comparison.term, comparison.differenceJa]),
    ...(sense.cautionsJa || []),
    sense.grammarNotes?.countability,
    sense.grammarNotes?.plural,
    sense.grammarNotes?.past,
    sense.grammarNotes?.pastParticiple,
    ...(sense.grammarNotes?.usageNotes || []),
    ...(sense.grammarNotes?.exampleForms || []),
  ]);
  return normalize([
    entry.term,
    entry.lemma,
    entry.sourceQueryJa,
    ...(entry.sourceQueries || []),
    ...(entry.aliases || []),
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
    ...(entry.categoryAliases || []),
    entry.topic,
    ...(entry.topicAliases || []),
    ...(entry.useCasesJa || []),
    ...(entry.collocations || []).flatMap(item => {
      const collocation = normalizeCollocationItem(item);
      return [collocation.expression, collocation.translationJa];
    }),
    ...(entry.cautionsJa || []),
    ...(entry.examples || []).flatMap(example => [example.source, example.translation, example.noteJa]),
    ...(entry.comparisons || []).flatMap(comparison => [comparison.term, comparison.differenceJa]),
    entry.grammarNotes?.countability,
    entry.grammarNotes?.plural,
    entry.grammarNotes?.past,
    entry.grammarNotes?.pastParticiple,
    ...(entry.grammarNotes?.usageNotes || []),
    ...(entry.grammarNotes?.exampleForms || []),
    entry.personalNote,
    ...senseText,
  ].filter(Boolean).join(' '));
}

function searchableTranslationText(set) {
  return normalize([
    set.sourceTextJa,
    set.contextJa,
    set.category,
    ...(set.categoryAliases || []),
    set.topic,
    ...(set.topicAliases || []),
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
        note.lemma,
        note.senseHintJa,
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

function applyManualClassification(record, category, topic) {
  const current = withStableClassification(record);
  const nextCategory = normalizeAtlasCategory(category, `${topic} ${current.sourceQueryJa || ''}`);
  const nextTopic = normalizeAtlasTopic(topic, nextCategory);
  if (!nextCategory || !isValidAtlasTopic(nextTopic, nextCategory)) return current;
  const categoryAliases = unique([
    ...(current.categoryAliases || []),
    ...(current.category && current.category !== nextCategory ? [current.category] : []),
  ]);
  const topicAliases = unique([
    ...(current.topicAliases || []),
    ...(current.topic && current.topic !== nextTopic ? [current.topic] : []),
  ]);
  return {
    ...current,
    category: nextCategory,
    topic: nextTopic,
    categoryId: stableAtlasId('cat', nextCategory),
    topicId: stableAtlasId('topic', `${nextCategory}-${nextTopic}`),
    categoryAliases,
    topicAliases,
    classificationSource: 'user',
    manualClassification: true,
  };
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
