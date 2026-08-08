import {
  getLearningEntries,
  getLearningEntryById,
  addLearningEntry,
  updateLearningEntry,
  deleteLearningEntry,
} from '../storage.js';
import { generateKnowledgeAnswer } from '../ai.js';
import {
  normalizeKnowledgeAnswer,
  validateKnowledgeEntry,
  buildKnowledgeConceptIndex,
  findKnowledgeConceptMatches,
  findDuplicateKnowledgeEntries,
  knowledgeAnswerText,
  getKnowledgeTimelineBucket,
} from '../knowledge-model.js';
import {
  LEARNING_TAXONOMY,
  LEARNING_MAJOR_BY_ID,
  LEARNING_MIDDLE_BY_ID,
  getLearningClassificationLabel,
  serializeLearningTaxonomyForAI,
} from '../data/learning-taxonomy.js';
import {
  LEARNING_REGIONS,
  getLearningCountriesForRegion,
  getLearningCountryLabel,
  getLearningTimelineLabel,
} from '../data/learning-geography.js';
import { esc } from '../utils.js';

const nav = (view, options) => window.AppNav?.navigate(view, options);
const toast = (message, type) => window.AppNav?.showToast(message, type);

let selectedEntryId = null;
let detailHistory = [];
let listState = {
  query: '', majorId: 'all', browseAxis: 'list',
  browseMajorId: '', middleId: '',
  timeCentury: '', timeDecade: '', regionId: '', countryCode: '', conceptKey: '',
};
let questionDraft = '';
let generationController = null;

export function openLearningEntry(id, { remember = true } = {}) {
  if (!getLearningEntryById(id)) return;
  if (remember && selectedEntryId && selectedEntryId !== id) detailHistory.push(selectedEntryId);
  selectedEntryId = id;
  const main = document.getElementById('main-content');
  if (main?.dataset.view === 'learning-detail') {
    initLearningDetail(main);
  } else {
    nav('learning-detail');
  }
}

export function backFromLearningDetail() {
  const previous = detailHistory.pop();
  if (previous && getLearningEntryById(previous)) {
    selectedEntryId = previous;
    const main = document.getElementById('main-content');
    if (main) initLearningDetail(main);
    return;
  }
  selectedEntryId = null;
  nav('knowledge');
}

export function hasActiveKnowledgeWork() {
  return !!generationController || !!questionDraft.trim();
}

export function initLearningLibrary(container) {
  renderLibrary(container);
  return () => {
    generationController?.abort();
    generationController = null;
  };
}

