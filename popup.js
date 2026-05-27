// ================================================================
// PLUTO v4 — Single-screen with bottom sheet feature panels
// ================================================================

// ── DOM ──────────────────────────────────────────────────────────
const chatBox   = document.getElementById('chat-box');
const userInput = document.getElementById('user-input');
const sendBtn   = document.getElementById('send-btn');
const autoPill  = document.getElementById('auto-pill');
const backdrop  = document.getElementById('sheet-backdrop');
const sheet     = document.getElementById('bottom-sheet');
const sheetTitle= document.getElementById('sheet-title');
const sheetBody = document.getElementById('sheet-body');
const sheetClose= document.getElementById('sheet-close');

// ── State ─────────────────────────────────────────────────────────
let chatHistory    = [];
window.userProfile = null;
let tutorActive    = false;
let automateActive = false;
let activeSheet    = null;   // 'flash' | 'test' | 'research' | null
let activeChatId   = null;   // current popup session chat ID in pluto_chats

// ── THEME ─────────────────────────────────────────────────────────
function setTheme(t) {
  const colors = { silver:'#b0b0c8', blue:'#4f8ef7' };
  document.documentElement.style.setProperty('--accent', colors[t] || colors.silver);
  document.getElementById('dot-silver').style.border = t==='silver'?'2.5px solid #fff':'2.5px solid transparent';
  document.getElementById('dot-blue').style.border   = t==='blue'  ?'2.5px solid #fff':'2.5px solid transparent';
  chrome.storage.local.set({ theme:t });
}
document.getElementById('dot-silver').addEventListener('click', ()=>setTheme('silver'));
document.getElementById('dot-blue')  .addEventListener('click', ()=>setTheme('blue'));

// ── BOTTOM SHEET SYSTEM ───────────────────────────────────────────
function openSheet(id, title, buildFn) {
  activeSheet = id;
  sheetTitle.textContent = title;
  sheetBody.innerHTML = '';
  Promise.resolve(buildFn(sheetBody)).catch(()=>{});

  sheet.classList.remove('hidden');
  backdrop.classList.remove('hidden');
  requestAnimationFrame(()=>{
    sheet.classList.add('visible');
    backdrop.classList.add('visible');
  });

  // mark feat btn active
  document.querySelectorAll('.feat-btn').forEach(b=>b.classList.remove('active'));
  const btn = document.getElementById('btn-'+id);
  if (btn) btn.classList.add('active');
}

function closeSheet() {
  if (window._podCleanup) { window._podCleanup(); window._podCleanup = null; }
  sheet.classList.remove('visible');
  backdrop.classList.remove('visible');
  setTimeout(()=>{
    sheet.classList.add('hidden');
    backdrop.classList.add('hidden');
    sheetBody.innerHTML = '';
    activeSheet = null;
    document.querySelectorAll('.feat-btn').forEach(b=>b.classList.remove('active'));
    syncMoodBtn(); // re-activate btn-mood if sound still playing
  }, 320);
}

sheetClose.addEventListener('click', closeSheet);
backdrop.addEventListener('click', closeSheet);

// ── HELPERS ───────────────────────────────────────────────────────
async function getPageContext() {
  return new Promise(resolve => {
    chrome.tabs.query({ active:true, lastFocusedWindow:true }, tabs => {
      const tab = tabs[0];
      if (!tab?.id) return resolve({ url:'Unknown', title:'Unknown', text:'' });

      // Route through background so it auto-injects the content script if needed
      chrome.runtime.sendMessage({ type:'GET_SMART_CONTEXT' }, r => {
        if (chrome.runtime.lastError || !r || r.error)
          resolve({ url:tab.url||'Unknown', title:tab.title||'Unknown', text:'' });
        else resolve(r);
      });
    });
  });
}

async function callServer(message, extra = {}) {
  const r = await fetch('https://pluto-server-production.up.railway.app/ask-aria', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({
      message,
      profile:    window.userProfile || { name:'Student' },
      pageContext: extra.ctx || { url:'Unknown', title:'Unknown', text:'' },
      history:     extra.history || [],
      tutorMode:   extra.tutor || false
    })
  });
  const d = await r.json();
  return d.reply;
}

function parseJSON(raw) {
  const s = raw.indexOf('['), e = raw.lastIndexOf(']');
  if (s===-1||e===-1) throw new Error('No JSON array');
  return JSON.parse(raw.slice(s,e+1));
}

function fmt(text) {
  let t = text.replace(/```latex/g,'').replace(/```/g,'');
  const math = [];
  if (typeof katex !== 'undefined') {
    t = t.replace(/\$\$(.*?)\$\$/gs,(m,f)=>{
      try{const h=`<div class="math-block">${katex.renderToString(f.trim(),{displayMode:true,throwOnError:false})}</div>`;math.push(h);return`\x00M${math.length-1}\x00`;}catch{return m;}
    });
    t = t.replace(/\$(.*?)\$/g,(m,f)=>{
      try{const h=katex.renderToString(f.trim(),{displayMode:false,throwOnError:false});math.push(h);return`\x00M${math.length-1}\x00`;}catch{return m;}
    });
  }
  t = t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  t = t.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/^\* (.*$)/gim,'<li>$1</li>').replace(/\n/g,'<br>');
  return math.length ? t.replace(/\x00M(\d+)\x00/g,(_,i)=>math[+i]||'') : t;
}

function addMsg(text, sender) {
  const row = document.createElement('div');
  row.className = sender==='user'?'user-row':'ai-row';
  const bub = document.createElement('div');
  if (sender==='auto') {
    bub.className='auto-bubble'; bub.innerText=text;
  } else {
    bub.className=sender==='user'?'user-bubble':'ai-bubble';
    if (sender==='ai') bub.innerHTML=fmt(text); else bub.innerText=text;
  }
  row.appendChild(bub);
  chatBox.appendChild(row);
  chatBox.scrollTo({top:chatBox.scrollHeight,behavior:'smooth'});
  return row;
}

function addAutoLog(msg, answered, skipped) {
  let txt = `▸ ${msg}`;
  if (answered!==undefined) txt+=`  [✓ ${answered}]`;
  if (skipped !==undefined) txt+=`  [skip ${skipped}]`;
  addMsg(txt,'auto');
}

function showProgCard({answered=0,skipped=0,site=''}) {
  const total=answered+skipped, pct=total?Math.round(answered/total*100):100;
  const row=document.createElement('div');
  row.className='ai-row';
  const c=document.createElement('div');
  c.className='prog-card';
  c.innerHTML=`<div class="pc-head">SESSION COMPLETE — ${site.toUpperCase()}</div>
<div class="pc-row"><span>Answered</span><span>${answered}</span></div>
<div class="pc-row"><span>Skipped</span><span>${skipped}</span></div>
<div class="pc-row"><span>Rate</span><span>${pct}%</span></div>
<div class="pc-bar"><div class="pc-fill" style="width:${pct}%"></div></div>`;
  row.appendChild(c);
  chatBox.appendChild(row);
  chatBox.scrollTo({top:chatBox.scrollHeight,behavior:'smooth'});
}

// ── CHAT ──────────────────────────────────────────────────────────
sendBtn.addEventListener('click', ()=>sendMessage());
userInput.addEventListener('keydown', e=>{ if(e.key==='Enter') sendMessage(); });

async function sendMessage(override) {
  const text = override || userInput.value.trim();
  if (!text) return;
  if (!override) { addMsg(text,'user'); userInput.value=''; }
  if (!window.userProfile?.course) { handleOnboarding(text); return; }

  // Lock UI
  sendBtn.disabled = true;
  sendBtn.innerHTML = '<div class="send-spinner"></div>';
  userInput.disabled = true;
  document.getElementById('input-row').classList.add('locked');

  // Animated thinking bubble
  const row = document.createElement('div');
  row.className = 'ai-row';
  const bub = document.createElement('div');
  bub.className = 'thinking-bubble';
  bub.innerHTML = `
    <div class="thinking-dots">
      <div class="thinking-dot"></div>
      <div class="thinking-dot"></div>
      <div class="thinking-dot"></div>
    </div>
    <div class="thinking-status">Pluto is thinking...</div>`;
  row.appendChild(bub);
  chatBox.appendChild(row);
  chatBox.scrollTo({ top: chatBox.scrollHeight, behavior: 'smooth' });

  // Progressive status messages
  const statusEl = bub.querySelector('.thinking-status');
  const phases = [
    { at: 2000, text: 'Checking the shared brain...' },
    { at: 4000, text: 'Gathering sources...' },
    { at: 6000, text: 'Almost there...' },
  ];
  const phaseTimers = phases.map(({ at, text: label }) =>
    setTimeout(() => {
      statusEl.classList.add('fading');
      setTimeout(() => {
        statusEl.textContent = label;
        statusEl.classList.remove('fading');
      }, 350);
    }, at)
  );

  // 30-second "still trying" notice (non-aborting)
  const slowTimer = setTimeout(() => {
    const warn = document.createElement('div');
    warn.className = 'thinking-timeout';
    warn.textContent = 'This is taking longer than usual. Still trying...';
    bub.appendChild(warn);
    chatBox.scrollTo({ top: chatBox.scrollHeight, behavior: 'smooth' });
  }, 30000);

  function cleanupTimers() {
    phaseTimers.forEach(clearTimeout);
    clearTimeout(slowTimer);
  }

  // Restore send button SVG
  const sendSVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>`;

  function unlockInput() {
    sendBtn.disabled = false;
    sendBtn.innerHTML = sendSVG;
    userInput.disabled = false;
    document.getElementById('input-row').classList.remove('locked');
  }

  try {
    const ctx = await getPageContext();
    const reply = await callServer(text, { ctx, history: chatHistory, tutor: tutorActive });
    cleanupTimers();
    bub.className = 'ai-bubble';
    bub.innerHTML = fmt(reply);
    chatBox.scrollTo({ top: chatBox.scrollHeight, behavior: 'smooth' });
    chatHistory.push({ text, sender: 'user' }, { text: reply, sender: 'ai' });
    chrome.storage.local.set({ chatHistory });
    saveMessageToChat(text, reply);
    updateBrainStats([], null);
  } catch (e) {
    cleanupTimers();
    bub.className = 'error-bubble';
    bub.innerHTML = `<strong>Pluto can't reach the server.</strong><br>Make sure it's running on port 3000.`;
  } finally {
    unlockInput();
    userInput.focus();
  }
}

function handleOnboarding(text) {
  let reply='';
  if (!window.userProfile) {
    window.userProfile={name:text};
    reply=`Nice to meet you, ${text}. What grade are you in?`;
  } else if (!window.userProfile.grade) {
    window.userProfile.grade=text;
    reply=`Got it. What's your main subject or course?`;
  } else {
    window.userProfile.course=text;
    reply=`All set — I'm Pluto, your AI study partner for **${window.userProfile.grade} ${text}**. What are we working on?`;
    const sub=document.getElementById('subtitle');
    if(sub) sub.innerText=`${window.userProfile.name.toLowerCase()}'s study partner`;
  }
  addMsg(reply,'ai');
  chatHistory.push({text,sender:'user'},{text:reply,sender:'ai'});
  chrome.storage.local.set({userProfile:window.userProfile,chatHistory});
}

// ── FEATURE BUTTONS ───────────────────────────────────────────────

// ⚡ Study Mode — full intelligent study panel
document.getElementById('btn-study').addEventListener('click', ()=>{
  if (activeSheet==='study') { closeSheet(); return; }
  if (!window.userProfile?.course) { addMsg("Finish setup first!",'ai'); return; }
  openSheet('study','⚡ STUDY MODE', buildStudySheet);
});

let _studyData = null;
let _studyTab  = 'overview';
let _studyCtx  = null;

async function buildStudySheet(el) {
  _studyData = null;
  _studyTab  = 'overview';

  el.innerHTML = `
    <div class="study-load" id="study-load">
      <div class="study-load-orb"></div>
      <div class="study-load-label">Analyzing page</div>
      <div class="study-load-steps" id="sld-steps">
        <span class="sld-step active" id="sls-read">reading</span>
        <span class="sld-dot">·</span>
        <span class="sld-step" id="sls-extract">extracting</span>
        <span class="sld-dot">·</span>
        <span class="sld-step" id="sls-build">building</span>
      </div>
    </div>
    <div id="study-main" style="display:none"></div>`;

  const load = el.querySelector('#study-load');
  const main = el.querySelector('#study-main');

  // animate loading steps
  const steps = ['sls-extract','sls-build'];
  let si = 0;
  const stepTimer = setInterval(()=>{
    const s = el.querySelector('#'+steps[si]);
    if (s) s.classList.add('active');
    si++;
    if (si >= steps.length) clearInterval(stepTimer);
  }, 900);

  // get page context
  _studyCtx = await getPageContext();

  if (!_studyCtx.text || _studyCtx.text.length < 50) {
    clearInterval(stepTimer);
    load.innerHTML = `
      <div style="text-align:center;padding:8px 0">
        <div style="font-size:28px;margin-bottom:10px">📭</div>
        <div style="font-size:12px;color:var(--mid);line-height:1.6">Can't read this page.<br>Paste the content below.</div>
        <textarea class="sh-input" id="study-paste" placeholder="Paste text here..." style="margin-top:14px;height:90px;display:block;width:100%"></textarea>
        <button class="sh-gen-btn" id="study-paste-btn" style="margin-top:8px">⚡ Study This</button>
      </div>`;
    load.querySelector('#study-paste-btn')?.addEventListener('click', async()=>{
      const t = load.querySelector('#study-paste')?.value.trim();
      if (!t) return;
      _studyCtx = { url:'pasted', title:'Pasted Content', text: t };
      load.innerHTML = '<div class="study-load-orb"></div><div class="study-load-label">Analyzing...</div>';
      await _runStudyAnalysis(el, load, main);
    });
    return;
  }

  clearInterval(stepTimer);
  await _runStudyAnalysis(el, load, main);
}

async function _runStudyAnalysis(el, load, main) {
  const profile = window.userProfile || { name:'Student', course:'General', grade:'High School' };
  const content = (_studyCtx.text||'').slice(0, 4000);
  const prompt = `You are an expert study guide creator. Analyze this content and respond ONLY with a valid JSON object (no markdown, no backticks):
{
  "subject": "one-word subject tag (e.g. Biology, History, Math)",
  "difficulty": "beginner|intermediate|advanced",
  "readTime": <minutes as integer>,
  "emoji": "one relevant emoji",
  "summary": "3-4 sentence overall summary",
  "objectives": ["learning objective 1","learning objective 2","learning objective 3"],
  "keyPoints": ["key insight 1","key insight 2","key insight 3","key insight 4","key insight 5"],
  "concepts": [{"term":"term1","def":"short definition"},{"term":"term2","def":"short definition"},{"term":"term3","def":"short definition"},{"term":"term4","def":"short definition"},{"term":"term5","def":"short definition"}],
  "sections": [{"heading":"section title","summary":"2-3 sentence breakdown","depth":"what a student must understand here"}],
  "quiz": [{"q":"question?","choices":["A","B","C","D"],"answer":0,"explanation":"why this is correct"}]
}
Return 5 concepts, 3-5 sections, and 4 quiz questions.
Student: ${profile.name}, ${profile.grade}, ${profile.course}.
Content title: "${_studyCtx.title}"
Content: """${content}"""`;

  try {
    const raw = await callServer(prompt, { ctx: _studyCtx });

    // parse JSON robustly
    const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
    if (s === -1 || e === -1) throw new Error('no json');
    _studyData = JSON.parse(raw.slice(s, e+1));
  } catch {
    load.style.display = 'none';
    main.style.display = 'block';
    main.innerHTML = `<div style="text-align:center;padding:20px;font-size:12px;color:var(--mid)">
      Failed to analyze. <a href="#" id="study-retry" style="color:var(--accent);text-decoration:none">Retry</a></div>`;
    main.querySelector('#study-retry')?.addEventListener('click', e=>{
      e.preventDefault();
      load.style.display=''; main.style.display='none';
      main.innerHTML='';
      _runStudyAnalysis(el, load, main);
    });
    return;
  }

  load.style.display = 'none';
  main.style.display = 'block';
  _renderStudyPanel(main);
}

function _renderStudyPanel(el) {
  const d = _studyData;
  const diffColor = { beginner:'var(--green)', intermediate:'var(--gold)', advanced:'var(--red)' }[d.difficulty] || 'var(--mid)';

  el.innerHTML = `
    <div class="study-hero">
      <div class="study-hero-left">
        <div class="study-emoji">${d.emoji||'📖'}</div>
        <div>
          <div class="study-subject">${d.subject||'Study'}</div>
          <div class="study-title">${_studyCtx.title?.slice(0,55)||'This Page'}</div>
        </div>
      </div>
      <div class="study-hero-stats">
        <div class="study-stat"><span class="study-stat-val" style="color:${diffColor}">${d.difficulty||'—'}</span><span class="study-stat-lbl">level</span></div>
        <div class="study-stat-div"></div>
        <div class="study-stat"><span class="study-stat-val">${d.readTime||'?'}<span style="font-size:9px">m</span></span><span class="study-stat-lbl">read</span></div>
        <div class="study-stat-div"></div>
        <div class="study-stat"><span class="study-stat-val">${(d.concepts||[]).length}</span><span class="study-stat-lbl">terms</span></div>
      </div>
    </div>

    <div class="study-tabs">
      <button class="study-tab active" data-tab="overview">Overview</button>
      <button class="study-tab" data-tab="deepdive">Deep Dive</button>
      <button class="study-tab" data-tab="quiz">Quiz Me</button>
      <button class="study-tab" data-tab="glossary">Glossary</button>
    </div>
    <div id="study-tab-body"></div>`;

  el.querySelectorAll('.study-tab').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      el.querySelectorAll('.study-tab').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      _studyTab = btn.dataset.tab;
      _renderStudyTab(el.querySelector('#study-tab-body'), _studyTab);
    });
  });

  _renderStudyTab(el.querySelector('#study-tab-body'), 'overview');
}

