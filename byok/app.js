// ── State ──────────────────────────────────────────────────

const words = new Map();        // text → word object
const sentences = [];           // recent sentences for co-occurrence
let lastSpokenWord = null;      // for spatial locality
let animationId = null;
let llmActive = false;
let totalTokens = 0;
let lastConceptCall = Date.now();
let sentencesSinceLastConcept = 0;
const glyphs = [];

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
const CONCEPT_BG = 'rgba(255, 255, 255, 0.85)';
const CONCEPT_TEXT = '#000000';
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
const llmOutputEl = document.getElementById('llm-output');
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
const llmStatus = document.getElementById('llm-status');
const glyphRail = document.getElementById('glyph-rail');

let frozen = false;

function setLLMStatus(msg, type = 'info') {
  llmStatus.textContent = msg;
  llmStatus.className = `llm-status-${type}`;
  if (type !== 'error') {
    clearTimeout(llmStatus._timeout);
    llmStatus._timeout = setTimeout(() => { llmStatus.textContent = ''; }, 5000);
  }
}

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

// Non-streaming call (for connection test)
async function callLLM(systemPrompt, userPrompt) {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  try {
    llmBtn.classList.add('processing');
    const res = await fetch('/api/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
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
      const msg = typeof data.error === 'object' ? data.error.message || JSON.stringify(data.error) : data.error;
      setLLMStatus('Error: ' + msg, 'error');
      return null;
    }
    if (data.usage) {
      totalTokens += (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0);
      tokenCountEl.textContent = totalTokens.toLocaleString();
    }
    if (data.content && data.content[0]) {
      let text = data.content[0].text;
      text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
      return text.trim();
    }
    return null;
  } catch (err) {
    llmBtn.classList.remove('processing');
    setLLMStatus('Call failed: ' + err.message, 'error');
    return null;
  }
}

// Streaming call — streams tokens into LLM panel, returns full text
async function callLLMStreaming(systemPrompt, userPrompt, textEl) {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  try {
    llmBtn.classList.add('processing');
    const res = await fetch('/api/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        stream: true,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      const msg = err.error?.message || err.error || res.statusText;
      setLLMStatus('Error: ' + msg, 'error');
      llmBtn.classList.remove('processing');
      return null;
    }

    // Read SSE stream
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') continue;

        try {
          const event = JSON.parse(data);

          // Track tokens from message_start
          if (event.type === 'message_start' && event.message?.usage) {
            totalTokens += event.message.usage.input_tokens || 0;
          }
          // Track output tokens from message_delta
          if (event.type === 'message_delta' && event.usage) {
            totalTokens += event.usage.output_tokens || 0;
            tokenCountEl.textContent = totalTokens.toLocaleString();
          }
          // Stream text deltas
          if (event.type === 'content_block_delta' && event.delta?.text) {
            fullText += event.delta.text;
            textEl.textContent = fullText;
            // Auto-scroll LLM panel
            llmOutputEl.parentElement.scrollTop = llmOutputEl.parentElement.scrollHeight;
          }
        } catch (e) {
          // skip unparseable lines
        }
      }
    }

    llmBtn.classList.remove('processing');
    // Strip markdown fences
    fullText = fullText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    return fullText;
  } catch (err) {
    llmBtn.classList.remove('processing');
    setLLMStatus('Stream failed: ' + err.message, 'error');
    return null;
  }
}

// ── Concept Extraction ────────────────────────────────────

