// main.js

const sortToggle = document.getElementById('sort-toggle');
const featuredCard = document.getElementById('featured-card');
const projectGrid = document.getElementById('project-grid');
const statsRow = document.getElementById('stats-row');
const projectHelper = document.getElementById('project-helper');
const searchInput = document.getElementById('search-input');
const statusFilter = document.getElementById('status-filter');
const announcementList = document.getElementById('announcement-list');
const classicList = document.getElementById('classic-list');

const SORT_KEY = 'project-launcher-sort';
const SEARCH_KEY = 'project-launcher-search';
const STATUS_KEY = 'project-launcher-status';
const CHAT_USERNAME_KEY = 'mqtt_chat_username_v1';

let highestZIndex = 1000;

// ===== SITE ACTIVITY / ACTIVE WINDOW SYNC =====
// The browser does not expose the operating-system's active application to web
// pages. This activity layer therefore tracks the site's own floating windows
// and nested iframes, then shares that state with the chatroom.
let activeWindowState = null;

function getFloatingWindowActivityName(win, fallback = "Application") {
  if (!win) return fallback;
  const titleEl = win.querySelector('.applet-win-title');
  const title = titleEl ? titleEl.textContent.trim() : "";
  return win.__activityNameOverride || title || fallback;
}

function getFloatingWindowActivityKind(win) {
  if (!win) return "window";
  return win.dataset.activityKind || "window";
}

function isFloatingWindowVisible(win) {
  return !!win && !win.hidden && !win.classList.contains('minimized');
}

function getTopmostVisibleFloatingWindow(excludeWin = null) {
  const windows = Array.from(document.querySelectorAll('.floating-window'))
    .filter(win => win !== excludeWin && isFloatingWindowVisible(win));

  windows.sort((a, b) => {
    const az = parseInt(a.style.zIndex || "0", 10) || 0;
    const bz = parseInt(b.style.zIndex || "0", 10) || 0;
    return bz - az;
  });

  return windows[0] || null;
}

function sendActivityStateToChat() {
  const chatFrame = document.getElementById('chat-frame');
  const chatWindow = document.getElementById('chat-window');

  if (!chatFrame || !chatFrame.contentWindow) return;

  const chatWindowOpen = isFloatingWindowVisible(chatWindow);
  const activeWindow = activeWindowState ? { ...activeWindowState } : null;

  chatFrame.contentWindow.postMessage({
    source: 'parent-shell',
    action: 'activityState',
    activeWindow,
    chatWindowOpen,
    isHomepage: !chatWindowOpen && !activeWindow
  }, '*');
}

function setActiveFloatingWindow(win, explicitName = "") {
  if (!win || !isFloatingWindowVisible(win)) return;

  const nextState = {
    id: win.id,
    kind: getFloatingWindowActivityKind(win),
    name: explicitName || getFloatingWindowActivityName(win)
  };

  const changed =
    !activeWindowState ||
    activeWindowState.id !== nextState.id ||
    activeWindowState.kind !== nextState.kind ||
    activeWindowState.name !== nextState.name;

  activeWindowState = nextState;

  if (changed) {
    sendActivityStateToChat();
  }
}

function clearActiveFloatingWindow(win = null) {
  if (win && activeWindowState && activeWindowState.id !== win.id) {
    return;
  }

  const fallback = getTopmostVisibleFloatingWindow(win);

  if (fallback) {
    setActiveFloatingWindow(fallback, getFloatingWindowActivityName(fallback));
    return;
  }

  if (activeWindowState !== null) {
    activeWindowState = null;
    sendActivityStateToChat();
  }
}

function refreshActiveFloatingWindow() {
  if (activeWindowState) {
    const current = document.getElementById(activeWindowState.id);
    if (isFloatingWindowVisible(current)) {
      setActiveFloatingWindow(current, getFloatingWindowActivityName(current));
      return;
    }
  }

  const fallback = getTopmostVisibleFloatingWindow();
  if (fallback) {
    setActiveFloatingWindow(fallback, getFloatingWindowActivityName(fallback));
  } else {
    clearActiveFloatingWindow();
  }
}

function setupActiveWindowTracking() {
  document.addEventListener('mousedown', (event) => {
    const win = event.target.closest ? event.target.closest('.floating-window') : null;

    if (win) {
      if (isFloatingWindowVisible(win)) {
        setActiveFloatingWindow(win, getFloatingWindowActivityName(win));
      }
      return;
    }

    // Clicking the desktop/page itself means there is no active site window.
    // Taskbar/start-menu clicks are intentionally left alone so the button
    // handlers can open/focus their target window immediately afterward.
    if (event.target.closest('.taskbar, #start-menu')) return;

    clearActiveFloatingWindow();
  }, true);
}

function setupActivityMessaging() {
  window.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.source !== 'arcade-hub') return;

    const arcadeFrame = document.getElementById('arcade-frame');
    const arcadeWindow = document.getElementById('arcade-window');

    if (!arcadeFrame || !arcadeWindow || event.source !== arcadeFrame.contentWindow) return;

    if (data.active === false) {
      arcadeWindow.__activityNameOverride = "";
      if (activeWindowState && activeWindowState.id === arcadeWindow.id) {
        clearActiveFloatingWindow(arcadeWindow);
      }
      return;
    }

    const activityName = typeof data.name === 'string' && data.name.trim()
      ? data.name.trim()
      : 'Arcade Hub';

    arcadeWindow.__activityNameOverride = activityName === 'Arcade Hub' ? "" : activityName;
    setActiveFloatingWindow(arcadeWindow, activityName);
  });
}

const STATUS_META = {
  complete:   { label: 'Complete',      className: 'status--complete',   bucket: 'complete' },
  beta:       { label: 'Beta Release',  className: 'status--beta',       bucket: 'progress' },
  new:        { label: 'NEW!!!',        className: 'status--new',        bucket: 'progress' },
  wipPlayable:{ label: 'WIP-Playable',  className: 'status--wip',        bucket: 'progress' },
  wipBuggy:   { label: 'WIP - Buggy',   className: 'status--buggy',      bucket: 'progress' },
  unfinished: { label: 'Unfinished',    className: 'status--unfinished', bucket: 'progress' },
  legacy:     { label: 'Legacy',        className: 'status--legacy',     bucket: 'legacy' },
  abandoned:  { label: 'Abandoned',     className: 'status--abandoned',  bucket: 'legacy' }
};

function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeGet(key) {
  try { return localStorage.getItem(key); } catch (e) { console.warn("Storage restricted."); return null; }
}

function safeSet(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { console.warn("Storage restricted."); }
}

function getStatusMeta(statusKey) {
  return STATUS_META[statusKey] || { label: statusKey, className: 'status--legacy', bucket: 'legacy' };
}

function debounce(func, delay) {
  let timeoutId;
  return function(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      func.apply(this, args);
    }, delay);
  };
}

let sortMode = safeGet(SORT_KEY) || 'default';
let searchTerm = safeGet(SEARCH_KEY) || '';
let statusValue = safeGet(STATUS_KEY) || 'all';

if (searchInput) searchInput.value = searchTerm;
if (statusFilter) statusFilter.value = statusValue;

// ===== INJECT DYNAMIC SITE DATA =====
function renderSiteData() {
  document.getElementById('site-version').textContent = siteData.version;
  document.getElementById('top-banner-text').textContent = `✦ MADE BY ${siteData.author} ✦ ${siteData.location} ✦`;
  document.getElementById('hero-title').textContent = siteData.heroTitle;
  document.getElementById('hero-copy').innerHTML = siteData.heroCopy;
  document.getElementById('hero-note').innerHTML = siteData.heroNote;
  document.getElementById('marquee-text').innerHTML = siteData.marqueeText;
  document.getElementById('footer-copyright').textContent = siteData.footerCopyright;
  document.getElementById('footer-updated').textContent = `Last updated: ${siteData.footerLastUpdated}`;
}

// ===== SAFE TEMPLATE RENDER LISTS =====
function renderAnnouncements() {
  const template = document.getElementById('announcement-template');
  if (!template) return;
  
  announcementList.innerHTML = '';
  announcements.forEach(a => {
    const clone = template.content.cloneNode(true);
    clone.querySelector('h3').textContent = a.title;
    clone.querySelector('p').innerHTML = a.content;
    announcementList.appendChild(clone);
  });
}

