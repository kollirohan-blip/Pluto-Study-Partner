// ── CONFIG ────────────────────────────────────────────────────
const API = 'https://pluto-server-production.up.railway.app';

const STATE = {
  coins:     parseInt(localStorage.getItem('pq_coins') || '0'),
  xp:        parseInt(localStorage.getItem('pq_xp')    || '0'),
  docs:      JSON.parse(localStorage.getItem('pluto_docs')      || '[]'),
  citations: JSON.parse(localStorage.getItem('pluto_citations') || '[]'),
  citeFmt:   localStorage.getItem('pluto_fmt') || 'MLA',
  activeTab:  'ai',
  activeView: 'write',
  aiHistory:  [],
  sourcesData: [],
  analysis:    null,
  theses:      [],
  selectedThesis: null,
  wordTarget:  800,
  essayCfg: { type: 'argumentative', level: 'undergraduate', tone: 'academic' },
  collegeCfg: { prompt: '', wordTarget: 650 },
  researchCfg: { type: 'research', level: 'graduate', tone: 'academic' },
};

// ── REWARDS ───────────────────────────────────────────────────
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

// ── API HELPERS ───────────────────────────────────────────────
async function apiPost(path, body) {
  const res = await fetch(API + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return res.json();
}

async function askPluto(message) {
  const d = await apiPost('/ask-aria', {
    message,
    profile: { name: 'EssayUser', grade: 'Student', course: 'Writing' },
    pageContext: { url: location.href, title: document.title, text: getEditorText().slice(0, 2000) },
    history: STATE.aiHistory.slice(-6),
    tutorMode: false
  });
  return d.reply;
}

// Strip markdown for plain display
function cleanText(t) {
  if (!t) return '';
  return t
    .replace(/\*\*\*([\s\S]*?)\*\*\*/g, '$1')
    .replace(/\*\*([\s\S]*?)\*\*/g, '$1')
    .replace(/\*([\s\S]*?)\*/g,     '$1')
    .replace(/__([\s\S]*?)__/g,     '$1')
    .replace(/_([\s\S]*?)_/g,       '$1')
    .replace(/^#{1,6}\s+/gm,        '')
    .replace(/```[a-z]*\n?([\s\S]*?)```/g, '$1')
    .replace(/`([^`]+)`/g,          '$1')
    .trim();
}

// Render markdown subset into HTML for editor insertion
function mdToHtml(text) {
  return text
    .replace(/^### (.+)$/gm,  '<h3>$1</h3>')
    .replace(/^## (.+)$/gm,   '<h2>$1</h2>')
    .replace(/^# (.+)$/gm,    '<h1>$1</h1>')
    .replace(/\*\*([\s\S]*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([\s\S]*?)\*/g,     '<em>$1</em>')
    .replace(/^- (.+)$/gm,    '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, s => `<ul>${s}</ul>`)
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/^(?!<[hup])/gm, s => s ? `<p>${s}</p>` : '')
    .replace(/<p><\/p>/g, '');
}

// ── EDITOR ────────────────────────────────────────────────────
const editor = document.getElementById('editor');

function execCmd(cmd) { document.execCommand(cmd, false, null); editor.focus(); }
function insertHeading(n) { document.execCommand('formatBlock', false, 'h' + n); editor.focus(); }
function insertBlockquote() { document.execCommand('formatBlock', false, 'blockquote'); editor.focus(); }
function getEditorText() { return editor.innerText || ''; }
function getSelectedText() { return window.getSelection()?.toString().trim() || ''; }

function insertAtCursor(html) {
  editor.focus();
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const div = document.createElement('div');
    div.innerHTML = html;
    const frag = document.createDocumentFragment();
    let node;
    while ((node = div.firstChild)) frag.appendChild(node);
    range.insertNode(frag);
    range.collapse(false);
    sel.removeAllRanges(); sel.addRange(range);
  } else {
    editor.innerHTML += html;
  }
  updateWordCount();
}

function replaceSelected(text) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const span = document.createElement('span');
  span.textContent = text;
  range.insertNode(span);
}

// Word count + progress bar
let wcTarget = parseInt(localStorage.getItem('pq_wc_target') || '800');
STATE.wordTarget = wcTarget;
document.getElementById('wc-target-btn').textContent = `/ ${wcTarget}`;

function updateWordCount() {
  const words = getEditorText().trim().split(/\s+/).filter(w => w).length;
  document.getElementById('word-count').textContent = words + ' words';
  const pct = Math.min((words / wcTarget) * 100, 100);
  document.getElementById('wc-bar').style.width = pct + '%';
  document.getElementById('wc-bar').style.background = pct >= 100 ? 'var(--green)' : pct > 60 ? 'var(--blue)' : 'var(--purple)';
  if (words > 0 && words % 100 === 0) addReward(5, 10, `${words} words written!`);

  // College counter
  const cc = document.getElementById('college-counter');
  if (STATE.activeView === 'college') {
    cc.style.display = 'block';
    const colWC = words;
    const limit = 650;
    cc.textContent = `${colWC} / ${limit} words`;
    cc.className = colWC > limit ? 'over' : colWC > 580 ? 'warn' : '';
  } else {
    cc.style.display = 'none';
  }
}
editor.addEventListener('input', updateWordCount);

document.getElementById('wc-target-btn').addEventListener('click', () => {
  showModal('Set Word Count Target', 'Enter your target word count for this essay.', () => {
    const val = parseInt(document.getElementById('m-wc').value);
    if (val > 0) {
      wcTarget = val; STATE.wordTarget = val;
      localStorage.setItem('pq_wc_target', val);
      document.getElementById('wc-target-btn').textContent = `/ ${val}`;
      updateWordCount();
    }
    closeModal();
  }, `<input class="modal-input" id="m-wc" type="number" placeholder="e.g. 1000" value="${wcTarget}"/>`);
});

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
  const title = document.getElementById('doc-title').value || 'pluto-essay';
  const text = getEditorText();
  const blob = new Blob([text], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = title + '.txt'; a.click();
}

function renderSavedDocs() {
  const el = document.getElementById('saved-list');
  el.innerHTML = '';
  STATE.docs.slice(-6).reverse().forEach(doc => {
    const btn = document.createElement('button');
    btn.className = 'nav-btn';
    btn.innerHTML = `<span class="nb-icon">📄</span><span class="nb-label">${doc.title}</span>`;
    btn.addEventListener('click', () => {
      document.getElementById('doc-title').value = doc.title;
      editor.innerHTML = doc.content;
      updateWordCount();
    });
    el.appendChild(btn);
  });
}

// ── NAV ───────────────────────────────────────────────────────
document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn[data-view]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    STATE.activeView = btn.dataset.view;
    handleViewChange(btn.dataset.view);
  });
});

function handleViewChange(view) {
  if (view === 'sources')    switchTab('sources');
  else if (view === 'analyze') switchTab('analysis');
  else if (view === 'cite')    switchTab('citations');
  else switchTab('ai');
  renderRightPanel();
  updateWordCount();
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
  if      (STATE.activeTab === 'ai')        renderWritePanel(body);
  else if (STATE.activeTab === 'sources')   renderSourcesPanel(body);
  else if (STATE.activeTab === 'analysis')  renderAnalysisPanel(body);
  else if (STATE.activeTab === 'citations') renderCitationsPanel(body);
}

// ── WRITE PANEL ───────────────────────────────────────────────
function renderWritePanel(body) {
  const v = STATE.activeView;
  if (v === 'college')        renderCollegePanel(body);
  else if (v === 'research-paper') renderResearchPaperPanel(body);
  else if (v === 'thesis')    renderThesisPanel(body);
  else if (v === 'humanize')  renderHumanizePanel(body);
  else if (v === 'outline')   renderOutlinePanel(body);
  else if (v === 'analyze')   renderAnalysisPanel(body);
  else if (v === 'cite')      renderCitationsPanel(body);
  else                        renderEssayWriterPanel(body);
}

function cfgPills(label, options, stateKey, cfgObj, callback) {
  const wrap = document.createElement('div');
  wrap.className = 'cfg-section';
  wrap.innerHTML = `<div class="cfg-label">${label}</div><div class="cfg-pills">${
    options.map(o => `<button class="cfg-pill${cfgObj[stateKey] === o.v ? ' on' : ''}" data-v="${o.v}">${o.label}</button>`).join('')
  }</div>`;
  wrap.querySelectorAll('.cfg-pill').forEach(p => {
    p.addEventListener('click', () => {
      cfgObj[stateKey] = p.dataset.v;
      wrap.querySelectorAll('.cfg-pill').forEach(x => x.classList.remove('on'));
      p.classList.add('on');
      if (callback) callback(p.dataset.v);
    });
  });
  return wrap;
}

function renderEssayWriterPanel(body) {
  body.innerHTML = '';

  const actions = [
    { label: '✍️ Write essay',     action: 'generate' },
    { label: '🔍 Expand section',  action: 'expand', useSelection: true },
    { label: '✨ Polish writing',  action: 'polish', useSelection: true },
    { label: '💡 Add examples',    action: 'examples', useSelection: true },
    { label: '✂️ Summarize',       action: 'summarize', useSelection: true },
    { label: '🎯 Fix grammar',     action: 'grammar', useSelection: true },
  ];

  const grid = document.createElement('div');
  grid.className = 'action-grid';
  actions.forEach(a => {
    const btn = document.createElement('button');
    btn.className = 'action-btn';
    btn.textContent = a.label;
    btn.addEventListener('click', () => {
      if (a.action === 'generate') {
        startGenerateEssay();
      } else {
        const sel = getSelectedText();
        const prompts = {
          expand:    `Expand and elaborate on this with more depth, evidence, and analysis:\n\n`,
          polish:    `Polish and improve this text — better word choice, stronger sentences, academic tone:\n\n`,
          examples:  `Add 2-3 concrete examples and evidence to support this:\n\n`,
          summarize: `Summarize this concisely in 2-3 sentences:\n\n`,
          grammar:   `Fix all grammar, spelling, and punctuation errors:\n\n`,
        };
        if (sel) {
          document.getElementById('rp-input').value = prompts[a.action] + sel;
        } else {
          document.getElementById('rp-input').value = prompts[a.action];
        }
        document.getElementById('rp-input').focus();
      }
    });
    grid.appendChild(btn);
  });
  body.appendChild(grid);

  // Essay config
  body.appendChild(cfgPills('Essay Type', [
    {v:'argumentative',label:'Argue'},
    {v:'analytical',   label:'Analyze'},
    {v:'expository',   label:'Explain'},
    {v:'compare',      label:'Compare'},
  ], 'type', STATE.essayCfg));

  body.appendChild(cfgPills('Level', [
    {v:'highschool',    label:'High School'},
    {v:'undergraduate', label:'College'},
    {v:'graduate',      label:'Graduate'},
  ], 'level', STATE.essayCfg));

  body.appendChild(cfgPills('Tone', [
    {v:'academic',   label:'Academic'},
    {v:'persuasive', label:'Persuasive'},
    {v:'neutral',    label:'Neutral'},
  ], 'tone', STATE.essayCfg));

  const genBtn = document.createElement('button');
  genBtn.className = 'generate-btn';
  genBtn.id = 'gen-essay-btn';
  genBtn.textContent = '✍️ Generate Full Essay';
  genBtn.addEventListener('click', startGenerateEssay);
  body.appendChild(genBtn);

  const divider = document.createElement('div');
  divider.className = 'panel-divider';
  divider.style.margin = '14px 0 10px';
  body.appendChild(divider);

  const heading = document.createElement('div');
  heading.className = 'panel-heading';
  heading.textContent = 'AI CHAT';
  body.appendChild(heading);

  STATE.aiHistory.forEach(msg => {
    const el = document.createElement('div');
    el.className = msg.sender === 'user' ? 'user-msg' : 'ai-msg';
    el.textContent = msg.sender === 'ai' ? cleanText(msg.text) : msg.text;
    body.appendChild(el);
  });
  body.scrollTop = body.scrollHeight;
}

async function startGenerateEssay() {
  const topic = document.getElementById('doc-title').value.trim() ||
    await promptTopic('What is the essay topic?', 'Essay topic or prompt...');
  if (!topic) return;

  const btn = document.getElementById('gen-essay-btn');
  if (btn) btn.disabled = true;

  const body = document.getElementById('right-body');
  const loadEl = document.createElement('div');
  loadEl.className = 'loading-row';
  loadEl.innerHTML = '<div class="spinner"></div><span class="dots">Writing your essay</span>';
  body.appendChild(loadEl);
  body.scrollTop = body.scrollHeight;

  try {
    const sources = STATE.sourcesData.slice(0, 4);
    const data = await apiPost('/essay/write', {
      topic,
      type:      STATE.essayCfg.type,
      level:     STATE.essayCfg.level,
      tone:      STATE.essayCfg.tone,
      wordCount: STATE.wordTarget,
      sources
    });
    loadEl.remove();
    insertAtCursor(mdToHtml(data.essay));
    if (!document.getElementById('doc-title').value) {
      document.getElementById('doc-title').value = topic;
    }
    addReward(30, 60, 'Essay generated!');
    const msg = document.createElement('div');
    msg.className = 'ai-msg';
    msg.textContent = `Essay written (${data.essay.trim().split(/\s+/).length} words). Edit freely or use the tools to improve it.`;
    body.appendChild(msg);
    body.scrollTop = body.scrollHeight;
  } catch (err) {
    loadEl.remove();
    showError(body, err.message);
  }
  if (btn) btn.disabled = false;
}

// ── COLLEGE APP PANEL ─────────────────────────────────────────
const COMMON_APP_PROMPTS = [
  'Some students have a background, identity, interest, or talent that is so meaningful they believe their application would be incomplete without it.',
  'The lessons we take from obstacles we encounter can be fundamental to later success. Recount a challenge you faced and how you overcame it.',
  'Reflect on a time when you questioned or challenged a belief or idea. What prompted your thinking and what was the outcome?',
  'Reflect on something that someone has done for you that has made you happy or thankful in a surprising way.',
  'Discuss an accomplishment, event, or realization that sparked a period of personal growth.',
  'Describe a topic, idea, or concept you find so engaging that it makes you lose all track of time.',
  'Share an essay on any topic of your choice.'
];

function renderCollegePanel(body) {
  body.innerHTML = '';

  const heading = document.createElement('div');
  heading.className = 'panel-heading';
  heading.textContent = 'COMMON APP ESSAY';
  body.appendChild(heading);

  const promptSect = document.createElement('div');
  promptSect.className = 'cfg-section';
  promptSect.innerHTML = '<div class="cfg-label">Prompt</div>';

  const sel = document.createElement('select');
  sel.style.cssText = 'width:100%;background:var(--s1);border:1px solid var(--b1);border-radius:7px;color:#fff;padding:7px 10px;font-size:11px;font-family:\'DM Sans\',sans-serif;outline:none;margin-bottom:8px;cursor:pointer';
  sel.innerHTML = COMMON_APP_PROMPTS.map((p, i) => `<option value="${i}">${i + 1}. ${p.slice(0, 60)}…</option>`).join('');
  sel.addEventListener('change', () => {
    STATE.collegeCfg.prompt = COMMON_APP_PROMPTS[parseInt(sel.value)];
    promptDisplay.textContent = COMMON_APP_PROMPTS[parseInt(sel.value)];
  });
  promptSect.appendChild(sel);

  const promptDisplay = document.createElement('div');
  promptDisplay.style.cssText = 'font-size:10.5px;color:var(--mid);line-height:1.5;background:var(--s1);border:1px solid var(--b1);border-radius:7px;padding:8px 10px;margin-bottom:8px';
  promptDisplay.textContent = COMMON_APP_PROMPTS[0];
  STATE.collegeCfg.prompt = COMMON_APP_PROMPTS[0];
  promptSect.appendChild(promptDisplay);
  body.appendChild(promptSect);

  const contextSect = document.createElement('div');
  contextSect.className = 'cfg-section';
  contextSect.innerHTML = '<div class="cfg-label">Your Story / Context (optional)</div>';
  const ctx = document.createElement('textarea');
  ctx.className = 'cfg-input';
  ctx.rows = 3;
  ctx.id = 'college-context';
  ctx.placeholder = 'Key details, experiences, themes you want included...';
  contextSect.appendChild(ctx);
  body.appendChild(contextSect);

  const genBtn = document.createElement('button');
  genBtn.className = 'generate-btn';
  genBtn.textContent = '🎓 Write My College Essay';
  genBtn.addEventListener('click', async () => {
    genBtn.disabled = true;
    const context = document.getElementById('college-context')?.value || '';
    const topic = context || 'college application personal statement';
    const loadEl = document.createElement('div');
    loadEl.className = 'loading-row';
    loadEl.innerHTML = '<div class="spinner"></div><span class="dots">Writing your personal statement</span>';
    body.appendChild(loadEl); body.scrollTop = body.scrollHeight;
    try {
      const data = await apiPost('/essay/write', {
        topic,
        type: 'college',
        level: 'undergraduate',
        tone: 'personal',
        wordCount: 650,
        collegePrompt: STATE.collegeCfg.prompt,
        sources: []
      });
      loadEl.remove();
      insertAtCursor(mdToHtml(data.essay));
      if (!document.getElementById('doc-title').value) {
        document.getElementById('doc-title').value = 'College Essay';
      }
      addReward(40, 80, 'College essay written!');
      const wc = data.essay.trim().split(/\s+/).length;
      const msg = document.createElement('div');
      msg.className = 'ai-msg';
      msg.textContent = `${wc} words written. Edit to make it yours — add specific details, names, and moments that only you would know.`;
      body.appendChild(msg); body.scrollTop = body.scrollHeight;
    } catch (err) { loadEl.remove(); showError(body, err.message); }
    genBtn.disabled = false;
  });
  body.appendChild(genBtn);

  const tips = document.createElement('div');
  tips.style.cssText = 'background:rgba(94,248,160,.04);border:1px solid rgba(94,248,160,.12);border-radius:9px;padding:10px 12px;margin-top:10px';
  tips.innerHTML = `<div style="font-size:9px;color:var(--green);font-family:'DM Mono',monospace;font-weight:700;margin-bottom:5px">TIPS FOR COLLEGE ESSAYS</div>
    <ul style="font-size:10.5px;color:var(--mid);line-height:1.6;padding-left:14px">
      <li>Start with a specific scene or moment, not a broad statement</li>
      <li>Show, don't tell — use sensory details</li>
      <li>Reveal your character and how you think</li>
      <li>Avoid clichés: "I learned that…", "This taught me…"</li>
      <li>End with a forward-looking thought, not a summary</li>
    </ul>`;
  body.appendChild(tips);
}

// ── RESEARCH PAPER PANEL ──────────────────────────────────────
function renderResearchPaperPanel(body) {
  body.innerHTML = '';

  const heading = document.createElement('div');
  heading.className = 'panel-heading';
  heading.textContent = 'RESEARCH PAPER';
  body.appendChild(heading);

  body.appendChild(cfgPills('Level', [
    {v:'undergraduate', label:'Undergrad'},
    {v:'graduate',      label:'Graduate'},
  ], 'level', STATE.researchCfg));

  body.appendChild(cfgPills('Tone', [
    {v:'academic', label:'Scholarly'},
    {v:'neutral',  label:'Objective'},
  ], 'tone', STATE.researchCfg));

  const topicSect = document.createElement('div');
  topicSect.className = 'cfg-section';
  topicSect.innerHTML = '<div class="cfg-label">Research Question / Topic</div>';
  const inp = document.createElement('input');
  inp.className = 'cfg-input'; inp.id = 'rp-topic'; inp.placeholder = 'e.g. The impact of social media on adolescent mental health';
  topicSect.appendChild(inp); body.appendChild(topicSect);

  const info = document.createElement('div');
  info.style.cssText = 'font-size:10px;color:var(--mid);line-height:1.6;margin-bottom:10px';
  info.textContent = 'Generates: Abstract · Introduction · Literature Review · Analysis · Discussion · Conclusion. Find Sources first for citations.';
  body.appendChild(info);

  const genBtn = document.createElement('button');
  genBtn.className = 'generate-btn';
  genBtn.textContent = '📚 Generate Research Paper';
  genBtn.addEventListener('click', async () => {
    const topic = document.getElementById('rp-topic')?.value.trim();
    if (!topic) { showError(body, 'Enter a research topic first.'); return; }
    genBtn.disabled = true;
    const loadEl = document.createElement('div');
    loadEl.className = 'loading-row';
    loadEl.innerHTML = '<div class="spinner"></div><span class="dots">Drafting research paper</span>';
    body.appendChild(loadEl); body.scrollTop = body.scrollHeight;
    try {
      const data = await apiPost('/essay/write', {
        topic, type: 'research',
        level: STATE.researchCfg.level,
        tone: STATE.researchCfg.tone,
        wordCount: 1500,
        sources: STATE.sourcesData.slice(0, 5)
      });
      loadEl.remove();
      insertAtCursor(mdToHtml(data.essay));
      if (!document.getElementById('doc-title').value) document.getElementById('doc-title').value = topic;
      addReward(50, 100, 'Research paper generated!');
    } catch (err) { loadEl.remove(); showError(body, err.message); }
    genBtn.disabled = false;
  });
  body.appendChild(genBtn);
}

// ── THESIS PANEL ──────────────────────────────────────────────
function renderThesisPanel(body) {
  body.innerHTML = '';

  const heading = document.createElement('div');
  heading.className = 'panel-heading';
  heading.textContent = 'THESIS BUILDER';
  body.appendChild(heading);

  const topicSect = document.createElement('div');
  topicSect.className = 'cfg-section';
  topicSect.innerHTML = '<div class="cfg-label">Essay Topic</div>';
  const inp = document.createElement('input');
  inp.className = 'cfg-input'; inp.id = 'thesis-topic';
  inp.placeholder = 'e.g. Climate change policy in developing nations';
  inp.value = document.getElementById('doc-title').value || '';
  topicSect.appendChild(inp); body.appendChild(topicSect);

  body.appendChild(cfgPills('Essay Type', [
    {v:'argumentative',label:'Argumentative'},
    {v:'analytical',   label:'Analytical'},
    {v:'compare',      label:'Compare/Contrast'},
  ], 'type', STATE.essayCfg));

  const genBtn = document.createElement('button');
  genBtn.className = 'generate-btn';
  genBtn.textContent = '💡 Generate 3 Thesis Options';
  genBtn.addEventListener('click', async () => {
    const topic = document.getElementById('thesis-topic')?.value.trim();
    if (!topic) { showError(body, 'Enter a topic first.'); return; }
    genBtn.disabled = true;
    const loadEl = document.createElement('div');
    loadEl.className = 'loading-row';
    loadEl.innerHTML = '<div class="spinner"></div><span class="dots">Building thesis options</span>';
    body.appendChild(loadEl); body.scrollTop = body.scrollHeight;
    try {
      const data = await apiPost('/essay/thesis', { topic, type: STATE.essayCfg.type });
      loadEl.remove();
      STATE.theses = data.theses;
      renderThesisCards(body, data.theses);
      addReward(10, 20, 'Thesis options ready!');
    } catch (err) { loadEl.remove(); showError(body, err.message); }
    genBtn.disabled = false;
  });
  body.appendChild(genBtn);

  if (STATE.theses.length > 0) {
    const divider = document.createElement('div');
    divider.className = 'panel-divider';
    body.appendChild(divider);
    renderThesisCards(body, STATE.theses);
  }
}

function renderThesisCards(body, theses) {
  theses.forEach((t, i) => {
    const card = document.createElement('div');
    card.className = 'thesis-card' + (STATE.selectedThesis === i ? ' selected' : '');
    const scoreColor = t.strength >= 90 ? 'var(--green)' : t.strength >= 80 ? 'var(--blue)' : 'var(--gold)';
    card.innerHTML = `
      <div class="thesis-angle">${t.angle || 'Option ' + (i + 1)}</div>
      <div class="thesis-text">${t.thesis}</div>
      <div class="thesis-strength">
        <div class="ts-bar"><div class="ts-fill" style="width:${t.strength}%"></div></div>
        <span class="ts-val" style="color:${scoreColor}">${t.strength}/100</span>
      </div>
      <div class="thesis-tags">${(t.strengths || []).map(s => `<span class="thesis-tag">${s}</span>`).join('')}</div>
      ${t.outline ? `<div style="font-size:9.5px;color:var(--dim);margin-top:6px;line-height:1.5">${t.outline}</div>` : ''}`;
    card.addEventListener('click', () => {
      STATE.selectedThesis = i;
      body.querySelectorAll('.thesis-card').forEach((c, j) => c.classList.toggle('selected', j === i));
      insertAtCursor('<p>' + t.thesis + '</p>');
      addReward(5, 10, 'Thesis inserted!');
    });
    body.appendChild(card);
  });
}

// ── HUMANIZE PANEL ────────────────────────────────────────────
function renderHumanizePanel(body) {
  body.innerHTML = '';

  const heading = document.createElement('div');
  heading.className = 'panel-heading';
  heading.textContent = 'HUMANIZER';
  body.appendChild(heading);

  const info = document.createElement('div');
  info.className = 'ai-msg';
  info.textContent = 'Select text in the editor, then click Humanize. Or paste text below.';
  body.appendChild(info);

  const pasteSect = document.createElement('div');
  pasteSect.className = 'cfg-section';
  pasteSect.innerHTML = '<div class="cfg-label">Or Paste Text Here</div>';
  const ta = document.createElement('textarea');
  ta.className = 'cfg-input'; ta.id = 'humanize-input'; ta.rows = 4;
  ta.placeholder = 'Paste paragraph to humanize...';
  pasteSect.appendChild(ta); body.appendChild(pasteSect);

  const btn = document.createElement('button');
  btn.className = 'generate-btn';
  btn.textContent = '🧬 Humanize Text';
  btn.addEventListener('click', () => runHumanize(body, btn));
  body.appendChild(btn);
}

async function runHumanize(body, btn) {
  const sel = getSelectedText();
  const pasted = document.getElementById('humanize-input')?.value || '';
  const text = sel || pasted || getEditorText();
  if (text.length < 20) { showError(body, 'Select or paste text to humanize first.'); return; }

  btn.disabled = true;
  const loadEl = document.createElement('div');
  loadEl.className = 'loading-row';
  loadEl.innerHTML = '<div class="spinner"></div><span class="dots">Humanizing</span>';
  body.appendChild(loadEl);

  try {
    const reply = await askPluto(`Rewrite the following text to sound completely natural and human-written.
Rules:
- Vary sentence length dramatically (mix short punchy sentences with longer complex ones)
- Use contractions naturally (it's, don't, isn't, we're)
- Add occasional transition phrases like "Here's the thing", "What's interesting is", "In other words"
- Remove repetitive phrasing and overly formal AI-sounding language
- Keep all key information and arguments intact
- Sound like a smart student wrote this, not an AI
- Do NOT add disclaimers or meta-commentary

Text:
${text.slice(0, 3000)}`);

    loadEl.remove();
    const cleaned = cleanText(reply);
    if (sel) replaceSelected(cleaned);
    else if (pasted) {
      if (document.getElementById('humanize-input')) document.getElementById('humanize-input').value = cleaned;
    } else {
      editor.innerHTML = ''; insertAtCursor('<p>' + cleaned.replace(/\n/g, '</p><p>') + '</p>');
    }
    addReward(15, 30, 'Text humanized!');
    const msg = document.createElement('div');
    msg.className = 'ai-msg';
    msg.textContent = 'Done — text has been replaced.';
    body.appendChild(msg);
  } catch (err) { loadEl.remove(); showError(body, err.message); }
  btn.disabled = false;
}

// ── OUTLINE PANEL ─────────────────────────────────────────────
function renderOutlinePanel(body) {
  body.innerHTML = '';

  const heading = document.createElement('div');
  heading.className = 'panel-heading';
  heading.textContent = 'OUTLINE BUILDER';
  body.appendChild(heading);

  const topicSect = document.createElement('div');
  topicSect.className = 'cfg-section';
  topicSect.innerHTML = '<div class="cfg-label">Topic</div>';
  const inp = document.createElement('input');
  inp.className = 'cfg-input'; inp.id = 'outline-topic';
  inp.placeholder = 'Essay topic...';
  inp.value = document.getElementById('doc-title').value || '';
  topicSect.appendChild(inp); body.appendChild(topicSect);

  body.appendChild(cfgPills('Type', [
    {v:'argumentative',label:'Argumentative'},
    {v:'analytical',   label:'Analytical'},
    {v:'research',     label:'Research'},
    {v:'compare',      label:'Compare'},
  ], 'type', STATE.essayCfg));

  const btn = document.createElement('button');
  btn.className = 'generate-btn';
  btn.textContent = '📋 Build Outline';
  btn.addEventListener('click', async () => {
    const topic = document.getElementById('outline-topic')?.value.trim();
    if (!topic) { showError(body, 'Enter a topic.'); return; }
    btn.disabled = true;
    const loadEl = document.createElement('div');
    loadEl.className = 'loading-row';
    loadEl.innerHTML = '<div class="spinner"></div><span class="dots">Building outline</span>';
    body.appendChild(loadEl);
    try {
      const reply = await askPluto(`Create a detailed ${STATE.essayCfg.type} essay outline for: "${topic}"

Format with clear structure:
- Title
- Thesis statement
- I. Introduction (Hook, Background, Thesis)
- II. Body Paragraph 1 (Topic sentence + 3 supporting points + evidence types)
- III. Body Paragraph 2 (same)
- IV. Body Paragraph 3 (same)
- V. Counterargument + Rebuttal (if argumentative)
- VI. Conclusion (Synthesis, Broader implications, Call to action)`);
      loadEl.remove();
      const cleaned = cleanText(reply);
      insertAtCursor('<p>' + cleaned.replace(/\n/g, '</p><p>') + '</p>');
      if (!document.getElementById('doc-title').value) document.getElementById('doc-title').value = topic;
      addReward(10, 20, 'Outline built!');
      const msg = document.createElement('div');
      msg.className = 'ai-msg';
      msg.textContent = 'Outline added to your document.';
      body.appendChild(msg);
    } catch (err) { loadEl.remove(); showError(body, err.message); }
    btn.disabled = false;
  });
  body.appendChild(btn);
}

// ── SOURCES PANEL ─────────────────────────────────────────────
function renderSourcesPanel(body) {
  body.innerHTML = '';

  // Format selector
  const fmtRow = document.createElement('div');
  fmtRow.id = 'fmt-row';
  fmtRow.innerHTML = ['MLA','APA','Chicago'].map(f =>
    `<button class="fmt-pill${STATE.citeFmt === f ? ' on' : ''}" data-fmt="${f}">${f}</button>`
  ).join('');
  fmtRow.querySelectorAll('.fmt-pill').forEach(p => {
    p.addEventListener('click', () => {
      STATE.citeFmt = p.dataset.fmt;
      localStorage.setItem('pluto_fmt', STATE.citeFmt);
      renderSourcesPanel(body);
    });
  });
  body.appendChild(fmtRow);

  // Search bar
  const searchWrap = document.createElement('div');
  searchWrap.style.cssText = 'display:flex;gap:5px;margin-bottom:10px';
  const inp = document.createElement('input');
  inp.className = 'cfg-input'; inp.id = 'source-query';
  inp.placeholder = 'Search topic for real academic sources...';
  inp.value = document.getElementById('doc-title').value || '';
  const btn = document.createElement('button');
  btn.style.cssText = 'background:var(--blue);border:none;border-radius:7px;color:#fff;font-size:11px;font-weight:700;padding:7px 13px;cursor:pointer;white-space:nowrap;font-family:\'DM Sans\',sans-serif';
  btn.textContent = 'Search';
  btn.addEventListener('click', () => runSourceSearch(body, inp.value.trim()));
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') runSourceSearch(body, inp.value.trim()); });
  searchWrap.appendChild(inp); searchWrap.appendChild(btn);
  body.appendChild(searchWrap);

  const notice = document.createElement('div');
  notice.style.cssText = 'font-size:9px;color:rgba(79,142,247,.6);font-family:\'DM Mono\',monospace;margin-bottom:10px;background:rgba(79,142,247,.04);border:1px solid rgba(79,142,247,.1);border-radius:5px;padding:5px 8px';
  notice.textContent = 'Powered by Perplexity AI — real web search, real sources';
  body.appendChild(notice);

  const listWrap = document.createElement('div');
  listWrap.id = 'sources-list';
  body.appendChild(listWrap);
  renderSourceCards(listWrap);
}

async function runSourceSearch(body, topic) {
  if (!topic) return;
  const listWrap = body.querySelector('#sources-list') || body;
  listWrap.innerHTML = '';
  const loadEl = document.createElement('div');
  loadEl.className = 'loading-row';
  loadEl.innerHTML = '<div class="spinner"></div><span class="dots">Searching real sources via Perplexity</span>';
  listWrap.appendChild(loadEl);

  try {
    const data = await apiPost('/essay/sources', { topic, format: STATE.citeFmt, count: 6 });
    loadEl.remove();
    STATE.sourcesData = data.sources;
    renderSourceCards(listWrap);
    addReward(20, 40, `${data.sources.length} real sources found!`);
  } catch (err) {
    loadEl.remove();
    showError(listWrap, err.message);
  }
}

function renderSourceCards(container) {
  container.innerHTML = '';
  if (!STATE.sourcesData.length) {
    container.innerHTML = `<div class="empty-state"><span class="es-icon">🔬</span>Search a topic above to find real, verified academic sources using Perplexity AI web search.</div>`;
    return;
  }
  STATE.sourcesData.forEach((s, i) => {
    const card = document.createElement('div');
    card.className = 'source-card';
    const citationKey = STATE.citeFmt.toLowerCase();
    const citation = s[citationKey] || s.mla || s.citation || '';
    const titleHtml = s.url
      ? `<a href="${s.url}" target="_blank" rel="noopener">${s.title}</a>`
      : s.title;
    card.innerHTML = `
      <div class="sc-title">${titleHtml}</div>
      <div class="sc-meta">
        <span class="sc-type">${s.type || 'source'}</span>
        ${s.author} · ${s.year} · ${s.source}${s.url ? ' · 🔗' : ''}
      </div>
      <div class="sc-sum">${s.summary}</div>
      <div class="sc-cite">${citation}</div>
      <div class="sc-btns">
        <button class="sc-btn" id="sc-copy-${i}">Copy ${STATE.citeFmt}</button>
        <button class="sc-btn" id="sc-save-${i}">Save</button>
        <button class="sc-btn" id="sc-insert-${i}">Insert</button>
      </div>`;
    container.appendChild(card);

    card.querySelector(`#sc-copy-${i}`).addEventListener('click', e => {
      navigator.clipboard.writeText(citation).catch(() => {});
      e.target.textContent = 'Copied!';
      setTimeout(() => e.target.textContent = `Copy ${STATE.citeFmt}`, 1500);
    });
    card.querySelector(`#sc-save-${i}`).addEventListener('click', () => {
      STATE.citations.push({ ...s, citation, savedAt: Date.now() });
      localStorage.setItem('pluto_citations', JSON.stringify(STATE.citations));
      addReward(8, 20, 'Source saved!');
    });
    card.querySelector(`#sc-insert-${i}`).addEventListener('click', () => {
      insertAtCursor('<p>' + citation + '</p>');
      addReward(5, 10, 'Citation inserted!');
    });
  });
}

