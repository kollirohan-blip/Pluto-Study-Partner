import { initStarCanvas, askAI, storage, toast, logActivity, requirePremium } from './pluto-shared.js';

// Renders $...$ (inline) and $$...$$ (display) LaTeX in any DOM element.
function renderMath(el) {
  if (!el || typeof katex === 'undefined') return;
  const html = el.innerHTML;
  // Decode HTML entities that textContent encoding puts inside LaTeX expressions
  // (e.g. < becomes &lt; which KaTeX renders as a red error)
  const decodeExpr = s => s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"');
  let result = html.replace(/\$\$([^$]+)\$\$/g, (_, expr) => {
    try { return katex.renderToString(decodeExpr(expr.trim()), { displayMode: true, throwOnError: false }); }
    catch { return _; }
  });
  result = result.replace(/\$([^$\n]+)\$/g, (_, expr) => {
    try { return katex.renderToString(decodeExpr(expr.trim()), { displayMode: false, throwOnError: false }); }
    catch { return _; }
  });
  if (result !== html) el.innerHTML = result;
}

const AP_EXAMS = [
  { id:'ap-bio',   slug:'ap-biology',                     system:'ap',  name:'AP Biology',        meta:'45 MC - 6 FRQ',  icon:'🧬', n:10, subject:'AP Biology' },
  { id:'ap-chem',  slug:'ap-chemistry',                   system:'ap',  name:'AP Chemistry',      meta:'60 MC - 7 FRQ',  icon:'⚗️', n:10, subject:'AP Chemistry' },
  { id:'ap-phys1', slug:'ap-physics-1',                   system:'ap',  name:'AP Physics 1',      meta:'50 MC - 5 FRQ',  icon:'⚡', n:10, subject:'AP Physics 1' },
  { id:'ap-calc',  slug:'ap-calculus-ab',                 system:'ap',  name:'AP Calculus AB',    meta:'45 MC - 6 FRQ',  icon:'∫',  n:10, subject:'AP Calculus AB' },
  { id:'ap-stats', slug:'ap-statistics',                  system:'ap',  name:'AP Statistics',     meta:'40 MC - 6 FRQ',  icon:'📊', n:10, subject:'AP Statistics' },
  { id:'ap-ush',   slug:'ap-us-history',                  system:'ap',  name:'AP US History',     meta:'55 MC - 3 LEQ',  icon:'🏛️', n:10, subject:'AP US History' },
  { id:'ap-wh',    slug:'ap-world-history',               system:'ap',  name:'AP World History',  meta:'55 MC - 3 LEQ',  icon:'🌍', n:10, subject:'AP World History' },
  { id:'ap-gov',   slug:'ap-us-government',               system:'ap',  name:'AP Gov & Politics', meta:'55 MC - 4 FRQ',  icon:'⚖️', n:10, subject:'AP US Government and Politics' },
  { id:'ap-eng',   slug:'ap-english-language',            system:'ap',  name:'AP English Lang',   meta:'45 MC - 3 FRQ',  icon:'📝', n:10, subject:'AP English Language and Composition' },
  { id:'ap-cs',    slug:'ap-computer-science-principles', system:'ap',  name:'AP CS Principles',  meta:'70 MC - 4 FRQ',  icon:'💻', n:10, subject:'AP Computer Science Principles' },
  { id:'sat-read', slug:null,                             system:'sat', name:'SAT Reading',       meta:'52q / 65 min',   icon:'📖', n:10, subject:'SAT Reading and Writing' },
  { id:'sat-math', slug:null,                             system:'sat', name:'SAT Math',          meta:'58q / 80 min',   icon:'🔢', n:10, subject:'SAT Math' },
  { id:'act-sci',  slug:null,                             system:'act', name:'ACT Science',       meta:'40q / 35 min',   icon:'🔬', n:10, subject:'ACT Science' },
  { id:'act-math', slug:null,                             system:'act', name:'ACT Math',          meta:'60q / 60 min',   icon:'📐', n:10, subject:'ACT Math' },
];

let sets = [], activeSet = null, questions = [], answers = [], flagged = [];
let currentQ = 0, timerSecs = 0, timeLimitS = 0, timerHandle = null, testTitle = '';
let cfg = { types: new Set(['mc','tf','written']), qCount: 10, timeMin: 10 };
let examSystem = null, examCourse = null, examMode = 'quick'; // set from ?hub= URL param

function $(id) { return document.getElementById(id); }

const VIEWS = ['view-picker','view-config','view-ap-picker','view-mode-picker','view-frq','view-generating','view-test','view-results'];
const FLEX_VIEWS = new Set(['view-test', 'view-generating']);
function showOnly(id) {
  VIEWS.forEach(v => {
    const el = $(v);
    if (!el) return;
    if (v === id) {
      el.style.display = FLEX_VIEWS.has(v) ? 'flex' : 'block';
    } else {
      el.style.display = 'none';
    }
  });
}