function renderLibrary(container) {
  const entries = getLearningEntries();
  const query = listState.query.trim().toLocaleLowerCase();
  const filtered = entries.filter(entry => {
    if (listState.majorId !== 'all' && entry.classification?.majorId !== listState.majorId) return false;
    if (!query) return true;
    return [
      entry.title,
      entry.originalQuestion,
      getLearningClassificationLabel(entry.classification),
      knowledgeAnswerText(entry),
      ...(entry.concepts || []).flatMap(concept => [concept.label, ...(concept.aliases || [])]),
    ].join(' ').toLocaleLowerCase().includes(query);
  });
  const showStandardList = listState.browseAxis === 'list';

  container.innerHTML = `
    <div class="learning-page">
      <section class="learning-ask">
        <div class="learning-ask-copy">
          <span class="learning-eyebrow">QUESTION LIBRARY</span>
          <h2>疑問を、あとから辿れる知識に</h2>
          <p>質問と元の言葉を残したまま、丁寧な解説と関連概念を保存します。</p>
        </div>
        <form class="learning-question-form" id="learning-question-form">
          <textarea id="learning-question-input" class="input learning-question-input"
            rows="2" maxlength="1200" placeholder="知りたいことをそのまま入力">${esc(questionDraft)}</textarea>
          <div class="learning-question-actions">
            <span class="learning-save-note">回答が完成してから保存されます</span>
            <button class="btn btn-primary" id="learning-ask-btn" type="submit">解説を作る</button>
          </div>
        </form>
        <div class="learning-generation hidden" id="learning-generation" role="status">
          <span class="learning-generation-spinner" aria-hidden="true"></span>
          <div><strong>解説を組み立てています</strong><span>分類・概念・文章を確認してから保存します</span></div>
          <button class="btn btn-ghost btn-sm" id="learning-cancel-btn" type="button">中止</button>
        </div>
      </section>

      <div class="learning-toolbar">
        <label class="learning-search">
          <span aria-hidden="true">⌕</span>
          <input class="input" id="learning-search-input" value="${esc(listState.query)}"
            placeholder="質問・タイトル・概念を検索">
        </label>
        <select class="input learning-filter" id="learning-major-filter" aria-label="大分類">
          <option value="all">すべての分野</option>
          ${LEARNING_TAXONOMY.map(group => `
            <option value="${esc(group.id)}"${listState.majorId === group.id ? ' selected' : ''}>${esc(group.label)}</option>
          `).join('')}
        </select>
      </div>

      ${renderKnowledgeBrowse(filtered)}

      ${showStandardList ? `<div class="learning-list-meta">${filtered.length}件</div>
        <div class="learning-list" id="learning-list">
          ${filtered.length ? filtered.map(renderEntryCard).join('') : renderEmptyState(entries.length)}
        </div>` : ''}
    </div>
  `;

  container.querySelector('#learning-question-form')?.addEventListener('submit', event => {
    event.preventDefault();
    createLearningEntry(container);
  });
  container.querySelector('#learning-question-input')?.addEventListener('input', event => {
    questionDraft = event.target.value;
  });
  container.querySelector('#learning-cancel-btn')?.addEventListener('click', () => generationController?.abort());
  container.querySelector('#learning-search-input')?.addEventListener('input', event => {
    listState.query = event.target.value;
    renderLibrary(container);
    requestAnimationFrame(() => {
      const input = container.querySelector('#learning-search-input');
      input?.focus();
      input?.setSelectionRange(listState.query.length, listState.query.length);
    });
  });
  container.querySelector('#learning-major-filter')?.addEventListener('change', event => {
    listState.majorId = event.target.value;
    listState.browseAxis = 'list';
    resetBrowseTrail();
    renderLibrary(container);
  });
  container.querySelectorAll('[data-learning-browse-axis]').forEach(button => {
    button.addEventListener('click', () => {
      listState.browseAxis = button.dataset.learningBrowseAxis || 'list';
      if (listState.browseAxis === 'domain') listState.majorId = 'all';
      resetBrowseTrail();
      renderLibrary(container);
    });
  });
  container.querySelectorAll('[data-learning-browse-major]').forEach(button => {
    button.addEventListener('click', () => {
      listState.browseMajorId = button.dataset.learningBrowseMajor || '';
      listState.middleId = '';
      renderLibrary(container);
    });
  });
  container.querySelectorAll('[data-learning-browse-middle]').forEach(button => {
    button.addEventListener('click', () => {
      listState.middleId = button.dataset.learningBrowseMiddle || '';
      renderLibrary(container);
    });
  });
  container.querySelectorAll('[data-learning-domain-root]').forEach(button => {
    button.addEventListener('click', () => {
      listState.browseMajorId = '';
      listState.middleId = '';
      renderLibrary(container);
    });
  });
  container.querySelectorAll('[data-learning-domain-major]').forEach(button => {
    button.addEventListener('click', () => {
      listState.middleId = '';
      renderLibrary(container);
    });
  });
  container.querySelectorAll('[data-learning-time-century]').forEach(button => {
    button.addEventListener('click', () => {
      listState.timeCentury = button.dataset.learningTimeCentury || '';
      listState.timeDecade = '';
      renderLibrary(container);
    });
  });
  container.querySelectorAll('[data-learning-time-decade]').forEach(button => {
    button.addEventListener('click', () => {
      listState.timeDecade = button.dataset.learningTimeDecade || '';
      renderLibrary(container);
    });
  });
  container.querySelectorAll('[data-learning-region]').forEach(button => {
    button.addEventListener('click', () => {
      listState.regionId = button.dataset.learningRegion || '';
      listState.countryCode = '';
      renderLibrary(container);
    });
  });
  container.querySelectorAll('[data-learning-country]').forEach(button => {
    button.addEventListener('click', () => {
      listState.countryCode = button.dataset.learningCountry || '';
      renderLibrary(container);
    });
  });
  container.querySelectorAll('[data-learning-concept]').forEach(button => {
    button.addEventListener('click', () => {
      listState.conceptKey = button.dataset.learningConcept || '';
      renderLibrary(container);
    });
  });
  container.querySelectorAll('[data-learning-time-back]').forEach(button => {
    button.addEventListener('click', () => {
      if (listState.timeDecade) listState.timeDecade = '';
      else listState.timeCentury = '';
      renderLibrary(container);
    });
  });
  container.querySelectorAll('[data-learning-region-back]').forEach(button => {
    button.addEventListener('click', () => {
      if (listState.countryCode) listState.countryCode = '';
      else listState.regionId = '';
      renderLibrary(container);
    });
  });
  container.querySelectorAll('[data-learning-concept-back]').forEach(button => {
    button.addEventListener('click', () => {
      listState.conceptKey = '';
      renderLibrary(container);
    });
  });
  container.querySelectorAll('[data-learning-id]').forEach(card => {
    card.addEventListener('click', () => openLearningEntry(card.dataset.learningId));
  });
}