async function runConceptExtraction() {
  if (!llmActive || !getApiKey() || sentencesSinceLastConcept === 0) return;

  const recentText = sentences.slice(-15).map(s => s.tokens.join(' ')).join('. ');
  if (recentText.length < 20) return;

  sentencesSinceLastConcept = 0;
  lastConceptCall = Date.now();
  setLLMStatus('Extracting concepts...');

  // Create LLM panel entry
  const entry = document.createElement('div');
  entry.className = 'llm-entry';
  const timeEl = document.createElement('div');
  timeEl.className = 'llm-time';
  timeEl.textContent = new Date().toLocaleTimeString();
  const textEl = document.createElement('div');
  textEl.className = 'llm-text';
  const conceptsEl = document.createElement('div');
  conceptsEl.className = 'llm-concepts';
  entry.appendChild(timeEl);
  entry.appendChild(textEl);
  entry.appendChild(conceptsEl);
  llmOutputEl.appendChild(entry);
  llmOutputEl.parentElement.scrollTop = llmOutputEl.parentElement.scrollHeight;

  const result = await callLLMStreaming(
    'You analyse speech transcripts. First write 1-3 sentences explaining what underlying themes you notice — what the speaker seems to be circling around. Then on a new line write EXACTLY the marker ---JSON--- followed by a JSON object. No markdown fences.',
    `Here is recent speech. Explain briefly what themes or undercurrents you detect, then extract 1-5 concepts — abstract ideas the speaker may not have named directly. Also synthesise a 2-6 word glyph phrase that captures the core idea of this stretch of thinking, and indicate its tone (warm, cool, or neutral).

Speech: "${recentText}"

Format your response as:
[your 1-3 sentence explanation]
---JSON---
{"glyph": "searching for connection", "tone": "warm", "concepts": [{"word": "emergence", "related": ["pattern", "complex", "system"]}]}`,
    textEl
  );

  if (!result) return;

  try {
    // Split on the JSON marker
    const markerIdx = result.indexOf('---JSON---');
    let jsonStr;
    if (markerIdx >= 0) {
      jsonStr = result.slice(markerIdx + 10).trim();
      // Clean the display: remove the JSON part, keep only explanation
      const explanation = result.slice(0, markerIdx).trim();
      textEl.textContent = explanation;
    } else {
      // Fallback: try to find JSON in the response
      const jsonMatch = result.match(/\{[\s\S]*"concepts"[\s\S]*\}/);
      if (!jsonMatch) return;
      jsonStr = jsonMatch[0];
    }

    // Strip markdown fences if present
    jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const parsed = JSON.parse(jsonStr);
    if (!parsed.concepts || !Array.isArray(parsed.concepts)) return;

    const injected = [];
    parsed.concepts.forEach(concept => {
      if (!concept.word) return;
      const cWord = concept.word.toLowerCase();
      const related = (concept.related || []).map(r => r.toLowerCase());

      if (words.has(cWord)) {
        // Existing word (speech or concept) — bump frequency, promote if speech
        const existing = words.get(cWord);
        existing.frequency += 1;
        existing.lastMentioned = Date.now();
        existing.pulse = 1.3;
        if (existing.source === 'speech') {
          existing.promoted = true;
        }
        existing.bgColor = CONCEPT_BG;
        existing.color = CONCEPT_TEXT;
        injected.push(cWord + (existing.source === 'speech' ? ' ✓' : ' +'));
      } else {
        // New concept word — frequency 2 so it's visible immediately
        const spawnPos = getConceptSpawnPosition(related);
        words.set(cWord, {
          text: cWord,
          frequency: 1,
          x: spawnPos.x,
          y: spawnPos.y,
          vx: 0,
          vy: 0,
          targetX: spawnPos.x,
          targetY: spawnPos.y,
          fontSize: 10,
          targetFontSize: 10,
          opacity: 0,
          targetOpacity: 0.85,
          color: CONCEPT_TEXT,
          bgColor: CONCEPT_BG,
          birthTime: Date.now(),
          lastMentioned: Date.now(),
          pulse: 1.3,
          source: 'llm-concept',
          promoted: false,
        });
        injected.push(cWord);
      }
    });

    if (injected.length > 0) {
      conceptsEl.textContent = '→ ' + injected.join(', ');
      setLLMStatus(`Injected: ${injected.join(', ')}`);
    } else {
      setLLMStatus('No new concepts');
    }

    // Add glyph to the rail
    if (parsed.glyph) {
      glyphs.push({
        text: parsed.glyph,
        tone: parsed.tone || 'neutral',
        time: Date.now(),
        wordsAtTime: [...words.keys()].slice(-20),
      });
      renderGlyphRail();
    }
  } catch (e) {
    setLLMStatus('Parse error', 'error');
    conceptsEl.textContent = '(parse error)';
    console.warn('Failed to parse concept result:', e);
  }
}

function getConceptSpawnPosition(relatedWords) {
  const w = canvas.width / devicePixelRatio;
  const h = canvas.height / devicePixelRatio;

  // Spawn near centroid of related spoken words
  let tx = 0, ty = 0, count = 0;
  relatedWords.forEach(r => {
    const rw = words.get(r);
    if (rw) { tx += rw.x; ty += rw.y; count++; }
  });

  if (count > 0) {
    return {
      x: tx / count + (Math.random() - 0.5) * 100,
      y: ty / count + (Math.random() - 0.5) * 80
    };
  }
  return {
    x: w / 2 + (Math.random() - 0.5) * 200,
    y: h / 2 + (Math.random() - 0.5) * 150
  };
}

// ── Glyph Rail ────────────────────────────────────────────

function renderGlyphRail() {
  glyphRail.innerHTML = '';
  glyphs.forEach(glyph => {
    const el = document.createElement('div');
    el.className = `glyph glyph-${glyph.tone}`;
    el.textContent = glyph.text;
    el.title = new Date(glyph.time).toLocaleTimeString();
    el.addEventListener('click', () => highlightGlyphWords(glyph));
    glyphRail.appendChild(el);
  });
  glyphRail.scrollLeft = glyphRail.scrollWidth;
}

