import { initStarCanvas, askAI, storage, openPage, toast, logActivity } from './pluto-shared.js';

// ── State ──────────────────────────────────────────────────
let sets        = [];
let activeSet   = null;
let editingId   = null; // null = create mode, string = edit mode

// Flip
let flipCards   = [];
let flipIdx     = 0;
let flipKeyHandler = null;

// Write
let writeCards  = [];
let writeIdx    = 0;

// ── Storage ────────────────────────────────────────────────
async function loadSets() {
  const { plutoSets = [] } = await storage.get('plutoSets');
  sets = plutoSets;
}
async function saveSets() {
  await storage.set({ plutoSets: sets });
}
function uid(prefix = 'x') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

// ── View router ────────────────────────────────────────────
const $ = id => document.getElementById(id);

function showOnly(id) {
  ['view-library','view-detail','view-flip','view-write'].forEach(v =>
    $(v).classList.toggle('hidden', v !== id)
  );
}

// ── Helpers ────────────────────────────────────────────────
function esc(s) {
  return String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function timeAgo(ts) {
  if (!ts) return 'never';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)            return 'just now';
  if (s < 3600)          return `${Math.floor(s/60)}m ago`;
  if (s < 86400)         return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}

function masteryOf(set) {
  if (!set.cards.length) return 0;
  return Math.round(set.cards.filter(c => c.mastery >= 2).length / set.cards.length * 100);
}

function cleanText(t) {
  if (!t) return t;
  return t
    .replace(/\*\*\*([\s\S]*?)\*\*\*/g, '$1')
    .replace(/\*\*([\s\S]*?)\*\*/g, '$1')
    .replace(/\*([\s\S]*?)\*/g, '$1')
    .replace(/__([\s\S]*?)__/g, '$1')
    .replace(/_([\s\S]*?)_/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/```[a-z]*\n?([\s\S]*?)```/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\$\$([^$]+)\$\$/g, '$1')
    .replace(/\$([^$\n]+)\$/g, '$1')
    .trim();
}

function safeParseJSON(text) {
  text = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
  const s = text.indexOf('['), e = text.lastIndexOf(']');
  if (s === -1 || e === -1) throw new Error('No array found');
  let json = text.slice(s, e + 1);
  try { return JSON.parse(json); } catch (_) {}
  json = json.replace(/"(?:[^"\\]|\\.)*"/g, m =>
    m.replace(/\n/g,'\\n').replace(/\r/g,'').replace(/\t/g,'\\t')
  );
  return JSON.parse(json);
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp = Array.from({length: a.length + 1}, (_, i) =>
    Array.from({length: b.length + 1}, (_, j) => j ? j : i)
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[a.length][b.length];
}

