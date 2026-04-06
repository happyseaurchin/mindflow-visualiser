/**
 * explorer/app.js — Mindflow Block Explorer
 * Two modes: explore (load/paste blocks) and live (speech → LLM → block)
 */

import { bsp, applyDelta, floorDepth } from '../bsp.js';
import { TreeRenderer } from './tree-renderer.js';
import { ColumnRenderer } from './column-renderer.js';
import { pscaleToGingko, gingkoToPscale } from '../pscale-to-gingko.js';

// ── State ────────────────────────────────────────────────

let currentBlock = null;
let currentMode = 'explore';
let isListening = false;
let recognition = null;
let pendingSegments = [];
let lastCompileTime = 0;
let compiling = false;
let currentView = 'columns'; // 'tree' or 'columns'
let currentBlockName = 'starstone-lean';
let isDirty = false;
let saveVersion = 0;

// ── DOM refs ─────────────────────────────────────────────

const treeSvg = document.getElementById('tree-svg');
const treePanel = document.getElementById('tree-panel');
const columnPanel = document.getElementById('column-panel');
const spindlePanel = document.getElementById('spindle-panel');
const spindleContent = document.getElementById('spindle-content');
const jsonEditor = document.getElementById('json-editor');
const explorePanel = document.getElementById('explore-panel');
const livePanel = document.getElementById('live-panel');
const tabBtns = document.querySelectorAll('.tab-btn');
const micBtn = document.getElementById('mic-btn');
const compileStatus = document.getElementById('compile-status');
const transcriptEl = document.getElementById('transcript');
const apiKeyInput = document.getElementById('api-key-input');
const fileUpload = document.getElementById('file-upload');
const transcriptUpload = document.getElementById('transcript-upload');

// ── Renderers ────────────────────────────────────────────

const treeRenderer = new TreeRenderer(treeSvg, (node) => {
  showSpindle(node.address);
});

const spindleAddress = document.getElementById('spindle-address');
const spindleEntries = document.getElementById('spindle-entries');
const appDiv = document.getElementById('app');

const columnRenderer = new ColumnRenderer(columnPanel, (spindleNodes, address) => {
  showSpindleLeft(spindleNodes, address);
}, (editedBlock) => {
  // After inline edit — sync JSON editor and mark dirty
  currentBlock = editedBlock;
  jsonEditor.value = JSON.stringify(editedBlock, null, 2);
  markDirty();
});

// ── Spindle display ──────────────────────────────────────

function showSpindle(address) {
  if (!currentBlock || !address) {
    spindlePanel.classList.remove('active');
    return;
  }
  // For root node (empty address), show just the root underscore
  const result = address ? bsp(currentBlock, address) : bsp(currentBlock, 0);

  if (result.mode === 'spindle' && result.nodes.length) {
    spindleContent.innerHTML = result.nodes.map(n => `
      <div class="spindle-entry">
        <span class="spindle-pscale">${n.pscale}</span>
        <span class="spindle-text">${escHtml(n.text)}</span>
      </div>
    `).join('');
    spindlePanel.classList.add('active');
  }
}

function showSpindleFromNodes(nodes) {
  if (!nodes || !nodes.length) {
    spindlePanel.classList.remove('active');
    return;
  }
  spindleContent.innerHTML = nodes.map(n => `
    <div class="spindle-entry">
      <span class="spindle-pscale">${n.pscale}</span>
      <span class="spindle-text">${escHtml(n.text)}</span>
    </div>
  `).join('');
  spindlePanel.classList.add('active');
}

