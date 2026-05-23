import { initStarCanvas, storage, getUsername, toast, logActivity } from './pluto-shared.js';

// ── State ─────────────────────────────────────────────────
let sets        = [];
let activeSet   = null;
let pairs       = [];          // [{term, def, id}] — the 6 cards in play
let selectedTerm = null;       // DOM element
let selectedDef  = null;
let matched      = 0;
let timerMs      = 0;
let timerHandle  = null;
let db           = null;       // Firestore instance (if connected)
let lastTimeMs   = 0;
let confettiRAF  = null;

const TILE_COUNT = 6;
const COLLECTION = 'pluto_match_leaderboard';

function $(id) { return document.getElementById(id); }

// ── Boot ──────────────────────────────────────────────────
async function init() {
  initStarCanvas($('stars'));

  const { plutoSets = [] } = await storage.get('plutoSets');
  sets = plutoSets;

  // Try to restore Firebase from storage
  await tryInitFirebase();

  const params = new URLSearchParams(window.location.search);
  const setId  = params.get('set');

  if (setId) {
    const found = sets.find(s => s.id === setId);
    if (found) { await maybeChallengeFirebase(() => startGame(found)); return; }
    toast('Set not found.', 'error');
  }

  buildPicker();
  showView('view-picker');
}

// ── Views ─────────────────────────────────────────────────
function showView(id) {
  ['view-picker','view-game','view-finish'].forEach(v => {
    const el = $(v);
    if (!el) return;
    if (v === 'view-game' || v === 'view-finish') {
      el.style.display = (v === id) ? 'flex' : 'none';
    } else {
      el.style.display = (v === id) ? '' : 'none';
    }
  });
}

// ── Picker ────────────────────────────────────────────────
function buildPicker() {
  const grid = $('picker-grid');
  grid.innerHTML = '';
  const eligible = sets.filter(s => s.cards && s.cards.length >= 3);

  if (eligible.length === 0) {
    grid.innerHTML = '<div style="color:rgba(255,255,255,.3);font-size:13px">No sets with 3+ cards. Create some in Study Sets first.</div>';
    return;
  }

  eligible.forEach((s, i) => {
    const card = document.createElement('div');
    card.className = 'picker-card';
    card.style.animationDelay = `${i * 50}ms`;
    card.innerHTML = `<div class="picker-card-title">${esc(s.title)}</div><div class="picker-card-meta">${s.cards.length} cards</div>`;
    card.addEventListener('click', () => maybeChallengeFirebase(() => startGame(s)));
    grid.appendChild(card);
  });
}

// ── Firebase gate ─────────────────────────────────────────
async function maybeChallengeFirebase(callback) {
  const { plutoFirebaseConfig } = await storage.get('plutoFirebaseConfig');
  if (plutoFirebaseConfig || db) {
    if (!db) await initFirebaseFromConfig(plutoFirebaseConfig);
    callback();
    return;
  }

  // First time — show modal
  $('firebase-modal').classList.remove('hidden');
  $('firebase-skip').onclick = () => { $('firebase-modal').classList.add('hidden'); callback(); };
  $('firebase-save').onclick = async () => {
    const raw = $('firebase-cfg-input').value.trim();
    try {
      const cfg = JSON.parse(raw);
      await storage.set({ plutoFirebaseConfig: cfg });
      await initFirebaseFromConfig(cfg);
      $('firebase-modal').classList.add('hidden');
      toast('Firebase connected!', 'success');
      callback();
    } catch { toast('Invalid JSON config.', 'error'); }
  };
}

async function tryInitFirebase() {
  const { plutoFirebaseConfig } = await storage.get('plutoFirebaseConfig');
  if (plutoFirebaseConfig) db = plutoFirebaseConfig; // db = config object for REST API
}

async function initFirebaseFromConfig(cfg) {
  // Use Firestore REST API — no SDK needed, avoids MV3 CSP restrictions
  db = cfg;
}

// ── Game ──────────────────────────────────────────────────
function startGame(set) {
  activeSet   = set;
  matched     = 0;
  timerMs     = 0;
  selectedTerm = null;
  selectedDef  = null;
  lastTimeMs   = 0;
  stopConfetti();

  // Pick up to TILE_COUNT random pairs
  const shuffled = [...set.cards].sort(() => Math.random() - 0.5);
  pairs = shuffled.slice(0, TILE_COUNT);

  $('game-set-name').textContent = set.title.toUpperCase();
  $('game-timer').textContent = '0.00';
  showView('view-game');

  buildBoard();
  startTimer();

  $('game-exit').onclick = () => { stopTimer(); showView('view-picker'); };
  logActivity('🎯', `Match: ${set.title}`);
}

