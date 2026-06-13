// ============================================================
// knowledge-graph.js — Tag network visualization (SVG + force layout)
// ============================================================

import { getKnowledgeMemos } from '../storage.js';
import { esc } from '../utils.js';

const nav = (view) => window.AppNav?.navigate(view);

// Module-level: selected tag for filtering
export let graphFilterTag = null;

export function initKnowledgeGraph(container) {
  const memos = getKnowledgeMemos();

  if (!memos.length) {
    container.innerHTML = `
      <div class="empty-state" style="height:100%">
        <div class="empty-state-icon">🕸️</div>
        <div class="empty-state-text">ナレッジメモがまだありません</div>
        <div class="empty-state-sub">メモを作成するとタグのネットワークが表示されます</div>
      </div>`;
    return;
  }

  const { nodes, edges } = buildGraph(memos);

  if (!nodes.length) {
    container.innerHTML = `
      <div class="empty-state" style="height:100%">
        <div class="empty-state-icon">🏷️</div>
        <div class="empty-state-text">タグがまだありません</div>
        <div class="empty-state-sub">メモにタグを追加するとグラフが表示されます</div>
      </div>`;
    return;
  }

  renderGraph(container, nodes, edges, memos);
}

// ============================================================
// Graph building
// ============================================================

function buildGraph(memos) {
  // Count memos per tag
  const tagMemoIds = {}; // tag → Set<memoId>
  memos.forEach(m => {
    (m.tags || []).forEach(t => {
      if (!tagMemoIds[t]) tagMemoIds[t] = new Set();
      tagMemoIds[t].add(m.id);
    });
  });

  const nodes = Object.entries(tagMemoIds).map(([tag, ids]) => ({
    id:    tag,
    label: tag,
    count: ids.size,
    memoIds: [...ids],
    x: 0, y: 0, vx: 0, vy: 0,
  }));

  // Co-occurrence edges
  const edgeMap = {};
  memos.forEach(m => {
    const tags = (m.tags || []);
    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        const key = [tags[i], tags[j]].sort().join('\0');
        edgeMap[key] = (edgeMap[key] || 0) + 1;
      }
    }
  });
  const edges = Object.entries(edgeMap).map(([key, w]) => {
    const [a, b] = key.split('\0');
    return { a, b, weight: w };
  });

  return { nodes, edges };
}

// ============================================================
// Force-directed layout (Fruchterman-Reingold)
// ============================================================

function computeLayout(nodes, edges, W, H) {
  const PADDING = 50;
  const ITERS   = 200;
  const nodeMap = {};

  // Initialize on circle
  nodes.forEach((n, i) => {
    const angle = (i / nodes.length) * 2 * Math.PI;
    const r = Math.min(W, H) * 0.32;
    n.x = W / 2 + r * Math.cos(angle);
    n.y = H / 2 + r * Math.sin(angle);
    nodeMap[n.id] = n;
  });

  const area = W * H;
  const k    = Math.sqrt(area / Math.max(nodes.length, 1)) * 0.75;

  for (let iter = 0; iter < ITERS; iter++) {
    const temp = 15 * (1 - iter / ITERS); // cooling

    // Repulsion
    nodes.forEach(a => { a.dx = 0; a.dy = 0; });
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.5);
        const f = (k * k) / dist;
        a.dx += (dx / dist) * f;
        a.dy += (dy / dist) * f;
        b.dx -= (dx / dist) * f;
        b.dy -= (dy / dist) * f;
      }
    }

    // Attraction
    edges.forEach(e => {
      const a = nodeMap[e.a], b = nodeMap[e.b];
      if (!a || !b) return;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.5);
      const f = (dist * dist) / k * Math.min(e.weight, 3);
      a.dx += (dx / dist) * f;
      a.dy += (dy / dist) * f;
      b.dx -= (dx / dist) * f;
      b.dy -= (dy / dist) * f;
    });

    // Apply displacement
    nodes.forEach(n => {
      const mag = Math.sqrt(n.dx * n.dx + n.dy * n.dy) || 1;
      const clamp = Math.min(mag, temp);
      n.x += (n.dx / mag) * clamp;
      n.y += (n.dy / mag) * clamp;
      n.x = Math.max(PADDING, Math.min(W - PADDING, n.x));
      n.y = Math.max(PADDING, Math.min(H - PADDING, n.y));
    });
  }
}

// ============================================================
// SVG Render
// ============================================================

