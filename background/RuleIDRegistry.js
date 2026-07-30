/**
 * @file background/RuleIDRegistry.js
 * @description Manages unique integer IDs for declarativeNetRequest dynamic rules.
 * Maintains a persistent registry in chrome.storage.local to prevent ID collisions
 * across service worker restarts.
 */

import { RULE_ID_RANGES } from '../shared/constants.js';
import { bgLog }          from '../shared/logger.js';

const STORAGE_KEY = 'ruleIdRegistry';

export class RuleIDRegistry {
  constructor() {
    /** @type {Map<string, number>} maps logicalId → dnrId */
    this._registry = new Map();
    this._loaded = false;
  }

  /**
   * Load registry from storage.
   */
  async load() {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const data = result[STORAGE_KEY] ?? {};
      this._registry = new Map(Object.entries(data).map(([k, v]) => [k, Number(v)]));
      this._loaded = true;
      bgLog.debug('RuleIDRegistry loaded', { entries: this._registry.size });
    } catch (err) {
      bgLog.error('Failed to load RuleIDRegistry', err);
      this._registry = new Map();
      this._loaded = true;
    }
  }

  /**
   * Persist the registry to storage.
   */
  async save() {
    try {
      const data = Object.fromEntries(this._registry);
      await chrome.storage.local.set({ [STORAGE_KEY]: data });
    } catch (err) {
      bgLog.error('Failed to save RuleIDRegistry', err);
    }
  }

  /**
   * Allocate a new unique DNR rule ID in the given partition.
   *
   * @param {string} logicalId - a stable string key for this rule (e.g. 'whitelist_example.com')
   * @param {'SESSION_WHITELIST'|'CUSTOM_USER_RULES'|'DYNAMIC_PATCH'} partition
   * @returns {number} allocated DNR rule ID
   */
  async allocate(logicalId, partition = 'CUSTOM_USER_RULES') {
    if (!this._loaded) await this.load();

    // Return existing ID if already allocated
    if (this._registry.has(logicalId)) {
      return this._registry.get(logicalId);
    }

    const range = RULE_ID_RANGES[partition];
    if (!range) throw new Error(`Unknown partition: ${partition}`);

    // Find the next available ID in the partition range
    const usedInRange = new Set(
      [...this._registry.values()].filter(id => id >= range.start && id <= range.end)
    );

    let newId = range.start;
    while (usedInRange.has(newId) && newId <= range.end) {
      newId++;
    }

    if (newId > range.end) {
      throw new Error(`Rule ID partition "${partition}" is full (${range.start}-${range.end})`);
    }

    this._registry.set(logicalId, newId);
    await this.save();

    bgLog.debug('Allocated rule ID', { logicalId, id: newId, partition });
    return newId;
  }

  /**
   * Release a rule ID by logical key.
   *
   * @param {string} logicalId
   */
  async release(logicalId) {
    if (!this._loaded) await this.load();
    if (this._registry.has(logicalId)) {
      this._registry.delete(logicalId);
      await this.save();
      bgLog.debug('Released rule ID', logicalId);
    }
  }

  /**
   * Get an existing ID by logical key (returns null if not found).
   *
   * @param {string} logicalId
   * @returns {number|null}
   */
  async get(logicalId) {
    if (!this._loaded) await this.load();
    return this._registry.get(logicalId) ?? null;
  }

  /**
   * Check if a logical ID already has an allocated rule ID.
   *
   * @param {string} logicalId
   * @returns {boolean}
   */
  async has(logicalId) {
    if (!this._loaded) await this.load();
    return this._registry.has(logicalId);
  }

  /**
   * Release all IDs in a partition. Used when completely rebuilding a rule set.
   *
   * @param {'SESSION_WHITELIST'|'CUSTOM_USER_RULES'|'DYNAMIC_PATCH'} partition
   */
  async releasePartition(partition) {
    if (!this._loaded) await this.load();
    const range = RULE_ID_RANGES[partition];
    if (!range) return;

    let released = 0;
    for (const [key, id] of this._registry) {
      if (id >= range.start && id <= range.end) {
        this._registry.delete(key);
        released++;
      }
    }
    if (released > 0) await this.save();
    bgLog.debug('Released partition', { partition, released });
  }

  /**
   * Get all currently allocated DNR IDs in a partition.
   *
   * @param {'SESSION_WHITELIST'|'CUSTOM_USER_RULES'} partition
   * @returns {number[]}
   */
  async getPartitionIds(partition) {
    if (!this._loaded) await this.load();
    const range = RULE_ID_RANGES[partition];
    return [...this._registry.values()].filter(id => id >= range.start && id <= range.end);
  }
}