function renderClassics() {
  if (classics.length === 0) return;
  const template = document.getElementById('classic-template');
  if (!template) return;

  classicList.innerHTML = '';
  classics.forEach(c => {
    const clone = template.content.cloneNode(true);
    const link = clone.querySelector('a');
    link.href = c.url;
    link.setAttribute('aria-label', `Play ${c.title}`);
    
    const img = clone.querySelector('img');
    img.src = c.image;
    img.alt = c.alt;
    img.onerror = function() { this.src = 'images/missing.png'; };
    
    clone.querySelector('h3').textContent = c.title;
    classicList.appendChild(clone);
  });
}

function renderStats() {
  const complete = projects.filter(p => p.statusKey === 'complete').length;
  const inProgress = projects.filter(p => ['beta', 'new', 'wipPlayable', 'wipBuggy', 'unfinished'].includes(p.statusKey)).length;
  document.getElementById('stat-projects').textContent = projects.length;
  document.getElementById('stat-complete').textContent = complete;
  document.getElementById('stat-progress').textContent = inProgress;
  document.getElementById('stat-classics').textContent = classics.length;
}

function renderFeatured() {
  const featured = projects.find(project => project.featured) || projects[0];
  if (!featured) return;
  const status = getStatusMeta(featured.statusKey);
  featuredCard.innerHTML = `
    <div class="featured-media">
      <img src="${featured.image}" alt="${esc(featured.alt)} featured preview" loading="eager" onerror="this.src='images/missing.png';" />
    </div>
    <div class="featured-content">
      <span class="status ${status.className}">${esc(status.label)}</span>
      <h3>${esc(featured.title)}</h3>
      <p>${esc(featured.description)}</p>
      <div class="featured-meta">${featured.tags.map(tag => `<span class="tag ${tag.includes('Top Pick') ? 'tag--featured' : ''}">${esc(tag)}</span>`).join('')}</div>
      <a class="play-btn" href="${featured.url}" target="_blank" rel="noopener noreferrer" aria-label="Play ${esc(featured.title)}" style="font-family: 'W95FA', 'MS Sans Serif', sans-serif !important;">Launch</a>
    </div>
  `;
}

function sortedProjects() {
  const featured = projects.find(project => project.featured);
  const others = projects.filter(project => !project.featured);
  if (sortMode === 'type') {
    others.sort((a, b) => a.type.localeCompare(b.type) || a.title.localeCompare(b.title));
  }
  return featured ? [featured, ...others] : others;
}

function projectMatches(project) {
  const term = searchTerm.trim().toLowerCase();
  const statusMatch = statusValue === 'all' || project.statusKey === statusValue;
  const searchMatch = !term || [project.title, project.type, getStatusMeta(project.statusKey).label, project.description, ...(project.tags || [])].join(' ').toLowerCase().includes(term);
  return statusMatch && searchMatch;
}

function filteredProjects() {
  return sortedProjects().filter(project => !project.featured && projectMatches(project));
}

function featuredMatchesFilters() {
  const featured = projects.find(project => project.featured);
  return featured ? projectMatches(featured) : false;
}

function updateHelperText(count) {
  const total = projects.filter(p => !p.featured).length;
  const modeText = sortMode === 'type' ? 'Sorted alphabetically by project type.' : 'Kept in curated order.';
  const filterText = [];
  if (searchTerm.trim()) filterText.push(`Search: ${searchTerm.trim()}`);
  if (statusValue !== 'all') filterText.push(`Status: ${getStatusMeta(statusValue).label}`);
  const featuredNote = featuredMatchesFilters() ? ' Featured project matches your current search and filter and is shown above.' : '';
  projectHelper.textContent = `${modeText} ${filterText.length ? filterText.join(' · ') + ' · ' : ''}${count} of ${total} projects shown.${featuredNote}`;
}

function renderProjects() {
  const items = filteredProjects();
  const template = document.getElementById('project-template');
  
  projectGrid.innerHTML = '';
  
  if (items.length && template) {
    items.forEach(project => {
      const clone = template.content.cloneNode(true);
      const status = getStatusMeta(project.statusKey);
      
      const img = clone.querySelector('.card-image img');
      img.src = project.image;
      img.alt = project.alt;
      img.onerror = function() { this.src = 'images/missing.png'; };
      
      const statusSpan = clone.querySelector('.status');
      statusSpan.className = `status ${status.className}`;
      statusSpan.textContent = status.label;
      
      clone.querySelector('.card-top .tag').textContent = project.type;
      clone.querySelector('h3').textContent = project.title;
      clone.querySelector('p').textContent = project.description;
      
      const tagsWrapper = clone.querySelector('.tags');
      tagsWrapper.innerHTML = '';
      project.tags.forEach(tag => {
        const span = document.createElement('span');
        span.className = `tag ${tag.includes('Top Pick') ? 'tag--featured' : tag === 'Under development' ? 'tag--dev' : ''}`;
        span.textContent = tag;
        tagsWrapper.appendChild(span);
      });
      
      const playBtn = clone.querySelector('.play-btn');
      playBtn.href = project.url;
      playBtn.setAttribute('aria-label', `Play ${project.title}`);
      
      projectGrid.appendChild(clone);
    });
  } else {
    projectGrid.innerHTML = `
      <div class="announcement-item no-matches">
        <h3>No matches found</h3>
        <p>Try a different search term or clear the status filter.</p>
      </div>
    `;
  }
  
  sortToggle.textContent = sortMode === 'type' ? 'Sort: type' : 'Sort by type';
  sortToggle.setAttribute('aria-pressed', sortMode === 'type' ? 'true' : 'false');
  updateHelperText(items.length);
}

// ===== WINDOW MANAGER UTILS =====
function updateCRTState() {
  const anyMaximized = document.querySelectorAll('.app-window.maximized:not([hidden]):not(.minimized)').length > 0;
  if (anyMaximized) {
    document.documentElement.classList.add('temp-no-crt');
  } else {
    document.documentElement.classList.remove('temp-no-crt');
  }
}

// ===== IN-PAGE WINDOW BUTTONS (FOR REGULAR PAGE PANELS) =====
function setupWindowButtons() {
  document.querySelectorAll('.page-shell .btn-minimize').forEach((btn) => {
    const panel = btn.closest('.panel') || btn.closest('.panel-dark');
    if (panel && panel.id !== 'ping-banner') {
      btn.addEventListener('click', () => {
        panel.classList.toggle('minimized');
      });
    }
  });

  document.querySelectorAll('.page-shell .btn-close').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const panel = e.target.closest('.panel') || e.target.closest('.panel-dark');
      if (panel) {
        panel.style.display = 'none';
        panel.classList.remove('minimized');
      }
    });
  });
}

