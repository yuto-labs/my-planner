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
  generateTranslationVariants,
  NUANCE_ATLAS_CATEGORIES,
} from '../ai.js';
import {
  buildExpressionIndex,
  collectStableTaxonomy,
  findExpressionMatches,
  isUsefulLinkedToken,
  stableAtlasId,
  tokenizeEnglishForLinks,
  withStableClassification,
} from '../atlas-model.js';
import {
  ETYMOLOGY_CORE,
  ETYMOLOGY_CORE_STATS,
  getEtymologyCoreEntry,
} from '../data/etymology-core.js';
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
  questionId: '',
  morphemeId: '',
  morphologyType: 'all',
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
    learningTarget: '',
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
  if (state.morphemeId) {
    state.morphemeId = '';
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
  if (state.questionId) {
    renderQuestionDetail();
    return;
  }
  if (state.morphemeId) {
    renderMorphologyDetail();
    return;
  }
  if (state.libraryMode === 'morphology') {
    renderMorphologyLibrary();
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
      learningTarget: '',
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
      <button type="button" role="tab" data-atlas-mode="morphology" aria-selected="${state.libraryMode === 'morphology'}" class="${state.libraryMode === 'morphology' ? 'active' : ''}">
        単語のしくみ
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
      state.libraryMode = ['translations', 'morphology', 'questions'].includes(button.dataset.atlasMode)
        ? button.dataset.atlasMode
        : 'expressions';
      state.search = '';
      state.category = '';
      state.topic = '';
      state.entryId = '';
      state.translationId = '';
      state.questionId = '';
      state.morphemeId = '';
      render();
      scrollMainToTop();
    });
  });
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
          <small>内蔵コア v${ETYMOLOGY_CORE_STATS.version} · ${ETYMOLOGY_CORE_STATS.total} entries</small>
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
  let timer = null;
  searchInput?.addEventListener('input', event => {
    state.search = event.target.value;
    clearTimeout(timer);
    timer = setTimeout(() => {
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
  state.container.innerHTML = `
    <article class="atlas-page atlas-detail-page atlas-morphology-detail">
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
            <span>${entry.confidence === 'reviewed' ? 'REVIEWED CORE' : 'REFERENCE CORE'}</span>
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
  state.container.querySelector('#atlas-morphology-root')?.addEventListener('click', () => {
    state.morphemeId = '';
    render();
    scrollMainToTop();
  });
  state.container.querySelectorAll('[data-linked-entry]').forEach(button => {
    button.addEventListener('click', () => {
      state.entryId = button.dataset.linkedEntry;
      state.morphemeId = '';
      state.libraryMode = 'expressions';
      render();
      scrollMainToTop();
    });
  });
  state.container.querySelectorAll('[data-core-related]').forEach(button => {
    button.addEventListener('click', () => {
      state.morphemeId = button.dataset.coreRelated;
      renderMorphologyDetail();
      scrollMainToTop();
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
  search?.addEventListener('input', () => {
    state.search = search.value || '';
    renderQuestionLibrary();
    state.container?.querySelector('#atlas-question-search')?.focus();
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
  const saved = addEnglishQuestion({ questionJa, status: 'pending', answer: null });
  if (!saved) {
    toast('質問を保存できませんでした。入力内容は画面に残しています', 'error');
    return;
  }
  state.questionId = saved.id;
  await answerEnglishQuestion(saved);
}

async function answerEnglishQuestion(question) {
  if (!isAiAvailable()) {
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
    updateEnglishQuestion(question.id, { status: 'ready', answer, errorMessage: '' });
    toast('回答を保存しました', 'success');
  } catch (error) {
    if (error?.name !== 'AbortError') {
      updateEnglishQuestion(question.id, { status: 'failed', errorMessage: error?.message || '回答を作成できませんでした' });
      toast('質問は保存済みです。あとから再試行できます。', 'error');
    }
  } finally {
    state.generating = false;
    state.controller = null;
    render();
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
      ${(answer.examples || []).length ? `<section class="atlas-detail-section"><h2>例文</h2><div class="atlas-example-list">${answer.examples.map(example => `<div><strong lang="en">${esc(example.english)}</strong><span>${esc(example.japanese)}</span>${example.noteJa ? `<small>${esc(example.noteJa)}</small>` : ''}</div>`).join('')}</div></section>` : ''}
      ${related ? `<section class="atlas-detail-section"><h2>関連して調べる</h2><div class="atlas-detail-badges">${related}</div></section>` : ''}
      ${(answer.cautionsJa || []).length ? listSection('注意点', answer.cautionsJa, 'atlas-note-list--warning') : ''}
      <div class="atlas-question-detail-actions">
        <button class="btn btn-primary" id="atlas-question-retry" type="button" ${state.generating ? 'disabled' : ''}>${answer.shortAnswerJa ? '回答を作り直す' : '回答を作る'}</button>
      </div>
    </section>
  `;
  state.container.querySelector('#atlas-question-root')?.addEventListener('click', backFromExpressionAtlas);
  state.container.querySelector('#atlas-question-retry')?.addEventListener('click', () => answerEnglishQuestion(item));
  state.container.querySelectorAll('[data-question-related]').forEach(button => {
    button.addEventListener('click', () => {
      const ids = String(button.dataset.linkedEntries || '').split(',').filter(Boolean);
      const matches = getExpressionEntries().filter(entry => ids.includes(entry.id));
      if (matches.length === 1) openLinkedExpression(matches[0].id);
      else if (matches.length > 1) showWordMatchPicker(button.dataset.questionRelated, matches);
    });
  });
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
          <p>標準・忠実、自然・会話、表現的・洗練の3案を、元の意味を保って比較します。</p>
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
          <p>使いたい場面の入力は不要です。文に自然な使用域とニュアンスをAIが説明します。</p>
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
  wireTranslationVocabularyLinks();
}

function renderTranslationVariant(variant, index) {
  const patternTitle = variant.labelJa || [
    '標準・忠実',
    '自然・会話',
    '表現的・洗練',
  ][index] || `パターン ${index + 1}`;
  const expressionIndex = buildExpressionIndex(getExpressionEntries());
  const hasLinkedWords = tokenizeEnglishForLinks(variant.translation)
    .some(part => part.token && isUsefulLinkedToken(part.token, expressionIndex));
  return `
    <article class="atlas-translation-variant">
      <h3 class="atlas-translation-pattern-title">Pattern ${index + 1}：${esc(patternTitle)}</h3>
      <div class="atlas-translation-variant-top">
        <span class="atlas-translation-number">${String(index + 1).padStart(2, '0')}</span>
        <div>
          <span class="atlas-translation-field-label">英文</span>
          <strong class="atlas-translation-plain" lang="en">${esc(variant.translation)}</strong>
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
      ${detailSection('この文自体の全体ニュアンス', variant.overallNuanceJa || variant.nuanceJa)}
      ${translationVocabularySection(variant.vocabularyNotes)}
      ${translationComparisonSection(variant.comparisons)}
      ${listSection('注意点', variant.cautionsJa, 'atlas-note-list--warning')}
    </article>
  `;
}

function renderLinkedEnglishText(text, expressionIndex) {
  return tokenizeEnglishForLinks(text).map(part => {
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
  const fromQuestion = !!state.questionId;
  state.screen = 'library';
  state.libraryMode = fromQuestion ? 'questions' : 'expressions';
  state.translationId = '';
  state.morphemeId = '';
  state.entryId = entryId;
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
  sheet.querySelector('.atlas-word-picker-backdrop')?.addEventListener('click', close);
  sheet.querySelector('[data-word-picker-close]')?.addEventListener('click', close);
  sheet.querySelectorAll('[data-word-picker-entry]').forEach(button => {
    button.addEventListener('click', () => openLinkedExpression(button.dataset.wordPickerEntry));
  });
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
  if (category && topic) {
    state.translationDraft = applyManualClassification(state.translationDraft, category, topic);
  }
}

function collectAtlasTaxonomy() {
  const items = [...getExpressionEntries(), ...getTranslationSets()];
  return collectStableTaxonomy(items).map(category => ({
    category: category.label,
    categoryId: category.id,
    aliases: category.aliases,
    topics: category.topics.map(topic => topic.label),
    topicRecords: category.topics,
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
    if (deleteExpressionEntry(set.id)) {
      state.translationId = '';
      toast('英訳セットを削除しました');
      render();
    }
  });
  wireTranslationVocabularyLinks();
  wireClassificationEditor(set, 'translation');
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
      learningTarget: '',
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

      ${classificationEditor(entry, 'expression')}
      ${etymologyCoreSection(entry)}
      ${detailSection('深いニュアンス', entry.nuanceJa)}
      ${comparisonsSection(entry.comparisons)}
      ${listSection('自然に使われる場面', entry.useCasesJa)}
      ${examplesSection(entry.examples)}
      ${grammarNotesSection(entry.grammarNotes)}
      ${relatedEtymologySection(entry)}
      ${detailSection('感情の温度', entry.emotionalToneJa)}
      ${chipSection('よく一緒に使う語', entry.collocations)}
      ${listSection('注意点', entry.cautionsJa, 'atlas-note-list--warning')}

      <section class="atlas-detail-section">
        <h2>自分のメモ</h2>
        <textarea id="atlas-personal-note" class="atlas-personal-note" rows="4" placeholder="覚え方や、自分なりの違いを記録">${esc(entry.personalNote || '')}</textarea>
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
  wireClassificationEditor(entry, 'expression');
  wireRelatedEtymologyLinks();
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
        <label class="atlas-generator-wide">
          <span>知りたい意味・表現 <small>必須</small></span>
          <input id="atlas-learning-target" required placeholder="例: 視点 / 遠慮する / 怒りを表す表現" value="${esc(input.learningTarget)}">
          <small class="atlas-field-help">分類名が分からなくても、知りたい日本語だけで始められます。</small>
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
  ['atlas-language', 'atlas-learning-target', 'atlas-category', 'atlas-topic', 'atlas-seed-terms'].forEach(id => {
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
  const { language, learningTarget, category, topic, seedTerms } = state.generatorInput;
  if (!String(learningTarget || '').trim()) {
    toast('知りたい意味・表現を入力してください', 'error');
    return;
  }
  const taxonomy = collectAtlasTaxonomy();

  state.generating = true;
  state.controller = new AbortController();
  renderGenerator();
  try {
    const drafts = await generateNuanceEntries({
      language,
      learningTarget,
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
    learningTarget: state.container.querySelector('#atlas-learning-target')?.value.trim() || '',
    category: state.container.querySelector('#atlas-category')?.value.trim() || '',
    topic: state.container.querySelector('#atlas-topic')?.value.trim() || '',
    seedTerms: state.container.querySelector('#atlas-seed-terms')?.value || '',
  };
  state.generatorInput = next;
  if (state.drafts.length && (next.category || next.topic)) {
    state.drafts = state.drafts.map(entry => applyManualClassification(
      entry,
      next.category || entry.category,
      next.topic || entry.topic
    ));
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

function classificationEditor(record, kind) {
  const prefix = kind === 'translation' ? 'atlas-translation-detail' : 'atlas-expression-detail';
  return `
    <details class="atlas-classification-editor">
      <summary>分類を整理</summary>
      <div>
        <label><span>カテゴリ</span><input id="${prefix}-category" value="${esc(record.category)}"></label>
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
    const category = state.container.querySelector(`#${prefix}-category`)?.value.trim();
    const topic = state.container.querySelector(`#${prefix}-topic`)?.value.trim();
    if (!category || !topic) {
      toast('カテゴリとテーマを入力してください', 'error');
      return;
    }
    const updates = applyManualClassification(record, category, topic);
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
      persistOpenPersonalNote();
      state.entryId = '';
      state.translationId = '';
      state.morphemeId = button.dataset.relatedMorpheme;
      state.libraryMode = 'morphology';
      render();
      scrollMainToTop();
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
    entry.lemma,
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
    ...(entry.collocations || []),
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
  const nextCategory = String(category || '').trim();
  const nextTopic = String(topic || '').trim();
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
    categoryId: current.categoryId || stableAtlasId('cat', nextCategory),
    topicId: current.topicId || stableAtlasId('topic', `${nextCategory}-${nextTopic}`),
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