// ── ANALYSIS PANEL ────────────────────────────────────────────
function renderAnalysisPanel(body) {
  body.innerHTML = '';

  const heading = document.createElement('div');
  heading.className = 'panel-heading';
  heading.textContent = 'ESSAY ANALYSIS';
  body.appendChild(heading);

  if (STATE.analysis) {
    renderAnalysisResults(body, STATE.analysis);
    const resetBtn = document.createElement('button');
    resetBtn.className = 'generate-btn secondary';
    resetBtn.textContent = '🔄 Re-analyze';
    resetBtn.style.marginTop = '10px';
    resetBtn.addEventListener('click', () => { STATE.analysis = null; runAnalysis(body); });
    body.appendChild(resetBtn);
    return;
  }

  const info = document.createElement('div');
  info.className = 'ai-msg';
  info.textContent = 'Write your essay in the editor, then click Analyze to get a detailed score and improvement suggestions.';
  body.appendChild(info);

  const btn = document.createElement('button');
  btn.className = 'generate-btn';
  btn.textContent = '📊 Analyze My Essay';
  btn.addEventListener('click', () => runAnalysis(body));
  body.appendChild(btn);
}

async function runAnalysis(body) {
  const essay = getEditorText().trim();
  if (essay.length < 100) { showError(body, 'Write at least 100 words first.'); return; }

  body.innerHTML = '';
  const loadEl = document.createElement('div');
  loadEl.className = 'loading-row';
  loadEl.innerHTML = '<div class="spinner"></div><span class="dots">Analyzing your essay</span>';
  body.appendChild(loadEl);

  try {
    const data = await apiPost('/essay/analyze', { essay });
    loadEl.remove();
    STATE.analysis = data.analysis;
    renderAnalysisResults(body, data.analysis);
    addReward(15, 30, 'Essay analyzed!');
    const resetBtn = document.createElement('button');
    resetBtn.className = 'generate-btn secondary';
    resetBtn.textContent = '🔄 Re-analyze';
    resetBtn.style.marginTop = '10px';
    resetBtn.addEventListener('click', () => { STATE.analysis = null; renderAnalysisPanel(body); });
    body.appendChild(resetBtn);
  } catch (err) { loadEl.remove(); showError(body, err.message); }
}