function resetBrowseTrail() {
  listState.browseMajorId = ''; listState.middleId = '';
  listState.timeCentury = ''; listState.timeDecade = '';
  listState.regionId = ''; listState.countryCode = ''; listState.conceptKey = '';
}

function renderEntryCard(entry) {
  const classification = getLearningClassificationLabel(entry.classification) || '未分類';
  const preview = (entry.answer?.directAnswer || []).map(segment => segment.text).join('');
  const title = entry.title || entry.originalQuestion;
  const showQuestion = entry.originalQuestion && entry.originalQuestion !== title;
  return `
    <button class="learning-card" type="button" data-learning-id="${esc(entry.id)}">
      <span class="learning-card-path">${esc(classification)}</span>
      <strong class="learning-card-title">${esc(title)}</strong>
      ${showQuestion ? `<span class="learning-card-question">${esc(entry.originalQuestion)}</span>` : ''}
      ${preview ? `<span class="learning-card-preview">${esc(preview)}</span>` : ''}
      <span class="learning-card-foot">
        <span>関連概念 ${(entry.concepts || []).length}</span>
        <time>${formatEntryDate(entry.updatedAt)}</time>
      </span>
    </button>
  `;
}

function renderKnowledgeBrowse(entries) {
  const axis = listState.browseAxis;
  const tabs = [['list', 'すべて'], ['domain', '分野'], ['time', '時代'], ['region', '地域'], ['connections', 'つながり']];
  const tabHtml = `<nav class="learning-browse-tabs" aria-label="Knowledgeの見方">${tabs.map(([id, label]) => `<button type="button" class="${axis === id ? 'active' : ''}" data-learning-browse-axis="${id}">${label}</button>`).join('')}</nav>`;
  if (axis === 'list') return tabHtml;
  if (axis === 'domain') return `<section class="learning-browse">${tabHtml}${renderDomainBrowse(entries)}</section>`;
  if (axis === 'time') return `<section class="learning-browse">${tabHtml}${renderTimeBrowse(entries)}</section>`;
  if (axis === 'region') return `<section class="learning-browse">${tabHtml}${renderRegionBrowse(entries)}</section>`;
  return `<section class="learning-browse">${tabHtml}${renderConnectionBrowse(entries)}</section>`;
}

