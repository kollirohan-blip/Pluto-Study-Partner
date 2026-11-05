// ── STARS ─────────────────────────────────────────────────────
const sc = document.getElementById('stars-bg');
const sx = sc.getContext('2d');
let stars2=[];
function initStars(){
  sc.width=window.innerWidth; sc.height=window.innerHeight; stars2=[];
  const n=Math.floor(sc.width*sc.height/2500);
  for(let i=0;i<n;i++) stars2.push({x:Math.random()*sc.width,y:Math.random()*sc.height,r:Math.random()<.7?.4:.9+Math.random()*.6,op:.05+Math.random()*.4,spd:.001+Math.random()*.005,ph:Math.random()*Math.PI*2});
}
function drawStars(t){
  sx.clearRect(0,0,sc.width,sc.height);
  for(const s of stars2){const op=s.op*(.4+.6*Math.sin(t*s.spd+s.ph));sx.beginPath();sx.arc(s.x,s.y,s.r,0,Math.PI*2);sx.fillStyle=`rgba(255,255,255,${op})`;sx.fill();}
  requestAnimationFrame(drawStars);
}
initStars(); window.addEventListener('resize',initStars); requestAnimationFrame(drawStars);

// ── STATE ─────────────────────────────────────────────────────
const G = {
  coins:   parseInt(localStorage.getItem('pq_coins')  || '0'),
  xp:      parseInt(localStorage.getItem('pq_xp')     || '0'),
  streak:  parseInt(localStorage.getItem('pq_streak') || '0'),
  gamesPlayed: parseInt(localStorage.getItem('pq_games') || '0'),
  totalCorrect: parseInt(localStorage.getItem('pq_correct') || '0'),
  owned:   JSON.parse(localStorage.getItem('pq_owned') || '["default"]'),
  theme:   localStorage.getItem('pq_theme') || 'default',
  mode:    'mcq',
  questions: [],
  qIdx:    0,
  correct: 0,
  sessionStreak: 0,
  timer:   null,
  timeLeft: 15,
  topic:   ''
};

const SERVER = 'http://localhost:3000/ask-aria';

// ── SHOP ITEMS ────────────────────────────────────────────────
const SHOP = [
  { id:'default', name:'Default',      cost:0,    accent:'#b0b0c8', bg:'#000000',      preview:'#b0b0c8' },
  { id:'ocean',   name:'Deep Ocean',   cost:150,  accent:'#4f8ef7', bg:'#000814',      preview:'#4f8ef7' },
  { id:'forest',  name:'Forest',       cost:150,  accent:'#5ef8a0', bg:'#000a04',      preview:'#5ef8a0' },
  { id:'sunset',  name:'Sunset',       cost:200,  accent:'#f07040', bg:'#0a0400',      preview:'#f07040' },
  { id:'nebula',  name:'Nebula',       cost:300,  accent:'#c060f0', bg:'#060010',      preview:'#c060f0' },
  { id:'gold',    name:'Gold',         cost:500,  accent:'#f0c060', bg:'#0a0800',      preview:'#f0c060' },
];

function applyTheme(id) {
  const item = SHOP.find(s => s.id === id);
  if (!item) return;
  document.documentElement.style.setProperty('--accent', item.accent);
  document.documentElement.style.setProperty('--bg', item.bg);
  document.body.style.background = item.bg;
}

function renderShop() {
  const grid = document.getElementById('shop-grid');
  grid.innerHTML = '';
  SHOP.forEach(item => {
    const div = document.createElement('div');
    const owned = G.owned.includes(item.id);
    const active = G.theme === item.id;
    div.className = 'shop-item' + (owned ? ' owned' : '') + (active ? ' active-theme' : '');
    div.innerHTML = `
      <div class="si-preview" style="background:${item.preview};opacity:.7"></div>
      <div class="si-name">${item.name}</div>
      <div class="${owned ? 'si-owned' : 'si-cost'}">${active ? '✓ Active' : owned ? 'Owned · Equip' : '🪙 '+item.cost}</div>`;
    div.addEventListener('click', () => {
      if (owned) {
        G.theme = item.id;
        localStorage.setItem('pq_theme', item.id);
        applyTheme(item.id);
        renderShop(); updateHeader();
      } else if (G.coins >= item.cost) {
        G.coins -= item.cost;
        G.owned.push(item.id);
        G.theme = item.id;
        localStorage.setItem('pq_coins', G.coins);
        localStorage.setItem('pq_owned', JSON.stringify(G.owned));
        localStorage.setItem('pq_theme', item.id);
        applyTheme(item.id);
        renderShop(); updateHeader();
        showStreakFlash('🎉', item.name + ' unlocked!');
      } else {
        div.style.animation = 'shake .3s ease';
        setTimeout(() => div.style.animation = '', 300);
      }
    });
    grid.appendChild(div);
  });
}