function renderAnalysisResults(body, a) {
  // Grade badge
  const gradeWrap = document.createElement('div');
  gradeWrap.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:14px;background:var(--s1);border:1px solid var(--b1);border-radius:10px;padding:12px';
  const gradeColor = a.grade?.startsWith('A') ? 'var(--green)' : a.grade?.startsWith('B') ? 'var(--blue)' : a.grade?.startsWith('C') ? 'var(--gold)' : 'var(--red)';
  gradeWrap.innerHTML = `
    <div class="grade-badge" style="color:${gradeColor};border-color:${gradeColor}">${a.grade || 'B'}</div>
    <div>
      <div style="font-size:13px;font-weight:600;color:#fff;margin-bottom:3px">${a.summary || ''}</div>
      <div style="font-size:9px;color:var(--mid);font-family:'DM Mono',monospace">${a.word_count} words · ${a.readability_level || ''}</div>
    </div>`;
  body.appendChild(gradeWrap);

  // Score grid
  const scores = a.scores || {};
  const scoreGrid = document.createElement('div');
  scoreGrid.className = 'score-grid';
  const scoreItems = [
    { k: 'argument',    label: 'Argument' },
    { k: 'evidence',    label: 'Evidence' },
    { k: 'clarity',     label: 'Clarity' },
    { k: 'structure',   label: 'Structure' },
    { k: 'originality', label: 'Originality' },
    { k: 'grammar',     label: 'Grammar' },
  ];
  scoreItems.forEach(si => {
    const v = scores[si.k] || 0;
    const col = v >= 85 ? 'var(--green)' : v >= 70 ? 'var(--blue)' : v >= 55 ? 'var(--gold)' : 'var(--red)';
    const card = document.createElement('div');
    card.className = 'score-card';
    card.innerHTML = `<div class="score-label">${si.label}</div><div class="score-val" style="color:${col}">${v}</div><div class="score-bar"><div class="score-bar-fill" style="width:${v}%;background:${col}"></div></div>`;
    scoreGrid.appendChild(card);
  });
  body.appendChild(scoreGrid);

  // Strengths
  if (a.strengths?.length) {
    const s = document.createElement('div');
    s.innerHTML = `<div class="panel-heading" style="margin-top:10px">STRENGTHS</div>`;
    a.strengths.forEach(str => {
      const el = document.createElement('div');
      el.style.cssText = 'font-size:11px;color:var(--green);padding:3px 0;display:flex;gap:6px;align-items:flex-start';
      el.innerHTML = `<span>✓</span><span>${str}</span>`;
      s.appendChild(el);
    });
    body.appendChild(s);
  }

  // Improvements
  if (a.improvements?.length) {
    const imp = document.createElement('div');
    imp.innerHTML = `<div class="panel-heading" style="margin-top:12px">IMPROVEMENTS</div>`;
    a.improvements.slice(0, 4).forEach(issue => {
      const card = document.createElement('div');
      card.className = 'issue-card';
      const sevClass = `sev-${issue.severity || 'medium'}`;
      card.innerHTML = `<div class="issue-label ${sevClass}">${(issue.severity || 'medium').toUpperCase()} · ${issue.issue}</div><div class="issue-fix">${issue.fix}</div>`;
      imp.appendChild(card);
    });
    body.appendChild(imp);
  }

  // Missing elements
  if (a.missing?.length) {
    const m = document.createElement('div');
    m.innerHTML = `<div class="panel-heading" style="margin-top:10px">MISSING</div>`;
    a.missing.forEach(el => {
      const item = document.createElement('div');
      item.style.cssText = 'font-size:10.5px;color:var(--gold);padding:2px 0;display:flex;gap:6px';
      item.innerHTML = `<span>→</span><span>${el}</span>`;
      m.appendChild(item);
    });
    body.appendChild(m);
  }
}

