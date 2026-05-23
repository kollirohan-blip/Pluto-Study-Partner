// ================================================================
// PLUTO — Content Script v5
// Reliable automation: simple click logic + page-change detection
// No complex DOM introspection that breaks across sites
// ================================================================

console.log('[Pluto] Content script loaded in frame:', location.hostname, location.pathname.slice(0, 60));

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.type === 'PLUTO_PING')        { sendResponse({ alive: true }); return true; }
  if (req.type === 'GET_SMART_CONTEXT') { sendResponse(getContext()); return true; }
  if (req.type === 'PLUTO_AUTOMATE')    { runAutomation(req.site).then(r => sendResponse(r)); return true; }
  if (req.type === 'PLUTO_STOP')        { window._plutoRunning = false; sendResponse({ stopped: true }); return true; }
  if (req.type === 'PLUTO_INJECT_TEXT') { injectText(req.text); sendResponse({ done: true }); return true; }
  if (req.type === 'PLUTO_RESEARCH')    { runResearch(req.query, req.format).then(r => sendResponse(r)); return true; }
});

function getContext() {
  let text = document.body.innerText || '';
  
  // Try iframe content if main document is too short (Canvas uses iframes)
  if (text.length < 500) {
    for (const f of document.querySelectorAll('iframe')) {
      try {
        const ifText = f.contentDocument?.body?.innerText || '';
        if (ifText.length > text.length) text = ifText;
      } catch {} // Skip cross-origin iframes
    }
  }
  
  return {
    url: window.location.href, title: document.title,
    text: text.slice(0, 15000),
    highlightedText: window.getSelection()?.toString().trim() || ''
  };
}

// ── CORE ──────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jitter = () => sleep(300 + Math.random() * 200);
window._plutoRunning = false;

function report(msg, data = {}) {
  try { chrome.runtime.sendMessage({ type: 'PLUTO_PROGRESS', msg, ...data }); } catch {}
}

// ── AI PROXY HELPER ───────────────────────────────────────────
// Content scripts on HTTPS pages can't reach http://localhost directly (Chrome PNA).
// Route through the background service worker which is exempt from that restriction.
async function askAI(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'PLUTO_AI_REQUEST', payload }, response => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!response?.ok) return reject(new Error(response?.error || 'AI request failed'));
      resolve(response.data);
    });
  });
}

// ── AI CALLS ──────────────────────────────────────────────────
async function aiMCQ(question, choices) {
  if (!choices.length) return 0;
  try {
    const d = await askAI({
      message: `You are taking a quiz. Reply with ONLY the single digit index number of the correct answer (0, 1, 2, or 3). Nothing else — just the number.\nQuestion: "${question.slice(0,300)}"\nOptions:\n${choices.map((c,i)=>`${i}: ${c.slice(0,150)}`).join('\n')}`,
      profile: { name: 'AutoBot' },
      pageContext: { url: location.href, title: document.title, text: '' },
      history: [], tutorMode: false
    });
    const m = d.reply.trim().match(/\d/);
    const idx = m ? parseInt(m[0]) : 0;
    return (idx >= 0 && idx < choices.length) ? idx : 0;
  } catch (e) { console.log('[Pluto] aiMCQ error:', e); return 0; }
}

