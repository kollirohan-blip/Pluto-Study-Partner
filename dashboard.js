import {
  initStarCanvas, getBrainStats,
  getUsername, setUsername,
  storage, openPage, toast, fmtNum, logActivity,
  initTheme
} from './pluto-shared.js';

// Each feature gets an accent color for its top border
// primary: true → larger card with more visual weight
const SVG = {
  book:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
  clipboard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="m9 12 2 2 4-4"/></svg>`,
  message:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  layers:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,
  grid:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
  mic:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`,
  upload:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
  zap:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  trophy:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/></svg>`,
  search:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
};

const FEATURES = [
  { icon: SVG.book,      activityIcon: '📚', name: 'Study Sets',    desc: 'Create & manage flashcard decks',     file: 'study.html',    color: '#4D8BFF', primary: true },
  { icon: SVG.clipboard, activityIcon: '📝', name: 'Practice Test', desc: 'MCQ, True/False, and written',         file: 'test.html',     color: '#34D399', primary: true },
  { icon: SVG.message,   activityIcon: '💬', name: 'Chat',          desc: 'Ask Pluto anything',                   file: 'chat.html',     color: '#9896A0', primary: true },
  { icon: SVG.layers,    activityIcon: '🧠', name: 'Learn Mode',    desc: 'Adaptive spaced-repetition',           file: 'learn.html',    color: '#a78bfa' },
  { icon: SVG.grid,      activityIcon: '🎯', name: 'Match',         desc: 'Drag-and-drop term matching',           file: 'match.html',    color: '#FBBF24' },
  { icon: SVG.mic,       activityIcon: '🗣️', name: 'Pluto Voice',   desc: 'Voice AI study partner',                file: 'kai.html',      color: '#fb7185' },
  { icon: SVG.upload,    activityIcon: '📥', name: 'Importer',      desc: 'PDF & video → flashcards',             file: 'importer.html', color: '#38bdf8' },
  { icon: SVG.zap,       activityIcon: '🏁', name: 'Live Race',     desc: 'Multiplayer study battles',            file: 'live.html',     color: '#FF7A47' },
  { icon: SVG.trophy,    activityIcon: '🎮', name: 'Pluto Quest',   desc: 'Earn XP & coins, level up',            file: 'game.html',     color: '#FBBF24', live: true },
  { icon: SVG.search,    activityIcon: '🌐', name: 'Research Hub',  desc: 'AI essays, outlines & research',       file: 'research.html', color: '#4D8BFF', live: true },
];

// ── Helpers ──────────────────────────────────────────────
function animateCount(el, target, duration = 1300) {
  if (!el) return;
  if (target === 0) { el.textContent = '0'; return; }
  const start = performance.now();
  function step(now) {
    const t    = Math.min(1, (now - start) / duration);
    const ease = 1 - Math.pow(1 - t, 3);
    el.textContent = fmtNum(Math.round(target * ease));
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)  return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'GOOD MORNING';
  if (h < 17) return 'GOOD AFTERNOON';
  if (h < 21) return 'GOOD EVENING';
  return 'STUDYING LATE?';
}

function formatDate() {
  return new Date().toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' }).toUpperCase();
}

// ── Username chip ─────────────────────────────────────────
function initUsernameChip(name) {
  const chip     = document.getElementById('username-chip');
  const display  = document.getElementById('username-display');
  const heroName = document.getElementById('hero-username');

  display.textContent  = name;
  heroName.textContent = name;

  chip.addEventListener('click', () => {
    if (chip.querySelector('input')) return;

    const input = document.createElement('input');
    input.value     = display.textContent;
    input.maxLength = 20;
    display.replaceWith(input);
    input.focus();
    input.select();

    async function save() {
      const val = input.value.trim() || 'Anonymous';
      await setUsername(val);
      const span        = document.createElement('span');
      span.id           = 'username-display';
      span.textContent  = val;
      input.replaceWith(span);
      heroName.textContent = val;
      toast('Name saved!', 'success');
    }

    input.addEventListener('blur', save);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
  });
}

// ── Feature grid ──────────────────────────────────────────
function buildFeatureGrid() {
  const grid = document.getElementById('feat-grid');
  FEATURES.forEach((f, i) => {
    const card       = document.createElement('div');
    card.className   = f.primary ? 'feat-card feat-card-primary' : 'feat-card';
    card.style.animationDelay = `${i * 40}ms`;

    card.innerHTML = `
      <span class="feat-icon">${f.icon}</span>
      <div class="feat-name">${f.name}${f.live ? '<span class="feat-live-dot"></span>' : ''}</div>
      <div class="feat-desc">${f.desc}</div>
      <span class="feat-arrow">↗</span>
    `;

    card.addEventListener('click', () => {
      openPage(f.file);
      logActivity(f.activityIcon, `Opened ${f.name}`);
    });

    card.addEventListener('mouseenter', () => {
      card.style.transition = 'transform 0.1s ease, box-shadow 0.18s, border-color 0.18s';
    });
    card.addEventListener('mousemove', (e) => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width  - 0.5;
      const y = (e.clientY - r.top)  / r.height - 0.5;
      card.style.transform = `perspective(500px) rotateY(${x * 16}deg) rotateX(${-y * 16}deg) translateZ(6px)`;
    });
    card.addEventListener('mouseleave', () => {
      card.style.transition = 'transform 0.55s cubic-bezier(.16,1,.3,1), box-shadow 0.18s, border-color 0.18s';
      card.style.transform = '';
    });

    grid.appendChild(card);
  });
}

// ── Activity feed ─────────────────────────────────────────
async function buildActivity() {
  const { plutoActivity = [] } = await storage.get('plutoActivity');
  const list = document.getElementById('activity-list');

  if (plutoActivity.length === 0) {
    list.innerHTML = '<div class="act-empty">Nothing yet — start by opening a feature above.</div>';
    return;
  }

  plutoActivity.slice(0, 12).forEach((item, i) => {
    const el       = document.createElement('div');
    el.className   = 'act-item';
    el.style.animationDelay = `${i * 30}ms`;
    el.innerHTML   = `
      <span class="act-icon">${item.icon}</span>
      <span class="act-text">${item.text}</span>
      <span class="act-time">${timeAgo(item.timestamp)}</span>
    `;
    list.appendChild(el);
  });
}

// ── Tip banner ────────────────────────────────────────────
async function initTip() {
  const tip = document.getElementById('install-tip');
  const { tipDismissed } = await storage.get('tipDismissed');
  if (tipDismissed) { tip.style.display = 'none'; return; }

  document.getElementById('tip-dismiss').addEventListener('click', async () => {
    tip.style.transition = 'opacity .18s';
    tip.style.opacity    = '0';
    setTimeout(() => tip.style.display = 'none', 200);
    await storage.set({ tipDismissed: true });
  });
}

// ── Page icon + file helpers ──────────────────────────────
const TEXT_TO_PAGE = [
  [['study','flashcard','card'],          'study',    SVG.book],
  [['test','practice','quiz','mcq'],      'test',     SVG.clipboard],
  [['chat','ask','pluto'],                'chat',     SVG.message],
  [['learn','spaced','repetition'],       'learn',    SVG.layers],
  [['match','drag'],                      'match',    SVG.grid],
  [['voice','kai'],                       'kai',      SVG.mic],
  [['import','pdf','video'],              'importer', SVG.upload],
  [['live','race','battle'],              'live',     SVG.zap],
  [['quest','game','xp'],                 'game',     SVG.trophy],
  [['research','essay','outline'],        'research', SVG.search],
];
function _matchPage(text) {
  const lower = (text||'').toLowerCase();
  for (const [kws, page, icon] of TEXT_TO_PAGE) {
    if (kws.some(k => lower.includes(k))) return { page, icon };
  }
  return { page: 'chat', icon: SVG.message };
}

// ── Continue section ──────────────────────────────────────
async function buildContinueSection() {
  const { plutoActivity = [] } = await storage.get('plutoActivity');
  if (!plutoActivity.length) return;
  const section = document.getElementById('continue-section');
  const list    = document.getElementById('continue-list');
  section.style.display = '';
  plutoActivity.slice(0, 3).forEach(item => {
    const { page, icon } = _matchPage(item.text);
    const card = document.createElement('div');
    card.className = 'continue-card';
    card.innerHTML = `
      <div class="continue-icon">${icon}</div>
      <div class="continue-info">
        <div class="continue-title">${item.text}</div>
        <div class="continue-time">${timeAgo(item.timestamp)}</div>
      </div>
      <button class="continue-btn">Resume →</button>
    `;
    const go = () => openPage(page + '.html');
    card.addEventListener('click', go);
    card.querySelector('.continue-btn').addEventListener('click', e => { e.stopPropagation(); go(); });
    list.appendChild(card);
  });
}

// ── Goal ring ─────────────────────────────────────────────
function renderGoalRing(xp, goal = 100) {
  const fill = document.getElementById('goal-ring-fill');
  if (!fill) return;
  const circumference = 2 * Math.PI * 36;
  fill.style.strokeDasharray  = circumference;
  fill.style.strokeDashoffset = circumference;
  requestAnimationFrame(() => {
    fill.style.strokeDashoffset = circumference * (1 - Math.min(xp / goal, 1));
  });
  document.getElementById('goal-xp-text').textContent = xp;
  document.getElementById('goal-xp-max').textContent  = goal;
}

// ── Stat cards ────────────────────────────────────────────
async function buildStatCards(brainTotal) {
  animateCount(document.getElementById('brain-size-big'), brainTotal || 0);

  const { plutoActivity = [] } = await storage.get('plutoActivity');
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  animateCount(
    document.getElementById('week-questions'),
    plutoActivity.filter(a => a.timestamp > weekAgo).length
  );
  const uniquePages = new Set(plutoActivity.map(a => _matchPage(a.text).page));
  animateCount(document.getElementById('courses-studied'), Math.min(uniquePages.size, 38));
}

// ── Brain stats ───────────────────────────────────────────
async function loadBrainStats() {
  const stats = await getBrainStats();
  const badge = document.getElementById('brain-badge');
  const text  = document.getElementById('brain-status-text');
  const total = stats.totalQuestions || 0;

  if (!stats.timestamp && total === 0) {
    badge.classList.add('offline');
    text.textContent = 'SERVER OFFLINE';
    document.getElementById('stat-brain').textContent = '—';
  } else {
    animateCount(document.getElementById('stat-brain'), total);
  }
  return total;
}

// ── Game stats ────────────────────────────────────────────
function loadGameStats() {
  animateCount(
    document.getElementById('stat-xp'),
    parseInt(localStorage.getItem('pq_xp') || '0', 10)
  );
  animateCount(
    document.getElementById('stat-streak'),
    parseInt(localStorage.getItem('pq_streak') || '0', 10)
  );
}

// ── Boot ──────────────────────────────────────────────────
async function init() {
  initStarCanvas(document.getElementById('stars'));

  document.getElementById('hero-greeting').textContent = greeting();
  document.getElementById('date-display').textContent  = formatDate();

  const name = await getUsername();
  initUsernameChip(name);

  const brainTotal = await loadBrainStats();
  loadGameStats();
  buildContinueSection();
  buildStatCards(brainTotal);
  renderGoalRing(parseInt(localStorage.getItem('pq_xp') || '0', 10));
}

init();
