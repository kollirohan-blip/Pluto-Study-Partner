// PLUTO SHARED MODULE — imported by all new pages

export const COLORS = {
  bg: '#000', s1: 'rgba(255,255,255,.04)', s2: 'rgba(255,255,255,.08)',
  b1: 'rgba(255,255,255,.07)', b2: 'rgba(255,255,255,.14)',
  text: '#e0e0e8', dim: '#404050', mid: '#707080',
  accent: '#b0b0c8', green: '#5ef8a0', blue: '#4f8ef7', red: '#ff5f5f', gold: '#f0c060'
};

// AI call — proxies through background.js just like chat.js
export function askAI(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'PLUTO_AI_REQUEST', payload }, response => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!response?.ok) return reject(new Error(response?.error || 'AI request failed'));
      resolve(response.data);
    });
  });
}

// chrome.storage.local — Promise wrappers
export const storage = {
  get: keys => new Promise(r => chrome.storage.local.get(keys, r)),
  set: items => new Promise(r => chrome.storage.local.set(items, r)),
  remove: keys => new Promise(r => chrome.storage.local.remove(keys, r))
};

// Stable per-install user ID
export async function getUserId() {
  let { plutoUserId } = await storage.get('plutoUserId');
  if (!plutoUserId) {
    plutoUserId = 'u_' + Math.random().toString(36).slice(2, 12);
    await storage.set({ plutoUserId });
  }
  return plutoUserId;
}

export async function getUsername() {
  let { plutoUsername } = await storage.get('plutoUsername');
  return plutoUsername || 'Anonymous';
}

export async function setUsername(name) {
  await storage.set({ plutoUsername: name.slice(0, 20) });
}

// Animated star background — same look as chat.js
export function initStarCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  let stars = [], W, H;

  function resize() {
    W = canvas.width = canvas.offsetWidth;
    H = canvas.height = canvas.offsetHeight;
    stars = Array.from({ length: 80 }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      r: Math.random() * 1.2, a: Math.random() * 0.5 + 0.1,
      v: Math.random() * 0.3 + 0.05
    }));
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    for (const s of stars) {
      s.y += s.v;
      if (s.y > H) s.y = 0;
      ctx.fillStyle = `rgba(255,255,255,${s.a})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    requestAnimationFrame(draw);
  }

  resize();
  draw();
  window.addEventListener('resize', resize);
}

// Toast notification
export function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.style.cssText = `
    position:fixed; bottom:24px; left:50%; transform:translateX(-50%) translateY(20px);
    background:rgba(8,8,18,.97); border:1px solid var(--b2,rgba(255,255,255,.14));
    color:#fff; padding:10px 18px; border-radius:10px; font-size:13px;
    font-family:'DM Sans',sans-serif; z-index:99999; opacity:0;
    transition:opacity .2s, transform .2s; backdrop-filter:blur(20px);
    box-shadow:0 8px 24px rgba(0,0,0,.5);
  `;
  if (type === 'success') el.style.borderColor = 'rgba(94,248,160,.4)';
  if (type === 'error') el.style.borderColor = 'rgba(255,95,95,.4)';
  el.textContent = message;
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translateX(-50%) translateY(0)';
  });
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(-50%) translateY(20px)';
    setTimeout(() => el.remove(), 200);
  }, 2400);
}

// Open another extension page in a new tab
export function openPage(filename, params = '') {
  const url = chrome.runtime.getURL(filename) + (params ? '?' + params : '');
  chrome.tabs.create({ url });
}

// Format large numbers nicely
export function fmtNum(n) {
  if (n < 1000) return String(n);
  if (n < 10000) return (n / 1000).toFixed(1) + 'k';
  if (n < 1000000) return Math.round(n / 1000) + 'k';
  return (n / 1000000).toFixed(1) + 'M';
}

// Fetch brain stats from the Pluto server
export async function getBrainStats() {
  try {
    const r = await fetch('http://localhost:3000/brain-stats');
    return await r.json();
  } catch {
    return { totalQuestions: 0, totalUsers: 0 };
  }
}

// Log an activity entry to chrome.storage (shown on dashboard)
export async function logActivity(icon, text) {
  const { plutoActivity = [] } = await storage.get('plutoActivity');
  plutoActivity.unshift({ icon, text, timestamp: Date.now() });
  await storage.set({ plutoActivity: plutoActivity.slice(0, 50) });
}

// ── Back button auto-wiring ────────────────────────────────
// All pages import this module, so this runs everywhere.
// Inline onclick="history.back()" is blocked by MV3 CSP (script-src 'self'),
// and history.back() has no history anyway since pages open in new tabs.
// This wires every .pluto-back-btn to navigate to the dashboard instead.
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.pluto-back-btn').forEach(btn => {
      btn.removeAttribute('onclick');
      btn.addEventListener('click', () => {
        window.location.href = chrome.runtime.getURL('dashboard.html');
      });
    });
  }, { once: true });
}
