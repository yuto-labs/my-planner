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
  const tagMemoIds = new Map();
  memos.forEach(m => {
    const tags = [...new Set((m.tags || []).map(tag => tag.trim()).filter(Boolean))];
    tags.forEach(tag => {
      if (!tagMemoIds.has(tag)) tagMemoIds.set(tag, new Set());
      tagMemoIds.get(tag).add(m.id);
    });
  });

  const nodes = [...tagMemoIds.entries()].map(([tag, ids]) => ({
    id:    tag,
    label: tag,
    count: ids.size,
    memoIds: [...ids],
    x: 0, y: 0, vx: 0, vy: 0,
  }));

  const edgeMap = new Map();
  memos.forEach(m => {
    const tags = [...new Set((m.tags || []).map(tag => tag.trim()).filter(Boolean))];
    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        const key = [tags[i], tags[j]].sort().join('\0');
        edgeMap.set(key, (edgeMap.get(key) || 0) + 1);
      }
    }
  });
  const edges = [...edgeMap.entries()].map(([key, w]) => {
    const [a, b] = key.split('\0');
    return { a, b, weight: w };
  });

  const relatedByTag = new Map(nodes.map(node => [node.id, new Set()]));
  edges.forEach(edge => {
    relatedByTag.get(edge.a)?.add(edge.b);
    relatedByTag.get(edge.b)?.add(edge.a);
  });
  nodes.forEach(node => {
    node.connectionCount = relatedByTag.get(node.id)?.size || 0;
    node.width = Math.min(164, Math.max(92, [...node.label].length * 11 + 50));
    node.height = 48;
  });
  nodes.sort((a, b) => b.count - a.count || b.connectionCount - a.connectionCount || a.label.localeCompare(b.label, 'ja'));

  return { nodes, edges };
}

// ============================================================
// Force-directed layout (Fruchterman-Reingold)
// ============================================================

function computeLayout(nodes, edges, W, H) {
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
      const padX = n.width / 2 + 12;
      const padY = n.height / 2 + 18;
      n.x = Math.max(padX, Math.min(W - padX, n.x));
      n.y = Math.max(padY, Math.min(H - padY, n.y));
    });

    // Keep the label cards readable instead of allowing them to stack.
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = b.x - a.x || 0.1;
        const dy = b.y - a.y || 0.1;
        const overlapX = (a.width + b.width) / 2 + 10 - Math.abs(dx);
        const overlapY = (a.height + b.height) / 2 + 10 - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;
        if (overlapX < overlapY) {
          const push = overlapX / 2;
          a.x -= Math.sign(dx) * push;
          b.x += Math.sign(dx) * push;
        } else {
          const push = overlapY / 2;
          a.y -= Math.sign(dy) * push;
          b.y += Math.sign(dy) * push;
        }
      }
    }
    nodes.forEach(node => {
      const padX = node.width / 2 + 12;
      const padY = node.height / 2 + 18;
      node.x = Math.max(padX, Math.min(W - padX, node.x));
      node.y = Math.max(padY, Math.min(H - padY, node.y));
    });
  }
}

// ============================================================
// SVG Render
// ============================================================

