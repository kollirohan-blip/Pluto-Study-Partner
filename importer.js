import {
  initStarCanvas, askAI, storage, toast
} from './pluto-shared.js';

const SERVER = 'http://localhost:3000';
const $      = id => document.getElementById(id);

// ── State ──────────────────────────────────────────────────
let activeTab     = 'pdf';
let activeMode    = 'flashcards';
let pdfBase64     = null;
let ytTranscript  = null;
let audioBlob     = null;
let audioMimeType = 'audio/webm';
let mediaRecorder = null;
let recInterval   = null;
let recSeconds    = 0;
let generatedCards = [];
let generatedText  = '';
let sourceName     = '';
let cardCount      = 20;

// ── Tab switching ──────────────────────────────────────────
document.querySelectorAll('.src-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.src-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.src-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    activeTab = tab.dataset.tab;
    $(`panel-${activeTab}`).classList.add('active');
    checkReady();
  });
});

// ── Output mode ────────────────────────────────────────────
document.querySelectorAll('.out-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.out-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeMode = btn.dataset.mode;
    document.getElementById('card-count-row').style.display =
      activeMode === 'flashcards' ? 'flex' : 'none';
  });
});

// ── Card count picker ───────────────────────────────────────
document.querySelectorAll('.count-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.count-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    cardCount = Number(pill.dataset.count);
  });
});

// ── Generate button readiness ──────────────────────────────
function checkReady() {
  let ready = false;
  if (activeTab === 'pdf')   ready = !!pdfBase64;
  if (activeTab === 'yt')    ready = !!(ytTranscript || $('fallback-textarea').value.trim());
  if (activeTab === 'audio') ready = !!audioBlob;
  if (activeTab === 'text')  ready = !!$('text-input').value.trim();
  $('generate-btn').disabled = !ready;
}

// ── PDF ────────────────────────────────────────────────────
const drop      = $('pdf-drop');
const fileInput = $('pdf-file-input');

drop.addEventListener('click', () => fileInput.click());
drop.addEventListener('dragover',  e => { e.preventDefault(); drop.classList.add('drag-over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('drag-over'));
drop.addEventListener('drop', e => {
  e.preventDefault();
  drop.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f?.type === 'application/pdf') loadPDF(f);
  else toast('Please drop a PDF file', 'error');
});
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) loadPDF(fileInput.files[0]);
});

function loadPDF(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    pdfBase64 = ev.target.result.split(',')[1];
    sourceName = file.name.replace(/\.pdf$/i, '').replace(/_/g, ' ').trim();
    const fn = $('pdf-filename');
    fn.textContent  = `📄 ${file.name}  (${(file.size / 1024 / 1024).toFixed(1)} MB)`;
    fn.style.display = 'block';
    checkReady();
  };
  reader.readAsDataURL(file);
}

// ── YouTube — proxied through server (youtube-transcript-plus) ─────────────
$('yt-fetch-btn').addEventListener('click', fetchYouTube);
$('yt-url').addEventListener('keydown', e => { if (e.key === 'Enter') fetchYouTube(); });
$('fallback-textarea').addEventListener('input', checkReady);

function isYouTubeUrl(url) {
  return /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)/.test(url);
}

async function fetchYouTubeTranscript(url) {
  const r = await fetch(`${SERVER}/yt-transcript`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  });
  const data = await r.json();
  if (!data.success) {
    throw new Error(data.error + (data.fallback ? ' — ' + data.fallback : ''));
  }
  return { transcript: data.transcript, segmentCount: data.segmentCount };
}

