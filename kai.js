import { initStarCanvas, askAI, storage, getUsername, toast, logActivity } from './pluto-shared.js';

// ── State ─────────────────────────────────────────────────
let sets        = [];
let activeSet   = null;
let queue       = [];          // shuffled cards for this session
let cardIdx     = 0;
let sessionCorrect = 0;
let sessionWrong   = 0;
let paused      = false;
let ended       = false;
let speaking    = false;
let recognition = null;
let synth       = window.speechSynthesis;
let voiceReady  = false;
let selectedVoice = null;
let chatMode    = false;       // true while in tutor back-and-forth
let chatHistory = [];          // running transcript for the AI in chat mode

const SESSION_SIZE = 10;

function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Speech support check ──────────────────────────────────
const hasSpeech = 'speechSynthesis' in window;
const hasRecog  = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;

// ── Boot ──────────────────────────────────────────────────
async function init() {
  initStarCanvas($('stars'));

  if (!hasSpeech || !hasRecog) {
    $('no-speech-banner').style.display = 'block';
  }

  const { plutoSets = [] } = await storage.get('plutoSets');
  sets = plutoSets;

  const params = new URLSearchParams(window.location.search);
  const setId  = params.get('set');

  if (setId) {
    const found = sets.find(s => s.id === setId);
    if (found) { startSession(found); return; }
    toast('Set not found.', 'error');
  }

  buildPicker();
}

// ── Picker ────────────────────────────────────────────────
function buildPicker() {
  const grid = $('picker-grid');
  grid.innerHTML = '';
  const eligible = sets.filter(s => s.cards && s.cards.length > 0);
  if (!eligible.length) {
    grid.innerHTML = '<div style="color:rgba(255,255,255,.3);font-size:13px">No sets yet — create some in Study Sets.</div>';
    return;
  }
  eligible.forEach((s, i) => {
    const card = document.createElement('div');
    card.className = 'picker-card';
    card.style.animationDelay = i * 50 + 'ms';
    card.innerHTML = '<div class="picker-card-title">' + esc(s.title) + '</div><div class="picker-card-meta">' + s.cards.length + ' cards</div>';
    card.addEventListener('click', () => startSession(s));
    grid.appendChild(card);
  });
}

// ── Session start ─────────────────────────────────────────
async function startSession(set) {
  activeSet      = set;
  cardIdx        = 0;
  sessionCorrect = 0;
  sessionWrong   = 0;
  paused         = false;
  ended          = false;

  // Shuffle and cap at SESSION_SIZE
  const shuffled = [...set.cards].sort(() => Math.random() - 0.5);
  queue = shuffled.slice(0, SESSION_SIZE);

  showView('view-session');
  $('session-set-name').textContent = set.title.toUpperCase();
  updateProgress();

  logActivity('🗣️', 'Voice session: ' + set.title);

  // Wire controls
  $('exit-btn').onclick   = endSession;
  $('pause-btn').onclick  = togglePause;
  $('skip-btn').onclick   = skipCard;
  $('mic-btn').addEventListener('mousedown', startListening);
  $('mic-btn').addEventListener('touchstart', startListening, { passive: true });
  $('mic-btn').addEventListener('mouseup',  stopListening);
  $('mic-btn').addEventListener('touchend', stopListening);

  // Greet then begin
  await loadVoice();
  await speak("Hey! Ready to study " + set.title + "? Let's go.", 'idle');
  await delay(400);
  askNextCard();
}

// ── Voice loader ──────────────────────────────────────────
function loadVoice() {
  return new Promise(resolve => {
    const pick = () => {
      const voices = synth.getVoices();
      selectedVoice =
        voices.find(v => /google us english/i.test(v.name)) ||
        voices.find(v => /google uk english female/i.test(v.name)) ||
        voices.find(v => /google uk english/i.test(v.name)) ||
        voices.find(v => /samantha|karen|moira|victoria/i.test(v.name) && v.lang.startsWith('en')) ||
        voices.find(v => /jenny|aria|zira/i.test(v.name) && v.lang.startsWith('en')) ||
        voices.find(v => v.lang === 'en-US') ||
        voices.find(v => v.lang.startsWith('en')) ||
        voices[0] ||
        null;
      voiceReady = true;
      resolve();
    };
    if (synth.getVoices().length) { pick(); return; }
    synth.addEventListener('voiceschanged', pick, { once: true });
    setTimeout(pick, 1000);
  });
}

