/**
 * @file options/index.js
 * @description ShieldBlock Pro options page controller.
 */

import { sendToBackground, MSG } from '../shared/messages.js';
import { getSettings, getWhitelist, getCustomRules, getStats } from '../shared/storage.js';
import { validateDomain, validateImportText } from '../shared/validator.js';
import { sanitiseDomain, formatNumber, generateCustomRuleId } from '../shared/utils.js';

// ── State ──────────────────────────────────────────────────────────────────

let settings = {};
let whitelist = [];
let customRules = [];
let hasUnsaved = false;

// ── Init ───────────────────────────────────────────────────────────────────

async function init() {
  settings    = await getSettings();
  whitelist   = await getWhitelist();
  customRules = await getCustomRules();

  applyTheme(settings.theme);
  populateSettings();
  renderWhitelist();
  renderRules();
  bindNav();
  bindEvents();
  loadAboutStats();

  const manifest = chrome.runtime.getManifest();
  const vEl = document.getElementById('extVersion');
  const vEl2 = document.getElementById('aboutVersion');
  if (vEl)  vEl.textContent  = 'v' + manifest.version;
  if (vEl2) vEl2.textContent = 'Version ' + manifest.version;

  // React to storage changes from other pages
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.settings) { settings = changes.settings.newValue; populateSettings(); }
    if (changes.whitelist) { whitelist = changes.whitelist.newValue ?? []; renderWhitelist(); }
    if (changes.customRules) { customRules = changes.customRules.newValue ?? []; renderRules(); }
  });
}

// ── Navigation ──────────────────────────────────────────────────────────────

function bindNav() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const section = btn.dataset.section;
      // Update nav active state
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // Show section
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      const sEl = document.getElementById('section-' + section);
      if (sEl) sEl.classList.add('active');
    });
  });
}

// ── Settings Population ─────────────────────────────────────────────────────

function populateSettings() {
  setCheck('globalEnabled',        settings.enabled !== false);
  setCheck('filterAds',            settings.filters?.ads !== false);
  setCheck('filterPrivacy',        settings.filters?.privacy !== false);
  setCheck('cosmeticEnabled',      settings.cosmetic?.enabled !== false);
  setCheck('popupBlockerEnabled',  settings.popupBlocker?.enabled !== false);
  setCheck('antiRedirectEnabled',  settings.antiRedirect?.enabled !== false);
  setCheck('animationsToggle',     settings.animations !== false);

  const colorInput = document.getElementById('accentColor');
  if (colorInput) colorInput.value = settings.accentColor || '#818cf8';

  // Theme buttons
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === (settings.theme || 'auto'));
  });

  // Color presets
  document.querySelectorAll('.color-preset').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.color === (settings.accentColor || '#818cf8'));
  });
}

function setCheck(id, value) {
  const el = document.getElementById(id);
  if (el) el.checked = Boolean(value);
}

// ── Events ─────────────────────────────────────────────────────────────────

function bindEvents() {
  // Global enable toggle
  document.getElementById('globalEnabled')?.addEventListener('change', async e => {
    settings.enabled = e.target.checked;
    await autoSave();
  });

  // Filter toggles
  ['filterAds', 'filterPrivacy', 'cosmeticEnabled', 'popupBlockerEnabled', 'antiRedirectEnabled', 'animationsToggle'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', async () => {
      readSettingsFromUI();
      markDirty();
    });
  });

  // Theme buttons
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      settings.theme = btn.dataset.theme;
      applyTheme(settings.theme);
      markDirty();
    });
  });

  // Accent color input
  document.getElementById('accentColor')?.addEventListener('input', e => {
    settings.accentColor = e.target.value;
    applyAccentColor(settings.accentColor);
    markDirty();
  });

  // Color presets
  document.querySelectorAll('.color-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.color-preset').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      settings.accentColor = btn.dataset.color;
      const ci = document.getElementById('accentColor');
      if (ci) ci.value = settings.accentColor;
      applyAccentColor(settings.accentColor);
      markDirty();
    });
  });

  // Save button
  document.getElementById('saveBtn')?.addEventListener('click', saveAll);

  // Whitelist
  document.getElementById('whitelistAddBtn')?.addEventListener('click', addToWhitelist);
  document.getElementById('whitelistInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') addToWhitelist();
  });

  // Custom rules
  document.getElementById('addRulesBtn')?.addEventListener('click', addCustomRules);
  document.getElementById('clearAllRulesBtn')?.addEventListener('click', async () => {
    if (confirm('Clear all custom rules?')) {
      customRules = [];
      renderRules();
      await sendToBackground(MSG.UPDATE_CUSTOM_RULES, { rules: [] });
    }
  });

  // Import/Export
  bindImportExport();
}

// ── Save ───────────────────────────────────────────────────────────────────