function renderStats() {
  const grid = document.getElementById('stats-grid');
  const lvl = Math.floor(G.xp / 100) + 1;
  const items = [
    { label:'Level', value:'LVL '+lvl, icon:'⚡' },
    { label:'Total XP', value:G.xp+' XP', icon:'🌟' },
    { label:'Coins', value:G.coins+'🪙', icon:'🪙' },
    { label:'Best Streak', value:G.streak+'🔥', icon:'🔥' },
    { label:'Games Played', value:G.gamesPlayed, icon:'🎮' },
    { label:'Total Correct', value:G.totalCorrect, icon:'✓' },
  ];
  grid.innerHTML = items.map(i => `
    <div style="background:var(--s1);border:1px solid var(--b1);border-radius:12px;padding:14px;text-align:center">
      <div style="font-size:20px;margin-bottom:6px">${i.icon}</div>
      <div style="font-size:18px;font-weight:600;color:#fff;font-family:'DM Mono',monospace">${i.value}</div>
      <div style="font-size:10px;color:var(--mid);margin-top:3px">${i.label}</div>
    </div>`).join('');
}

// ── HOME TABS ─────────────────────────────────────────────────
document.querySelectorAll('.ht-tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.ht-tab').forEach(x=>x.classList.remove('active'));
    document.querySelectorAll('.ht-panel').forEach(x=>x.classList.remove('active'));
    t.classList.add('active');
    document.getElementById('ht-'+t.dataset.ht).classList.add('active');
    if (t.dataset.ht === 'shop') renderShop();
    if (t.dataset.ht === 'stats') renderStats();
  });
});

// ── MODE SELECT ───────────────────────────────────────────────
function selectMode(mode) {
  G.mode = mode;
  document.querySelectorAll('.mode-card').forEach(c => c.style.border='1px solid var(--b1)');
  document.getElementById('mode-'+mode).style.border = '1px solid var(--accent)';
}
selectMode('mcq');

// Strip markdown symbols from AI-generated text
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

// Robust JSON extractor — handles code fences and bad escape sequences
function safeParseJSON(text) {
  // Strip markdown code fences
  text = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '');
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error('No JSON array in response');
  let json = text.slice(start, end + 1);
  // Try direct parse first
  try { return JSON.parse(json); } catch (_) {}
  // Sanitize unescaped newlines/tabs that appear inside string values
  json = json.replace(/"(?:[^"\\]|\\.)*"/g, m =>
    m.replace(/\n/g, '\\n').replace(/\r/g, '').replace(/\t/g, '\\t')
  );
  return JSON.parse(json);
}

// ── GENERATE ──────────────────────────────────────────────────
async function generateGame() {
  const topic = document.getElementById('topic-input').value.trim();
  if (!topic) { document.getElementById('topic-input').focus(); return; }
  G.topic = topic;
  G.questions = [];

  showScreen('loading-screen');
  document.getElementById('loading-text').textContent = `Generating ${G.mode} questions on "${topic}"...`;

  try {
    let prompt = '';
    if (G.mode === 'mcq') {
      prompt = `Generate 10 multiple choice quiz questions about: "${topic}". Use plain text only — no asterisks, no markdown, no bold, no headers.
Return ONLY a raw JSON array, no code fences, no preamble:
[{"q":"question text","choices":["Choice A","Choice B","Choice C","Choice D"],"answer":0,"explanation":"plain text explanation"}]`;
    } else if (G.mode === 'tf') {
      prompt = `Generate 10 true/false questions about: "${topic}". Use plain text only — no asterisks, no markdown.
Return ONLY a raw JSON array, no code fences:
[{"q":"statement text","answer":true,"explanation":"plain text explanation"}]`;
    } else {
      prompt = `Generate 10 flashcards about: "${topic}". Use plain text only — no asterisks, no markdown.
Return ONLY a raw JSON array, no code fences:
[{"term":"term or concept","def":"clear plain-text definition"}]`;
    }

    const res = await fetch(SERVER, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        message: prompt,
        profile: {name:'GameBot', grade:'Student', course: topic},
        pageContext:{url:location.href,title:'Pluto Quest',text:''},
        history:[], tutorMode:false
      })
    });
    const d = await res.json();
    G.questions = safeParseJSON(d.reply);
    G.qIdx = 0; G.correct = 0; G.sessionStreak = 0;
    startGame();
  } catch (err) {
    showScreen('home-screen');
    alert('Failed to generate questions. Error: ' + err.message);
  }
}

