/**
 * @file popup/index.js
 * @description ShieldBlock Pro popup controller.
 * Communicates with the background service worker to show live stats.
 */

import { sendToBackground }          from '../shared/messages.js';
import { MSG }                       from '../shared/messages.js';
import { formatNumber, formatCount, timeAgo, truncate } from '../shared/utils.js';
import { getSettings }               from '../shared/storage.js';

// ── DOM References ─────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);
const els = {
  popupWrap:    $('shieldIcon')?.closest('.popup-wrap') ?? document.querySelector('.popup-wrap'),
  shieldIcon:   $('shieldIcon'),
  statusLabel:  $('statusLabel'),
  enabledToggle:$('enabledToggle'),
  siteCard:     $('siteCard'),
  siteDomain:   $('siteDomain'),
  siteStatusText: $('siteStatusText'),
  pauseBtn:     $('pauseBtn'),
  pauseBtnLabel:$('pauseBtnLabel'),
  tabCount:     $('tabCount'),
  totalCount:   $('totalCount'),
  activityList: $('activityList'),
  activityBadge:$('activityBadge'),
  openDashboard:$('openDashboard'),
  openOptions:  $('openOptions')
};

// ── State ──────────────────────────────────────────────────────────────────

let state = {
  tabId:      null,
  domain:     '',
  enabled:    true,
  whitelisted:false,
  tabCount:   0,
  totalCount: 0
};

// ── Initialization ─────────────────────────────────────────────────────────

async function init() {
  // Apply theme
  const settings = await getSettings();
  applyTheme(settings.theme);

  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  state.tabId = tab.id;

  // Load status
  await loadStatus(tab);

  // Load total stats
  await loadStats();

  // Load recent activity
  await loadRecentActivity();

  // Bind events
  bindEvents();

  // Auto-refresh every 3 seconds (fallback polling)
  setInterval(async () => {
    await loadStatus(tab);
    await loadStats();
    await loadRecentActivity();
  }, 3000);

  // Real-time push: refresh immediately when a request is blocked
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === MSG.STATS_UPDATED) {
      loadStatus(tab).catch(() => {});
      loadStats().catch(() => {});
      loadRecentActivity().catch(() => {});
    }
  });
}

// ── Data Loaders ───────────────────────────────────────────────────────────

async function loadStatus(tab) {
  try {
    const response = await sendToBackground(MSG.GET_TAB_STATUS, { tabId: tab.id });
    if (!response) return;

    state.enabled    = response.enabled !== false;
    state.whitelisted = response.whitelisted === true;
    state.domain     = response.domain || '';
    state.tabCount   = response.count  || 0;

    updateUI();
  } catch (err) {
    console.error('[Popup] loadStatus failed', err);
  }
}

async function loadStats() {
  try {
    const stats = await sendToBackground(MSG.GET_STATS);
    if (stats) {
      state.totalCount = stats.total || 0;
      animateCounter(els.totalCount, state.totalCount);
    }
  } catch (err) {
    console.error('[Popup] loadStats failed', err);
  }
}

async function loadRecentActivity() {
  try {
    const recent = await sendToBackground(MSG.GET_RECENT_BLOCKED);
    if (Array.isArray(recent)) {
      renderActivity(recent);
    }
  } catch (err) {
    console.error('[Popup] loadRecentActivity failed', err);
  }
}

// ── UI Rendering ───────────────────────────────────────────────────────────

