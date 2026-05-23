import {
  initStarCanvas, askAI, storage, toast, logActivity
} from './pluto-shared.js';

// ── State ─────────────────────────────────────────────────
let sets        = [];
let activeSet   = null;
let queue       = [];
let current     = null;        // card object
let askingFor   = null;        // transient prompt direction: 'term' or 'def'
let streak      = 0;           // consecutive correct
let sessionCorrect = 0;
let sessionWrong   = 0;
let totalAnswered  = 0;        // in this session, triggers round screen
let writeMode   = false;       // MC vs write
let answered    = false;       // waiting for Continue
let confettiRAF = null;

// ── Helpers ───────────────────────────────────────────────
function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function shuffle(items) {
  const arr = items.slice();
  let m = arr.length;
  while (m) {
    const i = Math.floor(Math.random() * m--);
    [arr[m], arr[i]] = [arr[i], arr[m]];
  }
  return arr;
}

function $(id) { return document.getElementById(id); }

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({length: m+1}, (_,i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1]
               : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

function cleanNorm(s) {
  return s.toLowerCase().trim().replace(/[^a-z0-9\s]/g,'').replace(/\s+/g,' ');
}

// ── Storage ───────────────────────────────────────────────
async function loadSets() {
  const { plutoSets = [] } = await storage.get('plutoSets');
  sets = plutoSets;
}

async function saveSets() {
  await storage.set({ plutoSets: sets });
}

// ── Picker view ───────────────────────────────────────────
function buildPicker() {
  const grid = $('picker-grid');
  grid.innerHTML = '';
  const eligible = sets.filter(s => s.cards && s.cards.length > 0);

  if (eligible.length === 0) {
    grid.innerHTML = '<div style="color:rgba(255,255,255,.3);font-size:13px;grid-column:1/-1">No sets yet — create one in Study Sets first.</div>';
    return;
  }

  eligible.forEach((s, i) => {
    const mastered = s.cards.filter(c => (c.mastery||0) >= 3).length;
    const card = document.createElement('div');
    card.className = 'picker-card';
    card.style.animationDelay = `${i * 50}ms`;
    card.innerHTML = `
      <div class="picker-card-title">${esc(s.title)}</div>
      <div class="picker-card-meta">${s.cards.length} cards · ${mastered} mastered</div>
    `;
    card.addEventListener('click', () => startLearn(s));
    grid.appendChild(card);
  });
}

// ── Queue builder ─────────────────────────────────────────
function buildQueue() {
  const now = Date.now();
  const due = activeSet.cards.filter(c => (c.mastery||0) < 3 && (c.nextReview||0) <= now);
  // Sort by mastery ascending (least confident first), shuffle within same mastery
  due.sort((a, b) => {
    const dm = (a.mastery||0) - (b.mastery||0);
    return dm !== 0 ? dm : Math.random() - 0.5;
  });
  return due;
}

function isMastered() {
  return activeSet.cards.every(c => (c.mastery||0) >= 3);
}

// ── Start / init ──────────────────────────────────────────
function startLearn(set) {
  activeSet      = set;
  streak         = 0;
  sessionCorrect = 0;
  sessionWrong   = 0;
  totalAnswered  = 0;
  writeMode      = false;
  answered       = false;
  queue          = buildQueue();

  $('view-picker').style.display = 'none';
  $('view-learn').classList.remove('hidden');

  updateProgress();
  updateStreak();
  $('set-label').textContent = set.title.toUpperCase();

  logActivity('🧠', `Learning: ${set.title}`);
  nextCard();
}

// ── Progress bar ──────────────────────────────────────────
function updateProgress() {
  const total    = activeSet.cards.length;
  const mastered = activeSet.cards.filter(c => (c.mastery||0) >= 3).length;
  const pct      = total > 0 ? (mastered / total) * 100 : 0;
  $('prog-fill').style.width = `${pct}%`;
  $('prog-text').textContent = `${mastered} / ${total} mastered`;
}

function updateStreak() {
  $('streak-badge').textContent = streak > 0 ? `🔥${streak}` : streak;
}

// ── Next card ─────────────────────────────────────────────
function nextCard() {
  hideAllFeedback();
  answered = false;

  // Rebuild queue each time to pick up newly reviewable cards
  queue = buildQueue();

  if (queue.length === 0) {
    if (isMastered()) {
      showMastered();
    } else {
      // All remaining cards are in cooldown — show round complete
      showRoundComplete(true);
    }
    return;
  }

  // Check round complete every 10 answers
  if (totalAnswered > 0 && totalAnswered % 10 === 0) {
    showRoundComplete(false);
    return;
  }

  current = queue[0];

  // Decide mode: write after 5 correct in a row
  const showWrite = writeMode && current.mastery >= 1;
  $('mc-section').style.display  = showWrite ? 'none' : '';
  $('write-section').classList.toggle('hidden', !showWrite);
  $('mode-badge').textContent = showWrite ? 'WRITE MODE' : 'MULTIPLE CHOICE';

  renderQuestion();
  if (showWrite) {
    renderWrite();
  } else {
    renderMC();
  }
}

// ── Question card ─────────────────────────────────────────
function renderQuestion() {
  // Alternate: sometimes show term and ask for definition, sometimes vice versa
  const flip = current.mastery >= 2 && Math.random() > 0.5;
  if (flip) {
    $('q-label').textContent = 'TERM';
    $('q-text').textContent  = current.term;
    askingFor = 'def';
  } else {
    $('q-label').textContent = 'DEFINITION';
    $('q-text').textContent  = current.def;
    askingFor = 'term';
  }
}

// ── MC choices ────────────────────────────────────────────
function renderMC() {
  const grid    = $('choices-grid');
  grid.innerHTML = '';
  const answer  = askingFor === 'term' ? current.term : current.def;
  const pool    = activeSet.cards.filter(c => c.id !== current.id);

  // Pick 3 distractors from other cards
  const distractors = shuffle(pool).slice(0, 3)
    .map(c => askingFor === 'term' ? c.term : c.def);
  const choices = shuffle([...distractors, answer]);

  choices.forEach(text => {
    const btn = document.createElement('button');
    btn.className   = 'choice-btn';
    btn.textContent = text;
    btn.addEventListener('click', () => handleMCChoice(btn, text === answer, answer));
    grid.appendChild(btn);
  });

  // If fewer than 4 choices (tiny set) just show 2-col still
  if (choices.length < 4) {
    $('choices-grid').style.gridTemplateColumns = '1fr';
  } else {
    $('choices-grid').style.gridTemplateColumns = '';
  }
}

function handleMCChoice(btn, isCorrect, correctAnswer) {
  if (answered) return;
  answered = true;

  const all = $('choices-grid').querySelectorAll('.choice-btn');
  all.forEach(b => {
    if (b.textContent === correctAnswer) b.classList.add('correct');
    else if (b !== btn) b.classList.add('dim');
  });
  if (!isCorrect) btn.classList.add('wrong');

  handleAnswer(isCorrect, correctAnswer);
}

// ── Write mode ────────────────────────────────────────────
function renderWrite() {
  const inp = $('write-in');
  inp.value = '';
  inp.className = 'write-input';
  inp.disabled  = false;
  inp.placeholder = askingFor === 'term' ? 'Type the term…' : 'Type the definition…';
  inp.focus();
  $('write-check').disabled = true;
}

async function checkWrite() {
  if (answered) return;
  const inp = $('write-in');
  const raw = inp.value.trim();
  if (!raw) return;

  const answer  = askingFor === 'term' ? current.term : current.def;
  const normRaw = cleanNorm(raw);
  const normAns = cleanNorm(answer);
  const dist    = levenshtein(normRaw, normAns);

  // Instant exact / near-exact pass — no AI needed
  if (normRaw === normAns || dist <= 2) {
    inp.disabled = true;
    answered = true;
    inp.classList.add('correct');
    handleAnswer(true, answer);
    return;
  }

  // Ambiguous — ask AI to judge semantic equivalence
  inp.disabled = true;
  const btn = $('write-check');
  btn.disabled    = true;
  btn.textContent = '…';

  let isCorrect = false;
  try {
    const res = await askAI({
      message: `A student is answering a flashcard. The correct answer is: "${answer}". The student wrote: "${raw}". Is the student's answer close enough to be marked correct? Accept synonyms, alternate scientific names, and equivalent phrasings. Reject answers that are clearly about a different concept. Reply with ONLY "yes" or "no".`,
      history: []
    });
    const reply = (res?.reply ?? (typeof res === 'string' ? res : '')).toLowerCase().trim();
    isCorrect = reply.startsWith('yes');
  } catch {
    isCorrect = false;
  }

  btn.disabled    = false;
  btn.textContent = 'Check →';
  answered = true;

  inp.classList.add(isCorrect ? 'correct' : 'wrong');
  handleAnswer(isCorrect, answer);
}

// ── Core answer handler ───────────────────────────────────
function handleAnswer(isCorrect, correctAnswer) {
  const now = Date.now();
  totalAnswered++;

  if (isCorrect) {
    sessionCorrect++;
    streak++;
    current.mastery    = Math.min(3, (current.mastery||0) + 1);
    current.nextReview = now + Math.pow(2, current.mastery) * 60_000;

    if (streak >= 5) writeMode = true;

    showFeedback('correct', `Correct! ${streak >= 3 ? `🔥 ${streak} streak!` : ''}`);
  } else {
    sessionWrong++;
    streak    = 0;
    writeMode = false;
    current.mastery    = Math.max(0, (current.mastery||0) - 1);
    current.nextReview = now + 30_000;

    showFeedback('wrong', `The answer was: ${correctAnswer}`);

    // AI hint every 3rd wrong answer
    if (sessionWrong % 3 === 0) fetchHint();
  }

  updateStreak();
  updateProgress();
  saveSets();

  $('continue-btn').classList.remove('hidden');
}

// ── Feedback ──────────────────────────────────────────────
function showFeedback(type, text) {
  const box = $('feedback-box');
  box.className  = `feedback-box ${type}`;
  box.textContent = text;
  box.classList.remove('hidden');
}

function hideAllFeedback() {
  $('feedback-box').classList.add('hidden');
  $('hint-box').classList.add('hidden');
  $('continue-btn').classList.add('hidden');
  $('write-in').value = '';
  $('write-in').className = 'write-input';
}

// ── AI hint ───────────────────────────────────────────────
async function fetchHint() {
  const box = $('hint-box');
  box.textContent = '💡 Getting a hint…';
  box.classList.remove('hidden');
  try {
    const res  = await askAI({
      message: `Give one short memorable sentence (max 20 words) explaining the connection between this term and definition. Term: "${current.term}" — Definition: "${current.def}". No markdown, no lists, just a plain sentence.`,
      history: []
    });
    const hint = res?.reply ?? (typeof res === 'string' ? res : '');
    box.textContent = hint ? `💡 ${hint}` : '💡 Keep at it — repetition builds memory!';
  } catch {
    box.textContent = '💡 Keep at it — repetition builds memory!';
  }
}

// ── Round complete ────────────────────────────────────────
function showRoundComplete(cooldown = false) {
  const total   = sessionCorrect + sessionWrong;
  const pct     = total > 0 ? Math.round((sessionCorrect / total) * 100) : 0;
  const mastered = activeSet.cards.filter(c => (c.mastery||0) >= 3).length;

  $('round-title').textContent = cooldown ? 'All caught up!' : 'Round complete!';
  $('round-sub').textContent   = cooldown
    ? `Cards in cooldown — come back soon to continue.`
    : `${mastered} of ${activeSet.cards.length} cards mastered`;
  $('round-pct').textContent   = `${pct}% accuracy this session`;

  $('view-round').classList.remove('hidden');
  $('view-learn').style.display = 'none';

  $('round-exit').onclick     = () => exitLearn();
  $('round-continue').onclick = () => {
    // If cooldown, just exit
    if (cooldown) { exitLearn(); return; }
    $('view-round').classList.add('hidden');
    $('view-learn').style.display = 'flex';
    nextCard();
  };

  if (cooldown) $('round-continue').style.display = 'none';
  else           $('round-continue').style.display = '';
}

// ── Set mastered ──────────────────────────────────────────
function showMastered() {
  const total = sessionCorrect + sessionWrong;
  const pct   = total > 0 ? Math.round((sessionCorrect / total) * 100) : 100;
  $('mastered-title').textContent = `${activeSet.title} — Mastered!`;
  $('mastered-acc').textContent   = `${pct}% accuracy · ${activeSet.cards.length} cards`;
  $('view-mastered').classList.remove('hidden');
  $('view-learn').style.display = 'none';
  launchConfetti();
  logActivity('🏆', `Mastered: ${activeSet.title}`);
  $('mastered-back').onclick = () => exitLearn();
}

function exitLearn() {
  stopConfetti();
  // Return to picker by stripping query params and reloading
  window.location.href = window.location.pathname;
}

// ── Confetti ──────────────────────────────────────────────
function launchConfetti() {
  const canvas = $('confetti-canvas');
  canvas.style.display = 'block';
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx   = canvas.getContext('2d');
  const colors = ['#4fd98e','#6b9fff','#a78bfa','#fb7185','#e8b84b','#fff','#38bdf8'];
  const pieces = Array.from({length: 120}, () => ({
    x:  Math.random() * canvas.width,
    y:  Math.random() * -canvas.height,
    vx: (Math.random() - 0.5) * 3,
    vy: 2 + Math.random() * 3,
    r:  4 + Math.random() * 5,
    color: colors[Math.floor(Math.random() * colors.length)],
    angle: Math.random() * Math.PI * 2,
    spin:  (Math.random() - 0.5) * 0.15,
  }));

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    pieces.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.angle += p.spin;
      if (p.y < canvas.height + 20) alive = true;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.r/2, -p.r/2, p.r, p.r * 0.4);
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

// ── Keyboard ──────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if ($('view-learn').classList.contains('hidden')) return;
  if (e.key === 'Enter') {
    if (!answered) {
      // If write mode, trigger check
      if (!$('write-section').classList.contains('hidden')) checkWrite();
    } else {
      advanceContinue();
    }
  }
  if (e.key === 'Escape') exitLearn();
});

function advanceContinue() {
  if (!answered) return;
  nextCard();
}

// ── Boot ──────────────────────────────────────────────────
async function init() {
  initStarCanvas($('stars'));
  await loadSets();

  // Parse ?set=<id> from URL
  const params = new URLSearchParams(window.location.search);
  const setId  = params.get('set');

  if (setId) {
    const found = sets.find(s => s.id === setId);
    if (found) {
      startLearn(found);
      return;
    }
    toast('Set not found.', 'error');
  }

  // Show picker
  buildPicker();
}

// ── Wire up UI events ─────────────────────────────────────
$('exit-btn').addEventListener('click', exitLearn);

$('write-check').addEventListener('click', checkWrite);
$('write-in').addEventListener('input', e => {
  $('write-check').disabled = !e.target.value.trim();
});
$('write-in').addEventListener('keydown', e => { if (e.key === 'Enter') checkWrite(); });

$('continue-btn').addEventListener('click', advanceContinue);

init();
