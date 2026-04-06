/**
 * bsp.js — pure-form BSP for pscale JSON blocks.
 *
 * No tree wrapper, no tuning field, no metadata. The block IS the tree.
 * Floor derived from the underscore chain. Digit 0 maps to key '_'.
 *
 * Modes:
 *   bsp(block)                          → dir: full tree
 *   bsp(block, number)                  → spindle: root-to-target chain
 *   bsp(block, number, 'ring')          → ring: siblings at terminal
 *   bsp(block, number, 'dir')           → dir: subtree from target down
 *   bsp(block, number, pscale, 'point') → point: single node at pscale
 *   bsp(block, null, depth, 'disc')     → disc: all nodes at a depth
 *   bsp(block, number, '*')             → star: hidden directory at terminal
 *
 * Port of bsp-star.py — same inputs, equivalent outputs.
 */

// ── Helpers ──────────────────────────────────────────────

function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// ── Underscore chain ─────────────────────────────────────

/** Follow _._ chain to find the semantic text string. */
export function collectUnderscore(node) {
  if (!isObj(node) || !('_' in node)) return null;
  const val = node._;
  if (typeof val === 'string') return val;
  if (isObj(val)) return '_' in val ? collectUnderscore(val) : null;
  return null;
}

/** Follow underscore chain to find the level with digit children. */
export function findHiddenLevel(node) {
  if (!isObj(node) || !('_' in node)) return null;
  const val = node._;
  if (!isObj(val)) return null;
  let current = val;
  while (isObj(current)) {
    if ('123456789'.split('').some(k => k in current)) return current;
    if ('_' in current && isObj(current._)) { current = current._; }
    else break;
  }
  return null;
}

/** Check if a node has a hidden directory. */
export function hasHiddenDirectory(node) {
  return findHiddenLevel(node) !== null;
}

/** Extract hidden directory contents: {digit: content} or null. */
export function getHiddenDirectory(node) {
  const level = findHiddenLevel(node);
  if (!level) return null;
  const result = {};
  for (const k of '123456789') {
    if (k in level) result[k] = level[k];
  }
  return result;
}

// ── Floor ────────────────────────────────────────────────

/** Follow underscore chain until a string. Count = floor. */
export function floorDepth(block) {
  let node = block, depth = 0;
  while (isObj(node) && '_' in node) {
    depth++;
    node = node._;
    if (typeof node === 'string') return depth;
  }
  return depth;
}

// ── Address parsing ──────────────────────────────────────

/** Parse a pscale number into a list of digit characters to walk. */
export function parseAddress(number) {
  let s = String(number);
  // Remove decimal point — notation, not structure
  s = s.replace(/\./g, '');
  // Strip trailing zeros (from float formatting)
  s = s.replace(/0+$/, '') || '0';
  return s.split('');
}

// ── Walk ─────────────────────────────────────────────────

/**
 * Walk the tree collecting texts. Digit 0 maps to key '_'.
 * Returns { chain, terminal, parent, lastKey }
 * where chain is array of { text, depth }.
 */
export function walk(block, digits) {
  const chain = [];
  let node = block, parent = null, lastKey = null, depth = 0;

  // Collect root text
  const rootText = collectUnderscore(node);
  if (rootText !== null) chain.push({ text: rootText, depth });

  for (const d of digits) {
    const key = d === '0' ? '_' : d;
    if (!isObj(node) || !(key in node)) break;
    const target = node[key];
    // Walking '0' into a string '_' means floor spine — already collected
    if (d === '0' && typeof target === 'string') break;
    parent = node;
    lastKey = key;
    node = target;
    depth++;
    if (typeof node === 'string') {
      chain.push({ text: node, depth });
      break;
    } else if (isObj(node)) {
      const text = collectUnderscore(node);
      if (text !== null) chain.push({ text, depth });
    }
  }

  return { chain, terminal: node, parent, lastKey };
}

// ── Delta (write side) ───────────────────────────────────

/**
 * Apply delta operations to mutate a block.
 * ops: array of { op, address, content, child? }
 *   set:       place content at an empty address
 *   subnest:   leaf at address becomes branch — text moves to _, content goes to child
 *   fork:      add a new child at address.child (address must be a branch)
 *   supernest: entire block wraps into underscore, new content at digit 1
 *              — the block grows upward. Floor increments by 1.
 *              op.content = the new entry at digit 1.
 *              op.summary (optional) = new root underscore summarising accumulated content.
 *
 * supernest returns a NEW block object (the old reference is stale).
 * All other ops mutate in place and return the same block.
 */