async function fetchYouTube() {
  const url = $('yt-url').value.trim();
  if (!url) return;

  if (!isYouTubeUrl(url)) {
    $('yt-title').textContent        = '⚠ Please enter a YouTube URL';
    $('fallback-area').style.display = 'none';
    return;
  }

  const btn = $('yt-fetch-btn');
  btn.textContent = 'Fetching…';
  btn.disabled    = true;
  $('yt-title').textContent        = 'Fetching transcript from YouTube…';
  $('fallback-area').style.display = 'none';
  $('fallback-textarea').value     = '';
  ytTranscript = null;

  try {
    const alive = await pingServer();
    if (!alive) throw new Error('Server not running — start it on port 3000 first');

    const { transcript, segmentCount } = await fetchYouTubeTranscript(url);
    ytTranscript = transcript;

    const wordCount = transcript.split(/\s+/).length;
    $('yt-title').textContent        = `✓ Got it! ${wordCount.toLocaleString()} words extracted (${segmentCount} segments)`;
    $('fallback-area').style.display = 'block';
    $('fallback-textarea').value     = transcript;
    $('fallback-label').textContent  = 'TRANSCRIPT — REVIEW BEFORE GENERATING';
    $('fallback-label').style.color  = 'rgba(79,217,142,.7)';

    // Grab video title for auto-naming
    try {
      const oRes  = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
      const oData = await oRes.json().catch(() => null);
      sourceName  = oData?.title || 'YouTube Video';
    } catch { sourceName = 'YouTube Video'; }

  } catch (err) {
    $('yt-title').textContent        = `⚠ ${err.message.slice(0, 120)}`;
    $('fallback-area').style.display = 'block';
    $('fallback-label').textContent  = '⚠️ AUTO-FETCH FAILED — PASTE TRANSCRIPT MANUALLY';
    $('fallback-label').style.color  = 'rgba(232,184,75,.7)';
    $('fallback-textarea').focus();
    if (!sourceName) sourceName = 'YouTube Video';
  } finally {
    btn.textContent = 'Fetch →';
    btn.disabled    = false;
    checkReady();
  }
}

// ── Audio shared helpers ───────────────────────────────────
function stopAnyRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
}

function startTimer() {
  recSeconds = 0;
  $('rec-timer').textContent = '0:00';
  clearInterval(recInterval);
  recInterval = setInterval(() => {
    recSeconds++;
    const m = Math.floor(recSeconds / 60);
    const s = recSeconds % 60;
    $('rec-timer').textContent = `${m}:${String(s).padStart(2, '0')}`;
  }, 1000);
}

function finishAudio(chunks, mimeType, statusText) {
  clearInterval(recInterval);
  audioBlob  = new Blob(chunks, { type: mimeType });
  sourceName = statusText.includes('Tab') ? 'Tab Audio' : 'Mic Recording';
  $('audio-player').src = URL.createObjectURL(audioBlob);
  $('audio-preview').style.display = 'block';
  $('rec-status').textContent = statusText;
  checkReady();
}

// ── Mic recording ──────────────────────────────────────────
$('rec-btn').addEventListener('click', toggleRecording);

async function toggleRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') { stopAnyRecording(); return; }

  try {
    const stream   = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus' : 'audio/webm';
    audioMimeType = mimeType;

    const chunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType });
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      $('rec-btn').classList.remove('recording');
      $('rec-btn').textContent = '🎤';
      finishAudio(chunks, mimeType, 'Mic recording saved — ready to generate');
    };

    mediaRecorder.start();
    startTimer();
    $('rec-btn').classList.add('recording');
    $('rec-btn').textContent    = '⏹';
    $('rec-status').textContent = 'Recording mic… click to stop';
  } catch {
    toast('Microphone access denied', 'error');
  }
}

// ── Tab / screen audio capture ─────────────────────────────
$('tab-capture-btn').addEventListener('click', toggleTabCapture);

async function toggleTabCapture() {
  if (mediaRecorder && mediaRecorder.state === 'recording') { stopAnyRecording(); return; }

  try {
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: 1, height: 1, frameRate: 1 },
      audio: true
    });

    displayStream.getVideoTracks().forEach(t => t.stop());

    const audioTracks = displayStream.getAudioTracks();
    if (audioTracks.length === 0) {
      toast('No audio — check "Share audio" in the picker', 'error');
      return;
    }

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus' : 'audio/webm';
    audioMimeType = mimeType;

    const chunks      = [];
    const audioStream = new MediaStream(audioTracks);
    mediaRecorder = new MediaRecorder(audioStream, { mimeType });
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    mediaRecorder.onstop = () => {
      audioTracks.forEach(t => t.stop());
      $('tab-capture-btn').classList.remove('recording');
      $('tab-capture-btn').querySelector('span').textContent = '🖥';
      finishAudio(chunks, mimeType, 'Tab audio saved — ready to generate');
    };

    audioTracks[0].addEventListener('ended', () => {
      if (mediaRecorder.state === 'recording') mediaRecorder.stop();
    });

    mediaRecorder.start();
    startTimer();
    $('tab-capture-btn').classList.add('recording');
    $('tab-capture-btn').querySelector('span').textContent = '⏹';
    $('rec-status').textContent = 'Capturing tab audio… click ⏹ to stop';
  } catch (err) {
    if (err.name !== 'NotAllowedError') toast('Tab capture failed: ' + err.message, 'error');
  }
}