function renderDomainBrowse(entries) {
  if (!listState.browseMajorId) {
    return `${renderBrowseIntro('分野から探す', '大分類を選ぶと、中分類へ進みます。')}
      <div class="learning-browse-grid learning-domain-grid">${LEARNING_TAXONOMY.map(group => {
        const count = entries.filter(entry => entry.classification?.majorId === group.id).length;
        return `<button type="button" data-learning-browse-major="${esc(group.id)}"><span><strong>${esc(group.label)}</strong><small>${group.children.length}分類</small></span><b>${count}</b></button>`;
      }).join('')}</div>`;
  }
  const group = LEARNING_MAJOR_BY_ID.get(listState.browseMajorId);
  if (!group) {
    listState.browseMajorId = '';
    return renderDomainBrowse(entries);
  }
  if (!listState.middleId) {
    return `${renderBrowseHeading(group.label, entries.filter(entry => entry.classification?.majorId === group.id).length, 'data-learning-domain-root', '大分類')}
      <div class="learning-browse-grid learning-middle-grid">${group.children.map(item => {
        const count = entries.filter(entry => entry.classification?.middleId === item.id).length;
        return `<button type="button" data-learning-browse-middle="${esc(item.id)}"><strong>${esc(item.label)}</strong><b>${count}</b></button>`;
      }).join('')}</div>`;
  }
  const middle = LEARNING_MIDDLE_BY_ID.get(listState.middleId);
  if (!middle || middle.majorId !== group.id) {
    listState.middleId = '';
    return renderDomainBrowse(entries);
  }
  const matches = entries.filter(entry => entry.classification?.middleId === middle.id);
  return renderBrowseResults(matches, `${group.label} › ${middle.label}`, 'data-learning-domain-major', group.label);
}

function renderTimeBrowse(entries) {
  const buckets = entries.map(entry => ({ entry, bucket: getKnowledgeTimelineBucket(entry) }));
  const special = ['timeless', 'cross_period', 'unclassified'].map(mode => ({
    mode, entries: buckets.filter(item => item.bucket.mode === mode).map(item => item.entry),
  }));
  const centuries = new Map();
  buckets.filter(item => item.bucket.mode === 'dated').forEach(item => {
    const key = `${item.bucket.era}:${item.bucket.century}`;
    if (!centuries.has(key)) centuries.set(key, { ...item.bucket, entries: [] });
    centuries.get(key).entries.push(item.entry);
  });
  const sortTimeline = (a, b) => {
    if (a[1].era !== b[1].era) return a[1].era === 'bce' ? -1 : 1;
    return a[1].era === 'bce'
      ? b[1].century - a[1].century
      : a[1].century - b[1].century;
  };
  if (!listState.timeCentury) return `${renderBrowseIntro('時代から探す', '時代に依存しない知識と、世紀別の知識を分けて辿れます。')}<div class="learning-browse-stack">${special.map(item => `<button type="button" data-learning-time-century="${item.mode}" ${item.entries.length ? '' : 'disabled'}><strong>${({ timeless: '恒常', cross_period: '横断', unclassified: '未整理' })[item.mode]}</strong><b>${item.entries.length}</b></button>`).join('')}${[...centuries.entries()].sort(sortTimeline).map(([key, item]) => `<button type="button" data-learning-time-century="${key}"><strong>${item.era === 'bce' ? '紀元前' : ''}${item.century}世紀</strong><b>${item.entries.length}</b></button>`).join('')}</div>`;
  if (['timeless', 'cross_period', 'unclassified'].includes(listState.timeCentury)) {
    const label = ({ timeless: '恒常', cross_period: '横断', unclassified: '未整理' })[listState.timeCentury];
    return renderBrowseResults(special.find(item => item.mode === listState.timeCentury)?.entries || [], label, 'data-learning-time-back', '時代');
  }
  const decadeMap = new Map();
  buckets.filter(item => item.bucket.mode === 'dated' && `${item.bucket.era}:${item.bucket.century}` === listState.timeCentury).forEach(item => {
    const key = `${item.bucket.era}:${item.bucket.decade}`;
    if (!decadeMap.has(key)) decadeMap.set(key, { ...item.bucket, entries: [] });
    decadeMap.get(key).entries.push(item.entry);
  });
  const century = centuries.get(listState.timeCentury);
  const centuryLabel = century ? `${century.era === 'bce' ? '紀元前' : ''}${century.century}世紀` : '時代';
  if (!listState.timeDecade) return `${renderBrowseHeading(centuryLabel, century?.entries.length || 0, 'data-learning-time-back', '時代')}<div class="learning-browse-stack">${[...decadeMap.entries()].sort((a, b) => (
    a[1].era === 'bce' ? b[1].decade - a[1].decade : a[1].decade - b[1].decade
  )).map(([key, item]) => `<button type="button" data-learning-time-decade="${key}"><strong>${item.era === 'bce' ? `紀元前${item.decade}年代` : `${item.decade}年代`}</strong><b>${item.entries.length}</b></button>`).join('')}</div>`;
  const decade = decadeMap.get(listState.timeDecade);
  const decadeLabel = decade ? `${decade.era === 'bce' ? '紀元前' : ''}${decade.decade}年代` : centuryLabel;
  return renderBrowseResults(decade?.entries || [], decadeLabel, 'data-learning-time-back', centuryLabel);
}