// ===== DRAGGABLE & RESIZABLE FLOATING WINDOW ENGINE =====
function makeWindowDraggableAndResizable(win) {
  const titleBar = win.querySelector('.panel-title-bar');
  const iframe = win.querySelector('iframe');

  win.addEventListener('mousedown', () => {
    setActiveFloatingWindow(win, getFloatingWindowActivityName(win));

    if (!win.classList.contains('maximized')) {
      highestZIndex++;
      win.style.zIndex = highestZIndex;
    }
  });

  const directions = ['e', 's', 'w', 'se', 'sw'];
  directions.forEach(dir => {
    let handle = win.querySelector(`.win-resize-handle-${dir}`);
    if (!handle) {
      handle = document.createElement('div');
      handle.className = `win-resize-handle win-resize-handle-${dir}`;
      win.appendChild(handle);
    }

    let isResizing = false;
    let startX, startY, startW, startH, startLeft, startTop;

    const startResize = (e) => {
      if (win.classList.contains('maximized')) return;
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
      isResizing = true;

      const clientX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;
      const clientY = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;

      startX = clientX;
      startY = clientY;

      const rect = win.getBoundingClientRect();
      startW = rect.width;
      startH = rect.height;
      startLeft = rect.left;
      startTop = rect.top;

      win.style.left = startLeft + 'px';
      win.style.top = startTop + 'px';
      win.style.right = 'auto';
      win.style.bottom = 'auto';

      if (iframe) iframe.style.pointerEvents = 'none';
      highestZIndex++;
      win.style.zIndex = highestZIndex;

      document.addEventListener('mousemove', onResize);
      document.addEventListener('mouseup', stopResize);
      document.addEventListener('touchmove', onResize, { passive: false });
      document.addEventListener('touchend', stopResize);
    };

    const onResize = (e) => {
      if (!isResizing) return;
      if (e.cancelable) e.preventDefault();

      const clientX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;
      const clientY = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;

      const dx = clientX - startX;
      const dy = clientY - startY;

      const minW = 280;
      const minH = 200;

      if (dir.includes('e')) win.style.width = Math.max(minW, startW + dx) + 'px';
      if (dir.includes('s')) win.style.height = Math.max(minH, startH + dy) + 'px';
      if (dir.includes('w')) {
        const newW = Math.max(minW, startW - dx);
        if (newW > minW) {
          win.style.width = newW + 'px';
          win.style.left = (startLeft + dx) + 'px';
        }
      }
    };

    const stopResize = () => {
      if (!isResizing) return;
      isResizing = false;
      if (iframe) iframe.style.pointerEvents = 'auto';
      document.removeEventListener('mousemove', onResize);
      document.removeEventListener('mouseup', stopResize);
      document.removeEventListener('touchmove', onResize);
      document.removeEventListener('touchend', stopResize);
    };

    handle.addEventListener('mousedown', startResize);
    handle.addEventListener('touchstart', startResize, { passive: false });
  });

  if (titleBar) {
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    const startDrag = (e) => {
      if (e.target.closest('button')) return;
      if (win.classList.contains('maximized')) return;
      isDragging = true;

      const clientX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;
      const clientY = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;

      startX = clientX;
      startY = clientY;

      const rect = win.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;

      win.style.left = initialLeft + 'px';
      win.style.top = initialTop + 'px';
      win.style.right = 'auto';
      win.style.bottom = 'auto';

      if (iframe) iframe.style.pointerEvents = 'none';
      highestZIndex++;
      win.style.zIndex = highestZIndex;

      document.addEventListener('mousemove', onDrag);
      document.addEventListener('mouseup', stopDrag);
      document.addEventListener('touchmove', onDrag, { passive: false });
      document.addEventListener('touchend', stopDrag);
    };

    const onDrag = (e) => {
      if (!isDragging) return;
      if (e.cancelable) e.preventDefault();

      const clientX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;
      const clientY = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;

      const dx = clientX - startX;
      const dy = clientY - startY;

      win.style.left = Math.max(0, Math.min(window.innerWidth - 80, initialLeft + dx)) + 'px';
      win.style.top = Math.max(0, Math.min(window.innerHeight - 30, initialTop + dy)) + 'px';
    };

    const stopDrag = () => {
      if (!isDragging) return;
      isDragging = false;
      if (iframe) iframe.style.pointerEvents = 'auto';
      document.removeEventListener('mousemove', onDrag);
      document.removeEventListener('mouseup', stopDrag);
      document.removeEventListener('touchmove', onDrag);
      document.removeEventListener('touchend', stopDrag);
    };

    titleBar.addEventListener('mousedown', startDrag);
    titleBar.addEventListener('touchstart', startDrag, { passive: false });
  }
}

// ===== UNIVERSAL DYNAMIC APPLET WINDOW CREATOR =====
function createAppletWindow(appletPath, options = {}) {
  const targetSrc = options.isRootPath ? appletPath : (appletPath.startsWith('applets/') ? appletPath : `applets/${appletPath}`);
  const winId = options.id || ('applet-win-' + Math.random().toString(36).substring(2, 9));
  const frameId = options.iframeId || (winId + '-frame');
  const initialTitle = options.title || 'Applet';
  const keepAlive = options.keepAlive || false; // Used to prevent iframe destruction

  const win = document.createElement('div');
  win.id = winId;
  win.className = `app-window panel floating-window ${options.className || ''}`;
  win.dataset.activityKind = options.activityKind || (
    winId === 'chat-window' ? 'chatroom' :
    winId === 'arcade-window' ? 'arcade' :
    winId.startsWith('game-win-') ? 'game' :
    'window'
  );
  win.role = 'dialog';
  win.setAttribute('aria-labelledby', `${winId}-title`);
  win.hidden = options.hidden !== undefined ? options.hidden : true;

  if (options.width) win.style.width = options.width;
  if (options.height) win.style.height = options.height;

  const iconHtml = options.icon ? `<img src="${options.icon}" class="win-title-icon" alt="" onerror="this.style.display='none';" />` : '';

  // Added flex styling to win-btns to guarantee the refresh button squeezes in perfectly
  win.innerHTML = `
    <div class="panel-title-bar" style="font-family: 'W95FA', 'MS Sans Serif', sans-serif !important;">
      <span style="display: flex; align-items: center;">
        ${iconHtml}
        <span id="${winId}-title" class="applet-win-title" style="font-family: 'W95FA', 'MS Sans Serif', sans-serif !important;">${esc(initialTitle)}</span>
      </span>
      <span class="win-btns" style="display: flex; gap: 4px;">
        <button type="button" class="win-btn btn-refresh" aria-label="Refresh">↻</button>
        <button type="button" class="win-btn btn-maximize" aria-label="Maximize">□</button>
        <button type="button" class="win-btn btn-close" aria-label="Close">✕</button>
      </span>
    </div>
    <div class="app-window-body">
      <iframe id="${frameId}" class="app-frame" src="${targetSrc}" title="${esc(initialTitle)}"></iframe>
    </div>
  `;

  document.body.appendChild(win);

  const titleSpan = win.querySelector('.applet-win-title');
  const iframe = win.querySelector(`#${frameId}`);
  const refreshBtn = win.querySelector('.btn-refresh');
  const maxBtn = win.querySelector('.btn-maximize');
  const closeBtn = win.querySelector('.btn-close');

  window.addEventListener('blur', () => {
    setTimeout(() => {
      if (document.activeElement === iframe) {
        setActiveFloatingWindow(win, getFloatingWindowActivityName(win));

        if (!win.classList.contains('maximized')) {
          highestZIndex++;
          win.style.zIndex = highestZIndex;
        }
      }
    }, 0);
  });

  iframe.addEventListener('load', () => {
    try {
      if (iframe.contentDocument && iframe.contentDocument.title) {
        const docTitle = iframe.contentDocument.title.trim();
        if (docTitle) {
          titleSpan.textContent = docTitle;
          iframe.title = docTitle;
        }
      }

      if (!win.__activityNameOverride && activeWindowState && activeWindowState.id === win.id) {
        setActiveFloatingWindow(win, getFloatingWindowActivityName(win));
      }

      iframe.contentWindow.addEventListener('focus', () => {
        setActiveFloatingWindow(win, getFloatingWindowActivityName(win));
      });

      iframe.contentWindow.addEventListener('mousedown', () => {
        setActiveFloatingWindow(win, getFloatingWindowActivityName(win));

        if (!win.classList.contains('maximized')) {
          highestZIndex++;
          win.style.zIndex = highestZIndex;
        }
      });

      iframe.contentWindow.addEventListener('touchstart', () => {
        setActiveFloatingWindow(win, getFloatingWindowActivityName(win));

        if (!win.classList.contains('maximized')) {
          highestZIndex++;
          win.style.zIndex = highestZIndex;
        }
      });
    } catch (e) {
      // Cross-origin frames may not allow direct event injection. The parent
      // window's blur/document.activeElement path still handles normal iframe focus.
      if (!win.__activityNameOverride && activeWindowState && activeWindowState.id === win.id) {
        setActiveFloatingWindow(win, getFloatingWindowActivityName(win));
      }
    }
  });

  makeWindowDraggableAndResizable(win);

  let isMaximized = false;
  let savedStyle = { top: '', left: '', width: '', height: '', right: '', bottom: '', transform: '' };

  function toggleMaximize() {
    if (!isMaximized) {
      savedStyle.top = win.style.top;
      savedStyle.left = win.style.left;
      savedStyle.width = win.style.width;
      savedStyle.height = win.style.height;
      savedStyle.right = win.style.right;
      savedStyle.bottom = win.style.bottom;
      savedStyle.transform = win.style.transform;

      win.classList.add('maximized');
      isMaximized = true;
      if (maxBtn) maxBtn.setAttribute('aria-label', 'Restore');
    } else {
      win.classList.remove('maximized');
      win.style.top = savedStyle.top;
      win.style.left = savedStyle.left;
      win.style.width = savedStyle.width;
      win.style.height = savedStyle.height;
      win.style.right = savedStyle.right;
      win.style.bottom = savedStyle.bottom;
      win.style.transform = savedStyle.transform;

      isMaximized = false;
      if (maxBtn) maxBtn.setAttribute('aria-label', 'Maximize');
    }
    updateCRTState();
  }

  // --- TERMINATION AND RELOAD LOGIC ---
  function terminateIframe() {
    if (!keepAlive) {
      iframe.src = 'about:blank'; // Forcefully destroys page memory and audio
    }
  }

  function restoreIframe() {
    if (!keepAlive && iframe.src.includes('about:blank')) {
      iframe.src = targetSrc;
    }
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      iframe.src = 'about:blank'; // Terminate
      setTimeout(() => { iframe.src = targetSrc; }, 50); // Relaunch immediately after GC
    });
  }

  if (maxBtn) {
    maxBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMaximize();
    });
  }

  let triggerBtn = null;
  if (options.triggerBtnId) {
    triggerBtn = document.getElementById(options.triggerBtnId);
  }

  function updateBtnState() {
    if (triggerBtn) {
      const isVisible = !win.hidden && !win.classList.contains('minimized');
      triggerBtn.classList.toggle('active', isVisible);
    }
  }

  function openWin() {
    restoreIframe(); // Boots the app if it was closed previously
    win.hidden = false;
    win.classList.remove('minimized');
    highestZIndex++;
    win.style.zIndex = highestZIndex;
    setActiveFloatingWindow(win, getFloatingWindowActivityName(win));
    updateBtnState();
    updateCRTState();
  }

  function closeWin() {
    win.hidden = true;
    win.classList.remove('minimized');
    terminateIframe(); // Kills audio and resources, unless keepAlive is true

    if (activeWindowState && activeWindowState.id === win.id) {
      clearActiveFloatingWindow(win);
    } else {
      sendActivityStateToChat();
    }

    updateBtnState();
    updateCRTState();
  }

  function minimizeWin() {
    // Minimize simply hides the window, leaving it running (useful for Paint or similar)
    win.classList.add('minimized');
    win.hidden = true;

    if (activeWindowState && activeWindowState.id === win.id) {
      clearActiveFloatingWindow(win);
    } else {
      sendActivityStateToChat();
    }

    updateBtnState();
    updateCRTState();
  }

  function toggleWin() {
    if (win.hidden || win.classList.contains('minimized')) {
      openWin();
    } else {
      const currentZ = parseInt(win.style.zIndex || "0", 10) || 0;

      if (currentZ < highestZIndex) {
        highestZIndex++;
        win.style.zIndex = highestZIndex;
        setActiveFloatingWindow(win, getFloatingWindowActivityName(win));
      } else {
        minimizeWin();
      }
    }
  }

  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeWin();
  });

  if (triggerBtn) {
    triggerBtn.addEventListener('click', toggleWin);
  }

  return { win, iframe, open: openWin, close: closeWin, minimize: minimizeWin, toggle: toggleWin, toggleMaximize: toggleMaximize };
}