// ── Text input ─────────────────────────────────────────────
$('text-input').addEventListener('input', checkReady);

// ── Progress / error display ───────────────────────────────
function showProgress(label, pct) {
  const bar  = $('gen-progress-fill');
  bar.style.background = '#38bdf8';
  bar.style.width      = pct + '%';
  $('gen-progress').style.display     = 'block';
  $('gen-progress-label').style.color = 'rgba(255,255,255,.3)';
  $('gen-progress-label').textContent = label;
}

function showError(msg) {
  $('gen-progress').style.display         = 'block';
  $('gen-progress-fill').style.background = '#ff5f5f';
  $('gen-progress-fill').style.width      = '100%';
  $('gen-progress-label').style.color     = '#ff9090';
  $('gen-progress-label').textContent     = '⚠ ' + msg;
}

function hideProgress() {
  $('gen-progress').style.display    = 'none';
  $('gen-progress-fill').style.width = '0%';
}

// ── Server health check ────────────────────────────────────
async function pingServer() {
  try {
    const r = await fetch(`${SERVER}/brain-stats`,
      { signal: AbortSignal.timeout(4000) });
    return r.ok;
  } catch {
    return false;
  }
}

// ── Safe server fetch (returns parsed JSON or throws with a clear message) ──
async function serverFetch(path, body) {
  let res;
  try {
    res = await fetch(`${SERVER}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch {
    throw new Error('Server unreachable — make sure it is running on port 3000');
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Server error ${res.status}${t ? ': ' + t.slice(0, 80) : ''}`);
  }
  const data = await res.json().catch(() => null);
  if (!data) throw new Error('Server returned an invalid response');
  if (data.error) throw new Error(data.error);
  return data;
}

// ── Generate ───────────────────────────────────────────────
$('generate-btn').addEventListener('click', generate);

async function generate() {
  const btn = $('generate-btn');
  btn.disabled = true;
  $('result-area').style.display = 'none';
  hideProgress();

  try {
    // PDF — requires server
    if (activeTab === 'pdf') {
      showProgress('Checking server…', 10);
      const alive = await pingServer();
      if (!alive) { showError('Server not running — start it on port 3000 first'); return; }

      showProgress('Sending PDF to Pluto AI…', 35);
      const data = await serverFetch('/extract-pdf', { pdf: pdfBase64, mode: activeMode });
      showProgress('Done!', 100);
      await renderResult(data.result, data.mode);
      return;
    }

    // Audio — requires server for transcription
    if (activeTab === 'audio') {
      showProgress('Checking server…', 10);
      const alive = await pingServer();
      if (!alive) { showError('Server not running — start it on port 3000 first'); return; }

      showProgress('Transcribing audio…', 30);
      const b64  = await blobToBase64(audioBlob);
      const data = await serverFetch('/transcribe', { audio: b64, mimeType: audioMimeType });
      if (!data.transcript) throw new Error('Transcription returned empty — try again');

      showProgress('Generating with Pluto AI…', 65);
      const res = await askAI({ message: buildPrompt(activeMode, data.transcript), history: [] });
      const raw = res?.reply ?? (typeof res === 'string' ? res : '');
      showProgress('Done!', 100);
      await renderResult(raw, activeMode);
      return;
    }

    // YouTube / text — AI only, no server needed
    let content = '';
    if (activeTab === 'yt') {
      content = ytTranscript || $('fallback-textarea').value.trim();
      if (!sourceName) sourceName = 'YouTube Video';
    } else {
      content = $('text-input').value.trim();
      sourceName = content.split('\n')[0].trim().slice(0, 50) || 'Pasted Text';
    }
    if (!content) throw new Error('No content to process');

    showProgress('Generating with Pluto AI…', 50);
    const res = await askAI({ message: buildPrompt(activeMode, content), history: [] });
    const raw = res?.reply ?? (typeof res === 'string' ? res : '');
    showProgress('Done!', 100);
    await renderResult(raw, activeMode);

  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    checkReady();
  }
}