// ── CITATIONS PANEL ───────────────────────────────────────────
function renderCitationsPanel(body) {
  body.innerHTML = '';

  const heading = document.createElement('div');
  heading.className = 'panel-heading';
  heading.textContent = 'SAVED CITATIONS';
  body.appendChild(heading);

  if (!STATE.citations.length) {
    body.innerHTML += `<div class="empty-state"><span class="es-icon">📎</span>Save sources from the Sources tab to build your bibliography here.</div>`;
    return;
  }

  const exportBtn = document.createElement('button');
  exportBtn.style.cssText = 'width:100%;background:var(--s1);border:1px solid var(--b1);border-radius:8px;color:var(--mid);font-size:11px;font-weight:600;padding:8px;cursor:pointer;margin-bottom:10px;font-family:\'DM Sans\',sans-serif';
  exportBtn.textContent = '📋 Export Works Cited to Document';
  exportBtn.addEventListener('click', () => {
    const fmt = STATE.citeFmt;
    const header = fmt === 'MLA' ? 'Works Cited' : fmt === 'APA' ? 'References' : 'Bibliography';
    const text = STATE.citations.map(c => c.citation || c.mla || '').join('\n\n');
    insertAtCursor(`<h2>${header}</h2><p>${text.replace(/\n/g, '</p><p>')}</p>`);
    addReward(15, 30, 'Bibliography exported!');
  });
  body.appendChild(exportBtn);

  STATE.citations.forEach((c, i) => {
    const card = document.createElement('div');
    card.className = 'source-card';
    const cit = c.citation || c.mla || '';
    card.innerHTML = `
      <div class="sc-title">${c.title || 'Source'}</div>
      <div class="sc-meta">${c.author || ''} · ${c.year || ''}</div>
      <div class="sc-cite">${cit}</div>
      <div class="sc-btns">
        <button class="sc-btn" id="cc-${i}">Copy</button>
        <button class="sc-btn" id="ci-${i}">Insert</button>
        <button class="sc-btn" id="cd-${i}" style="color:var(--red)">Delete</button>
      </div>`;
    body.appendChild(card);
    card.querySelector(`#cc-${i}`).addEventListener('click', e => {
      navigator.clipboard.writeText(cit).catch(() => {});
      e.target.textContent = 'Copied!';
      setTimeout(() => e.target.textContent = 'Copy', 1500);
    });
    card.querySelector(`#ci-${i}`).addEventListener('click', () => insertAtCursor('<p>' + cit + '</p>'));
    card.querySelector(`#cd-${i}`).addEventListener('click', () => {
      STATE.citations.splice(i, 1);
      localStorage.setItem('pluto_citations', JSON.stringify(STATE.citations));
      renderCitationsPanel(body);
    });
  });
}