async function init() {
  if (!await requirePremium('Practice Test')) return;
  initStarCanvas($('stars'));
  const { plutoSets = [] } = await storage.get('plutoSets');
  sets = plutoSets;

  const params = new URLSearchParams(window.location.search);
  const setId  = params.get('set');
  const mode   = params.get('mode');
  const hub    = params.get('hub');

  // Determine exam system from hub param so standards can be retrieved per question
  if (hub) {
    if (hub === 'sat') { examSystem = 'sat'; examCourse = null; }
    else if (hub === 'act') { examSystem = 'act'; examCourse = null; }
    else if (hub.startsWith('ap-')) { examSystem = 'ap'; examCourse = hub; }
    else { examSystem = 'ib'; examCourse = null; } // IB / GCSE / A-Level → AI-aligned
  }

  if (mode) {
    const exam = AP_EXAMS.find(e => e.id === mode);
    if (exam) { startAPMock(exam); return; }
  }
  if (setId) {
    const found = sets.find(s => s.id === setId);
    if (found) { openConfigurator(found); return; }
    toast('Set not found.', 'error');
  }

  showOnly('view-picker');
  buildAPGrid(); // async — grid populates while user reads mode picker
  $('mode-set').addEventListener('click', () => openConfigurator(null));
  $('mode-ap').addEventListener('click',  () => showOnly('view-ap-picker'));
  $('mode-frq').addEventListener('click', () => showOnly('view-frq'));
}

function openConfigurator(set) {
  activeSet = set;
  showOnly('view-config');
  if (set) {
    $('cfg-set-title').textContent = set.title;
    $('cfg-set-picker').style.display = 'none';
  } else {
    $('cfg-set-title').textContent = 'Configure test';
    buildSetPicker();
  }

  $('q-minus').onclick = () => { cfg.qCount = Math.max(3,  cfg.qCount-1); $('cfg-q-val').textContent = cfg.qCount; };
  $('q-plus').onclick  = () => { cfg.qCount = Math.min(50, cfg.qCount+1); $('cfg-q-val').textContent = cfg.qCount; };

  document.querySelectorAll('.cfg-chip[data-type]').forEach(chip => {
    chip.addEventListener('click', () => {
      chip.classList.toggle('active');
      const t = chip.dataset.type;
      cfg.types.has(t) ? cfg.types.delete(t) : cfg.types.add(t);
    });
  });
  document.querySelectorAll('.cfg-chip[data-time]').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.cfg-chip[data-time]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      cfg.timeMin = parseInt(chip.dataset.time);
    });
  });

  $('start-set-test').onclick = () => {
    if (!activeSet) { toast('Pick a set first.', 'error'); return; }
    if (cfg.types.size === 0) { toast('Select at least one question type.', 'error'); return; }
    generateSetTest();
  };
  $('cfg-back').onclick = () => showOnly('view-picker');
}

