/**
 * Homework Dashboard Application Logic
 * Minimal, Calm, Elegant School Productivity Interface
 */

(function () {
  'use strict';

  // State Management
  const state = {
    cookies: localStorage.getItem('cookies') || '',
    customUrl: localStorage.getItem('customUrl') || '',
    homework: JSON.parse(localStorage.getItem('cachedHomework') || '[]'),
    lastUpdated: localStorage.getItem('lastUpdated') || null,
    activeView: localStorage.getItem('activeView') || 'today',
    theme: localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
    searchQuery: '',
    selectedDateFilter: '',
    isLoading: false,
    errorMessage: null,
    sessionStatus: 'disconnected' // 'connected' | 'expired' | 'disconnected'
  };

  // DOM Element References
  const elements = {
    app: document.getElementById('app'),
    homeworkList: document.getElementById('homeworkList'),
    pageTitle: document.getElementById('pageTitle'),
    pageDate: document.getElementById('pageDate'),
    statsBar: document.getElementById('statsBar'),
    totalAssignments: document.getElementById('totalAssignments'),
    totalAttachments: document.getElementById('totalAttachments'),
    lastUpdatedTime: document.getElementById('lastUpdatedTime'),
    searchInput: document.getElementById('searchInput'),
    dateFilterInput: document.getElementById('dateFilterInput'),
    dateClearBtn: document.getElementById('dateClearBtn'),
    statusDot: document.getElementById('statusDot'),
    statusText: document.getElementById('statusText'),
    themeToggleBtn: document.getElementById('themeToggleBtn'),
    refreshBtn: document.getElementById('refreshBtn'),
    settingsBtn: document.getElementById('settingsBtn'),
    settingsModal: document.getElementById('settingsModal'),
    modalCloseBtn: document.getElementById('modalCloseBtn'),
    cookieFormInput: document.getElementById('cookieFormInput'),
    customUrlFormInput: document.getElementById('customUrlFormInput'),
    saveCookieBtn: document.getElementById('saveCookieBtn'),
    clearCookieBtn: document.getElementById('clearCookieBtn'),
    navItems: document.querySelectorAll('[data-view]'),
    mobileNavItems: document.querySelectorAll('.mobile-nav-item[data-view]'),
    errorBanner: document.getElementById('errorBanner'),
    errorMessageText: document.getElementById('errorMessageText'),
    errorRetryBtn: document.getElementById('errorRetryBtn')
  };

  // Canonical Subject Mappings & CSS Classes
  const SUBJECT_RULES = [
    { keys: ['MATH', 'MATHEMATICS', 'MATHS', 'ALGEBRA', 'GEOMETRY', 'गणित'], name: 'Mathematics', class: 'sub-math' },
    { keys: ['SCIENCE', 'PHYSICS', 'CHEMISTRY', 'BIOLOGY', 'EVS', 'SCI', 'विज्ञान'], name: 'Science', class: 'sub-science' },
    { keys: ['ENGLISH', 'ENG', 'LITERATURE', 'GRAMMAR', 'अंग्रेजी'], name: 'English', class: 'sub-english' },
    { keys: ['HINDI', 'कक्षा कार्य', 'गृह कार्य', 'हिंदी'], name: 'Hindi', class: 'sub-hindi' },
    { keys: ['COMPUTERS', 'COMPUTER', 'IT', 'CODING', 'COMP', 'कंप्यूटर'], name: 'Computers', class: 'sub-comp' },
    { keys: ['S.ST', 'SOCIAL', 'HISTORY', 'CIVICS', 'GEOGRAPHY', 'SST', 'सामाजिक'], name: 'Social Studies', class: 'sub-sst' },
    { keys: ['PUNJABI', 'पंजाबी'], name: 'Punjabi', class: 'sub-hindi' },
    { keys: ['G.K', 'GK', 'GENERAL KNOWLEDGE'], name: 'General Knowledge', class: 'sub-default' },
    { keys: ['ART', 'DRAWING', 'CRAFT'], name: 'Art', class: 'sub-default' }
  ];

  /* --------------------------------------------------------------------------
     1. Initialization
     -------------------------------------------------------------------------- */
  function init() {
    applyTheme(state.theme);
    updateSessionStatus();
    renderHeaderDate();
    setupEventListeners();
    setupKeyboardShortcuts();

    sortHomeworkByDate();

    if (state.cookies && state.homework.length === 0) {
      fetchHomework();
    } else {
      render();
    }
  }

  /* --------------------------------------------------------------------------
     2. Robust Multi-Format Date Parser
     -------------------------------------------------------------------------- */
  function parseHomeworkDate(dateStr) {
    if (!dateStr) return null;
    const str = String(dateStr).trim();

    let parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }

    const dmyMatch = str.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
    if (dmyMatch) {
      const day = parseInt(dmyMatch[1], 10);
      const month = parseInt(dmyMatch[2], 10) - 1;
      const year = parseInt(dmyMatch[3], 10);
      parsed = new Date(year, month, day);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    }

    const dMmmYMatch = str.match(/^(\d{1,2})[\s\-]+([A-Za-z]+)[\s\-]+(\d{4})$/);
    if (dMmmYMatch) {
      parsed = new Date(`${dMmmYMatch[2]} ${dMmmYMatch[1]}, ${dMmmYMatch[3]}`);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    }

    return null;
  }

  function sortHomeworkByDate() {
    if (!state.homework || !Array.isArray(state.homework)) return;

    state.homework.sort((a, b) => {
      const dateA = parseHomeworkDate(a.date);
      const dateB = parseHomeworkDate(b.date);
      if (dateA && dateB) {
        return dateB.getTime() - dateA.getTime();
      }
      if (dateA) return -1;
      if (dateB) return 1;
      return 0;
    });
  }

  /* --------------------------------------------------------------------------
     3. Theme Management
     -------------------------------------------------------------------------- */
  function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);

    if (elements.themeToggleBtn) {
      const sunIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>`;
      const moonIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>`;
      elements.themeToggleBtn.innerHTML = theme === 'dark' ? sunIcon : moonIcon;
      elements.themeToggleBtn.setAttribute('title', theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode');
    }
  }

  /* --------------------------------------------------------------------------
     4. Session & Cookie Management
     -------------------------------------------------------------------------- */
  function updateSessionStatus() {
    if (!state.cookies) {
      state.sessionStatus = 'disconnected';
      elements.statusDot.className = 'status-dot empty';
      elements.statusText.textContent = 'No Cookies Saved';
    } else if (state.errorMessage && state.errorMessage.toLowerCase().includes('expire')) {
      state.sessionStatus = 'expired';
      elements.statusDot.className = 'status-dot expired';
      elements.statusText.textContent = 'Session Expired';
    } else {
      state.sessionStatus = 'connected';
      elements.statusDot.className = 'status-dot connected';
      elements.statusText.textContent = 'Session Active';
    }
  }

  /* --------------------------------------------------------------------------
     5. Data Fetching Logic (POST /fetch-homework)
     -------------------------------------------------------------------------- */
  async function fetchHomework() {
    if (!state.cookies) {
      openSettingsModal();
      return;
    }

    state.isLoading = true;
    state.errorMessage = null;
    hideErrorBanner();
    renderSkeletons();

    if (elements.refreshBtn) {
      elements.refreshBtn.classList.add('loading');
    }

    try {
      const response = await fetch('/fetch-homework', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          cookies: state.cookies,
          customUrl: state.customUrl
        })
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        throw new Error(data.error || 'Failed to fetch homework from school server');
      }

      state.homework = data.homework || [];
      sortHomeworkByDate();

      state.lastUpdated = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      
      localStorage.setItem('cachedHomework', JSON.stringify(state.homework));
      localStorage.setItem('lastUpdated', state.lastUpdated);

      updateSessionStatus();
    } catch (err) {
      console.error('Fetch Homework Error:', err);
      state.errorMessage = err.message || 'Unable to connect to school server.';
      
      if (err.message.toLowerCase().includes('login') || err.message.toLowerCase().includes('cookie') || err.message.toLowerCase().includes('auth')) {
        state.errorMessage = 'Session may have expired. Please log into EduSecure and update your cookies in Settings.';
      }
      
      showErrorBanner(state.errorMessage);
      updateSessionStatus();
    } finally {
      state.isLoading = false;
      if (elements.refreshBtn) {
        elements.refreshBtn.classList.remove('loading');
      }
      render();
    }
  }

  /* --------------------------------------------------------------------------
     6. Intelligent Subject Detection Engine
     -------------------------------------------------------------------------- */
  function detectSubject(text) {
    if (!text) return { name: 'School Diary', class: 'sub-default' };

    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const firstLine = lines[0] || text;

    if (firstLine.includes(':')) {
      const candidate = firstLine.split(':')[0].trim().toUpperCase();
      for (const rule of SUBJECT_RULES) {
        if (rule.keys.some(k => candidate.includes(k))) {
          return { name: rule.name, class: rule.class };
        }
      }
      if (candidate.length > 2 && candidate.length < 30) {
        return { name: formatSubjectName(candidate), class: 'sub-default' };
      }
    }

    if (firstLine.includes('-')) {
      const candidate = firstLine.split('-')[0].trim().toUpperCase();
      for (const rule of SUBJECT_RULES) {
        if (rule.keys.some(k => candidate.includes(k))) {
          return { name: rule.name, class: rule.class };
        }
      }
      if (candidate.length > 2 && candidate.length < 30) {
        return { name: formatSubjectName(candidate), class: 'sub-default' };
      }
    }

    const upperText = text.toUpperCase();
    for (const rule of SUBJECT_RULES) {
      if (rule.keys.some(k => upperText.includes(k))) {
        return { name: rule.name, class: rule.class };
      }
    }

    return { name: 'School Diary', class: 'sub-default' };
  }

  function formatSubjectName(str) {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }

  /* --------------------------------------------------------------------------
     7. Date Utility Evaluation Functions
     -------------------------------------------------------------------------- */
  function isTodayDate(dateStr) {
    const homeworkDate = parseHomeworkDate(dateStr);
    if (!homeworkDate) {
      const todayStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      return dateStr.toLowerCase().trim() === todayStr.toLowerCase().trim();
    }
    const today = new Date();
    return homeworkDate.getDate() === today.getDate() &&
           homeworkDate.getMonth() === today.getMonth() &&
           homeworkDate.getFullYear() === today.getFullYear();
  }

  function isWithinLast7Days(dateStr) {
    const homeworkDate = parseHomeworkDate(dateStr);
    if (!homeworkDate) return true;
    const now = new Date();
    const diffTime = Math.abs(now - homeworkDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays <= 7;
  }

  function formatToISODate(dateStr) {
    const parsed = parseHomeworkDate(dateStr);
    if (!parsed) return '';
    const yyyy = parsed.getFullYear();
    const mm = String(parsed.getMonth() + 1).padStart(2, '0');
    const dd = String(parsed.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  /* --------------------------------------------------------------------------
     8. Rendering System
     -------------------------------------------------------------------------- */
  function render() {
    updateActiveNav();
    renderPageHeader();
    renderHomeworkList();
  }

  function updateActiveNav() {
    elements.navItems.forEach(item => {
      if (item.getAttribute('data-view') === state.activeView) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    elements.mobileNavItems.forEach(item => {
      if (item.getAttribute('data-view') === state.activeView) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  }

  function renderPageHeader() {
    const titles = {
      today: "Today's Homework",
      recent: 'Recent Homework',
      all: 'All Homework',
      attachments: 'Attachments'
    };

    elements.pageTitle.textContent = titles[state.activeView] || 'Homework';
  }

  function renderHeaderDate() {
    const now = new Date();
    const options = { weekday: 'long', month: 'short', day: 'numeric' };
    elements.pageDate.textContent = now.toLocaleDateString('en-US', options);
  }

  function renderHomeworkList() {
    if (state.isLoading) return;

    let filtered = [...state.homework];

    if (state.activeView === 'today') {
      filtered = filtered.filter(item => isTodayDate(item.date));
    } else if (state.activeView === 'recent') {
      filtered = filtered.filter(item => isWithinLast7Days(item.date));
    } else if (state.activeView === 'attachments') {
      filtered = filtered.filter(item => Boolean(item.attachment));
    }

    if (state.searchQuery.trim()) {
      const q = state.searchQuery.toLowerCase().trim();
      filtered = filtered.filter(item => {
        const subject = detectSubject(item.homework).name.toLowerCase();
        return item.homework.toLowerCase().includes(q) ||
               subject.includes(q) ||
               item.date.toLowerCase().includes(q) ||
               (item.type && item.type.toLowerCase().includes(q));
      });
    }

    if (state.selectedDateFilter) {
      filtered = filtered.filter(item => formatToISODate(item.date) === state.selectedDateFilter);
    }

    const totalCount = filtered.length;
    const attachmentCount = filtered.filter(i => Boolean(i.attachment)).length;

    elements.totalAssignments.textContent = totalCount;
    elements.totalAttachments.textContent = attachmentCount;
    elements.lastUpdatedTime.textContent = state.lastUpdated ? state.lastUpdated : 'Not updated';

    if (filtered.length === 0) {
      renderEmptyState();
      return;
    }

    const grouped = [];
    const map = new Map();

    for (const item of filtered) {
      const d = item.date || 'School Diary';
      if (!map.has(d)) {
        const groupObj = { date: d, entries: [] };
        map.set(d, groupObj);
        grouped.push(groupObj);
      }
      map.get(d).entries.push(item);
    }

    elements.homeworkList.innerHTML = '';

    for (const group of grouped) {
      const groupEl = document.createElement('div');
      groupEl.className = 'homework-group';

      const headerEl = document.createElement('div');
      headerEl.className = 'group-date-header';
      headerEl.innerHTML = `
        <span>${escapeHTML(group.date)}</span>
        <span class="group-date-count">${group.entries.length} assignment${group.entries.length > 1 ? 's' : ''}</span>
      `;
      groupEl.appendChild(headerEl);

      const listEl = document.createElement('div');
      listEl.className = 'cards-list';

      for (const item of group.entries) {
        listEl.appendChild(createHomeworkCard(item));
      }

      groupEl.appendChild(listEl);
      elements.homeworkList.appendChild(groupEl);
    }
  }

  function createHomeworkCard(item) {
    const card = document.createElement('article');
    card.className = 'homework-card';

    const subjectInfo = detectSubject(item.homework);

    card.innerHTML = `
      <div class="card-top-row">
        <span class="card-subject-pill ${subjectInfo.class}">${escapeHTML(subjectInfo.name)}</span>
        <div class="card-meta-right">
          <span class="card-type-badge">${escapeHTML(item.type || 'School Diary')}</span>
        </div>
      </div>

      <div class="card-body">${escapeHTML(item.homework)}</div>

      ${item.attachment ? `
        <a class="card-attachment-link" href="${escapeHTML(item.attachment)}" target="_blank" rel="noopener noreferrer">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
          Open attachment
        </a>
      ` : ''}
    `;

    return card;
  }

  function renderEmptyState() {
    let title = 'No homework found';
    let subtitle = 'There are no assignments matching your current filter criteria.';

    if (state.activeView === 'today' && !state.searchQuery && !state.selectedDateFilter) {
      title = 'No homework for today';
      subtitle = 'Enjoy the free time.';
    } else if (state.activeView === 'attachments') {
      title = 'No attachments found';
      subtitle = 'None of your homework entries contain attached files.';
    }

    elements.homeworkList.innerHTML = `
      <div class="empty-state">
        <svg class="empty-state-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
        </svg>
        <div class="empty-state-title">${escapeHTML(title)}</div>
        <div class="empty-state-subtitle">${escapeHTML(subtitle)}</div>
      </div>
    `;
  }

  function renderSkeletons() {
    elements.homeworkList.innerHTML = `
      <div class="skeleton-card">
        <div class="card-top-row">
          <div class="skeleton-box skeleton-pill"></div>
          <div class="skeleton-box" style="height: 14px; width: 60px;"></div>
        </div>
        <div class="skeleton-box skeleton-line"></div>
        <div class="skeleton-box skeleton-line"></div>
        <div class="skeleton-box skeleton-line short"></div>
      </div>
      <div class="skeleton-card">
        <div class="card-top-row">
          <div class="skeleton-box skeleton-pill"></div>
          <div class="skeleton-box" style="height: 14px; width: 60px;"></div>
        </div>
        <div class="skeleton-box skeleton-line"></div>
        <div class="skeleton-box skeleton-line short"></div>
      </div>
    `;
  }

  function showErrorBanner(msg) {
    if (elements.errorBanner) {
      elements.errorMessageText.textContent = msg;
      elements.errorBanner.style.display = 'flex';
    }
  }

  function hideErrorBanner() {
    if (elements.errorBanner) {
      elements.errorBanner.style.display = 'none';
    }
  }

  /* --------------------------------------------------------------------------
     9. Modal & Settings Actions
     -------------------------------------------------------------------------- */
  function openSettingsModal() {
    if (state.cookies) {
      elements.cookieFormInput.value = state.cookies;
    } else {
      elements.cookieFormInput.value = '';
    }
    if (elements.customUrlFormInput) {
      elements.customUrlFormInput.value = state.customUrl || '';
    }
    elements.settingsModal.classList.add('active');
  }

  function closeSettingsModal() {
    elements.settingsModal.classList.remove('active');
  }

  function saveCookies() {
    const val = elements.cookieFormInput.value.trim();
    if (!val) return;

    state.homework = [];
    localStorage.removeItem('cachedHomework');

    state.cookies = val;
    localStorage.setItem('cookies', val);

    if (elements.customUrlFormInput) {
      state.customUrl = elements.customUrlFormInput.value.trim();
      if (state.customUrl) {
        localStorage.setItem('customUrl', state.customUrl);
      } else {
        localStorage.removeItem('customUrl');
      }
    }

    updateSessionStatus();
    closeSettingsModal();
    fetchHomework();
  }

  function clearCookies() {
    state.cookies = '';
    state.customUrl = '';
    state.homework = [];
    state.lastUpdated = null;
    localStorage.removeItem('cookies');
    localStorage.removeItem('customUrl');
    localStorage.removeItem('cachedHomework');
    localStorage.removeItem('lastUpdated');
    elements.cookieFormInput.value = '';
    if (elements.customUrlFormInput) elements.customUrlFormInput.value = '';
    updateSessionStatus();
    closeSettingsModal();
    render();
  }

  /* --------------------------------------------------------------------------
     10. Event Listeners & Keyboard Shortcuts
     -------------------------------------------------------------------------- */
  function setupEventListeners() {
    elements.navItems.forEach(item => {
      item.addEventListener('click', () => {
        const view = item.getAttribute('data-view');
        if (view === 'settings') {
          openSettingsModal();
        } else {
          state.activeView = view;
          localStorage.setItem('activeView', view);
          render();
        }
      });
    });

    elements.mobileNavItems.forEach(item => {
      item.addEventListener('click', () => {
        const view = item.getAttribute('data-view');
        if (view === 'settings') {
          openSettingsModal();
        } else {
          state.activeView = view;
          localStorage.setItem('activeView', view);
          render();
        }
      });
    });

    if (elements.themeToggleBtn) {
      elements.themeToggleBtn.addEventListener('click', () => {
        applyTheme(state.theme === 'dark' ? 'light' : 'dark');
      });
    }

    if (elements.refreshBtn) {
      elements.refreshBtn.addEventListener('click', fetchHomework);
    }

    if (elements.settingsBtn) {
      elements.settingsBtn.addEventListener('click', openSettingsModal);
    }

    if (elements.modalCloseBtn) {
      elements.modalCloseBtn.addEventListener('click', closeSettingsModal);
    }

    elements.settingsModal.addEventListener('click', (e) => {
      if (e.target === elements.settingsModal) closeSettingsModal();
    });

    if (elements.saveCookieBtn) elements.saveCookieBtn.addEventListener('click', saveCookies);
    if (elements.clearCookieBtn) elements.clearCookieBtn.addEventListener('click', clearCookies);

    if (elements.searchInput) {
      elements.searchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value;
        renderHomeworkList();
      });
    }

    if (elements.dateFilterInput) {
      elements.dateFilterInput.addEventListener('change', (e) => {
        state.selectedDateFilter = e.target.value;
        if (state.selectedDateFilter) {
          elements.dateClearBtn.classList.add('visible');
        } else {
          elements.dateClearBtn.classList.remove('visible');
        }
        renderHomeworkList();
      });
    }

    if (elements.dateClearBtn) {
      elements.dateClearBtn.addEventListener('click', () => {
        state.selectedDateFilter = '';
        elements.dateFilterInput.value = '';
        elements.dateClearBtn.classList.remove('visible');
        renderHomeworkList();
      });
    }

    if (elements.errorRetryBtn) {
      elements.errorRetryBtn.addEventListener('click', fetchHomework);
    }
  }

  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      if (activeTag === 'input' || activeTag === 'textarea' || document.activeElement.isContentEditable) {
        if (e.key === 'Escape') {
          document.activeElement.blur();
          closeSettingsModal();
        }
        return;
      }

      if (e.key === '/') {
        e.preventDefault();
        if (elements.searchInput) elements.searchInput.focus();
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        fetchHomework();
      } else if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        state.activeView = 'today';
        localStorage.setItem('activeView', 'today');
        render();
      } else if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        state.activeView = 'all';
        localStorage.setItem('activeView', 'all');
        render();
      } else if (e.key === 'Escape') {
        closeSettingsModal();
      }
    });
  }

  function escapeHTML(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
