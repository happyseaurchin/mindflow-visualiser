// ── State ──────────────────────────────────────────────────

const words = new Map();        // text → word object
const sentences = [];           // recent sentences for co-occurrence
const glyphs = [];              // glyph timeline
const associationCache = new Map(); // word → [associations]
let lastSpokenWord = null;      // for spatial locality
let animationId = null;
let llmActive = false;
let totalTokens = 0;
let lastSemanticCall = 0;
let lastGlyphCall = 0;
let sentencesSinceLastSemantic = 0;
let transcriptSinceLastGlyph = '';
let pendingAssociationCalls = 0;

const STOP_WORDS = new Set([
  'i','me','my','myself','we','our','ours','ourselves','you','your','yours',
  'yourself','yourselves','he','him','his','himself','she','her','hers',
  'herself','it','its','itself','they','them','their','theirs','themselves',
  'what','which','who','whom','this','that','these','those','am','is','are',
  'was','were','be','been','being','have','has','had','having','do','does',
  'did','doing','a','an','the','and','but','if','or','because','as','until',
  'while','of','at','by','for','with','about','against','between','through',
  'during','before','after','above','below','to','from','up','down','in',
  'out','on','off','over','under','again','further','then','once','here',
  'there','when','where','why','how','all','both','each','few','more','most',
  'other','some','such','no','nor','not','only','own','same','so','than',
  'too','very','s','t','can','will','just','don','should','now','d','ll',
  'm','o','re','ve','y','ain','aren','couldn','didn','doesn','hadn','hasn',
  'haven','isn','ma','mightn','mustn','needn','shan','shouldn','wasn',
  'weren','won','wouldn','um','uh','like','yeah','okay','right','well',
  'actually','basically','literally','thing','things','got','get','going',
  'gonna','kind','sort','really','know','think','mean','want','need','say',
  'said','would','could','also','even','much','way','something','just',
  'that\'s','it\'s','i\'m','don\'t','can\'t','let','quite','worked',
  'questioned','developed','share','deep','make','made','take','took',
  'came','come','give','gave','put','still','called','back','another',
  'first','last','great','long','little','old','new','big','part','used',
  'asked','asks','exist','exists','explored','challenged','provides',
  'created','whether','become','becomes','around','always','must',
  'many','might','along','across','through','within','without','every',
  'never','often','perhaps','rather','since','though','however','already',
  'seems','seem','trying','tried','done','went','goes','seen','look',
  'looks','looking','found','help','helps','keeps','kept','left',
  'told','tell','says','set','show','shows','shown','started','start',
  'turned','different','important','possible','sure','enough','able',
  'point','points','fact','case','number','place','world','people',
  'work','year','years','hand','hands','home','life','since','those'
]);

const PALETTE = [
  '#5a9bf5','#7ebc8a','#f4c873','#e87c7c','#9b88ce',
  '#6abebe','#f49b7a','#ab8fd0','#7bafc8','#c8a47b',
  '#8bbe7b','#be7b9b'
];
const SATELLITE_PALETTE = [
  '#4a6b85','#5a7a6a','#8a7a5a','#7a5a5a','#6a5a7a',
  '#4a7a7a','#7a6a5a','#6a5a7a'
];
let colorIdx = 0;

// ── Settings ───────────────────────────────────────────────

const settings = {
  decayMultiplier: 1,
  minFrequency: 1,
  speed: 0.3
};

// ── DOM refs ───────────────────────────────────────────────

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const transcriptEl = document.getElementById('transcript');
const micBtn = document.getElementById('mic-btn');
const clearBtn = document.getElementById('clear-btn');
const speedSlider = document.getElementById('speed-slider');
const decaySlider = document.getElementById('decay-slider');
const minFreqSlider = document.getElementById('min-freq-slider');
const minFreqVal = document.getElementById('min-freq-val');
const freezeBtn = document.getElementById('freeze-btn');
const llmBtn = document.getElementById('llm-btn');
const settingsBtn = document.getElementById('settings-btn');
const screenshotBtn = document.getElementById('screenshot-btn');
const settingsOverlay = document.getElementById('settings-overlay');
const apiKeyInput = document.getElementById('api-key-input');
const saveKeyBtn = document.getElementById('save-key-btn');
const clearKeyBtn = document.getElementById('clear-key-btn');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const tokenCountEl = document.getElementById('token-count');
const glyphRail = document.getElementById('glyph-rail');