function buildSetPicker() {
  const container = $('cfg-set-picker');
  container.style.display = '';
  if (!sets.length) { container.innerHTML = '<div style="color:rgba(255,255,255,.3);font-size:13px">No sets yet.</div>'; return; }
  container.innerHTML = '<div class="config-label">SELECT A SET</div>';
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px';
  sets.forEach(s => {
    const chip = document.createElement('div');
    chip.className = 'cfg-chip';
    chip.textContent = s.title;
    chip.addEventListener('click', () => {
      row.querySelectorAll('.cfg-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      activeSet = s;
      $('cfg-set-title').textContent = s.title;
    });
    row.appendChild(chip);
  });
  container.appendChild(row);
}

const CATEGORY_ORDER = ['Science','Math','History','Social Studies','English','World Languages','CS','Arts','Capstone'];
const CATEGORY_ICONS = { Science:'🔬', Math:'∑', History:'🏛', 'Social Studies':'🌐', English:'📝', 'World Languages':'🌍', CS:'💻', Arts:'🎨', Capstone:'🎓' };

async function buildAPGrid() {
  const grid = $('ap-grid');
  grid.innerHTML = '<div style="color:rgba(255,255,255,.3);font-size:13px;padding:12px">Loading courses…</div>';

  let apCourses = [];
  try {
    const r = await fetch('https://pluto-server-production.up.railway.app/courses');
    const data = await r.json();
    apCourses = data.ap || [];
  } catch {
    // fallback: derive from AP_EXAMS
    apCourses = AP_EXAMS.filter(e => e.system === 'ap').map(e => ({
      slug: e.slug, name: e.name, shortName: e.name, category: 'Science'
    }));
  }

  grid.innerHTML = '';
  let cardIndex = 0;

  // AP courses grouped by category
  for (const cat of CATEGORY_ORDER) {
    const courses = apCourses.filter(c => c.category === cat);
    if (!courses.length) continue;

    const section = document.createElement('div');
    section.className = 'ap-category-section';

    const label = document.createElement('div');
    label.className = 'ap-category-label';
    label.textContent = (CATEGORY_ICONS[cat] || '') + ' ' + cat.toUpperCase();
    section.appendChild(label);

    const row = document.createElement('div');
    row.className = 'ap-category-row';
    courses.forEach(c => {
      const card = document.createElement('div');
      card.className = 'ap-card';
      card.style.animationDelay = (cardIndex++ * 25) + 'ms';
      card.title = c.name;
      card.innerHTML = '<div class="ap-card-name">' + esc(c.shortName) + '</div>';
      card.addEventListener('click', () => startAPMock({
        id: c.slug, slug: c.slug, system: 'ap',
        name: c.name, n: 10, subject: c.name,
      }));
      row.appendChild(card);
    });
    section.appendChild(row);
    grid.appendChild(section);
  }

  // SAT / ACT section
  const satActCourses = AP_EXAMS.filter(e => e.system === 'sat' || e.system === 'act');
  if (satActCourses.length) {
    const section = document.createElement('div');
    section.className = 'ap-category-section';
    const label = document.createElement('div');
    label.className = 'ap-category-label';
    label.textContent = '📊 STANDARDIZED TESTS';
    section.appendChild(label);
    const row = document.createElement('div');
    row.className = 'ap-category-row';
    satActCourses.forEach((exam, i) => {
      const card = document.createElement('div');
      card.className = 'ap-card';
      card.style.animationDelay = (cardIndex++ * 25) + 'ms';
      card.innerHTML = '<div class="ap-card-name">' + esc(exam.name) + '</div><div class="ap-card-meta">' + esc(exam.meta) + '</div>';
      card.addEventListener('click', () => startAPMock(exam));
      row.appendChild(card);
    });
    section.appendChild(row);
    grid.appendChild(section);
  }

  $('ap-back').onclick = () => showOnly('view-picker');
}

async function generateSetTest() {
  showGenerating('Generating your test…');
  const cards = activeSet.cards;
  const count = Math.min(cfg.qCount, cards.length * 3);
  testTitle = activeSet.title;
  const types = [...cfg.types].join(', ');

  const prompt = 'Generate a practice test from these flashcard pairs:\n'
    + cards.map(c => 'Term: "' + c.term + '" — Def: "' + c.def + '"').join('\n')
    + '\n\nCreate exactly ' + count + ' questions. Use these types: ' + types + '.'
    + '\n- mc: 4 choices, one correct (index 0-3)'
    + '\n- tf: True/False question, correct is true or false'
    + '\n- written: short answer'
    + '\nReturn ONLY a JSON array:\n[{"type":"mc","q":"...","choices":["A. ...","B. ...","C. ...","D. ..."],"correct":0,"topic":"...","explanation":"..."},{"type":"tf","q":"...","correct":true,"topic":"...","explanation":"..."},{"type":"written","q":"...","answer":"...","topic":"...","explanation":"..."}]';

  try {
    const res = await askAI({ message: prompt, history: [] });
    const raw = res && res.reply ? res.reply : (typeof res === 'string' ? res : '');
    questions = safeParseJSON(raw);
    if (!questions || !questions.length) throw new Error('empty');
  } catch { toast('Generation failed — try again.', 'error'); showOnly('view-config'); return; }

  answers = Array(questions.length).fill(null);
  flagged = Array(questions.length).fill(false);
  timeLimitS = cfg.timeMin * 60;
  startTestUI();
}

// Fetch questions from /generate-test (standards-aware) with cache + fallback.
async function fetchGeneratedTest(exam, forceRegen = false, mode = 'quick', modeN = null) {
  // Full exams are never cached (too large + unique each time)
  const cacheKey = 'pluto_test_' + exam.id + '_' + mode;

  if (!forceRegen && mode !== 'full') {
    try {
      const cached = await storage.get(cacheKey);
      if (cached[cacheKey]?.length) return cached[cacheKey];
    } catch { /* cache miss — fall through */ }
  }

  // Try standards-aware server endpoint first
  try {
    const r = await fetch('https://pluto-server-production.up.railway.app/generate-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ course: exam.slug, system: exam.system, mode, n: modeN }),
    });
    const data = await r.json();
    if (data.success && data.questions?.length) {
      await storage.set({ [cacheKey]: data.questions });
      return data.questions;
    }
  } catch { /* server down or busy — fall through */ }

  // Fallback: generic AI generation via existing askAI proxy
  const fallbackN = mode === 'full' ? 50 : (modeN || exam.n || 10);
  const prompt = 'Create a realistic ' + exam.subject + ' practice test. Generate exactly ' + fallbackN + ' multiple-choice questions matching actual exam format, vocabulary, and difficulty. Diverse topics. Use LaTeX ($...$) for any math. For science/history courses include a "stimulus" field (brief graph/table/passage description) for ~50% of questions; set null for standalone questions.'
    + '\nReturn ONLY a JSON array:\n[{"type":"mc","stimulus":null,"q":"...","choices":["A. ...","B. ...","C. ...","D. ..."],"correct":0,"topic":"...","explanation":"...","standards":[],"standardsDetail":[]}]';
  const res = await askAI({ message: prompt, history: [] });
  const raw = res && res.reply ? res.reply : (typeof res === 'string' ? res : '');
  const qs = safeParseJSON(raw);
  if (!qs?.length) throw new Error('Generation failed');
  // Ensure standardsDetail exists so the rest of the code can reference it safely
  qs.forEach(q => { if (!q.standardsDetail) q.standardsDetail = []; });
  await storage.set({ [cacheKey]: qs });
  return qs;
}

function startAPMock(exam) {
  examSystem = exam.system;
  examCourse = exam.slug;
  showModePicker(exam);
}