function highlightGlyphWords(glyph) {
  glyph.wordsAtTime.forEach(text => {
    const w = words.get(text);
    if (!w) return;
    w.frequency += 1;
    w.lastMentioned = Date.now();
    w.pulse = 1.4;
  });
}

// ── LLM Timer ─────────────────────────────────────────────

setInterval(() => {
  if (!llmActive) return;
  const now = Date.now();
  if (now - lastConceptCall > 60000) runConceptExtraction();
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
  transcriptEl.parentElement.scrollTop = transcriptEl.parentElement.scrollHeight;

  const interim = transcriptEl.querySelector('.interim');
  if (interim) interim.remove();

  processText(text);
  sentencesSinceLastConcept++;
}

function updateInterimDisplay(text) {
  let el = transcriptEl.querySelector('.interim');
  if (!el) {
    el = document.createElement('p');
    el.className = 'interim';
    transcriptEl.appendChild(el);
  }
  el.textContent = text;
  transcriptEl.parentElement.scrollTop = transcriptEl.parentElement.scrollHeight;
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
        promoted: false,
        bgColor: null,
      });
    }
    lastSpokenWord = words.get(token);
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
  return word.frequency * Math.pow(decayRate, secondsAgo * settings.decayMultiplier);
}

function updatePhysics() {
  const w = canvas.width / devicePixelRatio;
  const h = canvas.height / devicePixelRatio;
  const wordArray = [...words.values()];

  wordArray.forEach(word => {
    const weight = computeWeight(word);
    const secondsAgo = (Date.now() - word.lastMentioned) / 1000;

    if (word.source === 'llm-concept' && !word.promoted) {
      // Concepts: small hints that fade within ~50s, cleared before next LLM call
      word.targetFontSize = Math.min(16, Math.max(10, 10 + weight * 2));
      const fadeStart = 5;  // start fading after 5s
      if (secondsAgo > fadeStart) {
        const decayAmount = (secondsAgo - fadeStart) / 45;  // fully faded ~50s
        word.targetOpacity = Math.max(0, 0.85 - decayAmount * 0.85);
      } else {
        word.targetOpacity = 0.85;
      }
    } else {
      // Speech words (and promoted concepts): normal sizing
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

  // Collision repulsion — all words participate equally
  for (let i = 0; i < wordArray.length; i++) {
    for (let j = i + 1; j < wordArray.length; j++) {
      const a = wordArray[i];
      const b = wordArray[j];
      if (a.opacity < 0.2 && b.opacity < 0.2) continue;

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

function drawRoundedRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function render() {
  const w = canvas.width / devicePixelRatio;
  const h = canvas.height / devicePixelRatio;

  ctx.clearRect(0, 0, w, h);

  words.forEach(word => {
    if (word.source === 'speech' && word.frequency < settings.minFrequency) return;
    if (word.opacity < 0.01) return;

    const size = word.fontSize * word.pulse;
    const isConcept = word.source === 'llm-concept';
    const hasBackground = isConcept || word.promoted;

    ctx.font = `${isConcept ? 'italic ' : ''}${size}px 'SF Mono', 'Fira Code', Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Draw pastel rounded-rect background
    if (hasBackground && word.bgColor) {
      const textMetrics = ctx.measureText(word.text);
      const padX = 8;
      const padY = 4;
      const rectW = textMetrics.width + padX * 2;
      const rectH = size + padY * 2;
      ctx.globalAlpha = word.opacity;
      ctx.fillStyle = word.bgColor;
      drawRoundedRect(word.x - rectW / 2, word.y - rectH / 2, rectW, rectH, Math.min(8, size * 0.2));
      ctx.fill();
    }

    // Draw word text
    ctx.fillStyle = word.color;
    ctx.globalAlpha = word.opacity;
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
  lastSpokenWord = null;
  colorIdx = 0;
  sentencesSinceLastConcept = 0;
  llmOutputEl.innerHTML = '';
  glyphs.length = 0;
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

llmBtn.addEventListener('click', async () => {
  if (!getApiKey()) {
    settingsOverlay.classList.remove('hidden');
    return;
  }
  llmActive = !llmActive;
  llmBtn.textContent = llmActive ? 'LLM On' : 'LLM Off';
  llmBtn.classList.toggle('active', llmActive);

  if (llmActive) {
    setLLMStatus('Testing API connection...');
    const test = await callLLM('Respond with just "ok".', 'ping');
    if (test) {
      setLLMStatus('Connected — speak to activate');
    }
  } else {
    setLLMStatus('');
  }
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
