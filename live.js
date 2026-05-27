import { initStarCanvas, getUsername, storage, toast, requirePremium } from './pluto-shared.js';

const SERVER   = 'https://pluto-server-production.up.railway.app';
const Q_SECS   = 20;
const RESULT_SECS = 3;
const MAX_Q    = 10;
const LABELS   = ['A', 'B', 'C', 'D'];
const MEDALS   = ['🥇', '🥈', '🥉'];
const $        = id => document.getElementById(id);

// ── State ──────────────────────────────────────────────────
let playerId   = null;
let playerName = '';
let roomCode   = null;
let isHost     = false;
let eventSource = null;
let lastState   = null;
let answered    = false;
let lastQIdx    = -1;
let timerRaf    = null;
let qStartMs    = 0;

// ── Views ──────────────────────────────────────────────────
const VIEWS = ['view-lobby', 'view-waiting', 'view-race', 'view-results'];
function showView(id) {
  VIEWS.forEach(v => {
    const el = $(v);
    if (!el) return;
    el.style.display = v === id ? (v === 'view-race' ? 'flex' : 'block') : 'none';
  });
}

// ── Lobby wiring ───────────────────────────────────────────
function checkLobbyReady() {
  const name = $('player-name').value.trim();
  $('create-btn').disabled = !name || !$('set-picker').value;
  $('join-btn').disabled   = !name || $('join-code').value.trim().length < 4;
}

$('player-name').addEventListener('input', checkLobbyReady);
$('set-picker').addEventListener('change', checkLobbyReady);
$('join-code').addEventListener('input', () => {
  $('join-code').value = $('join-code').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  checkLobbyReady();
});
$('join-code').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });

$('create-btn').addEventListener('click', createRoom);
$('join-btn').addEventListener('click',   joinRoom);

async function populateSets() {
  const { plutoSets = [] } = await storage.get('plutoSets');
  const sel = $('set-picker');
  sel.innerHTML = '<option value="">Choose a study set…</option>';
  plutoSets.forEach(s => {
    const o = document.createElement('option');
    o.value = s.id;
    o.textContent = `${s.name || s.title || 'Untitled'} (${(s.cards || []).length} cards)`;
    sel.appendChild(o);
  });
  checkLobbyReady();
}

function buildQuestions(cards) {
  if (cards.length < 4) throw new Error('Need at least 4 cards for a race');
  const pool    = [...cards].sort(() => Math.random() - 0.5);
  const selected = pool.slice(0, Math.min(MAX_Q, pool.length));
  return selected.map(card => {
    const wrong = cards
      .filter(c => c.def !== card.def)
      .sort(() => Math.random() - 0.5)
      .slice(0, 3)
      .map(c => c.def);
    const options = [card.def, ...wrong].sort(() => Math.random() - 0.5);
    return { q: card.term, options, correct: options.indexOf(card.def) };
  });
}

function lobbyError(msg) {
  const el = $('lobby-error');
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 4000);
}

async function createRoom() {
  const name = $('player-name').value.trim();
  const setId = $('set-picker').value;
  if (!name || !setId) return;

  const { plutoSets = [] } = await storage.get('plutoSets');
  const set = plutoSets.find(s => s.id === setId);
  if (!set) return lobbyError('Set not found');

  let questions;
  try { questions = buildQuestions(set.cards); }
  catch (e) { return lobbyError(e.message); }

  // Check server reachable
  const alive = await pingServer();
  if (!alive) return lobbyError('Server not running — start it on port 3000 first');

  playerName = name;
  isHost     = true;
  await storage.set({ racePlayerName: name });

  let res;
  try {
    res = await fetch(`${SERVER}/race/create`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: name, playerId, setName: set.name, questions })
    });
    const data = await res.json();
    if (data.error) return lobbyError(data.error);
    roomCode = data.code;
  } catch { return lobbyError('Could not reach server'); }

  enterWaiting();
  connectSSE();
}