// ── GAME ──────────────────────────────────────────────────────
function startGame() {
  showScreen('game-screen');
  renderQuestion();
}

function renderQuestion() {
  const q = G.questions[G.qIdx];
  if (!q) { endGame(); return; }

  const total = G.questions.length;
  document.getElementById('q-counter').textContent = `Q${G.qIdx+1}/${total}`;
  document.getElementById('prog-fill').style.width = `${(G.qIdx/total)*100}%`;
  document.getElementById('question-text').textContent = cleanText(G.mode === 'flash' ? q.term : q.q);

  document.getElementById('feedback-box').className = 'feedback-box';
  document.getElementById('next-btn').className = 'next-btn';

  document.getElementById('choices-grid').style.display  = G.mode === 'mcq'   ? 'grid' : 'none';
  document.getElementById('tf-grid').style.display       = G.mode === 'tf'    ? 'grid' : 'none';
  document.getElementById('flash-card').style.display    = G.mode === 'flash' ? 'block' : 'none';
  document.getElementById('flash-grade').style.display   = G.mode === 'flash' ? 'flex' : 'none';

  if (G.mode === 'mcq') renderMCQ(q);
  if (G.mode === 'tf')  renderTF(q);
  if (G.mode === 'flash') renderFlash(q);

  startTimer(G.mode === 'flash' ? 30 : 15);
}

function renderMCQ(q) {
  const grid = document.getElementById('choices-grid');
  grid.innerHTML = '';
  const letters = ['A','B','C','D'];
  q.choices.forEach((c, i) => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.innerHTML = `<span class="choice-letter">${letters[i]}</span>${cleanText(c)}`;
    btn.addEventListener('click', () => answerMCQ(i, q));
    grid.appendChild(btn);
  });
}

function answerMCQ(idx, q) {
  clearTimer();
  const btns = document.querySelectorAll('.choices-grid .choice-btn');
  btns.forEach(b => b.disabled = true);
  const correct = idx === q.answer;

  btns[q.answer].classList.add('correct');
  if (!correct) btns[idx].classList.add('wrong');

  showFeedback(correct, cleanText(q.explanation || (correct ? 'Correct!' : `Answer: ${q.choices[q.answer]}`)));
  recordAnswer(correct);
}

function renderTF(q) {
  document.querySelectorAll('.tf-btn').forEach(b => { b.disabled = false; b.className = b.classList.contains('true-btn') ? 'tf-btn true-btn' : 'tf-btn false-btn'; });
}

function answerTF(answer) {
  clearTimer();
  const q = G.questions[G.qIdx];
  const correct = answer === q.answer;
  document.querySelectorAll('.tf-btn').forEach(b => b.disabled = true);
  const trueBtn  = document.querySelector('.true-btn');
  const falseBtn = document.querySelector('.false-btn');
  if (q.answer) trueBtn.classList.add('correct'); else falseBtn.classList.add('correct');
  if (!correct) (answer ? trueBtn : falseBtn).classList.add('wrong');
  showFeedback(correct, cleanText(q.explanation || (correct ? '✓ Correct!' : `✗ It's ${q.answer ? 'True' : 'False'}`)));
  recordAnswer(correct);
}

function renderFlash(q) {
  document.getElementById('flash-card').classList.remove('flipped');
  document.getElementById('flash-front-text').textContent = cleanText(q.term);
  document.getElementById('flash-back-text').textContent  = cleanText(q.def);
}

function gradeFlash(correct) {
  clearTimer();
  recordAnswer(correct);
  showFeedback(correct, correct ? 'Got it! +' + coinReward(correct) + ' coins' : 'Keep practicing!');
}

function coinReward(correct) { return correct ? 10 + G.sessionStreak * 2 : 2; }

function recordAnswer(correct) {
  if (correct) {
    G.correct++;
    G.sessionStreak++;
    G.totalCorrect++;
    if (G.sessionStreak > G.streak) G.streak = G.sessionStreak;
    if (G.sessionStreak >= 3) showStreakFlash(G.sessionStreak+'🔥', 'STREAK BONUS!');
  } else {
    G.sessionStreak = 0;
  }
  localStorage.setItem('pq_streak',  G.streak);
  localStorage.setItem('pq_correct', G.totalCorrect);
  updateHeader();
}

