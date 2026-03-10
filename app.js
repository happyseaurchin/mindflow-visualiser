// ── State ──────────────────────────────────────────────────

const words = new Map();        // text → word object
const sentences = [];           // recent sentences for co-occurrence
let lastSpokenWord = null;      // for spatial locality
let animationId = null;

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
  '#3a7bd5','#5e8c6a','#d4a853','#c75c5c','#7b68ae',
  '#4a9e9e','#d47b5a','#8b6fb0','#5b8fa8','#a8845b',
  '#6b9e5b','#9e5b7b'
];
let colorIdx = 0;

// ── Settings ───────────────────────────────────────────────

const settings = {
  decayMultiplier: 1,
  minFrequency: 1
};

// ── DOM refs ───────────────────────────────────────────────

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const transcriptEl = document.getElementById('transcript');
const micBtn = document.getElementById('mic-btn');
const clearBtn = document.getElementById('clear-btn');
const decaySlider = document.getElementById('decay-slider');
const minFreqSlider = document.getElementById('min-freq-slider');
const minFreqVal = document.getElementById('min-freq-val');
const screenshotBtn = document.getElementById('screenshot-btn');

// ── Canvas sizing ──────────────────────────────────────────

function resizeCanvas() {
  const panel = document.getElementById('canvas-panel');
  canvas.width = panel.clientWidth * devicePixelRatio;
  canvas.height = panel.clientHeight * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

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
    if (event.error === 'no-speech') return; // normal, just silence
    console.warn('Speech error:', event.error);
  };

  recognition.onend = () => {
    // auto-restart if we're still supposed to be listening
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

  // remove interim display
  const interim = transcriptEl.querySelector('.interim');
  if (interim) interim.remove();

  processText(text);
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

  // Track sentence for co-occurrence
  sentences.push({ tokens, time: now });
  // Keep last 20 sentences
  if (sentences.length > 20) sentences.shift();

  tokens.forEach(token => {
    if (words.has(token)) {
      const w = words.get(token);
      w.frequency++;
      w.lastMentioned = now;
      w.pulse = 1.3; // trigger pulse animation
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
      });
    }
    lastSpokenWord = words.get(token);
  });

  // Update co-occurrence targets
  updateCoOccurrenceTargets();
}

function getSpawnPosition() {
  const w = canvas.width / devicePixelRatio;
  const h = canvas.height / devicePixelRatio;

  if (lastSpokenWord) {
    // Near the last spoken word with some jitter
    return {
      x: lastSpokenWord.x + (Math.random() - 0.5) * 200,
      y: lastSpokenWord.y + (Math.random() - 0.5) * 150
    };
  }
  // Centre with jitter
  return {
    x: w / 2 + (Math.random() - 0.5) * 200,
    y: h / 2 + (Math.random() - 0.5) * 150
  };
}

function updateCoOccurrenceTargets() {
  // Words that appear in the same sentence attract each other
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

  // For each word, blend co-occurrence attraction with centre bias
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
      // Blend: 40% co-occurrence, 60% centre — keeps words spread
      word.targetX = (tx / totalWeight) * 0.4 + cx * 0.6;
      word.targetY = (ty / totalWeight) * 0.4 + cy * 0.6;
    } else {
      // No co-occurrence — gentle drift toward centre
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

    // Size from weight
    word.targetFontSize = Math.min(72, Math.max(14, 14 + weight * 8));

    // Decay: fade old words but never fully
    if (secondsAgo > 60 * settings.decayMultiplier) {
      const decayAmount = (secondsAgo - 60 * settings.decayMultiplier) / 120;
      word.targetOpacity = Math.max(0.15, 1 - decayAmount);
      word.targetFontSize = Math.max(10, word.targetFontSize * Math.max(0.5, 1 - decayAmount * 0.5));
    } else {
      word.targetOpacity = 1;
    }

    // Spring toward target (gentle)
    word.vx += (word.targetX - word.x) * 0.005;
    word.vy += (word.targetY - word.y) * 0.005;

    // Damping
    word.vx *= 0.97;
    word.vy *= 0.95;

    word.x += word.vx;
    word.y += word.vy;

    // Animate opacity
    word.opacity += (word.targetOpacity - word.opacity) * 0.08;

    // Animate font size
    word.fontSize += (word.targetFontSize - word.fontSize) * 0.08;

    // Pulse decay
    if (word.pulse > 1) {
      word.pulse += (1 - word.pulse) * 0.1;
      if (word.pulse < 1.01) word.pulse = 1;
    }

    // Keep in bounds (account for word width)
    const textWidth = word.text.length * word.fontSize * 0.35;
    const margin = 20;
    if (word.x < margin + textWidth) { word.x = margin + textWidth; word.vx *= -0.5; }
    if (word.x > w - margin - textWidth) { word.x = w - margin - textWidth; word.vx *= -0.5; }
    if (word.y < margin + word.fontSize) { word.y = margin + word.fontSize; word.vy *= -0.5; }
    if (word.y > h - margin) { word.y = h - margin; word.vy *= -0.5; }
  });

  // Collision repulsion (bounding box)
  for (let i = 0; i < wordArray.length; i++) {
    for (let j = i + 1; j < wordArray.length; j++) {
      const a = wordArray[i];
      const b = wordArray[j];

      // Skip nearly invisible words
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
        const pushX = (dx === 0 ? 1 : Math.sign(dx)) * overlapX * 0.05;
        const pushY = (dy === 0 ? 1 : Math.sign(dy)) * overlapY * 0.05;

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
    if (word.frequency < settings.minFrequency) return;
    if (word.opacity < 0.01) return;

    const size = word.fontSize * word.pulse;
    ctx.font = `${size}px 'SF Mono', 'Fira Code', Consolas, monospace`;
    ctx.fillStyle = word.color;
    ctx.globalAlpha = word.opacity;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(word.text, word.x, word.y);
  });

  ctx.globalAlpha = 1;
}

function animate() {
  updatePhysics();
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
});

decaySlider.addEventListener('input', (e) => {
  settings.decayMultiplier = parseFloat(e.target.value);
});

minFreqSlider.addEventListener('input', (e) => {
  settings.minFrequency = parseInt(e.target.value);
  minFreqVal.textContent = e.target.value;
});

screenshotBtn.addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = `mindflow-${Date.now()}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
});

// ── Start ──────────────────────────────────────────────────

animate();