function renderRegionBrowse(entries) {
  if (!listState.regionId) return `${renderBrowseIntro('地域から探す', '世界または地域を選び、必要なときだけ国まで絞り込みます。')}<div class="learning-browse-grid">${LEARNING_REGIONS.map(region => {
    const count = region.id === 'world' ? entries.filter(entry => entry.geography?.scope === 'global').length : entries.filter(entry => (entry.geography?.regionIds || []).includes(region.id)).length;
    return `<button type="button" data-learning-region="${region.id}"><strong>${esc(region.label)}</strong><b>${count}</b></button>`;
  }).join('')}</div>`;
  if (listState.regionId === 'world') return renderBrowseResults(entries.filter(entry => entry.geography?.scope === 'global'), '世界', 'data-learning-region-back', '地域');
  const region = LEARNING_REGIONS.find(item => item.id === listState.regionId);
  if (!listState.countryCode) return `${renderBrowseHeading(region?.label || '地域', entries.filter(entry => (entry.geography?.regionIds || []).includes(listState.regionId)).length, 'data-learning-region-back', '地域')}<div class="learning-country-grid">${getLearningCountriesForRegion(listState.regionId).map(code => {
    const count = entries.filter(entry => (entry.geography?.countryCodes || []).includes(code)).length;
    return `<button type="button" data-learning-country="${code}" ${count ? '' : 'disabled'}>${esc(getLearningCountryLabel(code))}<b>${count}</b></button>`;
  }).join('')}</div>`;
  return renderBrowseResults(entries.filter(entry => (entry.geography?.countryCodes || []).includes(listState.countryCode)), getLearningCountryLabel(listState.countryCode), 'data-learning-region-back', region?.label || '地域');
}

function renderConnectionBrowse(entries) {
  const concepts = new Map();
  entries.forEach(entry => (entry.concepts || []).forEach(concept => {
    if (!concept?.key) return;
    if (!concepts.has(concept.key)) concepts.set(concept.key, { label: concept.label, entries: [] });
    concepts.get(concept.key).entries.push(entry);
  }));
  if (listState.conceptKey) {
    const concept = concepts.get(listState.conceptKey);
    return renderBrowseResults(concept?.entries || [], concept?.label || 'つながり', 'data-learning-concept-back', 'つながり');
  }
  return `${renderBrowseIntro('つながりから探す', '複数の解説に登場する概念から、関連する知識を横断します。')}<div class="learning-browse-grid">${[...concepts.entries()].sort((a, b) => b[1].entries.length - a[1].entries.length || a[1].label.localeCompare(b[1].label, 'ja')).slice(0, 48).map(([key, item]) => `<button type="button" data-learning-concept="${esc(key)}"><strong>${esc(item.label)}</strong><b>${item.entries.length}</b></button>`).join('')}</div>`;
}