async function showModePicker(exam) {
  showOnly('view-mode-picker');
  $('mode-exam-eyebrow').textContent = exam.name;
  $('mode-back').onclick = () => showOnly('view-ap-picker');

  const noExamEl  = $('mode-no-exam');
  const cardsWrap = $('mode-cards-wrap');
  noExamEl.classList.add('hidden');
  cardsWrap.innerHTML = '<div style="color:rgba(255,255,255,.3);font-size:13px">Loading…</div>';

  // Fetch exam config from server
  let cfg = null;
  try {
    const r = await fetch('https://pluto-server-production.up.railway.app/exam-config?course=' + (exam.slug || ''));
    const data = await r.json();
    cfg = data.config;
  } catch { /* offline — show quick only */ }

  cardsWrap.innerHTML = '';

  // Courses with no traditional exam
  if (cfg && cfg.mcq === 0) {
    noExamEl.textContent = cfg.note || 'This AP course does not have a traditional written exam.';
    noExamEl.classList.remove('hidden');
    return;
  }

  const modes = [
    {
      mode: 'quick',
      title: 'Quick Practice',
      stat: '10 questions · ~15 min',
      desc: 'Fast review anchored to real CED standards.',
    },
    {
      mode: 'full',
      title: 'Full Mock Exam',
      stat: cfg ? `${cfg.mcq} questions · ${cfg.mcqMin} min` : '50 questions · ~90 min',
      desc: 'Matches real AP exam length and distribution.',
      warn: '⏱ Generates in ~30–60 seconds',
    },
    {
      mode: 'topic',
      title: 'Topic Focus',
      stat: '15 questions · ~25 min',
      desc: 'Drill one area in depth.',
    },
  ];

  // For SAT/ACT, only show quick + topic
  const visibleModes = (exam.system === 'ap') ? modes : modes.filter(m => m.mode !== 'full');

  visibleModes.forEach((m, i) => {
    const card = document.createElement('div');
    card.className = 'exam-mode-card';
    card.style.animationDelay = i * 60 + 'ms';
    card.innerHTML =
      `<div class="exam-mode-title">${esc(m.title)}</div>` +
      `<div class="exam-mode-stat">${esc(m.stat)}</div>` +
      `<div class="exam-mode-desc">${esc(m.desc)}</div>` +
      (m.warn ? `<div class="exam-mode-warn">${esc(m.warn)}</div>` : '');
    card.addEventListener('click', () => launchExam(exam, m.mode));
    cardsWrap.appendChild(card);
  });
}

async function launchExam(exam, mode) {
  examMode = mode;
  testTitle = exam.name;
  const modeN = mode === 'full' ? null : mode === 'topic' ? 15 : 10;
  showGenerating('Generating ' + exam.name + ' practice test…');

  try {
    questions = await fetchGeneratedTest(exam, false, mode, modeN);
  } catch {
    toast('Generation failed — try again.', 'error');
    showOnly('view-mode-picker');
    return;
  }

  answers = Array(questions.length).fill(null);
  flagged = Array(questions.length).fill(false);
  timeLimitS = 0;
  logActivity('🎓', 'AP mock: ' + exam.name + ' (' + mode + ')');
  startTestUI(exam);
}

function startTestUI(exam = null) {
  showOnly('view-test');
  $('test-title').textContent = testTitle.toUpperCase();
  currentQ = 0;
  buildNavGrid();
  renderQuestion();
  startTimer();


  // Show "↻ New test" only for AP/SAT/ACT mocks (cached tests)
  const regenBtn = $('regen-btn');
  if (exam) {
    regenBtn.classList.remove('hidden');
    regenBtn.onclick = async () => {
      regenBtn.disabled = true;
      regenBtn.textContent = '↻ Generating…';
      try {
        questions = await fetchGeneratedTest(exam, true, examMode, examMode === 'full' ? null : examMode === 'topic' ? 15 : 10);
        answers = Array(questions.length).fill(null);
        flagged = Array(questions.length).fill(false);
        currentQ = 0;
        buildNavGrid();
        renderQuestion();
        startTimer();
      } catch { toast('Regeneration failed.', 'error'); }
      regenBtn.disabled = false;
      regenBtn.textContent = '↻ New test';
    };
  } else {
    regenBtn.classList.add('hidden');
  }

  $('submit-btn').onclick     = confirmSubmit;
  $('nav-submit-btn').onclick = confirmSubmit;
  $('prev-btn').onclick = () => { closeNav(); if (currentQ > 0) { currentQ--; renderQuestion(); } };
  $('next-btn').onclick = () => { closeNav(); if (currentQ < questions.length-1) { currentQ++; renderQuestion(); } };
  $('mark-review-btn').onclick = () => {
    flagged[currentQ] = !flagged[currentQ];
    $('mark-review-btn').classList.toggle('marked', flagged[currentQ]);
    updateNavDot(currentQ);
  };
  $('nav-toggle').onclick  = openNav;
  $('nav-overlay').onclick = closeNav;
}

// ── Wikipedia image lookup (proxied through server to bypass extension CSP) ───
const _wikiImgCache = new Map();

async function fetchWikipediaImage(stimText) {
  if (_wikiImgCache.has(stimText)) return _wikiImgCache.get(stimText);
  try {
    const r = await fetch(`https://pluto-server-production.up.railway.app/wiki-image?stim=${encodeURIComponent(stimText)}`);
    const { url, title } = await r.json();
    if (url) {
      console.log('[Wiki] image:', title, url);
      _wikiImgCache.set(stimText, url); // only cache successes so failures retry on next nav
    }
    return url || null;
  } catch (err) {
    console.warn('[Wiki] proxy failed:', err.message);
    return null;
  }
}