export function applyDelta(block, ops) {
  for (const op of ops) {
    if (op.op === 'supernest') {
      // Wrap entire existing block into the underscore position.
      // What was the whole block becomes block._ (the accumulated context).
      // op.content goes to digit 1 (the new entry).
      // op.summary (optional) becomes the new semantic text — inserted as
      // block._._ if the old root _ was a string, wrapping it one level deeper.
      const wrapped = {};

      if (op.summary) {
        // Old block becomes the underscore interior.
        // The summary becomes the new root semantic text,
        // nested as: { _: { _: old_root_underscore, ...old_digits }, ...new }
        // But simpler: just set old block as _ and let floor detection handle it.
        wrapped._ = block;
      } else {
        wrapped._ = block;
      }

      wrapped['1'] = op.content;
      block = wrapped;
      continue;
    }

    const digits = parseAddress(op.address);
    // Navigate to parent of target
    let node = block;
    for (let i = 0; i < digits.length - 1; i++) {
      const key = digits[i] === '0' ? '_' : digits[i];
      if (!isObj(node) || !(key in node)) break;
      node = node[key];
    }
    const finalKey = digits[digits.length - 1] === '0' ? '_' : digits[digits.length - 1];

    if (op.op === 'set') {
      // Place content at an empty address
      if (isObj(node) && !(finalKey in node)) {
        node[finalKey] = op.content;
      }
    } else if (op.op === 'subnest') {
      // Leaf becomes branch: existing text moves to _, new content goes to child digit
      if (isObj(node) && finalKey in node && typeof node[finalKey] === 'string') {
        const existing = node[finalKey];
        node[finalKey] = { _: existing };
        if (op.child) node[finalKey][op.child] = op.content;
      }
    } else if (op.op === 'fork') {
      // Add a new child to an existing branch
      if (isObj(node) && finalKey in node && isObj(node[finalKey]) && op.child) {
        if (!(op.child in node[finalKey])) {
          node[finalKey][op.child] = op.content;
        }
      }
    }
  }
  return block;
}

// ── BSP dispatch ─────────────────────────────────────────

/**
 * bsp(block, number?, point?, mode?)
 * Pure-form BSP. Block is the tree — no wrapper.
 */
export function bsp(block, number = null, point = null, mode = null) {
  const fl = floorDepth(block);

  // Dir (full) — no args
  if (number === null && point === null && mode === null) {
    return { mode: 'dir', tree: block };
  }

  // Disc — bsp(block, null, depth, 'disc')
  if (mode === 'disc' && point !== null) {
    const target = typeof point === 'string' ? parseInt(point, 10) : point;
    const nodes = [];
    function collect(node, depth, path) {
      if (depth === target) {
        let text = null;
        if (typeof node === 'string') {
          text = node;
        } else if (isObj(node)) {
          let inner = node._ ?? null;
          while (isObj(inner) && '_' in inner) inner = inner._;
          if (typeof inner === 'string') text = inner;
        }
        nodes.push({ path, text });
        return;
      }
      if (!isObj(node)) return;
      if ('_' in node && isObj(node._)) {
        collect(node._, depth + 1, path ? `${path}.0` : '0');
      }
      for (const d of '123456789') {
        if (d in node) collect(node[d], depth + 1, path ? `${path}.${d}` : d);
      }
    }
    collect(block, 0, '');
    return { mode: 'disc', depth: target, nodes };
  }

  // Parse address and walk
  const digits = parseAddress(number);
  const { chain, terminal, parent, lastKey } = walk(block, digits);

  // Star — hidden directory at terminal
  if (point === '*') {
    const hd = getHiddenDirectory(terminal);
    const semantic = isObj(terminal) ? collectUnderscore(terminal) : null;
    return { mode: 'star', address: String(number), semantic, hidden: hd };
  }

  // Ring — siblings at terminal
  if (point === 'ring') {
    if (!parent || !isObj(parent)) return { mode: 'ring', siblings: [] };
    const siblings = [];
    if (lastKey !== '_' && '_' in parent && isObj(parent._)) {
      siblings.push({ digit: '0', text: collectUnderscore(parent), branch: true });
    }
    for (const d of '123456789') {
      if (d === lastKey || !(d in parent)) continue;
      const v = parent[d];
      const text = typeof v === 'string' ? v : collectUnderscore(v);
      siblings.push({ digit: d, text, branch: isObj(v) });
    }
    return { mode: 'ring', siblings };
  }

  // Dir (subtree)
  if (point === 'dir') {
    return { mode: 'dir', subtree: terminal };
  }

  // Pscale computation
  const pscaleAt = (depth) => (fl - 1) - depth;

  // Point — content at a specific pscale
  if (mode === 'point' && point !== null) {
    const ps = typeof point === 'string' ? parseInt(point, 10) : point;
    for (const entry of chain) {
      if (pscaleAt(entry.depth) === ps) return { mode: 'point', pscale: ps, text: entry.text };
    }
    const last = chain.length ? chain[chain.length - 1] : null;
    return { mode: 'point', pscale: ps, text: last ? last.text : null };
  }

  // Spindle (default) — annotate with pscale
  const nodes = chain.map(entry => ({ pscale: pscaleAt(entry.depth), text: entry.text }));
  return { mode: 'spindle', nodes };
}
