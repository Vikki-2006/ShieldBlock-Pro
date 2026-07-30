/**
 * ShieldBlock Pro — Cosmetic Engine
 * Injects CSS to hide ad elements. Runs at document_start.
 * Uses MutationObserver to handle dynamically injected ads.
 *
 * Classic script (IIFE) — no ES module imports.
 */
(function () {
  'use strict';

  const SB = window.SB || {};

  // ── Built-in cosmetic selectors (always applied) ──────────────────────────
  // These are the most common ad/annoyance element patterns across all sites.
  const GLOBAL_SELECTORS = [
    // ── Cookie banners & GDPR notices ─────────────────────────────────────
    '[id*="cookie-banner"]', '[class*="cookie-banner"]',
    '[id*="cookie-notice"]', '[class*="cookie-notice"]',
    '[id*="cookie-consent"]', '[class*="cookie-consent"]',
    '[id*="cookie-bar"]', '[class*="cookie-bar"]',
    '[id*="cookie-policy"]', '[class*="cookie-policy"]',
    '[id*="gdpr"]', '[class*="gdpr"]',
    '[id*="consent-banner"]', '[class*="consent-banner"]',
    '[id*="privacy-banner"]', '[class*="privacy-banner"]',
    '#onetrust-banner-sdk', '#onetrust-consent-sdk',
    '#CybotCookiebotDialog', '.CybotCookiebotDialogBody',
    '#cookiebanner', '#cookie_bar', '#cookie-law-info-bar',
    '.cookie-law-info', '.cc-window', '#cc-main',
    '[class*="cookielaw"]', '[id*="cookielaw"]',
    '[class*="CookieBanner"]', '[id*="CookieBanner"]',
    '[aria-label="Cookie consent"]', '[data-nosnippet][class*="cookie"]',

    // ── Newsletter/email popups ────────────────────────────────────────────
    '[class*="newsletter-popup"]', '[id*="newsletter-popup"]',
    '[class*="email-popup"]', '[id*="email-popup"]',
    '[class*="subscribe-popup"]', '[id*="subscribe-popup"]',
    '[class*="signup-popup"]', '[id*="signup-popup"]',
    '#mc-modal', '.mc-modal', '#mc4wp-form',

    // ── General popup overlays ─────────────────────────────────────────────
    '[class*="modal-overlay"]', '[class*="overlay-modal"]',
    '[class*="popup-overlay"]', '[class*="overlay-popup"]',
    '[id*="modal-overlay"]', '[id*="popup-overlay"]',

    // ── Common ad slot containers ──────────────────────────────────────────
    '[class*="advertisement"]', '[class*="Advertisement"]',
    '[class*="adsbox"]', '[class*="ads-box"]',
    '[class*="ad-container"]', '[class*="ad-wrapper"]',
    '[class*="ad-slot"]', '[class*="ad-unit"]',
    '[class*="ad-banner"]', '[class*="adBanner"]',
    '[class*="ad-placeholder"]', '[class*="adPlaceholder"]',
    '[class*="sponsored-content"]', '[class*="sponsoredContent"]',
    '[class*="sponsored-post"]', '[class*="sponsoredPost"]',
    '[class*="native-ad"]', '[class*="nativeAd"]',
    '[class*="promo-banner"]', '[class*="promoBanner"]',
    '[id*="adsense"]', '[id*="adSense"]', '[id*="google-ads"]',
    '[id*="div-gpt-ad"]', '[class*="div-gpt-ad"]',
    'ins.adsbygoogle',

    // ── Push notification prompts ──────────────────────────────────────────
    '[class*="push-notification"]', '[id*="push-notification"]',
    '[class*="notification-prompt"]', '[id*="notification-prompt"]',
    '[class*="subscribe-prompt"]',

    // ── Chat widget overlays (ad-like) ─────────────────────────────────────
    '#drift-frame-controller', '#drift-widget',
    '#intercom-container', '.intercom-lightweight-app',
    '#hubspot-messages-iframe-container',

    // ── Floating/sticky ads ────────────────────────────────────────────────
    '[class*="sticky-ad"]', '[class*="stickyAd"]',
    '[class*="floating-ad"]', '[class*="floatingAd"]',
    '[class*="fixed-ad"]', '[class*="fixedAd"]',
    '[class*="sticky-banner"]', '[id*="sticky-banner"]',
    '[class*="bottom-ad"]', '[class*="top-ad"]',

    // ── Social share spam bars ─────────────────────────────────────────────
    '[class*="social-share-bar"]', '[class*="share-bar"]',
    '[class*="share-buttons--sticky"]',

    // ── Anti-adblock prompts ───────────────────────────────────────────────
    '[class*="adblock-warning"]', '[id*="adblock-warning"]',
    '[class*="adblock-notice"]', '[id*="adblock-notice"]',
    '[class*="ab-detect"]', '[id*="ab-detect"]',
    '[class*="ad-block-message"]', '[id*="ad-block-message"]'
  ];

  // ── Style element ─────────────────────────────────────────────────────────

  let _styleEl = null;

  /**
   * Build the CSS rule string from selectors.
   *
   * @param {string[]} selectors
   * @returns {string}
   */
  function buildCSS(selectors) {
    if (!selectors || selectors.length === 0) return '';
    // Filter out any obviously invalid selectors
    const safe = selectors.filter(s => s && typeof s === 'string' && !s.includes('{') && !s.includes('<'));
    if (safe.length === 0) return '';
    return safe.join(',\n') + ' {\n  display: none !important;\n  visibility: hidden !important;\n}';
  }

  /**
   * Inject or update the cosmetic CSS <style> element.
   * Called at document_start before DOM is ready.
   *
   * @param {string[]} selectors
   */
  function injectCSS(selectors) {
    const css = buildCSS(selectors);
    if (!css) return;

    if (!_styleEl) {
      _styleEl = document.createElement('style');
      _styleEl.id = 'shieldblock-cosmetic';
      _styleEl.setAttribute('data-shieldblock', '1');
      // Insert at the very beginning of <html> — this is valid at document_start
      // when document.head may not yet exist
      const target = document.documentElement || document.head || document.body;
      if (target) {
        target.insertBefore(_styleEl, target.firstChild);
      }
    }

    _styleEl.textContent = css;
  }

  // ── MutationObserver for dynamic ads ──────────────────────────────────────

  let _observer = null;
  let _hiddenCount = 0;

  /**
   * Scan the DOM for ad elements matching our selectors and hide them.
   * Also reports the count to the background.
   *
   * @param {string[]} selectors
   */
  function scanAndHide(selectors) {
    if (!selectors || selectors.length === 0) return;

    let count = 0;
    for (const selector of selectors) {
      try {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          if (el.getAttribute('data-sb-hidden') !== '1') {
            el.style.setProperty('display', 'none', 'important');
            el.setAttribute('data-sb-hidden', '1');
            count++;
          }
        });
      } catch {
        // Invalid selector — skip
      }
    }

    if (count > 0) {
      _hiddenCount += count;
      SB.log('Cosmetic: hidden', count);
      // Report stats to background
      if (typeof SB.sendMessage === 'function') {
        SB.sendMessage(SB.MSG.REPORT_STAT, {
          domain:   SB.state?.domain ?? '',
          type:     'cosmetic',
          category: 'annoyances',
          count
        });
      }
    }
  }

  /**
   * Start watching for dynamically added ad elements.
   *
   * @param {string[]} selectors
   */
  function startObserver(selectors) {
    if (_observer) _observer.disconnect();

    _observer = new MutationObserver(function (mutations) {
      let hasAddedNodes = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) { hasAddedNodes = true; break; }
      }
      if (hasAddedNodes) {
        // Debounce to avoid processing every single mutation
        clearTimeout(_observer._timer);
        _observer._timer = setTimeout(() => scanAndHide(selectors), 200);
      }
    });

    _observer.observe(document.documentElement, {
      childList: true,
      subtree:   true
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  SB.initCosmeticEngine = function () {
    if (!SB.state?.settings?.cosmetic?.enabled) return;

    // Collect all selectors: built-in + user cosmetic rules
    const allSelectors = [...GLOBAL_SELECTORS];

    // Add user's global cosmetic rules
    if (SB.cosmeticRules?.global?.length) {
      allSelectors.push(...SB.cosmeticRules.global);
    }

    // Add domain-specific cosmetic rules
    if (SB.cosmeticRules?.domainSpecific?.length) {
      allSelectors.push(...SB.cosmeticRules.domainSpecific);
    }

    // 1) Inject CSS immediately (fastest — works before DOM is ready)
    injectCSS(allSelectors);

    // 2) Scan after DOM is available
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        scanAndHide(allSelectors);
        startObserver(allSelectors);
      });
    } else {
      scanAndHide(allSelectors);
      startObserver(allSelectors);
    }

    SB.log('CosmeticEngine initialized', { selectors: allSelectors.length });
  };

  // Auto-initialize if SB.ready is already set
  // (in case this script loads after index.js has already received config)
  if (SB.ready) {
    SB.initCosmeticEngine();
  }

})();