function renderQuestion() {
  const q   = questions[currentQ];
  const ans = answers[currentQ];
  $('test-q-label').textContent = 'QUESTION ' + (currentQ+1) + ' OF ' + questions.length;

  // Stimulus block
  const stimEl = $('test-stimulus');
  const stimText = (q.stimulus && q.stimulus !== 'null' && q.stimulus !== '...or null') ? q.stimulus : null;
  console.log('[renderQuestion] Q' + (currentQ + 1) + ' q.stimulus raw:', q.stimulus, '→ using:', stimText);
  if (stimText) {
    stimEl.innerHTML = '';
    const textDiv = document.createElement('div');
    textDiv.className = 'stim-text';
    textDiv.textContent = stimText;
    stimEl.appendChild(textDiv);
    renderMath(textDiv);
    stimEl.style.display = '';

    // Show spinner while image loads; swap it for the real image when ready
    const loader = document.createElement('div');
    loader.className = 'stim-loading';
    stimEl.insertBefore(loader, textDiv);

    fetchWikipediaImage(stimText).then(imgUrl => {
      loader.remove();
      if (!imgUrl || stimEl.style.display === 'none') return;
      const img = document.createElement('img');
      img.className = 'stim-img';
      img.alt = 'Figure';
      img.onerror = () => img.remove();
      img.src = imgUrl;
      stimEl.insertBefore(img, textDiv);
    });
  } else {
    stimEl.style.display = 'none';
  }

  $('test-q-text').textContent  = q.q;
  $('mark-review-btn').classList.toggle('marked', flagged[currentQ]);
  $('prev-btn').disabled = currentQ === 0;
  $('next-btn').disabled = currentQ === questions.length-1;

  const area = $('test-answer-area');
  area.innerHTML = '';

  if (q.type === 'mc') {
    const wrap = document.createElement('div');
    wrap.className = 'test-choices';
    q.choices.forEach((choice, i) => {
      const btn = document.createElement('button');
      btn.className = 'test-choice' + (ans === i ? ' selected' : '');
      btn.textContent = choice;
      btn.addEventListener('click', () => {
        answers[currentQ] = i;
        area.querySelectorAll('.test-choice').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        updateNavDot(currentQ);
      });
      wrap.appendChild(btn);
    });
    area.appendChild(wrap);
  } else if (q.type === 'tf') {
    const row = document.createElement('div');
    row.className = 'test-tf-row';
    ['True','False'].forEach((label, i) => {
      const val = i === 0;
      const btn = document.createElement('button');
      btn.className = 'test-tf-btn' + (ans === val ? ' selected' : '');
      btn.textContent = label;
      btn.addEventListener('click', () => {
        answers[currentQ] = val;
        row.querySelectorAll('.test-tf-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        updateNavDot(currentQ);
      });
      row.appendChild(btn);
    });
    area.appendChild(row);
  } else if (q.type === 'written') {
    const wrap = document.createElement('div');
    wrap.className = 'test-written-wrap';
    const ta = document.createElement('textarea');
    ta.className = 'test-written-input';
    ta.placeholder = 'Write your answer…';
    ta.value = ans || '';
    ta.addEventListener('input', () => { answers[currentQ] = ta.value; updateNavDot(currentQ); });
    wrap.appendChild(ta);
    area.appendChild(wrap);
  }

  updateNavDot(currentQ);

  // Render LaTeX in question text and answer choices
  renderMath($('test-q-text'));
  area.querySelectorAll('.test-choice, .test-tf-btn').forEach(el => renderMath(el));

  // Standards strip — only when launched from a hub
  const stdArea = $('test-standards-area');
  stdArea.innerHTML = '';
  if (examSystem) {
    const strip = document.createElement('div');
    strip.className = 'q-standards';
    strip.innerHTML = `
      <div class="q-standards-label">📐 STANDARDS COVERED</div>
      <div class="q-standards-list"><span style="font-size:11px;color:rgba(255,255,255,.2)">Loading…</span></div>
      <div class="q-standards-sources"></div>
    `;
    stdArea.appendChild(strip);
    renderStandardsForQuestion(strip, q.q, examSystem, examCourse, q.standardsDetail || []);
  }
}

function buildNavGrid() {
  const grid = $('nav-grid');
  grid.innerHTML = '';
  questions.forEach((_, i) => {
    const dot = document.createElement('div');
    dot.className = 'nav-dot';
    dot.id = 'nav-dot-' + i;
    dot.textContent = i+1;
    dot.addEventListener('click', () => { currentQ = i; renderQuestion(); closeNav(); });
    grid.appendChild(dot);
  });
  updateNavDot(currentQ);
}

function updateNavDot(i) {
  const dot = $('nav-dot-' + i);
  if (!dot) return;
  dot.className = 'nav-dot';
  if (i === currentQ) dot.classList.add('current');
  if (flagged[i]) dot.classList.add('review');
  else if (answers[i] !== null && answers[i] !== '') dot.classList.add('answered');
}

function openNav()  { $('nav-drawer').classList.add('open');    $('nav-overlay').classList.add('open');    questions.forEach((_,i)=>updateNavDot(i)); }
function closeNav() { $('nav-drawer').classList.remove('open'); $('nav-overlay').classList.remove('open'); }

function startTimer() {
  timerSecs = 0;
  clearInterval(timerHandle);
  timerHandle = setInterval(() => {
    timerSecs++;
    const display = timeLimitS > 0 ? timeLimitS - timerSecs : timerSecs;
    const abs = Math.abs(display);
    $('test-timer').textContent = String(Math.floor(abs/60)).padStart(2,'0') + ':' + String(abs%60).padStart(2,'0');
    if (timeLimitS > 0) {
      const rem = timeLimitS - timerSecs;
      $('test-timer').className = rem <= 60 ? 'danger' : rem <= 180 ? 'warning' : '';
      if (rem <= 0) { clearInterval(timerHandle); gradeTest(); }
    }
  }, 1000);
}

function confirmSubmit() {
  const unanswered = answers.filter(a => a === null || a === '').length;
  if (unanswered > 0 && !confirm(unanswered + ' question(s) unanswered. Submit anyway?')) return;
  clearInterval(timerHandle);
  gradeTest();
}

async function gradeTest() {
  showGenerating('Grading your test…');
  let correct = 0, wrong = 0, skipped = 0;
  const topicMap = {};

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i], ans = answers[i], t = q.topic || 'General';
    if (!topicMap[t]) topicMap[t] = { correct: 0, total: 0 };
    topicMap[t].total++;

    if (ans === null || ans === '') {
      q._result = 'skipped'; skipped++;
    } else if (q.type === 'mc' || q.type === 'tf') {
      q._result = (ans === q.correct) ? 'correct' : 'wrong';
    } else if (q.type === 'written') {
      try {
        const res   = await askAI({ message: 'Grade this short answer. Correct: "' + q.answer + '". Student wrote: "' + ans + '". Is it essentially correct? Reply ONLY "yes" or "no".', history: [] });
        const reply = (res && res.reply ? res.reply : typeof res === 'string' ? res : '').toLowerCase().trim();
        q._result   = reply.startsWith('yes') ? 'correct' : 'wrong';
      } catch { q._result = 'wrong'; }
    }

    if (q._result === 'correct') { correct++; topicMap[t].correct++; }
    else if (q._result === 'wrong') wrong++;
  }

  showResults(correct, wrong, skipped, topicMap);
}