/** Show spindle in the left panel (column view). Last entry = current card, highlighted. */
function showSpindleLeft(nodes, address) {
  if (!nodes || !nodes.length) {
    spindleAddress.textContent = '';
    spindleEntries.innerHTML = '<div class="left-spindle-empty">Click a card to see its spindle</div>';
    return;
  }

  // Sticky address with the current digit highlighted amber
  if (address) {
    const digits = address.split('.');
    spindleAddress.innerHTML = digits.map((d, i) =>
      (i > 0 ? '<span>.</span>' : '') +
      (i === digits.length - 1
        ? `<span class="addr-digit">${d}</span>`
        : `<span>${d}</span>`)
    ).join('');
  } else {
    spindleAddress.textContent = '0';
  }

  spindleEntries.innerHTML = nodes.map((n, i) => `
    <div class="spindle-entry${i === nodes.length - 1 ? ' current' : ''}">
      <span class="spindle-pscale">pscale ${n.pscale}</span>
      <span class="spindle-text">${escHtml(n.text)}</span>
    </div>
  `).join('');
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Block loading & persistence ──────────────────────────

function loadBlock(block, name) {
  currentBlock = block;
  if (name) currentBlockName = name;
  isDirty = false;
  saveVersion = 0;
  updateBlockTitle();
  renderCurrentView();
  spindlePanel.classList.remove('active');

  if (currentMode === 'explore') {
    jsonEditor.value = JSON.stringify(block, null, 2);
  }

  // Autosave the loaded block as the session
  autosave();
}

function markDirty() {
  if (!isDirty) {
    isDirty = true;
    updateBlockTitle();
  }
  autosave();
}

function updateBlockTitle() {
  const h2 = document.querySelector('.panel-header h2');
  h2.textContent = isDirty ? `${currentBlockName} *` : currentBlockName;
}

function autosave() {
  if (!currentBlock) return;
  try {
    localStorage.setItem('mindflow-session', JSON.stringify({
      block: currentBlock,
      name: currentBlockName,
      dirty: isDirty,
      version: saveVersion,
      time: Date.now()
    }));
  } catch (_) { /* localStorage full — ignore */ }
}

function restoreSession() {
  try {
    const raw = localStorage.getItem('mindflow-session');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) { return null; }
}

function renderCurrentView() {
  if (!currentBlock) return;
  if (currentView === 'tree') {
    treePanel.classList.add('active');
    columnPanel.classList.remove('active');
    treeRenderer.render(currentBlock);
  } else {
    treePanel.classList.remove('active');
    columnPanel.classList.add('active');
    columnRenderer.render(currentBlock);
  }
}

// Example block buttons
document.querySelectorAll('.load-btn[data-block]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const name = btn.dataset.block;
    try {
      const res = await fetch(`blocks/${name}.json`);
      const block = await res.json();
      highlightActiveBtn(btn);
      loadBlock(block, name);
    } catch (err) {
      console.error('Failed to load block:', err);
    }
  });
});

// JSON editor — parse on change (debounced)
let editorTimeout = null;
jsonEditor.addEventListener('input', () => {
  clearTimeout(editorTimeout);
  editorTimeout = setTimeout(() => {
    try {
      const block = JSON.parse(jsonEditor.value);
      if (block && typeof block === 'object') {
        currentBlock = block;
        renderCurrentView();
        markDirty();
      }
    } catch (_) { /* invalid JSON, ignore */ }
  }, 500);
});

// ── Multi-file upload with switchable buttons ────────────

const uploadedBlocks = new Map(); // name → block
const loadButtonsDiv = document.querySelector('.load-buttons');

function addBlockButton(name, block) {
  uploadedBlocks.set(name, block);
  // Check if button already exists
  if (loadButtonsDiv.querySelector(`[data-uploaded="${name}"]`)) return;
  const btn = document.createElement('button');
  btn.className = 'load-btn';
  btn.dataset.uploaded = name;
  btn.textContent = name;
  btn.addEventListener('click', () => {
    highlightActiveBtn(btn);
    loadBlock(uploadedBlocks.get(name));
  });
  // Insert before the upload label
  const uploadLabel = loadButtonsDiv.querySelector('.file-upload-label');
  loadButtonsDiv.insertBefore(btn, uploadLabel);
}

function highlightActiveBtn(activeBtn) {
  loadButtonsDiv.querySelectorAll('.load-btn').forEach(b => b.classList.remove('active-block'));
  if (activeBtn) activeBtn.classList.add('active-block');
}

// File upload (JSON blocks)
fileUpload.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const block = JSON.parse(reader.result);
      const name = file.name.replace(/\.json$/i, '');
      addBlockButton(name, block);
      highlightActiveBtn(loadButtonsDiv.querySelector(`[data-uploaded="${name}"]`));
      loadBlock(block, name);
    } catch (err) {
      console.error('Invalid JSON:', err);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

// Transcript upload (text file → live compilation)
transcriptUpload.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const text = reader.result;
    // Add to transcript display
    const p = document.createElement('p');
    p.className = 'final';
    p.textContent = text.slice(0, 500) + (text.length > 500 ? '…' : '');
    transcriptEl.appendChild(p);
    // Queue the full text for compilation
    pendingSegments.push(text);
    compileBlock();
  };
  reader.readAsText(file);
  e.target.value = '';
});

// ── Mode switching ───────────────────────────────────────

tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    tabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentMode = btn.dataset.mode;

    if (currentMode === 'explore') {
      explorePanel.classList.add('active');
      livePanel.classList.remove('active');
      if (isListening) stopListening();
    } else {
      explorePanel.classList.remove('active');
      livePanel.classList.add('active');
    }
  });
});

// ── Speech recognition (live mode) ──────────────────────

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