function buildBoard() {
  const termsCol = $('col-terms');
  const defsCol  = $('col-defs');
  termsCol.innerHTML = '';
  defsCol.innerHTML  = '';

  const termOrder = [...pairs].sort(() => Math.random() - 0.5);
  const defOrder  = [...pairs].sort(() => Math.random() - 0.5);

  termOrder.forEach(pair => {
    const tile = makeTile(pair.term, 'TERM', pair.id, 'term');
    termsCol.appendChild(tile);
  });
  defOrder.forEach(pair => {
    const tile = makeTile(pair.def, 'DEF', pair.id, 'def');
    defsCol.appendChild(tile);
  });
}

function makeTile(text, labelText, pairId, side) {
  const tile = document.createElement('div');
  tile.className = 'match-tile';
  tile.dataset.pairId = pairId;
  tile.dataset.side   = side;
  tile.innerHTML = `<div><span class="match-tile-label">${labelText}</span>${esc(text)}</div>`;

  tile.addEventListener('click', () => handleTileClick(tile, side));
  return tile;
}

function handleTileClick(tile, side) {
  if (tile.classList.contains('matched') || tile.classList.contains('wrong')) return;

  playTone(side === 'term' ? 440 : 520, 80);

  if (side === 'term') {
    if (selectedTerm) selectedTerm.classList.remove('selected');
    selectedTerm = tile;
    tile.classList.add('selected');
  } else {
    if (selectedDef) selectedDef.classList.remove('selected');
    selectedDef = tile;
    tile.classList.add('selected');
  }

  // Check for pair
  if (selectedTerm && selectedDef) {
    const termId = selectedTerm.dataset.pairId;
    const defId  = selectedDef.dataset.pairId;

    if (termId === defId) {
      // Correct!
      playTone(660, 120);
      setTimeout(() => playTone(880, 100), 80);
      selectedTerm.classList.remove('selected');
      selectedDef.classList.remove('selected');
      selectedTerm.classList.add('matched');
      selectedDef.classList.add('matched');
      matched++;
      selectedTerm = null;
      selectedDef  = null;

      if (matched === pairs.length) finishGame();
    } else {
      // Wrong
      playTone(200, 200);
      const termEl = selectedTerm;
      const defEl  = selectedDef;
      termEl.classList.add('wrong');
      defEl.classList.add('wrong');
      selectedTerm = null;
      selectedDef  = null;
      setTimeout(() => {
        termEl.classList.remove('wrong', 'selected');
        defEl.classList.remove('wrong', 'selected');
      }, 400);
    }
  }
}

// ── Timer ─────────────────────────────────────────────────
function startTimer() {
  const start = performance.now();
  timerHandle = setInterval(() => {
    timerMs = performance.now() - start;
    $('game-timer').textContent = (timerMs / 1000).toFixed(2);
  }, 16);
}

function stopTimer() {
  clearInterval(timerHandle);
  timerHandle = null;
}

// ── Finish ────────────────────────────────────────────────
async function finishGame() {
  stopTimer();
  lastTimeMs = timerMs;
  launchConfetti();

  const secs  = (timerMs / 1000).toFixed(2);
  $('finish-time').textContent  = `${secs}s`;
  $('finish-label').textContent = `Matched all ${pairs.length} pairs — ${activeSet.title}`;
  showView('view-finish');

  // Load leaderboard
  await loadLeaderboard();

  // Show submit button if firebase connected
  const lbBtn = $('finish-lb-submit');
  if (db) {
    lbBtn.classList.remove('hidden');
    lbBtn.textContent = 'Submit to leaderboard →';
    lbBtn.onclick = submitScore;
  } else {
    lbBtn.classList.add('hidden');
  }

  $('finish-exit').onclick   = () => { stopConfetti(); showView('view-picker'); };
  $('finish-replay').onclick = () => { stopConfetti(); startGame(activeSet); };

  logActivity('🎯', `Match complete: ${activeSet.title} in ${secs}s`);
}

// ── Firestore REST helpers ────────────────────────────────
function fsBase() {
  // db is the firebase config object
  return `https://firestore.googleapis.com/v1/projects/${db.projectId}/databases/(default)/documents`;
}