function showResults(correct, wrong, skipped, topicMap) {
  showOnly('view-results');
  const total = questions.length;
  const pct   = Math.round((correct / total) * 100);

  document.querySelector('.result-score-ring').style.setProperty('--pct', pct + '%');
  $('result-pct').textContent   = pct + '%';
  $('result-title').textContent = pct >= 90 ? 'Excellent work!' : pct >= 75 ? 'Good job!' : pct >= 60 ? 'Keep practicing.' : 'Needs more work.';
  $('result-sub').textContent   = correct + ' correct · ' + wrong + ' wrong · ' + skipped + ' skipped · ' + Math.floor(timerSecs/60) + 'm ' + (timerSecs%60) + 's';

  const topics = Object.entries(topicMap);
  if (topics.length > 1) {
    $('topic-section').classList.remove('hidden');
    const rows = $('topic-rows');
    rows.innerHTML = '';
    topics.sort((a,b) => (b[1].correct/b[1].total) - (a[1].correct/a[1].total));
    topics.forEach(([name, data]) => {
      const p = data.total > 0 ? Math.round((data.correct/data.total)*100) : 0;
      const row = document.createElement('div');
      row.className = 'topic-row';
      row.innerHTML = '<div class="topic-name">' + esc(name) + '</div><div class="topic-bar-wrap"><div class="topic-bar-fill' + (p < 60 ? ' bad' : '') + '" style="width:' + p + '%"></div></div><div class="topic-score">' + data.correct + '/' + data.total + '</div>';
      rows.appendChild(row);
    });
    const weak = topics.filter(([,d]) => d.total > 0 && (d.correct/d.total) < 0.6).map(([n]) => n);
    if (weak.length) { const tip = document.createElement('div'); tip.style.cssText = 'margin-top:12px;font-size:12px;color:rgba(255,255,255,.3);'; tip.textContent = 'Focus on: ' + weak.slice(0,3).join(', '); rows.appendChild(tip); }
  }

  const reviewEl = $('review-items');
  reviewEl.innerHTML = '';
  questions.forEach((q, i) => {
    const item = document.createElement('div');
    item.className = 'review-item ' + q._result;
    const ans = answers[i];
    let yourHtml = '', corrHtml = '';

    if (q.type === 'mc') {
      const yourA = ans !== null ? q.choices[ans] : null;
      const corrA = q.choices[q.correct];
      if (q._result !== 'correct' && yourA) yourHtml = '<div class="review-answer-row"><span class="review-tag your">YOURS</span><span class="review-answer-text">' + esc(yourA) + '</span></div>';
      corrHtml = '<div class="review-answer-row"><span class="review-tag correct">CORRECT</span><span class="review-answer-text">' + esc(corrA) + '</span></div>';
    } else if (q.type === 'tf') {
      const yourA = ans !== null ? (ans ? 'True' : 'False') : null;
      const corrA = q.correct ? 'True' : 'False';
      if (q._result !== 'correct' && yourA) yourHtml = '<div class="review-answer-row"><span class="review-tag your">YOURS</span><span class="review-answer-text">' + yourA + '</span></div>';
      corrHtml = '<div class="review-answer-row"><span class="review-tag correct">CORRECT</span><span class="review-answer-text">' + corrA + '</span></div>';
    } else if (q.type === 'written') {
      if (ans) yourHtml = '<div class="review-answer-row"><span class="review-tag your">YOURS</span><span class="review-answer-text">' + esc(ans) + '</span></div>';
      corrHtml = '<div class="review-answer-row"><span class="review-tag correct">ANSWER</span><span class="review-answer-text">' + esc(q.answer || '—') + '</span></div>';
    }

    const skipTag = q._result === 'skipped' ? '<span class="review-tag skipped" style="margin-bottom:8px;display:inline-block">SKIPPED</span>' : '';
    const expl    = q.explanation ? '<div class="review-explanation">' + esc(q.explanation) + '</div>' : '';

    let stdsHtml = '';
    if (q.standardsDetail?.length) {
      const chips = q.standardsDetail.map(s =>
        `<div class="standard-chip small" data-code="${esc(s.code)}" data-name="${esc(s.name || s.code)}" data-desc="${esc(s.text || s.description || '')}">` +
        `<span class="std-code">${esc(s.code)}</span><span>${esc(s.name || s.code)}</span>` +
        `<span style="color:rgba(255,255,255,.3);font-size:10px">↗</span></div>`
      ).join('');
      stdsHtml = `<div class="review-stds">${chips}</div>`;
    }

    item.innerHTML = '<div class="review-q-text">' + (i+1) + '. ' + esc(q.q) + '</div>' + skipTag + yourHtml + (q._result !== 'skipped' ? corrHtml : '') + expl + stdsHtml;
    item.querySelectorAll('.standard-chip').forEach(chip => {
      chip.addEventListener('click', () => openStandardModal(chip.dataset));
    });
    reviewEl.appendChild(item);
  });

  // Render LaTeX in question text, answer choices, and explanations on results screen
  reviewEl.querySelectorAll('.review-q-text, .review-answer-text, .review-explanation').forEach(el => renderMath(el));

  logActivity('📝', 'Completed test: ' + testTitle + ' — ' + pct + '%');
  $('results-back').onclick = () => showOnly('view-picker');
  $('done-btn').onclick     = () => showOnly('view-picker');
  $('retake-btn').onclick   = () => {
    answers = Array(questions.length).fill(null);
    flagged = Array(questions.length).fill(false);
    questions.forEach(q => delete q._result);
    startTestUI();
  };
}