// ── AI CHAT INPUT ─────────────────────────────────────────────
document.getElementById('rp-send').addEventListener('click', handleAIInput);
document.getElementById('rp-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAIInput(); }
});

// Auto-resize textarea
const rpInput = document.getElementById('rp-input');
rpInput.addEventListener('input', () => {
  rpInput.style.height = 'auto';
  rpInput.style.height = Math.min(rpInput.scrollHeight, 100) + 'px';
});

async function handleAIInput() {
  const input = document.getElementById('rp-input');
  const query = input.value.trim();
  if (!query) return;

  const send = document.getElementById('rp-send');
  send.disabled = true;
  input.value = '';
  input.style.height = 'auto';

  STATE.aiHistory.push({ text: query, sender: 'user' });

  // Route to right handler
  const ql = query.toLowerCase();
  if (ql.includes('find source') || ql.includes('search source') || ql.includes('find article') || STATE.activeView === 'sources') {
    switchTab('sources');
    const topic = query.replace(/find sources?(on|about|for)?/i, '').replace(/search sources?/i, '').trim() || query;
    await runSourceSearch(document.getElementById('right-body'), topic);
  } else if (ql.includes('humanize') || STATE.activeView === 'humanize') {
    switchTab('ai');
    await runHumanizeFromChat(query);
  } else {
    switchTab('ai');
    await handleGeneralChat(query);
  }

  send.disabled = false;
  renderRightPanel();
}

