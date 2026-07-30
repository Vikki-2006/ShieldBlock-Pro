/**
 * @file background/WhitelistManager.js
 * @description Manages the domain whitelist (both persistent and temporary/session).
 * Keeps an in-memory cache to avoid storage reads on every request.
 */

import { bgLog }         from '../shared/logger.js';
import { getWhitelist, saveWhitelist } from '../shared/storage.js';
import { sanitiseDomain, isDomainWhitelisted } from '../shared/utils.js';
import { STATS_LIMITS }  from '../shared/constants.js';

export class WhitelistManager {
  constructor() {
    /** @type {string[]} In-memory cache of whitelist domains */
    this._cache = [];
    /** @type {Set<string>} Temporary paused domains (session only, not persisted) */
    this._temporary = new Set();
    this._loaded = false;
  }

  // ── Cache Management ────────────────────────────────────────────────────────

  /**
   * Load the whitelist from storage into the in-memory cache.
   * Called once on startup. Safe to call multiple times.
   */
  async load() {
    if (this._loaded) return;
    this._cache = await getWhitelist();
    this._loaded = true;
    bgLog.debug('WhitelistManager loaded', { count: this._cache.length });
  }

  /**
   * Update the in-memory cache (called when storage changes externally).
   *
   * @param {string[]} whitelist
   */
  updateCache(whitelist) {
    this._cache = Array.isArray(whitelist) ? whitelist : [];
    bgLog.debug('Whitelist cache updated', { count: this._cache.length });
  }

  /**
   * Get the full whitelist (persistent + temporary).
   *
   * @returns {Promise<string[]>}
   */
  async getList() {
    if (!this._loaded) await this.load();
    return [...new Set([...this._cache, ...this._temporary])];
  }

  // ── Persistent Whitelist ────────────────────────────────────────────────────

  /**
   * Add a domain to the persistent whitelist.
   *
   * @param {string} domain
   * @param {import('./RuleEngine.js').RuleEngine} ruleEngine
   * @returns {Promise<boolean>} true if added, false if already present
   */
  async add(domain, ruleEngine) {
    if (!this._loaded) await this.load();
    const clean = sanitiseDomain(domain);
    if (!clean) return false;
    if (this._cache.includes(clean)) return false;

    if (this._cache.length >= STATS_LIMITS.MAX_WHITELIST_SIZE) {
      bgLog.warn('Whitelist is at capacity', STATS_LIMITS.MAX_WHITELIST_SIZE);
      return false;
    }

    this._cache = [...this._cache, clean];
    await saveWhitelist(this._cache);
    await ruleEngine.addSessionWhitelistRule(clean);
    bgLog.info('Domain added to whitelist', clean);
    return true;
  }

  /**
   * Remove a domain from the persistent whitelist.
   *
   * @param {string} domain
   * @param {import('./RuleEngine.js').RuleEngine} ruleEngine
   * @returns {Promise<boolean>}
   */
  async remove(domain, ruleEngine) {
    if (!this._loaded) await this.load();
    const clean = sanitiseDomain(domain);
    const before = this._cache.length;
    this._cache = this._cache.filter(d => d !== clean);
    if (this._cache.length === before) return false;

    await saveWhitelist(this._cache);
    await ruleEngine.removeSessionWhitelistRule(clean);
    bgLog.info('Domain removed from whitelist', clean);
    return true;
  }

  // ── Temporary Pause ─────────────────────────────────────────────────────────

  /**
   * Temporarily pause blocking on a domain (cleared on browser restart).
   * Adds a high-priority session rule to DNR.
   *
   * @param {string} domain
   * @param {import('./RuleEngine.js').RuleEngine} ruleEngine
   */
  async addTemporary(domain, ruleEngine) {
    const clean = sanitiseDomain(domain);
    if (!clean) return;
    this._temporary.add(clean);
    await ruleEngine.addSessionWhitelistRule(clean);
    bgLog.info('Domain temporarily paused', clean);
  }

  /**
   * Remove a temporary pause from a domain.
   *
   * @param {string} domain
   * @param {import('./RuleEngine.js').RuleEngine} ruleEngine
   */
  async removeTemporary(domain, ruleEngine) {
    const clean = sanitiseDomain(domain);
    this._temporary.delete(clean);
    // Only remove the session rule if it's not in the persistent whitelist too
    if (!this._cache.includes(clean)) {
      await ruleEngine.removeSessionWhitelistRule(clean);
    }
    bgLog.info('Domain temporary pause removed', clean);
  }

  // ── Query ───────────────────────────────────────────────────────────────────

  /**
   * Check if a domain is currently whitelisted or paused.
   *
   * @param {string} domain
   * @returns {Promise<boolean>}
   */
  async isWhitelisted(domain) {
    if (!this._loaded) await this.load();
    const all = await this.getList();
    return isDomainWhitelisted(domain, all);
  }

  /**
   * Check if a domain is temporarily paused (not in persistent list).
   *
   * @param {string} domain
   * @returns {boolean}
   */
  isTemporary(domain) {
    const clean = sanitiseDomain(domain);
    return this._temporary.has(clean);
  }
}
