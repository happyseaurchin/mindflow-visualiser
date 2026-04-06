/**
 * pscale-to-gingko.js — Convert pure pscale JSON blocks to Gingko Writer JSON format.
 *
 * Pscale: { "_": "text", "1": ..., "2": ... }
 * Gingko: [{ "content": "markdown", "children": [...] }]
 *
 * Usage (ES module):
 *   import { pscaleToGingko } from './pscale-to-gingko.js';
 *   const gingko = pscaleToGingko(block);
 *
 * Usage (CLI):
 *   node pscale-to-gingko.js input.json > output-gingko.json
 */

import { collectUnderscore } from './bsp.js';

function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Convert a pscale node to a Gingko card.
 * Gingko export format: { content, children } — no id field.
 * @param {*} node — string (leaf) or object (branch)
 * @returns {{ content: string, children: Array }}
 */
function nodeToCard(node) {
  if (typeof node === 'string') {
    return { content: node, children: [] };
  }

  if (!isObj(node)) {
    return { content: String(node), children: [] };
  }

  // Get the underscore text (follows _._ chains)
  const text = collectUnderscore(node) || '';

  // Collect digit children in order
  const children = [];
  for (const d of '123456789') {
    if (d in node) {
      children.push(nodeToCard(node[d]));
    }
  }

  return { content: text, children };
}

/**
 * Convert a full pscale block to Gingko Writer JSON format.
 * Returns an array with one root card (Gingko expects an array at top level).
 *
 * @param {object} block — pure pscale JSON block
 * @returns {Array<{ content: string, children: Array }>}
 */
export function pscaleToGingko(block) {
  return [nodeToCard(block)];
}

/**
 * Convert Gingko Writer JSON back to a pscale block.
 * Inverse operation — takes Gingko array, returns pure pscale JSON.
 *
 * @param {Array} gingko — Gingko JSON array
 * @returns {object} — pscale block
 */
export function gingkoToPscale(gingko) {
  function cardToNode(card) {
    if (!card.children || card.children.length === 0) {
      return card.content || '';
    }

    const node = {};
    if (card.content) node._ = card.content;

    card.children.forEach((child, i) => {
      const digit = String(i + 1);
      if (parseInt(digit) <= 9) {
        node[digit] = cardToNode(child);
      }
      // Gingko can have >9 siblings; pscale can't — excess are dropped
    });

    return node;
  }

  if (!Array.isArray(gingko) || gingko.length === 0) return {};

  // If single root card, return it directly
  if (gingko.length === 1) return cardToNode(gingko[0]);

  // Multiple root cards → wrap in a block with digit keys
  const block = {};
  gingko.forEach((card, i) => {
    const digit = String(i + 1);
    if (parseInt(digit) <= 9) {
      block[digit] = cardToNode(card);
    }
  });
  return block;
}


// ── CLI ──────────────────────────────────────────────────

const isMain = typeof process !== 'undefined' && process.argv[1]?.endsWith('pscale-to-gingko.js');

if (isMain) {
  const fs = await import('fs');
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: node pscale-to-gingko.js <input.json> [--reverse]');
    console.error('  Converts pscale JSON → Gingko JSON (or --reverse for Gingko → pscale)');
    process.exit(1);
  }

  const inputPath = args[0];
  const reverse = args.includes('--reverse');
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

  if (reverse) {
    console.log(JSON.stringify(gingkoToPscale(input), null, 2));
  } else {
    console.log(JSON.stringify(pscaleToGingko(input), null, 2));
  }
}
