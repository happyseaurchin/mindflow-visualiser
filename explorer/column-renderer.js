/**
 * column-renderer.js — Gingko-style column layout for pscale blocks.
 *
 * Each column shows siblings at one depth level. Clicking a card
 * selects it and opens its children in the next column to the right.
 * The active path through the tree is the spindle.
 */

import { collectUnderscore } from '../bsp.js';

function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Extract cards (digit children) from a pscale node. */
function getCards(node) {
  if (!isObj(node)) return [];
  const cards = [];
  for (const d of '123456789') {
    if (d in node) {
      const child = node[d];
      const text = typeof child === 'string' ? child : (isObj(child) ? collectUnderscore(child) : String(child));
      const hasChildren = isObj(child) && '123456789'.split('').some(k => k in child);
      cards.push({ digit: d, text: text || '', node: child, hasChildren });
    }
  }
  return cards;
}

export class ColumnRenderer {
  constructor(container, onSpindle, onEdit) {
    this.container = container;
    this.onSpindle = onSpindle || (() => {});
    this.onEdit = onEdit || (() => {}); // called after an edit with (block)
    this.block = null;
    this.path = []; // array of selected digit keys at each depth
  }

  render(block) {
    this.block = block;
    this.path = [];
    this.update();
  }

  update() {
    this.container.innerHTML = '';
    if (!this.block) return;

    // Build columns by walking the selected path
    let currentNode = this.block;
    const columns = [];

    // Column 0: root's digit children
    const rootCards = getCards(this.block);
    if (rootCards.length > 0) {
      columns.push({
        cards: rootCards,
        selectedDigit: this.path[0] || null,
        depth: 0
      });
    }

    // Follow the selected path for deeper columns
    for (let i = 0; i < this.path.length; i++) {
      const digit = this.path[i];
      if (!isObj(currentNode) || !(digit in currentNode)) break;
      currentNode = currentNode[digit];

      const cards = getCards(currentNode);
      if (cards.length > 0) {
        columns.push({
          cards,
          selectedDigit: this.path[i + 1] || null,
          depth: i + 1
        });
      }
    }

    // Render columns (no root header — spindle panel on left handles that)
    const columnsWrap = document.createElement('div');
    columnsWrap.className = 'col-columns';
    this.container.appendChild(columnsWrap);

    for (const col of columns) {
      const colEl = document.createElement('div');
      colEl.className = 'col-column';

      for (const card of col.cards) {
        const cardEl = document.createElement('div');
        cardEl.className = 'col-card';
        if (card.digit === col.selectedDigit) cardEl.classList.add('selected');
        if (card.hasChildren) cardEl.classList.add('has-children');

        const digitLabel = document.createElement('span');
        digitLabel.className = 'col-digit';
        digitLabel.textContent = card.digit;

        const textEl = document.createElement('div');
        textEl.className = 'col-text';
        textEl.textContent = card.text;

        cardEl.appendChild(digitLabel);
        cardEl.appendChild(textEl);

        let clickTimer = null;
        cardEl.addEventListener('click', () => {
          // Delay click to let dblclick cancel it
          clearTimeout(clickTimer);
          clickTimer = setTimeout(() => {
            this.path = this.path.slice(0, col.depth);
            this.path[col.depth] = card.digit;
            this.update();
            this.emitSpindle();
          }, 250);
        });

        cardEl.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          clearTimeout(clickTimer);
          // Select the card first (without rebuild)
          this.path = this.path.slice(0, col.depth);
          this.path[col.depth] = card.digit;
          this.emitSpindle();
          // Enter edit mode on this card
          this.editCard(cardEl, textEl, col.depth, card.digit);
        });

        colEl.appendChild(cardEl);
      }

      columnsWrap.appendChild(colEl);
    }

    // Scroll rightmost column into view
    if (columnsWrap.lastChild) {
      columnsWrap.lastChild.scrollIntoView({ behavior: 'smooth', inline: 'end' });
    }
  }

  /** Double-click editing: card text becomes a textarea. */
  editCard(cardEl, textEl, depth, digit) {
    if (cardEl.querySelector('textarea')) return; // already editing

    const original = textEl.textContent;
    const ta = document.createElement('textarea');
    ta.className = 'col-edit';
    ta.value = original;
    ta.rows = Math.max(3, Math.ceil(original.length / 40));

    textEl.style.display = 'none';
    cardEl.appendChild(ta);
    ta.focus();
    ta.select();

    const commit = () => {
      const newText = ta.value.trim();
      ta.remove();
      textEl.style.display = '';
      if (newText && newText !== original) {
        // Walk to the node and mutate
        const pathToNode = [...this.path.slice(0, depth), digit];
        this.mutateNode(pathToNode, newText);
        textEl.textContent = newText;
        this.onEdit(this.block);
        // Re-emit spindle with updated text
        if (this.path.length > 0) this.emitSpindle();
      }
    };

    ta.addEventListener('blur', commit);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        ta.value = original;
        ta.blur();
      }
      // Ctrl/Cmd+Enter to save
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        ta.blur();
      }
    });
  }

  /** Walk the block to a node at the given path and set its text. */
  mutateNode(pathDigits, newText) {
    let parent = this.block;
    for (let i = 0; i < pathDigits.length - 1; i++) {
      const d = pathDigits[i];
      if (!isObj(parent) || !(d in parent)) return;
      parent = parent[d];
    }
    const lastDigit = pathDigits[pathDigits.length - 1];
    if (!isObj(parent)) return;

    const target = parent[lastDigit];
    if (typeof target === 'string') {
      // Leaf — replace the string
      parent[lastDigit] = newText;
    } else if (isObj(target) && '_' in target) {
      // Branch — replace the underscore text
      // Follow _._ chain to find the deepest string
      let node = target;
      while (isObj(node._) && '_' in node._) node = node._;
      if (typeof node._ === 'string') {
        node._ = newText;
      }
    }
  }

  emitSpindle() {
    // Build spindle from path, include address and digit info
    const texts = [];
    const rootText = collectUnderscore(this.block);
    if (rootText) texts.push({ pscale: 0, text: rootText, digit: null });

    let node = this.block;
    for (let i = 0; i < this.path.length; i++) {
      const d = this.path[i];
      if (!isObj(node) || !(d in node)) break;
      node = node[d];
      const text = typeof node === 'string' ? node : (isObj(node) ? collectUnderscore(node) : null);
      if (text) texts.push({ pscale: -(i + 1), text, digit: d });
    }

    // Build the address string from path
    const address = this.path.join('.');

    this.onSpindle(texts, address);
  }
}