// ── LIBRARY ────────────────────────────────────────────────
function showLibrary() {
  showOnly('view-library');
  $('page-title').textContent = 'STUDY SETS';
  $('back-btn').onclick = () => window.close();

  const totalCards = sets.reduce((n, s) => n + s.cards.length, 0);
  $('lib-sub').textContent = sets.length
    ? `${sets.length} set${sets.length > 1 ? 's' : ''} · ${totalCards} card${totalCards !== 1 ? 's' : ''} total`
    : 'No sets yet';

  const empty = $('lib-empty');
  const grid  = $('sets-grid');
  grid.innerHTML = '';

  if (!sets.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  sets.forEach((s, i) => {
    const pct  = masteryOf(s);
    const card = document.createElement('div');
    card.className = 'set-card';
    card.style.animationDelay = `${i * 35}ms`;
    card.innerHTML = `
      <div class="set-card-title">${esc(s.title)}</div>
      <div class="set-card-meta">${s.cards.length} card${s.cards.length !== 1 ? 's' : ''} · ${timeAgo(s.lastStudied)}</div>
      <div class="set-prog-track"><div class="set-prog-fill" style="width:${pct}%"></div></div>
      <div class="set-prog-text">${s.cards.filter(c => c.mastery >= 2).length}/${s.cards.length} mastered</div>
    `;
    card.addEventListener('click', () => showDetail(s));
    grid.appendChild(card);
  });
}

// ── DETAIL ─────────────────────────────────────────────────
function showDetail(set) {
  activeSet = set;
  showOnly('view-detail');
  $('page-title').textContent = 'SET';
  $('back-btn').onclick = showLibrary;

  $('det-title').textContent = set.title;
  $('det-desc').textContent  = set.description || '';
  $('det-meta').textContent  = `${set.cards.length} cards · created ${timeAgo(set.createdAt)}`;
  $('det-card-count').textContent = `${set.cards.length} card${set.cards.length !== 1 ? 's' : ''}`;

  $('det-edit').onclick   = () => openModal(set);
  $('det-delete').onclick = () => doDelete(set);

  $('btn-flip').onclick   = () => startFlip(set);
  $('btn-write').onclick  = () => startWrite(set);
  $('btn-learn').onclick  = () => openPage('learn.html', `set=${set.id}`);
  $('btn-match').onclick  = () => openPage('match.html', `set=${set.id}`);
  $('btn-test').onclick   = () => openPage('test.html', `set=${set.id}`);
  $('btn-voice').onclick  = () => openPage('kai.html', `set=${set.id}`);

  // Card list
  const list = $('det-card-list');
  list.innerHTML = '';
  set.cards.forEach((c, i) => {
    const row = document.createElement('div');
    row.className = 'cli';
    const m = c.mastery || 0;
    const dots = [0,1].map(d => `<div class="mdot ${m >= 2 ? 'mastered' : (m >= 1 && d === 0 ? 'learning' : '')}"></div>`).join('');
    row.innerHTML = `
      <div class="cli-num">${i + 1}</div>
      <div class="cli-term">${esc(c.term)}</div>
      <div class="cli-def">${esc(c.def)}</div>
      <div class="mastery-row">${dots}</div>
    `;
    list.appendChild(row);
  });
}

function doDelete(set) {
  if (!confirm(`Delete "${set.title}"? This cannot be undone.`)) return;
  sets = sets.filter(s => s.id !== set.id);
  saveSets();
  showLibrary();
  toast('Set deleted.');
}

// ── FLIP MODE ──────────────────────────────────────────────
function startFlip(set) {
  if (!set.cards.length) { toast('Add cards first!'); return; }
  flipCards = [...set.cards];
  flipIdx   = 0;

  showOnly('view-flip');
  $('back-btn').classList.add('hidden');

  $('flip-close').onclick = () => {
    $('back-btn').classList.remove('hidden');
    if (flipKeyHandler) { document.removeEventListener('keydown', flipKeyHandler); flipKeyHandler = null; }
    showDetail(set);
  };
  $('flip-prev').onclick  = () => navFlip(-1);
  $('flip-next').onclick  = () => navFlip(1);
  $('flip-card-wrap').onclick = flipReveal;
  $('flip-again').onclick = () => gradeFlip(false, set);
  $('flip-got').onclick   = () => gradeFlip(true,  set);

  if (flipKeyHandler) document.removeEventListener('keydown', flipKeyHandler);
  flipKeyHandler = e => {
    if ($('view-flip').classList.contains('hidden')) return;
    if (e.key === 'ArrowRight') navFlip(1);
    else if (e.key === 'ArrowLeft') navFlip(-1);
    else if (e.key === ' ') { e.preventDefault(); flipReveal(); }
  };
  document.addEventListener('keydown', flipKeyHandler);

  renderFlipCard();
  set.lastStudied  = Date.now();
  set.timesStudied = (set.timesStudied || 0) + 1;
  saveSets();
  logActivity('🃏', `Flip mode — ${set.title}`);
}

function renderFlipCard() {
  const c = flipCards[flipIdx];
  $('flip-term').textContent    = c.term;
  $('flip-def').textContent     = c.def;
  $('flip-counter').textContent = `${flipIdx + 1} / ${flipCards.length}`;
  $('flip-prog').style.width    = `${(flipIdx / flipCards.length) * 100}%`;
  $('flip-card-wrap').classList.remove('flipped');
  $('flip-prev').disabled = flipIdx === 0;
  $('flip-next').disabled = flipIdx === flipCards.length - 1;
}

function flipReveal() {
  $('flip-card-wrap').classList.toggle('flipped');
}

function navFlip(dir) {
  const next = flipIdx + dir;
  if (next < 0 || next >= flipCards.length) return;
  flipIdx = next;
  renderFlipCard();
}

function gradeFlip(gotIt, set) {
  const real = activeSet.cards.find(c => c.id === flipCards[flipIdx].id);
  if (real) {
    real.mastery = gotIt
      ? Math.min(2, (real.mastery || 0) + 1)
      : Math.max(0, (real.mastery || 0) - 1);
    saveSets();
    if (activeSet.cards.every(c => c.mastery >= 2)) launchConfetti();
  }
  if (flipIdx < flipCards.length - 1) {
    flipIdx++;
    renderFlipCard();
  } else {
    toast(gotIt ? '🎉 End of deck!' : 'End of deck — keep going!');
    $('flip-prog').style.width = '100%';
  }
}

// ── WRITE MODE ─────────────────────────────────────────────
function startWrite(set) {
  if (!set.cards.length) { toast('Add cards first!'); return; }
  writeCards = [...set.cards].sort(() => Math.random() - .5);
  writeIdx   = 0;

  showOnly('view-write');
  $('back-btn').classList.add('hidden');

  $('write-close').onclick = () => {
    $('back-btn').classList.remove('hidden');
    showDetail(set);
  };
  $('write-check').onclick = doCheck;
  $('write-next').onclick  = advanceWrite;

  $('write-input').onkeydown = e => {
    if (e.key === 'Enter') {
      if (!$('write-feedback').classList.contains('hidden')) advanceWrite();
      else doCheck();
    }
  };

  renderWriteCard();
  set.lastStudied  = Date.now();
  set.timesStudied = (set.timesStudied || 0) + 1;
  saveSets();
  logActivity('✍️', `Write mode — ${set.title}`);
}

function renderWriteCard() {
  const c = writeCards[writeIdx];
  $('write-prompt').textContent   = c.def;
  $('write-counter').textContent  = `${writeIdx + 1} / ${writeCards.length}`;
  $('write-prog').style.width     = `${(writeIdx / writeCards.length) * 100}%`;
  $('write-input').value          = '';
  $('write-input').className      = 'write-input';
  $('write-input').disabled       = false;
  $('write-feedback').className   = 'write-feedback hidden';
  $('write-feedback').textContent = '';
  $('write-next').classList.add('hidden');
  $('write-check').classList.remove('hidden');
  $('write-input').focus();
}

function doCheck() {
  const card    = writeCards[writeIdx];
  const typed   = $('write-input').value.trim();
  const correct = card.term.trim();
  const dist    = levenshtein(typed.toLowerCase(), correct.toLowerCase());
  const real    = activeSet.cards.find(c => c.id === card.id);

  $('write-check').classList.add('hidden');
  $('write-input').disabled = true;
  $('write-next').classList.remove('hidden');
  const fb = $('write-feedback');
  fb.classList.remove('hidden');

  if (typed === '') {
    fb.className      = 'write-feedback wrong';
    fb.textContent    = `The answer was: ${correct}`;
    $('write-input').classList.add('wrong');
    if (real) real.mastery = Math.max(0, (real.mastery || 0) - 1);
  } else if (dist === 0) {
    fb.className      = 'write-feedback correct';
    fb.textContent    = '✓ Correct!';
    $('write-input').classList.add('correct');
    if (real) real.mastery = Math.min(2, (real.mastery || 0) + 1);
  } else if (dist <= 2) {
    fb.className      = 'write-feedback almost';
    fb.textContent    = `Almost! Answer: ${correct}`;
    $('write-input').classList.add('almost');
    if (real) real.mastery = Math.min(1, (real.mastery || 0) + 1);
  } else {
    fb.className      = 'write-feedback wrong';
    fb.textContent    = `✗ Answer: ${correct}`;
    $('write-input').classList.add('wrong');
    if (real) real.mastery = Math.max(0, (real.mastery || 0) - 1);
  }

  saveSets();
  if (activeSet.cards.every(c => c.mastery >= 2)) launchConfetti();
}

function advanceWrite() {
  writeIdx++;
  if (writeIdx >= writeCards.length) {
    toast('All done! Great work 🎉', 'success');
    $('back-btn').classList.remove('hidden');
    showDetail(activeSet);
  } else {
    renderWriteCard();
  }
}

// ── MODAL ─────────────────────────────────────────────────
function openModal(set = null) {
  editingId = set ? set.id : null;
  $('modal-title-text').textContent = set ? 'Edit set' : 'Create set';
  $('set-title-in').value = set ? set.title : '';
  $('set-desc-in').value  = set ? (set.description || '') : '';

  const rows = $('card-editor-rows');
  rows.innerHTML = '';

  const initCards = set
    ? set.cards
    : [{ id: uid('c'), term: '', def: '' }, { id: uid('c'), term: '', def: '' }];
  initCards.forEach(c => addCardRow(c.term, c.def, c.id));

  $('modal-overlay').classList.remove('hidden');
  setTimeout(() => $('set-title-in').focus(), 60);
}

function closeModal() {
  $('modal-overlay').classList.add('hidden');
}

function addCardRow(term = '', def = '', id = null) {
  const cardId = id || uid('c');
  const row    = document.createElement('div');
  row.className   = 'card-row';
  row.dataset.cid = cardId;
  row.innerHTML = `
    <input class="cr-input" placeholder="Term"       value="${esc(term)}"/>
    <input class="cr-input" placeholder="Definition" value="${esc(def)}"/>
    <button class="cr-del" title="Remove">✕</button>
  `;
  row.querySelector('.cr-del').addEventListener('click', () => row.remove());
  $('card-editor-rows').appendChild(row);
  return row;
}

async function saveModal() {
  const title = $('set-title-in').value.trim();
  if (!title) { toast('Please enter a title.', 'error'); return; }

  const existingMastery = editingId
    ? Object.fromEntries((sets.find(s => s.id === editingId)?.cards || []).map(c => [c.id, c.mastery]))
    : {};

  const cards = [...$('card-editor-rows').querySelectorAll('.card-row')]
    .map(r => ({
      id:      r.dataset.cid,
      term:    r.querySelectorAll('.cr-input')[0].value.trim(),
      def:     r.querySelectorAll('.cr-input')[1].value.trim(),
      mastery: existingMastery[r.dataset.cid] || 0
    }))
    .filter(c => c.term || c.def);

  if (!cards.length) { toast('Add at least one card.', 'error'); return; }

  $('modal-save').disabled = true;

  if (editingId) {
    const idx = sets.findIndex(s => s.id === editingId);
    if (idx !== -1) {
      sets[idx] = { ...sets[idx], title, description: $('set-desc-in').value.trim(), cards };
      activeSet  = sets[idx];
    }
  } else {
    const newSet = {
      id: uid('set'), title,
      description:  $('set-desc-in').value.trim(),
      cards,
      createdAt:    Date.now(),
      lastStudied:  null,
      timesStudied: 0
    };
    sets.unshift(newSet);
    logActivity('📚', `Created set: ${title}`);
  }

  await saveSets();
  $('modal-save').disabled = false;
  closeModal();
  toast(editingId ? 'Set updated!' : 'Set created! 🎉', 'success');

  if (editingId) {
    const updated = sets.find(s => s.id === editingId);
    if (updated) showDetail(updated); else showLibrary();
  } else {
    showLibrary();
  }
}

// ── AI GENERATION ──────────────────────────────────────────
let aiCardCount = 20;

$('ai-gen-btn').addEventListener('click', () => {
  $('ai-panel').classList.toggle('open');
  if ($('ai-panel').classList.contains('open')) $('ai-topic').focus();
});

document.querySelectorAll('.ai-count-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.ai-count-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    aiCardCount = Number(pill.dataset.n);
  });
});