function renderGraph(container, nodes, edges, allMemos) {
  const W = Math.min(container.clientWidth || 360, 680);
  const H = Math.min(window.innerHeight - 160, 520);

  computeLayout(nodes, edges, W, H);

  // Scale node radius by count (sqrt for visual balance)
  const maxCount = Math.max(...nodes.map(n => n.count), 1);
  const nodeR = n => 14 + Math.sqrt(n.count / maxCount) * 18;

  // Scale edge width by weight
  const maxW = Math.max(...edges.map(e => e.weight), 1);
  const edgeW = e => 1 + (e.weight / maxW) * 4;

  // Color palette for nodes (cycle)
  const COLORS = ['#8B83E8', '#32D49A', '#F5C542', '#F07090', '#60A5FA', '#F0905A', '#A78BFA'];
  const tagColorMap = {};
  nodes.forEach((n, i) => { tagColorMap[n.id] = COLORS[i % COLORS.length]; });

  const nodeMap = {};
  nodes.forEach(n => { nodeMap[n.id] = n; });

  // Build SVG
  const edgeSVG = edges.map(e => {
    const a = nodeMap[e.a], b = nodeMap[e.b];
    if (!a || !b) return '';
    return `<line class="kg-edge" data-a="${esc(e.a)}" data-b="${esc(e.b)}"
      x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"
      stroke="rgba(255,255,255,0.10)" stroke-width="${edgeW(e).toFixed(1)}"/>`;
  }).join('');

  const nodeSVG = nodes.map(n => {
    const r   = nodeR(n);
    const col = tagColorMap[n.id];
    const labelLines = splitLabel(n.label, 8);
    const dy  = labelLines.length === 1 ? '0.35em' : '-0.3em';
    return `
      <g class="kg-node" data-tag="${esc(n.id)}" transform="translate(${n.x},${n.y})" style="cursor:pointer">
        <circle r="${r}" fill="${col}" fill-opacity="0.20" stroke="${col}" stroke-width="1.5"/>
        <text text-anchor="middle" font-size="${Math.max(9, 11 - n.label.length * 0.3)}" fill="${col}" font-weight="700" dy="${dy}">
          ${labelLines.map((ln, i) => `<tspan x="0" dy="${i===0?dy:'1.2em'}">${esc(ln)}</tspan>`).join('')}
        </text>
        <text text-anchor="middle" dy="${r + 14}" font-size="10" fill="rgba(255,255,255,0.4)">
          ${n.count}件
        </text>
      </g>`;
  }).join('');

  container.innerHTML = `
    <div class="kg-page">
      <div class="kg-header">
        <div class="kg-info">
          <span class="kg-info-count">${nodes.length} タグ</span>
          <span class="kg-info-sep">·</span>
          <span class="kg-info-count">${allMemos.length} メモ</span>
        </div>
        <div class="kg-hint">タグをタップしてメモを絞り込み</div>
      </div>
      <div class="kg-svg-wrap">
        <svg class="kg-svg" viewBox="0 0 ${W} ${H}" width="100%" height="${H}">
          <g class="kg-edges">${edgeSVG}</g>
          <g class="kg-nodes">${nodeSVG}</g>
        </svg>
      </div>
      <div class="kg-panel hidden" id="kg-panel">
        <div class="kg-panel-header">
          <span class="kg-panel-tag" id="kg-panel-tag"></span>
          <button class="kg-panel-close" id="kg-panel-close">✕</button>
        </div>
        <div class="kg-panel-memos" id="kg-panel-memos"></div>
      </div>
    </div>
  `;

  // Wire node taps
  container.querySelectorAll('.kg-node').forEach(el => {
    el.addEventListener('click', () => {
      const tag = el.dataset.tag;
      showTagPanel(tag, nodes, edges, allMemos, container);
    });
  });

  container.querySelector('#kg-panel-close')?.addEventListener('click', () => {
    container.querySelector('#kg-panel')?.classList.add('hidden');
    clearHighlight(container);
  });
}

function showTagPanel(tag, nodes, edges, allMemos, container) {
  const memos   = allMemos.filter(m => (m.tags || []).includes(tag));
  const panel   = container.querySelector('#kg-panel');
  const tagEl   = container.querySelector('#kg-panel-tag');
  const memosEl = container.querySelector('#kg-panel-memos');
  if (!panel || !tagEl || !memosEl) return;

  // Highlight connected nodes, dim the rest
  const connectedTags = new Set([tag]);
  edges.forEach(e => {
    if (e.a === tag) connectedTags.add(e.b);
    if (e.b === tag) connectedTags.add(e.a);
  });

  container.querySelectorAll('.kg-node').forEach(el => {
    const isConnected = connectedTags.has(el.dataset.tag);
    el.classList.toggle('kg-node--dim', !isConnected);
    el.classList.toggle('kg-node--active', el.dataset.tag === tag);
  });
  container.querySelectorAll('.kg-edge').forEach(el => {
    const a = el.dataset.a, b = el.dataset.b;
    const isConnected = (a === tag || b === tag);
    el.classList.toggle('kg-edge--highlight', isConnected);
    el.classList.toggle('kg-edge--dim', !isConnected);
  });

  tagEl.textContent = `# ${tag}`;
  memosEl.innerHTML = memos.map(m => `
    <div class="kg-panel-memo" data-memo-id="${esc(m.id)}">
      <div class="kg-panel-memo-title">${esc(m.title || '無題')}</div>
      <div class="kn-tag-list">
        ${(m.tags || []).filter(t => t !== tag).slice(0, 3).map(t => `<span class="kn-tag-chip kn-tag-chip--sm">${esc(t)}</span>`).join('')}
      </div>
    </div>`).join('');

  panel.classList.remove('hidden');

  memosEl.querySelectorAll('[data-memo-id]').forEach(card => {
    card.addEventListener('click', () => {
      graphFilterTag = tag;
      window._knNav?.(card.dataset.memoId);
    });
  });
}

function clearHighlight(container) {
  container.querySelectorAll('.kg-node').forEach(el => {
    el.classList.remove('kg-node--dim', 'kg-node--active');
  });
  container.querySelectorAll('.kg-edge').forEach(el => {
    el.classList.remove('kg-edge--highlight', 'kg-edge--dim');
  });
}

function splitLabel(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const mid = Math.ceil(text.length / 2);
  return [text.slice(0, mid), text.slice(mid)];
}