function _renderStudyTab(el, tab) {
  const d = _studyData;
  if (tab === 'overview') {
    el.innerHTML = `
      <div class="study-section">
        <div class="study-sec-label">SUMMARY</div>
        <div class="study-summary-text">${d.summary||''}</div>
      </div>
      <div class="study-section">
        <div class="study-sec-label">LEARNING OBJECTIVES</div>
        ${(d.objectives||[]).map((o,i)=>`
          <div class="study-obj-row">
            <div class="study-obj-num">${i+1}</div>
            <div class="study-obj-text">${o}</div>
          </div>`).join('')}
      </div>
      <div class="study-section">
        <div class="study-sec-label">KEY INSIGHTS</div>
        ${(d.keyPoints||[]).map(p=>`<div class="study-kp-row"><span class="study-kp-dot">◆</span><span>${p}</span></div>`).join('')}
      </div>
      <div class="study-section">
        <div class="study-sec-label">KEY CONCEPTS</div>
        <div class="study-chips">${(d.concepts||[]).map(c=>`<button class="study-chip" data-term="${c.term}" data-def="${c.def}">${c.term}</button>`).join('')}</div>
        <div class="study-chip-def" id="study-chip-def" style="display:none"></div>
      </div>
      <button class="sh-gen-btn" id="study-ask-btn" style="margin-top:4px">💬 Ask a question about this page</button>`;

    el.querySelectorAll('.study-chip').forEach(chip=>{
      chip.addEventListener('click', ()=>{
        el.querySelectorAll('.study-chip').forEach(c=>c.classList.remove('active'));
        chip.classList.add('active');
        const defEl = el.querySelector('#study-chip-def');
        defEl.style.display = 'block';
        defEl.innerHTML = `<strong>${chip.dataset.term}</strong> — ${chip.dataset.def}`;
      });
    });

    el.querySelector('#study-ask-btn')?.addEventListener('click', ()=>{
      closeSheet();
      userInput.value = `[About: ${_studyCtx.title}] `;
      userInput.focus();
    });

  } else if (tab === 'deepdive') {
    el.innerHTML = `
      <div class="study-section">
        <div class="study-sec-label">SECTION BREAKDOWN</div>
        ${(d.sections||[]).map((s,i)=>`
          <div class="study-section-card" id="sdv-${i}">
            <div class="study-section-head" data-i="${i}">
              <span class="study-section-num">§${i+1}</span>
              <span class="study-section-title">${s.heading}</span>
              <span class="study-section-chevron">›</span>
            </div>
            <div class="study-section-body" id="sdvb-${i}" style="display:none">
              <div class="study-section-sum">${s.summary}</div>
              ${s.depth?`<div class="study-section-depth"><span class="study-depth-tag">UNDERSTAND</span>${s.depth}</div>`:''}
            </div>
          </div>`).join('')}
      </div>
      <div class="study-section">
        <div class="study-sec-label">ASK PLUTO ABOUT A SECTION</div>
        <div style="display:flex;gap:7px">
          <input class="res-input" id="sdv-q" placeholder="e.g. Explain section 2 in simpler terms..." autocomplete="off"/>
          <button class="res-go" id="sdv-go">Ask</button>
        </div>
        <div id="sdv-ans" style="margin-top:8px"></div>
      </div>`;

    el.querySelectorAll('.study-section-head').forEach(head=>{
      head.addEventListener('click', ()=>{
        const i = head.dataset.i;
        const body = el.querySelector(`#sdvb-${i}`);
        const chev = head.querySelector('.study-section-chevron');
        const isOpen = body.style.display !== 'none';
        body.style.display = isOpen ? 'none' : 'block';
        chev.style.transform = isOpen ? '' : 'rotate(90deg)';
      });
    });

    const sdvGo = el.querySelector('#sdv-go');
    const sdvQ  = el.querySelector('#sdv-q');
    const sdvAns= el.querySelector('#sdv-ans');
    const doSdvAsk = async() => {
      const q = sdvQ.value.trim(); if (!q) return;
      sdvGo.disabled = true; sdvGo.textContent = '...';
      sdvAns.innerHTML = `<div style="font-size:11px;color:var(--mid)">Thinking...</div>`;
      try {
        const context = (d.sections||[]).map((s,i)=>`§${i+1} ${s.heading}: ${s.summary}`).join('\n');
        const reply = await callServer(`About the document "${_studyCtx.title}", sections:\n${context}\n\nStudent asks: ${q}`, { ctx: _studyCtx });
        sdvAns.innerHTML = `<div class="ai-bubble" style="max-width:100%;font-size:12px">${fmt(reply)}</div>`;
      } catch {
        sdvAns.innerHTML = `<div style="font-size:11px;color:var(--red)">Server offline.</div>`;
      }
      sdvGo.disabled = false; sdvGo.textContent = 'Ask';
    };
    sdvGo.addEventListener('click', doSdvAsk);
    sdvQ.addEventListener('keydown', e=>{ if(e.key==='Enter') doSdvAsk(); });

  } else if (tab === 'quiz') {
    const qs = d.quiz || [];
    if (!qs.length) { el.innerHTML=`<div style="text-align:center;padding:20px;font-size:12px;color:var(--mid)">No quiz available.</div>`; return; }
    let qi = 0, score = 0, answered = false;

    const renderQuiz = () => {
      const q = qs[qi];
      el.innerHTML = `
        <div class="study-quiz-header">
          <span class="study-quiz-count">Q${qi+1}/${qs.length}</span>
          <div class="fc-prog-bar" style="flex:1;margin:0 10px"><div class="fc-prog-fill" style="width:${((qi+1)/qs.length)*100}%"></div></div>
          <span class="fc-score">${score}✓</span>
        </div>
        <div class="study-quiz-q">${q.q}</div>
        <div id="sq-choices"></div>
        <div class="test-fb" id="sq-fb" style="display:none"></div>
        <button class="next-btn" id="sq-next" style="display:none">${qi+1<qs.length?'Next →':'See Results'}</button>`;

      const ch = el.querySelector('#sq-choices');
      const fb = el.querySelector('#sq-fb');
      const next = el.querySelector('#sq-next');
      const L = ['A','B','C','D'];
      answered = false;
      q.choices.forEach((c,i)=>{
        const b = document.createElement('button');
        b.className = 'choice-btn';
        b.innerHTML = `<span class="letter">${L[i]}</span>${c}`;
        b.addEventListener('click', ()=>{
          if (answered) return; answered = true;
          const ok = i === q.answer;
          if (ok) score++;
          ch.querySelectorAll('.choice-btn').forEach((x,j)=>{ if(j===q.answer) x.classList.add('show'); });
          b.classList.remove('show'); b.classList.add(ok?'right':'wrong');
          fb.textContent = ok ? `✓ ${q.explanation||'Correct!'}` : `✗ ${q.choices[q.answer]}. ${q.explanation||''}`;
          fb.className = `test-fb ${ok?'right':'wrong'}`;
          fb.style.display = 'block';
          next.style.display = 'block';
        });
        ch.appendChild(b);
      });

      next.addEventListener('click', ()=>{
        qi++;
        if (qi >= qs.length) {
          const pct = Math.round(score/qs.length*100);
          const msg = pct===100?'Perfect!':pct>=80?'Great job!':pct>=60?'Good effort!':'Keep studying!';
          el.innerHTML = `
            <div style="text-align:center;padding:20px 0">
              <div class="score-ring" style="margin:0 auto 14px"><span class="score-pct">${pct}%</span><span class="score-lbl">SCORE</span></div>
              <div style="font-size:13px;font-weight:600;color:#fff;margin-bottom:6px">${msg}</div>
              <div style="font-size:11px;color:var(--mid);margin-bottom:16px">${score}/${qs.length} correct</div>
              <button class="sh-gen-btn" id="sq-again">↺ Retake Quiz</button>
            </div>`;
          el.querySelector('#sq-again')?.addEventListener('click',()=>{ qi=0; score=0; renderQuiz(); });
        } else {
          renderQuiz();
        }
      });
    };
    renderQuiz();

  } else if (tab === 'glossary') {
    const cs = d.concepts || [];
    el.innerHTML = `
      <div class="study-section">
        <div class="study-sec-label">KEY TERMS — ${cs.length} TERMS</div>
        ${cs.map(c=>`
          <div class="study-gloss-row">
            <div class="study-gloss-term">${c.term}</div>
            <div class="study-gloss-def">${c.def}</div>
          </div>`).join('')}
      </div>
      <div class="study-section">
        <div class="study-sec-label">LOOK UP ANOTHER TERM</div>
        <div style="display:flex;gap:7px">
          <input class="res-input" id="gloss-q" placeholder="Enter any term from this topic..." autocomplete="off"/>
          <button class="res-go" id="gloss-go">Define</button>
        </div>
        <div id="gloss-ans" style="margin-top:8px"></div>
      </div>`;

    const gGo = el.querySelector('#gloss-go');
    const gQ  = el.querySelector('#gloss-q');
    const gAns= el.querySelector('#gloss-ans');
    const doGloss = async()=>{
      const term = gQ.value.trim(); if (!term) return;
      gGo.disabled = true; gGo.textContent = '...';
      gAns.innerHTML = `<div style="font-size:11px;color:var(--mid)">Looking up...</div>`;
      try {
        const reply = await callServer(`In the context of ${_studyData.subject||'this topic'}, define "${term}" clearly in 2-3 sentences. Include an example if helpful.`, { ctx: _studyCtx });
        gAns.innerHTML = `<div class="ai-bubble" style="max-width:100%;font-size:12px">${fmt(reply)}</div>`;
      } catch {
        gAns.innerHTML = `<div style="font-size:11px;color:var(--red)">Server offline.</div>`;
      }
      gGo.disabled = false; gGo.textContent = 'Define';
    };
    gGo.addEventListener('click', doGloss);
    gQ.addEventListener('keydown', e=>{ if(e.key==='Enter') doGloss(); });
  }
}

// 🎓 Tutor Mode — toggle, no sheet
document.getElementById('btn-tutor').addEventListener('click', ()=>{
  tutorActive=!tutorActive;
  document.getElementById('btn-tutor').classList.toggle('active',tutorActive);
  addMsg(tutorActive
    ? "🎓 Tutor mode on — I'll guide you with hints instead of direct answers."
    : "Tutor mode off.", 'auto');
});

// ── Subscription helpers (popup context — no ES module imports) ───────────────
async function getPopupUserId() {
  return new Promise(resolve => {
    chrome.storage.local.get('plutoUserId', ({ plutoUserId }) => {
      if (plutoUserId) return resolve(plutoUserId);
      const id = 'u_' + Math.random().toString(36).slice(2, 12);
      chrome.storage.local.set({ plutoUserId: id }, () => resolve(id));
    });
  });
}

async function checkPopupSubscription() {
  return new Promise(resolve => {
    chrome.storage.local.get(['plutoSubTier', 'plutoSubCheckedAt'], async ({ plutoSubTier, plutoSubCheckedAt }) => {
      const CACHE_TTL = 10 * 60 * 1000;
      if (plutoSubTier && plutoSubCheckedAt && (Date.now() - plutoSubCheckedAt) < CACHE_TTL) {
        return resolve({ tier: plutoSubTier, canUseAutomation: plutoSubTier === 'premium' });
      }
      try {
        const userId = await getPopupUserId();
        const r = await fetch('https://pluto-server-production.up.railway.app/check-subscription', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId }),
        });
        const data = await r.json();
        chrome.storage.local.set({ plutoSubTier: data.tier, plutoSubCheckedAt: Date.now() });
        resolve(data);
      } catch {
        resolve({ tier: plutoSubTier || 'free', canUseAutomation: false });
      }
    });
  });
}

