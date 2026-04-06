/**
 * tree-renderer.js — SVG tree layout and rendering for pscale blocks.
 * No D3. Recursive layout from the block structure itself.
 */

import { collectUnderscore, bsp, floorDepth } from '../bsp.js';

// ── Layout constants ─────────────────────────────────────

const NODE_H = 36;
const NODE_PAD_X = 12;
const NODE_PAD_Y = 16;
const LEVEL_GAP = 60;
const SIBLING_GAP = 12;
const MIN_NODE_W = 80;
const MAX_NODE_W = 320;
const MAX_TEXT = 50;
const FONT = '12px "SF Mono", "Fira Code", Consolas, monospace';

// ── Colours ──────────────────────────────────────────────

const COL_ROOT = '#d4a054';
const COL_BRANCH = '#5a9bf5';
const COL_LEAF = '#666680';
const COL_EDGE = '#2a2a3e';
const COL_SELECT = '#f4c873';
const COL_NODE_BG = '#12121e';
const COL_NODE_BORDER = '#1a1a2e';

function depthColour(depth, maxDepth) {
  if (depth === 0) return COL_ROOT;
  const t = maxDepth > 1 ? depth / maxDepth : 1;
  // Interpolate branch → leaf
  return t < 0.7 ? COL_BRANCH : COL_LEAF;
}

// ── Parse block into node tree ───────────────────────────

function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function parseBlock(block) {
  let maxDepth = 0;

  function recurse(node, depth, address) {
    if (depth > maxDepth) maxDepth = depth;
    const text = typeof node === 'string' ? node : (isObj(node) ? collectUnderscore(node) : null);
    const truncated = text ? (text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + '…' : text) : '(empty)';
    const result = {
      key: address || '0',
      address,
      text: text || '',
      label: truncated,
      depth,
      children: [],
      descendants: 0,
      width: 0,
      x: 0, y: 0, w: 0
    };

    if (isObj(node)) {
      for (const d of '123456789') {
        if (d in node) {
          const childAddr = address ? `${address}.${d}` : d;
          result.children.push(recurse(node[d], depth + 1, childAddr));
        }
      }
    }

    // Count descendants
    result.descendants = result.children.reduce((s, c) => s + 1 + c.descendants, 0);
    return result;
  }

  const tree = recurse(block, 0, '');
  return { tree, maxDepth };
}

// ── Measure text width ───────────────────────────────────

let measureCtx = null;
function textWidth(str) {
  if (!measureCtx) {
    const c = document.createElement('canvas');
    measureCtx = c.getContext('2d');
    measureCtx.font = FONT;
  }
  return measureCtx.measureText(str).width;
}

// ── Layout: bottom-up width, top-down position ───────────

function layout(node) {
  node.w = Math.min(MAX_NODE_W, Math.max(MIN_NODE_W, textWidth(node.label) + NODE_PAD_X * 2));

  if (node.children.length === 0) {
    node.width = node.w;
    return;
  }

  // Layout children first
  node.children.forEach(layout);

  // Total width = sum of children + gaps
  const childrenWidth = node.children.reduce((s, c) => s + c.width, 0) + (node.children.length - 1) * SIBLING_GAP;
  node.width = Math.max(node.w, childrenWidth);
}

function position(node, x, y) {
  node.y = y;

  if (node.children.length === 0) {
    node.x = x + (node.width - node.w) / 2;
    return;
  }

  // Centre this node above its children
  const childrenWidth = node.children.reduce((s, c) => s + c.width, 0) + (node.children.length - 1) * SIBLING_GAP;
  const childStartX = x + (node.width - childrenWidth) / 2;
  node.x = x + (node.width - node.w) / 2;

  let cx = childStartX;
  for (const child of node.children) {
    position(child, cx, y + NODE_H + LEVEL_GAP);
    cx += child.width + SIBLING_GAP;
  }
}

// ── SVG rendering ────────────────────────────────────────

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function renderEdges(node, g) {
  const sx = node.x + node.w / 2;
  const sy = node.y + NODE_H;

  for (const child of node.children) {
    const ex = child.x + child.w / 2;
    const ey = child.y;
    const my = sy + LEVEL_GAP / 2;
    const path = svgEl('path', {
      d: `M${sx},${sy} C${sx},${my} ${ex},${my} ${ex},${ey}`,
      fill: 'none',
      stroke: COL_EDGE,
      'stroke-width': '1.5',
      class: 'edge'
    });
    path.dataset.from = node.address;
    path.dataset.to = child.address;
    g.appendChild(path);
    renderEdges(child, g);
  }
}

function renderNodes(node, g, maxDepth, onClick) {
  const group = svgEl('g', { class: 'node', 'data-address': node.address });

  const rect = svgEl('rect', {
    x: node.x, y: node.y,
    width: node.w, height: NODE_H,
    rx: 4, ry: 4,
    fill: COL_NODE_BG,
    stroke: depthColour(node.depth, maxDepth),
    'stroke-width': '1.5',
    class: 'node-rect'
  });

  const text = svgEl('text', {
    x: node.x + NODE_PAD_X,
    y: node.y + NODE_H / 2 + 4,
    fill: depthColour(node.depth, maxDepth),
    'font-family': '"SF Mono", "Fira Code", Consolas, monospace',
    'font-size': '12',
    class: 'node-text'
  });
  text.textContent = node.label;

  group.appendChild(rect);
  group.appendChild(text);
  group.style.cursor = 'pointer';

  group.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick(node);
  });

  g.appendChild(group);

  for (const child of node.children) {
    renderNodes(child, g, maxDepth, onClick);
  }
}