function fsVal(v) {
  if (typeof v === 'string')  return { stringValue: v };
  if (typeof v === 'number')  return { doubleValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  return { nullValue: null };
}

function fsExtract(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) {
    out[k] = v.stringValue ?? v.doubleValue ?? v.integerValue ?? v.booleanValue ?? null;
    if (v.integerValue !== undefined) out[k] = parseInt(v.integerValue);
  }
  return out;
}

// ── Leaderboard ───────────────────────────────────────────
async function loadLeaderboard() {
  const rows = $('lb-rows');
  rows.innerHTML = '';

  if (!db) {
    rows.innerHTML = '<div class="lb-empty">Connect Firebase to see the global leaderboard.</div>';
    return;
  }

  try {
    const username = await getUsername();
    const url = `${fsBase()}/${COLLECTION}?orderBy=timeMs&pageSize=10`;
    const res  = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    const docs = data.documents || [];

    if (docs.length === 0) { rows.innerHTML = '<div class="lb-empty">No scores yet — be the first!</div>'; return; }

    // Sort by timeMs client-side (REST orderBy may need index)
    const entries = docs.map(d => fsExtract(d.fields)).sort((a,b) => a.timeMs - b.timeMs);

    entries.slice(0, 10).forEach((d, i) => {
      const isYou = d.username === username;
      const row   = document.createElement('div');
      row.className = 'lb-row' + (isYou ? ' you' : '');
      const medal = ['🥇','🥈','🥉'][i] || `${i+1}.`;
      row.innerHTML = `
        <span class="lb-rank">${medal}</span>
        <span class="lb-name">${esc(d.username || 'Anonymous')}${isYou ? ' (you)' : ''}</span>
        <span class="lb-set">${esc(String(d.setTitle || '').slice(0,20))}</span>
        <span class="lb-time">${(d.timeMs/1000).toFixed(2)}s</span>
      `;
      rows.appendChild(row);
    });
  } catch (e) {
    rows.innerHTML = '<div class="lb-empty">Could not load leaderboard.</div>';
    console.warn('Leaderboard load failed:', e);
  }
}

async function submitScore() {
  if (!db) return;
  const btn = $('finish-lb-submit');
  btn.textContent = 'Submitting…';
  btn.disabled    = true;

  try {
    const username = await getUsername();
    const url  = `${fsBase()}/${COLLECTION}`;
    const body = {
      fields: {
        username:  fsVal(username),
        setTitle:  fsVal(activeSet.title),
        timeMs:    fsVal(lastTimeMs),
        accuracy:  fsVal(100),
        timestamp: { timestampValue: new Date().toISOString() },
      }
    };
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(res.status);
    toast('Score submitted!', 'success');
    btn.textContent = '✓ Submitted';
    btn.disabled    = true;
    await loadLeaderboard();
  } catch (e) {
    toast('Submission failed — check Firebase config.', 'error');
    btn.textContent = 'Submit to leaderboard →';
    btn.disabled = false;
    console.warn('Score submit failed:', e);
  }
}

// ── Web Audio tones ───────────────────────────────────────
let audioCtx = null;
function playTone(freq, ms) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.07, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + ms / 1000);
    osc.start();
    osc.stop(audioCtx.currentTime + ms / 1000);
  } catch { /* silent if AudioContext unavailable */ }
}

// ── Confetti ──────────────────────────────────────────────
function launchConfetti() {
  const canvas = $('confetti-canvas');
  canvas.style.display = 'block';
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx    = canvas.getContext('2d');
  const colors = ['#4fd98e','#e8b84b','#6b9fff','#a78bfa','#fb7185','#fff','#38bdf8'];
  const pieces = Array.from({length: 100}, () => ({
    x:  Math.random() * canvas.width,
    y:  Math.random() * -canvas.height,
    vx: (Math.random() - 0.5) * 3,
    vy: 2 + Math.random() * 3,
    r:  4 + Math.random() * 5,
    color: colors[Math.floor(Math.random() * colors.length)],
    angle: Math.random() * Math.PI * 2,
    spin:  (Math.random() - 0.5) * 0.12,
  }));

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    pieces.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.vy += 0.06; p.angle += p.spin;
      if (p.y < canvas.height + 20) alive = true;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.r/2, -p.r/2, p.r, p.r * 0.45);
      ctx.restore();
    });
    if (alive) confettiRAF = requestAnimationFrame(draw);
    else stopConfetti();
  }
  confettiRAF = requestAnimationFrame(draw);
}

function stopConfetti() {
  if (confettiRAF) { cancelAnimationFrame(confettiRAF); confettiRAF = null; }
  const c = $('confetti-canvas');
  if (c) c.style.display = 'none';
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

init();