// ===== UNIVERSAL GAME WINDOW LAUNCHER =====
const activeGameWindows = {};

function openGameWindow(url, title) {
  if (activeGameWindows[url]) {
    activeGameWindows[url].open();
  } else {
    const slug = url.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    const winObj = createAppletWindow(url, {
      id: 'game-win-' + slug,
      title: title,
      className: 'arcade-window',
      activityKind: 'game',
      isRootPath: true,
      keepAlive: false // Games will terminate when closed to stop audio
    });
    activeGameWindows[url] = winObj;
    winObj.open();
  }
}

function setupGameLaunchers() {
  document.addEventListener('click', (e) => {
    const playBtn = e.target.closest('.play-btn');
    if (playBtn) {
      e.preventDefault();
      const url = playBtn.getAttribute('href');
      if (!url) return;
      const card = playBtn.closest('.project-card, .featured-card');
      const title = card && card.querySelector('h3') ? card.querySelector('h3').textContent.trim() : 'Game';
      openGameWindow(url, title);
    }

    const classicItem = e.target.closest('.classic-item');
    if (classicItem) {
      e.preventDefault();
      const url = classicItem.getAttribute('href');
      if (!url) return;
      const title = classicItem.querySelector('h3') ? classicItem.querySelector('h3').textContent.trim() : 'Classic Game';
      openGameWindow(url, title);
    }
  });
}

// ===== TASKBAR & APPLETS INITIALIZATION =====
function setupAppletsAndFloatingWindows() {
  createAppletWindow('games.html', {
    id: 'arcade-window',
    iframeId: 'arcade-frame',
    className: 'arcade-window',
    activityKind: 'arcade',
    triggerBtnId: 'arcade-launcher-btn',
    isRootPath: true,
    title: 'Arcade Hub',
    keepAlive: false // Arcade hub can be terminated and reloaded safely
  });

  createAppletWindow('chatroom.html', {
    id: 'chat-window',
    iframeId: 'chat-frame',
    className: 'chat-window',
    activityKind: 'chatroom',
    triggerBtnId: 'chat-launcher-btn',
    icon: 'images/icons/chatroom.png',
    title: 'Chatroom',
    keepAlive: true // CRITICAL: Exempts chat from termination so it receives pings while closed
  });

  createAppletWindow('paint.html', {
    id: 'paint-window',
    iframeId: 'paint-frame',
    triggerBtnId: 'taskbar-paint-btn',
    icon: 'images/icons/paint.png',
    keepAlive: false
  });

  createAppletWindow('weather.html', {
    id: 'weather-window',
    iframeId: 'weather-frame',
    triggerBtnId: 'taskbar-weather-btn',
    icon: 'images/icons/weather.png',
    keepAlive: false
  });

  createAppletWindow('notes.html', {
    id: 'notes-window',
    iframeId: 'notes-frame',
    triggerBtnId: 'taskbar-notes-btn',
    icon: 'images/icons/notes.png',
    keepAlive: false
  });

  createAppletWindow('calculator.html', {
    id: 'calculator-window',
    iframeId: 'calculator-frame',
    triggerBtnId: 'taskbar-calculator-btn',
    icon: 'images/icons/calculator.png',
    keepAlive: false
  });

  createAppletWindow('clock.html', {
    id: 'clock-window',
    iframeId: 'clock-frame',
    triggerBtnId: 'taskbar-clock-btn',
    icon: 'images/icons/clock.png',
    keepAlive: false
  });
}

// ===== START MENU =====
function setupStartMenu() {
  const startBtn = document.getElementById('taskbar-start-btn');
  const startMenu = document.getElementById('start-menu');
  
  if (!startBtn || !startMenu) return;

  startBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = window.getComputedStyle(startMenu).display === 'none';
    startMenu.style.display = isHidden ? 'flex' : 'none';
  });

  document.addEventListener('click', (e) => {
    if (!startMenu.contains(e.target) && e.target !== startBtn) {
      startMenu.style.display = 'none';
    }
  });

  startMenu.querySelectorAll('.start-item').forEach(item => {
    item.addEventListener('click', () => {
      startMenu.style.display = 'none';
    });
  });
}

// ===== VISITOR COUNTER =====
function setupVisitorCounter() {
  try {
    const KEY = 'colton-launcher-visits';
    const SESSION_KEY = 'colton-launcher-session';
    const rawCount = localStorage.getItem(KEY);
    
    let count = (rawCount && !isNaN(rawCount)) ? parseInt(rawCount, 10) : 0;
    
    if (!sessionStorage.getItem(SESSION_KEY)) {
      count += 1;
      localStorage.setItem(KEY, count);
      sessionStorage.setItem(SESSION_KEY, '1');
    }
    
    const el = document.getElementById('visit-count');
    if (el) el.textContent = String(count).padStart(6, '0');
  } catch(e) {
    const el = document.getElementById('visit-count');
    if (el) el.textContent = '000001';
  }
}

// ===== CRT TOGGLE BUTTON FEATURE =====
function setupCRTToggle() {
  const crtToggleBtn = document.getElementById('crt-toggle-btn');
  if (!crtToggleBtn) return;

  if (safeGet('project-launcher-no-crt') === 'true') {
    document.documentElement.classList.add('no-crt');
  }

  crtToggleBtn.addEventListener('click', () => {
    const isNoCrt = document.documentElement.classList.toggle('no-crt');
    safeSet('project-launcher-no-crt', isNoCrt ? 'true' : 'false');
  });
}