$('ai-topic').addEventListener('keydown', e => { if (e.key === 'Enter') runAIGenerate(); });
$('ai-go-btn').addEventListener('click', runAIGenerate);

async function runAIGenerate() {
  const topic = $('ai-topic').value.trim();
  if (!topic) { $('ai-topic').focus(); return; }

  const goBtn = $('ai-go-btn');
  goBtn.textContent = '⏳ Generating…';
  goBtn.disabled    = true;

  try {
    const res = await askAI({
      message: `Generate exactly ${aiCardCount} study flashcards on: "${topic}". Return ONLY a JSON array, no code fences, no markdown:\n[{"term":"...","def":"..."}]\nEach term: 1–5 words. Each def: under 30 words. Plain text only.`,
      history: []
    });

    const raw    = res?.reply ?? (typeof res === 'string' ? res : '');
    const parsed = safeParseJSON(raw);
    if (!Array.isArray(parsed)) throw new Error('Not an array');

    parsed.forEach(c => {
      if (c.term || c.def) addCardRow(cleanText(String(c.term || '')), cleanText(String(c.def || '')));
    });

    if (!$('set-title-in').value.trim())
      $('set-title-in').value = topic.charAt(0).toUpperCase() + topic.slice(1);

    toast(`Added ${parsed.length} cards!`, 'success');
    $('ai-panel').classList.remove('open');
    $('ai-topic').value = '';
  } catch (err) {
    toast('AI generation failed — try again.', 'error');
  }

  goBtn.textContent = 'Generate cards →';
  goBtn.disabled    = false;
}