function showFeedback(correct, text) {
  const fb = document.getElementById('feedback-box');
  fb.textContent = (correct ? '✓ ' : '✗ ') + text;
  fb.className = 'feedback-box show ' + (correct ? 'correct' : 'wrong');
  document.getElementById('next-btn').className = 'next-btn show';
}

function nextQuestion() {
  G.qIdx++;
  if (G.qIdx >= G.questions.length) endGame();
  else renderQuestion();
}

function endGame() {
  clearTimer();
  const total  = G.questions.length;
  const pct    = Math.round(G.correct / total * 100);
  const coins  = G.correct * 10 + (pct === 100 ? 50 : pct >= 80 ? 25 : 0) + G.sessionStreak * 5;
  const xp     = G.correct * 20 + (pct >= 80 ? 50 : 0);

  G.coins += coins; G.xp += xp; G.gamesPlayed++;
  localStorage.setItem('pq_coins',  G.coins);
  localStorage.setItem('pq_xp',     G.xp);
  localStorage.setItem('pq_games',  G.gamesPlayed);
  updateHeader();

  const titles = { 100:'Perfect Score! 🏆', 80:'Great Job! ⭐', 60:'Good effort! 👍', 0:'Keep practicing! 💪' };
  const titleKey = Object.keys(titles).reverse().find(k => pct >= parseInt(k));

  document.getElementById('res-pct').textContent    = pct + '%';
  document.getElementById('res-title').textContent  = titles[titleKey];
  document.getElementById('res-sub').textContent    = `${G.correct}/${total} correct · ${G.sessionStreak}🔥 best streak`;
  document.getElementById('res-coins').textContent  = '+' + coins;
  document.getElementById('res-xp').textContent     = '+' + xp;
  document.getElementById('res-streak').textContent = G.sessionStreak + '🔥';

  showScreen('results-screen');
}

function playAgain() {
  G.qIdx = 0; G.correct = 0; G.sessionStreak = 0;
  G.questions = [];
  showScreen('home-screen');
}

// ── TIMER ─────────────────────────────────────────────────────
function startTimer(secs) {
  clearTimer();
  G.timeLeft = secs;
  updateTimerUI();
  G.timer = setInterval(() => {
    G.timeLeft--;
    updateTimerUI();
    if (G.timeLeft <= 0) {
      clearTimer();
      if (G.mode !== 'flash') {
        showFeedback(false, "Time's up!");
        recordAnswer(false);
      }
    }
  }, 1000);
}

function clearTimer() { clearInterval(G.timer); }

function updateTimerUI() {
  const max = G.mode === 'flash' ? 30 : 15;
  const pct = G.timeLeft / max;
  const circ = 113;
  document.getElementById('timer-circle').style.strokeDashoffset = circ * (1 - pct);
  document.getElementById('timer-text').textContent = G.timeLeft;
  document.getElementById('timer-circle').style.stroke =
    G.timeLeft <= 5 ? 'var(--red)' : G.timeLeft <= 8 ? 'var(--gold)' : 'var(--accent)';
}

// ── UI HELPERS ────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function updateHeader() {
  document.getElementById('hdr-coins').textContent  = G.coins;
  document.getElementById('hdr-xp').textContent     = G.xp + ' XP';
  document.getElementById('hdr-streak').textContent = G.streak;
}

function showStreakFlash(val, label) {
  const el = document.getElementById('streak-flash');
  document.getElementById('sf-val').textContent   = val;
  document.getElementById('sf-label').textContent = label || 'STREAK!';
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1500);
}

// ── INIT ──────────────────────────────────────────────────────
applyTheme(G.theme);
updateHeader();

// ── EVENT BINDINGS (CSP-safe, replaces inline onclick) ─────────
document.getElementById('generate-btn').addEventListener('click', generateGame);
document.getElementById('mode-mcq').addEventListener('click', () => selectMode('mcq'));
document.getElementById('mode-tf').addEventListener('click',  () => selectMode('tf'));
document.getElementById('mode-flash').addEventListener('click',() => selectMode('flash'));
document.querySelector('.true-btn').addEventListener('click',  () => answerTF(true));
document.querySelector('.false-btn').addEventListener('click', () => answerTF(false));
document.getElementById('flash-card').addEventListener('click',function(){ this.classList.toggle('flipped'); });
document.getElementById('btn-again').addEventListener('click', () => gradeFlash(false));
document.getElementById('btn-got').addEventListener('click',   () => gradeFlash(true));
document.getElementById('next-btn').addEventListener('click',  nextQuestion);
document.getElementById('btn-home').addEventListener('click',  () => showScreen('home-screen'));
document.getElementById('btn-play-again').addEventListener('click', playAgain);
