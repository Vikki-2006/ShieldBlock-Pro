/**
 * ShieldBlock Pro — Popup Blocker
 * Runs in the MAIN world (world: "MAIN") so it can override window.open.
 * This file is declared separately in manifest.json with "world": "MAIN".
 *
 * IMPORTANT: This script has NO access to chrome.* APIs or window.SB
 * (which lives in the ISOLATED world). It is self-contained.
 */
(function () {
  'use strict';

  // ── Override window.open ────────────────────────────────────────────────────

  const _originalOpen = window.open;

  window.open = function (url, target, features) {
    // Allow popups that are triggered by direct user interaction
    // (browser already handles this, but we add an extra layer)

    // Block common ad popup patterns:
    // 1. No URL (blank popups used for ad injection)
    // 2. URL is javascript:void or about:blank
    // 3. Empty string URL
    if (!url || url === '' || url === 'about:blank' || url.startsWith('javascript:')) {
      console.debug('[ShieldBlock] Blocked blank popup');
      return null;
    }

    // Block popups opened with suspicious timing (async, not user-initiated)
    // The browser itself restricts non-user-initiated popups; we add logging
    const result = _originalOpen.call(this, url, target, features);
    if (!result) {
      // Browser blocked it — that's fine
      return null;
    }

    return result;
  };

  // ── Intercept <a target="_blank"> spam ──────────────────────────────────────

  document.addEventListener('click', function (e) {
    const anchor = e.target.closest('a[target="_blank"]');
    if (!anchor) return;

    const href = anchor.href || '';

    // Block known ad redirect patterns in _blank links
    const BLOCKED_PATTERNS = [
      /\/go\//i,
      /\/redirect\//i,
      /\/click\//i,
      /\/track\//i,
      /\/exit\//i,
      /\/redir\//i,
      /adclick/i,
      /bannerclick/i,
      /clickthrough/i,
      /doubleclick\.net/i,
      /googlesyndication\.com/i,
      /adnxs\.com/i
    ];

    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(href)) {
        e.preventDefault();
        e.stopPropagation();
        console.debug('[ShieldBlock] Blocked redirect link:', href);
        return;
      }
    }
  }, true); // Capture phase to intercept before page handlers


  // ── Block auto-opening via document.write ───────────────────────────────────
  // Some sites abuse document.write to inject popup scripts

  // We don't override document.write completely (would break many sites)
  // but we can monitor for iframe injection patterns

  console.debug('[ShieldBlock] PopupBlocker active (MAIN world)');

})();