function renderBrowseIntro(title, description) {
  return `<div class="learning-browse-intro"><strong>${esc(title)}</strong><span>${esc(description)}</span></div>`;
}

function renderBrowseHeading(label, count, backAttribute, backLabel) {
  return `<div class="learning-browse-heading"><button type="button" ${backAttribute}>‹ ${esc(backLabel)}</button><strong>${esc(label)}</strong><span>${count}件</span></div>`;
}

function renderBrowseResults(entries, label, backAttribute, backLabel) {
  return `<div class="learning-browse-results">${renderBrowseHeading(label, entries.length, backAttribute, backLabel)}${entries.length ? entries.map(renderEntryCard).join('') : '<p>まだ保存済みの解説はありません。</p>'}</div>`;
}

function renderEmptyState(hasEntries) {
  return `
    <div class="learning-empty">
      <span class="learning-empty-mark">${hasEntries ? '⌕' : '?'}</span>
      <strong>${hasEntries ? '一致する項目がありません' : '最初の疑問を保存しましょう'}</strong>
      <p>${hasEntries ? '検索語や分類を変えてください。' : '短い疑問でも、AIが妥当な解釈を示して解説します。'}</p>
    </div>
  `;
}

async function createLearningEntry(container) {
  const input = container.querySelector('#learning-question-input');
  const question = String(input?.value || '').trim();
  if (!question || generationController) return;
  const duplicate = findDuplicateKnowledgeEntries(getLearningEntries(), question)[0];
  if (duplicate) {
    toast('同じ質問の保存済み解説を開きました。', 'info');
    openLearningEntry(duplicate.id);
    return;
  }

  const generation = container.querySelector('#learning-generation');
  const button = container.querySelector('#learning-ask-btn');
  generation?.classList.remove('hidden');
  if (button) button.disabled = true;
  generationController = new AbortController();
  try {
    const raw = await generateKnowledgeAnswer(
      question,
      serializeLearningTaxonomyForAI(),
      { signal: generationController.signal }
    );
    const entry = normalizeKnowledgeAnswer(raw, question);
    const validation = validateKnowledgeEntry(entry);
    if (!validation.valid) throw new Error(`回答の検証に失敗しました (${validation.errors.join(', ')})`);
    const saved = addLearningEntry(entry);
    if (!saved) throw new Error('保存できませんでした。端末の空き容量を確認してください。');
    input.value = '';
    questionDraft = '';
    selectedEntryId = saved.id;
    toast('Knowledgeに保存しました。', 'success');
    nav('learning-detail');
  } catch (error) {
    if (error?.name !== 'AbortError') toast(error?.message || '解説を作成できませんでした。', 'error');
  } finally {
    generationController = null;
    if (generation?.isConnected) generation.classList.add('hidden');
    if (button?.isConnected) button.disabled = false;
  }
}

