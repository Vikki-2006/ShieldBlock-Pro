/**
 * ShieldBlock Pro — Content Script Entry Point
 * Runs at document_start in the ISOLATED world.
 * Sets up the global SB namespace and coordinates all content modules.
 *
 * NOTE: This file is a classic script (no ES module imports).
 * It shares scope with other content script files via the window object.
 */
(function () {
  'use strict';

  // ── Global Namespace ────────────────────────────────────────────────────────
  window.SB = window.SB || {};

  // ── Inline Message Constants (mirrors shared/messages.js) ──────────────────
  window.SB.MSG = {
    CONTENT_READY:          'content/ready',
    REPORT_STAT:            'content/stat',
    REPORT_POPUP_BLOCKED:   'content/popupBlocked',
    REPORT_REDIRECT_BLOCKED:'content/redirectBlocked',
    ADD_COSMETIC_RULE:      'content/addCosmetic',
    CONTENT_INIT:           'background/contentInit',
    GET_TAB_STATUS:         'popup/getStatus'
  };

  // ── State ───────────────────────────────────────────────────────────────────
  window.SB.state = {
    enabled:     true,
    whitelisted: false,
    settings:    {},
    domain:      '',
    initialized: false
  };

  // ── Utilities ───────────────────────────────────────────────────────────────

  window.SB.log = function (msg, data) {
    if (window.SB.state.settings?.debug) {
      console.log('[ShieldBlock]', msg, data ?? '');
    }
  };

  window.SB.extractDomain = function (url) {
    try {
      let host = url;
      if (url.includes('://')) host = new URL(url).hostname;
      host = host.replace(/^www\./, '');
      const parts = host.split('.');
      return parts.length > 2 ? parts.slice(-2).join('.') : host;
    } catch { return ''; }
  };

  window.SB.isDomainWhitelisted = function (domain, list) {
    if (!domain || !Array.isArray(list)) return false;
    const n = domain.replace(/^www\./, '').toLowerCase();
    return list.some(e => n === e.toLowerCase() || n.endsWith('.' + e.toLowerCase()));
  };

  // ── Send message to background (with retry on wake) ─────────────────────────
  window.SB.sendMessage = function (type, payload, callback) {
    try {
      chrome.runtime.sendMessage({ type, ...payload }, function (response) {
        if (chrome.runtime.lastError) {
          // Service worker may have been sleeping — safe to ignore
          if (callback) callback(null);
          return;
        }
        if (callback) callback(response?.data ?? null);
      });
    } catch (e) {
      if (callback) callback(null);
    }
  };

  // ── Initialization ──────────────────────────────────────────────────────────

  function init() {
    if (window.SB.state.initialized) return;

    const domain = window.SB.extractDomain(window.location.href);
    window.SB.state.domain = domain;

    // Ask background for init config (settings + whitelist status)
    window.SB.sendMessage(window.SB.MSG.CONTENT_READY, { url: window.location.href }, function (config) {
      if (!config) {
        // Background not available — proceed with defaults
        onConfigReceived({ enabled: true, whitelisted: false, settings: {}, cosmeticRules: { global: [], domainSpecific: [] } });
        return;
      }
      onConfigReceived(config);
    });

    window.SB.state.initialized = true;
  }

  function onConfigReceived(config) {
    window.SB.state.enabled     = config.enabled !== false;
    window.SB.state.whitelisted = config.whitelisted === true;
    window.SB.state.settings    = config.settings ?? {};

    if (!window.SB.state.enabled || window.SB.state.whitelisted) {
      window.SB.log('Blocking paused on this page');
      return;
    }

    // Signal to other modules that config is ready
    window.SB.cosmeticRules = config.cosmeticRules ?? { global: [], domainSpecific: [] };
    window.SB.ready = true;

    // Modules check window.SB.ready before activating
    if (typeof window.SB.initCosmeticEngine === 'function') window.SB.initCosmeticEngine();
    if (typeof window.SB.initAntiRedirect   === 'function') window.SB.initAntiRedirect();
    if (typeof window.SB.initResourceObserver === 'function') window.SB.initResourceObserver();
  }

  // Run init immediately — we're at document_start
  init();

})();
