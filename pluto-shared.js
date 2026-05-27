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
    const r = await fetch('https://pluto-server-production.up.railway.app/brain-stats');
    return await r.json();
  } catch {
    return { totalQuestions: 0, totalUsers: 0 };
  }
}

// ── Subscription check ────────────────────────────────────────
// Returns 'premium' | 'free'. Caches result for 10 minutes to avoid
// hammering the server on every page open.
const SUB_CACHE_TTL = 10 * 60 * 1000;

export async function checkSubscription() {
  const { plutoSubTier, plutoSubCheckedAt } = await storage.get(['plutoSubTier', 'plutoSubCheckedAt']);
  if (plutoSubTier && plutoSubCheckedAt && (Date.now() - plutoSubCheckedAt) < SUB_CACHE_TTL) {
    return plutoSubTier;
  }
  try {
    const userId = await getUserId();
    const r = await fetch('https://pluto-server-production.up.railway.app/check-subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    const { tier } = await r.json();
    await storage.set({ plutoSubTier: tier, plutoSubCheckedAt: Date.now() });
    return tier;
  } catch {
    // Network error — fall back to cached value or free
    return plutoSubTier || 'free';
  }
}

// ── Paywall gate ──────────────────────────────────────────────
// Call at the top of a premium page's init(). Shows an overlay and blocks
// the page if the user is on the free tier.
export async function requirePremium(featureName = 'this feature') {
  return true; // PAYWALL DISABLED
  const tier = await checkSubscription();
  if (tier === 'premium') return true;

  // Blur the page content
  document.body.style.filter = 'blur(4px)';
  document.body.style.pointerEvents = 'none';

  const userId = await getUserId();
  const overlay = document.createElement('div');
  overlay.id = 'paywall-overlay';
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;
    background:rgba(0,0,0,.75);backdrop-filter:blur(8px);font-family:'DM Sans',sans-serif;
  `;
  overlay.innerHTML = `
    <div style="background:#0a0a14;border:1px solid rgba(255,255,255,.12);border-radius:18px;
                padding:36px 32px;max-width:360px;width:90%;text-align:center;
                box-shadow:0 24px 64px rgba(0,0,0,.7);">
      <div style="font-size:36px;margin-bottom:12px">⭐</div>
      <div style="font-size:20px;font-weight:700;color:#fff;margin-bottom:8px">Pluto Premium</div>
      <div style="font-size:13px;color:rgba(255,255,255,.45);margin-bottom:24px;line-height:1.6">
        ${featureName} is a Premium feature.<br>Upgrade to unlock unlimited tests, Live Race, and more.
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px">
        <button id="pw-monthly" style="background:#4f8ef7;color:#fff;border:none;border-radius:10px;
          padding:13px 20px;font-size:14px;font-weight:600;cursor:pointer;">
          Monthly — $5.99/mo
        </button>
        <button id="pw-annual" style="background:rgba(255,255,255,.07);color:#fff;border:1px solid rgba(255,255,255,.15);
          border-radius:10px;padding:13px 20px;font-size:14px;font-weight:600;cursor:pointer;">
          Annual — $59.99/yr &nbsp;<span style="font-size:11px;color:#5ef8a0;font-weight:400">Save 50%</span>
        </button>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:20px">
        <input id="pw-code-input" placeholder="Discount code" style="flex:1;background:rgba(255,255,255,.06);
          border:1px solid rgba(255,255,255,.12);color:#fff;border-radius:8px;padding:9px 12px;font-size:13px;outline:none;"/>
        <button id="pw-code-apply" style="background:rgba(255,255,255,.1);color:#fff;border:none;
          border-radius:8px;padding:9px 14px;font-size:13px;cursor:pointer;">Apply</button>
      </div>
      <div id="pw-code-msg" style="font-size:12px;color:#5ef8a0;min-height:16px;margin-bottom:12px"></div>
      <button id="pw-close" style="background:none;border:none;color:rgba(255,255,255,.25);
        font-size:12px;cursor:pointer;text-decoration:underline">Maybe later</button>
    </div>
  `;
  document.body.style.filter = '';
  document.body.style.pointerEvents = '';
  document.body.appendChild(overlay);

  let activeCouponId = null;

  overlay.querySelector('#pw-code-apply').addEventListener('click', async () => {
    const code = overlay.querySelector('#pw-code-input').value.trim();
    const msg  = overlay.querySelector('#pw-code-msg');
    if (!code) return;
    try {
      const r    = await fetch('https://pluto-server-production.up.railway.app/apply-discount-code', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, interval: 'monthly' }),
      });
      const data = await r.json();
      if (data.valid) {
        activeCouponId = data.couponId;
        msg.textContent = '✓ Code applied — discounted price active!';
        overlay.querySelector('#pw-monthly').textContent = 'Monthly — $2.99/mo';
        overlay.querySelector('#pw-annual').textContent  = 'Annual — $29.99/yr  (Save 50%)';
      } else {
        msg.style.color = '#ff5f5f';
        msg.textContent = data.error || 'Invalid code.';
      }
    } catch {
      msg.style.color = '#ff5f5f';
      msg.textContent = 'Could not reach server.';
    }
  });

  async function startCheckout(interval) {
    try {
      const r = await fetch('https://pluto-server-production.up.railway.app/create-checkout-session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, interval, couponId: activeCouponId }),
      });
      const { url, error } = await r.json();
      if (error) { toast('Checkout error: ' + error, 'error'); return; }
      chrome.tabs.create({ url });
    } catch {
      toast('Could not reach server.', 'error');
    }
  }

  overlay.querySelector('#pw-monthly').addEventListener('click', () => startCheckout('monthly'));
  overlay.querySelector('#pw-annual').addEventListener('click',  () => startCheckout('annual'));
  overlay.querySelector('#pw-close').addEventListener('click', () => {
    overlay.remove();
    window.history.back();
  });

  return false;
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