// ===== LIVE DESKTOP TASKBAR CLOCK MOUNT =====
function updateTaskbarClock() {
  const now = new Date();
  
  const timeOptions = {
    timeZone: 'America/Chicago',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  };
  
  const dateOptions = {
    timeZone: 'America/Chicago',
    month: '2-digit',
    day: '2-digit',
    year: 'numeric'
  };

  const clockEl = document.getElementById('taskbar-clock');
  const dateEl = document.getElementById('taskbar-date');

  if (clockEl) clockEl.textContent = now.toLocaleTimeString('en-US', timeOptions);
  if (dateEl) dateEl.textContent = now.toLocaleDateString('en-US', dateOptions);
}

// ===== CHATROOM WIDGET =====
function setupChatWidget() {
  const launcherBtn = document.getElementById('chat-launcher-btn');
  const pendingDot = document.getElementById('chat-pending-dot');
  const chatWindow = document.getElementById('chat-window');
  const chatFrame = document.getElementById('chat-frame');
  const onlineCountEl = document.getElementById('online-count');

  if (!launcherBtn || !chatWindow || !chatFrame) return;

  function sendWindowStateToFrame(isOpen) {
    if (chatFrame && chatFrame.contentWindow) {
      chatFrame.contentWindow.postMessage({
        source: 'parent-shell',
        action: isOpen ? 'chatWindowOpened' : 'chatWindowClosed',
        activeWindow: activeWindowState ? { ...activeWindowState } : null,
        chatWindowOpen: isOpen,
        isHomepage: !isOpen && !activeWindowState
      }, '*');

      sendActivityStateToChat();
    }
  }

  function windowIsVisibleAndOpen() {
    return !chatWindow.hidden && !chatWindow.classList.contains('minimized');
  }

  function setPendingDot(show) {
    if (pendingDot) pendingDot.hidden = !show;
  }

  launcherBtn.addEventListener('click', () => {
    const isOpen = windowIsVisibleAndOpen();
    launcherBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    if (isOpen) setPendingDot(false);
    sendWindowStateToFrame(isOpen);
  });

  chatFrame.addEventListener('load', () => {
    sendWindowStateToFrame(windowIsVisibleAndOpen());
  });

  window.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.source !== 'universal-chat') return;

    if (data.kind === 'activityRequest') {
      sendActivityStateToChat();
      return;
    }

    if (data.kind === 'presence') {
      if (onlineCountEl) onlineCountEl.textContent = String(data.count);
    } else if (data.kind === 'unread') {
      if (!windowIsVisibleAndOpen()) {
        setPendingDot(true);
      }
    } else if (data.kind === 'ping') {
      showPingBanner(data.text);
    }
  });
}

let pingBannerHideTimer = null;

function hidePingBanner() {
  const banner = document.getElementById('ping-banner');
  if (!banner) return;
  banner.style.top = '-140px';
  clearTimeout(pingBannerHideTimer);
  pingBannerHideTimer = null;
}

function showPingBanner(text) {
  const banner = document.getElementById('ping-banner');
  const bannerText = document.getElementById('ping-banner-text');
  if (!banner || !bannerText) return;

  bannerText.textContent = text;
  banner.style.top = '10px';

  // Reset the auto-dismiss timer so a fresh ping always gets its own full 3s.
  clearTimeout(pingBannerHideTimer);
  pingBannerHideTimer = setTimeout(hidePingBanner, 3000);
}

function setupPingBannerDismiss() {
  const banner = document.getElementById('ping-banner');
  if (!banner) return;
  banner.addEventListener('click', hidePingBanner);
}

function setupToSModal() {
  const tosOverlay = document.getElementById("tos-modal-overlay");
  const acceptBtn = document.getElementById("tos-accept-btn");

  if (!tosOverlay || !acceptBtn) return;

  if (!safeGet("tosAccepted")) {
    tosOverlay.style.display = "flex";
    document.body.style.overflow = "hidden";
  }

  acceptBtn.addEventListener("click", () => {
    safeSet("tosAccepted", "true");
    tosOverlay.style.display = "none";
    document.body.style.overflow = "auto";
  });
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  renderSiteData();
  renderAnnouncements();
  renderClassics();
  renderStats();
  renderFeatured();
  renderProjects();
  setupWindowButtons();
  setupStartMenu();
  setupVisitorCounter();
  setupToSModal();
  setupCRTToggle();
  setupActivityMessaging();
  setupActiveWindowTracking();
  setupAppletsAndFloatingWindows();
  setupGameLaunchers();
  setupChatWidget();
  setupPingBannerDismiss();
  updateTaskbarClock();
  setInterval(updateTaskbarClock, 1000);
});

if (sortToggle) {
  sortToggle.addEventListener('click', () => {
    sortMode = sortMode === 'type' ? 'default' : 'type';
    safeSet(SORT_KEY, sortMode);
    renderProjects();
  });
}

if (searchInput) {
  searchInput.addEventListener('input', debounce(() => {
    searchTerm = searchInput.value;
    safeSet(SEARCH_KEY, searchTerm);
    renderProjects();
  }, 250));
}

if (statusFilter) {
  statusFilter.addEventListener('change', () => {
    statusValue = statusFilter.value;
    safeSet(STATUS_KEY, statusValue);
    renderProjects();
  });
}

/* ========================================================================== *
 * GHCORE DESKTOP EXTENSIONS
 * These additions intentionally live below the legacy launcher code so the
 * original project library keeps working while the shell gains OS-like tools.
 * ========================================================================== */