async function handleGeneralChat(query) {
  const body = document.getElementById('right-body');

  // Ensure chat history section visible
  const chatHeading = body.querySelector('.panel-heading');
  if (!chatHeading) renderWritePanel(body);

  const thinking = document.createElement('div');
  thinking.className = 'ai-msg dots';
  thinking.textContent = 'Pluto is thinking';
  body.appendChild(thinking);
  body.scrollTop = body.scrollHeight;

  try {
    const isWrite = /write|essay|paragraph|draft/i.test(query);
    const reply = await askPluto(query);
    const cleaned = cleanText(reply);
    thinking.remove();
    STATE.aiHistory.push({ text: cleaned, sender: 'ai' });

    if (isWrite) {
      insertAtCursor(mdToHtml(reply));
      addReward(15, 25, 'Content inserted!');
      const msg = document.createElement('div');
      msg.className = 'ai-msg';
      msg.textContent = 'Added to your document.';
      body.appendChild(msg);
    } else {
      const msg = document.createElement('div');
      msg.className = 'ai-msg';
      msg.textContent = cleaned;
      body.appendChild(msg);
    }
    body.scrollTop = body.scrollHeight;
  } catch (err) {
    thinking.remove();
    showError(body, err.message);
  }
}

async function runHumanizeFromChat(query) {
  const sel = getSelectedText() || getEditorText();
  if (sel.length < 20) return;
  const body = document.getElementById('right-body');
  const thinking = document.createElement('div');
  thinking.className = 'ai-msg dots'; thinking.textContent = 'Humanizing';
  body.appendChild(thinking); body.scrollTop = body.scrollHeight;
  try {
    const reply = await askPluto(`Rewrite to sound completely human-written, vary sentence length, use natural contractions, remove AI patterns. Keep all information. Text:\n${sel.slice(0, 3000)}`);
    thinking.remove();
    const cleaned = cleanText(reply);
    if (getSelectedText()) replaceSelected(cleaned);
    else { editor.innerHTML = ''; insertAtCursor('<p>' + cleaned.replace(/\n/g, '</p><p>') + '</p>'); }
    STATE.aiHistory.push({ text: 'Humanization complete.', sender: 'ai' });
    addReward(10, 20, 'Text humanized!');
  } catch { thinking.remove(); }
}