export function initLearningDetail(container) {
  const entry = getLearningEntryById(selectedEntryId);
  if (!entry) {
    nav('knowledge');
    return;
  }
  const entries = getLearningEntries();
  const conceptIndex = buildKnowledgeConceptIndex(entries);
  const classification = getLearningClassificationLabel(entry.classification);
  const timelineLabel = entry.timeline ? getLearningTimelineLabel(entry.timeline) : '';
  const regionLabels = (entry.geography?.regionIds || [])
    .map(id => LEARNING_REGIONS.find(region => region.id === id)?.label)
    .filter(Boolean);
  const countryLabels = (entry.geography?.countryCodes || []).map(getLearningCountryLabel);
  const relatedConcepts = (entry.concepts || []).filter(concept => concept.key !== entry.primaryConcept?.key);
  const facets = Object.values(entry.facets || {}).flat().filter(Boolean);
  const sections = entry.answer?.sections || [];
  const keyPoints = entry.answer?.keyPoints || [];

  container.innerHTML = `
    <article class="learning-detail">
      <header class="learning-detail-header">
        <div class="learning-detail-path">${esc(classification || '未分類')}</div>
        <div class="learning-title-row">
          <h2 id="learning-detail-title">${esc(entry.title || entry.originalQuestion)}</h2>
          <button class="btn-icon learning-title-edit" id="learning-title-edit" type="button" aria-label="タイトルを変更" title="タイトルを変更">✎</button>
        </div>
        <p class="learning-original-question">${esc(entry.originalQuestion)}</p>
        <div class="learning-context-chips">
          ${timelineLabel ? `<span>${esc(timelineLabel)}</span>` : ''}
          ${regionLabels.map(label => `<span>${esc(label)}</span>`).join('')}
          ${countryLabels.map(label => `<span>${esc(label)}</span>`).join('')}
        </div>
      </header>

      <div class="learning-answer">
        <div class="learning-direct-answer">
          <span class="learning-answer-kicker">結論</span>
          ${renderSegments(entry.answer?.directAnswer, conceptIndex, entry.id)}
        </div>
        ${keyPoints.length ? `
          <section class="learning-key-points" aria-labelledby="learning-key-points-title">
            <h3 id="learning-key-points-title">要点</h3>
            <ul>${keyPoints.map(point => `<li>${esc(point)}</li>`).join('')}</ul>
          </section>
        ` : ''}
        ${sections.filter(section => section.heading).length > 1 ? `
          <nav class="learning-section-nav" aria-label="回答内の見出し">
            ${sections.map((section, index) => section.heading ? `
              <button type="button" data-learning-section="learning-section-${index}">${esc(section.heading)}</button>
            ` : '').join('')}
          </nav>
        ` : ''}
        ${sections.map((section, index) => `
          <section class="learning-answer-section" id="learning-section-${index}">
            ${section.heading ? `<h3>${esc(section.heading)}</h3>` : ''}
            ${(section.paragraphs || []).map(paragraph => `
              <p>${renderSegments(paragraph, conceptIndex, entry.id)}</p>
            `).join('')}
          </section>
        `).join('')}
        ${(entry.answer?.cautions || []).length ? `
          <aside class="learning-cautions">
            <strong>注意・例外</strong>
            ${(entry.answer.cautions || []).map(caution => `<p>${esc(caution)}</p>`).join('')}
          </aside>
        ` : ''}
      </div>

      ${relatedConcepts.length ? `
        <section class="learning-related">
          <h3>関連する概念</h3>
          <div class="learning-concept-list">
            ${relatedConcepts.map(concept => renderConceptChip(concept, conceptIndex, entry.id)).join('')}
          </div>
        </section>
      ` : ''}

      ${facets.length ? `
        <details class="learning-facets">
          <summary>分類と背景情報</summary>
          <div class="learning-facet-list">${facets.map(item => `<span>${esc(item)}</span>`).join('')}</div>
        </details>
      ` : ''}

      <div class="learning-detail-actions">
        <button class="btn btn-ghost btn-sm learning-delete-btn" id="learning-delete-btn" type="button">Trashへ移動</button>
      </div>
    </article>
  `;

  container.querySelector('#learning-title-edit')?.addEventListener('click', () => editTitle(container, entry));
  container.querySelector('#learning-delete-btn')?.addEventListener('click', () => {
    if (!window.confirm(`「${entry.title}」をTrashへ移動しますか？`)) return;
    if (!deleteLearningEntry(entry.id)) {
      toast('削除できませんでした。元のデータは残っています。', 'error');
      return;
    }
    selectedEntryId = null;
    toast('Trashへ移動しました。', 'success');
    nav('knowledge');
  });
  container.querySelectorAll('[data-concept-key]').forEach(button => {
    button.addEventListener('click', () => openConceptMatches(
      conceptIndex,
      {
        key: button.dataset.conceptKey,
        label: button.dataset.conceptLabel || button.textContent,
      },
      entry.id
    ));
  });
  container.querySelectorAll('[data-learning-section]').forEach(button => {
    button.addEventListener('click', () => {
      const target = container.querySelector(`#${button.dataset.learningSection}`);
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      target?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    });
  });
}