function showGenerating(msg) { $('gen-label').textContent = msg; showOnly('view-generating'); }

const FRQ_STEPS = [
  { label:'THESIS / CLAIM',               text:'State your central argument in 1-2 sentences. Be specific and directly answer the prompt.' },
  { label:'CONTEXT / BACKGROUND',         text:'1-2 sentences of relevant background that sets up your argument.' },
  { label:'EVIDENCE',                     text:'2-3 specific facts, examples, or data points that support your thesis.' },
  { label:'ANALYSIS / REASONING',         text:'Explain HOW and WHY each piece of evidence supports your argument. Analyze, don\'t just describe.' },
  { label:'COUNTERARGUMENT (if needed)',   text:'Briefly acknowledge a counter-perspective and explain why your argument still holds.' },
  { label:'CONCLUSION',                   text:'Restate your thesis in new words and explain the broader significance.' },
];

function initFRQ() {
  $('frq-back').onclick      = () => showOnly('view-picker');
  $('frq-start-btn').onclick = startFRQCoaching;
  $('frq-example-btn').onclick = fetchFRQExample;
  $('frq-grade-btn').onclick   = gradeFRQResponse;
}

function startFRQCoaching() {
  if (!$('frq-prompt-input').value.trim()) { toast('Paste an FRQ prompt first.', 'error'); return; }
  $('frq-coaching').classList.remove('hidden');
  const list = $('frq-steps-list');
  list.innerHTML = '';
  FRQ_STEPS.forEach(step => {
    const div = document.createElement('div');
    div.className = 'frq-step';
    div.innerHTML = '<div class="frq-step-label">' + step.label + '</div><div class="frq-step-text">' + step.text + '</div>';
    list.appendChild(div);
  });
  $('frq-response').focus();
}

async function fetchFRQExample() {
  const prompt = $('frq-prompt-input').value.trim();
  if (!prompt) { toast('Enter an FRQ prompt first.', 'error'); return; }
  const btn = $('frq-example-btn');
  btn.textContent = 'Loading…'; btn.disabled = true;
  try {
    const res  = await askAI({ message: 'Write a strong model AP-style free response to this prompt using: thesis, context, evidence, analysis, conclusion. Complete paragraphs, academic tone.\n\nPrompt: "' + prompt + '"', history: [] });
    const text = res && res.reply ? res.reply : typeof res === 'string' ? res : '';
    $('frq-model-text').textContent = text;
    $('frq-model-box').classList.remove('hidden');
  } catch { toast('Could not generate example.', 'error'); }
  btn.textContent = 'Show model response'; btn.disabled = false;
}

async function gradeFRQResponse() {
  const prompt   = $('frq-prompt-input').value.trim();
  const response = $('frq-response').value.trim();
  if (!response) { toast('Write your response first.', 'error'); return; }
  const btn = $('frq-grade-btn');
  btn.textContent = 'Grading…'; btn.disabled = true;

  const criteria = ['Thesis / Claim (1-4)', 'Use of Evidence (1-4)', 'Analysis & Reasoning (1-4)', 'Organization (1-4)'];
  try {
    const res  = await askAI({ message: 'Grade this AP free response using a 1-4 rubric per criterion.\nPrompt: "' + prompt + '"\nStudent: "' + response + '"\nCriteria: Thesis/Claim, Use of Evidence, Analysis & Reasoning, Organization.\nReturn ONLY JSON: {"scores":{"Thesis/Claim":3,"Use of Evidence":2,"Analysis & Reasoning":3,"Organization":4},"feedback":"One sentence of actionable feedback."}', history: [] });
    const raw  = res && res.reply ? res.reply : typeof res === 'string' ? res : '';
    const data = safeParseJSON(raw);

    const rows = $('frq-rubric-rows');
    rows.innerHTML = '';
    criteria.forEach(c => {
      const key   = c.split(' (')[0];
      const score = (data && data.scores ? data.scores[key] : null) || '—';
      const cls   = score <= 1 ? 'low' : score <= 2 ? 'mid' : '';
      const row   = document.createElement('div');
      row.className = 'frq-rubric-row';
      row.innerHTML = '<div class="frq-rubric-criterion">' + c + '</div><div class="frq-rubric-score ' + cls + '">' + score + '/4</div>';
      rows.appendChild(row);
    });
    $('frq-rubric-feedback').textContent = (data && data.feedback) ? data.feedback : '';
    $('frq-rubric-box').classList.remove('hidden');
  } catch { toast('Grading failed.', 'error'); }
  btn.textContent = 'Grade my response →'; btn.disabled = false;
}