// ── TOPIC PROMPT HELPER ───────────────────────────────────────
function promptTopic(title, placeholder) {
  return new Promise(resolve => {
    showModal(title, 'Enter the topic or prompt for your essay.', () => {
      const val = document.getElementById('m-topic')?.value.trim();
      closeModal();
      resolve(val || '');
    }, `<input class="modal-input" id="m-topic" placeholder="${placeholder}" autofocus/>`);
    setTimeout(() => document.getElementById('m-topic')?.focus(), 100);
  });
}

// ── MODAL ─────────────────────────────────────────────────────
function showModal(title, sub, onConfirm, contentHtml = '') {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-sub').textContent = sub;
  document.getElementById('modal-content').innerHTML = contentHtml;
  document.getElementById('modal-btns').innerHTML = '';

  const cancel = document.createElement('button');
  cancel.className = 'modal-btn';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', closeModal);

  const confirm = document.createElement('button');
  confirm.className = 'modal-btn primary';
  confirm.textContent = 'Confirm';
  confirm.addEventListener('click', onConfirm);

  document.getElementById('modal-btns').appendChild(cancel);
  document.getElementById('modal-btns').appendChild(confirm);
  document.getElementById('modal').classList.add('show');
}

function closeModal() { document.getElementById('modal').classList.remove('show'); }
document.getElementById('modal').addEventListener('click', e => { if (e.target === document.getElementById('modal')) closeModal(); });