// ── Strip markdown before speaking ───────────────────────
function stripMd(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')   // **bold**
    .replace(/\*(.+?)\*/g, '$1')        // *italic*
    .replace(/__(.+?)__/g, '$1')        // __bold__
    .replace(/_(.+?)_/g, '$1')          // _italic_
    .replace(/`(.+?)`/g, '$1')          // `code`
    .replace(/#{1,6}\s+/g, '')          // ## headings
    .replace(/\[(.+?)\]\(.+?\)/g, '$1') // [text](url)
    .replace(/^\s*[-*>]\s+/gm, '')      // bullets / blockquotes
    .trim();
}

// ── Text-to-speech ────────────────────────────────────────
function speak(text, orbState = 'speaking') {
  return new Promise(resolve => {
    if (!hasSpeech || ended) { resolve(); return; }
    synth.cancel();
    speaking = true;
    setOrbState(orbState === 'idle' ? 'idle' : 'speaking');
    setStatus(orbState === 'idle' ? 'Ready' : 'Speaking');

    const utt = new SpeechSynthesisUtterance(stripMd(text));
    if (selectedVoice) utt.voice = selectedVoice;
    utt.rate   = 0.88;
    utt.pitch  = 1.0;
    utt.volume = 1;

    utt.onend = () => { speaking = false; resolve(); };
    utt.onerror = () => { speaking = false; resolve(); };

    synth.speak(utt);
  });
}

// ── Cards ─────────────────────────────────────────────────
async function askNextCard() {
  if (ended || paused) return;
  if (cardIdx >= queue.length) { endSession(); return; }

  updateProgress();
  const card = queue[cardIdx];

  // Alternate question direction based on card index
  const termFirst = cardIdx % 2 === 0;
  let question, correct;

  if (termFirst) {
    question = 'What does "' + card.term + '" mean?';
    correct  = card.def;
    card._asking = 'def';
  } else {
    question = 'Give me the term for: ' + card.def;
    correct  = card.term;
    card._asking = 'term';
  }

  card._question = question;
  card._correct  = correct;

  $('question-text').textContent = question;
  addTranscript('pluto', question);

  await speak(question);
  if (ended || paused) return;

  // Auto-listen after speaking
  setOrbState('listening');
  setStatus('Listening…');
  autoListen(card);
}

// ── Auto-listen with SpeechRecognition ───────────────────
function autoListen(card) {
  if (!hasRecog || ended || paused) return;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.continuous = false;

  $('mic-btn').classList.add('listening');

  recognition.onresult = async (e) => {
    const spoken = e.results[0][0].transcript.trim();
    $('mic-btn').classList.remove('listening');
    await handleAnswer(spoken, card);
  };

  recognition.onerror = async (e) => {
    $('mic-btn').classList.remove('listening');
    if (e.error === 'no-speech') {
      addTranscript('pluto', "I didn't catch that — try again.");
      await speak("I didn't catch that. Try again.");
      if (!ended && !paused) autoListen(card);
    } else if (e.error === 'not-allowed') {
      toast('Microphone access denied.', 'error');
      setStatus('Mic blocked');
    }
  };

  recognition.onend = () => {
    $('mic-btn').classList.remove('listening');
  };

  try { recognition.start(); }
  catch { /* already started */ }
}

// ── Manual mic button ─────────────────────────────────────
function startListening() {
  if (recognition) { try { recognition.stop(); } catch {} }
  const card = queue[cardIdx];
  if (!card) return;
  setOrbState('listening');
  setStatus('Listening…');
  $('mic-btn').classList.add('listening');

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SpeechRecognition();
  rec.lang = 'en-US';
  rec.interimResults = false;
  rec.continuous = false;

  rec.onresult  = async (e) => { const spoken = e.results[0][0].transcript.trim(); $('mic-btn').classList.remove('listening'); if (chatMode) { await handleChatReply(spoken, card); } else { await handleAnswer(spoken, card); } };
  rec.onerror   = ()  => { $('mic-btn').classList.remove('listening'); setOrbState('idle'); };
  rec.onend     = ()  => { $('mic-btn').classList.remove('listening'); };

  try { rec.start(); recognition = rec; } catch {}
}

function stopListening() {
  if (recognition) { try { recognition.stop(); } catch {} }
}

// ── Conversational request detection ─────────────────────
function isTopicOverviewRequest(text) {
  const t = text.toLowerCase();
  return /\b(all (the |of the |)cards?|entire topic|all of (them|it)|everything|the whole (thing|topic|subject)|from the beginning|overview|summarize|summary|review (all|everything)|go over (all|everything|the whole|our topic|the topic)|all of the (cards?|topics?|content))\b/.test(t);
}

function isConversationalRequest(text) {
  const t = text.toLowerCase();
  const patterns = [
    /\bcan (you|i|we|go)\b/,
    /\bcould (you|i|we)\b/,
    /\bgo over\b/,
    /\bexplain\b/,
    /\bhelp (me|with|understand)\b/,
    /\bi don'?t (know|understand|get it?)\b/,
    /\btell me\b/,
    /\bgive me (a hint|an example|more)\b/,
    /\bi give up\b/,
    /\bi'?m (not sure|confused|lost)\b/,
    /\bi need help\b/,
    /\bno idea\b/,
    /\bdon'?t know\b/,
    /\bwhat('?s| was) the answer\b/,
    /\bwhat (is|are|does|was|were)\b/,
  ];
  return patterns.some(p => p.test(t));
}

function isReadyToContinue(text) {
  const t = text.toLowerCase().trim();
  return /^(ok|okay|got it|thanks|thank you|yeah|yes|sure|ready|next|yep|yup|cool|alright|makes sense|i get it|i understand)\.?$/.test(t) ||
    /\b(next card|move on|continue|let'?s go|let'?s continue|i'?m ready|ready to continue|next one|got it)\b/.test(t);
}

async function handleTopicOverview(spoken) {
  addTranscript('you', spoken);
  setOrbState('idle');
  setStatus('Thinking…');

  chatMode = true;
  chatHistory = [{ role: 'user', parts: [{ text: spoken }] }];

  const cardList = queue.map((c, i) => `${i + 1}. ${c.term}: ${c.def}`).join('\n');
  const prompt = `You're Pluto, a friendly voice study tutor. The student is studying these flashcards:\n${cardList}\n\nThe student asked: "${spoken}". Give a flowing, engaging narrative overview of the entire topic — like you're telling the story behind all these concepts. Weave them together naturally. Aim for 4-6 sentences. End by asking if they want to keep chatting or jump back into the cards.`;

  try {
    const res = await askAI({ message: prompt, history: [] });
    const reply = (res?.reply || (typeof res === 'string' ? res : '')).trim() ||
      'Here\'s the overview: ' + queue.slice(0, 5).map(c => c.term + ' — ' + c.def).join('. ') + '. Want to keep chatting or jump back in?';
    chatHistory.push({ role: 'model', parts: [{ text: reply }] });
    addTranscript('pluto', reply);
    await speak(reply);
  } catch {
    const fallback = 'Let me summarize the main points: ' + queue.slice(0, 3).map(c => c.term + ': ' + c.def).join('. ') + '. Want to continue?';
    addTranscript('pluto', fallback);
    await speak(fallback);
  }

  if (!ended && !paused) {
    await delay(500);
    chatListen(queue[cardIdx]);
  }
}

async function handleConversationalRequest(spoken, card) {
  addTranscript('you', spoken);
  setOrbState('idle');
  setStatus('Thinking…');

  chatMode = true;
  chatHistory = [{ role: 'user', parts: [{ text: spoken }] }];

  const contextPrefix = `You're Pluto, a friendly voice study tutor. We're in a flashcard session. Current card: "${card._question}" — correct answer: "${card._correct}". `;

  try {
    const prompt = contextPrefix + `The student said: "${spoken}". Explain the concept clearly and warmly in 2-3 sentences. End with something like "want to keep chatting or ready for the next one?"`;
    const res = await askAI({ message: prompt, history: [] });
    const reply = (res?.reply || (typeof res === 'string' ? res : '')).trim() || 'Sure! The answer is: ' + card._correct + '. Want to keep going or discuss more?';
    chatHistory.push({ role: 'model', parts: [{ text: reply }] });
    addTranscript('pluto', reply);
    await speak(reply);
  } catch {
    const fallback = 'The answer is: ' + card._correct + '. Want to keep chatting or move to the next one?';
    addTranscript('pluto', fallback);
    await speak(fallback);
  }

  if (!ended && !paused) {
    await delay(500);
    chatListen(card);
  }
}

// ── Chat mode loop ────────────────────────────────────────
function chatListen(card) {
  if (!hasRecog || ended || paused) return;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.continuous = false;
  $('mic-btn').classList.add('listening');
  setOrbState('listening');
  setStatus('Listening… (say "next" to continue)');

  recognition.onresult = async (e) => {
    const spoken = e.results[0][0].transcript.trim();
    $('mic-btn').classList.remove('listening');
    await handleChatReply(spoken, card);
  };
  recognition.onerror = async (e) => {
    $('mic-btn').classList.remove('listening');
    if (e.error === 'no-speech' && !ended && !paused) chatListen(card);
  };
  recognition.onend = () => { $('mic-btn').classList.remove('listening'); };
  try { recognition.start(); } catch {}
}

async function handleChatReply(spoken, card) {
  if (ended) return;
  if (recognition) { try { recognition.stop(); recognition = null; } catch {} }

  // Student is ready to move on
  if (isReadyToContinue(spoken)) {
    addTranscript('you', spoken);
    chatMode = false;
    chatHistory = [];
    const line = 'Got it! On to the next one.';
    addTranscript('pluto', line);
    await speak(line, 'idle');
    cardIdx++;
    await delay(300);
    if (!ended && !paused) askNextCard();
    return;
  }

  // Sounds like an actual answer attempt — evaluate it
  if (!isConversationalRequest(spoken)) {
    chatMode = false;
    chatHistory = [];
    await handleAnswer(spoken, card);
    return;
  }

  // Check for topic overview request in chat
  if (isTopicOverviewRequest(spoken)) {
    await handleTopicOverview(spoken);
    return;
  }

  // Continue the tutoring conversation
  addTranscript('you', spoken);
  setOrbState('idle');
  setStatus('Thinking…');
  chatHistory.push({ role: 'user', parts: [{ text: spoken }] });

  const contextPrefix = `You're Pluto, a friendly voice study tutor. Card: "${card._question}" — answer: "${card._correct}". `;
  const historyText = chatHistory.slice(-8).map(m => (m.role === 'user' ? 'Student' : 'Pluto') + ': ' + m.parts[0].text).join('\n');

  try {
    const prompt = contextPrefix + `Conversation:\n${historyText}\n\nStudent just said: "${spoken}". Continue naturally as a tutor. 2-3 sentences. Check in at the end about whether they want to keep chatting or try the next card.`;
    const res = await askAI({ message: prompt, history: [] });
    const reply = (res?.reply || (typeof res === 'string' ? res : '')).trim() || 'Good question! ' + card._correct + '. Want to keep going?';
    chatHistory.push({ role: 'model', parts: [{ text: reply }] });
    addTranscript('pluto', reply);
    await speak(reply);
  } catch {
    const fallback = 'Good question! ' + card._correct + '. Ready for the next one?';
    addTranscript('pluto', fallback);
    await speak(fallback);
  }

  if (!ended && !paused) {
    await delay(500);
    chatListen(card);
  }
}

// ── Answer handler ────────────────────────────────────────
async function handleAnswer(spoken, card) {
  if (ended) return;
  if (recognition) { try { recognition.stop(); recognition = null; } catch {} }

  if (isTopicOverviewRequest(spoken)) {
    await handleTopicOverview(spoken);
    return;
  }

  if (isConversationalRequest(spoken)) {
    await handleConversationalRequest(spoken, card);
    return;
  }

  addTranscript('you', spoken);
  setOrbState('idle');
  setStatus('Thinking…');

  // Ask AI to judge
  let isCorrect = false;
  let feedback  = '';

  try {
    const res = await askAI({
      message: 'A student was asked: "' + card._question + '". The correct answer is: "' + card._correct + '". The student said: "' + spoken + '". Was the student essentially correct? Reply ONLY with YES or NO followed by a comma and one short encouraging sentence of feedback (max 15 words).',
      history: []
    });
    const reply = (res && res.reply ? res.reply : typeof res === 'string' ? res : '').trim();
    isCorrect = reply.toUpperCase().startsWith('YES');
    // Extract feedback after YES/NO
    feedback = reply.replace(/^(YES|NO)[,.\s]*/i, '').trim() || (isCorrect ? 'Great job!' : 'Not quite — let\'s keep going.');
  } catch {
    // Fallback: simple text compare
    const norm = s => s.toLowerCase().replace(/[^a-z0-9\s]/g,'').trim();
    isCorrect = norm(spoken).includes(norm(card._correct).slice(0, 12));
    feedback  = isCorrect ? 'Sounds right!' : 'Not quite.';
  }

  // Update card mastery
  if (isCorrect) {
    sessionCorrect++;
    card.mastery    = Math.min(3, (card.mastery || 0) + 1);
    card.nextReview = Date.now() + Math.pow(2, card.mastery) * 60000;
  } else {
    sessionWrong++;
    card.mastery    = Math.max(0, (card.mastery || 0) - 1);
    card.nextReview = Date.now() + 30000;
  }
  await saveProgress();

  setOrbState(isCorrect ? 'correct' : 'wrong');
  const prefix = isCorrect ? 'Correct! ' : 'Not quite. ';
  const fullFeedback = prefix + feedback + (!isCorrect ? ' The answer was: ' + card._correct + '.' : '');
  addTranscript('pluto', fullFeedback);
  await speak(fullFeedback, isCorrect ? 'correct' : 'wrong');

  cardIdx++;
  await delay(500);

  if (!ended && !paused) askNextCard();
}

// ── Skip ──────────────────────────────────────────────────
async function skipCard() {
  if (recognition) { try { recognition.stop(); recognition = null; } catch {} }
  synth.cancel();
  chatMode = false;
  chatHistory = [];
  cardIdx++;
  sessionWrong++;
  if (cardIdx >= queue.length) { endSession(); return; }
  await delay(200);
  askNextCard();
}

// ── Pause / resume ────────────────────────────────────────
function togglePause() {
  if (paused) {
    paused = false;
    $('pause-btn').textContent = '⏸ Pause';
    synth.resume();
    if (chatMode && cardIdx < queue.length) {
      // Restore the chat context rather than restarting the card
      const card = queue[cardIdx];
      const prompt = 'We were just chatting — want to keep going or move to the next card?';
      addTranscript('pluto', prompt);
      speak(prompt, 'idle').then(async () => {
        if (!ended && !paused) { await delay(400); chatListen(card); }
      });
    } else {
      chatMode = false;
      chatHistory = [];
      askNextCard();
    }
  } else {
    paused = true;
    $('pause-btn').textContent = '▶ Resume';
    synth.cancel();
    if (recognition) { try { recognition.stop(); } catch {} }
    setOrbState('idle');
    setStatus('Paused');
    addTranscript('pluto', 'Session paused.');
  }
}

// ── End session ───────────────────────────────────────────
async function endSession() {
  ended = true;
  chatMode = false;
  chatHistory = [];
  synth.cancel();
  if (recognition) { try { recognition.stop(); } catch {} }

  const total = sessionCorrect + sessionWrong;
  const pct   = total > 0 ? Math.round((sessionCorrect / total) * 100) : 0;
  const setLabel = activeSet ? activeSet.title : 'this set';

  showView('view-summary');
  $('sum-correct').textContent = sessionCorrect;
  $('sum-wrong').textContent   = sessionWrong;
  $('sum-total').textContent   = total;
  $('summary-title').textContent = pct >= 80 ? 'Great session!' : pct >= 50 ? 'Good effort!' : 'Keep practicing!';
  $('summary-sub').textContent   = pct + '% accuracy on ' + setLabel;

  logActivity('🗣️', 'Voice session done: ' + setLabel + ' — ' + pct + '%');

  $('sum-done').onclick = () => { window.location.href = window.location.pathname; };
  $('sum-again').onclick = () => {
    ended = false;
    showView('view-picker');
    buildPicker();
  };
}

// ── Save mastery ──────────────────────────────────────────
async function saveProgress() {
  if (!activeSet) return;
  const { plutoSets = [] } = await storage.get('plutoSets');
  const idx = plutoSets.findIndex(s => s.id === activeSet.id);
  if (idx !== -1) {
    // Merge mastery updates back
    queue.forEach(qCard => {
      const target = plutoSets[idx].cards.find(c => c.id === qCard.id);
      if (target) { target.mastery = qCard.mastery; target.nextReview = qCard.nextReview; }
    });
    await storage.set({ plutoSets });
  }
}

// ── Transcript ────────────────────────────────────────────
function addTranscript(speaker, text) {
  const line = document.createElement('div');
  line.className = 'tx-line';
  const label = speaker === 'pluto' ? 'PLUTO' : 'YOU';
  line.innerHTML = '<span class="tx-speaker ' + speaker + '">' + label + '</span><span class="tx-text">' + esc(text) + '</span>';
  $('transcript').appendChild(line);
  const wrap = $('transcript-wrap');
  wrap.scrollTop = wrap.scrollHeight;
}

// ── UI helpers ────────────────────────────────────────────
function setOrbState(state) {
  const wrap = $('orb-wrap');
  wrap.className = '';
  if (state && state !== 'idle') wrap.classList.add(state);
}

function setStatus(text) {
  $('status-label').textContent = text;
}

function updateProgress() {
  $('session-progress').textContent = cardIdx + ' / ' + queue.length;
}

function showView(id) {
  ['view-picker','view-session','view-summary'].forEach(v => {
    const el = $(v);
    if (!el) return;
    el.style.display = (v === id) ? (v === 'view-session' ? 'flex' : (v === 'view-summary' ? 'flex' : 'block')) : 'none';
  });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

init();