function updateUI() {
  const { enabled, whitelisted, domain, tabCount } = state;

  // Domain display
  els.siteDomain.textContent = domain || 'Unknown site';

  // Favicon (using a local SVG placeholder to satisfy Content Security Policy)
  const favicon = document.querySelector('.site-favicon');
  if (favicon) {
    favicon.innerHTML = `<svg viewBox="0 0 16 16" fill="none" width="16" height="16" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="7"/><path d="M8 1v14M1 8h14M2.5 4.5h11M2.5 11.5h11M8 1c1.5 2 2.5 4.5 2.5 7s-1 5-2.5 7-2.5-4.5-2.5-7 1-5 2.5-7z"/></svg>`;
  }

  // Status text + label
  if (!enabled) {
    els.statusLabel.textContent = 'Disabled';
    els.statusLabel.className   = 'brand-status disabled';
    els.siteStatusText.textContent = 'Protection disabled globally';
    els.popupWrap?.classList.add('disabled');
  } else if (whitelisted) {
    els.statusLabel.textContent = 'Paused';
    els.statusLabel.className   = 'brand-status paused';
    els.siteStatusText.textContent = 'Paused on this site';
    els.siteCard?.classList.add('paused');
    els.pauseBtn.classList.add('active');
    els.pauseBtnLabel.textContent = 'Resume';
  } else {
    els.statusLabel.textContent = 'Active';
    els.statusLabel.className   = 'brand-status';
    els.siteStatusText.textContent = 'Protection active';
    els.popupWrap?.classList.remove('disabled');
    els.siteCard?.classList.remove('paused');
    els.pauseBtn.classList.remove('active');
    els.pauseBtnLabel.textContent = 'Pause';
  }

  // Toggle state
  if (els.enabledToggle) els.enabledToggle.checked = enabled;

  // Tab counter
  animateCounter(els.tabCount, tabCount);
}

function renderActivity(items) {
  if (!els.activityList) return;

  if (!items || items.length === 0) {
    els.activityList.innerHTML = `
      <div class="activity-empty">
        <svg viewBox="0 0 24 24" fill="none" width="24" height="24">
          <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>Nothing blocked yet</span>
      </div>`;
    els.activityBadge.textContent = '0';
    return;
  }

  const topItems = items.slice(0, 10);
  els.activityBadge.textContent = String(items.length);

  els.activityList.innerHTML = topItems.map(item => `
    <div class="activity-item">
      <span class="activity-dot ${item.category || 'unknown'}"></span>
      <span class="activity-domain">${escapeHtml(truncate(item.domain || 'unknown', 28))}</span>
      <span class="activity-type">${escapeHtml(item.type || 'other')}</span>
    </div>
  `).join('');
}

// ── Animations ─────────────────────────────────────────────────────────────

function animateCounter(el, targetValue) {
  if (!el) return;
  const current = parseInt(el.textContent.replace(/,/g, ''), 10) || 0;
  if (current === targetValue) return;

  const diff     = targetValue - current;
  const steps    = Math.min(Math.abs(diff), 20);
  const stepSize = diff / steps;
  let current2   = current;
  let step       = 0;

  const timer = setInterval(() => {
    step++;
    current2 += stepSize;
    el.textContent = formatNumber(Math.round(step < steps ? current2 : targetValue));
    if (step >= steps) clearInterval(timer);
  }, 30);
}

// ── Theme ──────────────────────────────────────────────────────────────────

function applyTheme(theme) {
  let effective = theme;
  if (theme === 'auto') {
    effective = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  if (effective === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

// ── Event Bindings ─────────────────────────────────────────────────────────

function bindEvents() {
  // Enable/disable toggle
  els.enabledToggle?.addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    state.enabled = enabled;
    await sendToBackground(MSG.TOGGLE_ENABLED, { enabled });
    updateUI();
  });

  // Pause/Resume button
  els.pauseBtn?.addEventListener('click', async () => {
    if (!state.domain) return;
    if (state.whitelisted) {
      await sendToBackground(MSG.RESUME_SITE, { domain: state.domain });
      state.whitelisted = false;
    } else {
      await sendToBackground(MSG.PAUSE_SITE, { domain: state.domain });
      state.whitelisted = true;
    }
    updateUI();
  });

  // Open dashboard
  els.openDashboard?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/index.html') });
    window.close();
  });

  // Open settings
  els.openOptions?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });
}

// ── Utilities ──────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Boot ───────────────────────────────────────────────────────────────────

init().catch(err => console.error('[Popup] init failed', err));