function safeParseJSON(text) {
  if (!text || typeof text !== 'string') return null;
  const s = text.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();
  for (const [open, close] of [['[',']'],['{','}']]) {
    const start = s.indexOf(open), end = s.lastIndexOf(close);
    if (start !== -1 && end !== -1) {
      try { return JSON.parse(s.slice(start, end+1)); } catch { /* try next */ }
    }
  }
  return null;
}

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ── Standards rendering ────────────────────────────────────────────

async function renderStandardsForQuestion(strip, questionText, system, course, preloaded = []) {
  const list    = strip.querySelector('.q-standards-list');
  const srcLine = strip.querySelector('.q-standards-sources');
  let standards = [];

  if (preloaded.length) {
    standards = preloaded;
  } else if (['ap', 'sat', 'act'].includes(system)) {
    try {
      const r = await fetch('https://pluto-server-production.up.railway.app/retrieve-standards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: questionText, system, course, k: 2 }),
      });
      const data = await r.json();
      standards = data.standards || [];
    } catch { standards = []; }
  } else {
    // IB / GCSE / A-Level — AI-aligned fallback
    try {
      const res = await askAI({
        message: `Generate 2 realistic ${system.toUpperCase()} standard codes and short names that this question would be testing. Reply ONLY as JSON: [{"code":"...","name":"...","description":"..."}]. Question: "${questionText}"`,
        history: [],
      });
      const raw = (res && res.reply ? res.reply : '').replace(/```json|```/g, '').trim();
      const s = raw.indexOf('['), e = raw.lastIndexOf(']');
      if (s !== -1 && e !== -1) {
        standards = JSON.parse(raw.slice(s, e + 1));
        standards.forEach(s => { s.aiAligned = true; });
      }
    } catch { standards = []; }
  }

  list.innerHTML = '';
  if (!standards.length) {
    list.innerHTML = '<span style="font-size:11px;color:rgba(255,255,255,.2)">No standards retrieved.</span>';
    return;
  }

  standards.forEach(s => {
    const chip = document.createElement('div');
    chip.className = 'standard-chip';
    const chipCode = s.code || '—';
    const chipName = s.name || s.code || '—';
    const chipDesc = s.text || s.description || '';
    chip.dataset.code = chipCode;
    chip.dataset.name = chipName;
    chip.dataset.desc = chipDesc.replace(/"/g, '&quot;');
    chip.innerHTML = `
      <span class="std-code">${esc(chipCode)}</span>
      <span>${esc(chipName)}</span>
      ${s.aiAligned ? '<span class="std-ai-badge">AI</span>' : ''}
      <span style="color:rgba(255,255,255,.3);font-size:11px">↗</span>
    `;
    chip.addEventListener('click', () => openStandardModal(chip.dataset));
    list.appendChild(chip);
  });

  if (system === 'ap' && course) {
    srcLine.textContent = `Source: College Board AP ${course.replace('ap-', '').replace(/-/g, ' ').toUpperCase()} Course and Exam Description`;
  } else if (system === 'sat') {
    srcLine.textContent = 'Source: College Board Digital SAT Suite Specifications';
  } else if (system === 'act') {
    srcLine.textContent = 'Source: ACT College and Career Readiness Standards';
  } else {
    srcLine.textContent = 'Standards inferred by Pluto AI — for guidance only';
  }
}

function openStandardModal({ code, name, desc }) {
  const overlay = document.createElement('div');
  overlay.className = 'std-modal-overlay';

  overlay.innerHTML = `
    <div class="std-modal-box">
      <div class="std-modal-code">${esc(code)}</div>
      <div class="std-modal-name">${esc(name)}</div>
      <div class="std-modal-desc">${esc(desc || '')}</div>
      <div class="std-modal-expl" id="std-expl-body" style="color:rgba(255,255,255,.3)">Loading explanation…</div>
      <div class="std-modal-btns">
        <button class="act-btn" id="std-close-btn">Close</button>
        <button class="act-btn primary" id="std-chat-btn">Open in Chat ↗</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    overlay.style.opacity = '1';
    overlay.querySelector('.std-modal-box').style.transform = 'translateY(0)';
  });

  // Fetch inline explanation
  askAI({
    message: `In 2-3 short sentences, explain the standard "${code}: ${name}" — what it means, what students need to know, and the most common way it appears on the exam. Official description: ${desc}`,
    history: [],
  }).then(r => {
    const el = overlay.querySelector('#std-expl-body');
    if (el) { el.textContent = (r && r.reply ? r.reply : '').trim(); el.style.color = ''; }
  }).catch(() => {
    const el = overlay.querySelector('#std-expl-body');
    if (el) { el.textContent = 'Could not load explanation.'; el.style.color = '#ff5f5f'; }
  });

  function closeModal() {
    overlay.style.opacity = '0';
    overlay.querySelector('.std-modal-box').style.transform = 'translateY(20px)';
    setTimeout(() => overlay.remove(), 200);
  }

  overlay.querySelector('#std-close-btn').addEventListener('click', closeModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

  overlay.querySelector('#std-chat-btn').addEventListener('click', () => {
    const examLabel = examCourse
      ? examCourse.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      : examSystem ? examSystem.toUpperCase() : 'this exam';
    const topic = `Explain ${code} (${name}) in depth. What does this standard cover? How does it appear on the ${examLabel} exam? Give me examples.`;
    const url = chrome.runtime.getURL('chat.html') + '?prompt=' + encodeURIComponent(topic);
    chrome.tabs.create({ url });
    closeModal();
  });
}

initFRQ();
init();