function renderSegments(segments, conceptIndex, currentId) {
  return (Array.isArray(segments) ? segments : []).map(segment => {
    let content = esc(segment.text || '');
    const marks = Array.isArray(segment.marks) ? segment.marks : [];
    marks.forEach(mark => {
      if (mark === 'strong') content = `<strong>${content}</strong>`;
      if (mark === 'highlight-yellow') content = `<mark class="learning-mark learning-mark--yellow">${content}</mark>`;
      if (mark === 'highlight-blue') content = `<mark class="learning-mark learning-mark--blue">${content}</mark>`;
      if (mark === 'warning') content = `<span class="learning-warning-text">${content}</span>`;
    });
    if (!segment.conceptKey) return content;
    const matches = findKnowledgeConceptMatches(conceptIndex, { key: segment.conceptKey })
      .filter(match => match.id !== currentId);
    if (!matches.length) return content;
    return `<button class="learning-inline-link" type="button"
      data-concept-key="${esc(segment.conceptKey)}" data-concept-label="${esc(segment.text || '')}">${content}</button>`;
  }).join('');
}

function renderConceptChip(concept, conceptIndex, currentId) {
  const matches = findKnowledgeConceptMatches(conceptIndex, concept).filter(match => match.id !== currentId);
  if (!matches.length) return `<span class="learning-concept-chip">${esc(concept.label)}</span>`;
  return `<button class="learning-concept-chip learning-concept-chip--linked" type="button"
    data-concept-key="${esc(concept.key)}" data-concept-label="${esc(concept.label)}">${esc(concept.label)}</button>`;
}

function openConceptMatches(index, concept, currentId) {
  const matches = findKnowledgeConceptMatches(index, concept).filter(entry => entry.id !== currentId);
  if (matches.length === 1) {
    openLearningEntry(matches[0].id);
    return;
  }
  if (!matches.length) return;
  const body = document.createElement('div');
  body.className = 'learning-match-picker';
  body.innerHTML = matches.map(match => `
    <button type="button" data-match-id="${esc(match.id)}">
      <strong>${esc(match.title)}</strong>
      <span>${esc(match.originalQuestion)}</span>
    </button>
  `).join('');
  const close = window.AppNav?.openModal({ title: concept.label || '関連する解説', body });
  body.querySelectorAll('[data-match-id]').forEach(button => {
    button.addEventListener('click', () => {
      close?.();
      openLearningEntry(button.dataset.matchId);
    });
  });
}

function editTitle(container, entry) {
  const title = container.querySelector('#learning-detail-title');
  if (!title) return;
  const input = document.createElement('input');
  input.className = 'input learning-title-input';
  input.value = entry.title || '';
  input.maxLength = 80;
  title.replaceWith(input);
  input.focus();
  input.select();
  const finish = () => {
    const value = input.value.trim();
    if (value && value !== entry.title) {
      const now = new Date().toISOString();
      updateLearningEntry(entry.id, {
        title: value,
        titleSource: 'user',
        titleEditedByUser: true,
        fieldUpdatedAt: { ...(entry.fieldUpdatedAt || {}), title: now },
      });
      toast('タイトルを変更しました。', 'success');
    }
    initLearningDetail(container);
  };
  input.addEventListener('blur', finish, { once: true });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      input.blur();
    }
    if (event.key === 'Escape') {
      input.value = entry.title || '';
      input.blur();
    }
  });
}

function formatEntryDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ja-JP', { month: 'short', day: 'numeric' }).format(date);
}
