// ── STATE ─────────────────────────────────────────────────────
const STATE = {
  coins: parseInt(localStorage.getItem('pq_coins') || '0'),
  xp:    parseInt(localStorage.getItem('pq_xp')    || '0'),
  docs:  JSON.parse(localStorage.getItem('pluto_docs') || '[]'),
  citations: JSON.parse(localStorage.getItem('pluto_citations') || '[]'),
  citeFmt: localStorage.getItem('pluto_fmt') || 'MLA',
  activeTab: 'ai',
  activeView: 'write',
  aiHistory: []
};

const SERVER = 'https://pluto-server-production.up.railway.app/ask-aria';

// ── COINS / XP ────────────────────────────────────────────────
function addReward(coins, xp, label) {
  STATE.coins += coins; STATE.xp += xp;
  localStorage.setItem('pq_coins', STATE.coins);
  localStorage.setItem('pq_xp',    STATE.xp);
  updateCoinDisplay();
  showReward(coins, xp, label);
}

function updateCoinDisplay() {
  document.getElementById('coin-display').textContent = STATE.coins;
  const lvl = Math.floor(STATE.xp / 100) + 1;
  document.getElementById('xp-display').textContent = `LVL ${lvl} · ${STATE.xp} XP`;
}

function showReward(coins, xp, label) {
  const p = document.getElementById('reward-popup');
  document.getElementById('rp-icon').textContent = coins > 20 ? '🏆' : '🪙';
  document.getElementById('rp-title').textContent = `+${coins} coins · +${xp} XP`;
  document.getElementById('rp-sub').textContent = label;
  p.classList.add('show');
  setTimeout(() => p.classList.remove('show'), 2800);
}

// Strip markdown symbols so AI text renders cleanly
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

// ── SERVER CALL ───────────────────────────────────────────────
async function askPluto(message, systemHint = '') {
  const res = await fetch(SERVER, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: systemHint ? systemHint + '\n\n' + message : message,
      profile: { name: 'ResearchUser', grade: 'Student', course: 'Research' },
      pageContext: { url: location.href, title: document.title, text: getEditorText().slice(0, 2000) },
      history: STATE.aiHistory.slice(-6),
      tutorMode: false
    })
  });
  const d = await res.json();
  return d.reply;
}

async function askJSON(message) {
  const reply = await askPluto(message);
  const s = reply.indexOf('['), e = reply.lastIndexOf(']');
  if (s === -1) throw new Error('No JSON');
  return JSON.parse(reply.slice(s, e + 1));
}

// ── EDITOR ────────────────────────────────────────────────────
const editor = document.getElementById('editor');

function execCmd(cmd) { document.execCommand(cmd, false, null); editor.focus(); }

function insertHeading(n) {
  document.execCommand('formatBlock', false, 'h' + n);
  editor.focus();
}
function insertBlockquote() {
  document.execCommand('formatBlock', false, 'blockquote');
  editor.focus();
}

function getEditorText() { return editor.innerText || ''; }
function getSelectedText() { return window.getSelection()?.toString().trim() || ''; }

// Word count
editor.addEventListener('input', () => {
  const words = getEditorText().trim().split(/\s+/).filter(w => w).length;
  document.getElementById('word-count').textContent = words + ' words';
  if (words > 0 && words % 100 === 0) addReward(5, 10, `${words} words written!`);
});

// Insert text at cursor or append
function insertAtCursor(text) {
  editor.focus();
  const sel = window.getSelection();
  if (sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node); range.collapse(true);
    sel.removeAllRanges(); sel.addRange(range);
  } else {
    editor.innerHTML += '<p>' + text.replace(/\n/g, '</p><p>') + '</p>';
  }
}

function replaceSelected(newText) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const el = document.createElement('span');
  el.textContent = newText;
  range.insertNode(el);
}

// ── SAVE / EXPORT ─────────────────────────────────────────────
function saveDoc() {
  const title = document.getElementById('doc-title').value || 'Untitled';
  const content = editor.innerHTML;
  const idx = STATE.docs.findIndex(d => d.title === title);
  if (idx >= 0) STATE.docs[idx] = { title, content, saved: Date.now() };
  else STATE.docs.push({ title, content, saved: Date.now() });
  localStorage.setItem('pluto_docs', JSON.stringify(STATE.docs));
  renderSavedDocs();
  addReward(5, 15, 'Document saved!');
}