// ── Pan & zoom ───────────────────────────────────────────

function setupPanZoom(svg, viewport) {
  let scale = 1, tx = 0, ty = 0;
  let dragging = false, startX, startY;

  function applyTransform() {
    viewport.setAttribute('transform', `translate(${tx},${ty}) scale(${scale})`);
  }

  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const rect = svg.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    // Zoom toward cursor
    tx = mx - (mx - tx) * factor;
    ty = my - (my - ty) * factor;
    scale *= factor;
    scale = Math.max(0.1, Math.min(5, scale));
    applyTransform();
  }, { passive: false });

  svg.addEventListener('mousedown', (e) => {
    if (e.target.closest('.node')) return;
    dragging = true;
    startX = e.clientX - tx;
    startY = e.clientY - ty;
    svg.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    tx = e.clientX - startX;
    ty = e.clientY - startY;
    applyTransform();
  });

  window.addEventListener('mouseup', () => {
    dragging = false;
    svg.style.cursor = 'grab';
  });

  svg.style.cursor = 'grab';

  return {
    fitToView(treeWidth, treeHeight) {
      const pad = 40;
      const svgRect = svg.getBoundingClientRect();
      const sw = svgRect.width - pad * 2;
      const sh = svgRect.height - pad * 2;
      scale = Math.min(1, sw / treeWidth, sh / treeHeight);
      tx = pad + (sw - treeWidth * scale) / 2;
      ty = pad;
      applyTransform();
    }
  };
}

// ── Tree extent ──────────────────────────────────────────

function treeExtent(node) {
  let minX = node.x, maxX = node.x + node.w;
  let maxY = node.y + NODE_H;
  for (const child of node.children) {
    const ext = treeExtent(child);
    if (ext.minX < minX) minX = ext.minX;
    if (ext.maxX > maxX) maxX = ext.maxX;
    if (ext.maxY > maxY) maxY = ext.maxY;
  }
  return { minX, maxX, maxY };
}

// ── Public API ───────────────────────────────────────────

export class TreeRenderer {
  constructor(svgElement, onNodeClick) {
    this.svg = svgElement;
    this.onNodeClick = onNodeClick || (() => {});
    this.viewport = svgEl('g', { class: 'viewport' });
    this.svg.appendChild(this.viewport);
    this.panZoom = setupPanZoom(this.svg, this.viewport);
    this.block = null;
    this.tree = null;
    this.selectedAddress = null;
  }

  render(block) {
    this.block = block;
    this.viewport.innerHTML = '';

    const { tree, maxDepth } = parseBlock(block);
    this.tree = tree;

    layout(tree);
    position(tree, 0, 0);

    // Shift everything so minX = 0
    const ext = treeExtent(tree);
    if (ext.minX < 0) shiftTree(tree, -ext.minX, 0);

    // Draw edges first (behind nodes)
    const edgeGroup = svgEl('g', { class: 'edges' });
    renderEdges(tree, edgeGroup);
    this.viewport.appendChild(edgeGroup);

    // Draw nodes
    const nodeGroup = svgEl('g', { class: 'nodes' });
    renderNodes(tree, nodeGroup, maxDepth, (node) => {
      this.select(node.address);
      this.onNodeClick(node);
    });
    this.viewport.appendChild(nodeGroup);

    // Fit
    const ext2 = treeExtent(tree);
    this.panZoom.fitToView(ext2.maxX - ext2.minX, ext2.maxY);
  }

  select(address) {
    this.selectedAddress = address;
    // Reset all nodes
    this.viewport.querySelectorAll('.node-rect').forEach(r => {
      r.setAttribute('stroke-width', '1.5');
    });
    this.viewport.querySelectorAll('.edge').forEach(e => {
      e.setAttribute('stroke', COL_EDGE);
      e.setAttribute('stroke-width', '1.5');
    });

    if (!address) return;

    // Highlight selected node
    const sel = this.viewport.querySelector(`g.node[data-address="${address}"]`);
    if (sel) {
      sel.querySelector('.node-rect').setAttribute('stroke', COL_SELECT);
      sel.querySelector('.node-rect').setAttribute('stroke-width', '2.5');
    }

    // Highlight spindle path (all ancestors)
    const parts = address.split('.');
    for (let i = 1; i <= parts.length; i++) {
      const ancestorAddr = parts.slice(0, i).join('.');
      const ancestorEl = this.viewport.querySelector(`g.node[data-address="${ancestorAddr}"]`);
      if (ancestorEl) {
        ancestorEl.querySelector('.node-rect').setAttribute('stroke', COL_SELECT);
        ancestorEl.querySelector('.node-rect').setAttribute('stroke-width', '2');
      }
    }
    // Highlight root
    const rootEl = this.viewport.querySelector('g.node[data-address=""]');
    if (rootEl) {
      rootEl.querySelector('.node-rect').setAttribute('stroke', COL_SELECT);
      rootEl.querySelector('.node-rect').setAttribute('stroke-width', '2');
    }

    // Highlight edges on the spindle path
    this.viewport.querySelectorAll('.edge').forEach(e => {
      const to = e.dataset.to;
      if (to && (address === to || address.startsWith(to + '.'))) {
        e.setAttribute('stroke', COL_SELECT);
        e.setAttribute('stroke-width', '2');
      }
    });
  }
}

function shiftTree(node, dx, dy) {
  node.x += dx;
  node.y += dy;
  for (const child of node.children) shiftTree(child, dx, dy);
}