function showPopupPaywallModal(featureName) {
  // Remove any existing modal first
  document.getElementById('popup-paywall-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'popup-paywall-modal';
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;
    background:rgba(0,0,0,.82);backdrop-filter:blur(6px);
  `;
  overlay.innerHTML = `
    <div style="background:#0a0a14;border:1px solid rgba(255,255,255,.12);border-radius:16px;
                padding:28px 24px;width:300px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.7);">
      <div style="font-size:30px;margin-bottom:10px">⭐</div>
      <div style="font-size:17px;font-weight:700;color:#fff;margin-bottom:6px">Pluto Premium</div>
      <div style="font-size:12px;color:rgba(255,255,255,.4);margin-bottom:20px;line-height:1.6">
        ${featureName} is a Premium feature.<br>Upgrade to unlock it.
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px">
        <button id="ppw-monthly" style="background:#4f8ef7;color:#fff;border:none;border-radius:9px;
          padding:11px;font-size:13px;font-weight:600;cursor:pointer;">Monthly — $5.99/mo</button>
        <button id="ppw-annual" style="background:rgba(255,255,255,.07);color:#fff;
          border:1px solid rgba(255,255,255,.15);border-radius:9px;padding:11px;
          font-size:13px;font-weight:600;cursor:pointer;">
          Annual — $59.99/yr &nbsp;<span style="font-size:11px;color:#5ef8a0">Save 50%</span>
        </button>
      </div>
      <button id="ppw-close" style="background:none;border:none;color:rgba(255,255,255,.25);
        font-size:12px;cursor:pointer;text-decoration:underline">Maybe later</button>
    </div>
  `;
  document.body.appendChild(overlay);

  async function startCheckout(interval) {
    try {
      const userId = await getPopupUserId();
      const r = await fetch('https://pluto-server-production.up.railway.app/create-checkout-session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, interval }),
      });
      const { url, error } = await r.json();
      if (error) { addMsg('Checkout error: ' + error, 'auto'); return; }
      chrome.tabs.create({ url });
    } catch {
      addMsg('Could not reach server.', 'auto');
    }
    overlay.remove();
  }

  overlay.querySelector('#ppw-monthly').addEventListener('click', () => startCheckout('monthly'));
  overlay.querySelector('#ppw-annual').addEventListener('click',  () => startCheckout('annual'));
  overlay.querySelector('#ppw-close').addEventListener('click',   () => overlay.remove());
}

// 🤖 Automate
document.getElementById('btn-automate').addEventListener('click', async ()=>{
  if (automateActive) {
    automateActive=false;
    document.getElementById('btn-automate').classList.remove('active');
    autoPill.classList.add('hidden');
    // Stop: set window global directly AND send message as fallback
    chrome.tabs.query({active:true, lastFocusedWindow:true}, tabs=>{
      if(!tabs[0]?.id) return;
      // Kill via executeScript (most reliable — same context as runAutomation)
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id, allFrames: true },
        func: () => { window._plutoRunning = false; }
      }).catch(()=>{});
      // Also send message as fallback
      chrome.tabs.sendMessage(tabs[0].id, {type:'PLUTO_STOP'}, ()=>{});
    });
    addAutoLog('Automation stopped');
    return;
  }

  // PAYWALL DISABLED
  automateActive=true;
  document.getElementById('btn-automate').classList.add('active');
  autoPill.classList.remove('hidden');

  chrome.tabs.query({active:true, lastFocusedWindow:true}, async tabs=>{
    if(!tabs[0]?.id){addAutoLog('⚠️ No active tab'); return;}
    const url = tabs[0].url || '';
    const tabId = tabs[0].id;

    if(url.startsWith('chrome://')||url.startsWith('chrome-extension://')||url.startsWith('about:')){
      addAutoLog('⚠️ Navigate to a study site first');
      automateActive=false;
      document.getElementById('btn-automate').classList.remove('active');
      autoPill.classList.add('hidden'); return;
    }

    const site = detectSite(url);
    addAutoLog(`Starting → ${site.toUpperCase()} mode`);

    // Step 1: ping background to ensure content script injected — pass tabId explicitly
    const pingResult = await new Promise(resolve => {
      chrome.runtime.sendMessage({type:'PLUTO_PING_TAB', tabId}, r => {
        if(chrome.runtime.lastError){ console.log('[Pluto] ping error:', chrome.runtime.lastError.message); resolve({ready:false}); }
        else resolve(r || {ready:false});
      });
    });

    if(!pingResult.ready){
      addAutoLog('⚠️ Could not load automation on this page');
      automateActive=false;
      document.getElementById('btn-automate').classList.remove('active');
      autoPill.classList.add('hidden'); return;
    }

    addAutoLog('✓ Loaded — scanning page...');

    // Step 2: run automation via executeScript — no message timeout, runs until done
    chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: (site) => {
        if (typeof runAutomation === 'function') {
          window._plutoRunning = true;
          return runAutomation(site);
        }
        return Promise.resolve({ error: 'runAutomation not found' });
      },
      args: [site]
    }).then(results => {
      // allFrames returns an array — pick the frame that answered the most
      const allRes = (results || []).map(r => r?.result).filter(r => r?.answered !== undefined);
      const res = allRes.reduce((best, r) => (!best || r.answered > best.answered) ? r : best, null)
                  || results?.[0]?.result;
      if (res?.answered !== undefined) {
        chrome.runtime.sendMessage({
          type: 'PLUTO_DONE',
          answered: res.answered || 0,
          skipped: res.skipped || 0,
          site: res.site || site
        });
      }
      automateActive = false;
      document.getElementById('btn-automate').classList.remove('active');
      autoPill.classList.add('hidden');
    }).catch(err => {
      addAutoLog('⚠️ ' + err.message);
      automateActive = false;
      document.getElementById('btn-automate').classList.remove('active');
      autoPill.classList.add('hidden');
    });
  });
});

chrome.runtime.onMessage.addListener(msg=>{
  if(msg.type==='PLUTO_PROGRESS') addAutoLog(msg.msg, msg.answered, msg.skipped);
  if(msg.type==='PLUTO_DONE') showProgCard({answered:msg.answered||0, skipped:msg.skipped||0, site:msg.site||''});
  if(msg.type==='PLUTO_ASK_SELECTION'){
    // Close any open sheet so chat is visible, prefill and send
    if(activeSheet) closeSheet();
    userInput.value = msg.text;
    userInput.focus();
    sendBtn.click();
  }
  if(msg.type==='REFRESH_BRAIN_STATS') loadBrainPanel();
});

function detectSite(url){
  if(url.includes('membean'))  return'membean';
  if(url.includes('quiz-lti')) return'newquizzes';
  if(url.includes('quizlet'))  return'quizlet';
  if(url.includes('blooket'))  return'blooket';
  if(url.includes('kahoot'))   return'kahoot';
  if(url.includes('duolingo')) return'duolingo';
  return'generic';
}

// 🃏 Flashcards sheet
document.getElementById('btn-flash').addEventListener('click', ()=>{
  if(activeSheet==='flash'){closeSheet();return;}
  openSheet('flash','🃏 FLASHCARDS', buildFlashSheet);
});

// 📝 Test sheet
document.getElementById('btn-test').addEventListener('click', ()=>{
  if(activeSheet==='test'){closeSheet();return;}
  openSheet('test','📝 PRACTICE TEST', buildTestSheet);
});

// 🔬 Research sheet
document.getElementById('btn-research').addEventListener('click', ()=>{
  if(activeSheet==='research'){closeSheet();return;}
  openSheet('research','🔬 RESEARCH', buildResearchSheet);
});

// ── FLASHCARDS ────────────────────────────────────────────────────
let cards=[], cIdx=0, cCorrect=0, cWrong=[];

function buildFlashSheet(el) {
  el.innerHTML=`
    <div class="src-toggle">
      <button class="src-btn on" id="fc-from-page">From this page</button>
      <button class="src-btn"   id="fc-from-notes">Paste notes</button>
    </div>
    <textarea class="sh-input" id="fc-notes" placeholder="Paste notes, textbook content..." style="display:none"></textarea>
    <button class="sh-gen-btn" id="fc-gen">✨ Generate Flashcards</button>
    <div id="fc-deck-area" style="display:none">
      <div class="fc-prog-row">
        <span id="fc-cnt">1/1</span>
        <div class="fc-prog-bar"><div class="fc-prog-fill" id="fc-bar"></div></div>
        <span class="fc-score" id="fc-sc">0 ✓</span>
      </div>
      <div class="flip-card" id="fc-card">
        <div class="flip-inner">
          <div class="flip-front"><div class="fc-lbl">TERM</div><div class="fc-txt" id="fc-front"></div><div class="fc-hint">tap to flip</div></div>
          <div class="flip-back"><div class="fc-lbl">DEFINITION</div><div class="fc-txt" id="fc-back"></div></div>
        </div>
      </div>
      <div class="grade-row">
        <button class="grade-btn again"   id="fc-again">✗ Again</button>
        <button class="grade-btn skip"    id="fc-skip">→ Skip</button>
        <button class="grade-btn correct" id="fc-got">✓ Got it</button>
      </div>
      <div class="fc-nav-row">
        <button class="fc-nav-btn" id="fc-prev">← Prev</button>
        <button class="fc-nav-btn" id="fc-restart">↺ Restart</button>
        <button class="fc-nav-btn" id="fc-next">Next →</button>
      </div>
    </div>`;

  const fromPage  = el.querySelector('#fc-from-page');
  const fromNotes = el.querySelector('#fc-from-notes');
  const notesTA   = el.querySelector('#fc-notes');
  const genBtn    = el.querySelector('#fc-gen');
  const deckArea  = el.querySelector('#fc-deck-area');

  fromPage.addEventListener('click',()=>{
    fromPage.classList.add('on'); fromNotes.classList.remove('on');
    notesTA.style.display='none';
  });
  fromNotes.addEventListener('click',()=>{
    fromNotes.classList.add('on'); fromPage.classList.remove('on');
    notesTA.style.display='block';
  });

  genBtn.addEventListener('click', async()=>{
    genBtn.disabled=true; genBtn.textContent='✨ Generating...';
    try {
      let content='';
      if(fromNotes.classList.contains('on')){
        content=notesTA.value.trim();
        if(!content){genBtn.disabled=false;genBtn.textContent='✨ Generate Flashcards';return;}
      } else {
        const ctx=await getPageContext();
        content=(ctx.text||ctx.title).slice(0,3000);
      }
      const raw=await callServer(`Create 10 flashcards from this content. Reply ONLY as a JSON array, no preamble:\n[{"term":"...","def":"..."}]\nContent: "${content}"`);
      cards=parseJSON(raw);
      cIdx=0; cCorrect=0; cWrong=[];
      genBtn.style.display='none';
      fromPage.closest('.src-toggle').style.display='none';
      if(notesTA) notesTA.style.display='none';
      deckArea.style.display='block';
      renderCard(el);
    } catch {
      genBtn.disabled=false; genBtn.textContent='✨ Generate Flashcards';
      genBtn.textContent='Failed — check server';
    }
  });

  el.querySelector('#fc-card').addEventListener('click',()=> el.querySelector('#fc-card').classList.toggle('flipped'));
  el.querySelector('#fc-got').addEventListener('click',  ()=>{ cCorrect++; advCard(1,el); });
  el.querySelector('#fc-again').addEventListener('click',()=>{ cWrong.push(cIdx); advCard(1,el); });
  el.querySelector('#fc-skip').addEventListener('click', ()=>advCard(1,el));
  el.querySelector('#fc-prev').addEventListener('click', ()=>advCard(-1,el));
  el.querySelector('#fc-next').addEventListener('click', ()=>advCard(1,el));
  el.querySelector('#fc-restart').addEventListener('click',()=>{ cIdx=0;cCorrect=0;cWrong=[];renderCard(el); });

  if(cards.length>0){ deckArea.style.display='block'; genBtn.style.display='none'; fromPage.closest('.src-toggle').style.display='none'; renderCard(el); }
}

function renderCard(el){
  const c=cards[cIdx]; if(!c)return;
  el.querySelector('#fc-card').classList.remove('flipped');
  el.querySelector('#fc-front').textContent=c.term;
  el.querySelector('#fc-back').textContent=c.def;
  el.querySelector('#fc-cnt').textContent=`${cIdx+1}/${cards.length}`;
  el.querySelector('#fc-bar').style.width=`${((cIdx+1)/cards.length)*100}%`;
  el.querySelector('#fc-sc').textContent=`${cCorrect} ✓`;
}

function advCard(dir,el){ cIdx=Math.max(0,Math.min(cards.length-1,cIdx+dir)); renderCard(el); }

// ── PRACTICE TEST ─────────────────────────────────────────────────
let tQs=[], tIdx=0, tScore=0, tNumQ=5, tDiff='mixed', tAnswered=false;

function buildTestSheet(el) {
  el.innerHTML=`
    <div id="test-cfg">
      <div class="config-row">
        <span class="config-lbl">Questions</span>
        <div class="pills">
          <button class="pill on" data-n="5">5</button>
          <button class="pill"    data-n="10">10</button>
          <button class="pill"    data-n="15">15</button>
        </div>
      </div>
      <div class="config-row" style="margin-top:6px">
        <span class="config-lbl">Difficulty</span>
        <div class="pills">
          <button class="pill on" data-d="mixed">Mixed</button>
          <button class="pill"    data-d="easy">Easy</button>
          <button class="pill"    data-d="hard">Hard</button>
        </div>
      </div>
      <button class="sh-gen-btn" id="test-gen" style="margin-top:12px">🎯 Generate Test</button>
    </div>
    <div id="test-run"  style="display:none">
      <div class="fc-prog-row">
        <span id="t-qcnt">Q1/5</span>
        <div class="fc-prog-bar"><div class="fc-prog-fill" id="t-bar"></div></div>
        <span class="fc-score" id="t-sc">0/0</span>
      </div>
      <div class="test-q-box" id="t-qtxt"></div>
      <div id="t-choices"></div>
      <div id="t-fb" style="display:none" class="test-fb"></div>
      <button class="next-btn" id="t-next" style="display:none">Next →</button>
    </div>
    <div id="test-res" style="display:none">
      <div class="score-ring"><span class="score-pct" id="t-pct">0%</span><span class="score-lbl">SCORE</span></div>
      <button class="retry-btn" id="t-retry">↺ Try Again</button>
    </div>`;

  // pill logic
  el.querySelectorAll('[data-n]').forEach(p=>p.addEventListener('click',()=>{
    el.querySelectorAll('[data-n]').forEach(x=>x.classList.remove('on'));
    p.classList.add('on'); tNumQ=+p.dataset.n;
  }));
  el.querySelectorAll('[data-d]').forEach(p=>p.addEventListener('click',()=>{
    el.querySelectorAll('[data-d]').forEach(x=>x.classList.remove('on'));
    p.classList.add('on'); tDiff=p.dataset.d;
  }));

  el.querySelector('#test-gen').addEventListener('click',async()=>{
    const btn=el.querySelector('#test-gen');
    btn.disabled=true; btn.textContent='🎯 Generating...';
    try {
      const ctx=await getPageContext();
      const content=(ctx.text||ctx.title).slice(0,3000);
      const raw=await callServer(`Generate ${tNumQ} multiple choice questions (${tDiff} difficulty) from this content.
Reply ONLY as a JSON array, no preamble, no backticks:
[{"q":"...","choices":["A","B","C","D"],"answer":0,"explanation":"..."}]
Content: "${content}"`, {ctx});
      tQs=parseJSON(raw); tIdx=0; tScore=0; tAnswered=false;
      el.querySelector('#test-cfg').style.display='none';
      el.querySelector('#test-run').style.display='block';
      renderQ(el);
    } catch {
      btn.disabled=false; btn.textContent='🎯 Generate Test';
    }
  });

  el.querySelector('#t-next').addEventListener('click',()=>{
    tIdx++;
    if(tIdx>=tQs.length) showResults(el);
    else renderQ(el);
  });
  el.querySelector('#t-retry').addEventListener('click',()=>{
    el.querySelector('#test-res').style.display='none';
    el.querySelector('#test-cfg').style.display='block';
    const genBtn=el.querySelector('#test-gen');
    genBtn.disabled=false; genBtn.textContent='🎯 Generate Test';
  });
}

function renderQ(el){
  const q=tQs[tIdx]; if(!q)return;
  tAnswered=false;
  const total=tQs.length;
  el.querySelector('#t-qcnt').textContent=`Q${tIdx+1}/${total}`;
  el.querySelector('#t-bar').style.width=`${((tIdx+1)/total)*100}%`;
  el.querySelector('#t-sc').textContent=`${tScore}/${tIdx}`;
  el.querySelector('#t-qtxt').textContent=q.q;
  el.querySelector('#t-fb').style.display='none';
  el.querySelector('#t-next').style.display='none';
  const ch=el.querySelector('#t-choices');
  ch.innerHTML='';
  const L=['A','B','C','D'];
  q.choices.forEach((c,i)=>{
    const b=document.createElement('button');
    b.className='choice-btn';
    b.innerHTML=`<span class="letter">${L[i]}</span>${c}`;
    b.addEventListener('click',()=>{
      if(tAnswered)return; tAnswered=true;
      const ok=i===q.answer;
      if(ok)tScore++;
      ch.querySelectorAll('.choice-btn').forEach((x,j)=>{
        if(j===q.answer)x.classList.add('show');
      });
      b.classList.remove('show');
      b.classList.add(ok?'right':'wrong');
      const fb=el.querySelector('#t-fb');
      fb.textContent=ok?`✓ ${q.explanation||'Correct!'}`:`✗ Answer: "${q.choices[q.answer]}". ${q.explanation||''}`;
      fb.className=`test-fb ${ok?'right':'wrong'}`;
      fb.style.display='block';
      el.querySelector('#t-next').style.display='block';
      el.querySelector('#t-sc').textContent=`${tScore}/${tIdx+1}`;
    });
    ch.appendChild(b);
  });
}

function showResults(el){
  el.querySelector('#test-run').style.display='none';
  const res=el.querySelector('#test-res');
  res.style.display='block';
  el.querySelector('#t-pct').textContent=Math.round(tScore/tQs.length*100)+'%';
}

// ── RESEARCH ──────────────────────────────────────────────────────
function buildResearchSheet(el) {
  el.innerHTML=`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <span class="sh-label" style="margin:0">CITATION FORMAT</span>
      <select class="cite-sel" id="r-fmt">
        <option>MLA</option><option>APA</option><option>Chicago</option>
      </select>
    </div>
    <div class="res-input-row">
      <input class="res-input" id="r-q" placeholder="Topic, thesis, or question..." autocomplete="off"/>
      <button class="res-go" id="r-go">Find Sources</button>
    </div>
    <div id="r-results"></div>`;

  const go=el.querySelector('#r-go');
  const qInput=el.querySelector('#r-q');
  const doSearch=async()=>{
    const query=qInput.value.trim(); if(!query)return;
    const fmt=el.querySelector('#r-fmt').value;
    go.disabled=true; go.textContent='Finding...';
    el.querySelector('#r-results').innerHTML=`<div style="font-size:10.5px;color:var(--mid);font-family:'DM Mono',monospace;padding:8px 0">Searching...</div>`;
    try {
      const raw=await callServer(`Research assistant. Find 4 real verifiable sources on: "${query}"
Reply ONLY as a JSON array, no preamble, no backticks:
[{"title":"...","author":"...","source":"...","year":"...","citation":"${fmt} citation","summary":"1 sentence","type":"journal|gov|news|edu"}]`);
      go.disabled=false; go.textContent='Find Sources';
      const sources=parseJSON(raw);
      const resEl=el.querySelector('#r-results');
      resEl.innerHTML='';
      sources.forEach(s=>{
        const card=document.createElement('div');
        card.className='res-card';

        // Title (link if URL available)
        const titleEl=document.createElement('div');
        titleEl.className='res-title';
        if(s.url&&s.url.startsWith('http')){
          const a=document.createElement('a');
          a.href=s.url; a.target='_blank'; a.rel='noopener noreferrer';
          a.textContent=s.title;
          a.style.cssText='color:#fff;text-decoration:none;border-bottom:1px solid rgba(255,255,255,0.2)';
          a.addEventListener('mouseover',()=>a.style.borderBottomColor='var(--blue)');
          a.addEventListener('mouseout', ()=>a.style.borderBottomColor='rgba(255,255,255,0.2)');
          titleEl.appendChild(a);
        } else {
          titleEl.textContent=s.title;
        }

        const metaEl=document.createElement('div');
        metaEl.className='res-meta';
        metaEl.textContent=`${s.author||s.source} · ${s.year} · ${s.type||'source'}${s.url&&s.url.startsWith('http')?' · 🔗':''}`;

        const sumEl=document.createElement('div');
        sumEl.className='res-sum'; sumEl.textContent=s.summary;

        const citeEl=document.createElement('div');
        citeEl.className='res-cite'; citeEl.textContent=s.citation;

        const btnsEl=document.createElement('div');
        btnsEl.className='res-btns';

        const copyBtn=document.createElement('button');
        copyBtn.className='res-btn'; copyBtn.textContent='Copy '+fmt;
        copyBtn.addEventListener('click',()=>{
          navigator.clipboard.writeText(s.citation).catch(()=>{});
          copyBtn.textContent='Copied!';
          setTimeout(()=>{ copyBtn.textContent='Copy '+fmt; },1800);
        });

        const injectBtn=document.createElement('button');
        injectBtn.className='res-btn'; injectBtn.textContent='Insert in Doc';
        injectBtn.addEventListener('click',()=>injectCiteToTab(s.citation));

        btnsEl.appendChild(copyBtn); btnsEl.appendChild(injectBtn);
        card.appendChild(titleEl); card.appendChild(metaEl);
        card.appendChild(sumEl); card.appendChild(citeEl); card.appendChild(btnsEl);
        resEl.appendChild(card);
      });
    } catch {
      go.disabled=false; go.textContent='Find Sources';
      el.querySelector('#r-results').innerHTML=`<div style="font-size:10.5px;color:var(--red);padding:8px 0">Failed — check server.</div>`;
    }
  };
  go.addEventListener('click',doSearch);
  qInput.addEventListener('keydown',e=>{if(e.key==='Enter')doSearch();});
}

function injectCite(citation) { injectCiteToTab(citation); }

function injectCiteToTab(citation) {
  chrome.tabs.query({active:true, lastFocusedWindow:true}, tabs=>{
    if(!tabs[0]?.id) return;
    // Send directly to tab (not via background which can suspend)
    chrome.tabs.sendMessage(tabs[0].id, {type:'PLUTO_INJECT_TEXT', text:'\n'+citation}, r=>{
      if(chrome.runtime.lastError) {
        // Tab not ready — copy to clipboard as fallback
        navigator.clipboard.writeText(citation).catch(()=>{});
        addAutoLog('Copied to clipboard — paste into doc with Ctrl+V');
      } else {
        addAutoLog('Citation inserted!');
      }
    });
  });
}

// ── SHARED BRAIN PANEL ───────────────────────────────────────────
function renderBrainPanel(data) {
  const asked   = data.pluto_brain_questions_asked  || 0;
  const matched = data.pluto_brain_matches_received || 0;
  const helped  = data.pluto_brain_helped_count     || 0;
  const lastMatches = data.pluto_brain_last_matches || [];
  const size    = data.pluto_brain_size_latest;

  const sizeEl = document.getElementById('brain-size');
  if (sizeEl) sizeEl.textContent = size != null ? size : '500+';
  const askedEl = document.getElementById('brain-asked');
  if (askedEl) askedEl.textContent = asked;
  const matchedEl = document.getElementById('brain-matched');
  if (matchedEl) matchedEl.textContent = matched;
  const helpedEl = document.getElementById('brain-helped');
  if (helpedEl) helpedEl.textContent = '~' + helped;

  const emptyMsg = document.getElementById('brain-empty-msg');
  if (emptyMsg) emptyMsg.style.display = asked === 0 ? '' : 'none';

  const recent = document.getElementById('brain-recent');
  const list   = document.getElementById('brain-recent-list');
  if (!recent || !list) return;
  if (lastMatches.length === 0) {
    recent.style.display = 'none';
  } else {
    recent.style.display = '';
    list.innerHTML = '';
    lastMatches.forEach(m => {
      const raw = m.question || '';
      const text = raw.length > 60 ? raw.slice(0, 60) + '…' : raw;
      const simRaw = Math.min((m.similarity || 0) * 100, 99);
      const chip = document.createElement('div');
      chip.className = 'brain-match-chip';
      chip.innerHTML = `<span class="brain-match-text">${text}</span><span class="brain-match-badge">${simRaw.toFixed(0)}%</span>`;
      list.appendChild(chip);
    });
  }
}

function loadBrainPanel() {
  const keys = [
    'pluto_brain_questions_asked','pluto_brain_matches_received',
    'pluto_brain_helped_count','pluto_brain_last_matches',
    'pluto_brain_size_latest','pluto_brain_panel_open'
  ];
  chrome.storage.local.get(keys, data => {
    renderBrainPanel(data);
    if (data.pluto_brain_panel_open) {
      document.getElementById('brain-panel')?.classList.add('open');
    }
  });
}

function updateBrainStats(matches, totalBrainSize) {
  const keys = [
    'pluto_brain_questions_asked','pluto_brain_matches_received',
    'pluto_brain_helped_count','pluto_brain_last_matches','pluto_brain_size_latest'
  ];
  chrome.storage.local.get(keys, data => {
    const asked   = (data.pluto_brain_questions_asked  || 0) + 1;
    const matched = (data.pluto_brain_matches_received || 0) + matches.length;
    const helped  = Math.round(asked * 2.4);
    const size    = totalBrainSize != null ? totalBrainSize : (data.pluto_brain_size_latest ?? null);
    const update  = {
      pluto_brain_questions_asked:  asked,
      pluto_brain_matches_received: matched,
      pluto_brain_helped_count:     helped,
      pluto_brain_last_matches:     matches.slice(0, 3),
      pluto_brain_size_latest:      size
    };
    chrome.storage.local.set(update, () => renderBrainPanel({ ...data, ...update }));
  });
}

document.getElementById('brain-toggle').addEventListener('click', () => {
  const panel = document.getElementById('brain-panel');
  const isOpen = panel.classList.toggle('open');
  chrome.storage.local.set({ pluto_brain_panel_open: isOpen });
});

// ── STREAK ────────────────────────────────────────────────────────
function updateStreak(){
  chrome.storage.local.get(['streak','lastDate'],data=>{
    const today=new Date().toLocaleDateString();
    let s=data.streak||0;
    if(data.lastDate!==today){ s++; chrome.storage.local.set({streak:s,lastDate:today}); }
    document.getElementById('streak-count').innerText=s;
  });
}

// ── POPUP SESSION (pluto_chats integration) ───────────────────────
function initPopupSession(existingChats) {
  activeChatId = 'chat_' + Date.now();
  const newChat = {
    id: activeChatId,
    title: 'Popup Chat',
    created: Date.now(),
    updated: Date.now(),
    messages: []
  };
  // Drop prior empty sessions (no messages) to avoid sidebar clutter
  const cleaned = (existingChats || []).filter(c => c.messages.length > 0);
  cleaned.unshift(newChat);
  chrome.storage.local.set({
    pluto_chats: cleaned.slice(0, 200),
    pluto_active_chat: activeChatId
  });
}

function saveMessageToChat(userText, aiReply) {
  if (!activeChatId) return;
  chrome.storage.local.get('pluto_chats', ({ pluto_chats }) => {
    const chats = pluto_chats || [];
    const chat = chats.find(c => c.id === activeChatId);
    if (!chat) return;
    chat.messages.push(
      { role: 'user',      text: userText,  timestamp: Date.now() - 500 },
      { role: 'assistant', text: aiReply,   timestamp: Date.now() }
    );
    if (chat.messages.length === 2) {
      chat.title = userText.slice(0, 40) + (userText.length > 40 ? '…' : '');
    }
    chat.updated = Date.now();
    chrome.storage.local.set({ pluto_chats: chats });
  });
}

// Open in full window
document.getElementById('btn-open-full').addEventListener('click', () => {
  const url = activeChatId
    ? chrome.runtime.getURL('chat.html') + '?chat=' + activeChatId
    : chrome.runtime.getURL('chat.html');
  chrome.tabs.create({ url });
});

// ── INIT ──────────────────────────────────────────────────────────
chrome.storage.local.get(['chatHistory','theme','userProfile','pluto_chats'],result=>{
  setTheme(result.theme||'silver');
  window.userProfile=result.userProfile||null;
  updateStreak();
  loadBrainPanel();
  setInterval(loadBrainPanel, 5000);
  initPopupSession(result.pluto_chats);

  if(result.userProfile?.name){
    const sub=document.getElementById('subtitle');
    if(sub) sub.innerText=`${result.userProfile.name.toLowerCase()}'s study partner`;
  }

  if(result.chatHistory?.length>0){
    chatHistory=result.chatHistory;
    chatHistory.forEach(m=>addMsg(m.text,m.sender));
  } else {
    addMsg("Hey — I'm Pluto. Your AI study partner. What's your name?",'ai');
  }
});