async function aiText(question) {
  try {
    const d = await askAI({
      message: `Answer with ONLY the answer word or short phrase. No punctuation at the end. Nothing else.\nQuestion: "${question.slice(0,300)}"`,
      profile: { name: 'AutoBot' },
      pageContext: { url: location.href, title: document.title, text: '' },
      history: [], tutorMode: false
    });
    return d.reply.trim().split('\n')[0].replace(/["""*]/g, '').trim();
  } catch { return ''; }
}

// ── TYPING — works on React/Canvas inputs ─────────────────────
async function typeInto(el, text) {
  if (!el) return;
  el.focus();
  await sleep(80);

  // Use React's internal setter if available
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

  // Set the full value at once (faster and more reliable than char-by-char for most sites)
  if (setter) {
    setter.call(el, text);
  } else {
    el.value = text;
  }
  // Fire all the events React/Angular/Vue listen to
  el.dispatchEvent(new Event('input',  { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(150);
}

// ── NAV HELPER ────────────────────────────────────────────────
const NAV_WORDS = ['next', 'continue', 'proceed', 'next word', 'next question', 'got it', 'ok', 'okay', "i'm done", 'submit answer', 'check answer'];

async function clickNav() {
  // Specific selectors first
  const specific = [
    'button[aria-label="Next"]', 'button[aria-label="Continue"]',
    '[data-action="next"]', '.next-btn', '.continue-btn',
    '[class*="nextButton"]', '[class*="NextButton"]',
    '[class*="continueButton"]', '[class*="ContinueButton"]'
  ];
  for (const s of specific) {
    const el = document.querySelector(s);
    if (el && !el.disabled && el.offsetParent !== null) {
      await jitter(); el.click();
      report(`→ ${el.textContent.trim().slice(0, 25)}`);
      await sleep(1000); return true;
    }
  }
  // Text scan
  for (const btn of document.querySelectorAll('button:not([disabled])')) {
    if (btn.offsetParent === null) continue;
    const t = btn.textContent.toLowerCase().trim();
    if (NAV_WORDS.some(w => t === w || t.startsWith(w))) {
      await jitter(); btn.click();
      report(`→ ${btn.textContent.trim().slice(0, 25)}`);
      await sleep(1000); return true;
    }
  }
  return false;
}

// Page fingerprint to detect question changes — checks iframes too
function fingerprint() {
  const docs = [document];
  for (const f of document.querySelectorAll('iframe')) {
    try { if (f.contentDocument) docs.push(f.contentDocument); } catch {}
  }
  let radios = 0, checked = 0, qText = '';
  for (const d of docs) {
    radios  += d.querySelectorAll('input[type="radio"]').length;
    checked += d.querySelectorAll('input:checked,[aria-checked="true"],.selected,.correct,.incorrect,.answered').length;
    if (!qText) qText = d.querySelector('[class*="question"],[class*="Question"],h1,h2,fieldset legend,form p')?.textContent?.trim().slice(0,120) || '';
  }
  return { url: location.href, radios, checked, qText };
}

function fpChanged(a, b) {
  return a.url !== b.url || a.qText !== b.qText || a.checked !== b.checked;
}

async function waitForNewQuestion(oldFp, maxMs = 5000) {
  const end = Date.now() + maxMs;
  while (Date.now() < end) {
    await sleep(300);
    if (fpChanged(oldFp, fingerprint())) return true;
  }
  return false;
}

// ── DISPATCH ──────────────────────────────────────────────────
window.runAutomation = async function runAutomation(siteHint) {
  window._plutoRunning = true;
  const host = location.hostname;
  const site = siteHint || (
    host.includes('membean')   ? 'membean'    :
    host.includes('canvas')    ? 'canvas'     :
    host.includes('quiz-lti')  ? 'newquizzes' :
    host.includes('instructure') ? 'newquizzes' :
    host.includes('quizlet')   ? 'quizlet'    :
    host.includes('blooket')   ? 'blooket'    :
    host.includes('kahoot')    ? 'kahoot'     :
    host.includes('duolingo')  ? 'duolingo'   : 'generic'
  );

  report(`Pluto scanning ${site}...`, { answered: 0, skipped: 0 });

  if (site === 'membean')     return runMembean();
  if (site === 'canvas')      return runCanvas();
  if (site === 'newquizzes')  return runVision('canvas');  // Use vision — Canvas iframe is unreachable
  if (site === 'quizlet')     return runQuizlet();
  if (site === 'blooket')     return runBlooket();
  if (site === 'kahoot')      return runKahoot();
  if (site === 'duolingo')    return runDuolingo();
  return runGeneric();
}


// ── CANVAS QUIZZES ────────────────────────────────────────────
// Canvas LMS has specific structure for quizzes; uses similar DOM strategy to generic
window.runCanvas = async function runCanvas() {
  let answered = 0, skipped = 0;
  const answeredGroups = new Set();
  console.log(`[Pluto Canvas] STARTED`);

  for (let loop = 0; loop < 80 && window._plutoRunning; loop++) {
    await sleep(600);
    let acted = false;

    // Canvas quiz detection: look for question containers
    const questionContainers = Array.from(
      document.querySelectorAll(
        '[class*="question"], [class*="Question"], ' +
        '[id*="question"], [data-testid*="question"], ' +
        '.quizQuestionContainer, .question-container'
      )
    ).filter(el => el.offsetParent);

    if (!questionContainers.length) {
      // Fallback: look in iframes (Canvas embeds quizzes in iframes)
      for (const f of document.querySelectorAll('iframe')) {
        try {
          const iDoc = f.contentDocument;
          if (!iDoc) continue;
          const iRadios = iDoc.querySelectorAll('input[type="radio"]:not([disabled])').length;
          const iSelects = iDoc.querySelectorAll('select:not([disabled])').length;
          const iTexts = iDoc.querySelectorAll('input[type="text"],textarea').length;
          if (iRadios > 0 || iSelects > 0 || iTexts > 0) {
            // Process this iframe
            if (await _processCanvasIframe(f, answeredGroups)) {
              answered++;
              acted = true;
              report(`✓ Q${answered} (in iframe)`, { answered, skipped });
              await sleep(400);
            }
          }
        } catch {}
      }
      if (!acted) await sleep(500);
      continue;
    }

    // ── Radio buttons (Canvas MCQs) ──
    const allRadios = document.querySelectorAll('input[type="radio"]:not([disabled])');
    const groups = {};
    for (const r of allRadios) {
      if (!r.offsetParent) continue;
      const gid = r.name || r.closest('[class*="question"],[id*="question"]')?.id || 'noname';
      if (!groups[gid]) groups[gid] = [];
      groups[gid].push(r);
    }

    for (const [gid, radios] of Object.entries(groups)) {
      if (answeredGroups.has(gid)) continue;
      if (radios.length < 2) continue;
      if (radios.some(r => r.checked)) continue; // Already answered

      const container = radios[0].closest('[class*="question"],[id*="question"],fieldset');
      const qText = container
        ? (container.querySelector('label,p,legend,[class*="text"]')?.textContent?.trim() || '')
        : 'Answer this question';

      const labels = radios.map(r => {
        const lbl = document.querySelector(`label[for="${r.id}"]`) || r.closest('label') || r.parentElement;
        return lbl?.textContent?.trim() || r.value || '';
      }).filter(Boolean);

      if (!labels.length) continue;

      const best = await aiMCQ(qText, labels);
      await jitter();
      radios[best]?.click();
      const bestLbl = document.querySelector(`label[for="${radios[best]?.id}"]`);
      if (bestLbl) { await sleep(80); bestLbl.click(); }
      answeredGroups.add(gid);
      answered++;
      acted = true;
      report(`✓ Q${answered}: ${qText.slice(0, 40)}`, { answered, skipped });
      await sleep(300);
    }

    // ── Dropdowns ──
    for (const sel of document.querySelectorAll('select:not([disabled])')) {
      if (!sel.offsetParent) continue;
      const sid = 'sel_' + (sel.name || sel.id || Math.random());
      if (answeredGroups.has(sid)) continue;
      if (sel.selectedIndex > 0) { answeredGroups.add(sid); continue; }
      const opts = Array.from(sel.options).slice(1);
      if (!opts.length) continue;
      const qText = sel.closest('[class*="question"]')?.querySelector('p,span,label')?.textContent?.trim() || 'Select';
      const best = await aiMCQ(qText, opts.map(o => o.text));
      await jitter();
      sel.value = opts[best]?.value || opts[0].value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      answeredGroups.add(sid);
      answered++;
      acted = true;
      report(`✓ Dropdown Q${answered}`, { answered, skipped });
      await sleep(300);
    }

    // ── Text inputs ──
    for (const inp of document.querySelectorAll('input[type="text"]:not([disabled]),textarea:not([disabled])')) {
      if (!inp.offsetParent || inp.value?.trim()) continue;
      const tid = inp.name || inp.id || 'txt_' + Math.random();
      if (answeredGroups.has(tid)) continue;
      const qText = inp.closest('[class*="question"]')?.querySelector('label,p,[class*="text"]')?.textContent?.trim() || 'Answer this';
      const ans = await aiText(qText);
      if (ans) {
        await typeInto(inp, ans);
        answeredGroups.add(tid);
        answered++;
        acted = true;
        report(`✓ Text Q${answered}: ${ans.slice(0, 25)}`, { answered, skipped });
        await sleep(400);
      }
    }

    // ── Navigation ──
    if (!acted) {
      const navBtn = document.querySelector('button[type="submit"]:not([disabled]), button:not([disabled]):contains("Next"), button:not([disabled]):contains("Submit")');
      for (const btn of document.querySelectorAll('button:not([disabled])')) {
        const t = btn.textContent.toLowerCase().trim();
        if (['next', 'continue', 'submit', 'check', 'next question'].some(w => t.includes(w))) {
          await jitter();
          btn.click();
          report(`→ ${btn.textContent.trim().slice(0, 20)}`, { answered, skipped });
          await sleep(800);
          acted = true;
          break;
        }
      }
    }

    if (!acted) await sleep(500);
  }

  report(`✓ Canvas complete!`, { answered, skipped });
  return { success: true, answered, skipped, site: 'canvas' };
};

// Helper for Canvas iframes
async function _processCanvasIframe(frame, answeredSet) {
  try {
    const iDoc = frame.contentDocument;
    if (!iDoc) return false;

    const radios = iDoc.querySelectorAll('input[type="radio"]:not([disabled])');
    if (radios.length < 2) return false;

    let allAnswered = true;
    for (const r of radios) {
      if (!r.checked) { allAnswered = false; break; }
    }
    if (allAnswered) return false;

    const labels = Array.from(radios).map(r => {
      const lbl = iDoc.querySelector(`label[for="${r.id}"]`) || r.closest('label') || r.parentElement;
      return lbl?.textContent?.trim() || r.value || '';
    }).filter(Boolean);

    if (labels.length < 2) return false;

    const qText = iDoc.querySelector('[class*="question"],[id*="question"] label, .question-title, [class*="text"]')?.textContent?.trim() || 'Answer this';
    const best = await aiMCQ(qText, labels);
    await jitter();
    radios[best]?.click();
    const lbl = iDoc.querySelector(`label[for="${radios[best]?.id}"]`);
    if (lbl) { await sleep(80); lbl.click(); }
    return true;
  } catch (e) {
    console.log('[Pluto Canvas iframe error]', e);
    return false;
  }
}

// ── MEMBEAN ───────────────────────────────────────────────────
// Updated: Better iframe handling, current selectors, question extraction, stuck detection, no timer blocks

function _mbDoc() {
  // Check iframes first (Membean often loads content there)
  for (const f of document.querySelectorAll('iframe')) {
    try {
      const d = f.contentDocument;
      if (d && d.body) {
        console.log('[Pluto] Using iframe doc');
        return d;
      }
    } catch {} // Skip cross-origin
  }
  console.log('[Pluto] Using main doc');
  return document;
}

function _mbQuestionElement(doc) {
  const SELS = ['[data-testid*="question"]', '[class*="question-text"]', '.prompt', '.quiz-question', '.question-title', '.question', '.question-prompt', '.questionPrompt', '.quiz-prompt', '.quiz-title'];
  const SKIP_Q = /click for an interactive map|interactive map|how to learn|showimage|definition|make my own|dictionary/i;
  for (const sel of SELS) {
    const el = doc.querySelector(sel);
    if (!el?.offsetParent) continue;
    const text = el.textContent?.trim() || '';
    if (!text || text.length < 12) continue;
    if (SKIP_Q.test(text)) continue;
    return el;
  }

  const textNodes = Array.from(doc.querySelectorAll('div, p, span, label, h1, h2, h3, h4')).filter(el => el.offsetParent);
  for (const el of textNodes) {
    const text = el.textContent?.trim() || '';
    if (!text) continue;
    if (/^Quiz[:]?\s*/i.test(text) || /\bQuiz\b/i.test(text) && text.includes('?')) {
      if (/click for an interactive map|interactive map|How To Learn|showimage/i.test(text)) continue;
      return el;
    }
  }

  for (const el of textNodes) {
    const text = el.textContent?.trim() || '';
    if (!text || text.length < 12) continue;
    if (SKIP_Q.test(text)) continue;
    if (/\b(when|what|which|choose|meaning|definition|does it mean|why|how)\b/i.test(text) && text.includes('?')) return el;
  }

  return null;
}

function _mbAnswerContainer(doc) {
  const answerSelectors = ['[data-testid*="choice"]', '[data-testid*="answer"]', '[class*="choice-option"]', '[class*="answer-choice"]', '[class*="option"]', '.choices li', '.options li', '.answer-list li', 'input[type="radio"] + label', '[role="radio"]', 'button[class*="choice"]', 'button[class*="answer"]', 'button[class*="option"]'];

  const questionEl = _mbQuestionElement(doc);
  const isValidContainer = el => el && el.offsetParent && !_isInNonQuizPanel(el) && answerSelectors.some(sel => el.querySelector(sel));

  if (questionEl) {
    let container = questionEl.closest('section, article, div, main');
    while (container && container !== doc.body) {
      if (isValidContainer(container)) return container;
      container = container.parentElement;
    }

    const parent = questionEl.parentElement;
    if (parent && isValidContainer(parent)) return parent;
    const sibling = parent?.nextElementSibling;
    if (sibling && isValidContainer(sibling)) return sibling;
  }

  const containers = Array.from(doc.querySelectorAll('section, article, div, main')).filter(el => el.offsetParent && !_isInNonQuizPanel(el));
  let best = doc;
  let bestCount = 0;
  for (const c of containers) {
    const count = answerSelectors.reduce((sum, sel) => sum + c.querySelectorAll(sel).length, 0);
    if (count > bestCount) {
      bestCount = count;
      best = c;
    }
  }
  return bestCount >= 2 ? best : doc;
}

function _mbChoices(doc) {
  const SKIP = ['next', 'continue', 'submit', 'check', 'done', 'got it', 'i know', 'skip', 'back', 'previous', 'ok', 'okay', 'definition', 'make my own', 'how to learn', 'dictionary', 'showimage'];
  const root = _mbAnswerContainer(doc);
  const skipHyphenWord = text => /^[A-Za-z]{1,6}-[A-Za-z]{0,6}$/.test(text) || /^[A-Za-z]{1,6}-$/.test(text) || /^-[A-Za-z]{1,6}$/.test(text);
  const isMembeanChoice = text => /^[abcd]\.|^[abcd]\)|^\d+\./.test(text.trim()) && text.trim().length < 80;

  const membeanItems = Array.from(root.querySelectorAll('button, label, div, span')).filter(el => {
    if (!el.offsetParent || el.disabled) return false;
    if (_isInNonQuizPanel(el)) return false;
    if (el.matches('.correct, .incorrect, .selected, .answered, [aria-checked="true"], [aria-pressed="true"], [aria-selected="true"]')) return false;
    const text = (el.textContent || el.getAttribute('aria-label') || '').trim();
    if (!text || SKIP.some(s => text.toLowerCase().includes(s))) return false;
    if (skipHyphenWord(text)) return false;
    return isMembeanChoice(text);
  });
  if (membeanItems.length >= 2) {
    console.log('[Pluto] Membean choice buttons:', membeanItems.map(i => (i.textContent || i.getAttribute('aria-label') || '').trim().slice(0, 20)), 'root=', root.tagName || root.nodeName);
    return membeanItems;
  }

  const STRATEGIES = [
    '[data-testid*="choice"], [data-testid*="answer"], [class*="choice-option"], [class*="answer-choice"], [class*="option"]',
    '.choices li, .options li, .answer-list li, [class*="choice"] li, [class*="option"] li',
    'input[type="radio"] + label, [role="radio"], [role="option"], [role="button"]',
    'button[class*="choice"], button[class*="answer"], button[class*="option"], div[role="button"], span[role="button"], .choice, .option',
    'button:not([disabled])',
    'input[type="button"]',
  ];
  for (const sel of STRATEGIES) {
    const items = Array.from(root.querySelectorAll(sel)).filter(el => {
      if (!el.offsetParent || el.disabled) return false;
      if (_isInNonQuizPanel(el)) return false;
      if (el.matches('.correct, .incorrect, .selected, .answered, [aria-checked="true"], [aria-pressed="true"], [aria-selected="true"]')) return false;
      const text = (el.textContent || el.getAttribute('aria-label') || '').trim();
      if (!text || text.length > 500 || SKIP.some(s => text.toLowerCase().includes(s))) return false;
      if (skipHyphenWord(text)) return false;
      return true;
    });
    if (items.length >= 2) {
      console.log('[Pluto] Choices via:', sel, items.map(i => (i.textContent || i.getAttribute('aria-label') || '').trim().slice(0, 20)), 'root=', root.tagName || root.nodeName);
      return items;
    }
  }
  return [];
}

function _isInNonQuizPanel(el) {
  if (!el) return false;
  const panel = el.closest('.word-ingredients, .word-theater, .memory-hook, .examples, .word-constellation, .word-ingredient, .word-theater-panel, .word-ingredients-panel');
  if (panel) return true;
  const title = el.closest('section, article, div, aside');
  if (title) {
    const heading = title.querySelector('h1, h2, h3, h4, .title, .heading, .panel-title');
    if (heading) {
      const t = heading.textContent?.trim().toLowerCase() || '';
      return /word ingredients|word theater|memory hook|examples|word constellation|word ingredients/i.test(t);
    }
  }
  return false;
}

function _mbIsAnsweredState(root) {
  if (!root) return false;
  const markers = root.querySelectorAll('.correct, .incorrect, .selected, .answered, [aria-checked="true"], [aria-pressed="true"], [aria-selected="true"]');
  return markers.length > 0;
}

async function _mbSpellFill(doc) {
  const pageText = (doc.body?.innerText || '')
    .replace(/\r\n|\r/g, '\n')
    .trim();
  if (!/\b(spell|type)\b.*\b(word)\b/i.test(pageText)) return false;

  const matches = Array.from(pageText.matchAll(/_+/g));
  if (!matches.length) return false;

  const fills = [];
  let lastIndex = 0;
  for (const match of matches) {
    const start = match.index ?? 0;
    fills.push(pageText.slice(lastIndex, start));
    fills.push('a'.repeat(match[0].length));
    lastIndex = start + match[0].length;
  }
  fills.push(pageText.slice(lastIndex));
  const fillString = fills.join('');

  const inputs = Array.from(doc.querySelectorAll('input[type="text"], input[type="search"], textarea, [contenteditable="true"]'))
    .filter(i => {
      if (i.disabled || i.readOnly) return false;
      if (i.tagName === 'INPUT' && i.type === 'hidden') return false;
      return i.offsetParent !== null;
    });
  if (!inputs.length) return false;

  if (inputs.length === 1) {
    const fillString = matches.map(m => 'a'.repeat(m[0].length)).join(' ');
    const inp = inputs[0];
    if (inp.tagName === 'DIV' || inp.tagName === 'SPAN') {
      inp.focus();
      inp.textContent = fillString;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      await typeInto(inp, fillString);
    }
    return true;
  }

  for (let i = 0; i < inputs.length; i++) {
    const inp = inputs[i];
    const current = (inp.value || inp.textContent || '').trim();
    if (current) continue;

    const fill = i < matches.length ? 'a'.repeat(matches[i][0].length) : 'a'.repeat(1);
    if (inp.tagName === 'DIV' || inp.tagName === 'SPAN') {
      inp.focus();
      inp.textContent = fill;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      await typeInto(inp, fill);
    }
  }
  return true;
}

function _mbQuestion(doc) {
  const root = _mbAnswerContainer(doc);
  const SELS = ['.question-prompt', '.question-text', '[data-testid*="question"]', '.prompt', '.question-title', '.question', '.quiz-question', '.question-body'];
  const scoreText = text => {
    if (!text) return 0;
    if (/\b(quiz|what does|choose|which|select|meaning|definition|question)\b/i.test(text)) return 10;
    if (text.includes('?')) return 8;
    if (/^quiz[:]/i.test(text)) return 9;
    if (text.length > 50) return 5;
    return 1;
  };
  let best = '';
  let bestScore = 0;
  for (const sel of SELS) {
    for (const el of Array.from(root.querySelectorAll(sel))) {
      if (!el?.offsetParent) continue;
      const text = el.textContent?.trim() || '';
      const score = scoreText(text);
      if (score > bestScore) { bestScore = score; best = text; }
    }
  }
  if (bestScore > 0) return best;
  if (root !== doc) {
    for (const sel of SELS) {
      for (const el of Array.from(doc.querySelectorAll(sel))) {
        if (!el?.offsetParent) continue;
        const text = el.textContent?.trim() || '';
        const score = scoreText(text);
        if (score > bestScore) { bestScore = score; best = text; }
      }
    }
  }
  return bestScore > 0 ? best : 'Vocabulary question';
}

function _mbBtn(doc, texts) {
  const classSelectors = [
    'button[class*="next"]', 'button[class*="Next"]', 'button[class*="continue"]', 'button[class*="Continue"]',
    'a[class*="next"]', 'a[class*="continue"]', '[class*="next-button"]', '[class*="continue-button"]',
    '[class*="btn-next"]', '[class*="continueBtn"]', '[class*="NextButton"]', '[class*="nextBtn"]'
  ];
  for (const sel of classSelectors) {
    const el = doc.querySelector(sel);
    if (el?.offsetParent) return el;
  }

  const selector = 'button:not([disabled]), input[type="button"]:not([disabled]), input[type="submit"]:not([disabled]), a:not([disabled]), [role="button"]:not([disabled])';
  const candidates = [];
  for (const el of doc.querySelectorAll(selector)) {
    if (!el.offsetParent) continue;
    const t = (el.textContent || el.value || el.getAttribute('aria-label') || '').toLowerCase().trim();
    if (!t) continue;
    if (!texts.some(w => t.includes(w))) continue;
    let score = 0;
    if (/\b(next|continue)\b/.test(t)) score += 10;
    if (/\b(got it|ok|okay|submit|check answer|check)\b/.test(t)) score += 5;
    if (/\b(done|i\'m done|finished|complete|exit|leave)\b/.test(t)) score -= 5;
    if (/\b(cancel|close|back)\b/.test(t)) score -= 10;
    candidates.push({ el, score, text: t });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].el;
}

window.runMembean = async function runMembean() {
  console.log('[Pluto] Starting Membean automation');
  let answered = 0, skipped = 0, stuck = 0;
  report('⚡ Membean: scanning…', { answered, skipped });

  for (let i = 0; i < 150 && window._plutoRunning; i++) {
    await sleep(800 + Math.random() * 400);
    const doc = _mbDoc();

    // Diagnostic log every 5 rounds
    if (i % 5 === 0) {
      const btns = Array.from(doc.querySelectorAll('button:not([disabled]), [role="button"]:not([disabled]), a:not([disabled]), [class*="button"]:not([disabled])')).filter(b => b.offsetParent).map(b => (b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 15));
      const inputs = doc.querySelectorAll('input:not([disabled]), textarea:not([disabled])').length;
      console.log(`[Pluto Membean #${i}] doc=${doc === document ? 'main' : 'iframe'} btns=[${btns.join('|')}] inputs=${inputs} answered=${answered}`);
    }

    // Check for session end
    if (doc.querySelector('[class*="complete"], [class*="finished"], [data-testid*="complete"]')) {
      report('✓ Session complete!', { answered, skipped });
      break;
    }

    let acted = false;

    // Strategy A: MCQ choices
    const choices = _mbChoices(doc);
    const answerRoot = _mbAnswerContainer(doc);
    const alreadyAnswered = _mbIsAnsweredState(answerRoot);
    if (choices.length >= 2 && !alreadyAnswered) {
      const q = _mbQuestion(doc);
      const labels = choices.map(c => c.textContent?.trim() || '');
      const best = await aiMCQ(q, labels);
      console.log(`[Pluto] Question: "${q}", Choices: [${labels.join(', ')}], Best: ${best} (${labels[best]})`);
      await jitter();
      choices[best]?.click();
      answered++;
      report(`✓ Q${answered}: "${labels[best]?.slice(0, 30)}"`, { answered, skipped });
      await sleep(1000 + Math.random() * 500);
      acted = true;
      stuck = 0;
    } else if (choices.length >= 2 && alreadyAnswered) {
      console.log('[Pluto] Skipping MCQ branch: answer already selected/review state');
    }

    // Strategy B: Text input or spelling prompt
    if (!acted) {
      const spellFilled = await _mbSpellFill(doc);
      if (spellFilled) {
        answered++;
        report(`✓ Spelling placeholder filled`, { answered, skipped });
        await sleep(1000 + Math.random() * 500);
        acted = true;
        stuck = 0;
      }
    }

    if (!acted) {
      const inp = doc.querySelector('input[type="text"]:not([disabled]):not([readonly]), textarea:not([disabled]):not([readonly])');
      if (inp?.offsetParent && !inp.value.trim()) {
        const q = _mbQuestion(doc);
        const ans = await aiText(q);
        if (ans) {
          await typeInto(inp, ans);
          answered++;
          report(`✓ Text Q${answered}: "${ans.slice(0, 25)}"`, { answered, skipped });
          await sleep(1000 + Math.random() * 500);
          acted = true;
          stuck = 0;
        }
      }
    }

    // Strategy C: Nav buttons (e.g., "Got It", "Next")
    if (!acted) {
      const nav = _mbBtn(doc, ['got it', 'i know', 'next', 'continue', 'ok', 'submit', 'done', 'finish']);
      if (nav) {
        await jitter();
        nav.click();
        report(`→ "${nav.textContent?.trim().slice(0, 22)}"`, { answered, skipped });
        await sleep(1000 + Math.random() * 500);
        acted = true;
        stuck = 0;
      } else {
        console.log('[Pluto] No nav button found on review page, retrying...');
      }
    }

    // Stuck detection
    if (!acted) {
      stuck++;
      if (stuck === 5) report('⚠️ Nothing detected — check Membean page', { answered, skipped });
      if (stuck >= 10) {
        report('⚠️ Stuck: no actions. Refresh and retry.', { answered, skipped });
        break;
      }
    } else {
      // Wait for page change
      const oldFp = fingerprint();
      await sleep(500);
      for (let w = 0; w < 10; w++) {
        await sleep(300);
        if (fpChanged(oldFp, fingerprint())) break;
      }
    }
  }

  return { success: true, answered, skipped, site: 'membean' };
};

// ── GENERIC (Canvas, Google Forms, any quiz) ──────────────────
// Simple approach: find unanswered groups, answer them, then navigate
window.runGeneric = async function runGeneric() {
  let answered = 0, skipped = 0;
  let emptyLoops = 0;  // count consecutive loops with nothing to do
  const answeredGroups = new Set();
  console.log(`[Pluto generic] STARTED in frame: ${location.hostname}${location.pathname.slice(0,40)} (top=${window.top===window})`);

  for (let loop = 0; loop < 50 && window._plutoRunning; loop++) {
    await sleep(500);
    let acted = false;

    // ── Radio buttons ──
    // Group by name so we answer each question exactly once
    const allRadiosOnPage = document.querySelectorAll('input[type="radio"]');
    const allSelectsOnPage = document.querySelectorAll('select');
    const allTextOnPage = document.querySelectorAll('input[type="text"],textarea');
    console.log(`[Pluto loop ${loop}] radios=${allRadiosOnPage.length} selects=${allSelectsOnPage.length} texts=${allTextOnPage.length} answeredGroups=${answeredGroups.size}`);

    const groups = {};
    for (const r of document.querySelectorAll('input[type="radio"]:not([disabled])')) {
      if (!r.offsetParent) continue;
      // Use name, or fall back to parent question container id
      const gid = r.name ||
        r.closest('[class*="question-body"],[class*="questionBody"],[class*="question_body"],fieldset,form')?.id ||
        r.closest('[id]')?.id || 'noname';
      if (!groups[gid]) groups[gid] = [];
      groups[gid].push(r);
    }

    for (const [gid, radios] of Object.entries(groups)) {
      // Skip if already answered BY US in this session (avoid re-clicking)
      if (answeredGroups.has(gid)) continue;
      if (radios.length < 2) continue;
      const wasPreAnswered = radios.some(r => r.checked);

      // Get question text from closest question container
      const container = radios[0].closest(
        '[class*="question"],[class*="Question"],fieldset,[role="group"],[id*="question"]'
      );
      const qText = container
        ? (container.querySelector('label,p,legend,span.question-text,[class*="question-text"]')?.textContent?.trim() || '')
        : (document.querySelector('h1,h2,h3,[class*="question-title"]')?.textContent?.trim() || 'Answer this question');

      const labels = radios.map(r => {
        const lbl = document.querySelector(`label[for="${r.id}"]`) || r.closest('label') || r.parentElement;
        return lbl?.textContent?.trim() || r.value || '';
      }).filter(Boolean);

      if (!labels.length) continue;

      const best = await aiMCQ(qText, labels);
      await jitter();
      radios[best]?.click();
      // Also click the label to ensure the click registers in Canvas/Learnosity
      const bestLbl = document.querySelector(`label[for="${radios[best]?.id}"]`);
      if (bestLbl) { await sleep(80); bestLbl.click(); }
      answeredGroups.add(gid);
      answered++;
      acted = true;
      report(`✓ Q${answered}${wasPreAnswered ? ' (overrode)' : ''}: ${qText.slice(0, 40)}`, { answered, skipped });
      await sleep(300);
    }

    // ── Dropdowns ──
    for (const sel of document.querySelectorAll('select:not([disabled])')) {
      if (!sel.offsetParent) continue;
      const sid = 'sel_' + (sel.name || sel.id || sel.closest('[id]')?.id || Math.random());
      if (answeredGroups.has(sid)) continue;
      if (sel.selectedIndex > 0) { answeredGroups.add(sid); continue; }
      const opts = Array.from(sel.options).slice(1);
      if (!opts.length) continue;
      const container = sel.closest('[class*="question"],[class*="Question"]');
      const qText = container?.querySelector('p,span,label')?.textContent?.trim() || 'Select the answer';
      const best = await aiMCQ(qText, opts.map(o => o.text));
      await jitter();
      sel.value = opts[best]?.value || opts[0].value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      answeredGroups.add(sid);
      answered++;
      acted = true;
      report(`✓ Dropdown Q${answered}`, { answered });
      await sleep(300);
    }

    // ── Text inputs ──
    for (const inp of document.querySelectorAll('input[type="text"]:not([disabled]):not([readonly]),textarea:not([disabled]):not([readonly])')) {
      if (!inp.offsetParent || inp.value.trim()) continue;
      const tid = 'txt_' + (inp.name || inp.id || '');
      if (answeredGroups.has(tid)) continue;
      const container = inp.closest('[class*="question"],[class*="Question"]');
      const qText = container?.querySelector('p,span,label,h3')?.textContent?.trim() || inp.placeholder || 'Fill in the blank';
      const ans = await aiText(qText);
      if (!ans) continue;
      await typeInto(inp, ans);
      answeredGroups.add(tid);
      answered++;
      acted = true;
      report(`✓ Text Q${answered}`, { answered });
      await sleep(300);
    }

    // ── Navigate or wait ──
    if (acted) {
      emptyLoops = 0;
      await sleep(600);
      // Try clicking a submit/check button for this page's questions
      const check = Array.from(document.querySelectorAll('button:not([disabled]),input[type="submit"]:not([disabled])')).find(b => {
        const t = (b.textContent || b.value || '').toLowerCase().trim();
        return t === 'submit' || t === 'submit quiz' || t === 'submit all' || t === 'finish quiz';
      });
      // Don't auto-submit the whole quiz — only click if it says "next question"
      const fp = fingerprint();
      const nav = await clickNav();
      if (nav) await waitForNewQuestion(fp, 4000);
    } else {
      // Nothing on current view — try navigating
      const fp = fingerprint();
      const nav = await clickNav();
      if (nav) {
        emptyLoops = 0;
        await waitForNewQuestion(fp, 4000);
      } else {
        // Wait and try again — Learnosity / iframes can take several seconds to render
        emptyLoops++;
        const sameOriginIframes = Array.from(document.querySelectorAll('iframe')).filter(f => {
          try { return !!f.contentDocument; } catch { return false; }
        });
        const radiosInIframes = sameOriginIframes.reduce((sum, f) => {
          try { return sum + f.contentDocument.querySelectorAll('input[type="radio"]').length; } catch { return sum; }
        }, 0);
        const stillRadios = document.querySelectorAll('input[type="radio"]:not([disabled]):not(:checked)');
        console.log(`[Pluto generic empty loop=${emptyLoops}] frame=${location.hostname} radios=${stillRadios.length} radios-in-same-origin-iframes=${radiosInIframes}`);
        await sleep(2000);
        // Only give up after 8 consecutive seconds with no radios anywhere
        if (emptyLoops >= 4 && stillRadios.length === 0 && radiosInIframes === 0) break;
      }
    }
  }

  return { success: true, answered, skipped, site: 'generic' };
}


// ── VISION (Membean only — uses iframe, DOM approach fails) ───
async function runVision(site) {
  let answered = 0, skipped = 0;
  report(`Vision mode (${site})...`, { answered, skipped });

  for (let loop = 0; loop < 60 && window._plutoRunning; loop++) {
    await sleep(700);

    const shot = await new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'PLUTO_SCREENSHOT' }, r => {
        if (chrome.runtime.lastError || !r?.dataUrl) resolve(null);
        else resolve(r.dataUrl);
      });
    });

    if (!shot) { await sleep(1500); continue; }

    const instruction = await askVision(shot, site);
    if (!instruction) { await sleep(1000); continue; }

    console.log('[Pluto vision]', JSON.stringify(instruction));

    if (instruction.action === 'done') {
      report('✓ Done!', { answered, skipped }); break;
    }
    if (instruction.action === 'wait') {
      report(`⏳ ${instruction.reason || 'Waiting...'}`, { answered, skipped });
      await sleep(instruction.ms || 2000); continue;
    }
    if (instruction.action === 'click') {
      const x = Math.round(instruction.x * window.innerWidth  / 100);
      const y = Math.round(instruction.y * window.innerHeight / 100);
      clickAt(x, y);
      if (instruction.isAnswer) {
        answered++;
        report(`✓ Q${answered}: "${instruction.label || ''}"`, { answered, skipped });
        await sleep(600);
        const fp = fingerprint();
        await waitForNewQuestion(fp, 4000);
      } else {
        report(`→ "${instruction.label || ''}"`, { answered, skipped });
        await sleep(800);
      }
    }
    if (instruction.action === 'type') {
      const inp = document.activeElement?.matches('input,textarea')
        ? document.activeElement
        : document.querySelector('input[type="text"]:not([disabled]),textarea:not([disabled])');
      if (inp) {
        await typeInto(inp, instruction.text);
        await sleep(300);
        const sub = Array.from(document.querySelectorAll('button:not([disabled])')).find(b =>
          ['check','submit','enter','go'].includes(b.textContent.toLowerCase().trim())
        );
        if (sub) sub.click();
        else inp.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:13,bubbles:true}));
        answered++;
        report(`✓ Typed: "${instruction.text}"`, { answered, skipped });
        const fp = fingerprint();
        await waitForNewQuestion(fp, 4000);
      }
    }
  }
  return { success: true, answered, skipped, site };
}

function clickAt(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return;
  el.focus();
  ['mousedown','mouseup','click'].forEach(ev =>
    el.dispatchEvent(new MouseEvent(ev, { bubbles:true, cancelable:true, clientX:x, clientY:y }))
  );
}

async function askVision(dataUrl, site) {
  const b64 = dataUrl.split(',')[1];
  try {
    const d = await askAI({
      message: `You are automating a ${site} quiz. Look at this screenshot.
Identify the next action. If you see an unanswered question, click the CORRECT answer.
If you see a text input, type the answer. If you see a Next/Continue button after answering, click it.
If a timer is running, wait. If done, say done.

Respond ONLY with JSON (no markdown):
{"action":"click","x":50,"y":60,"label":"answer text","isAnswer":true}
or {"action":"type","text":"answer"}
or {"action":"wait","reason":"timer","ms":3000}
or {"action":"click","x":50,"y":70,"label":"Next","isAnswer":false}
or {"action":"done"}

x,y are percentage of screen (0-100).`,
      profile: { name: 'VisionBot' },
      pageContext: { url: location.href, title: document.title, text: '', screenshot: b64 },
      history: [], tutorMode: false
    });
    const raw = d.reply.trim().replace(/```json|```/g,'').trim();
    const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
    if (s === -1) return null;
    return JSON.parse(raw.slice(s, e+1));
  } catch(e) { console.log('[Pluto vision error]', e); return null; }
}


// ── QUIZLET ───────────────────────────────────────────────────
async function runQuizlet() {
  let answered = 0;
  report('Quizlet mode...', { answered });
  for (let i = 0; i < 40 && window._plutoRunning; i++) {
    const fp = fingerprint();
    const inp = document.querySelector('textarea, input[type="text"]');
    if (inp?.offsetParent && !inp.value.trim()) {
      const qEl = document.querySelector('[class*="questionText"],[class*="TermText"],[class*="prompt"]');
      const ans = await aiText(qEl?.textContent?.trim() || 'Answer');
      await typeInto(inp, ans);
      answered++; report(`✓ ${answered}`, { answered });
    }
    const check = document.querySelector('[class*="checkAnswer"],button[data-testid="check"]');
    if (check && !check.disabled) { check.click(); await sleep(800); }
    const next = document.querySelector('[class*="nextButton"],button[aria-label="Next"]');
    if (next) { next.click(); await waitForNewQuestion(fp, 3000); }
    else await sleep(1000);
  }
  return { success: true, answered, site: 'quizlet' };
}

// ── KAHOOT ────────────────────────────────────────────────────
async function runKahoot() {
  let answered = 0;
  report('Kahoot — watching...', { answered });
  for (let i = 0; i < 60 && window._plutoRunning; i++) {
    const fp = fingerprint();
    const btns = document.querySelectorAll('[data-functional-selector*="answer"],[class*="answerButton"],[class*="answer-button"]');
    if (btns.length > 0) {
      const qEl = document.querySelector('[class*="question-title"],[data-functional-selector*="question"]');
      const best = await aiMCQ(qEl?.textContent?.trim() || 'Pick the answer', Array.from(btns).map(b => b.textContent.trim()));
      await jitter(); btns[best]?.click();
      answered++; report(`✓ Q${answered}`, { answered });
      await waitForNewQuestion(fp, 9000);
    } else await sleep(1200);
  }
  return { success: true, answered, site: 'kahoot' };
}

// ── BLOOKET ───────────────────────────────────────────────────
async function runBlooket() {
  let answered = 0;
  report('Blooket mode...', { answered });
  for (let i = 0; i < 50 && window._plutoRunning; i++) {
    const fp = fingerprint();
    const answers = document.querySelectorAll('.answer,[class*="Answer"]:not([class*="Correct"]):not([class*="Wrong"])');
    if (answers.length >= 2) {
      const qEl = document.querySelector('.question,[class*="Question"]');
      const best = await aiMCQ(qEl?.textContent?.trim() || '', Array.from(answers).map(a => a.textContent.trim()));
      await jitter(); answers[best]?.click();
      answered++; report(`✓ Q${answered}`, { answered });
      await waitForNewQuestion(fp, 4000);
    } else await sleep(1000);
  }
  return { success: true, answered, site: 'blooket' };
}

// ── DUOLINGO ──────────────────────────────────────────────────
async function runDuolingo() {
  let answered = 0;
  report('Duolingo mode...', { answered });
  for (let i = 0; i < 40 && window._plutoRunning; i++) {
    const fp = fingerprint();
    const choices = document.querySelectorAll('[data-test="challenge-choice"]:not([aria-checked="true"])');
    if (choices.length) { await jitter(); choices[0].click(); await sleep(400); }
    const next = document.querySelector('button[data-test="player-next"]:not([disabled])');
    if (next) { await jitter(); next.click(); answered++; report(`✓ ${answered}`, { answered }); await waitForNewQuestion(fp, 3000); }
    else await sleep(800);
  }
  return { success: true, answered, site: 'duolingo' };
}

// ── TEXT INJECTION ────────────────────────────────────────────
async function injectText(text) {
  const a = document.activeElement;
  if (a?.tagName === 'INPUT' || a?.tagName === 'TEXTAREA') {
    await typeInto(a, (a.value || '') + text); return;
  }
  const sel = window.getSelection();
  if (sel?.rangeCount > 0) {
    const r = sel.getRangeAt(0); r.deleteContents();
    r.insertNode(document.createTextNode(text)); r.collapse(false); return;
  }
  try { await navigator.clipboard.writeText(text); } catch {}
}

// ── RESEARCH ──────────────────────────────────────────────────
async function runResearch(query, format = 'MLA') {
  try {
    const d = await askAI({
      message: `Research assistant. Find 4 real sources on: "${query}". Reply ONLY as JSON array:\n[{"title":"...","author":"...","source":"...","year":"...","url":"https://...","citation":"${format} formatted","summary":"1 sentence","type":"journal|gov|news|edu"}]`,
      profile: { name: 'ResearchBot' },
      pageContext: { url: location.href, title: document.title, text: '' },
      history: [], tutorMode: false
    });
    const s = d.reply.indexOf('['), e = d.reply.lastIndexOf(']');
    if (s === -1 || e === -1) return { success: false };
    return { success: true, sources: JSON.parse(d.reply.slice(s, e + 1)) };
  } catch { return { success: false }; }
}

// ── AMBIENT TOOLTIP ───────────────────────────────────────────
let tipEl = null, tipTO = null;

document.addEventListener('mouseup', e => {
  // Never close/reopen from a click inside the tooltip itself
  if (tipEl && tipEl.contains(e.target)) return;
  const sel = window.getSelection()?.toString().trim();
  if (sel && sel.length > 8 && sel.length < 800) {
    showTip(sel, e.clientX, e.clientY);
  }
});

// Close when clicking anywhere outside the tooltip
document.addEventListener('mousedown', e => {
  if (tipEl && !tipEl.contains(e.target)) removeTip();
});

document.addEventListener('keydown', e => { if (e.key === 'Escape') removeTip(); });

function showTip(text, x, y) {
  removeTip();
  tipEl = document.createElement('div');

  tipEl.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:9px">
      <span style="font-size:8px;letter-spacing:1.5px;color:rgba(79,142,247,.85);font-family:monospace;font-weight:700">PLUTO · EXPLAIN</span>
      <button id="pluto-tip-close" style="background:none;border:none;color:rgba(255,255,255,.35);font-size:13px;cursor:pointer;padding:0 2px;line-height:1;transition:color .15s" onmouseover="this.style.color='rgba(255,255,255,.8)'" onmouseout="this.style.color='rgba(255,255,255,.35)'">✕</button>
    </div>
    <div id="pluto-tip-body" style="font-size:12.5px;line-height:1.65;color:#b8b8cc;min-height:36px">
      <span style="color:rgba(255,255,255,.25);font-style:italic">Thinking…</span>
    </div>
    <div id="pluto-tip-actions" style="display:flex;gap:6px;margin-top:10px">
      <button id="pluto-tip-ask" style="font-size:9.5px;font-family:monospace;font-weight:700;letter-spacing:.5px;background:rgba(79,142,247,.18);border:1px solid rgba(79,142,247,.35);color:rgba(79,142,247,.9);border-radius:7px;padding:5px 10px;cursor:pointer;transition:background .15s" onmouseover="this.style.background='rgba(79,142,247,.32)'" onmouseout="this.style.background='rgba(79,142,247,.18)'">ASK PLUTO ↗</button>
      <button id="pluto-tip-copy" style="font-size:9.5px;font-family:monospace;font-weight:700;letter-spacing:.5px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.4);border-radius:7px;padding:5px 10px;cursor:pointer;transition:background .15s" onmouseover="this.style.background='rgba(255,255,255,.12)'" onmouseout="this.style.background='rgba(255,255,255,.06)'">COPY</button>
    </div>`;

  const W = 320;
  const left = Math.min(Math.max(x - W / 2, 8), innerWidth - W - 8);
  const top  = (y + 18 + 180 > innerHeight) ? y - 18 - 175 : y + 18;

  Object.assign(tipEl.style, {
    position:'fixed', left:left+'px', top:top+'px', width:W+'px',
    background:'rgba(8,8,18,.97)', border:'1px solid rgba(255,255,255,.1)',
    borderRadius:'14px', padding:'13px 15px 12px', zIndex:'2147483647',
    boxShadow:'0 24px 60px rgba(0,0,0,.85)', backdropFilter:'blur(28px)',
    fontFamily:"system-ui,sans-serif", opacity:'0',
    transform:'translateY(8px)', transition:'opacity .16s,transform .16s',
    pointerEvents:'auto', userSelect:'none'
  });

  document.body.appendChild(tipEl);
  requestAnimationFrame(() => { tipEl.style.opacity='1'; tipEl.style.transform='translateY(0)'; });

  tipEl.querySelector('#pluto-tip-close').addEventListener('click', removeTip);

  tipEl.querySelector('#pluto-tip-ask').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'PLUTO_ASK_SELECTION', text: text.slice(0, 400) });
    removeTip();
  });

  const copyBtn = tipEl.querySelector('#pluto-tip-copy');
  copyBtn.addEventListener('click', () => {
    const explanation = tipEl.querySelector('#pluto-tip-body')?.textContent || text;
    navigator.clipboard.writeText(explanation).catch(() => {});
    copyBtn.textContent = 'COPIED ✓';
    setTimeout(() => { if (copyBtn.isConnected) copyBtn.textContent = 'COPY'; }, 1500);
  });

  // Fetch explanation immediately — no delay
  askAI({
    message: `Explain in 2 clear sentences for a student: "${text.slice(0, 400)}"`,
    profile:{name:'AmbientUser'}, pageContext:{url:location.href,title:document.title,text:''},
    history:[], tutorMode:false
  }).then(d => {
    const b = tipEl?.querySelector('#pluto-tip-body');
    if (b) b.textContent = d.reply.trim().slice(0, 300);
  }).catch(() => {
    const b = tipEl?.querySelector('#pluto-tip-body');
    if (b) b.innerHTML = '<span style="color:rgba(255,100,100,.6)">Server offline — start the Pluto server.</span>';
  });

  // Auto-dismiss after 30s of no interaction
  tipTO = setTimeout(removeTip, 30000);
}

function removeTip() {
  clearTimeout(tipTO);
  if (!tipEl) return;
  const el = tipEl; tipEl = null;
  el.style.opacity = '0'; el.style.transform = 'translateY(6px)';
  setTimeout(() => el.remove(), 180);
}