async function joinRoom() {
  const name = $('player-name').value.trim();
  const code = $('join-code').value.trim().toUpperCase();
  if (!name || code.length < 4) return;

  const alive = await pingServer();
  if (!alive) return lobbyError('Server not running — start it on port 3000 first');

  playerName = name;
  isHost     = false;
  roomCode   = code;
  await storage.set({ racePlayerName: name });

  let data;
  try {
    const res = await fetch(`${SERVER}/race/join`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, playerName: name, playerId })
    });
    data = await res.json();
    if (data.error) return lobbyError(data.error);
  } catch { return lobbyError('Could not reach server'); }

  enterWaiting();
  connectSSE();
}

// ── Waiting room ───────────────────────────────────────────
function enterWaiting() {
  showView('view-waiting');
  $('room-code-display').textContent = roomCode;
  $('back-btn').onclick = leaveRoom;
  if (isHost) {
    $('start-btn').style.display = 'inline-flex';
    $('waiting-label').style.display = 'none';
  }
}

$('room-code-display').addEventListener('click', () => {
  navigator.clipboard.writeText(roomCode).then(() => toast('Code copied!', 'success')).catch(() => {});
});

$('start-btn').addEventListener('click', async () => {
  const res = await fetch(`${SERVER}/race/start`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: roomCode, playerId })
  });
  const data = await res.json();
  if (data.error) toast(data.error, 'error');
});

$('leave-btn').addEventListener('click', leaveRoom);

function leaveRoom() {
  if (eventSource) { eventSource.close(); eventSource = null; }
  cancelAnimationFrame(timerRaf);
  roomCode = null; isHost = false; lastState = null; lastQIdx = -1;
  $('join-code').value = '';
  showView('view-lobby');
  $('back-btn').onclick = () => {
    window.location.href = chrome.runtime.getURL('dashboard.html');
  };
}

function renderWaiting(state) {
  const players = Object.entries(state.players);
  $('player-count').textContent   = players.length;
  $('set-name-display').textContent = state.setName;

  const list = $('player-list');
  list.innerHTML = '';
  players.forEach(([id, p]) => {
    const el = document.createElement('div');
    el.className = 'player-chip';
    el.innerHTML = `
      <div class="pip"></div>
      ${id === state.host ? '<span class="crown">👑</span>' : ''}
      <span>${esc(p.name)}${id === playerId ? ' (you)' : ''}</span>
    `;
    list.appendChild(el);
  });
}

// ── SSE connection ─────────────────────────────────────────
function connectSSE() {
  if (eventSource) { eventSource.close(); }
  eventSource = new EventSource(`${SERVER}/race/events/${roomCode}/${playerId}`);
  eventSource.addEventListener('state', e => {
    try { handleState(JSON.parse(e.data)); } catch {}
  });
  eventSource.onerror = () => {
    eventSource.close(); eventSource = null;
    if (roomCode) setTimeout(connectSSE, 2000);
  };
}

// ── State machine ──────────────────────────────────────────
function handleState(state) {
  if (!state) return;
  lastState = state;

  if (state.status === 'waiting') {
    showView('view-waiting');
    renderWaiting(state);

  } else if (state.status === 'countdown') {
    showView('view-race');
    $('q-results-overlay').classList.remove('active');
    startCountdown();

  } else if (state.status === 'active') {
    showView('view-race');
    $('countdown-overlay').classList.remove('active');
    $('q-results-overlay').classList.remove('active');
    renderQuestion(state);

  } else if (state.status === 'done') {
    cancelAnimationFrame(timerRaf);
    $('q-results-overlay').classList.remove('active');
    $('countdown-overlay').classList.remove('active');
    showView('view-results');
    renderResults(state);
  }
}

// ── Countdown ──────────────────────────────────────────────
function startCountdown() {
  const overlay = $('countdown-overlay');
  const numEl   = $('countdown-num');
  overlay.classList.add('active');
  let n = 3;
  numEl.textContent = n;
  const tick = setInterval(() => {
    n--;
    if (n <= 0) { clearInterval(tick); overlay.classList.remove('active'); }
    else numEl.textContent = n;
  }, 1000);
}