function buildPrompt(mode, content) {
  const MAX  = 12000;
  const text = content.length > MAX ? content.slice(0, MAX) + '\n[truncated]' : content;
  if (mode === 'flashcards') {
    return `Generate flashcards from the following study material. Return ONLY a valid JSON array:\n[{"term":"...","def":"..."}, ...]\nGenerate exactly ${cardCount} cards covering the most important concepts.\n\nMaterial:\n${text}`;
  }
  if (mode === 'notes') {
    return `Generate concise study notes from the following material. Use markdown with ## headings, bullet points, and **bold key terms**. Use plain text for all numbers and currency (never LaTeX like $\\$10$ — just write $10).\n\nMaterial:\n${text}`;
  }
  if (mode === 'questions') {
    return `Generate 15 practice Q&A pairs. Return ONLY a valid JSON array:\n[{"q":"...","a":"..."}, ...]\nWrite dollar amounts as plain text (e.g. $10,000 not $\\$10,000$).\n\nMaterial:\n${text}`;
  }
  return `Generate a comprehensive study guide with ## section headers, key concepts, definitions, and a summary. Use plain text for all numbers and currency (never LaTeX).\n\nMaterial:\n${text}`;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ── Result rendering — stores result and opens a new tab ───
async function renderResult(raw, mode) {
  generatedCards = [];
  generatedText  = '';

  if (mode === 'flashcards') {
    const cards = safeParseJSON(raw);
    if (!Array.isArray(cards) || cards.length === 0) {
      showError('Could not parse flashcards from AI response — try again');
      return;
    }
    generatedCards = cards
      .map(c => ({ term: c.term || '', def: c.def || c.definition || c.answer || '' }))
      .filter(c => c.term);

    const setName = sourceName || 'Imported Set';
    const setId   = Date.now().toString();
    const { plutoSets = [] } = await storage.get('plutoSets');
    plutoSets.unshift({
      id: setId, name: setName,
      cards: generatedCards.map(c => ({ ...c, mastery: 0, nextReview: 0 })),
      created: Date.now()
    });
    await storage.set({ plutoSets });
    await storage.set({ importerResult: { mode, cards: generatedCards, title: setName, setId } });

  } else if (mode === 'questions') {
    const pairs = safeParseJSON(raw);
    generatedText = Array.isArray(pairs) && pairs.length
      ? pairs.map((p, i) => `Q${i + 1}: ${p.q || p.question || ''}\nA: ${p.a || p.answer || ''}`).join('\n\n')
      : raw;
    await storage.set({ importerResult: { mode, content: generatedText, title: sourceName || 'Practice Questions' } });

  } else {
    generatedText = raw;
    const labels = { notes: 'Study Notes', guide: 'Study Guide' };
    await storage.set({ importerResult: { mode, content: raw, title: sourceName || labels[mode] || 'Generated Content' } });
  }

  chrome.tabs.create({ url: chrome.runtime.getURL('importer-result.html') });
  setTimeout(hideProgress, 300);
}

function renderCards() {
  const preview = $('cards-preview');
  preview.innerHTML = '';

  generatedCards.forEach((card, i) => {
    const el = document.createElement('div');
    el.className = 'preview-card';
    el.innerHTML = `
      <div class="preview-card-idx">${String(i + 1).padStart(2, '0')}</div>
      <div class="preview-card-body">
        <div class="preview-term">${esc(card.term)}</div>
        <div class="preview-def">${esc(card.def)}</div>
      </div>
      <button class="del-btn" title="Remove">✕</button>
    `;
    el.querySelector('.del-btn').addEventListener('click', () => {
      generatedCards.splice(i, 1);
      renderCards();
    });
    preview.appendChild(el);
  });

  preview.style.display = 'flex';
  $('text-output').classList.add('hidden');
  $('save-flashcard-options').style.display = 'block';
  $('copy-text-btn').classList.add('hidden');
  $('save-as-cards-btn').classList.add('hidden');
  $('result-label').textContent = `FLASHCARDS — ${generatedCards.length} CARDS`;
  populateSetSelect();
}

function renderText(mode) {
  $('text-output').textContent = generatedText;
  $('text-output').classList.remove('hidden');
  $('cards-preview').style.display           = 'none';
  $('save-flashcard-options').style.display  = 'none';
  $('copy-text-btn').classList.remove('hidden');
  $('save-as-cards-btn').classList.remove('hidden');
  const labels = { notes: 'STUDY NOTES', questions: 'PRACTICE QUESTIONS', guide: 'STUDY GUIDE' };
  $('result-label').textContent = labels[mode] || mode.toUpperCase();
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function safeParseJSON(text) {
  if (!text || typeof text !== 'string') return null;
  const s = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  for (const [open, close] of [['[', ']'], ['{', '}']]) {
    const start = s.indexOf(open);
    const end   = s.lastIndexOf(close);
    if (start !== -1 && end > start) {
      try { return JSON.parse(s.slice(start, end + 1)); } catch {}
    }
  }
  return null;
}

// ── Save as new set ────────────────────────────────────────
$('save-new-btn').addEventListener('click', () => {
  const row   = $('new-set-name-row');
  const shown = row.style.display === 'flex';
  row.style.display = shown ? 'none' : 'flex';
  if (!shown) $('new-set-name').focus();
});

$('confirm-save-btn').addEventListener('click', saveNewSet);
$('new-set-name').addEventListener('keydown', e => { if (e.key === 'Enter') saveNewSet(); });

async function saveNewSet() {
  const name = $('new-set-name').value.trim();
  if (!name) { toast('Enter a set name', 'error'); return; }
  if (!generatedCards.length) { toast('No cards to save', 'error'); return; }

  const { plutoSets = [] } = await storage.get('plutoSets');
  plutoSets.unshift({
    id:      Date.now().toString(),
    name,
    cards:   generatedCards.map(c => ({ ...c, mastery: 0, nextReview: 0 })),
    created: Date.now()
  });
  await storage.set({ plutoSets });
  toast(`"${name}" saved — ${generatedCards.length} cards!`, 'success');
  $('new-set-name-row').style.display = 'none';
  $('new-set-name').value = '';
}

// ── Add to existing set ────────────────────────────────────
async function populateSetSelect() {
  const { plutoSets = [] } = await storage.get('plutoSets');
  const sel = $('add-to-select');
  sel.innerHTML = '<option value="">Add to existing set…</option>';
  plutoSets.forEach(s => {
    const opt = document.createElement('option');
    opt.value       = s.id;
    opt.textContent = `${s.name} (${s.cards.length} cards)`;
    sel.appendChild(opt);
  });
}

$('add-to-btn').addEventListener('click', async () => {
  const id = $('add-to-select').value;
  if (!id) { toast('Select a set first', 'error'); return; }
  if (!generatedCards.length) { toast('No cards to add', 'error'); return; }

  const { plutoSets = [] } = await storage.get('plutoSets');
  const set = plutoSets.find(s => s.id === id);
  if (!set) { toast('Set not found', 'error'); return; }

  set.cards.push(...generatedCards.map(c => ({ ...c, mastery: 0, nextReview: 0 })));
  await storage.set({ plutoSets });
  toast(`Added ${generatedCards.length} cards to "${set.name}"`, 'success');
});

// ── Copy text ──────────────────────────────────────────────
$('copy-text-btn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(generatedText);
    toast('Copied!', 'success');
  } catch {
    toast('Copy failed', 'error');
  }
});