function copyDoc() {
  navigator.clipboard.writeText(getEditorText()).catch(() => {});
  showReward(2, 5, 'Copied to clipboard!');
}

function downloadDoc() {
  const title = document.getElementById('doc-title').value || 'pluto-doc';
  const blob = new Blob([getEditorText()], { type: 'text/plain' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = title + '.txt'; a.click();
}

function renderSavedDocs() {
  const el = document.getElementById('saved-list');
  el.innerHTML = '';
  STATE.docs.slice(-5).reverse().forEach(doc => {
    const btn = document.createElement('button');
    btn.className = 'nav-btn';
    btn.innerHTML = `<span class="nb-icon">📄</span><span class="nb-label" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${doc.title}</span>`;
    btn.addEventListener('click', () => {
      document.getElementById('doc-title').value = doc.title;
      editor.innerHTML = doc.content;
    });
    el.appendChild(btn);
  });
}

// ── NAV VIEWS ─────────────────────────────────────────────────
document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn[data-view]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    STATE.activeView = btn.dataset.view;
    handleViewChange(btn.dataset.view);
  });
});

function handleViewChange(view) {
  const prompts = {
    write:     'Write an essay about ',
    research:  'Find sources about ',
    humanize:  'Humanize this text: ',
    outline:   'Create an outline for ',
    cite:      'Format citation for '
  };
  document.getElementById('rp-input').placeholder = (prompts[view] || 'Ask Pluto...') + '...';
  if (view === 'research') switchTab('sources');
  else if (view === 'cite') switchTab('citations');
  else switchTab('ai');
}

// ── RIGHT PANEL TABS ──────────────────────────────────────────
document.querySelectorAll('.rt-tab').forEach(t => {
  t.addEventListener('click', () => switchTab(t.dataset.tab));
});