(function () {
  'use strict';

  const desktop = {
    windows: {},
    system: null,
    files: null,
    palette: null,
    notifications: null,
    notificationOpen: false,
    selectedCommand: 0,
    commands: [],
    favoritesOnly: false
  };
  window.GHDesktop = desktop;

  const q = (sel, root = document) => root.querySelector(sel);
  const qa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function addTaskbarButton(id, label, symbol, onClick) {
    const apps = document.getElementById('taskbar-apps');
    if (!apps || document.getElementById(id)) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'taskbar-app-btn gh-taskbar-tool';
    btn.id = id;
    btn.title = label;
    btn.innerHTML = `<span class="taskbar-app-icon" aria-hidden="true">${symbol}</span><span class="taskbar-app-label">${esc(label)}</span>`;
    btn.addEventListener('click', onClick);
    apps.appendChild(btn);
    return btn;
  }

  function createDesktopTools() {
    if (typeof createAppletWindow !== 'function') return;

    desktop.system = createAppletWindow('system.html', {
      id: 'system-center-window', iframeId: 'system-center-frame', title: 'System Center',
      className: 'system-window', activityKind: 'system', width: '760px', height: '560px'
    });
    desktop.files = createAppletWindow('files.html', {
      id: 'file-explorer-window', iframeId: 'file-explorer-frame', title: 'File Explorer',
      className: 'file-window', activityKind: 'files', width: '760px', height: '520px'
    });
    desktop.windows.system = desktop.system;
    desktop.windows.files = desktop.files;
    desktop.tools = createAppletWindow('tools.html', {
      id: 'developer-tools-window', iframeId: 'developer-tools-frame', title: 'Developer Toolbox',
      className: 'system-window', activityKind: 'tools', width: '760px', height: '560px'
    });
    desktop.terminal = createAppletWindow('terminal.html', {
      id: 'terminal-window', iframeId: 'terminal-frame', title: 'GH Terminal',
      className: 'terminal-window', activityKind: 'terminal', width: '680px', height: '450px'
    });
    desktop.windows.tools = desktop.tools;
    desktop.windows.terminal = desktop.terminal;

    addTaskbarButton('taskbar-files-btn', 'File Explorer', '▣', () => desktop.files.toggle());
    addTaskbarButton('taskbar-system-btn', 'System Center', '⚙', () => desktop.system.toggle());
    addTaskbarButton('taskbar-tools-btn', 'Developer Toolbox', '⌘', () => desktop.tools.toggle());
    addTaskbarButton('taskbar-terminal-btn', 'GH Terminal', '>_', () => desktop.terminal.toggle());
    addTaskbarButton('taskbar-search-btn', 'Search', '⌕', () => openCommandPalette());
    addTaskbarButton('taskbar-notify-btn', 'Notifications', '!', () => toggleNotificationCenter());

    const networkChip = document.createElement('div');
    networkChip.id = 'gh-network-chip';
    networkChip.className = 'gh-network-chip';
    networkChip.textContent = 'LOCAL';
    document.querySelector('.taskbar-status')?.prepend(networkChip);

    const badge = document.createElement('span');
    badge.className = 'gh-profile-badge';
    badge.id = 'gh-profile-badge';
    badge.textContent = 'Guest';
    const online = document.getElementById('online-count');
    online?.parentElement?.appendChild(badge);
  }

  function addStartExtras() {
    const menu = document.getElementById('start-menu');
    const items = menu?.querySelector('.start-menu-items');
    if (!items || items.querySelector('.gh-start-extra')) return;
    const divider = document.createElement('div');
    divider.className = 'gh-start-divider';
    items.appendChild(divider);
    const entries = [
      ['⌕ Search', openCommandPalette],
      ['▣ File Explorer', () => desktop.files?.open()],
      ['⚙ System Center', () => desktop.system?.open()],
      ['⌘ Developer Toolbox', () => desktop.tools?.open()],
      ['>_ GH Terminal', () => desktop.terminal?.open()],
      ['! Notifications', () => toggleNotificationCenter()]
    ];
    entries.forEach(([label, action]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'start-item gh-start-extra'; b.textContent = label;
      b.addEventListener('click', () => { menu.style.display = 'none'; action(); });
      items.appendChild(b);
    });
  }

  function createOverlays() {
    if (!document.getElementById('gh-command-backdrop')) {
      const bd = document.createElement('div'); bd.id = 'gh-command-backdrop'; bd.className = 'gh-command-backdrop'; bd.hidden = true;
      bd.addEventListener('click', closeCommandPalette); document.body.appendChild(bd);
    }
    if (!document.getElementById('gh-command-palette')) {
      const el = document.createElement('div'); el.id = 'gh-command-palette'; el.className = 'gh-command-palette'; el.hidden = true;
      el.innerHTML = `<input class="gh-command-input" id="gh-command-input" type="search" placeholder="Search apps, games, settings, commands..." autocomplete="off"><div class="gh-command-results" id="gh-command-results"></div>`;
      document.body.appendChild(el); desktop.palette = el;
      q('#gh-command-input', el).addEventListener('input', renderCommands);
      q('#gh-command-input', el).addEventListener('keydown', commandKeydown);
    }
    if (!document.getElementById('gh-notification-center')) {
      const el = document.createElement('div'); el.id = 'gh-notification-center'; el.className = 'gh-notification-center'; el.hidden = true;
      document.body.appendChild(el); desktop.notifications = el;
    }
  }

  function showToast(title, body) {
    const toast = document.createElement('div'); toast.className = 'gh-toast';
    toast.innerHTML = `<div class="gh-toast-head">${esc(title)}</div><div class="gh-toast-body">${esc(body)}</div>`;
    document.body.appendChild(toast);
    setTimeout(() => { toast.classList.add('hide'); setTimeout(() => toast.remove(), 200); }, 4200);
  }

  async function renderNotificationCenter() {
    if (!desktop.notifications || !window.GHCore) return;
    const list = await GHCore.getNotifications();
    desktop.notifications.innerHTML = `<div class="gh-notification-title"><span>NOTIFICATIONS</span><button type="button" id="gh-mark-read">Mark all read</button></div><div class="gh-notification-list"></div>`;
    const holder = q('.gh-notification-list', desktop.notifications);
    if (!list.length) {
      holder.innerHTML = '<div class="gh-notification-empty">No notifications.</div>';
    } else {
      list.forEach(n => {
        const item = document.createElement('div'); item.className = 'gh-notification-item' + (n.read ? '' : ' unread');
        item.innerHTML = `<h4>${esc(n.title)}</h4><div>${esc(n.body)}</div><small>${new Date(n.at).toLocaleString()}</small>`;
        holder.appendChild(item);
      });
    }
    q('#gh-mark-read', desktop.notifications)?.addEventListener('click', async () => {
      await GHCore.markNotificationsRead(); await renderNotificationCenter(); updateNotificationBadge();
    });
  }

  async function updateNotificationBadge() {
    const list = window.GHCore ? await GHCore.getNotifications() : [];
    const unread = list.filter(n => !n.read).length;
    const btn = document.getElementById('taskbar-notify-btn');
    if (!btn) return;
    let badge = btn.querySelector('.gh-unread-badge');
    if (unread) {
      if (!badge) { badge = document.createElement('span'); badge.className = 'gh-unread-badge'; btn.style.position = 'relative'; btn.appendChild(badge); }
      badge.textContent = unread > 9 ? '9+' : String(unread);
    } else if (badge) badge.remove();
  }

  async function toggleNotificationCenter() {
    if (!desktop.notifications) return;
    desktop.notificationOpen = !desktop.notificationOpen;
    desktop.notifications.hidden = !desktop.notificationOpen;
    if (desktop.notificationOpen) {
      await renderNotificationCenter();
      await GHCore.markNotificationsRead();
      await updateNotificationBadge();
    }
  }

  function buildCommands() {
    const commands = [
      { label: 'File Explorer', meta: 'Open local file cabinet', run: () => desktop.files?.open() },
      { label: 'System Center', meta: 'Profile, settings, storage, achievements, diagnostics', run: () => desktop.system?.open() },
      { label: 'Developer Toolbox', meta: 'JSON, Base64, UUID, time, units, color', run: () => desktop.tools?.open() },
      { label: 'GH Terminal', meta: 'Local launcher command shell', run: () => desktop.terminal?.open() },
      { label: 'Arcade Hub', meta: 'Browse the full game directory', run: () => document.getElementById('arcade-launcher-btn')?.click() },
      { label: 'Chatroom', meta: 'Open universal MQTT chat', run: () => document.getElementById('chat-launcher-btn')?.click() },
      { label: 'Notes', meta: 'Open Notes', run: () => document.getElementById('taskbar-notes-btn')?.click() },
      { label: 'Paint', meta: 'Open MS Paint', run: () => document.getElementById('taskbar-paint-btn')?.click() },
      { label: 'Weather', meta: 'Open weather report', run: () => document.getElementById('taskbar-weather-btn')?.click() },
      { label: 'Calculator', meta: 'Open scientific calculator', run: () => document.getElementById('taskbar-calculator-btn')?.click() },
      { label: 'Clock', meta: 'Open clock/stopwatch/timer', run: () => document.getElementById('taskbar-clock-btn')?.click() },
      { label: 'Show Desktop', meta: 'Minimize all floating windows', run: showDesktop },
      { label: 'Restore Windows', meta: 'Restore minimized floating windows', run: restoreWindows },
      { label: 'Toggle CRT Effects', meta: 'Enable/disable the display effect', run: toggleCRTShell },
      { label: 'Toggle Reduced Motion', meta: 'Disable site animations', run: toggleReducedMotion },
      { label: 'Export Full Backup', meta: 'Export local profile, settings, files, saves, and achievements', run: exportBackup },
      { label: 'Install Launcher', meta: 'Install the Project Launcher as a PWA', run: installPWA },
      { label: 'Random Game', meta: 'Launch a random project', run: randomGame }
    ];
    projects.forEach(p => commands.push({ label: `Game: ${p.title}`, meta: `${p.type} · ${getStatusMeta(p.statusKey).label}`, run: () => openGameWindow(p.url, p.title) }));
    classics.forEach(c => commands.push({ label: `Classic: ${c.title}`, meta: 'Classic game', run: () => openGameWindow(c.url, c.title) }));
    desktop.commands = commands;
  }

  function renderCommands() {
    const input = q('#gh-command-input'); const holder = q('#gh-command-results');
    if (!input || !holder) return;
    const term = input.value.trim().toLowerCase();
    const items = desktop.commands.filter(c => !term || `${c.label} ${c.meta}`.toLowerCase().includes(term)).slice(0, 30);
    desktop.selectedCommand = Math.min(desktop.selectedCommand, Math.max(0, items.length - 1));
    holder.innerHTML = '';
    items.forEach((item, index) => {
      const el = document.createElement('div'); el.className = 'gh-command-result' + (index === desktop.selectedCommand ? ' selected' : '');
      el.innerHTML = `<span>${esc(item.label)}</span><small>${esc(item.meta)}</small>`;
      el.addEventListener('mouseenter', () => { desktop.selectedCommand = index; renderCommands(); });
      el.addEventListener('click', () => { closeCommandPalette(); item.run(); });
      holder.appendChild(el);
    });
    if (!items.length) holder.innerHTML = '<div class="gh-command-result">No results.</div>';
  }

  function openCommandPalette() {
    createOverlays(); buildCommands();
    const bd = document.getElementById('gh-command-backdrop');
    const palette = document.getElementById('gh-command-palette');
    bd.hidden = false; palette.hidden = false;
    desktop.selectedCommand = 0;
    const input = document.getElementById('gh-command-input'); input.value = '';
    renderCommands(); setTimeout(() => input.focus(), 0);
  }

  function closeCommandPalette() {
    const bd = document.getElementById('gh-command-backdrop'); const palette = document.getElementById('gh-command-palette');
    if (bd) bd.hidden = true; if (palette) palette.hidden = true;
  }

  function commandKeydown(e) {
    const results = qa('.gh-command-result', document.getElementById('gh-command-results'));
    if (e.key === 'ArrowDown') { e.preventDefault(); desktop.selectedCommand = Math.min(desktop.selectedCommand + 1, results.length - 1); renderCommands(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); desktop.selectedCommand = Math.max(desktop.selectedCommand - 1, 0); renderCommands(); }
    else if (e.key === 'Enter') { e.preventDefault(); results[desktop.selectedCommand]?.click(); }
    else if (e.key === 'Escape') closeCommandPalette();
  }

  function showDesktop() { qa('.floating-window').forEach(win => { if (!win.hidden && !win.classList.contains('minimized')) win.classList.add('minimized'), win.hidden = true; }); }
  function restoreWindows() { qa('.floating-window').forEach(win => { if (win.classList.contains('minimized')) { win.hidden = false; win.classList.remove('minimized'); highestZIndex++; win.style.zIndex = highestZIndex; } }); }

  async function toggleCRTShell() {
    const noCrt = document.documentElement.classList.toggle('no-crt');
    if (window.GHCore) await GHCore.setSettings({ crt: !noCrt });
  }
  async function toggleReducedMotion() {
    const reduced = document.documentElement.classList.toggle('gh-reduced-motion');
    if (window.GHCore) await GHCore.setSettings({ reducedMotion: reduced });
  }

  async function applyGHTheme() {
    if (!window.GHCore) return;
    const s = await GHCore.getSettings();
    Array.from(document.documentElement.classList).filter(c => c.startsWith('gh-theme-')).forEach(c => document.documentElement.classList.remove(c));
    document.documentElement.classList.add(`gh-theme-${s.theme || 'classic'}`);
    document.documentElement.classList.toggle('gh-reduced-motion', !!s.reducedMotion);
    document.documentElement.classList.toggle('gh-performance', !!s.performanceMode);
    document.documentElement.classList.toggle('no-crt', s.crt === false);
    const badge = document.getElementById('gh-profile-badge');
    const p = await GHCore.getProfile();
    if (badge) badge.textContent = p.username || 'Guest';
    updateClockFormat(s.clock24Hour);
  }
  window.applyGHTheme = applyGHTheme;

  function updateClockFormat(twentyFour) {
    const clockEl = document.getElementById('taskbar-clock'); const dateEl = document.getElementById('taskbar-date');
    if (!clockEl || !dateEl) return;
    const tick = () => {
      const now = new Date();
      clockEl.textContent = now.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hour12: !twentyFour });
      dateEl.textContent = now.toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: '2-digit', day: '2-digit', year: 'numeric' });
    };
    tick(); clearInterval(window.__ghClockTimer); window.__ghClockTimer = setInterval(tick, 1000);
  }

  async function exportBackup() {
    if (!window.GHCore) return;
    const blob = await GHCore.exportBackup();
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'colton-launcher-backup.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  let installPrompt = null;
  async function installPWA() {
    if (!installPrompt) { showToast('Install Launcher', 'Your browser did not provide an install prompt. Use its page menu and choose Add to Dock/Home Screen.'); return; }
    installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null;
  }

  function randomGame() {
    const list = projects.concat(classics); const pick = list[Math.floor(Math.random() * list.length)];
    if (pick) openGameWindow(pick.url, pick.title);
  }

  function setupContextMenu() {
    if (document.getElementById('gh-context-menu')) return;
    const menu = document.createElement('div'); menu.id = 'gh-context-menu'; menu.className = 'gh-context-menu'; menu.hidden = true;
    const entries = [
      ['Search...', openCommandPalette],
      ['Show Desktop', showDesktop],
      ['Restore Windows', restoreWindows],
      ['File Explorer', () => desktop.files?.open()],
      ['System Center', () => desktop.system?.open()],
      ['Refresh Desktop', () => location.reload()]
    ];
    entries.forEach(([text, fn]) => { const b=document.createElement('button'); b.type='button'; b.textContent=text; b.onclick=()=>{menu.hidden=true;fn();}; menu.appendChild(b); });
    document.body.appendChild(menu);
    document.addEventListener('contextmenu', e => {
      if (e.target.closest('input,textarea,select,iframe,.floating-window,.chat-launcher-btn')) return;
      e.preventDefault(); menu.hidden=false;
      const x=Math.min(e.clientX,innerWidth-228), y=Math.min(e.clientY,innerHeight-220); menu.style.left=x+'px';menu.style.top=y+'px';
    });
    document.addEventListener('click', e => { if(!menu.contains(e.target)) menu.hidden=true; });
  }

  function setupKeyboardShortcuts() {
    const konami = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a']; let pos=0;
    document.addEventListener('keydown', e => {
      const target = e.target; const typing = target && /INPUT|TEXTAREA|SELECT/.test(target.tagName);
      if (e.key === 'F2' && !typing) { e.preventDefault(); openCommandPalette(); return; }
      if ((e.ctrlKey || e.metaKey) && e.code === 'Space') { e.preventDefault(); openCommandPalette(); return; }
      if (e.key === 'Escape') { closeCommandPalette(); }
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (key === konami[pos]) pos++; else pos = key === konami[0] ? 1 : 0;
      if (pos === konami.length) { pos=0; GHCore?.unlock('konami'); showToast('Secret Found', 'You entered the code.'); document.documentElement.classList.add('gh-konomi-flash'); setTimeout(()=>document.documentElement.classList.remove('gh-konomi-flash'),600); }
      if (!typing && e.key === 'Escape') document.querySelectorAll('.gh-context-menu').forEach(x=>x.hidden=true);
    });
  }

  function markFavorites() {
    if (!window.GHCore) return;
    const add = (card, item) => {
      if (!card || card.querySelector('.favorite-btn')) return;
      const actions = card.querySelector('.card-actions') || card.querySelector('.featured-content'); if (!actions) return;
      const b = document.createElement('button'); b.type='button'; b.className='favorite-btn'; b.textContent='☆'; b.title='Favorite'; b.style.marginLeft='6px'; b.style.padding='6px 10px';
      b.addEventListener('click', async e => { e.preventDefault(); e.stopPropagation(); const fav=await GHCore.toggleFavorite(item); b.textContent=fav?'★':'☆'; b.title=fav?'Unfavorite':'Favorite'; });
      GHCore.isFavorite(item.url).then(f=>{b.textContent=f?'★':'☆';b.title=f?'Unfavorite':'Favorite';});
      actions.appendChild(b);
    };
    qa('.project-card').forEach(card => { const title=q('h3',card)?.textContent.trim(); const item=projects.find(p=>p.title===title); add(card,item); });
    const featured=q('#featured-card'); if(featured){ const title=q('h3',featured)?.textContent.trim(); const item=projects.find(p=>p.title===title); add(featured,item); }
  }

  async function recordLaunches() {
    document.addEventListener('click', async e => {
      const play=e.target.closest('.play-btn'); const classic=e.target.closest('.classic-item'); const task=e.target.closest('.taskbar-app-btn');
      if (play) { const card=play.closest('.project-card,.featured-card'); const title=q('h3',card)?.textContent.trim()||'Game'; await GHCore.recordLaunch({id:play.getAttribute('href'),url:play.getAttribute('href'),title,type:'game'}); }
      else if(classic){ const title=q('h3',classic)?.textContent.trim()||'Classic'; await GHCore.recordLaunch({id:classic.getAttribute('href'),url:classic.getAttribute('href'),title,type:'classic'}); }
      else if(task){ const label=task.getAttribute('title')||task.textContent.trim(); if(!['Search','Notifications','File Explorer','System Center'].includes(label)) await GHCore.recordLaunch({id:task.id,title:label,type:'app'}); }
    }, true);
  }

  function addProjectInfoButtons() {
    const helper = document.getElementById('project-helper'); if (!helper || helper.parentElement.querySelector('#gh-library-tools')) return;
    const bar=document.createElement('div');bar.id='gh-library-tools';bar.style.cssText='display:flex;gap:5px;align-items:center;flex-wrap:wrap;margin-top:6px';
    const buttons=[['★ Favorites',async()=>{desktop.favoritesOnly=!desktop.favoritesOnly;const b=bar.querySelector('[data-favs]');if(b)b.textContent=desktop.favoritesOnly?'★ Showing Favorites':'★ Favorites';applyFavoritesOnly();}],['🎲 Random Game',randomGame],['⌕ Search (F2)',openCommandPalette]];
    buttons.forEach(([label,fn],i)=>{const b=document.createElement('button');b.type='button';b.className='sort-btn';b.textContent=label;if(i===0)b.dataset.favs='1';b.addEventListener('click',fn);bar.appendChild(b);}); helper.parentElement.appendChild(bar);
  }

  async function updateStatsFooter() {
    const stats=await GHCore.getStats(); const el=document.createElement('div'); el.className='gh-profile-badge'; el.textContent=`Launches: ${stats.launches} · Apps: ${(stats.uniqueLaunches||[]).length}`;
    const footer=document.querySelector('footer'); if(footer && !footer.querySelector('.gh-stats-footer')){el.classList.add('gh-stats-footer');footer.appendChild(el);}
  }

  async function createLauncherDashboard() {
    if (document.getElementById('gh-dashboard') || !window.GHCore) return;
    const hero = document.getElementById('hero-title-anchor');
    const main = document.querySelector('main');
    if (!hero || !main) return;
    const profile = await GHCore.getProfile();
    const stats = await GHCore.getStats();
    const recent = await GHCore.getRecent();
    const favorites = await GHCore.getFavorites();
    const achievements = await GHCore.getAchievements();
    const panel = document.createElement('section');
    panel.id='gh-dashboard'; panel.className='panel';
    panel.innerHTML=`<div class="panel-title-bar"><span>LOCAL DASHBOARD</span><span class="win-btns"><button type="button" class="win-btn" id="gh-dashboard-refresh" aria-label="Refresh dashboard">↻</button></span></div><div class="panel-body"><div class="gh-dashboard-grid"><div class="gh-dash-stat"><b id="dash-user">${esc(profile.username)}</b><span>${esc(profile.title||'New User')}</span></div><div class="gh-dash-stat"><b id="dash-launches">${stats.launches}</b><span>Launches</span></div><div class="gh-dash-stat"><b id="dash-favorites">${favorites.length}</b><span>Favorites</span></div><div class="gh-dash-stat"><b id="dash-achievements">${Object.keys(achievements).length}/${Object.keys(GHCore.achievementDefs).length}</b><span>Achievements</span></div></div><div class="gh-dashboard-columns"><div><b>RECENT ACTIVITY</b><div id="gh-recent-list"></div></div><div><b>QUICK ACTIONS</b><div class="gh-quick-actions"><button type="button" data-q="search">Search</button><button type="button" data-q="random">Random Game</button><button type="button" data-q="files">Files</button><button type="button" data-q="system">System Center</button></div><div class="gh-dashboard-note">Local profile and launcher data are stored in your browser.</div></div></div></div>`;
    hero.after(panel);
    const renderRecent=()=>{const holder=document.getElementById('gh-recent-list');if(!holder)return;holder.innerHTML='';if(!recent.length){holder.innerHTML='<div class="gh-dashboard-note">Nothing launched yet.</div>';return;}recent.slice(0,6).forEach(item=>{const b=document.createElement('button');b.type='button';b.className='gh-recent-item';b.innerHTML=`<span>${esc(item.title)}</span><small>${new Date(item.at).toLocaleString()}</small>`;b.onclick=()=>{if(item.url)openGameWindow(item.url,item.title);else if(item.id&&document.getElementById(item.id))document.getElementById(item.id).click();};holder.appendChild(b);});};
    renderRecent();
    panel.querySelector('#gh-dashboard-refresh').onclick=()=>location.reload();
    panel.querySelectorAll('[data-q]').forEach(b=>b.onclick=()=>{const qv=b.dataset.q;if(qv==='search')openCommandPalette();else if(qv==='random')randomGame();else if(qv==='files')desktop.files?.open();else desktop.system?.open();});
    GHCore.events.addEventListener('launch:recorded',async()=>{const s=await GHCore.getStats();const f=await GHCore.getFavorites();const a=await GHCore.getAchievements();document.getElementById('dash-launches')?.replaceChildren(document.createTextNode(s.launches));document.getElementById('dash-favorites')?.replaceChildren(document.createTextNode(f.length));document.getElementById('dash-achievements')?.replaceChildren(document.createTextNode(`${Object.keys(a).length}/${Object.keys(GHCore.achievementDefs).length}`));});
    GHCore.events.addEventListener('profile:changed',e=>{const u=e.detail?.profile?.username||'Guest';document.getElementById('dash-user')?.replaceChildren(document.createTextNode(u));});
  }

  async function applyFavoritesOnly() {
    if (!window.GHCore) return;
    const cards=qa('#project-grid .project-card');
    const favs=new Set(await GHCore.getFavorites());
    cards.forEach(card=>{const p=projects.find(x=>x.title===q('h3',card)?.textContent.trim());card.style.display=desktop.favoritesOnly && p ? (favs.has(p.url)?'':'none') : '';});
    const helper=document.getElementById('project-helper');
    if(helper && desktop.favoritesOnly) helper.textContent=`Favorites only · ${cards.filter(c=>c.style.display!=='none').length} shown.`;
  }

  function setupLibraryObserver() {
    const grid=document.getElementById('project-grid'); if(!grid || grid.__ghObserver) return;
    const obs=new MutationObserver(()=>{markFavorites();if(desktop.favoritesOnly)applyFavoritesOnly();}); obs.observe(grid,{childList:true,subtree:true}); grid.__ghObserver=obs;
  }

  function setupOfflineIndicator() {
    const chip=document.getElementById('gh-network-chip');
    const update=()=>{if(!chip)return;chip.textContent=navigator.onLine?'NET':'OFFLINE';chip.title=navigator.onLine?'Browser reports an online connection.':'Browser reports no network connection. Local apps remain available.';};
    window.addEventListener('online',update);window.addEventListener('offline',update);update();
  }

  function setupPWA() {
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt=e; GHCore?.pushNotification({title:'Install Available',body:'The Project Launcher can be installed as an app.',kind:'system'}); });
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }

  async function initEnhancements() {
    try { await GHCore.boot(); } catch (err) { console.warn('[GHCore]', err); return; }
    createOverlays(); createDesktopTools(); addStartExtras(); setupContextMenu(); setupKeyboardShortcuts(); await applyGHTheme(); buildCommands(); markFavorites(); addProjectInfoButtons(); setupLibraryObserver(); recordLaunches(); setupOfflineIndicator(); await createLauncherDashboard(); setupPWA(); await updateNotificationBadge(); await updateStatsFooter();

    GHCore.events.addEventListener('notification:new', async e => { const n=e.detail?.notification; if(n) showToast(n.title,n.body); await updateNotificationBadge(); if(desktop.notificationOpen) renderNotificationCenter(); });
    GHCore.events.addEventListener('profile:changed', applyGHTheme);
    GHCore.events.addEventListener('favorite:changed', applyFavoritesOnly);
    GHCore.events.addEventListener('settings:changed', applyGHTheme);
    GHCore.events.addEventListener('achievement:unlocked', async e => { await updateNotificationBadge(); });
    GHCore.events.addEventListener('launch:recorded', async () => { await updateStatsFooter(); });
    GHCore.events.addEventListener('reset:complete', () => location.reload());


    const seenVersionKey='gh-last-seen-version'; const previous=await GHCore.store.get(seenVersionKey);
    if(previous && previous!==siteData.version){ await GHCore.pushNotification({title:'What\'s New',body:`Launcher updated from ${previous} to ${siteData.version}. Check Announcements for changes.`}); }
    await GHCore.store.set(seenVersionKey,siteData.version);

    document.addEventListener('click', () => { markFavorites(); }, {capture:false});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initEnhancements, { once: true });
  else initEnhancements();
})();