function startListening() {
  if (!SpeechRecognition) {
    compileStatus.textContent = 'Speech not supported — try Chrome';
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-GB';

  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        addTranscriptSegment(transcript);
      } else {
        interim += transcript;
      }
    }
    updateInterimDisplay(interim);
  };

  recognition.onerror = (event) => {
    if (event.error === 'no-speech') return;
    console.warn('Speech error:', event.error);
  };

  recognition.onend = () => {
    if (isListening) recognition.start();
  };

  recognition.start();
  isListening = true;
  micBtn.textContent = 'Mic On';
  micBtn.classList.add('active');
}

function stopListening() {
  isListening = false;
  if (recognition) recognition.stop();
  micBtn.textContent = 'Mic Off';
  micBtn.classList.remove('active');
}

function addTranscriptSegment(text) {
  const p = document.createElement('p');
  p.className = 'final';
  p.textContent = text;
  transcriptEl.appendChild(p);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;

  const interim = transcriptEl.querySelector('.interim');
  if (interim) interim.remove();

  pendingSegments.push(text);

  // Auto-compile after 3 segments or 30s
  if (pendingSegments.length >= 3 || Date.now() - lastCompileTime > 30000) {
    compileBlock();
  }
}

function updateInterimDisplay(text) {
  let el = transcriptEl.querySelector('.interim');
  if (!el) {
    el = document.createElement('p');
    el.className = 'interim';
    transcriptEl.appendChild(el);
  }
  el.textContent = text;
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

micBtn.addEventListener('click', () => {
  if (isListening) stopListening();
  else startListening();
});

// ── LLM compilation ──────────────────────────────────────

function getApiKey() {
  return apiKeyInput.value || localStorage.getItem('mindflow-api-key') || '';
}

apiKeyInput.addEventListener('change', () => {
  if (apiKeyInput.value) localStorage.setItem('mindflow-api-key', apiKeyInput.value);
});

// Load saved key
const savedKey = localStorage.getItem('mindflow-api-key');
if (savedKey) apiKeyInput.value = savedKey;

function blockSummary(block) {
  // Compact dir-mode summary for the LLM: addresses + truncated texts
  if (!block) return '(empty — create a new block)';
  const lines = [];
  function walk(node, addr) {
    const text = typeof node === 'string' ? node : (node?._ && typeof node._ === 'string' ? node._ : null);
    if (text) lines.push(`${addr || '_'}: ${text.slice(0, 80)}`);
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      for (const d of '123456789') {
        if (d in node) walk(node[d], addr ? `${addr}.${d}` : d);
      }
    }
  }
  walk(block, '');
  return lines.join('\n');
}