function switchTab(tab) {
  STATE.activeTab = tab;
  document.querySelectorAll('.rt-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  renderRightPanel();
}

function renderRightPanel() {
  const body = document.getElementById('right-body');
  if (STATE.activeTab === 'ai')             renderAIPanel(body);
  else if (STATE.activeTab === 'sources')   renderSourcesPanel(body);
  else if (STATE.activeTab === 'citations') renderCitationsPanel(body);
}

// ── AI PANEL ──────────────────────────────────────────────────
function renderAIPanel(body) {
  body.innerHTML = '';

  const actions = [
    { label: '✍️ Write essay', prompt: 'Write a well-structured essay about: ' },
    { label: '📝 Improve writing', prompt: 'Improve and polish this text, make it more academic and clear:\n\n', useSelection: true },
    { label: '🧬 Humanize', prompt: 'Rewrite this to sound more natural and human-written, vary sentence structure, add personality:\n\n', useSelection: true },
    { label: '📋 Make outline', prompt: 'Create a detailed essay outline for: ' },
    { label: '🔍 Expand section', prompt: 'Expand and elaborate on this section with more detail:\n\n', useSelection: true },
    { label: '✂️ Summarize', prompt: 'Summarize this concisely:\n\n', useSelection: true },
    { label: '💡 Add examples', prompt: 'Add concrete examples and evidence to support:\n\n', useSelection: true },
    { label: '🎯 Fix grammar', prompt: 'Fix all grammar, spelling, and punctuation errors in:\n\n', useSelection: true },
  ];

  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:12px';
  actions.forEach(a => {
    const btn = document.createElement('button');
    btn.style.cssText = 'background:var(--s1);border:1px solid var(--b1);border-radius:8px;color:var(--mid);font-size:10.5px;font-weight:600;padding:8px 6px;cursor:pointer;transition:all .18s;font-family:\'DM Sans\',sans-serif;text-align:left';
    btn.textContent = a.label;
    btn.addEventListener('mouseover', () => { btn.style.background='var(--s2)'; btn.style.color='#fff'; });
    btn.addEventListener('mouseout',  () => { btn.style.background='var(--s1)'; btn.style.color='var(--mid)'; });
    btn.addEventListener('click', () => {
      const selected = getSelectedText();
      const base = a.useSelection && selected ? a.prompt + selected : a.prompt;
      document.getElementById('rp-input').value = base;
      document.getElementById('rp-input').focus();
    });
    grid.appendChild(btn);
  });
  body.appendChild(grid);

  const divider = document.createElement('div');
  divider.style.cssText = 'height:1px;background:var(--b1);margin-bottom:12px';
  body.appendChild(divider);

  STATE.aiHistory.forEach(msg => {
    const el = document.createElement('div');
    el.className = msg.sender === 'user' ? 'user-msg' : 'ai-msg';
    el.textContent = msg.sender === 'ai' ? cleanText(msg.text) : msg.text;
    body.appendChild(el);
  });
  body.scrollTop = body.scrollHeight;
}

// ── SOURCES PANEL ─────────────────────────────────────────────
let sourcesData = [];

function renderSourcesPanel(body) {
  body.innerHTML = `
    <div id="fmt-row">
      <button class="fmt-pill ${STATE.citeFmt==='MLA'?'on':''}" data-fmt="MLA">MLA</button>
      <button class="fmt-pill ${STATE.citeFmt==='APA'?'on':''}" data-fmt="APA">APA</button>
      <button class="fmt-pill ${STATE.citeFmt==='Chicago'?'on':''}" data-fmt="Chicago">Chicago</button>
    </div>
    <div id="sources-list"></div>`;

  body.querySelectorAll('.fmt-pill').forEach(p => {
    p.addEventListener('click', () => {
      STATE.citeFmt = p.dataset.fmt;
      localStorage.setItem('pluto_fmt', STATE.citeFmt);
      renderSourcesPanel(body);
    });
  });

  renderSourceCards(body.querySelector('#sources-list'));
}

function renderSourceCards(container) {
  container.innerHTML = '';
  if (!sourcesData.length) {
    container.innerHTML = `<div style="font-size:11px;color:var(--dim);text-align:center;padding:20px 0">Ask Pluto to find sources on any topic</div>`;
    return;
  }
  sourcesData.forEach((s, i) => {
    const card = document.createElement('div');
    card.className = 'source-card';
    const titleHtml = s.url?.startsWith('http')
      ? `<a href="${s.url}" target="_blank" rel="noopener">${s.title}</a>`
      : s.title;
    card.innerHTML = `
      <div class="sc-title">${titleHtml}</div>
      <div class="sc-meta">${s.author||s.source} · ${s.year} · ${s.type||'source'}${s.url?.startsWith('http')?' · 🔗':''}</div>
      <div class="sc-sum">${s.summary}</div>
      <div class="sc-cite">${s.citation}</div>
      <div class="sc-btns">
        <button class="sc-btn" id="copy-${i}">Copy ${STATE.citeFmt}</button>
        <button class="sc-btn" id="save-${i}">Save</button>
        <button class="sc-btn" id="insert-${i}">Insert</button>
      </div>`;
    container.appendChild(card);

    card.querySelector(`#copy-${i}`).addEventListener('click', e => {
      navigator.clipboard.writeText(s.citation).catch(()=>{});
      e.target.textContent = 'Copied!';
      setTimeout(() => e.target.textContent = 'Copy '+STATE.citeFmt, 1500);
    });
    card.querySelector(`#save-${i}`).addEventListener('click', () => {
      STATE.citations.push({ ...s, savedAt: Date.now() });
      localStorage.setItem('pluto_citations', JSON.stringify(STATE.citations));
      addReward(8, 20, 'Source saved!');
    });
    card.querySelector(`#insert-${i}`).addEventListener('click', () => {
      insertAtCursor('\n' + s.citation + '\n');
      addReward(5, 10, 'Citation inserted!');
    });
  });
}

// ── CITATIONS PANEL ───────────────────────────────────────────
function renderCitationsPanel(body) {
  body.innerHTML = '';
  if (!STATE.citations.length) {
    body.innerHTML = '<div style="font-size:11px;color:var(--dim);text-align:center;padding:20px 0">No saved citations yet</div>';
    return;
  }
  const exportBtn = document.createElement('button');
  exportBtn.style.cssText = 'width:100%;background:var(--s1);border:1px solid var(--b1);border-radius:9px;color:var(--mid);font-size:11px;font-weight:600;padding:9px;cursor:pointer;margin-bottom:12px;font-family:\'DM Sans\',sans-serif';
  exportBtn.textContent = '📋 Export All Citations';
  exportBtn.addEventListener('click', () => {
    const text = STATE.citations.map(c => c.citation).join('\n\n');
    navigator.clipboard.writeText(text).catch(()=>{});
    insertAtCursor('\n\nWorks Cited\n\n' + text);
    addReward(15, 30, 'Bibliography exported!');
  });
  body.appendChild(exportBtn);

  STATE.citations.forEach((c, i) => {
    const card = document.createElement('div');
    card.className = 'source-card';
    card.innerHTML = `
      <div class="sc-title">${c.title}</div>
      <div class="sc-meta">${c.author||c.source} · ${c.year}</div>
      <div class="sc-cite">${c.citation}</div>
      <div class="sc-btns">
        <button class="sc-btn" id="cc-${i}">Copy</button>
        <button class="sc-btn" id="ci-${i}">Insert</button>
        <button class="sc-btn" id="cd-${i}" style="color:var(--red)">Delete</button>
      </div>`;
    body.appendChild(card);
    card.querySelector(`#cc-${i}`).addEventListener('click', e => {
      navigator.clipboard.writeText(c.citation).catch(()=>{});
      e.target.textContent='Copied!'; setTimeout(()=>e.target.textContent='Copy',1500);
    });
    card.querySelector(`#ci-${i}`).addEventListener('click', () => insertAtCursor('\n'+c.citation+'\n'));
    card.querySelector(`#cd-${i}`).addEventListener('click', () => {
      STATE.citations.splice(i, 1);
      localStorage.setItem('pluto_citations', JSON.stringify(STATE.citations));
      renderCitationsPanel(body);
    });
  });
}

// ── AI INPUT HANDLER ──────────────────────────────────────────
document.getElementById('rp-send').addEventListener('click', handleAIInput);
document.getElementById('rp-input').addEventListener('keydown', e => { if(e.key==='Enter'&&!e.shiftKey) handleAIInput(); });

async function handleAIInput() {
  const input = document.getElementById('rp-input');
  const query = input.value.trim();
  if (!query) return;

  const send = document.getElementById('rp-send');
  send.disabled = true; input.value = '';

  STATE.aiHistory.push({ text: query, sender: 'user' });

  const view = STATE.activeView;

  if (view === 'research' || query.toLowerCase().includes('find source') || query.toLowerCase().includes('research ')) {
    await handleResearch(query);
  } else if (view === 'humanize' || query.toLowerCase().startsWith('humanize')) {
    await handleHumanize(query);
  } else if (view === 'outline' || query.toLowerCase().includes('outline')) {
    await handleOutline(query);
  } else if (view === 'cite' || query.toLowerCase().includes('citation') || query.toLowerCase().includes('cite')) {
    await handleCite(query);
  } else {
    await handleGeneral(query);
  }

  send.disabled = false;
  if (STATE.activeTab === 'ai') renderRightPanel();
}

// General writing AI
async function handleGeneral(query) {
  const body = document.getElementById('right-body');
  const thinking = document.createElement('div');
  thinking.className = 'ai-msg dots';
  thinking.textContent = 'Pluto is writing';
  body.appendChild(thinking);
  body.scrollTop = body.scrollHeight;

  try {
    const isWrite = query.toLowerCase().includes('write') || query.toLowerCase().includes('essay') || query.toLowerCase().includes('paragraph');
    const reply = await askPluto(query);
    const cleaned = cleanText(reply);
    thinking.remove();
    STATE.aiHistory.push({ text: cleaned, sender: 'ai' });

    if (isWrite) {
      // Insert directly into the document — no button needed
      insertAtCursor(cleaned);
      addReward(15, 25, 'Essay inserted!');
      const msgEl = document.createElement('div');
      msgEl.className = 'ai-msg';
      msgEl.textContent = 'Done — check your document.';
      body.appendChild(msgEl);
    } else {
      const msgEl = document.createElement('div');
      msgEl.className = 'ai-msg';
      msgEl.textContent = cleaned;
      body.appendChild(msgEl);
    }
    body.scrollTop = body.scrollHeight;
  } catch {
    thinking.textContent = 'Server offline — start node server.js';
  }
}

// Research / sources
async function handleResearch(query) {
  switchTab('sources');
  const body = document.getElementById('right-body');
  body.innerHTML = `<div style="font-size:11px;color:var(--mid);font-family:'DM Mono',monospace;padding:8px 0" class="dots">Finding sources</div>`;

  try {
    const topic = query.replace(/find sources (on|about|for)?/i, '').replace(/research/i, '').trim() || query;
    const fmt = STATE.citeFmt;
    const raw = await askPluto(`Find 5 real, verifiable academic sources on: "${topic}".
Return ONLY a JSON array, no markdown, no preamble:
[{"title":"...","author":"...","source":"...","year":"2018-2024","url":"https://real-url-if-known","citation":"${fmt} formatted citation","summary":"1-2 sentences about what this covers","type":"journal|gov|news|edu"}]`);

    const s = raw.indexOf('['), e = raw.lastIndexOf(']');
    sourcesData = JSON.parse(raw.slice(s, e + 1));
    STATE.aiHistory.push({ text: `Found ${sourcesData.length} sources on "${topic}"`, sender: 'ai' });

    renderSourcesPanel(body);
    addReward(20, 40, `${sourcesData.length} sources found!`);
  } catch (err) {
    body.innerHTML = `<div style="font-size:11px;color:var(--red)">Failed — check server. ${err.message}</div>`;
  }
}

// Humanizer
async function handleHumanize(query) {
  const text = getSelectedText() || getEditorText();
  if (!text || text.length < 20) {
    const body = document.getElementById('right-body');
    const msg = document.createElement('div');
    msg.className = 'ai-msg';
    msg.textContent = 'Select the text you want to humanize first, then click Humanize again.';
    body.appendChild(msg); return;
  }

  const body = document.getElementById('right-body');
  const thinking = document.createElement('div');
  thinking.className = 'ai-msg dots'; thinking.textContent = 'Humanizing';
  body.appendChild(thinking); body.scrollTop = body.scrollHeight;

  try {
    const humanized = await askPluto(`Rewrite the following text to sound completely natural and human-written.
Rules:
- Vary sentence length dramatically (mix short punchy sentences with longer complex ones)
- Use contractions naturally (it's, don't, isn't, we're)
- Add occasional transition phrases like "Here's the thing", "What's interesting is", "In other words"
- Remove repetitive phrasing and overly formal language
- Keep all the key information and arguments
- Sound like a smart student wrote this, not an AI
- Do NOT add disclaimers or meta-commentary

Text to humanize:
${text.slice(0, 3000)}`);

    const cleanedHumanized = cleanText(humanized);
    thinking.remove();
    STATE.aiHistory.push({ text: cleanedHumanized, sender: 'ai' });

    // Replace selected text (or full doc) directly
    if (getSelectedText()) replaceSelected(cleanedHumanized);
    else { editor.innerHTML = ''; insertAtCursor(cleanedHumanized); }
    addReward(10, 20, 'Text humanized!');

    const msgEl = document.createElement('div');
    msgEl.className = 'ai-msg';
    msgEl.textContent = 'Done — text replaced in your document.';
    body.appendChild(msgEl);
    body.scrollTop = body.scrollHeight;
    addReward(8, 15, 'Humanization complete!');
  } catch {
    thinking.textContent = 'Server offline.';
  }
}

// Outline builder
async function handleOutline(query) {
  const topic = query.replace(/outline for|make an outline|create an outline/gi, '').trim() || query;
  const body = document.getElementById('right-body');
  const thinking = document.createElement('div');
  thinking.className = 'ai-msg dots'; thinking.textContent = 'Building outline';
  body.appendChild(thinking); body.scrollTop = body.scrollHeight;

  try {
    const outline = await askPluto(`Create a detailed essay outline for: "${topic}"
Format it clearly with:
- Title
- Thesis statement
- I. Introduction
  - Hook
  - Background
  - Thesis
- II. Body Paragraph 1 (with topic sentence + 3 supporting points)
- III. Body Paragraph 2 (same)
- IV. Body Paragraph 3 (same)
- V. Conclusion
  - Restate thesis
  - Final thought`);

    const cleanedOutline = cleanText(outline);
    thinking.remove();
    STATE.aiHistory.push({ text: cleanedOutline, sender: 'ai' });

    // Insert outline directly into document
    insertAtCursor(cleanedOutline);
    addReward(10, 20, 'Outline inserted!');

    const msgEl = document.createElement('div');
    msgEl.className = 'ai-msg';
    msgEl.textContent = 'Outline added to your document.';
    body.appendChild(msgEl);
    body.scrollTop = body.scrollHeight;
    addReward(8, 15, 'Outline created!');
  } catch { thinking.textContent = 'Server offline.'; }
}

// Citation formatter
async function handleCite(query) {
  switchTab('citations');
  const body = document.getElementById('right-body');
  const thinking = document.createElement('div');
  thinking.className = 'ai-msg dots'; thinking.textContent = 'Formatting citation';
  body.appendChild(thinking);

  try {
    const cite = await askPluto(`Format this as a proper ${STATE.citeFmt} citation. Return ONLY the formatted citation, nothing else: ${query}`);
    thinking.remove();
    STATE.citations.push({ title: query.slice(0, 50), author: '', source: '', year: '', citation: cite, savedAt: Date.now() });
    localStorage.setItem('pluto_citations', JSON.stringify(STATE.citations));
    renderCitationsPanel(body);
    addReward(5, 10, 'Citation saved!');
  } catch { thinking.textContent = 'Server offline.'; }
}

// ── TOOLBAR FORMATTING ────────────────────────────────────────
editor.addEventListener('keyup', updateToolbarState);
editor.addEventListener('mouseup', updateToolbarState);
function updateToolbarState() {
  ['bold','italic','underline'].forEach(cmd => {
    document.querySelector(`.tb-btn`)?.classList.toggle('active', document.queryCommandState(cmd));
  });
}

// ── KEYBOARD SHORTCUTS ────────────────────────────────────────
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveDoc(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    const sel = getSelectedText();
    if (sel) {
      document.getElementById('rp-input').value = 'Improve this: ' + sel;
      document.getElementById('rp-input').focus();
    }
  }
});

