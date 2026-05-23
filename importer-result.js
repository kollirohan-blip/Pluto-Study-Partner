import { initStarCanvas, storage, toast } from './pluto-shared.js';

const $ = id => document.getElementById(id);

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function mdToHtml(md) {
  // Strip LaTeX math delimiters that the AI sometimes adds for dollar amounts:
  // "$$ content $$"  →  content
  // "$ \$10,000 $"   →  "$10,000"
  // "\$"             →  "$"
  md = md.replace(/\$\$([\s\S]*?)\$\$/g, (_, c) => c.replace(/\\\$/g, '$').trim());
  md = md.replace(/\$\s+([^\n$]+?)\s+\$/g, (_, c) => c.replace(/\\\$/g, '$').trim());
  md = md.replace(/\\\$/g, '$');

  const inlineFmt = s => {
    s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    return s;
  };

  const lines = md.split('\n');
  let html = '', inUl = false, inOl = false;

  const closeList = () => {
    if (inUl) { html += '</ul>'; inUl = false; }
    if (inOl) { html += '</ol>'; inOl = false; }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^###+ /.test(line)) {
      closeList();
      html += `<h3>${inlineFmt(line.replace(/^###+ /, ''))}</h3>`;
    } else if (/^## /.test(line)) {
      closeList();
      html += `<h2>${inlineFmt(line.replace(/^## /, ''))}</h2>`;
    } else if (/^# /.test(line)) {
      closeList();
      html += `<h1>${inlineFmt(line.replace(/^# /, ''))}</h1>`;
    } else if (/^> /.test(line)) {
      closeList();
      html += `<blockquote>${inlineFmt(line.slice(2))}</blockquote>`;
    } else if (/^\d+\. /.test(line)) {
      if (inUl) { html += '</ul>'; inUl = false; }
      if (!inOl) { html += '<ol>'; inOl = true; }
      html += `<li>${inlineFmt(line.replace(/^\d+\. /, ''))}</li>`;
    } else if (/^[*\-+] /.test(line)) {
      if (inOl) { html += '</ol>'; inOl = false; }
      if (!inUl) { html += '<ul>'; inUl = true; }
      html += `<li>${inlineFmt(line.slice(2).trim())}</li>`;
    } else if (line.trim() === '') {
      closeList();
    } else {
      closeList();
      html += `<p>${inlineFmt(line)}</p>`;
    }
  }
  closeList();
  return html;
}

async function init() {
  initStarCanvas($('stars'));

  const { importerResult } = await storage.get('importerResult');
  if (!importerResult) {
    $('result-heading').textContent = 'Nothing to show';
    $('result-sub').textContent     = 'Go to the Importer and generate something first.';
    return;
  }

  const { mode, content, cards, title, setId } = importerResult;

  const modeLabels = { flashcards: 'FLASHCARDS', notes: 'STUDY NOTES', questions: 'PRACTICE Q&A', guide: 'STUDY GUIDE' };
  $('mode-eyebrow').textContent = modeLabels[mode] || mode.toUpperCase();
  $('page-title').textContent   = modeLabels[mode] || 'RESULT';
  $('result-heading').textContent = title || 'Generated Content';

  const contentEl = $('result-content');
  const actionRow  = $('action-row');

  // ── Flashcards ──
  if (mode === 'flashcards') {
    $('result-sub').textContent = `${cards.length} flashcards — auto-saved to your sets`;

    const badge = document.createElement('div');
    badge.className = 'saved-badge';
    badge.innerHTML = `✓ Saved as <strong style="margin-left:4px">"${esc(title)}"</strong>`;
    contentEl.appendChild(badge);

    const grid = document.createElement('div');
    grid.className = 'cards-grid';
    cards.forEach((card, i) => {
      const el = document.createElement('div');
      el.className = 'card-item';
      el.innerHTML = `
        <div class="card-num">${String(i + 1).padStart(2, '0')}</div>
        <div class="card-term">${esc(card.term)}</div>
        <div class="card-def">${esc(card.def)}</div>
      `;
      grid.appendChild(el);
    });
    contentEl.appendChild(grid);

    const studyBtn = document.createElement('button');
    studyBtn.className = 'act-btn primary';
    studyBtn.textContent = '📚 Start Studying';
    studyBtn.addEventListener('click', () => {
      window.location.href = chrome.runtime.getURL('dashboard.html');
    });
    actionRow.appendChild(studyBtn);

  // ── Q&A ──
  } else if (mode === 'questions') {
    const blocks = content.split(/\n\n+/).filter(Boolean);
    $('result-sub').textContent = `${blocks.length} practice questions`;

    const list = document.createElement('div');
    list.className = 'qa-list';

    blocks.forEach((block, idx) => {
      const lines = block.split('\n').filter(l => l.trim());
      const qLine = lines.find(l => /^Q\d+:/.test(l) || /^Q:/.test(l)) || lines[0] || '';
      const aLine = lines.find(l => /^A:/.test(l)) || lines[1] || '';

      const el = document.createElement('div');
      el.className = 'qa-pair';
      const qText = qLine.replace(/^Q\d+:\s*/, '').replace(/^Q:\s*/, '').trim();
      const aText = aLine.replace(/^A:\s*/, '').trim();
      el.innerHTML = `
        <div class="qa-q"><span class="qa-num">Q${idx + 1}</span>${esc(qText)}</div>
        <div class="qa-a">${esc(aText)}</div>
      `;
      list.appendChild(el);
    });
    contentEl.appendChild(list);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'act-btn ghost';
    copyBtn.textContent = 'Copy All';
    copyBtn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(content).catch(() => {});
      toast('Copied!', 'success');
    });
    actionRow.appendChild(copyBtn);

  // ── Notes / Guide ──
  } else {
    $('result-sub').textContent = mode === 'notes' ? 'AI-generated study notes' : 'AI-generated study guide';
    const body = document.createElement('div');
    body.className = 'md-body';
    body.innerHTML = mdToHtml(content);
    contentEl.appendChild(body);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'act-btn ghost';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(content).catch(() => {});
      toast('Copied!', 'success');
    });
    actionRow.appendChild(copyBtn);
  }

  // Back to importer button for all modes
  const backBtn = document.createElement('button');
  backBtn.className = 'act-btn ghost';
  backBtn.textContent = '← Import Another';
  backBtn.addEventListener('click', () => {
    window.location.href = chrome.runtime.getURL('importer.html');
  });
  actionRow.appendChild(backBtn);
}

init();
