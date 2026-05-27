console.log('[Pluto] Background service worker loaded');

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(e => console.error(e));

// Inject content.js into a tab if not already there
async function ensureContentScript(tabId) {
  // Try pinging first
  const alive = await new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, { type: 'PLUTO_PING' }, r => {
      resolve(!chrome.runtime.lastError && r?.alive);
    });
  });
  if (alive) return true;

  // Not injected — do it now
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await new Promise(r => setTimeout(r, 200));
    console.log('[Pluto] Injected content.js into tab', tabId);
    return true;
  } catch (e) {
    console.error('[Pluto] Inject failed:', e.message);
    return false;
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  // ── PING_TAB: inject + confirm ready ─────────────────────
  if (request.type === 'PLUTO_PING_TAB') {
    const tabId = request.tabId;
    if (!tabId) { sendResponse({ error: 'No tabId provided' }); return true; }
    ensureContentScript(tabId).then(ready => {
      console.log('[Pluto] PING_TAB tabId=' + tabId + ' ready=' + ready);
      sendResponse({ ready });
    });
    return true;
  }

  // ── RELAY: messages that need to reach content script ────
  // These come from popup and need to go to the active tab
  const RELAY_TYPES = ['GET_SMART_CONTEXT', 'PLUTO_STOP', 'PLUTO_RESEARCH', 'PLUTO_INJECT_TEXT'];
  if (RELAY_TYPES.includes(request.type)) {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, async tabs => {
      const tabId = tabs[0]?.id;
      if (!tabId) { sendResponse({ error: 'No active tab' }); return; }
      const ready = await ensureContentScript(tabId);
      if (!ready) { sendResponse({ error: 'Could not inject on this page' }); return; }
      chrome.tabs.sendMessage(tabId, request, r => {
        if (chrome.runtime.lastError) sendResponse({ error: chrome.runtime.lastError.message });
        else sendResponse(r);
      });
    });
    return true;
  }

  // ── SCREENSHOT: capture active tab ─────────────────────────
  if (request.type === 'PLUTO_SCREENSHOT') {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, tabs => {
      const tabId = tabs[0]?.id;
      if (!tabId) { sendResponse({ error: 'no tab' }); return; }
      chrome.tabs.captureVisibleTab(tabs[0].windowId, { format: 'jpeg', quality: 35 }, dataUrl => {
        if (chrome.runtime.lastError) sendResponse({ error: chrome.runtime.lastError.message });
        else sendResponse({ dataUrl });
      });
    });
    return true;
  }

  // ── AI PROXY: content scripts can't reach localhost from HTTPS pages ──
  // Route through background (extension origin) which is exempt from PNA restrictions
  if (request.type === 'PLUTO_AI_REQUEST') {
    fetch('https://pluto-server-production.up.railway.app/ask-aria', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request.payload)
    })
      .then(r => r.json())
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  // ── PROGRESS / SELECTION: relay from content script → popup ──
  if (request.type === 'PLUTO_PROGRESS' || request.type === 'PLUTO_ASK_SELECTION') {
    chrome.runtime.sendMessage(request).catch(() => {});
    return false;
  }
});