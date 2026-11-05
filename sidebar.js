// sidebar.js — injects the Pluto right sidebar into any extension page
// Include with: <script src="sidebar.js"></script>
// Body automatically gets class "has-sidebar"

(function () {
  const CURRENT_PAGE = location.pathname.split('/').pop().replace('.html', '');

  const NAV_ITEMS = [
    { id: 'dashboard',  label: 'Dashboard',     icon: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>' },
    { id: 'study',      label: 'Study Sets',    icon: '<path d="M4 19V6a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v3"/><path d="M4 19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7H6"/>' },
    { id: 'test',       label: 'Practice Test', icon: '<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="m9 12 2 2 4-4"/>' },
    { id: 'chat',       label: 'Chat',          icon: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' },
    { id: 'learn',      label: 'Learn Mode',    icon: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>' },
    { id: 'match',      label: 'Match',         icon: '<rect x="2" y="2" width="9" height="9" rx="1"/><rect x="13" y="2" width="9" height="9" rx="1"/><rect x="2" y="13" width="9" height="9" rx="1"/><rect x="13" y="13" width="9" height="9" rx="1"/>' },
    { id: 'kai',        label: 'Voice',         icon: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/>' },
    { id: 'importer',   label: 'Importer',      icon: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>' },
    { id: 'live',       label: 'Live Race',     icon: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>' },
    { id: 'research',   label: 'Research',      icon: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>' },
    { id: 'game',       label: 'Quest',         icon: '<path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>' },
  ];

  const sidebarHTML = `
    <nav class="pluto-sidebar" id="pluto-sidebar" role="navigation" aria-label="Pluto navigation">
      <a href="dashboard.html" class="pluto-sidebar-logo" title="Pluto Dashboard">
        <svg width="22" height="22" viewBox="0 0 36 36" fill="none">
          <circle cx="18" cy="18" r="10" fill="rgba(128,128,160,0.5)"/>
          <ellipse cx="18" cy="18" rx="16.5" ry="5" stroke="rgba(200,200,210,0.6)" stroke-width="2" fill="none" transform="rotate(-20 18 18)"/>
        </svg>
        <span class="pluto-sidebar-logo-text">PLUTO</span>
      </a>

      ${NAV_ITEMS.map(item => `
        <a href="${item.id}.html"
           class="pluto-nav-item${CURRENT_PAGE === item.id ? ' active' : ''}"
           data-tooltip="${item.label}"
           title="${item.label}">
          <svg class="pluto-nav-icon" viewBox="0 0 24 24">${item.icon}</svg>
          <span class="pluto-nav-label">${item.label}</span>
        </a>
      `).join('')}

      <div class="pluto-sidebar-divider"></div>

      <button class="pluto-sidebar-toggle" id="pluto-sidebar-toggle" title="Toggle sidebar">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <polyline id="pluto-toggle-chevron" points="15 18 9 12 15 6"/>
        </svg>
        <span class="pluto-sidebar-toggle-label">Collapse</span>
      </button>
    </nav>
  `;

  document.body.insertAdjacentHTML('beforeend', sidebarHTML);
  document.body.classList.add('has-sidebar');

  const sidebar  = document.getElementById('pluto-sidebar');
  const toggle   = document.getElementById('pluto-sidebar-toggle');
  const chevron  = document.getElementById('pluto-toggle-chevron');
  const _savedPinned = localStorage.getItem('pluto-sidebar-pinned');
  let pinned = _savedPinned !== null ? _savedPinned === 'true' : CURRENT_PAGE === 'dashboard';

  function applyPinned() {
    if (pinned) {
      sidebar.classList.add('expanded');
      document.body.classList.add('sidebar-expanded');
      chevron.setAttribute('points', '9 18 15 12 9 6');
    } else {
      sidebar.classList.remove('expanded');
      document.body.classList.remove('sidebar-expanded');
      chevron.setAttribute('points', '15 18 9 12 15 6');
    }
  }
  applyPinned();

  sidebar.addEventListener('mouseenter', () => { if (!pinned) sidebar.classList.add('expanded'); });
  sidebar.addEventListener('mouseleave', () => { if (!pinned) sidebar.classList.remove('expanded'); });

  toggle.addEventListener('click', () => {
    pinned = !pinned;
    localStorage.setItem('pluto-sidebar-pinned', pinned);
    applyPinned();
  });
})();