let frozen = false;

// ── Canvas sizing ──────────────────────────────────────────

function resizeCanvas() {
  const panel = document.getElementById('canvas-panel');
  canvas.width = panel.clientWidth * devicePixelRatio;
  canvas.height = panel.clientHeight * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ── LLM Integration ────────────────────────────────────────

function getApiKey() {
  return localStorage.getItem('mindflow-api-key') || '';
}

function setApiKey(key) {
  if (key) localStorage.setItem('mindflow-api-key', key);
  else localStorage.removeItem('mindflow-api-key');
}

async function callLLM(systemPrompt, userPrompt) {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  try {
    llmBtn.classList.add('processing');
    const res = await fetch('/api/llm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    const data = await res.json();
    llmBtn.classList.remove('processing');

    if (data.error) {
      console.warn('LLM error:', data.error);
      return null;
    }

    // Track tokens
    if (data.usage) {
      totalTokens += (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0);
      tokenCountEl.textContent = totalTokens.toLocaleString();
    }

    // Extract text content
    if (data.content && data.content[0]) {
      return data.content[0].text;
    }
    return null;
  } catch (err) {
    llmBtn.classList.remove('processing');
    console.warn('LLM call failed:', err);
    return null;
  }
}

// ── Semantic Extraction ────────────────────────────────────

async function runSemanticExtraction() {
  if (!llmActive || !getApiKey() || sentencesSinceLastSemantic === 0) return;

  const recentText = sentences.slice(-15).map(s => s.tokens.join(' ')).join('. ');
  if (recentText.length < 20) return;

  sentencesSinceLastSemantic = 0;
  lastSemanticCall = Date.now();

  const result = await callLLM(
    'You analyse speech transcripts. Return ONLY valid JSON, no markdown.',
    `Extract the 5-10 key concepts from this speech. For each, return the concept as a single lowercase word that appears in the text, a centrality score 1-5, and up to 3 related words from the text.

Speech: "${recentText}"

Return JSON: {"concepts": [{"word": "...", "centrality": 3, "related": ["...", "..."]}]}`
  );

  if (!result) return;

  try {
    const parsed = JSON.parse(result);
    if (!parsed.concepts) return;

    const semanticLinks = new Map();

    parsed.concepts.forEach(concept => {
      const w = words.get(concept.word);
      if (w) {
        w.llmWeight = concept.centrality || 1;
        w.lastMentioned = Date.now(); // refresh it
      }

      // Build semantic links
      if (concept.related) {
        concept.related.forEach(rel => {
          if (words.has(rel) && words.has(concept.word)) {
            const key = [concept.word, rel].sort().join('|');
            semanticLinks.set(key, (semanticLinks.get(key) || 0) + concept.centrality);
          }
        });
      }
    });

    // Apply semantic attraction
    applySemanticLinks(semanticLinks);
  } catch (e) {
    console.warn('Failed to parse semantic result:', e);
  }
}

function applySemanticLinks(links) {
  const cw = canvas.width / devicePixelRatio;
  const ch = canvas.height / devicePixelRatio;
  const cx = cw / 2;
  const cy = ch / 2;

  links.forEach((strength, key) => {
    const [a, b] = key.split('|');
    const wa = words.get(a);
    const wb = words.get(b);
    if (!wa || !wb) return;

    // Pull related words toward each other (blended with centre)
    const midX = (wa.x + wb.x) / 2;
    const midY = (wa.y + wb.y) / 2;
    const factor = Math.min(strength * 0.1, 0.3);

    wa.targetX = wa.targetX * (1 - factor) + midX * factor;
    wa.targetY = wa.targetY * (1 - factor) + midY * factor;
    wb.targetX = wb.targetX * (1 - factor) + midX * factor;
    wb.targetY = wb.targetY * (1 - factor) + midY * factor;
  });
}

// ── Glyph Generation ───────────────────────────────────────

async function runGlyphGeneration() {
  if (!llmActive || !getApiKey() || transcriptSinceLastGlyph.length < 30) return;

  const text = transcriptSinceLastGlyph;
  transcriptSinceLastGlyph = '';
  lastGlyphCall = Date.now();

  const result = await callLLM(
    'You synthesise speech into compact phrases. Return ONLY valid JSON, no markdown.',
    `Synthesise this stretch of thinking into a single 2-6 word phrase that captures the core idea. Also indicate the tone.

Speech: "${text}"

Return JSON: {"glyph": "...", "tone": "warm|cool|neutral"}`
  );

  if (!result) return;

  try {
    const parsed = JSON.parse(result);
    if (!parsed.glyph) return;

    const glyph = {
      text: parsed.glyph,
      tone: parsed.tone || 'neutral',
      time: Date.now(),
      wordsAtTime: [...words.keys()].slice(-20)
    };
    glyphs.push(glyph);
    renderGlyphRail();
  } catch (e) {
    console.warn('Failed to parse glyph result:', e);
  }
}

function renderGlyphRail() {
  glyphRail.innerHTML = '';
  glyphs.forEach((glyph, i) => {
    const el = document.createElement('div');
    el.className = `glyph glyph-${glyph.tone}`;
    el.textContent = glyph.text;
    el.title = new Date(glyph.time).toLocaleTimeString();
    el.addEventListener('click', () => highlightGlyphWords(glyph));
    glyphRail.appendChild(el);
  });
  // Auto-scroll to latest
  glyphRail.scrollLeft = glyphRail.scrollWidth;
}

function highlightGlyphWords(glyph) {
  // Pulse all words that existed when this glyph was created
  glyph.wordsAtTime.forEach(text => {
    const w = words.get(text);
    if (w) w.pulse = 1.5;
  });
}

// ── Associative Search ─────────────────────────────────────

async function runAssociativeSearch(wordText) {
  if (!llmActive || !getApiKey()) return;
  if (associationCache.has(wordText)) return;
  if (pendingAssociationCalls >= 3) return;

  pendingAssociationCalls++;
  associationCache.set(wordText, []); // prevent duplicate calls

  const result = await callLLM(
    'You return associated concepts. Return ONLY a valid JSON array of strings, no markdown.',
    `What are 3-5 concepts closely associated with "${wordText}" in intellectual discourse? Return a JSON array of lowercase single words: ["...", "..."]`
  );

  pendingAssociationCalls--;
  if (!result) return;

  try {
    const associations = JSON.parse(result);
    if (!Array.isArray(associations)) return;

    associationCache.set(wordText, associations);

    const parentWord = words.get(wordText);
    if (!parentWord) return;

    const now = Date.now();
    associations.forEach((assoc, i) => {
      const key = `~${assoc}`; // prefix to distinguish from spoken words
      if (words.has(key)) return;

      const angle = (i / associations.length) * Math.PI * 2;
      const radius = 80;
      words.set(key, {
        text: assoc,
        frequency: 0,
        x: parentWord.x + Math.cos(angle) * radius,
        y: parentWord.y + Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
        targetX: parentWord.x + Math.cos(angle) * radius,
        targetY: parentWord.y + Math.sin(angle) * radius,
        fontSize: 10,
        targetFontSize: 10,
        opacity: 0,
        targetOpacity: 0.4,
        color: SATELLITE_PALETTE[i % SATELLITE_PALETTE.length],
        birthTime: now,
        lastMentioned: now,
        pulse: 1,
        source: 'llm-association',
        parentWord: wordText,
        orbitAngle: angle,
        llmWeight: 0,
      });
    });
  } catch (e) {
    console.warn('Failed to parse associations:', e);
  }
}

// ── LLM Timers ─────────────────────────────────────────────

setInterval(() => {
  if (!llmActive) return;
  const now = Date.now();
  if (now - lastSemanticCall > 30000) runSemanticExtraction();
  if (now - lastGlyphCall > 60000) runGlyphGeneration();
}, 5000);

// ── Speech Recognition ─────────────────────────────────────

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isListening = false;

function startListening() {
  if (!SpeechRecognition) {
    transcriptEl.innerHTML = '<p class="final">Speech recognition not supported in this browser. Try Chrome.</p>';
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
        addFinalTranscript(transcript);
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

function addFinalTranscript(text) {
  const p = document.createElement('p');
  p.className = 'final';
  p.textContent = text;
  transcriptEl.appendChild(p);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;

  const interim = transcriptEl.querySelector('.interim');
  if (interim) interim.remove();

  processText(text);

  // Track for LLM
  sentencesSinceLastSemantic++;
  transcriptSinceLastGlyph += text + ' ';
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

// ── Text Processing ────────────────────────────────────────

function processText(text) {
  const cleaned = text.toLowerCase().replace(/[^\w\s'-]/g, '');
  const tokens = cleaned.split(/\s+/).filter(t => t.length > 1 && !STOP_WORDS.has(t));
  const now = Date.now();

  sentences.push({ tokens, time: now });
  if (sentences.length > 20) sentences.shift();

  tokens.forEach(token => {
    if (words.has(token)) {
      const w = words.get(token);
      w.frequency++;
      w.lastMentioned = now;
      w.pulse = 1.3;
    } else {
      const spawnPos = getSpawnPosition(token);
      words.set(token, {
        text: token,
        frequency: 1,
        x: spawnPos.x,
        y: spawnPos.y,
        vx: 0,
        vy: 0,
        targetX: spawnPos.x,
        targetY: spawnPos.y,
        fontSize: 14,
        targetFontSize: 14,
        opacity: 0,
        targetOpacity: 1,
        color: PALETTE[colorIdx++ % PALETTE.length],
        birthTime: now,
        lastMentioned: now,
        pulse: 1,
        source: 'speech',
        llmWeight: 0,
        parentWord: null,
        orbitAngle: 0,
      });
    }
    lastSpokenWord = words.get(token);

    // Trigger association search for high-frequency words
    const w = words.get(token);
    if (llmActive && w.frequency >= 3 && !associationCache.has(token)) {
      runAssociativeSearch(token);
    }
  });

  updateCoOccurrenceTargets();
}

function getSpawnPosition() {
  const w = canvas.width / devicePixelRatio;
  const h = canvas.height / devicePixelRatio;

  if (lastSpokenWord) {
    return {
      x: lastSpokenWord.x + (Math.random() - 0.5) * 200,
      y: lastSpokenWord.y + (Math.random() - 0.5) * 150
    };
  }
  return {
    x: w / 2 + (Math.random() - 0.5) * 200,
    y: h / 2 + (Math.random() - 0.5) * 150
  };
}

function updateCoOccurrenceTargets() {
  const coOccurrence = new Map();

  sentences.forEach(sentence => {
    for (let i = 0; i < sentence.tokens.length; i++) {
      for (let j = i + 1; j < sentence.tokens.length; j++) {
        const a = sentence.tokens[i];
        const b = sentence.tokens[j];
        if (!words.has(a) || !words.has(b)) continue;
        const key = [a, b].sort().join('|');
        coOccurrence.set(key, (coOccurrence.get(key) || 0) + 1);
      }
    }
  });

  const cw = canvas.width / devicePixelRatio;
  const ch = canvas.height / devicePixelRatio;
  const cx = cw / 2;
  const cy = ch / 2;

  words.forEach((word, text) => {
    // Satellites orbit their parent
    if (word.source === 'llm-association' && word.parentWord) {
      const parent = words.get(word.parentWord);
      if (parent) {
        word.orbitAngle += 0.003 * settings.speed;
        const radius = 80;
        word.targetX = parent.x + Math.cos(word.orbitAngle) * radius;
        word.targetY = parent.y + Math.sin(word.orbitAngle) * radius;
      }
      return;
    }

    let tx = 0, ty = 0, totalWeight = 0;
    coOccurrence.forEach((count, key) => {
      const [a, b] = key.split('|');
      let other = null;
      if (a === text && words.has(b)) other = words.get(b);
      if (b === text && words.has(a)) other = words.get(a);
      if (other) {
        tx += other.x * count;
        ty += other.y * count;
        totalWeight += count;
      }
    });
    if (totalWeight > 0) {
      word.targetX = (tx / totalWeight) * 0.4 + cx * 0.6;
      word.targetY = (ty / totalWeight) * 0.4 + cy * 0.6;
    } else {
      word.targetX = word.x * 0.7 + cx * 0.3;
      word.targetY = word.y * 0.7 + cy * 0.3;
    }
  });
}

// ── Physics & Animation ────────────────────────────────────

function computeWeight(word) {
  const secondsAgo = (Date.now() - word.lastMentioned) / 1000;
  const decayRate = 0.95;
  const base = word.frequency * Math.pow(decayRate, secondsAgo * settings.decayMultiplier);
  return base + (word.llmWeight || 0) * 2;
}

function updatePhysics() {
  const w = canvas.width / devicePixelRatio;
  const h = canvas.height / devicePixelRatio;
  const wordArray = [...words.values()];

  wordArray.forEach(word => {
    const weight = computeWeight(word);
    const secondsAgo = (Date.now() - word.lastMentioned) / 1000;

    if (word.source === 'llm-association') {
      // Satellites stay small and faint
      word.targetFontSize = 10;
      word.targetOpacity = 0.4;
    } else {
      word.targetFontSize = Math.min(72, Math.max(14, 14 + weight * 8));

      if (secondsAgo > 60 * settings.decayMultiplier) {
        const decayAmount = (secondsAgo - 60 * settings.decayMultiplier) / 120;
        word.targetOpacity = Math.max(0.15, 1 - decayAmount);
        word.targetFontSize = Math.max(10, word.targetFontSize * Math.max(0.5, 1 - decayAmount * 0.5));
      } else {
        word.targetOpacity = 1;
      }
    }

    const sp = settings.speed;
    word.vx += (word.targetX - word.x) * 0.005 * sp;
    word.vy += (word.targetY - word.y) * 0.005 * sp;

    const damp = 1 - (0.08 / sp);
    word.vx *= damp;
    word.vy *= damp;

    word.x += word.vx;
    word.y += word.vy;

    word.opacity += (word.targetOpacity - word.opacity) * 0.08;
    word.fontSize += (word.targetFontSize - word.fontSize) * 0.08;

    if (word.pulse > 1) {
      word.pulse += (1 - word.pulse) * 0.1;
      if (word.pulse < 1.01) word.pulse = 1;
    }

    const textWidth = word.text.length * word.fontSize * 0.35;
    const margin = 20;
    if (word.x < margin + textWidth) { word.x = margin + textWidth; word.vx *= -0.5; }
    if (word.x > w - margin - textWidth) { word.x = w - margin - textWidth; word.vx *= -0.5; }
    if (word.y < margin + word.fontSize) { word.y = margin + word.fontSize; word.vy *= -0.5; }
    if (word.y > h - margin) { word.y = h - margin; word.vy *= -0.5; }
  });

  // Collision repulsion (skip satellites vs satellites)
  for (let i = 0; i < wordArray.length; i++) {
    for (let j = i + 1; j < wordArray.length; j++) {
      const a = wordArray[i];
      const b = wordArray[j];

      if (a.opacity < 0.2 && b.opacity < 0.2) continue;
      if (a.source === 'llm-association' && b.source === 'llm-association') continue;

      const aWidth = a.text.length * a.fontSize * 0.6;
      const bWidth = b.text.length * b.fontSize * 0.6;
      const aHeight = a.fontSize * 1.2;
      const bHeight = b.fontSize * 1.2;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const minDistX = (aWidth + bWidth) / 2 + 8;
      const minDistY = (aHeight + bHeight) / 2 + 4;

      if (Math.abs(dx) < minDistX && Math.abs(dy) < minDistY) {
        const overlapX = minDistX - Math.abs(dx);
        const overlapY = minDistY - Math.abs(dy);
        const pushX = (dx === 0 ? 1 : Math.sign(dx)) * overlapX * 0.05 * settings.speed;
        const pushY = (dy === 0 ? 1 : Math.sign(dy)) * overlapY * 0.05 * settings.speed;

        a.vx -= pushX;
        a.vy -= pushY;
        b.vx += pushX;
        b.vy += pushY;
      }
    }
  }
}

// ── Rendering ──────────────────────────────────────────────

function render() {
  const w = canvas.width / devicePixelRatio;
  const h = canvas.height / devicePixelRatio;

  ctx.clearRect(0, 0, w, h);

  words.forEach(word => {
    if (word.source === 'speech' && word.frequency < settings.minFrequency) return;
    if (word.opacity < 0.01) return;

    const size = word.fontSize * word.pulse;
    const isAssociation = word.source === 'llm-association';
    ctx.font = `${isAssociation ? 'italic ' : ''}${size}px 'SF Mono', 'Fira Code', Consolas, monospace`;
    ctx.fillStyle = word.color;
    ctx.globalAlpha = word.opacity;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(word.text, word.x, word.y);
  });

  ctx.globalAlpha = 1;
}

function animate() {
  if (!frozen) updatePhysics();
  render();
  animationId = requestAnimationFrame(animate);
}

// ── Controls ───────────────────────────────────────────────

micBtn.addEventListener('click', () => {
  if (isListening) stopListening();
  else startListening();
});

clearBtn.addEventListener('click', () => {
  words.clear();
  sentences.length = 0;
  glyphs.length = 0;
  associationCache.clear();
  lastSpokenWord = null;
  colorIdx = 0;
  sentencesSinceLastSemantic = 0;
  transcriptSinceLastGlyph = '';
  glyphRail.innerHTML = '';
});

speedSlider.addEventListener('input', (e) => {
  settings.speed = parseFloat(e.target.value);
});

decaySlider.addEventListener('input', (e) => {
  settings.decayMultiplier = parseFloat(e.target.value);
});

minFreqSlider.addEventListener('input', (e) => {
  settings.minFrequency = parseInt(e.target.value);
  minFreqVal.textContent = e.target.value;
});

freezeBtn.addEventListener('click', () => {
  frozen = !frozen;
  freezeBtn.textContent = frozen ? 'Unfreeze' : 'Freeze';
  freezeBtn.classList.toggle('active', frozen);
});

llmBtn.addEventListener('click', () => {
  if (!getApiKey()) {
    settingsOverlay.classList.remove('hidden');
    return;
  }
  llmActive = !llmActive;
  llmBtn.textContent = llmActive ? 'LLM On' : 'LLM Off';
  llmBtn.classList.toggle('active', llmActive);
});

settingsBtn.addEventListener('click', () => {
  apiKeyInput.value = getApiKey();
  settingsOverlay.classList.remove('hidden');
});

saveKeyBtn.addEventListener('click', () => {
  setApiKey(apiKeyInput.value.trim());
  settingsOverlay.classList.add('hidden');
});

clearKeyBtn.addEventListener('click', () => {
  setApiKey(null);
  apiKeyInput.value = '';
  llmActive = false;
  llmBtn.textContent = 'LLM Off';
  llmBtn.classList.remove('active');
});

closeSettingsBtn.addEventListener('click', () => {
  settingsOverlay.classList.add('hidden');
});

settingsOverlay.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) settingsOverlay.classList.add('hidden');
});

screenshotBtn.addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = `mindflow-${Date.now()}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
});

// ── Start ──────────────────────────────────────────────────

animate();