async function compileBlock() {
  const apiKey = getApiKey();
  if (!apiKey || compiling || pendingSegments.length === 0) return;

  compiling = true;
  lastCompileTime = Date.now();
  compileStatus.textContent = 'Compiling…';

  const segments = pendingSegments.splice(0);
  const segmentText = segments.join('\n\n');

  const systemPrompt = `You are a pscale block compiler. You receive speech segments and a current block structure, and return delta operations to extend the block.

BLOCK FORMAT: JSON with keys "_" (underscore = meaning at zero position) and digits "1"-"9" (branches). No other keys.

DELTA OPERATIONS (return as JSON array):
- {"op": "set", "address": "N", "content": "text"} — place content at an empty top-level address
- {"op": "subnest", "address": "N", "child": "D", "content": "text"} — leaf becomes branch: existing text moves to _, new content at child digit
- {"op": "fork", "address": "N.D", "child": "D2", "content": "text"} — add child to existing branch

RULES:
1. Each segment is a thought. Group related thoughts under the same branch.
2. When a new topic appears, use the next available top-level digit.
3. When a segment deepens an existing topic, subnest or fork under that branch.
4. Content must be substantive complete sentences, not headings.
5. Return ONLY a JSON array of delta ops. No explanation.

${currentBlock ? `CURRENT BLOCK STRUCTURE:\n${blockSummary(currentBlock)}` : 'No block yet — create the root underscore first with: [{"op": "set", "address": "_", "content": "..."}]'}`;

  const userPrompt = `New speech segments:\n\n${segmentText}`;

  try {
    const res = await fetch('/api/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    const data = await res.json();

    if (data.error) {
      compileStatus.textContent = 'Error: ' + (typeof data.error === 'object' ? data.error.message : data.error);
      compiling = false;
      return;
    }

    if (data.content?.[0]?.text) {
      let text = data.content[0].text.trim();
      text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');

      try {
        const ops = JSON.parse(text);

        if (!currentBlock) {
          // First compilation — check for root set
          const rootOp = ops.find(o => o.op === 'set' && o.address === '_');
          if (rootOp) {
            currentBlock = { _: rootOp.content };
            const rest = ops.filter(o => o !== rootOp);
            if (rest.length) applyDelta(currentBlock, rest);
          } else {
            // Create a default root
            currentBlock = { _: 'Compiled from speech' };
            applyDelta(currentBlock, ops);
          }
        } else {
          applyDelta(currentBlock, ops);
        }

        renderCurrentView();
        compileStatus.textContent = `Compiled ${ops.length} ops`;

        // Update JSON editor if in explore mode
        if (currentMode === 'explore') {
          jsonEditor.value = JSON.stringify(currentBlock, null, 2);
        }
      } catch (parseErr) {
        compileStatus.textContent = 'Parse error: ' + parseErr.message;
      }
    }
  } catch (err) {
    compileStatus.textContent = 'Failed: ' + err.message;
  }

  compiling = false;
}

// Auto-compile timer (check every 10s if we have pending segments older than 30s)
setInterval(() => {
  if (pendingSegments.length > 0 && Date.now() - lastCompileTime > 30000) {
    compileBlock();
  }
}, 10000);

// ── View toggle ──────────────────────────────────────────

const viewTreeBtn = document.getElementById('view-tree');
const viewColsBtn = document.getElementById('view-columns');

function setView(view) {
  currentView = view;
  viewTreeBtn.classList.toggle('active', view === 'tree');
  viewColsBtn.classList.toggle('active', view === 'columns');
  appDiv.classList.toggle('view-columns', view === 'columns');
  appDiv.classList.toggle('view-tree', view === 'tree');
  // Hide bottom spindle panel in column view (left panel handles it)
  if (view === 'columns') spindlePanel.classList.remove('active');
  renderCurrentView();
}

viewTreeBtn.addEventListener('click', () => setView('tree'));
viewColsBtn.addEventListener('click', () => setView('columns'));

// ── Zoom controls ────────────────────────────────────────

document.getElementById('zoom-fit').addEventListener('click', () => {
  if (currentBlock) renderCurrentView();
});

// ── Save JSON (versioned downloads) ─────────────────────

document.getElementById('save-json').addEventListener('click', () => {
  if (!currentBlock) return;
  const json = JSON.stringify(currentBlock, null, 2);
  const filename = saveVersion === 0
    ? `${currentBlockName}.json`
    : `${currentBlockName} (${saveVersion}).json`;
  saveVersion++;
  isDirty = false;
  updateBlockTitle();
  autosave();
  download(json, filename);
});

// ── Converter modal ─────────────────────────────────────

const converterModal = document.getElementById('converter-modal');
const convPscale = document.getElementById('conv-pscale');
const convGingko = document.getElementById('conv-gingko');

document.getElementById('open-converter').addEventListener('click', () => {
  converterModal.classList.add('active');
  // Pre-fill with current block if available
  if (currentBlock) {
    convPscale.value = JSON.stringify(currentBlock, null, 2);
  }
});

document.getElementById('converter-close').addEventListener('click', () => {
  converterModal.classList.remove('active');
});

converterModal.addEventListener('click', (e) => {
  if (e.target === converterModal) converterModal.classList.remove('active');
});

document.getElementById('conv-to-gingko').addEventListener('click', () => {
  try {
    const block = JSON.parse(convPscale.value);
    const gingko = pscaleToGingko(block);
    convGingko.value = JSON.stringify(gingko, null, 2);
  } catch (err) {
    convGingko.value = 'Error: ' + err.message;
  }
});

document.getElementById('conv-to-pscale').addEventListener('click', () => {
  try {
    const gingko = JSON.parse(convGingko.value);
    const block = gingkoToPscale(gingko);
    convPscale.value = JSON.stringify(block, null, 2);
  } catch (err) {
    convPscale.value = 'Error: ' + err.message;
  }
});

document.getElementById('conv-download-gingko').addEventListener('click', () => {
  download(convGingko.value, 'block-gingko.json');
});

document.getElementById('conv-download-pscale').addEventListener('click', () => {
  download(convPscale.value, 'block-pscale.json');
});

document.getElementById('conv-load-current').addEventListener('click', () => {
  if (currentBlock) {
    convPscale.value = JSON.stringify(currentBlock, null, 2);
  }
});

function download(text, filename) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Init ─────────────────────────────────────────────────

// Set initial view class
appDiv.classList.add('view-columns');

// Try restoring session from localStorage, else load default
const session = restoreSession();
if (session && session.block) {
  currentBlock = session.block;
  currentBlockName = session.name || 'untitled';
  isDirty = session.dirty || false;
  saveVersion = session.version || 0;
  updateBlockTitle();
  renderCurrentView();
  if (currentMode === 'explore') {
    jsonEditor.value = JSON.stringify(currentBlock, null, 2);
  }
} else {
  fetch('blocks/starstone-lean.json')
    .then(r => r.json())
    .then(block => loadBlock(block, 'starstone-lean'))
    .catch(() => {});
}
