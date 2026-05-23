import {
  initStarCanvas, getBrainStats,
  getUsername, setUsername,
  storage, openPage, toast, fmtNum, logActivity
} from './pluto-shared.js';

// Each feature gets an accent color for its top border
const FEATURES = [
  { icon: '📚', name: 'Study Sets',    desc: 'Create & manage flashcard decks',     file: 'study.html',    color: '#6b9fff' },
  { icon: '🧠', name: 'Learn Mode',    desc: 'Adaptive spaced-repetition',           file: 'learn.html',    color: '#a78bfa' },
  { icon: '📝', name: 'Practice Test', desc: 'MCQ, True/False, and written',         file: 'test.html',     color: '#4fd98e' },
  { icon: '🎯', name: 'Match',         desc: 'Drag-and-drop term matching',           file: 'match.html',    color: '#e8b84b' },
  { icon: '🗣️', name: 'Pluto Voice',   desc: 'Voice AI study partner',                file: 'kai.html',      color: '#fb7185' },
  { icon: '📥', name: 'Importer',      desc: 'PDF & video → flashcards',             file: 'importer.html', color: '#38bdf8' },
  { icon: '🏁', name: 'Live Race',     desc: 'Multiplayer study battles',            file: 'live.html',     color: '#fb923c' },
  { icon: '🎮', name: 'Pluto Quest',   desc: 'Earn XP & coins, level up',            file: 'game.html',     color: '#e8b84b', live: true },
  { icon: '🌐', name: 'Research Hub',  desc: 'AI essays, outlines & research',       file: 'research.html', color: '#6b9fff', live: true },
  { icon: '💬', name: 'Chat',          desc: 'Ask Pluto anything',                   file: 'chat.html',     color: '#b0b0c8', live: true },
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
  if (h >= 5  && h < 12) return 'GOOD MORNING';
  if (h >= 12 && h < 17) return 'GOOD AFTERNOON';
  if (h >= 17 && h < 21) return 'GOOD EVENING';
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
    card.className   = 'feat-card';
    card.style.animationDelay  = `${i * 40}ms`;
    card.style.borderTopColor  = f.color + '55'; // 33% opacity accent border

    card.innerHTML = `
      <span class="feat-icon">${f.icon}</span>
      <div class="feat-name">${f.name}${f.live ? '<span class="feat-live-dot"></span>' : ''}</div>
      <div class="feat-desc">${f.desc}</div>
      <span class="feat-arrow">↗</span>
    `;

    card.addEventListener('click', () => {
      openPage(f.file);
      logActivity(f.icon, `Opened ${f.name}`);
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

// ── Brain stats ───────────────────────────────────────────
async function loadBrainStats() {
  const stats = await getBrainStats();
  const badge = document.getElementById('brain-badge');
  const text  = document.getElementById('brain-status-text');

  if (!stats.timestamp && stats.totalQuestions === 0) {
    badge.classList.add('offline');
    text.textContent = 'SERVER OFFLINE';
    document.getElementById('stat-brain').textContent = '—';
  } else {
    animateCount(document.getElementById('stat-brain'), stats.totalQuestions || 0);
  }
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

  buildFeatureGrid();
  await buildActivity();
  await initTip();

  loadBrainStats();
  loadGameStats();
}

init();