function renderGraph(container, nodes, edges, allMemos) {
  const W = Math.min(container.clientWidth || 360, 680);
  const H = Math.max(330, Math.min(window.innerHeight - 260, 500));

  computeLayout(nodes, edges, W, H);

  const maxCount = Math.max(...nodes.map(n => n.count), 1);
  const maxW = Math.max(...edges.map(e => e.weight), 1);
  const edgeW = e => 1 + (e.weight / maxW) * 3;
  const nodeStrength = n => 0.24 + (n.count / maxCount) * 0.5;

  const nodeMap = {};
  nodes.forEach(n => { nodeMap[n.id] = n; });

  // Build SVG
  const edgeSVG = edges.map(e => {
    const a = nodeMap[e.a], b = nodeMap[e.b];
    if (!a || !b) return '';
    return `<line class="kg-edge" data-a="${esc(e.a)}" data-b="${esc(e.b)}"
      x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"
      stroke-width="${edgeW(e).toFixed(1)}"/>`;
  }).join('');

  const nodeSVG = nodes.map(n => {
    const fillOpacity = nodeStrength(n).toFixed(2);
    return `
      <g class="kg-node" data-tag="${esc(n.id)}" transform="translate(${n.x},${n.y})"
        role="button" tabindex="0" aria-label="${esc(n.label)}、${n.count}件のメモ、${n.connectionCount}個の関連タグ">
        <rect x="${-n.width / 2}" y="${-n.height / 2}" width="${n.width}" height="${n.height}" rx="8"
          style="--kg-node-strength:${fillOpacity}"/>
        <text class="kg-node-label" text-anchor="middle" y="-4">${esc(n.label)}</text>
        <text class="kg-node-meta" text-anchor="middle" y="14">${n.count}メモ · ${n.connectionCount}関連</text>
      </g>`;
  }).join('');

  const untaggedCount = allMemos.filter(memo => !(memo.tags || []).some(tag => tag.trim())).length;
  const topTags = nodes.slice(0, 6);
  container.innerHTML = `
    <div class="kg-page">
      <div class="kg-header">
        <div class="kg-header-main">
          <div>
            <strong>タグから知識のまとまりを見つける</strong>
            <p>同じメモに付いたタグ同士を線で結んでいます。</p>
          </div>
          <div class="kg-stats" aria-label="グラフの概要">
            <span><b>${allMemos.length}</b> メモ</span>
            <span><b>${nodes.length}</b> タグ</span>
            <span><b>${edges.length}</b> 接続</span>
            ${untaggedCount ? `<span class="kg-stat-muted"><b>${untaggedCount}</b> 未整理</span>` : ''}
          </div>
        </div>
        <div class="kg-quick-row">
          <span class="kg-quick-label">よく使うタグ</span>
          <div class="kg-quick-tags">
            ${topTags.map(node => `
              <button type="button" data-kg-quick-tag="${esc(node.id)}">
                ${esc(node.label)} <span>${node.count}</span>
              </button>
            `).join('')}
          </div>
        </div>
        <div class="kg-legend" aria-label="グラフの見方">
          <span><i class="kg-legend-card"></i>カードの濃さ＝メモ数</span>
          <span><i class="kg-legend-line"></i>線の太さ＝共通メモ数</span>
        </div>
      </div>
      <div class="kg-svg-wrap">
        <svg class="kg-svg" viewBox="0 0 ${W} ${H}" width="100%" height="${H}">
          <g class="kg-edges">${edgeSVG}</g>
          <g class="kg-nodes">${nodeSVG}</g>
        </svg>
      </div>
      <div class="kg-panel hidden" id="kg-panel">
        <div class="kg-panel-header">
          <div>
            <span class="kg-panel-tag" id="kg-panel-tag"></span>
            <span class="kg-panel-summary" id="kg-panel-summary"></span>
          </div>
          <button class="kg-panel-close" id="kg-panel-close" aria-label="閉じる">×</button>
        </div>
        <div class="kg-panel-related" id="kg-panel-related"></div>
        <div class="kg-panel-section-label">このタグのメモ</div>
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
    el.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      showTagPanel(el.dataset.tag, nodes, edges, allMemos, container);
    });
  });
  container.querySelectorAll('[data-kg-quick-tag]').forEach(button => {
    button.addEventListener('click', () => {
      showTagPanel(button.dataset.kgQuickTag, nodes, edges, allMemos, container);
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
  const summaryEl = container.querySelector('#kg-panel-summary');
  const relatedEl = container.querySelector('#kg-panel-related');
  const memosEl = container.querySelector('#kg-panel-memos');
  if (!panel || !tagEl || !summaryEl || !relatedEl || !memosEl) return;

  const connectedTags = new Set([tag]);
  const related = [];
  edges.forEach(e => {
    if (e.a === tag) {
      connectedTags.add(e.b);
      related.push({ tag: e.b, weight: e.weight });
    }
    if (e.b === tag) {
      connectedTags.add(e.a);
      related.push({ tag: e.a, weight: e.weight });
    }
  });
  related.sort((a, b) => b.weight - a.weight || a.tag.localeCompare(b.tag, 'ja'));

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

  tagEl.textContent = tag;
  summaryEl.textContent = `${memos.length}件のメモ · ${related.length}個の関連タグ`;
  relatedEl.innerHTML = related.length ? `
    <div class="kg-panel-section-label">関連タグ</div>
    <div class="kg-related-list">
      ${related.map(item => `
        <button type="button" data-kg-related-tag="${esc(item.tag)}">
          ${esc(item.tag)} <span>共通${item.weight}</span>
        </button>
      `).join('')}
    </div>
  ` : '<p class="kg-no-related">ほかのタグとの接続はまだありません。</p>';
  memosEl.innerHTML = memos.map(m => `
    <button type="button" class="kg-panel-memo" data-memo-id="${esc(m.id)}">
      <div class="kg-panel-memo-title">${esc(m.title || '無題')}</div>
      <div class="kn-tag-list">
        ${(m.tags || []).filter(t => t !== tag).slice(0, 3).map(t => `<span class="kn-tag-chip kn-tag-chip--sm">${esc(t)}</span>`).join('')}
      </div>
    </button>`).join('');

  panel.classList.remove('hidden');

  relatedEl.querySelectorAll('[data-kg-related-tag]').forEach(button => {
    button.addEventListener('click', () => {
      showTagPanel(button.dataset.kgRelatedTag, nodes, edges, allMemos, container);
    });
  });
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
