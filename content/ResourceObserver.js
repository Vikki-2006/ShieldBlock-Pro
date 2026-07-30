/**
 * ShieldBlock Pro — Resource Observer
 * Uses the PerformanceResourceTiming API to detect network-blocked resources
 * and report counts to the background for badge/stats updates.
 *
 * Classic script (IIFE) — no ES module imports.
 */
(function () {
  'use strict';

  const SB = window.SB || {};

  // ── Known ad/tracker domains (for classification) ─────────────────────────
  const AD_DOMAINS = new Set([
    'googlesyndication.com', 'doubleclick.net', 'googleadservices.com',
    'amazon-adsystem.com', 'adnxs.com', 'rubiconproject.com', 'openx.net',
    'pubmatic.com', 'criteo.com', 'taboola.com', 'outbrain.com', 'mgid.com',
    'adsrvr.org', 'advertising.com', 'smartadserver.com', 'moatads.com',
    'spotxchange.com', 'sharethrough.com', 'media.net', 'revcontent.com',
    'adform.net', 'casalemedia.com', 'yieldmo.com', 'bidswitch.net',
    '33across.com', 'triplelift.com', 'sovrn.com', 'lijit.com',
    'flashtalking.com', 'sizmek.com', 'adzerk.net', 'loopme.com',
    'innovid.com', 'fwmrm.net', 'springserve.com', 'iponweb.net'
  ]);

  const TRACKER_DOMAINS = new Set([
    'google-analytics.com', 'googletagmanager.com', 'hotjar.com',
    'mixpanel.com', 'segment.io', 'segment.com', 'amplitude.com',
    'fullstory.com', 'mouseflow.com', 'smartlook.com', 'heapanalytics.com',
    'crazyegg.com', 'clarity.ms', 'quantserve.com', 'comscore.com',
    'parsely.com', 'chartbeat.com', 'kissmetrics.com', 'woopra.com',
    'mc.yandex.ru', 'bat.bing.com'
  ]);

  /**
   * Classify a resource URL by its domain.
   *
   * @param {string} url
   * @returns {{ domain: string, category: string }}
   */
  function classifyResource(url) {
    let domain = '';
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      const parts = host.split('.');
      domain = parts.length > 2 ? parts.slice(-2).join('.') : host;
    } catch { return { domain: '', category: 'unknown' }; }

    if (AD_DOMAINS.has(domain)) return { domain, category: 'ads' };
    if (TRACKER_DOMAINS.has(domain)) return { domain, category: 'trackers' };
    return { domain, category: 'unknown' };
  }

  /**
   * Check if a performance entry represents a blocked resource.
   * A blocked resource has transferSize = 0 but the request was attempted.
   *
   * @param {PerformanceResourceTiming} entry
   * @returns {boolean}
   */
  function isBlockedResource(entry) {
    // Resources blocked by declarativeNetRequest have:
    // - transferSize === 0 (no bytes received)
    // - encodedBodySize === 0 (no body)
    // - fetchStart > 0 (request was initiated)
    // - duration > 0 OR connectEnd === 0 (connection never completed)
    return (
      entry.transferSize === 0 &&
      entry.encodedBodySize === 0 &&
      entry.fetchStart > 0 &&
      entry.connectEnd === 0 &&
      (entry.initiatorType === 'script' ||
       entry.initiatorType === 'img' ||
       entry.initiatorType === 'xmlhttprequest' ||
       entry.initiatorType === 'fetch' ||
       entry.initiatorType === 'iframe')
    );
  }

  /**
   * Process a batch of resource timing entries.
   *
   * @param {PerformanceResourceTiming[]} entries
   */
  function processEntries(entries) {
    const blocked = entries.filter(isBlockedResource);
    if (blocked.length === 0) return;

    // Group by domain and report
    const byDomain = new Map();
    for (const entry of blocked) {
      const { domain, category } = classifyResource(entry.name);
      if (!domain) continue;

      if (!byDomain.has(domain)) {
        byDomain.set(domain, { count: 0, category, type: entry.initiatorType });
      }
      byDomain.get(domain).count++;
    }

    for (const [domain, { count, category, type }] of byDomain) {
      SB.sendMessage(SB.MSG.REPORT_STAT, {
        domain,
        type:     type || 'other',
        category: category || 'unknown',
        count
      });
    }

    if (byDomain.size > 0) {
      SB.log('ResourceObserver: detected blocked resources', byDomain.size);
    }
  }

  // ── PerformanceObserver Setup ─────────────────────────────────────────────

  SB.initResourceObserver = function () {
    if (!window.PerformanceObserver || !window.PerformanceEntry) return;

    try {
      // Process existing entries first (for early-blocked resources)
      const existing = performance.getEntriesByType('resource');
      if (existing.length > 0) processEntries(existing);

      // Watch for new resource entries
      const observer = new PerformanceObserver(function (list) {
        processEntries(list.getEntries());
      });

      observer.observe({ type: 'resource', buffered: false });
      SB.log('ResourceObserver initialized');
    } catch (err) {
      // PerformanceObserver not supported — degrade gracefully
      SB.log('ResourceObserver not available', err.message);
    }
  };

  if (SB.ready) {
    SB.initResourceObserver();
  }

})();