// ── STAR CANVAS ───────────────────────────────────────────────
(function(){
  const canvas = document.getElementById('star-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let stars = [], raf;

  canvas.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0;';

  function resize(){
    canvas.width  = window.innerWidth  || 380;
    canvas.height = window.innerHeight || 520;
    stars = [];
    const n = Math.floor(canvas.width * canvas.height / 2200);
    for (let i=0;i<n;i++){
      const sz=Math.random();
      stars.push({ x:Math.random()*canvas.width, y:Math.random()*canvas.height,
        r: sz<.65?.4:sz<.88?.9:1.4+Math.random()*.6,
        op:.05+Math.random()*.4, spd:.0012+Math.random()*.006,
        ph:Math.random()*Math.PI*2, hue:Math.random()<.05?(Math.random()<.5?210:45):0 });
    }
  }

  function draw(t){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    for(const s of stars){
      const op=s.op*(.4+.6*Math.sin(t*s.spd+s.ph));
      ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,Math.PI*2);
      ctx.fillStyle=s.hue?`hsla(${s.hue},70%,85%,${op})`:`rgba(255,255,255,${op})`;
      ctx.fill();
      if(s.r>1.2){
        const g=ctx.createRadialGradient(s.x,s.y,0,s.x,s.y,s.r*4);
        g.addColorStop(0,`rgba(255,255,255,${op*.18})`); g.addColorStop(1,'rgba(0,0,0,0)');
        ctx.beginPath(); ctx.arc(s.x,s.y,s.r*4,0,Math.PI*2); ctx.fillStyle=g; ctx.fill();
      }
    }
    raf = requestAnimationFrame(draw);
  }

  resize();
  window.addEventListener('resize', resize);
  raf = requestAnimationFrame(draw);
})();

// ── PDF SCANNING ──────────────────────────────────────────────
document.getElementById('btn-pdf').addEventListener('click', ()=>{
  if(activeSheet==='pdf'){closeSheet();return;}
  openSheet('pdf','📄 SCAN PDF', buildPDFSheet);
});

function buildPDFSheet(el) {
  el.innerHTML=`
    <div class="pdf-drop" id="pdf-dz">
      <input type="file" id="pdf-file" accept=".pdf,.txt,.md,.docx"/>
      <div class="pdf-drop-icon">📄</div>
      <div class="pdf-drop-text"><strong>Drop a file or tap to browse</strong><br>PDF, TXT, or Markdown</div>
    </div>
    <div id="pdf-chip"></div>
    <div id="pdf-ask-row" style="display:none;gap:6px;margin-top:10px;flex-direction:column">
      <input class="res-input" id="pdf-q" placeholder="Ask a question about this document..." autocomplete="off"/>
      <button class="sh-gen-btn" id="pdf-go">Ask Pluto</button>
    </div>
    <div id="pdf-out" style="margin-top:10px"></div>`;

  const dz    = el.querySelector('#pdf-dz');
  const fi    = el.querySelector('#pdf-file');
  const chip  = el.querySelector('#pdf-chip');
  const askRow= el.querySelector('#pdf-ask-row');
  const pdfGo = el.querySelector('#pdf-go');
  const pdfQ  = el.querySelector('#pdf-q');
  const out   = el.querySelector('#pdf-out');
  let docText = '';

  dz.addEventListener('click', ()=>fi.click());
  dz.addEventListener('dragover', e=>{e.preventDefault(); dz.style.borderColor='var(--accent)';});
  dz.addEventListener('dragleave', ()=>dz.style.borderColor='');
  dz.addEventListener('drop', e=>{ e.preventDefault(); handleFile(e.dataTransfer.files[0]); });
  fi.addEventListener('change', ()=>handleFile(fi.files[0]));

  function showChip(name) {
    dz.style.display='none'; chip.innerHTML='';
    const chipEl=document.createElement('div'); chipEl.className='pdf-file-chip';
    const nameSpan=document.createElement('span'); nameSpan.textContent='📄 '+name;
    const rm=document.createElement('button'); rm.className='pdf-remove'; rm.textContent='✕';
    rm.addEventListener('click',()=>{ dz.style.display=''; chip.innerHTML=''; askRow.style.display='none'; docText=''; out.innerHTML=''; });
    chipEl.appendChild(nameSpan); chipEl.appendChild(rm); chip.appendChild(chipEl);
  }

  function showPasteFallback(msg) {
    out.innerHTML='';
    const warn=document.createElement('div');
    warn.style.cssText='font-size:11px;color:var(--mid);margin-bottom:8px;line-height:1.5';
    warn.textContent=msg||'⚠️ Could not extract text. Paste the document text below:';
    const ta=document.createElement('textarea');
    ta.className='sh-input'; ta.style.height='110px';
    ta.placeholder='Paste document text here, then click Analyze...';
    const ab=document.createElement('button'); ab.className='sh-gen-btn'; ab.textContent='✨ Analyze Text';
    ab.addEventListener('click',async()=>{
      const t=ta.value.trim(); if(!t) return;
      docText=t; ab.disabled=true; ab.textContent='Analyzing...';
      try{
        const r=await callServer('Summarize with structured bullet points, bold key terms:\n\n'+t);
        out.innerHTML=`<div class="ai-bubble" style="max-width:100%;font-size:12px">${fmt(r)}</div>`;
        askRow.style.display='flex';
      }catch{ out.innerHTML=`<div style="font-size:11px;color:var(--red)">Server offline.</div>`; }
      ab.disabled=false; ab.textContent='✨ Analyze Text';
    });
    out.appendChild(warn); out.appendChild(ta); out.appendChild(ab);
  }

  async function handleFile(file) {
    if (!file) return;
    showChip(file.name);
    out.innerHTML=`<div style="font-size:10.5px;color:var(--mid);font-family:'DM Mono',monospace;padding:6px 0">⏳ Reading...</div>`;

    if (file.name.endsWith('.pdf') || file.type==='application/pdf') {
      // Extract text from PDF using DecompressionStream (built into Chrome 80+)
      // No external library needed — works entirely locally
      try {
        const arrayBuf = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuf);

        out.innerHTML=`<div style="font-size:10.5px;color:var(--mid);font-family:'DM Mono',monospace;padding:6px 0">⏳ Extracting text from PDF...</div>`;

        const extracted = await extractPDFText(bytes);

        if (extracted.length < 80) {
          showPasteFallback('⚠️ This PDF uses compressed/scanned text. Paste the text content below:');
          return;
        }

        docText = extracted.slice(0, 7000);
        out.innerHTML=`<div style="font-size:10.5px;color:var(--mid);font-family:'DM Mono',monospace;padding:6px 0">✨ Summarizing...</div>`;
        const reply = await callServer('Summarize this document with structured bullet points. Bold key terms.\n\n'+docText);
        out.innerHTML=`<div class="ai-bubble" style="max-width:100%;font-size:12px">${fmt(reply)}</div>`;
        askRow.style.display='flex';

      } catch(e) {
        console.error('[Pluto PDF]', e);
        showPasteFallback('⚠️ Could not read this PDF. Paste the text content below:');
      }

    } else {
      // Plain text / markdown
      const reader = new FileReader();
      reader.onload = async e => {
        docText = e.target.result.slice(0, 7000);
        try {
          out.innerHTML=`<div style="font-size:10.5px;color:var(--mid);font-family:'DM Mono',monospace;padding:6px 0">✨ Summarizing...</div>`;
          const reply = await callServer('Summarize with structured bullet points, bold key terms:\n\n'+docText);
          out.innerHTML=`<div class="ai-bubble" style="max-width:100%;font-size:12px">${fmt(reply)}</div>`;
          askRow.style.display='flex';
        } catch {
          out.innerHTML=`<div style="font-size:11px;color:var(--red)">Server offline.</div>`;
        }
      };
      reader.readAsText(file);
    }
  }

  async function doAsk(){
    const q=pdfQ.value.trim(); if(!q||!docText) return;
    pdfGo.disabled=true; pdfGo.textContent='Asking...';
    try{
      const reply=await callServer('Document context:\n'+docText.slice(0,5000)+'\n\nQuestion: "'+q+'"');
      out.innerHTML=`<div class="ai-bubble" style="max-width:100%;font-size:12px">${fmt(reply)}</div>`;
    }catch{ out.innerHTML=`<div style="font-size:11px;color:var(--red)">Failed.</div>`; }
    pdfGo.disabled=false; pdfGo.textContent='Ask Pluto'; pdfQ.value='';
  }
  pdfGo.addEventListener('click', doAsk);
  pdfQ.addEventListener('keydown', e=>{ if(e.key==='Enter') doAsk(); });
}

// ── PODCAST GENERATOR ─────────────────────────────────────────
document.getElementById('btn-podcast').addEventListener('click', ()=>{
  if(activeSheet==='podcast'){closeSheet();return;}
  openSheet('podcast','🎙️ PODCAST', buildPodcastSheet);
});

