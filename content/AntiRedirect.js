/**
 * ShieldBlock Pro — Anti Redirect / URL Cleaner
 * Strips tracking parameters from the current page URL on load.
 * Runs at document_start in the ISOLATED world.
 *
 * Classic script (IIFE) — no ES module imports.
 */
(function () {
  'use strict';

  const SB = window.SB || {};

  // ── Tracking parameters to strip (must match shared/constants.js) ─────────
  const TRACKING_PARAMS = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'utm_id', 'utm_source_platform', 'utm_creative_format', 'utm_marketing_tactic',
    'gclid', 'gclsrc', 'dclid', '_ga', '_gl',
    'fbclid', 'fb_action_ids', 'fb_action_types', 'fb_source', 'fb_ref',
    'msclkid', 'twclid', 'li_fat_id',
    'mc_cid', 'mc_eid', 'igshid', 'yclid', 'wickedid', 'zanpid',
    '_hsenc', '_hsmi', 'mkt_tok',
    'hsa_cam', 'hsa_grp', 'hsa_mt', 'hsa_src', 'hsa_ad',
    'hsa_acc', 'hsa_net', 'hsa_kw', 'hsa_tgt', 'hsa_ver',
    's_cid', 'ncid', 'sxsrf', 'ved', 'uact',
    'ref', 'referrer'
  ];

  /**
   * Strip tracking parameters from a URL.
   *
   * @param {string} urlStr
   * @returns {{ cleaned: string, removed: string[] }} cleaned URL and list of removed params
   */
  function stripTrackingParams(urlStr) {
    let url;
    try {
      url = new URL(urlStr);
    } catch {
      return { cleaned: urlStr, removed: [] };
    }

    if (!url.search) return { cleaned: urlStr, removed: [] };

    const removed = [];
    for (const param of TRACKING_PARAMS) {
      if (url.searchParams.has(param)) {
        url.searchParams.delete(param);
        removed.push(param);
      }
    }

    return {
      cleaned: removed.length > 0 ? url.toString() : urlStr,
      removed
    };
  }

  /**
   * Clean the current page URL using history.replaceState (no page reload).
   */
  function cleanCurrentUrl() {
    const currentUrl = window.location.href;
    const { cleaned, removed } = stripTrackingParams(currentUrl);

    if (removed.length > 0 && cleaned !== currentUrl) {
      try {
        window.history.replaceState(null, '', cleaned);
        SB.log('AntiRedirect: cleaned URL', { removed });

        // Report to background
        if (typeof SB.sendMessage === 'function') {
          SB.sendMessage(SB.MSG.REPORT_REDIRECT_BLOCKED, {
            from:   currentUrl,
            to:     cleaned,
            params: removed
          });
        }
      } catch (err) {
        // replaceState may fail on some pages (e.g. file:// URLs) — safe to ignore
      }
    }
  }

  // ── Meta Refresh Interception ─────────────────────────────────────────────

  /**
   * Check for and block tracking meta-refresh redirects.
   * Runs after DOM is ready.
   */
  function blockMetaRefreshRedirects() {
    const metaTags = document.querySelectorAll('meta[http-equiv="refresh"]');
    metaTags.forEach(meta => {
      const content = meta.getAttribute('content') || '';
      const urlMatch = content.match(/url=['"]?([^'"]+)['"]?/i);
      if (urlMatch) {
        const redirectUrl = urlMatch[1];
        const { removed } = stripTrackingParams(redirectUrl);
        if (removed.length > 0) {
          // Block the redirect by removing the meta tag
          meta.remove();
          SB.log('AntiRedirect: blocked meta refresh with tracking params', removed);
        }
      }
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  SB.initAntiRedirect = function () {
    if (!SB.state?.settings?.antiRedirect?.enabled) return;
    if (SB.state?.settings?.antiRedirect?.cleanUrls !== false) {
      cleanCurrentUrl();
    }
    // Check meta refresh after DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', blockMetaRefreshRedirects);
    } else {
      blockMetaRefreshRedirects();
    }
    SB.log('AntiRedirect initialized');
  };

  // Expose the URL cleaner as a utility too
  SB.stripTrackingParams = stripTrackingParams;

  // Auto-initialize if already ready
  if (SB.ready) {
    SB.initAntiRedirect();
  }

})();