// ── CONFETTI ───────────────────────────────────────────────
function launchConfetti() {
  const cv = $('confetti-canvas');
  cv.style.display = 'block';
  cv.width  = window.innerWidth;
  cv.height = window.innerHeight;
  const ctx = cv.getContext('2d');

  const COLORS = ['#5ef8a0','#4f8ef7','#f0c060','#ff5f5f','#b0b0c8','#fb7185','#a78bfa'];
  const pieces = Array.from({length: 100}, () => ({
    x: Math.random() * cv.width, y: -10,
    w: Math.random() * 10 + 6, h: Math.random() * 6 + 3,
    r: Math.random() * Math.PI * 2,
    vx: (Math.random() - .5) * 5, vy: Math.random() * 4 + 2,
    vr: (Math.random() - .5) * .18,
    color: COLORS[Math.floor(Math.random() * COLORS.length)]
  }));

  let frame = 0;
  const tick = () => {
    ctx.clearRect(0, 0, cv.width, cv.height);
    pieces.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.r += p.vr; p.vy += .07;
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.r);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, 1 - frame / 160);
      ctx.fillRect(-p.w/2, -p.h/2, p.w, p.h);
      ctx.restore();
    });
    frame++;
    if (frame < 200) requestAnimationFrame(tick);
    else { cv.style.display = 'none'; ctx.clearRect(0, 0, cv.width, cv.height); }
  };
  requestAnimationFrame(tick);
  toast('🎉 Set mastered! Amazing!', 'success');
}

// ── INIT ───────────────────────────────────────────────────
async function init() {
  initStarCanvas($('stars'));
  await loadSets();
  showLibrary();

  // Library buttons
  $('create-btn').onclick        = () => openModal();
  $('empty-create-btn').onclick  = () => openModal();
  $('empty-ai-btn').onclick      = () => { openModal(); setTimeout(() => $('ai-panel').classList.add('open'), 80); };

  // Modal buttons
  $('modal-x').onclick       = closeModal;
  $('modal-cancel').onclick  = closeModal;
  $('modal-save').onclick    = saveModal;
  $('add-card-btn').onclick  = () => addCardRow();
  $('modal-overlay').addEventListener('click', e => {
    if (e.target === $('modal-overlay')) closeModal();
  });
}

init();