function buildPodcastSheet(el) {
  el.innerHTML=`
    <div class="src-toggle" style="margin-bottom:10px">
      <button class="src-btn on" id="pod-pg">This page</button>
      <button class="src-btn"   id="pod-nt">My notes</button>
    </div>
    <textarea class="sh-input" id="pod-notes" placeholder="Paste notes or topic..." style="display:none"></textarea>
    <div class="config-row" style="margin-bottom:12px">
      <span class="config-lbl">LENGTH</span>
      <div class="pills">
        <button class="pill on" data-len="short">2 min</button>
        <button class="pill"    data-len="medium">5 min</button>
        <button class="pill"    data-len="long">10 min</button>
      </div>
    </div>
    <button class="sh-gen-btn" id="pod-gen">🎙️ Generate Podcast</button>
    <div id="pod-area" style="margin-top:12px"></div>`;

  const fromPage =el.querySelector('#pod-pg');
  const fromNotes=el.querySelector('#pod-nt');
  const notesTA  =el.querySelector('#pod-notes');
  let podLen='short';

  fromPage.addEventListener('click',()=>{ fromPage.classList.add('on'); fromNotes.classList.remove('on'); notesTA.style.display='none'; });
  fromNotes.addEventListener('click',()=>{ fromNotes.classList.add('on'); fromPage.classList.remove('on'); notesTA.style.display='block'; });
  el.querySelectorAll('[data-len]').forEach(p=>p.addEventListener('click',()=>{
    el.querySelectorAll('[data-len]').forEach(x=>x.classList.remove('on'));
    p.classList.add('on'); podLen=p.dataset.len;
  }));

  el.querySelector('#pod-gen').addEventListener('click', async()=>{
    const btn=el.querySelector('#pod-gen');
    btn.disabled=true; btn.textContent='✨ Writing script...';
    const podArea=el.querySelector('#pod-area');
    podArea.innerHTML=`<div class="pod-generating"><div class="pod-gen-spinner">⚙️</div><div class="pod-gen-label">GENERATING SCRIPT...</div></div>`;

    try{
      let content='';
      if(fromNotes.classList.contains('on')){ content=notesTA.value.trim(); }
      else{ const ctx=await getPageContext(); content=(ctx.text||ctx.title).slice(0,4000); }

      const words={short:300,medium:750,long:1500}[podLen]||300;
      const script=await callServer(`Write a podcast episode as a lively back-and-forth dialogue between two hosts: ALEX and SAM. (~${words} words total)

STRICT FORMAT — every single line must start with "ALEX: " or "SAM: ", nothing else:
ALEX: [what alex says]
SAM: [what sam says]
ALEX: [response]
...

Rules:
- Alternate frequently — every 1-3 sentences per turn
- ALEX opens with a punchy hook about the topic
- They ask each other questions, react with enthusiasm, and build on each others points
- Include 3-4 key ideas from the content with real examples
- SAM wraps up with a memorable takeaway
- No stage directions, no descriptions, no blank lines, no headers

Topic: "${content.slice(0,200)}..."
Content:
${content}`);

      // Parse into per-speaker segments
      const segments=[];
      script.split('\n').forEach(line=>{
        const a=line.match(/^ALEX:\s*(.+)/i);
        const s=line.match(/^SAM:\s*(.+)/i);
        if(a && a[1].trim()) segments.push({speaker:'ALEX',text:a[1].trim()});
        else if(s && s[1].trim()) segments.push({speaker:'SAM',text:s[1].trim()});
      });
      // Fallback: no dialogue parsed — treat whole thing as ALEX
      if(!segments.length) segments.push({speaker:'ALEX',text:script});

      // Pick two distinct voices
      const [voiceA,voiceB]=await podPickVoices();

      podArea.innerHTML='';

      // Player UI
      const player=document.createElement('div');
      player.className='podcast-player';
      player.innerHTML=`
        <div class="pod-header">
          <div class="pod-icon">🎙️</div>
          <div class="pod-meta">
            <div class="pod-title" id="pod-ttl">Pluto Podcast</div>
            <div class="pod-sub">${podLen} · 2 hosts · AI-generated</div>
          </div>
        </div>
        <div id="pod-speaker" style="text-align:center;font-size:10px;font-family:'DM Mono',monospace;color:var(--mid);min-height:16px;margin-bottom:4px"></div>
        <div class="pod-progress">
          <div class="pod-bar"><div class="pod-fill" id="pod-fill"></div></div>
          <div class="pod-times"><span id="pod-cur">0:00</span><span id="pod-dur">—:——</span></div>
        </div>
        <div class="pod-controls">
          <button class="pod-btn" id="pod-back">⏮</button>
          <button class="pod-btn pod-play" id="pod-play">▶</button>
          <button class="pod-btn" id="pod-fwd">⏭</button>
          <button class="pod-speed" id="pod-spd">1×</button>
        </div>`;
      podArea.appendChild(player);

      // Script display — colour-coded by speaker
      const scriptBox=document.createElement('div');
      scriptBox.className='ai-bubble';
      scriptBox.style.cssText='max-width:100%;font-size:11px;margin-top:10px;line-height:1.8;max-height:200px;overflow-y:auto';
      const scriptHdr=`<div style="font-size:8.5px;letter-spacing:1.5px;color:var(--mid);font-family:'DM Mono',monospace;margin-bottom:8px">PODCAST SCRIPT</div>`;
      const scriptLines=segments.map(s=>{
        const col=s.speaker==='ALEX'?'var(--blue)':'var(--accent)';
        return `<div style="margin-bottom:6px"><span style="color:${col};font-weight:700;font-family:'DM Mono',monospace;font-size:9px">${s.speaker}</span> <span style="color:var(--text)">${s.text}</span></div>`;
      }).join('');
      scriptBox.innerHTML=scriptHdr+scriptLines;
      podArea.appendChild(scriptBox);

      getPageContext().then(ctx=>{ const t=podArea.querySelector('#pod-ttl'); if(t) t.textContent=(ctx.title||'Pluto Podcast').slice(0,32); });

      // TTS engine
      const SPEEDS=[0.8,1,1.2,1.5,1.75];
      let speedIdx=1, elapsed=0, ticker=null, isPlaying=false, cancelled=false;
      let segIdx=0;
      const totalWords=segments.reduce((s,sg)=>s+sg.text.split(' ').length,0);
      const estDur=Math.round(totalWords/2.3);

      const playBtn   =podArea.querySelector('#pod-play');
      const backBtn   =podArea.querySelector('#pod-back');
      const fwdBtn    =podArea.querySelector('#pod-fwd');
      const spdBtn    =podArea.querySelector('#pod-spd');
      const fill      =podArea.querySelector('#pod-fill');
      const curEl     =podArea.querySelector('#pod-cur');
      const durEl     =podArea.querySelector('#pod-dur');
      const speakerEl =podArea.querySelector('#pod-speaker');

      durEl.textContent=secFmt(estDur);

      function secFmt(s){return`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;}
      function startTicker(){ clearInterval(ticker); ticker=setInterval(()=>{ elapsed++; curEl.textContent=secFmt(elapsed); fill.style.width=Math.min(100,elapsed/estDur*100)+'%'; },1000); }
      function stopTicker(){ clearInterval(ticker); ticker=null; }

      function speakFrom(idx){
        if(idx>=segments.length){
          isPlaying=false; playBtn.textContent='▶'; stopTicker();
          elapsed=0; curEl.textContent='0:00'; fill.style.width='0%';
          speakerEl.textContent=''; segIdx=0; return;
        }
        const seg=segments[idx];
        const voice=seg.speaker==='ALEX'?voiceA:voiceB;
        const col=seg.speaker==='ALEX'?'var(--blue)':'var(--accent)';
        speakerEl.textContent=seg.speaker==='ALEX'?'🎙️  ALEX':'🎧  SAM';
        speakerEl.style.color=col;

        const u=new SpeechSynthesisUtterance(seg.text);
        if(voice) u.voice=voice;
        u.rate=SPEEDS[speedIdx]; u.lang='en-US';
        u.onstart=()=>{ isPlaying=true; playBtn.textContent='⏸'; if(!ticker) startTicker(); };
        u.onend=()=>{ if(cancelled) return; segIdx++; speakFrom(segIdx); };
        u.onerror=(e)=>{ if(cancelled||e.error==='interrupted'||e.error==='canceled') return; segIdx++; speakFrom(segIdx); };
        window._currentUtterance=u;
        speechSynthesis.speak(u);
      }

      function cancelPlay(){ cancelled=true; speechSynthesis.cancel(); isPlaying=false; stopTicker(); playBtn.textContent='▶'; }

      playBtn.addEventListener('click',()=>{
        if(isPlaying){ cancelPlay(); }
        else{ cancelled=false; speakFrom(segIdx); }
      });

      backBtn.addEventListener('click',()=>{
        cancelPlay(); segIdx=0; elapsed=0; curEl.textContent='0:00'; fill.style.width='0%';
        cancelled=false; speakFrom(0);
      });

      fwdBtn.addEventListener('click',()=>{
        const wasPlaying=isPlaying; cancelPlay();
        segIdx=Math.min(segments.length-1,segIdx+1);
        if(wasPlaying){ cancelled=false; speakFrom(segIdx); }
      });

      spdBtn.addEventListener('click',()=>{
        speedIdx=(speedIdx+1)%SPEEDS.length; spdBtn.textContent=SPEEDS[speedIdx]+'×';
        if(isPlaying){ cancelPlay(); cancelled=false; speakFrom(segIdx); }
      });

      window._podCleanup=()=>{ cancelPlay(); };

    }catch(e){
      podArea.innerHTML=`<div style="font-size:11px;color:var(--red)">Failed — check server.</div>`;
    }
    btn.disabled=false; btn.textContent='🎙️ Generate Podcast';
  });
}

// Pick two distinct English voices — male + female when possible
function podPickVoices(){
  return new Promise(resolve=>{
    function pick(voices){
      const en=voices.filter(v=>v.lang.startsWith('en'));
      if(!en.length) return [null,null];
      if(en.length===1) return [en[0],en[0]];
      const maleRe =/david|james|daniel|mark|george|fred|paul|tom|guy|bruce|aaron/i;
      const femaleRe=/zira|samantha|sarah|victoria|kate|emily|lisa|karen|susan|aria|amy|moira|fiona/i;
      const male  =en.find(v=>maleRe.test(v.name))  || en[0];
      const female=en.find(v=>femaleRe.test(v.name)) || en.find(v=>v!==male) || en[0];
      return [male,female];
    }
    let v=speechSynthesis.getVoices();
    if(v.length){ resolve(pick(v)); return; }
    speechSynthesis.onvoiceschanged=()=>resolve(pick(speechSynthesis.getVoices()));
    setTimeout(()=>resolve([null,null]),1500);
  });
}

// ── PDF TEXT EXTRACTOR ────────────────────────────────────────
// PDF FlateDecode is zlib format (RFC 1950) — must use 'deflate', NOT 'deflate-raw'.
// Falls back to 'deflate-raw' for the rare PDFs that omit the zlib header.
async function extractPDFText(bytes) {
  const raw = new TextDecoder('latin1').decode(bytes);
  const allText = [];

  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m;
  while ((m = streamRe.exec(raw)) !== null) {
    const streamContent = m[1];
    // Look back up to 500 chars for the object dictionary
    const dict = raw.slice(Math.max(0, m.index - 500), m.index);

    // Skip image/XObject streams
    if (/\/Subtype\s*\/Image|\/Subtype\/Image/.test(dict)) continue;

    // Detect FlateDecode (inline or array syntax)
    const isFlate = /\/FlateDecode|\/Fl\b/.test(dict);

    let text = '';
    if (isFlate) {
      const streamBytes = new Uint8Array(streamContent.length);
      for (let i = 0; i < streamContent.length; i++)
        streamBytes[i] = streamContent.charCodeAt(i) & 0xff;

      // Try zlib ('deflate') first — correct for PDF spec.
      // Fall back to raw deflate for non-standard PDFs.
      let decoded = null;
      for (const fmt of ['deflate', 'deflate-raw']) {
        decoded = await pdfDecompress(streamBytes, fmt);
        if (decoded && decoded.length > 10) break;
      }
      if (!decoded) continue;
      text = new TextDecoder('latin1').decode(decoded);
    } else {
      text = streamContent;
    }

    pdfExtractText(text, allText);
  }

  return allText.filter(t => t.trim().length > 0).join(' ').replace(/\s+/g, ' ').trim();
}

async function pdfDecompress(bytes, format) {
  try {
    const ds = new DecompressionStream(format);
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();
    // Write async — don't block on the promise; errors surface via reader
    writer.write(bytes).catch(()=>{});
    writer.close().catch(()=>{});
    const chunks = [];
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
    } catch {} // partial decode is acceptable
    if (!chunks.length) return null;
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const c of chunks) { out.set(c, pos); pos += c.length; }
    return out;
  } catch { return null; }
}

function pdfExtractText(text, allText) {
  const btRe = /BT([\s\S]*?)ET/g;
  let bt;
  while ((bt = btRe.exec(text)) !== null) {
    const block = bt[1];
    // (text)Tj
    for (const t of block.matchAll(/\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*Tj/g))
      allText.push(decodePDFString(t[1]));
    // [(text)-n(text)...]TJ
    for (const t of block.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      const joined = [...t[1].matchAll(/\(([^)\\]*(?:\\.[^)\\]*)*)\)/g)]
        .map(p => decodePDFString(p[1])).join('');
      if (joined.trim()) allText.push(joined);
    }
    // (text)' and (text)"
    for (const t of block.matchAll(/\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*['"]/g))
      allText.push(decodePDFString(t[1]));
  }
}

function decodePDFString(s) {
  return s
    .replace(/\\n/g, ' ').replace(/\\r/g, ' ').replace(/\\t/g, ' ')
    .replace(/\\\(/g, '(').replace(/\\\)/g, ')').replace(/\\\\/g, '\\')
    .replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}
// ── OPEN RESEARCH HUB + GAME + DASHBOARD ──────────────────────
document.getElementById('btn-dashboard')?.addEventListener('click', ()=>{
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
});
document.getElementById('btn-hub')?.addEventListener('click', ()=>{
  chrome.tabs.create({ url: chrome.runtime.getURL('research.html') });
});
document.getElementById('btn-game')?.addEventListener('click', ()=>{
  chrome.tabs.create({ url: chrome.runtime.getURL('game.html') });
});

// ================================================================
// NEW FEATURES
// ================================================================

// ── RESEARCH (now opens hub in new tab) ───────────────────────
document.getElementById('btn-research')?.addEventListener('click', ()=>{
  if(activeSheet==='research'){closeSheet();return;}
  openSheet('research','🔬 RESEARCH', buildResearchSheet);
});

// ── 📅 TASK PLANNER (Canvas scanner + smart to-do) ────────────
document.getElementById('btn-planner')?.addEventListener('click', ()=>{
  if(activeSheet==='planner'){closeSheet();return;}
  openSheet('planner','📅 TASK PLANNER', buildPlannerSheet);
});

function buildPlannerSheet(el) {
  el.innerHTML = `
    <div id="pl-scan-row" style="margin-bottom:12px">
      <button class="sh-gen-btn" id="pl-scan">🔍 Scan This Page for Tasks</button>
    </div>
    <div id="pl-manual-row" style="display:flex;gap:6px;margin-bottom:14px">
      <input class="res-input" id="pl-input" placeholder="Add a task manually..." autocomplete="off"/>
      <button class="res-go" id="pl-add">Add</button>
    </div>
    <div id="pl-tasks"></div>
    <div id="pl-ai-section" style="margin-top:14px;display:none">
      <div style="font-size:9px;letter-spacing:1.5px;color:var(--mid);font-family:'DM Mono',monospace;margin-bottom:8px">AI STUDY PLAN</div>
      <div id="pl-ai-output"></div>
    </div>`;

  const tasks = JSON.parse(localStorage.getItem('pluto_tasks') || '[]');

  function saveTasks(){ localStorage.setItem('pluto_tasks', JSON.stringify(tasks)); }

  function renderTasks(){
    const container = el.querySelector('#pl-tasks');
    container.innerHTML = '';
    if(!tasks.length){
      container.innerHTML = `<div style="font-size:11px;color:var(--dim);text-align:center;padding:16px 0">No tasks yet — scan the page or add manually</div>`;
      return;
    }
    // Group by priority
    const urgent = tasks.filter(t=>t.priority==='urgent');
    const normal = tasks.filter(t=>t.priority==='normal');
    const done   = tasks.filter(t=>t.done);
    const undone = [...urgent,...normal].filter(t=>!t.done);

    if(undone.length){
      const label = document.createElement('div');
      label.style.cssText='font-size:9px;letter-spacing:1.5px;color:var(--mid);font-family:"DM Mono",monospace;margin-bottom:6px';
      label.textContent='TO DO';
      container.appendChild(label);
    }
    [...undone,...done].forEach((task,i)=>{
      const row = document.createElement('div');
      row.style.cssText=`display:flex;align-items:center;gap:8px;padding:9px 11px;background:var(--s1);border:1px solid ${task.priority==='urgent'?'rgba(255,95,95,0.2)':'var(--b1)'};border-radius:9px;margin-bottom:5px;opacity:${task.done?'0.5':'1'}`;
      const cb = document.createElement('input');
      cb.type='checkbox'; cb.checked=task.done;
      cb.style.cssText='width:14px;height:14px;cursor:pointer;accent-color:var(--green);flex-shrink:0';
      cb.addEventListener('change',()=>{ task.done=cb.checked; saveTasks(); renderTasks(); });
      const txt = document.createElement('div');
      txt.style.cssText=`flex:1;font-size:12px;color:${task.done?'var(--dim)':'var(--text)'};text-decoration:${task.done?'line-through':'none'};line-height:1.4`;
      txt.textContent = task.text;
      const meta = document.createElement('div');
      meta.style.cssText='font-size:9px;color:var(--mid);font-family:"DM Mono",monospace;white-space:nowrap';
      if(task.due) meta.textContent = task.due;
      if(task.priority==='urgent'){ const badge=document.createElement('span'); badge.style.cssText='background:rgba(255,95,95,0.1);color:var(--red);font-size:8px;padding:1px 6px;border-radius:4px;margin-left:4px;font-family:"DM Mono",monospace'; badge.textContent='URGENT'; meta.appendChild(badge); }
      const del = document.createElement('button');
      del.style.cssText='background:transparent;border:none;color:var(--dim);cursor:pointer;font-size:13px;line-height:1';
      del.textContent='×';
      del.addEventListener('click',()=>{ tasks.splice(tasks.indexOf(task),1); saveTasks(); renderTasks(); });
      row.appendChild(cb); row.appendChild(txt); row.appendChild(meta); row.appendChild(del);
      container.appendChild(row);
    });

    if(undone.length > 0){
      const planBtn = document.createElement('button');
      planBtn.className='sh-gen-btn'; planBtn.style.marginTop='10px';
      planBtn.textContent='🧠 Generate Study Plan';
      planBtn.addEventListener('click', ()=>generateStudyPlan(undone, el));
      container.appendChild(planBtn);
    }
  }

  // Scan page for tasks/assignments
  el.querySelector('#pl-scan').addEventListener('click', async()=>{
    const btn = el.querySelector('#pl-scan');
    btn.disabled=true; btn.textContent='⏳ Scanning...';
    const ctx = await getPageContext();
    try{
      const raw = await callServer(`You are scanning a student's page for assignments, tasks, and deadlines.
Page: "${ctx.title}" — ${ctx.url}
Content: "${ctx.text.slice(0,3000)}"

Extract ALL assignments, tasks, quizzes, tests, deadlines, and to-dos.
Return ONLY a JSON array:
[{"text":"assignment name or task","due":"due date if found, else null","priority":"urgent|normal","done":false}]
If nothing found, return [].`);
      const s=raw.indexOf('['),e=raw.lastIndexOf(']');
      const found = JSON.parse(raw.slice(s,e+1));
      if(!found.length){
        btn.disabled=false; btn.textContent='🔍 Scan This Page for Tasks';
        addAutoLog('No tasks found on this page');
        return;
      }
      found.forEach(t=>{ if(!tasks.find(x=>x.text===t.text)) tasks.push(t); });
      saveTasks(); renderTasks();
      addAutoLog(`Found ${found.length} tasks!`);
    }catch(e){
      addAutoLog('⚠️ Scan failed — check server');
    }
    btn.disabled=false; btn.textContent='🔍 Scan This Page for Tasks';
  });

  // Manual add
  const addTask = ()=>{
    const input = el.querySelector('#pl-input');
    const text = input.value.trim(); if(!text) return;
    tasks.push({text, due:null, priority:'normal', done:false});
    saveTasks(); renderTasks(); input.value='';
  };
  el.querySelector('#pl-add').addEventListener('click', addTask);
  el.querySelector('#pl-input').addEventListener('keydown',e=>{ if(e.key==='Enter') addTask(); });

  renderTasks();
}

async function generateStudyPlan(tasks, el){
  const aiSection = el.querySelector('#pl-ai-section');
  const aiOut = el.querySelector('#pl-ai-output');
  aiSection.style.display='block';
  aiOut.innerHTML='<div style="font-size:10.5px;color:var(--mid);font-family:\'DM Mono\',monospace">✨ Creating plan...</div>';
  try{
    const taskList = tasks.map(t=>`- ${t.text}${t.due?' (due '+t.due+')':''}`).join('\n');
    const plan = await callServer(`Create a realistic study plan for these tasks:\n${taskList}\n\nMake it: daily schedule, time estimates, what to study first and why. Be specific and motivating. Keep it concise.`);
    aiOut.innerHTML=`<div class="ai-bubble" style="max-width:100%;font-size:12px">${fmt(plan)}</div>`;
  }catch{
    aiOut.innerHTML='<div style="font-size:11px;color:var(--red)">Server offline.</div>';
  }
}

// ── ⏱️ FOCUS TIMER (Pomodoro) ─────────────────────────────────
document.getElementById('btn-timer')?.addEventListener('click', ()=>{
  if(activeSheet==='timer'){closeSheet();return;}
  openSheet('timer','⏱️ FOCUS TIMER', buildTimerSheet);
});

function buildTimerSheet(el){
  el.innerHTML=`
    <div style="text-align:center;padding:10px 0">
      <div id="tm-label" style="font-size:9px;letter-spacing:2px;color:var(--mid);font-family:'DM Mono',monospace;margin-bottom:12px">FOCUS SESSION</div>
      <div id="tm-display" style="font-size:52px;font-weight:200;letter-spacing:-2px;color:#fff;font-family:'DM Mono',monospace;margin-bottom:4px">25:00</div>
      <div id="tm-mode" style="font-size:10px;color:var(--mid);font-family:'DM Mono',monospace;margin-bottom:20px">POMODORO</div>
      <div id="tm-ring" style="width:120px;height:120px;margin:0 auto 20px;position:relative">
        <svg width="120" height="120" viewBox="0 0 120 120" style="transform:rotate(-90deg)">
          <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="6"/>
          <circle cx="60" cy="60" r="52" fill="none" stroke="var(--accent)" stroke-width="6"
            stroke-dasharray="326.7" id="tm-arc" stroke-linecap="round"/>
        </svg>
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--mid);font-family:'DM Mono',monospace" id="tm-sessions">0 done</div>
      </div>
      <div style="display:flex;gap:8px;justify-content:center;margin-bottom:16px">
        <button class="sh-gen-btn" id="tm-start" style="flex:0 0 auto;padding:10px 24px">▶ Start</button>
        <button class="res-go" id="tm-reset" style="padding:10px 14px">↺</button>
      </div>
      <div style="display:flex;gap:6px;justify-content:center">
        <button class="fmt-pill on" data-mins="25" id="p25">🍅 25m</button>
        <button class="fmt-pill" data-mins="50" id="p50">⚡ 50m</button>
        <button class="fmt-pill" data-mins="5"  id="p5">☕ 5m</button>
      </div>
    </div>`;

  let total=25*60, remaining=25*60, running=false, interval=null, sessions=0;

  function updateDisplay(){
    const m=Math.floor(remaining/60), s=remaining%60;
    el.querySelector('#tm-display').textContent=`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    const pct=remaining/total;
    el.querySelector('#tm-arc').style.strokeDashoffset=326.7*(1-pct);
    el.querySelector('#tm-arc').style.stroke=remaining<60?'var(--red)':remaining<total*0.25?'var(--gold)':'var(--accent)';
  }

  el.querySelector('#tm-start').addEventListener('click',()=>{
    if(running){
      running=false; clearInterval(interval);
      el.querySelector('#tm-start').textContent='▶ Resume';
    } else {
      running=true;
      el.querySelector('#tm-start').textContent='⏸ Pause';
      interval=setInterval(()=>{
        remaining--;
        updateDisplay();
        if(remaining<=0){
          clearInterval(interval); running=false;
          sessions++;
          el.querySelector('#tm-sessions').textContent=sessions+' done';
          el.querySelector('#tm-start').textContent='▶ Start';
          remaining=total;
          // Reward
          addAutoLog(`⏱️ Focus session complete! +${sessions*5} coins`);
          // Update game coins too
          const gc=parseInt(localStorage.getItem('pq_coins')||'0');
          localStorage.setItem('pq_coins',gc+sessions*5);
          updateDisplay();
        }
      },1000);
    }
  });

  el.querySelector('#tm-reset').addEventListener('click',()=>{
    clearInterval(interval); running=false; remaining=total;
    el.querySelector('#tm-start').textContent='▶ Start';
    updateDisplay();
  });

  el.querySelectorAll('[data-mins]').forEach(p=>p.addEventListener('click',()=>{
    el.querySelectorAll('[data-mins]').forEach(x=>x.classList.remove('on'));
    p.classList.add('on');
    clearInterval(interval); running=false;
    total=parseInt(p.dataset.mins)*60; remaining=total;
    el.querySelector('#tm-mode').textContent=p.dataset.mins==='5'?'SHORT BREAK':p.dataset.mins==='50'?'DEEP WORK':'POMODORO';
    el.querySelector('#tm-start').textContent='▶ Start';
    updateDisplay();
  }));

  updateDisplay();
}

// ── 🧮 GRADE CALCULATOR ───────────────────────────────────────
document.getElementById('btn-grade')?.addEventListener('click', ()=>{
  if(activeSheet==='grade'){closeSheet();return;}
  openSheet('grade','🧮 GRADE CALCULATOR', buildGradeSheet);
});

function buildGradeSheet(el){
  const grades = JSON.parse(localStorage.getItem('pluto_grades') || '[]');

  function save(){ localStorage.setItem('pluto_grades',JSON.stringify(grades)); }

  function render(){
    el.innerHTML=`
      <div style="margin-bottom:12px">
        <div style="display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:5px;margin-bottom:8px;font-size:9px;color:var(--mid);font-family:'DM Mono',monospace;padding:0 2px">
          <span>ASSIGNMENT</span><span>SCORE</span><span>WEIGHT %</span><span></span>
        </div>
        <div id="grade-rows"></div>
        <button class="fmt-pill" id="add-grade-btn" style="margin-top:8px">+ Add</button>
      </div>
      <div style="background:var(--s1);border:1px solid var(--b1);border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:9px;letter-spacing:1.5px;color:var(--mid);font-family:'DM Mono',monospace;margin-bottom:6px">CURRENT GRADE</div>
        <div id="grade-result" style="font-size:36px;font-weight:200;letter-spacing:-1px;color:#fff">—</div>
        <div id="grade-letter" style="font-size:12px;color:var(--accent);font-family:'DM Mono',monospace;margin-top:4px"></div>
      </div>
      <button class="sh-gen-btn" id="grade-advice-btn" style="margin-top:10px">🧠 What do I need to get an A?</button>`;

    const rowsEl = el.querySelector('#grade-rows');
    grades.forEach((g,i)=>{
      const row=document.createElement('div');
      row.style.cssText='display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:5px;margin-bottom:5px';
      row.innerHTML=`
        <input class="res-input" style="padding:6px 8px;font-size:12px" value="${g.name}" placeholder="Assignment"/>
        <input class="res-input" style="padding:6px 8px;font-size:12px;text-align:center" value="${g.score}" placeholder="95"/>
        <input class="res-input" style="padding:6px 8px;font-size:12px;text-align:center" value="${g.weight}" placeholder="20"/>
        <button style="background:transparent;border:none;color:var(--dim);cursor:pointer;font-size:16px;padding:0 4px">×</button>`;
      row.querySelectorAll('input').forEach((inp,j)=>{
        inp.addEventListener('input',()=>{
          if(j===0) g.name=inp.value;
          if(j===1) g.score=inp.value;
          if(j===2) g.weight=inp.value;
          save(); calcGrade();
        });
      });
      row.querySelector('button').addEventListener('click',()=>{ grades.splice(i,1); save(); render(); });
      rowsEl.appendChild(row);
    });

    el.querySelector('#add-grade-btn').addEventListener('click',()=>{
      grades.push({name:'',score:'',weight:''}); save(); render();
    });

    el.querySelector('#grade-advice-btn').addEventListener('click', async()=>{
      const btn=el.querySelector('#grade-advice-btn');
      btn.disabled=true; btn.textContent='Thinking...';
      const current=calcGrade();
      try{
        const advice=await callServer(`A student has a current grade of ${current}% in their class. The remaining assignments are:\n${grades.filter(g=>!g.score).map(g=>`- ${g.name} (${g.weight}% of grade)`).join('\n')||'Unknown'}\nWhat grades do they need on remaining work to get an A (90%+)?  Be specific and encouraging.`);
        const out=document.createElement('div');
        out.className='ai-bubble'; out.style.cssText='max-width:100%;font-size:12px;margin-top:10px';
        out.innerHTML=fmt(advice);
        el.appendChild(out);
      }catch{} 
      btn.disabled=false; btn.textContent='🧠 What do I need to get an A?';
    });

    calcGrade();
  }

  function calcGrade(){
    const valid=grades.filter(g=>g.score&&g.weight&&!isNaN(g.score)&&!isNaN(g.weight));
    if(!valid.length){ el.querySelector('#grade-result').textContent='—'; return 0; }
    const totalWeight=valid.reduce((s,g)=>s+parseFloat(g.weight),0);
    const weighted=valid.reduce((s,g)=>s+parseFloat(g.score)*parseFloat(g.weight)/100,0);
    const pct=totalWeight>0?Math.round(weighted/totalWeight*100):0;
    const resEl=el.querySelector('#grade-result');
    const letEl=el.querySelector('#grade-letter');
    resEl.textContent=pct+'%';
    resEl.style.color=pct>=90?'var(--green)':pct>=80?'var(--blue)':pct>=70?'var(--gold)':'var(--red)';
    letEl.textContent=pct>=93?'A':pct>=90?'A-':pct>=87?'B+':pct>=83?'B':pct>=80?'B-':pct>=77?'C+':pct>=70?'C':'D';
    return pct;
  }

  render();
}

// ── 🎵 STUDY MOOD / AMBIENT SOUNDS ───────────────────────────
// Persistent sound state — survives sheet open/close
const _mood = { actx:null, cleanupFns:[], masterGain:null, playing:null, sliderVal:40 };

function syncMoodBtn(){
  const b=document.getElementById('btn-mood');
  if(!b) return;
  if(_mood.playing){ b.classList.add('active'); b.title=`🎵 ${_mood.playing}`; }
  else { if(activeSheet!=='mood') b.classList.remove('active'); b.title='Focus Sounds'; }
}

document.getElementById('btn-mood')?.addEventListener('click', ()=>{
  if(activeSheet==='mood'){closeSheet();return;}
  openSheet('mood','🎵 FOCUS SOUNDS', buildMoodSheet);
});

function buildMoodSheet(el){
  // Science notes shown when each sound plays
  const MOODS=[
    {name:'Rain',        emoji:'🌧️', color:'#5ef8a0', fn:'rain',   sci:'Masks distracting noise; lowers cortisol'},
    {name:'Ocean',       emoji:'🌊', color:'#4f8ef7', fn:'ocean',  sci:'Rhythmic waves reduce anxiety by ~28%'},
    {name:'Forest',      emoji:'🌲', color:'#3da86e', fn:'forest', sci:'Nature sounds restore directed attention'},
    {name:'Fire',        emoji:'🔥', color:'#f07030', fn:'fire',   sci:'Fireplace sounds lower blood pressure'},
    {name:'Night',       emoji:'🌙', color:'#8870f0', fn:'night',  sci:'Cricket soundscapes reduce mental fatigue'},
    {name:'White Noise', emoji:'⬜', color:'#b0b0c8', fn:'white',  sci:'Masks speech; improves task persistence'},
    {name:'Pink Noise',  emoji:'🌸', color:'#f080b0', fn:'pink',   sci:'Boosts memory consolidation during study'},
    {name:'Brown Noise', emoji:'🟫', color:'#a07050', fn:'brown',  sci:'Deep rumble proven to help ADHD focus'},
    {name:'Lo-fi',       emoji:'🎵', color:'#4f8ef7', fn:'lofi',   sci:'Mild positive mood → better creativity'},
    {name:'Cafe',        emoji:'☕', color:'#f0c060', fn:'cafe',   sci:'~70dB ambient noise optimal for creativity'},
    {name:'Alpha Waves', emoji:'🧘', color:'#60d0f0', fn:'alpha',  sci:'10Hz binaural → relaxed alertness, ↓ anxiety'},
    {name:'Deep Focus',  emoji:'🧠', color:'#c060f0', fn:'deep',   sci:'40Hz gamma + theta binaural beat combo'},
  ];

  // Use module-level _mood state so sound persists when sheet closes

  el.innerHTML=`
    <div style="font-size:9.5px;color:var(--mid);text-align:center;margin-bottom:12px">Generated in-browser — no internet needed</div>
    <div id="mood-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:12px"></div>
    <div id="mood-sci" style="font-size:10px;color:var(--mid);text-align:center;font-style:italic;min-height:16px;margin-bottom:10px"></div>
    <div id="mood-vol" style="display:none">
      <div style="font-size:9px;color:var(--mid);font-family:'DM Mono',monospace;margin-bottom:6px;letter-spacing:1px">VOLUME</div>
      <input type="range" id="vol-slider" min="0" max="100" value="40" style="width:100%"/>
    </div>`;

  const grid=el.querySelector('#mood-grid');
  const sciEl=el.querySelector('#mood-sci');

  MOODS.forEach(m=>{
    const btn=document.createElement('div');
    btn.style.cssText=`background:var(--s1);border:1px solid var(--b1);border-radius:11px;padding:13px 6px 10px;text-align:center;cursor:pointer;transition:all .2s`;
    btn.innerHTML=`<div style="font-size:22px;margin-bottom:5px">${m.emoji}</div><div style="font-size:10px;font-weight:600;color:#fff;line-height:1.2">${m.name}</div>`;
    btn.addEventListener('click',()=>{
      grid.querySelectorAll('div').forEach(b=>{ b.style.border='1px solid var(--b1)'; b.style.background='var(--s1)'; });
      if(_mood.playing===m.name){ stopAll(); _mood.playing=null; sciEl.textContent=''; syncMoodBtn(); return; }
      btn.style.border=`1px solid ${m.color}`; btn.style.background=`${m.color}18`;
      startSound(m.fn); _mood.playing=m.name;
      sciEl.textContent=m.sci;
      el.querySelector('#mood-vol').style.display='block';
      syncMoodBtn();
    });
    grid.appendChild(btn);
  });

  // Restore active state if a sound is already playing (sheet was reopened)
  if(_mood.playing){
    const activeM=MOODS.find(m=>m.name===_mood.playing);
    if(activeM){
      const btns=[...grid.querySelectorAll('div')];
      const idx=MOODS.indexOf(activeM);
      if(btns[idx]){ btns[idx].style.border=`1px solid ${activeM.color}`; btns[idx].style.background=`${activeM.color}18`; }
      sciEl.textContent=activeM.sci;
      el.querySelector('#mood-vol').style.display='block';
      el.querySelector('#vol-slider').value=_mood.sliderVal;
    }
  }

  el.querySelector('#vol-slider').addEventListener('input',e=>{
    _mood.sliderVal=parseInt(e.target.value);
    if(_mood.masterGain) _mood.masterGain.gain.value=_mood.sliderVal/100*0.35;
  });

  // ── helpers ───────────────────────────────────────────────────
  function noise(sec=4){
    const sr=_mood.actx.sampleRate, buf=_mood.actx.createBuffer(1,sr*sec,sr), d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i]=Math.random()*2-1;
    const s=_mood.actx.createBufferSource(); s.buffer=buf; s.loop=true; return s;
  }
  function lfo(freq,amt,target){
    const o=_mood.actx.createOscillator(), g=_mood.actx.createGain();
    o.frequency.value=freq; g.gain.value=amt;
    o.connect(g); g.connect(target); o.start();
    _mood.cleanupFns.push(()=>{ try{o.stop();}catch{} });
  }
  function sineTone(freq,gainVal){
    const o=_mood.actx.createOscillator(), g=_mood.actx.createGain();
    o.type='sine'; o.frequency.value=freq; g.gain.value=gainVal;
    o.connect(g); g.connect(_mood.masterGain); o.start();
    _mood.cleanupFns.push(()=>{ try{o.stop();}catch{} });
    return g;
  }
  function bp(node,freq,q){ const f=_mood.actx.createBiquadFilter(); f.type='bandpass'; f.frequency.value=freq; f.Q.value=q; node.connect(f); return f; }
  function lp(node,freq){ const f=_mood.actx.createBiquadFilter(); f.type='lowpass'; f.frequency.value=freq; node.connect(f); return f; }
  function hp(node,freq){ const f=_mood.actx.createBiquadFilter(); f.type='highpass'; f.frequency.value=freq; node.connect(f); return f; }
  function gain(node,val){ const g=_mood.actx.createGain(); g.gain.value=val; node.connect(g); g.connect(_mood.masterGain); return g; }

  // ── sound engines ─────────────────────────────────────────────

  function soundRain(){
    // Layer 1: fine drizzle hiss (2.5kHz bandpass, tight Q)
    const drizzle=noise(5); gain(bp(lp(drizzle,12000),2500,1.2), 0.55).connect; // already connected via gain()
    const d=noise(5); const dbp=_mood.actx.createBiquadFilter(); dbp.type='bandpass'; dbp.frequency.value=2500; dbp.Q.value=1.2;
    const dlp=_mood.actx.createBiquadFilter(); dlp.type='lowpass'; dlp.frequency.value=12000;
    const dg=_mood.actx.createGain(); dg.gain.value=0.55;
    d.connect(dbp); dbp.connect(dlp); dlp.connect(dg); dg.connect(_mood.masterGain); d.start();
    lfo(3.2, 0.14, dg.gain); // patter rhythm

    // Layer 2: heavy drops hitting surface (4–6kHz sharp transients)
    const drops=noise(4); const dbp2=_mood.actx.createBiquadFilter(); dbp2.type='bandpass'; dbp2.frequency.value=5000; dbp2.Q.value=2;
    const dg2=_mood.actx.createGain(); dg2.gain.value=0.2;
    drops.connect(dbp2); dbp2.connect(dg2); dg2.connect(_mood.masterGain); drops.start();
    lfo(1.8, 0.12, dg2.gain);

    // Layer 3: low rumble / wet ground
    const rumble=noise(4); const rlp=_mood.actx.createBiquadFilter(); rlp.type='lowpass'; rlp.frequency.value=130;
    const rg=_mood.actx.createGain(); rg.gain.value=0.25;
    rumble.connect(rlp); rlp.connect(rg); rg.connect(_mood.masterGain); rumble.start();

    // Layer 4: distant thunder (very low rumble swell, very slow LFO)
    const thunder=noise(6); const tlp=_mood.actx.createBiquadFilter(); tlp.type='lowpass'; tlp.frequency.value=60;
    const tg=_mood.actx.createGain(); tg.gain.value=0.08;
    thunder.connect(tlp); tlp.connect(tg); tg.connect(_mood.masterGain); thunder.start();
    lfo(0.04, 0.07, tg.gain);

    _mood.cleanupFns.push(()=>{ try{d.stop();drops.stop();rumble.stop();thunder.stop();}catch{} });
  }

  function soundOcean(){
    // Wave swell: two bandpass noise streams with offset LFOs
    [[700,0.5,0.28,0.12],[420,0.4,0.15,0.09]].forEach(([freq,q,gainV,lfoAmt],i)=>{
      const n=noise(6);
      const bpf=_mood.actx.createBiquadFilter(); bpf.type='bandpass'; bpf.frequency.value=freq; bpf.Q.value=q;
      const g=_mood.actx.createGain(); g.gain.value=gainV;
      n.connect(bpf); bpf.connect(g); g.connect(_mood.masterGain); n.start();
      lfo(0.11-i*0.02, lfoAmt, g.gain); // slightly offset wave timing
      _mood.cleanupFns.push(()=>{ try{n.stop();}catch{} });
    });
    // Surf boom: deep swelling low-pass
    const surf=noise(4); const slp=_mood.actx.createBiquadFilter(); slp.type='lowpass'; slp.frequency.value=90;
    const sg=_mood.actx.createGain(); sg.gain.value=0.18;
    surf.connect(slp); slp.connect(sg); sg.connect(_mood.masterGain); surf.start();
    lfo(0.11, 0.12, sg.gain);
    _mood.cleanupFns.push(()=>{ try{surf.stop();}catch{} });
  }

  function soundForest(){
    const wind=noise(6);
    const whp=_mood.actx.createBiquadFilter(); whp.type='highpass'; whp.frequency.value=200;
    const wlp=_mood.actx.createBiquadFilter(); wlp.type='lowpass'; wlp.frequency.value=1600;
    const wg=_mood.actx.createGain(); wg.gain.value=0.38;
    wind.connect(whp); whp.connect(wlp); wlp.connect(wg); wg.connect(_mood.masterGain); wind.start();
    lfo(0.11, 0.17, wg.gain);
    _mood.cleanupFns.push(()=>{ try{wind.stop();}catch{} });

    let birdT;
    function singleChirp(delay){
      const o=_mood.actx.createOscillator(), g=_mood.actx.createGain();
      const f=1900+Math.random()*1500; o.type='sine';
      const t=_mood.actx.currentTime+delay;
      o.frequency.setValueAtTime(f,t);
      o.frequency.exponentialRampToValueAtTime(f*1.45,t+0.06);
      o.frequency.exponentialRampToValueAtTime(f*0.88,t+0.17);
      g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(0.052,t+0.02); g.gain.linearRampToValueAtTime(0,t+0.19);
      o.connect(g); g.connect(_mood.masterGain); o.start(t); o.stop(t+0.21);
    }
    function chirp(){ if(!_mood.actx)return; singleChirp(0); if(Math.random()<0.45)singleChirp(0.28); birdT=setTimeout(chirp,2500+Math.random()*5000); }
    chirp();
    _mood.cleanupFns.push(()=>clearTimeout(birdT));
  }

  function soundFire(){
    // Base fire body: lowpass noise 80–700Hz, flicker LFOs
    const base=noise(5);
    const flp=_mood.actx.createBiquadFilter(); flp.type='lowpass'; flp.frequency.value=700;
    const fhp=_mood.actx.createBiquadFilter(); fhp.type='highpass'; fhp.frequency.value=80;
    const fg=_mood.actx.createGain(); fg.gain.value=0.42;
    base.connect(flp); flp.connect(fhp); fhp.connect(fg); fg.connect(_mood.masterGain); base.start();
    lfo(4.5, 0.16, fg.gain); lfo(2.2, 0.09, fg.gain); // fire flicker

    // Crackle pops: short filtered noise impulses 1–5kHz
    let crackT;
    function crackle(){
      if(!_mood.actx) return;
      const buf=_mood.actx.createBuffer(1,Math.floor(_mood.actx.sampleRate*0.035),_mood.actx.sampleRate);
      const d=buf.getChannelData(0);
      for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.exp(-i*18/d.length);
      const src=_mood.actx.createBufferSource();
      const cbp=_mood.actx.createBiquadFilter(); cbp.type='bandpass'; cbp.frequency.value=1500+Math.random()*3500; cbp.Q.value=0.6;
      const cg=_mood.actx.createGain(); cg.gain.value=0.07;
      src.buffer=buf; src.connect(cbp); cbp.connect(cg); cg.connect(_mood.masterGain); src.start();
      crackT=setTimeout(crackle, 150+Math.random()*700);
    }
    crackle();
    _mood.cleanupFns.push(()=>{ try{base.stop();}catch{} clearTimeout(crackT); });
  }

  function soundNight(){
    // Soft background: very low-level pink-ish noise (night air)
    const bg=noise(4); const blp=_mood.actx.createBiquadFilter(); blp.type='lowpass'; blp.frequency.value=600;
    const bgg=_mood.actx.createGain(); bgg.gain.value=0.07;
    bg.connect(blp); blp.connect(bgg); bgg.connect(_mood.masterGain); bg.start();
    _mood.cleanupFns.push(()=>{ try{bg.stop();}catch{} });

    // Crickets: bursts of ~4.3kHz rapid amplitude pulses
    let cricketT;
    function cricketBurst(){
      if(!_mood.actx) return;
      const pulses=3+Math.floor(Math.random()*4);
      for(let i=0;i<pulses;i++){
        const o=_mood.actx.createOscillator(), g=_mood.actx.createGain();
        o.type='sine'; o.frequency.value=4100+Math.random()*500;
        const t=_mood.actx.currentTime+i*0.055;
        g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(0.038,t+0.008); g.gain.linearRampToValueAtTime(0,t+0.045);
        o.connect(g); g.connect(_mood.masterGain); o.start(t); o.stop(t+0.055);
      }
      // Occasional distant frog
      if(Math.random()<0.08){
        const o=_mood.actx.createOscillator(), g=_mood.actx.createGain();
        o.type='sine'; o.frequency.value=180+Math.random()*80;
        const t=_mood.actx.currentTime+0.4;
        g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(0.025,t+0.06); g.gain.linearRampToValueAtTime(0,t+0.3);
        o.connect(g); g.connect(_mood.masterGain); o.start(t); o.stop(t+0.35);
      }
      cricketT=setTimeout(cricketBurst, 280+Math.random()*380);
    }
    cricketBurst();
    _mood.cleanupFns.push(()=>clearTimeout(cricketT));
  }

  function soundWhite(){
    const n=noise(4); const f=_mood.actx.createBiquadFilter(); f.type='lowpass'; f.frequency.value=4500;
    const g=_mood.actx.createGain(); g.gain.value=0.9;
    n.connect(f); f.connect(g); g.connect(_mood.masterGain); n.start();
    _mood.cleanupFns.push(()=>{ try{n.stop();}catch{} });
  }

  function soundPink(){
    // Pink noise: white noise + high-shelf cuts approximating -3dB/octave
    const n=noise(4);
    const hs1=_mood.actx.createBiquadFilter(); hs1.type='highshelf'; hs1.frequency.value=800; hs1.gain=-7;
    const hs2=_mood.actx.createBiquadFilter(); hs2.type='highshelf'; hs2.frequency.value=3200; hs2.gain=-7;
    const g=_mood.actx.createGain(); g.gain.value=0.9;
    n.connect(hs1); hs1.connect(hs2); hs2.connect(g); g.connect(_mood.masterGain); n.start();
    _mood.cleanupFns.push(()=>{ try{n.stop();}catch{} });
  }

  function soundBrown(){
    // Brown noise: -6dB/octave — double lowpass for deep, rumbling bass
    const n=noise(4);
    const lp1=_mood.actx.createBiquadFilter(); lp1.type='lowpass'; lp1.frequency.value=450;
    const lp2=_mood.actx.createBiquadFilter(); lp2.type='lowpass'; lp2.frequency.value=450;
    const g=_mood.actx.createGain(); g.gain.value=0.95;
    n.connect(lp1); lp1.connect(lp2); lp2.connect(g); g.connect(_mood.masterGain); n.start();
    _mood.cleanupFns.push(()=>{ try{n.stop();}catch{} });
  }

  function soundLofi(){
    // Am7 voicing: detuned sines/triangles with wow/flutter
    [[110,0],[165,-4],[196,6],[220,3],[262,-5],[330,4]].forEach(([f,det],i)=>{
      const o=_mood.actx.createOscillator(), g=_mood.actx.createGain();
      o.type=i<3?'sine':'triangle'; o.frequency.value=f; o.detune.value=det;
      g.gain.value=0.11/(i*0.35+1);
      const wl=_mood.actx.createOscillator(), wg=_mood.actx.createGain();
      wl.frequency.value=0.24+i*0.04; wg.gain.value=5;
      wl.connect(wg); wg.connect(o.detune);
      o.connect(g); g.connect(_mood.masterGain); o.start(); wl.start();
      _mood.cleanupFns.push(()=>{ try{o.stop();wl.stop();}catch{} });
    });
    let crackT;
    function crackle(){
      if(!_mood.actx) return;
      const buf=_mood.actx.createBuffer(1,Math.floor(_mood.actx.sampleRate*0.04),_mood.actx.sampleRate);
      const d=buf.getChannelData(0);
      for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.exp(-i/35);
      const src=_mood.actx.createBufferSource(), cg=_mood.actx.createGain(); cg.gain.value=0.022;
      src.buffer=buf; src.connect(cg); cg.connect(_mood.masterGain); src.start();
      crackT=setTimeout(crackle,900+Math.random()*3500);
    }
    crackle();
    _mood.cleanupFns.push(()=>clearTimeout(crackT));
  }

  function soundCafe(){
    // Chatter: wider bandpass (lower Q) + more variation = more natural voice feel
    [[280,1.2,0.13],[480,1.5,0.11],[750,1.8,0.10],[1100,2,0.09],[1600,2.2,0.07]].forEach(([f,q,gv])=>{
      const n=noise(4); const bpf=_mood.actx.createBiquadFilter(); bpf.type='bandpass'; bpf.frequency.value=f; bpf.Q.value=q;
      const g=_mood.actx.createGain(); g.gain.value=gv;
      n.connect(bpf); bpf.connect(g); g.connect(_mood.masterGain); n.start();
      lfo(0.3+Math.random()*1.5, 0.05, g.gain);
      _mood.cleanupFns.push(()=>{ try{n.stop();}catch{} });
    });

    // Espresso machine: sawtooth through lowpass
    const hum=_mood.actx.createOscillator(), hlp=_mood.actx.createBiquadFilter(), hg=_mood.actx.createGain();
    hum.type='sawtooth'; hum.frequency.value=115; hlp.type='lowpass'; hlp.frequency.value=200; hg.gain.value=0.022;
    hum.connect(hlp); hlp.connect(hg); hg.connect(_mood.masterGain); hum.start();
    _mood.cleanupFns.push(()=>{ try{hum.stop();}catch{} });

    // Background jazz hint: very quiet chord tones cycling through ii-V-I
    const jazzChords=[[262,330,392,466],[294,370,440,523],[247,311,370,440],[196,262,330,392]];
    let jazzT, jazzIdx=0;
    function playJazzChord(){
      if(!_mood.actx) return;
      const chord=jazzChords[jazzIdx%jazzChords.length]; jazzIdx++;
      const now=_mood.actx.currentTime;
      chord.forEach(f=>{
        const o=_mood.actx.createOscillator(), g=_mood.actx.createGain(); o.type='sine'; o.frequency.value=f;
        g.gain.setValueAtTime(0,now); g.gain.linearRampToValueAtTime(0.008,now+0.08);
        g.gain.exponentialRampToValueAtTime(0.003,now+1.6); g.gain.linearRampToValueAtTime(0,now+2.0);
        o.connect(g); g.connect(_mood.masterGain); o.start(now); o.stop(now+2.1);
      });
      jazzT=setTimeout(playJazzChord, 3500+Math.random()*2000);
    }
    playJazzChord();

    // Cup clinks
    let clinkT;
    function clink(){
      if(!_mood.actx) return;
      const o=_mood.actx.createOscillator(), g=_mood.actx.createGain();
      o.type='sine'; o.frequency.value=2100+Math.random()*900;
      const t=_mood.actx.currentTime;
      g.gain.setValueAtTime(0.04,t); g.gain.exponentialRampToValueAtTime(0.0001,t+0.5);
      o.connect(g); g.connect(_mood.masterGain); o.start(t); o.stop(t+0.52);
      clinkT=setTimeout(clink,6000+Math.random()*14000);
    }
    clink();
    _mood.cleanupFns.push(()=>{ clearTimeout(jazzT); clearTimeout(clinkT); });
  }

  function soundAlpha(){
    // Alpha binaural beat: 10Hz (200Hz + 210Hz) → relaxed alertness, ↓ anxiety
    [200,210].forEach(f=>{
      const g=sineTone(f,0.18);
      lfo(0.05,0.02,g.gain);
    });
    // Soft pink-noise bed at very low volume
    const n=noise(4), hs=_mood.actx.createBiquadFilter(); hs.type='highshelf'; hs.frequency.value=1000; hs.gain=-9;
    const g=_mood.actx.createGain(); g.gain.value=0.06;
    n.connect(hs); hs.connect(g); g.connect(_mood.masterGain); n.start();
    _mood.cleanupFns.push(()=>{ try{n.stop();}catch{} });
  }

  function soundDeep(){
    // Theta binaural beat: 6Hz (200Hz + 206Hz) → memory encoding, creativity
    [200,206].forEach(f=>{ const g=sineTone(f,0.15); lfo(0.04,0.02,g.gain); });
    // 40Hz gamma sub-pulse (felt more than heard)
    const sub=_mood.actx.createOscillator(), slp=_mood.actx.createBiquadFilter(), sg=_mood.actx.createGain();
    sub.type='sine'; sub.frequency.value=40; slp.type='lowpass'; slp.frequency.value=80; sg.gain.value=0.26;
    sub.connect(slp); slp.connect(sg); sg.connect(_mood.masterGain); sub.start();
    _mood.cleanupFns.push(()=>{ try{sub.stop();}catch{} });
    // 528Hz Solfeggio space pad
    [[528,0],[531,0],[1056,1]].forEach(([f,det])=>{
      const o=_mood.actx.createOscillator(), g=_mood.actx.createGain();
      o.type='sine'; o.frequency.value=f; o.detune.value=det; g.gain.value=0.036;
      o.connect(g); g.connect(_mood.masterGain); o.start();
      lfo(0.07,0.016,g.gain);
      _mood.cleanupFns.push(()=>{ try{o.stop();}catch{} });
    });
  }

  // ── start / stop ──────────────────────────────────────────────
  function startSound(fn){
    stopAll();
    try{
      _mood.actx=new (window.AudioContext||window.webkitAudioContext)();
      _mood.masterGain=_mood.actx.createGain(); _mood.masterGain.gain.value=0.15; _mood.masterGain.connect(_mood.actx.destination);
      ({rain:soundRain,ocean:soundOcean,forest:soundForest,fire:soundFire,night:soundNight,
        white:soundWhite,pink:soundPink,brown:soundBrown,
        lofi:soundLofi,cafe:soundCafe,alpha:soundAlpha,deep:soundDeep})[fn]();
    }catch(e){ console.log('[Pluto sounds]',e); }
  }

  function stopAll(){
    _mood.cleanupFns.forEach(f=>{ try{f();}catch{} }); _mood.cleanupFns=[];
    try{_mood.actx?.close();}catch{} _mood.actx=null; _mood.masterGain=null;
    _mood.playing=null; syncMoodBtn();
  }
}

// ── 📖 VOCAB BUILDER ──────────────────────────────────────────
document.getElementById('btn-vocab')?.addEventListener('click', ()=>{
  if(activeSheet==='vocab'){closeSheet();return;}
  openSheet('vocab','📖 VOCAB BUILDER', buildVocabSheet);
});

function buildVocabSheet(el){
  const vocab=JSON.parse(localStorage.getItem('pluto_vocab')||'[]');
  function saveVocab(){ localStorage.setItem('pluto_vocab',JSON.stringify(vocab)); }

  el.innerHTML=`
    <div style="margin-bottom:10px">
      <button class="sh-gen-btn" id="vc-from-page">📄 Extract Vocab from This Page</button>
    </div>
    <div style="display:flex;gap:6px;margin-bottom:12px">
      <input class="res-input" id="vc-word" placeholder="Word or phrase..." style="flex:2"/>
      <button class="res-go" id="vc-define">Define</button>
    </div>
    <div id="vc-list"></div>`;

  function renderVocab(){
    const list=el.querySelector('#vc-list');
    list.innerHTML='';
    if(!vocab.length){ list.innerHTML='<div style="font-size:11px;color:var(--dim);text-align:center;padding:12px 0">No vocab saved yet</div>'; return; }
    vocab.slice().reverse().forEach((v,i)=>{
      const ri=vocab.length-1-i;
      const card=document.createElement('div');
      card.style.cssText='background:var(--s1);border:1px solid var(--b1);border-radius:10px;padding:10px 12px;margin-bottom:6px';
      card.innerHTML=`
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
          <div>
            <div style="font-size:13px;font-weight:600;color:#fff;margin-bottom:4px">${v.word}</div>
            <div style="font-size:11.5px;color:var(--mid);line-height:1.5">${v.def}</div>
            ${v.example?`<div style="font-size:10.5px;color:rgba(79,142,247,.7);font-style:italic;margin-top:4px">"${v.example}"</div>`:''}
          </div>
          <button style="background:transparent;border:none;color:var(--dim);cursor:pointer;font-size:14px;flex-shrink:0">×</button>
        </div>`;
      card.querySelector('button').addEventListener('click',()=>{ vocab.splice(ri,1); saveVocab(); renderVocab(); });
      list.appendChild(card);
    });
  }

  el.querySelector('#vc-define').addEventListener('click', async()=>{
    const word=el.querySelector('#vc-word').value.trim(); if(!word) return;
    const btn=el.querySelector('#vc-define'); btn.disabled=true; btn.textContent='...';
    try{
      const raw=await callServer(`Define "${word}" for a student. Return ONLY JSON: {"word":"${word}","def":"clear concise definition","example":"example sentence using the word"}`);
      const s=raw.indexOf('{'),e=raw.lastIndexOf('}');
      const entry=JSON.parse(raw.slice(s,e+1));
      if(!vocab.find(v=>v.word.toLowerCase()===entry.word.toLowerCase())){
        vocab.push(entry); saveVocab(); renderVocab();
      }
      el.querySelector('#vc-word').value='';
    }catch{ addAutoLog('⚠️ Server offline'); }
    btn.disabled=false; btn.textContent='Define';
  });

  el.querySelector('#vc-word').addEventListener('keydown',e=>{ if(e.key==='Enter') el.querySelector('#vc-define').click(); });

  el.querySelector('#vc-from-page').addEventListener('click', async()=>{
    const btn=el.querySelector('#vc-from-page'); btn.disabled=true; btn.textContent='⏳ Extracting...';
    const ctx=await getPageContext();
    try{
      const raw=await callServer(`Extract 8 important vocabulary words from this content. Return ONLY JSON array:
[{"word":"...","def":"clear student-friendly definition","example":"example sentence"}]
Content: "${ctx.text.slice(0,2000)}"`);
      const s=raw.indexOf('['),e=raw.lastIndexOf(']');
      const words=JSON.parse(raw.slice(s,e+1));
      let added=0;
      words.forEach(w=>{ if(!vocab.find(v=>v.word.toLowerCase()===w.word.toLowerCase())){ vocab.push(w); added++; } });
      saveVocab(); renderVocab();
      addAutoLog(`📖 Added ${added} vocab words!`);
    }catch{ addAutoLog('⚠️ Server offline'); }
    btn.disabled=false; btn.textContent='📄 Extract Vocab from This Page';
  });

  renderVocab();
}

// ── ✍️ ESSAY HELPER ───────────────────────────────────────────
document.getElementById('btn-essay')?.addEventListener('click', ()=>{
  if(activeSheet==='essay'){closeSheet();return;}
  openSheet('essay','✍️ ESSAY HELPER', buildEssaySheet);
});

function buildEssaySheet(el){
  el.innerHTML=`
    <div class="src-toggle" style="margin-bottom:12px">
      <button class="src-btn on" id="es-outline-btn">Create Outline</button>
      <button class="src-btn"   id="es-improve-btn">Improve Writing</button>
    </div>
    <!-- Outline mode -->
    <div id="es-outline-mode">
      <input class="res-input" id="es-topic" placeholder="Essay topic or prompt..." style="margin-bottom:10px;width:100%"/>
      <div class="config-row" style="margin-bottom:10px">
        <span class="config-lbl">TYPE</span>
        <div class="pills">
          <button class="pill on" data-etype="argumentative">Argue</button>
          <button class="pill"    data-etype="analytical">Analyze</button>
          <button class="pill"    data-etype="expository">Explain</button>
          <button class="pill"    data-etype="compare">Compare</button>
        </div>
      </div>
      <button class="sh-gen-btn" id="es-gen">✍️ Generate Outline</button>
    </div>
    <!-- Improve mode -->
    <div id="es-improve-mode" style="display:none">
      <textarea class="sh-input" id="es-para" style="height:100px" placeholder="Paste your paragraph or sentences here..."></textarea>
      <div class="pills" style="margin-bottom:10px;gap:5px">
        <button class="pill on" data-focus="clarity">Clarity</button>
        <button class="pill"    data-focus="argument">Argument</button>
        <button class="pill"    data-focus="evidence">Evidence</button>
        <button class="pill"    data-focus="flow">Flow</button>
      </div>
      <button class="sh-gen-btn" id="es-improve-go">✨ Improve This</button>
    </div>
    <div id="es-output" style="margin-top:10px"></div>`;

  let essayType='argumentative', focusType='clarity';

  el.querySelector('#es-outline-btn').addEventListener('click',()=>{
    el.querySelector('#es-outline-btn').classList.add('on'); el.querySelector('#es-improve-btn').classList.remove('on');
    el.querySelector('#es-outline-mode').style.display=''; el.querySelector('#es-improve-mode').style.display='none';
    el.querySelector('#es-output').innerHTML='';
  });
  el.querySelector('#es-improve-btn').addEventListener('click',()=>{
    el.querySelector('#es-improve-btn').classList.add('on'); el.querySelector('#es-outline-btn').classList.remove('on');
    el.querySelector('#es-improve-mode').style.display=''; el.querySelector('#es-outline-mode').style.display='none';
    el.querySelector('#es-output').innerHTML='';
  });
  el.querySelectorAll('[data-etype]').forEach(p=>p.addEventListener('click',()=>{
    el.querySelectorAll('[data-etype]').forEach(x=>x.classList.remove('on')); p.classList.add('on'); essayType=p.dataset.etype;
  }));
  el.querySelectorAll('[data-focus]').forEach(p=>p.addEventListener('click',()=>{
    el.querySelectorAll('[data-focus]').forEach(x=>x.classList.remove('on')); p.classList.add('on'); focusType=p.dataset.focus;
  }));

  el.querySelector('#es-gen').addEventListener('click', async()=>{
    const topic=el.querySelector('#es-topic').value.trim(); if(!topic) return;
    const btn=el.querySelector('#es-gen'); btn.disabled=true; btn.textContent='✨ Generating...';
    const out=el.querySelector('#es-output');
    out.innerHTML=`<div style="font-size:10.5px;color:var(--mid);font-family:'DM Mono',monospace">Building outline...</div>`;
    try{
      const reply=await callServer(`Generate a detailed ${essayType} essay outline for this topic: "${topic}"

Format your response with these exact sections:
**THESIS:** One powerful thesis statement

**INTRODUCTION:**
- Hook strategy
- Background context
- Thesis placement

**BODY PARAGRAPH 1 — [main argument]:**
- Topic sentence
- Evidence type / example
- Analysis point

**BODY PARAGRAPH 2 — [main argument]:**
- Topic sentence
- Evidence type / example
- Analysis point

**BODY PARAGRAPH 3 — [main argument]:**
- Topic sentence
- Evidence type / example
- Analysis point

**CONCLUSION:**
- Restate thesis (differently)
- Synthesize main points
- Closing impact statement

Keep it concrete and specific to the topic. Add a **STRONG VERBS & TRANSITIONS** list at the end.`);
      out.innerHTML=`<div class="ai-bubble" style="max-width:100%;font-size:12px">${fmt(reply)}</div>`;
    }catch{ out.innerHTML=`<div style="font-size:11px;color:var(--red)">Server offline.</div>`; }
    btn.disabled=false; btn.textContent='✍️ Generate Outline';
  });

  el.querySelector('#es-improve-go').addEventListener('click', async()=>{
    const para=el.querySelector('#es-para').value.trim(); if(!para) return;
    const btn=el.querySelector('#es-improve-go'); btn.disabled=true; btn.textContent='Improving...';
    const out=el.querySelector('#es-output');
    out.innerHTML=`<div style="font-size:10.5px;color:var(--mid);font-family:'DM Mono',monospace">Analyzing...</div>`;
    try{
      const reply=await callServer(`You are an expert writing coach. Improve the following text focusing on: ${focusType}.

TEXT: "${para}"

Provide:
**IMPROVED VERSION:** (rewrite the text with improvements)
**WHAT CHANGED:** (3 bullet points explaining the specific improvements)
**QUICK TIP:** (one sentence of advice for this student's writing style)`);
      out.innerHTML=`<div class="ai-bubble" style="max-width:100%;font-size:12px">${fmt(reply)}</div>`;
    }catch{ out.innerHTML=`<div style="font-size:11px;color:var(--red)">Server offline.</div>`; }
    btn.disabled=false; btn.textContent='✨ Improve This';
  });
}

// ── 💡 FEYNMAN TECHNIQUE ──────────────────────────────────────
document.getElementById('btn-feynman')?.addEventListener('click', ()=>{
  if(activeSheet==='feynman'){closeSheet();return;}
  openSheet('feynman','💡 FEYNMAN TECHNIQUE', buildFeynmanSheet);
});

function buildFeynmanSheet(el){
  el.innerHTML=`
    <div style="font-size:10.5px;color:var(--mid);line-height:1.6;margin-bottom:14px">
      The <strong style="color:#fff">Feynman Technique</strong>: understand anything by explaining it simply.
      Pluto explains a concept → you explain it back → Pluto finds the gaps.
    </div>
    <div id="fey-step1">
      <input class="res-input" id="fey-concept" placeholder="Enter a concept to master..." style="margin-bottom:10px;width:100%"/>
      <button class="sh-gen-btn" id="fey-start">💡 Explain It To Me</button>
    </div>
    <div id="fey-step2" style="display:none">
      <div id="fey-explanation" class="ai-bubble" style="max-width:100%;font-size:12px;margin-bottom:14px"></div>
      <div style="font-size:9px;letter-spacing:1.5px;color:var(--mid);font-family:'DM Mono',monospace;margin-bottom:8px">YOUR TURN — Explain it like you're teaching a 12-year-old:</div>
      <textarea class="sh-input" id="fey-answer" style="height:90px" placeholder="Use your own words. Don't look at the explanation above..."></textarea>
      <button class="sh-gen-btn" id="fey-check">🔍 Check My Understanding</button>
    </div>
    <div id="fey-step3" style="display:none">
      <div id="fey-feedback" class="ai-bubble" style="max-width:100%;font-size:12px;margin-bottom:12px"></div>
      <div style="display:flex;gap:8px">
        <button class="sh-gen-btn" id="fey-retry" style="flex:1">🔄 Try Again</button>
        <button class="res-go" id="fey-new" style="flex:0 0 auto">New Concept</button>
      </div>
    </div>`;

  let concept='';

  el.querySelector('#fey-start').addEventListener('click', async()=>{
    concept=el.querySelector('#fey-concept').value.trim(); if(!concept) return;
    const btn=el.querySelector('#fey-start'); btn.disabled=true; btn.textContent='Thinking...';
    try{
      const reply=await callServer(`Explain "${concept}" as simply and clearly as possible, as if talking to a curious 12-year-old.
Use an analogy, a real-world example, and keep it to 3-4 short paragraphs.
No jargon. No formulas unless essential. Make it genuinely interesting.`);
      el.querySelector('#fey-explanation').innerHTML=fmt(reply);
      el.querySelector('#fey-step1').style.display='none';
      el.querySelector('#fey-step2').style.display='block';
    }catch{ btn.disabled=false; btn.textContent='💡 Explain It To Me'; }
  });

  el.querySelector('#fey-check').addEventListener('click', async()=>{
    const answer=el.querySelector('#fey-answer').value.trim(); if(!answer) return;
    const btn=el.querySelector('#fey-check'); btn.disabled=true; btn.textContent='Evaluating...';
    try{
      const reply=await callServer(`A student is trying to learn "${concept}" using the Feynman Technique.
They wrote this explanation: "${answer}"

Evaluate their understanding:
**SCORE:** X/10 — one sentence on their overall grasp

**✅ GOT IT RIGHT:** (bullet each concept they nailed)

**❌ GAPS / MISCONCEPTIONS:** (be specific — what's wrong or missing, and why it matters)

**💡 THE KEY INSIGHT THEY'RE MISSING:** (the single most important thing to re-study)

**NEXT STEP:** One concrete action to deepen their understanding.

Be honest but encouraging. If they scored 8+, tell them they've mastered it.`);
      el.querySelector('#fey-feedback').innerHTML=fmt(reply);
      el.querySelector('#fey-step2').style.display='none';
      el.querySelector('#fey-step3').style.display='block';
    }catch{ btn.disabled=false; btn.textContent='🔍 Check My Understanding'; }
  });

  el.querySelector('#fey-retry').addEventListener('click',()=>{
    el.querySelector('#fey-step3').style.display='none';
    el.querySelector('#fey-answer').value='';
    el.querySelector('#fey-step2').style.display='block';
  });

  el.querySelector('#fey-new').addEventListener('click',()=>{
    el.querySelector('#fey-step3').style.display='none';
    el.querySelector('#fey-step2').style.display='none';
    el.querySelector('#fey-concept').value='';
    el.querySelector('#fey-start').disabled=false;
    el.querySelector('#fey-start').textContent='💡 Explain It To Me';
    el.querySelector('#fey-step1').style.display='block';
  });
}

// ── SYNC COINS FROM GAME ──────────────────────────────────────
// Show game coins in the streak pill area
function syncGameCoins() {
  const coins = parseInt(localStorage.getItem('pq_coins') || '0');
  const xp    = parseInt(localStorage.getItem('pq_xp')    || '0');
  const av    = localStorage.getItem('pq_avatar') || '👨‍🚀';
  const AVATAR_EMOJIS = {astronaut:'👨‍🚀',wizard:'🧙',robot:'🤖',alien:'👽',ninja:'🥷',scientist:'👩‍🔬',dragon:'🐉',pluto:'🪐'};
  const streakPill = document.getElementById('streak-pill');
  if (streakPill && coins > 0) {
    streakPill.title = `${coins} coins · ${xp} XP · ${AVATAR_EMOJIS[av]||'👨‍🚀'} avatar`;
  }
}
syncGameCoins();

// Show research hub and game coin link in chat welcome
function addWelcomeLinks() {
  const coins = parseInt(localStorage.getItem('pq_coins') || '0');
  if (coins > 0) {
    const row = document.createElement('div');
    row.className = 'ai-row';
    const bub = document.createElement('div');
    bub.className = 'auto-bubble';
    bub.style.cursor = 'pointer';
    const av = localStorage.getItem('pq_avatar') || 'astronaut';
    const EMOJIS = {astronaut:'👨‍🚀',wizard:'🧙',robot:'🤖',alien:'👽',ninja:'🥷',scientist:'👩‍🔬',dragon:'🐉',pluto:'🪐'};
    bub.textContent = `${EMOJIS[av]||'👨‍🚀'} You have ${coins} coins · ${parseInt(localStorage.getItem('pq_xp')||'0')} XP — tap 🎮 to play`;
    bub.addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('game.html') }));
    row.appendChild(bub);
    chatBox.appendChild(bub.parentElement ? row : bub);
  }
}