// ── Race question rendering ────────────────────────────────
function renderQuestion(state) {
  const qIdx = state.currentQ;
  const q    = state.questions[qIdx];
  if (!q) return;

  // New question — reset answered state
  if (qIdx !== lastQIdx) {
    lastQIdx  = qIdx;
    answered  = false;
    qStartMs  = state.qStartMs;

    $('q-num').textContent   = qIdx + 1;
    $('q-total').textContent = state.totalQ;
    $('race-question').textContent = q.q;

    const opts = $('race-opts');
    opts.innerHTML = '';
    q.options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.className = 'opt-btn';
      btn.innerHTML = `<span class="opt-label">${LABELS[i]}</span>${esc(opt)}`;
      btn.addEventListener('click', () => submitAnswer(qIdx, i, q));
      opts.appendChild(btn);
    });
  }

  // Show already-known answers (from other players or own)
  const myAnswer = state.answers?.[qIdx]?.[playerId];
  if (myAnswer !== undefined && !answered) {
    answered = true;
    revealAnswers(q, state.answers[qIdx]);
  }

  // Check if we should show between-question results overlay
  const elapsed  = Date.now() - state.qStartMs;
  const timeLeft = Q_SECS * 1000 - elapsed;
  if (timeLeft <= 0) {
    showQResults(state, qIdx);
  }

  // Update mini-scoreboard
  renderMiniScores(state);

  // Start/continue timer
  tickTimer(state.qStartMs);
}

function tickTimer(startMs) {
  cancelAnimationFrame(timerRaf);
  const step = () => {
    const elapsed  = Date.now() - startMs;
    const timeLeft = Math.max(0, Q_SECS * 1000 - elapsed);
    const pct      = (timeLeft / (Q_SECS * 1000)) * 100;
    const fill     = $('race-timer-fill');
    const secs     = $('race-timer-secs');
    if (fill) fill.style.width = pct + '%';
    if (secs) secs.textContent = Math.ceil(timeLeft / 1000);
    if (fill) fill.style.background = pct < 25 ? '#ff5f5f' : pct < 50 ? '#e8b84b' : '#38bdf8';
    if (timeLeft > 0) timerRaf = requestAnimationFrame(step);
  };
  timerRaf = requestAnimationFrame(step);
}

// ── Submit answer ──────────────────────────────────────────
async function submitAnswer(qIdx, choice, q) {
  if (answered) return;
  answered = true;

  // Optimistically highlight selected
  const btns = $('race-opts').querySelectorAll('.opt-btn');
  btns.forEach((b, i) => { if (i === choice) b.classList.add('selected'); b.disabled = true; });

  const res  = await fetch(`${SERVER}/race/answer`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: roomCode, playerId, questionIdx: qIdx, choice })
  });
  const data = await res.json().catch(() => ({}));

  revealAnswers(q, { [playerId]: { choice, correct: data.correct } });
  if (data.correct) showScorePop([100, 75, 50, 25][0]); // approximate — server has exact value
}

function revealAnswers(q, answerMap) {
  const btns = $('race-opts').querySelectorAll('.opt-btn');
  btns.forEach((b, i) => {
    b.disabled = true;
    if (i === q.correct) b.classList.add('correct');
  });
  // Mark own wrong answer
  const mine = answerMap?.[playerId];
  if (mine && mine.choice !== q.correct) {
    btns[mine.choice]?.classList.add('wrong');
  }
}

function showScorePop(pts) {
  const el = document.createElement('div');
  el.className = 'score-pop';
  el.textContent = `+${pts}`;
  el.style.color = '#4fd98e';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 950);
}