function readSettingsFromUI() {
  settings.enabled                  = getCheck('globalEnabled');
  settings.animations               = getCheck('animationsToggle');
  settings.filters = settings.filters || {};
  settings.filters.ads              = getCheck('filterAds');
  settings.filters.privacy          = getCheck('filterPrivacy');
  settings.cosmetic = settings.cosmetic || {};
  settings.cosmetic.enabled         = getCheck('cosmeticEnabled');
  settings.popupBlocker = settings.popupBlocker || {};
  settings.popupBlocker.enabled     = getCheck('popupBlockerEnabled');
  settings.antiRedirect = settings.antiRedirect || {};
  settings.antiRedirect.enabled     = getCheck('antiRedirectEnabled');
}

function getCheck(id) {
  return document.getElementById(id)?.checked ?? true;
}

async function autoSave() {
  readSettingsFromUI();
  await sendToBackground(MSG.UPDATE_SETTINGS, { settings });
}

async function saveAll() {
  readSettingsFromUI();
  await sendToBackground(MSG.UPDATE_SETTINGS, { settings });
  clearDirty();
}

function markDirty() {
  hasUnsaved = true;
  const bar = document.getElementById('saveBar');
  if (bar) bar.classList.add('visible');
}

function clearDirty() {
  hasUnsaved = false;
  const bar = document.getElementById('saveBar');
  if (bar) bar.classList.remove('visible');
}

// ── Whitelist ──────────────────────────────────────────────────────────────

async function addToWhitelist() {
  const input = document.getElementById('whitelistInput');
  const errEl = document.getElementById('whitelistError');
  const raw = input?.value?.trim() ?? '';
  const domain = sanitiseDomain(raw);

  const { valid, error } = validateDomain(domain);
  if (!valid) {
    showError(errEl, error || 'Invalid domain');
    return;
  }
  if (whitelist.includes(domain)) {
    showError(errEl, 'Domain already whitelisted');
    return;
  }

  hideError(errEl);
  whitelist = [...whitelist, domain];
  renderWhitelist();
  if (input) input.value = '';
  await sendToBackground(MSG.UPDATE_WHITELIST, { whitelist });
}

function renderWhitelist() {
  const list = document.getElementById('whitelistList');
  if (!list) return;

  if (whitelist.length === 0) {
    list.innerHTML = '<div class="empty-state">No whitelisted sites yet. Add a domain above.</div>';
    return;
  }

  list.innerHTML = whitelist.map(d => `
    <div class="whitelist-item">
      <span class="whitelist-domain">${escapeHtml(d)}</span>
      <button class="whitelist-remove" data-domain="${escapeHtml(d)}" title="Remove">
        <svg viewBox="0 0 12 12" fill="none" width="12" height="12">
          <path d="M2 2l8 8M10 2L2 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
  `).join('');

  list.querySelectorAll('.whitelist-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      const domain = btn.dataset.domain;
      whitelist = whitelist.filter(d => d !== domain);
      renderWhitelist();
      await sendToBackground(MSG.UPDATE_WHITELIST, { whitelist });
    });
  });
}

// ── Custom Rules ────────────────────────────────────────────────────────────

async function addCustomRules() {
  const textarea = document.getElementById('ruleInput');
  const errEl    = document.getElementById('ruleError');
  const raw      = textarea?.value?.trim() ?? '';

  if (!raw) { showError(errEl, 'Enter at least one rule'); return; }

  const lines = raw.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('!'));

  const newRules = [];
  for (const line of lines) {
    if (customRules.some(r => r.rawText === line)) continue;

    let type = 'network';
    if (line.startsWith('@@')) type = 'exception';
    else if (line.includes('##') || line.includes('#@#')) type = 'cosmetic';

    newRules.push({
      id:      generateCustomRuleId(),
      rawText: line,
      type,
      enabled: true,
      created: Date.now(),
      hits:    0,
      lastHit: null
    });
  }

  if (newRules.length === 0) { showError(errEl, 'No new rules found (duplicates skipped)'); return; }

  hideError(errEl);
  customRules = [...customRules, ...newRules];
  renderRules();
  if (textarea) textarea.value = '';
  await sendToBackground(MSG.UPDATE_CUSTOM_RULES, { rules: customRules });
}