// ── TOOLBAR EVENT BINDINGS (CSP-safe, replaces inline onclick) ──
document.querySelectorAll('.tb-btn[data-cmd]').forEach(b =>
  b.addEventListener('click', () => execCmd(b.dataset.cmd)));
document.querySelectorAll('.tb-btn[data-heading]').forEach(b =>
  b.addEventListener('click', () => insertHeading(parseInt(b.dataset.heading))));
document.querySelector('.tb-btn[data-action="ul"]')?.addEventListener('click', () => execCmd('insertUnorderedList'));
document.querySelector('.tb-btn[data-action="ol"]')?.addEventListener('click', () => execCmd('insertOrderedList'));
document.querySelector('.tb-btn[data-action="bq"]')?.addEventListener('click', insertBlockquote);
document.getElementById('tb-save').addEventListener('click', saveDoc);
document.getElementById('tb-copy').addEventListener('click', copyDoc);
document.getElementById('tb-download').addEventListener('click', downloadDoc);

// ── INIT ──────────────────────────────────────────────────────
updateCoinDisplay();
renderSavedDocs();
renderAIPanel(document.getElementById('right-body'));

STATE.aiHistory.push({
  text: "Welcome to Pluto Research Hub! I can write essays, find real sources, humanize your text, build outlines, and format citations. What are you working on?",
  sender: 'ai'
});
renderRightPanel();