// ── Between-question results ───────────────────────────────
function showQResults(state, qIdx) {
  const q       = state.questions[qIdx];
  const overlay = $('q-results-overlay');
  if (overlay.classList.contains('active')) return;

  $('q-correct-answer').textContent = q?.options[q.correct] || '';

  const answers  = state.answers?.[qIdx] || {};
  const players  = state.players;
  const rows     = $('q-result-rows');
  rows.innerHTML = '';

  Object.entries(players)
    .sort((a, b) => b[1].score - a[1].score)
    .forEach(([id, p]) => {
      const a  = answers[id];
      const el = document.createElement('div');
      el.className = 'q-result-row';
      const icon = !a ? '—' : a.correct ? '✓' : '✗';
      const color = !a ? 'rgba(255,255,255,.3)' : a.correct ? '#4fd98e' : '#ff5f5f';
      el.innerHTML = `
        <span style="color:${color};font-weight:700;width:20px">${icon}</span>
        <span>${esc(p.name)}${id === playerId ? ' (you)' : ''}</span>
        <span class="pts">${p.score} pts</span>
      `;
      rows.appendChild(el);
    });

  const nextQ    = qIdx + 1;
  const isLast   = nextQ >= state.totalQ;
  $('next-q-label').textContent = isLast ? 'Finishing race…' : `Next question in ${RESULT_SECS}…`;
  overlay.classList.add('active');
  cancelAnimationFrame(timerRaf);
}

// ── Mini-scoreboard ────────────────────────────────────────
function renderMiniScores(state) {
  const footer = $('race-footer');
  footer.innerHTML = '';
  Object.entries(state.players)
    .sort((a, b) => b[1].score - a[1].score)
    .forEach(([id, p]) => {
      const chip = document.createElement('div');
      chip.className = 'mini-score-chip' + (id === playerId ? ' me' : '');
      chip.textContent = `${p.name}  ${p.score}`;
      footer.appendChild(chip);
    });
}

// ── Final results ──────────────────────────────────────────
function renderResults(state) {
  cancelAnimationFrame(timerRaf);
  const sorted = Object.entries(state.players).sort((a, b) => b[1].score - a[1].score);

  const winner = sorted[0]?.[1]?.name || '';
  $('results-title').textContent = sorted[0]?.[0] === playerId ? '🏆 You won!' : `${winner} wins!`;

  const podium = $('podium');
  podium.innerHTML = '';
  sorted.forEach(([id, p], i) => {
    const card = document.createElement('div');
    card.className = 'result-card' + (i === 0 ? ' winner' : '');
    card.innerHTML = `
      <div class="result-rank">${MEDALS[i] || `${i + 1}.`}</div>
      <div class="result-name">${esc(p.name)}${id === playerId ? ' <span style="font-size:11px;opacity:.4">(you)</span>' : ''}</div>
      <div class="result-score">${p.score} pts</div>
    `;
    podium.appendChild(card);
  });

  if (isHost) {
    $('play-again-btn').style.display = 'inline-flex';
    $('play-again-btn').onclick = () => {
      // Recreate with same set
      showView('view-lobby');
    };
  }
}

// ── Helpers ────────────────────────────────────────────────
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function pingServer() {
  try {
    const r = await fetch(`${SERVER}/brain-stats`, { signal: AbortSignal.timeout(4000) });
    return r.ok;
  } catch { return false; }
}

// ── Boot ───────────────────────────────────────────────────
async function init() {
  if (!await requirePremium('Live Race')) return;
  initStarCanvas($('stars'));

  // Get or create a persistent player ID
  const stored = await storage.get(['racePlayerId', 'racePlayerName']);
  if (stored.racePlayerId) {
    playerId = stored.racePlayerId;
  } else {
    playerId = Math.random().toString(36).slice(2, 10);
    await storage.set({ racePlayerId: playerId });
  }

  // Pre-fill name if saved
  if (stored.racePlayerName) {
    $('player-name').value = stored.racePlayerName;
  } else {
    const name = await getUsername();
    if (name && name !== 'Anonymous') $('player-name').value = name;
  }

  await populateSets();
  checkLobbyReady();
  showView('view-lobby');

  $('back-btn').onclick = () => {
    window.location.href = chrome.runtime.getURL('dashboard.html');
  };

  const dashBtn = $('dashboard-btn');
  if (dashBtn) dashBtn.addEventListener('click', () => {
    window.location.href = chrome.runtime.getURL('dashboard.html');
  });
}

init();