function renderRules() {
  const list  = document.getElementById('rulesList');
  const count = document.getElementById('rulesCount');
  if (!list) return;

  if (count) count.textContent = `${customRules.length} rule${customRules.length !== 1 ? 's' : ''}`;

  if (customRules.length === 0) {
    list.innerHTML = '<div class="empty-state">No custom rules yet.</div>';
    return;
  }

  list.innerHTML = customRules.map((rule, i) => `
    <div class="rule-item ${rule.enabled ? '' : 'disabled'}" data-index="${i}">
      <label class="toggle-mini" title="${rule.enabled ? 'Disable' : 'Enable'} rule">
        <input type="checkbox" class="rule-enable-toggle" data-index="${i}" ${rule.enabled ? 'checked' : ''}>
        <span class="toggle-mini-track"><span class="toggle-mini-thumb"></span></span>
      </label>
      <span class="rule-text" title="${escapeHtml(rule.rawText)}">${escapeHtml(rule.rawText)}</span>
      <span class="rule-type-badge ${rule.type}">${rule.type}</span>
      <div class="rule-actions">
        <button class="rule-action-btn delete" data-index="${i}" title="Delete rule">
          <svg viewBox="0 0 12 12" fill="none" width="12" height="12">
            <path d="M2 2l8 8M10 2L2 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.rule-enable-toggle').forEach(cb => {
    cb.addEventListener('change', async () => {
      const i = parseInt(cb.dataset.index, 10);
      customRules[i].enabled = cb.checked;
      renderRules();
      await sendToBackground(MSG.UPDATE_CUSTOM_RULES, { rules: customRules });
    });
  });

  list.querySelectorAll('.rule-action-btn.delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i = parseInt(btn.dataset.index, 10);
      customRules.splice(i, 1);
      renderRules();
      await sendToBackground(MSG.UPDATE_CUSTOM_RULES, { rules: customRules });
    });
  });
}

// ── Import/Export ───────────────────────────────────────────────────────────

function bindImportExport() {
  const fileInput = document.getElementById('filterFileInput');
  const uploadZone = document.getElementById('uploadZone');
  const statusEl = document.getElementById('importStatus');

  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    await importFile(file, statusEl);
    fileInput.value = '';
  });

  uploadZone?.addEventListener('dragover', e => {
    e.preventDefault();
    uploadZone.classList.add('dragging');
  });

  uploadZone?.addEventListener('dragleave', () => uploadZone.classList.remove('dragging'));

  uploadZone?.addEventListener('drop', async e => {
    e.preventDefault();
    uploadZone.classList.remove('dragging');
    const file = e.dataTransfer.files?.[0];
    if (file) await importFile(file, statusEl);
  });

  // Export
  document.getElementById('exportBtn')?.addEventListener('click', async () => {
    const data = {
      version: chrome.runtime.getManifest().version,
      exported: new Date().toISOString(),
      settings,
      whitelist,
      customRules
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'shieldblock-settings.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  // Reset
  document.getElementById('resetBtn')?.addEventListener('click', async () => {
    if (!confirm('Reset ALL settings, whitelist, and custom rules to defaults? This cannot be undone.')) return;
    await sendToBackground(MSG.RESET_ALL);
    settings    = await getSettings();
    whitelist   = await getWhitelist();
    customRules = await getCustomRules();
    populateSettings();
    renderWhitelist();
    renderRules();
    clearDirty();
  });
}

async function importFile(file, statusEl) {
  const reader = new FileReader();
  reader.onload = async e => {
    const text = e.target.result;
    const { valid, error } = validateImportText(text);
    if (!valid) {
      showImportStatus(statusEl, 'error', error);
      return;
    }
    try {
      const result = await sendToBackground(MSG.IMPORT_RULES, { rawText: text });
      if (result) {
        showImportStatus(statusEl, 'success',
          `Imported ${result.imported} network rules, ${result.cosmeticImported || 0} cosmetic rules. ${result.skipped} duplicates skipped.`
        );
        customRules = await getCustomRules();
        renderRules();
      }
    } catch (err) {
      showImportStatus(statusEl, 'error', 'Import failed: ' + err.message);
    }
  };
  reader.readAsText(file);
}

function showImportStatus(el, type, msg) {
  if (!el) return;
  el.hidden = false;
  el.className = `import-status ${type}`;
  el.textContent = msg;
  setTimeout(() => { el.hidden = true; }, 5000);
}

// ── About Stats ─────────────────────────────────────────────────────────────

async function loadAboutStats() {
  const stats = await getStats();
  const rules = await getCustomRules();

  const rEl  = document.getElementById('statRules');
  const tEl  = document.getElementById('statTotal');
  const cEl  = document.getElementById('statCustom');

  // Compute real rule count from static rulesets + dynamic rules
  let staticCount = 0;
  try {
    // Static ruleset sizes (must match the JSON files)
    const RULESET_SIZES = { ads: 322, privacy: 286 };
    const enabledRulesets = await chrome.declarativeNetRequest.getEnabledRulesets();
    for (const id of enabledRulesets) {
      staticCount += RULESET_SIZES[id] ?? 0;
    }
    const dynamicRules = await chrome.declarativeNetRequest.getDynamicRules();
    staticCount += dynamicRules.length;
  } catch {
    staticCount = 608; // Fallback if DNR API unavailable
  }

  if (rEl) rEl.textContent = staticCount.toLocaleString();
  if (tEl) tEl.textContent = formatNumber(stats.total || 0);
  if (cEl) cEl.textContent = String(rules.length);
}


// ── Theme ─────────────────────────────────────────────────────────────────

function applyTheme(theme) {
  let effective = theme;
  if (theme === 'auto') {
    effective = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', effective === 'light' ? 'light' : 'dark');
}

function applyAccentColor(color) {
  document.documentElement.style.setProperty('--accent', color);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function showError(el, msg) { if (el) { el.hidden = false; el.textContent = msg; } }
function hideError(el) { if (el) el.hidden = true; }

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Boot ───────────────────────────────────────────────────────────────────

init().catch(err => console.error('[Options] init failed', err));
