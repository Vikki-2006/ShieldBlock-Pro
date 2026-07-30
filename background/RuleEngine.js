/**
 * @file background/RuleEngine.js
 * @description Manages all declarativeNetRequest rules: static rulesets,
 * dynamic custom rules, session whitelist rules, and cosmetic rules.
 */

import { RuleIDRegistry }          from './RuleIDRegistry.js';
import { ruleLog }                 from '../shared/logger.js';
import { RULE_PRIORITY, BLOCKABLE_RESOURCE_TYPES, STATIC_RULESET_IDS, RULE_TYPES } from '../shared/constants.js';
import { getCustomRules, getWhitelist, getSettings, storageGet, storageSet } from '../shared/storage.js';
import { generateCustomRuleId }    from '../shared/utils.js';
import { validateImportText }      from '../shared/validator.js';
import { FilterParser }            from './FilterParser.js';

const COSMETIC_STORAGE_KEY = 'cosmeticRules';

export class RuleEngine {
  constructor() {
    this._idRegistry = new RuleIDRegistry();
    this._initialized = false;
  }

  // ── Initialization ──────────────────────────────────────────────────────────

  /**
   * Initialize the rule engine. Called on every service worker startup.
   * Safe to call multiple times.
   */
  async init() {
    if (this._initialized) return;
    try {
      await this._idRegistry.load();
      const settings = await getSettings();
      if (settings.enabled !== false) {
        const adsEnabled = settings.filters?.ads !== false;
        const privacyEnabled = settings.filters?.privacy !== false;
        await this.toggleStaticRuleset(STATIC_RULESET_IDS.ADS, adsEnabled);
        await this.toggleStaticRuleset(STATIC_RULESET_IDS.PRIVACY, privacyEnabled);
        const rules = await getCustomRules();
        await this._applyCustomRules(rules.filter(r => r.enabled));
      } else {
        // Ensure everything is disabled in DNR
        await this.toggleStaticRuleset(STATIC_RULESET_IDS.ADS, false);
        await this.toggleStaticRuleset(STATIC_RULESET_IDS.PRIVACY, false);
        const existingIds = await this._idRegistry.getPartitionIds('CUSTOM_USER_RULES');
        if (existingIds.length > 0) {
          await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existingIds });
        }
        const sessionIds = await this._idRegistry.getPartitionIds('SESSION_WHITELIST');
        if (sessionIds.length > 0) {
          await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: sessionIds });
        }
      }
      this._initialized = true;
      ruleLog.info('RuleEngine initialized');
    } catch (err) {
      ruleLog.error('RuleEngine init failed', err);
      // Don't throw — let extension function in degraded mode
    }
  }

  // ── Static Rulesets ─────────────────────────────────────────────────────────

  /**
   * Verify that expected static rulesets are enabled. Re-enable if needed.
   */
  async _verifyStaticRulesets() {
    try {
      const rulesets = await chrome.declarativeNetRequest.getEnabledRulesets();
      ruleLog.debug('Enabled rulesets', rulesets);
    } catch (err) {
      ruleLog.warn('Could not verify static rulesets', err);
    }
  }

  /**
   * Toggle a static ruleset (e.g. 'ads', 'privacy') on or off.
   *
   * @param {string} rulesetId
   * @param {boolean} enabled
   */
  async toggleStaticRuleset(rulesetId, enabled) {
    try {
      if (enabled) {
        await chrome.declarativeNetRequest.updateEnabledRulesets({
          enableRulesetIds:  [rulesetId],
          disableRulesetIds: []
        });
      } else {
        await chrome.declarativeNetRequest.updateEnabledRulesets({
          enableRulesetIds:  [],
          disableRulesetIds: [rulesetId]
        });
      }
      ruleLog.info(`Ruleset "${rulesetId}" ${enabled ? 'enabled' : 'disabled'}`);
    } catch (err) {
      ruleLog.error('toggleStaticRuleset failed', err);
    }
  }

  // ── Custom User Rules ───────────────────────────────────────────────────────

  /**
   * Apply custom user rules to declarativeNetRequest dynamic rules.
   * Completely replaces all existing dynamic rules in the CUSTOM_USER_RULES partition.
   *
   * @param {object[]} enabledRules - custom rules that are enabled
   */
  async _applyCustomRules(enabledRules) {
    try {
      // Clear existing custom dynamic rules
      const existingIds = await this._idRegistry.getPartitionIds('CUSTOM_USER_RULES');
      if (existingIds.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existingIds });
      }
      await this._idRegistry.releasePartition('CUSTOM_USER_RULES');

      // Build new DNR rules from enabled custom rules
      const newRules = [];
      for (const rule of enabledRules) {
        if (rule.type !== RULE_TYPES.NETWORK && rule.type !== RULE_TYPES.EXCEPTION) continue;
        const dnrRule = this._customRuleToDNR(rule);
        if (!dnrRule) continue;

        const id = await this._idRegistry.allocate(rule.id, 'CUSTOM_USER_RULES');
        dnrRule.id = id;
        newRules.push(dnrRule);
      }

      if (newRules.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({ addRules: newRules });
        ruleLog.info('Custom rules applied', { count: newRules.length });
      }
    } catch (err) {
      ruleLog.error('_applyCustomRules failed', err);
    }
  }

  /**
   * Convert a custom rule object into a declarativeNetRequest rule.
   *
   * @param {object} rule
   * @returns {object|null} DNR rule or null if unsupported
   */
  _customRuleToDNR(rule) {
    const raw = rule.rawText?.trim();
    if (!raw) return null;

    const isException = rule.type === RULE_TYPES.EXCEPTION || raw.startsWith('@@');
    const pattern = isException ? raw.replace(/^@@/, '') : raw;

    // Convert EasyList-style pattern to urlFilter
    let urlFilter = pattern
      .replace(/^\|\|/, '')           // Remove domain anchor prefix
      .replace(/\^.*$/, '')           // Remove separator and options
      .replace(/\*/g, '*')            // Keep wildcards
      .replace(/\|$/, '');            // Remove end anchor

    if (!urlFilter) return null;

    // Re-add domain anchor if original had ||
    if (pattern.startsWith('||')) {
      urlFilter = '||' + urlFilter + '^';
    }

    return {
      id: 0, // Set by caller
      priority: isException ? RULE_PRIORITY.CUSTOM_ALLOW : RULE_PRIORITY.CUSTOM_BLOCK,
      action: { type: isException ? 'allow' : 'block' },
      condition: {
        urlFilter,
        resourceTypes: BLOCKABLE_RESOURCE_TYPES
      }
    };
  }

  /**
   * Sync custom rules from storage to DNR (called when customRules changes).
   *
   * @param {object[]} rules
   */
  async syncCustomRules(rules) {
    const enabled = rules.filter(r => r.enabled);
    await this._applyCustomRules(enabled);
  }

  // ── Session Whitelist Rules ─────────────────────────────────────────────────

  /**
   * Add a domain to the session whitelist (high-priority allow rule).
   * Session rules are cleared when the browser restarts.
   *
   * @param {string} domain
   */
  async addSessionWhitelistRule(domain) {
    try {
      const logicalId = `session_wl_${domain}`;
      if (await this._idRegistry.has(logicalId)) return; // Already exists

      const id = await this._idRegistry.allocate(logicalId, 'SESSION_WHITELIST');
      await chrome.declarativeNetRequest.updateSessionRules({
        addRules: [{
          id,
          priority: RULE_PRIORITY.WHITELIST,
          action: { type: 'allow' },
          condition: {
            urlFilter: `||${domain}^`,
            resourceTypes: BLOCKABLE_RESOURCE_TYPES
          }
        }]
      });
      ruleLog.info('Session whitelist rule added', domain);
    } catch (err) {
      ruleLog.error('addSessionWhitelistRule failed', err);
    }
  }

  /**
   * Remove a domain from the session whitelist.
   *
   * @param {string} domain
   */
  async removeSessionWhitelistRule(domain) {
    try {
      const logicalId = `session_wl_${domain}`;
      const id = await this._idRegistry.get(logicalId);
      if (id !== null) {
        await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [id] });
        await this._idRegistry.release(logicalId);
        ruleLog.info('Session whitelist rule removed', domain);
      }
    } catch (err) {
      ruleLog.error('removeSessionWhitelistRule failed', err);
    }
  }

  /**
   * Rebuild all session whitelist rules from the persistent whitelist.
   *
   * @param {string[]} whitelist
   */
  async syncWhitelistRules(whitelist) {
    // Clear all existing session rules
    try {
      const existingIds = await this._idRegistry.getPartitionIds('SESSION_WHITELIST');
      if (existingIds.length > 0) {
        await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: existingIds });
      }
      await this._idRegistry.releasePartition('SESSION_WHITELIST');

      // Add rules for each whitelisted domain
      for (const domain of whitelist) {
        await this.addSessionWhitelistRule(domain);
      }
      ruleLog.info('Whitelist rules synced', { count: whitelist.length });
    } catch (err) {
      ruleLog.error('syncWhitelistRules failed', err);
    }
  }

  // ── Settings Changes ────────────────────────────────────────────────────────

  /**
   * React to settings changes (e.g. filter toggles).
   *
   * @param {object} settings
   */
  async onSettingsChanged(settings) {
    try {
      if (settings.enabled === false) {
        // Disable everything in DNR
        await this.toggleStaticRuleset(STATIC_RULESET_IDS.ADS, false);
        await this.toggleStaticRuleset(STATIC_RULESET_IDS.PRIVACY, false);
        
        const existingIds = await this._idRegistry.getPartitionIds('CUSTOM_USER_RULES');
        if (existingIds.length > 0) {
          await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existingIds });
        }
        
        const sessionIds = await this._idRegistry.getPartitionIds('SESSION_WHITELIST');
        if (sessionIds.length > 0) {
          await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: sessionIds });
        }
        ruleLog.info('ShieldBlock Pro globally disabled: rules removed from DNR');
      } else {
        // Enable based on filters settings
        const adsEnabled = settings.filters?.ads !== false;
        const privacyEnabled = settings.filters?.privacy !== false;
        await this.toggleStaticRuleset(STATIC_RULESET_IDS.ADS, adsEnabled);
        await this.toggleStaticRuleset(STATIC_RULESET_IDS.PRIVACY, privacyEnabled);

        // Sync custom rules
        const rules = await getCustomRules();
        await this._applyCustomRules(rules.filter(r => r.enabled));

        // Sync whitelist
        const whitelist = await getWhitelist();
        await this.syncWhitelistRules(whitelist);
        ruleLog.info('ShieldBlock Pro globally enabled: rules synced to DNR');
      }
      ruleLog.debug('Settings applied to RuleEngine');
    } catch (err) {
      ruleLog.error('onSettingsChanged failed', err);
    }
  }

  // ── Cosmetic Rules ──────────────────────────────────────────────────────────

  /**
   * Get cosmetic rules for a domain (global + domain-specific).
   *
   * @param {string} domain
   * @returns {Promise<{ global: string[], domainSpecific: string[] }>}
   */
  async getCosmeticRules(domain) {
    try {
      const result = await storageGet(COSMETIC_STORAGE_KEY);
      const cosmetic = result[COSMETIC_STORAGE_KEY] ?? { global: [], perDomain: {} };
      const domainSpecific = cosmetic.perDomain?.[domain] ?? [];
      return { global: cosmetic.global ?? [], domainSpecific };
    } catch (err) {
      ruleLog.error('getCosmeticRules failed', err);
      return { global: [], domainSpecific: [] };
    }
  }

  /**
   * Add a user-created cosmetic rule (from element picker).
   *
   * @param {string} selector - CSS selector
   * @param {string} [domain] - if provided, rule is domain-specific
   */
  async addUserCosmeticRule(selector, domain) {
    try {
      const result = await storageGet(COSMETIC_STORAGE_KEY);
      const cosmetic = result[COSMETIC_STORAGE_KEY] ?? { global: [], perDomain: {} };

      if (domain) {
        if (!cosmetic.perDomain[domain]) cosmetic.perDomain[domain] = [];
        if (!cosmetic.perDomain[domain].includes(selector)) {
          cosmetic.perDomain[domain].push(selector);
        }
      } else {
        if (!cosmetic.global.includes(selector)) {
          cosmetic.global.push(selector);
        }
      }

      await storageSet({ [COSMETIC_STORAGE_KEY]: cosmetic });
      ruleLog.info('Cosmetic rule added', { selector, domain });
    } catch (err) {
      ruleLog.error('addUserCosmeticRule failed', err);
    }
  }

  // ── Filter Text Import ──────────────────────────────────────────────────────

  /**
   * Parse and import a raw EasyList-format filter text.
   * Network rules → custom rules storage.
   * Cosmetic rules → cosmetic rules storage.
   *
   * @param {string} rawText
   * @returns {{ imported: number, skipped: number, errors: number }}
   */
  async importFilterText(rawText) {
    const parser = new FilterParser();
    const result = parser.parse(rawText);

    const existingRules = await getCustomRules();
    const existingTexts = new Set(existingRules.map(r => r.rawText));

    let imported = 0, skipped = 0;
    const newRules = [];

    for (const parsed of result.network) {
      if (existingTexts.has(parsed.raw)) { skipped++; continue; }
      newRules.push({
        id:      generateCustomRuleId(),
        rawText: parsed.raw,
        type:    parsed.type,
        enabled: true,
        created: Date.now(),
        hits:    0,
        lastHit: null
      });
      imported++;
    }

    if (newRules.length > 0) {
      const all = [...existingRules, ...newRules];
      await storageSet({ customRules: all });
      await this.syncCustomRules(all);
    }

    // Handle cosmetic rules
    if (result.cosmetic.length > 0) {
      const res = await storageGet(COSMETIC_STORAGE_KEY);
      const cosmetic = res[COSMETIC_STORAGE_KEY] ?? { global: [], perDomain: {} };
      for (const c of result.cosmetic) {
        if (c.domains.length === 0) {
          if (!cosmetic.global.includes(c.selector)) cosmetic.global.push(c.selector);
        } else {
          for (const d of c.domains) {
            if (!cosmetic.perDomain[d]) cosmetic.perDomain[d] = [];
            if (!cosmetic.perDomain[d].includes(c.selector)) cosmetic.perDomain[d].push(c.selector);
          }
        }
      }
      await storageSet({ [COSMETIC_STORAGE_KEY]: cosmetic });
    }

    ruleLog.info('Filter import complete', { imported, skipped, errors: result.errors });
    return { imported, skipped, errors: result.errors, cosmeticImported: result.cosmetic.length };
  }
}