// ── ERROR DISPLAY ─────────────────────────────────────────────
function showError(container, msg) {
  const el = document.createElement('div');
  el.style.cssText = 'font-size:11px;color:var(--red);padding:8px 10px;background:rgba(255,95,95,.05);border:1px solid rgba(255,95,95,.15);border-radius:7px;margin:6px 0';
  el.textContent = msg || 'Server error — try again.';
  container.appendChild(el);
}

// ── TOOLBAR ───────────────────────────────────────────────────
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

// ── KEYBOARD SHORTCUTS ────────────────────────────────────────
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveDoc(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    const sel = getSelectedText();
    if (sel) {
      document.getElementById('rp-input').value = 'Polish and improve this: ' + sel;
      document.getElementById('rp-input').focus();
    }
  }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'H') {
    e.preventDefault();
    const v = STATE.activeView;
    document.querySelector(`.nav-btn[data-view="humanize"]`)?.click();
    runHumanize(document.getElementById('right-body'), document.querySelector('.generate-btn'));
  }
});

// ── INIT ──────────────────────────────────────────────────────
updateCoinDisplay();
renderSavedDocs();

STATE.aiHistory.push({
  text: "Welcome to Pluto Essay Suite. I can write full essays, find real academic sources via Perplexity, build thesis statements, humanize text, and analyze your writing. What are you working on?",
  sender: 'ai'
});

renderRightPanel();
updateWordCount();