// ── Convert text → flashcards ──────────────────────────────
$('save-as-cards-btn').addEventListener('click', async () => {
  if (!generatedText) return;
  const btn = $('save-as-cards-btn');
  btn.disabled    = true;
  btn.textContent = 'Converting…';
  showProgress('Converting to flashcards…', 50);

  try {
    const prompt = `Convert this study content into flashcards. Return ONLY a valid JSON array:\n[{"term":"...","def":"..."}, ...]\nGenerate 15-25 cards.\n\n${generatedText.slice(0, 8000)}`;
    const res    = await askAI({ message: prompt, history: [] });
    const raw    = res?.reply ?? (typeof res === 'string' ? res : '');
    const cards  = safeParseJSON(raw);
    if (!Array.isArray(cards) || !cards.length) throw new Error('parse failed');

    generatedCards = cards
      .map(c => ({ term: c.term || '', def: c.def || c.definition || '' }))
      .filter(c => c.term);
    activeMode = 'flashcards';
    document.querySelectorAll('.out-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === 'flashcards');
    });
    renderCards();
    showProgress('Done!', 100);
    setTimeout(hideProgress, 500);
  } catch {
    showError('Conversion failed — try generating flashcards directly');
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Turn into flashcards instead';
  }
});

// ── Boot ───────────────────────────────────────────────────
initStarCanvas($('stars'));
checkReady();
