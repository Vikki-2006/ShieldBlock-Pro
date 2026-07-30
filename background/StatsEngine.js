/**
 * @file background/StatsEngine.js
 * @description Statistics aggregation engine.
 * - chrome.storage.session: per-tab ephemeral counters (cleared on restart)
 * - chrome.storage.local: persistent aggregate totals + history ring buffer
 */

import { statLog }            from '../shared/logger.js';
import { getStats, saveStats, getHistory, saveHistory, sessionGet, sessionSet } from '../shared/storage.js';
import { todayString, updateFrequencyMap } from '../shared/utils.js';
import { STATS_LIMITS }       from '../shared/constants.js';

const SESSION_KEY = 'tabStats';
const RECENT_KEY  = 'recentBlocked';

export class StatsEngine {
  constructor() {
    this._badgeDebounce = new Map(); // tabId → timer
  }

  // ── Record a Blocked Item ───────────────────────────────────────────────────

  /**
   * Record a single blocked item across all stat buckets.
   *
   * @param {{ tabId: number, domain: string, type?: string, category?: string, count?: number }} opts
   */
  async recordBlock({ tabId, domain, type = 'other', category = 'unknown', count = 1 }) {
    try {
      await Promise.all([
        this._updateSessionStats(tabId, domain, count),
        this._updatePersistentStats(domain, type, category, count),
        this._appendRecentBlocked(domain, type, category)
      ]);
    } catch (err) {
      statLog.error('recordBlock failed', err);
    }
  }

  // ── Session Stats (per-tab, ephemeral) ─────────────────────────────────────

  /**
   * Update the per-tab session counter.
   *
   * @param {number} tabId
   * @param {string} domain
   * @param {number} count
   */
  async _updateSessionStats(tabId, domain, count) {
    const session = await sessionGet(SESSION_KEY);
    const tabStats = session[SESSION_KEY] ?? {};
    const tab = tabStats[tabId] ?? { count: 0, domains: [] };

    tab.count += count;
    if (domain && !tab.domains.includes(domain)) {
      tab.domains.push(domain);
      if (tab.domains.length > 50) tab.domains.shift(); // Cap at 50 domains
    }

    tabStats[tabId] = tab;
    await sessionSet({ [SESSION_KEY]: tabStats });
  }

  /**
   * Reset session stats for a tab (on navigation).
   *
   * @param {number} tabId
   * @param {string} url
   */
  async resetTabSession(tabId, url) {
    const session  = await sessionGet(SESSION_KEY);
    const tabStats = session[SESSION_KEY] ?? {};
    tabStats[tabId] = { count: 0, domains: [], url };
    await sessionSet({ [SESSION_KEY]: tabStats });
  }

  /**
   * Clean up session data when a tab is closed.
   *
   * @param {number} tabId
   */
  async cleanupTab(tabId) {
    const session  = await sessionGet(SESSION_KEY);
    const tabStats = session[SESSION_KEY] ?? {};
    delete tabStats[tabId];
    await sessionSet({ [SESSION_KEY]: tabStats });
  }

  /**
   * Get session stats for a tab.
   *
   * @param {number} tabId
   * @returns {Promise<{ count: number, domains: string[] }|null>}
   */
  async getTabSession(tabId) {
    const session  = await sessionGet(SESSION_KEY);
    const tabStats = session[SESSION_KEY] ?? {};
    return tabStats[tabId] ?? { count: 0, domains: [] };
  }

  // ── Persistent Stats ────────────────────────────────────────────────────────

  /**
   * Update the persistent aggregate statistics.
   *
   * @param {string} domain
   * @param {string} type
   * @param {string} category
   * @param {number} count
   */
  async _updatePersistentStats(domain, type, category, count) {
    const stats = await getStats();

    stats.total = (stats.total ?? 0) + count;

    // By type
    if (stats.byType && type in stats.byType) {
      stats.byType[type] = (stats.byType[type] ?? 0) + count;
    } else if (stats.byType) {
      stats.byType.other = (stats.byType.other ?? 0) + count;
    }

    // By domain (frequency-capped map)
    if (domain) {
      stats.byDomain = updateFrequencyMap(stats.byDomain ?? {}, domain, STATS_LIMITS.MAX_DOMAIN_ENTRIES);
    }

    // By category
    if (stats.byCategory && category in stats.byCategory) {
      stats.byCategory[category] = (stats.byCategory[category] ?? 0) + count;
    }

    // Increment today's daily count
    await this._incrementTodayCount(count);

    await saveStats(stats);
  }

  /**
   * Increment the count for today in the history ring buffer.
   *
   * @param {number} count
   */
  async _incrementTodayCount(count) {
    const history = await getHistory();
    const today   = todayString();
    const days    = Array.isArray(history.days) ? history.days : [];

    const todayEntry = days.find(d => d.date === today);
    if (todayEntry) {
      todayEntry.blocked += count;
    } else {
      days.push({ date: today, blocked: count });
      // Enforce ring buffer: keep last MAX_HISTORY_DAYS entries
      if (days.length > STATS_LIMITS.MAX_HISTORY_DAYS) {
        days.sort((a, b) => a.date.localeCompare(b.date));
        days.splice(0, days.length - STATS_LIMITS.MAX_HISTORY_DAYS);
      }
    }

    await saveHistory({ ...history, days, lastResetDate: today });
  }

  // ── Recent Activity Ring Buffer ─────────────────────────────────────────────

  /**
   * Append a blocked item to the session-level recent activity list.
   *
   * @param {string} domain
   * @param {string} type
   * @param {string} category
   */
  async _appendRecentBlocked(domain, type, category) {
    const session = await sessionGet(RECENT_KEY);
    const recent  = Array.isArray(session[RECENT_KEY]) ? session[RECENT_KEY] : [];

    recent.push({ domain, type, category, ts: Date.now() });

    // Ring buffer: keep last MAX_RECENT_BLOCKED entries
    if (recent.length > STATS_LIMITS.MAX_RECENT_BLOCKED) {
      recent.shift();
    }

    await sessionSet({ [RECENT_KEY]: recent });
  }

  /**
   * Get the recent blocked activity list (newest first).
   *
   * @returns {Promise<object[]>}
   */
  async getRecentBlocked() {
    const session = await sessionGet(RECENT_KEY);
    const recent  = session[RECENT_KEY] ?? [];
    return [...recent].reverse(); // Newest first
  }

  // ── Daily Reset ─────────────────────────────────────────────────────────────

  /**
   * Perform the daily stat reset (called by AlarmManager).
   * Archives current totals to history and resets session counters.
   */
  async performDailyReset() {
    try {
      statLog.info('Performing daily reset');
      // Reset session counters
      await sessionSet({ [SESSION_KEY]: {}, [RECENT_KEY]: [] });
      // History is maintained incrementally — no additional action needed
      statLog.info('Daily reset complete');
    } catch (err) {
      statLog.error('Daily reset failed', err);
    }
  }
}
