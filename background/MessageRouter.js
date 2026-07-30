/**
 * @file background/MessageRouter.js
 * @description Central message bus handler. Routes all chrome.runtime.onMessage
 * calls to the appropriate manager. Type-safe, error-bounded.
 */

import { MSG }            from '../shared/messages.js';
import { getSettings }    from '../shared/storage.js';
import { bgLog }          from '../shared/logger.js';
import { PAGES }          from '../shared/constants.js';

export class MessageRouter {
  /**
   * @param {{ ruleEngine, whitelistManager, statsEngine, badgeManager }} deps
   */
  constructor(deps) {
    this.deps = deps;
  }

  /**
   * Route an incoming message to the correct handler.
   * Must call sendResponse (possibly async via wrapping in async IIFE).
   *
   * @param {{ type: string, [key: string]: any }} message
   * @param {chrome.runtime.MessageSender} sender
   * @param {function} sendResponse
   */
  handle(message, sender, sendResponse) {
    const { type } = message;

    const dispatch = async () => {
      try {
        bgLog.debug('Message received', type);
        const result = await this._route(type, message, sender);
        sendResponse({ ok: true, data: result });
      } catch (err) {
        bgLog.error(`Handler failed for "${type}"`, err.message);
        sendResponse({ ok: false, error: err.message });
      }
    };

    dispatch();
  }

  /**
   * @private Route message to the correct handler.
   */
  async _route(type, msg, sender) {
    const { ruleEngine, whitelistManager, statsEngine, badgeManager } = this.deps;

    switch (type) {

      // ── Content → Background ───────────────────────────────────────────────

      case MSG.CONTENT_READY: {
        const { url } = msg;
        const settings   = await getSettings();
        const whitelist  = await whitelistManager.getList();
        const { extractDomain } = await import('../shared/utils.js');
        const domain     = extractDomain(url || '');
        const { isDomainWhitelisted } = await import('../shared/utils.js');
        const whitelisted = isDomainWhitelisted(domain, whitelist);

        // Load cosmetic rules from storage
        const cosmeticRules = await ruleEngine.getCosmeticRules(domain);

        return {
          enabled:      settings.enabled,
          whitelisted,
          settings,
          cosmeticRules
        };
      }

      case MSG.REPORT_STAT: {
        const { domain, type: resType, category, count = 1 } = msg;
        const tabId = sender?.tab?.id;
        if (tabId && domain) {
          await statsEngine.recordBlock({ tabId, domain, type: resType, category, count });
          await badgeManager.update(tabId);
        }
        return null;
      }

      case MSG.REPORT_POPUP_BLOCKED: {
        const { url } = msg;
        const tabId = sender?.tab?.id;
        bgLog.info('Popup blocked', url);
        if (tabId) {
          await statsEngine.recordBlock({ tabId, domain: msg.domain || 'popup', type: 'popup', category: 'annoyances' });
          await badgeManager.update(tabId);
        }
        return null;
      }

      case MSG.REPORT_REDIRECT_BLOCKED: {
        bgLog.info('Redirect blocked', msg.from);
        return null;
      }

      case MSG.ADD_COSMETIC_RULE: {
        const { selector, domain } = msg;
        await ruleEngine.addUserCosmeticRule(selector, domain);
        return { added: true };
      }

      // ── Popup → Background ─────────────────────────────────────────────────

      case MSG.GET_TAB_STATUS: {
        const { tabId } = msg;
        const settings  = await getSettings();
        const whitelist = await whitelistManager.getList();
        const session   = await statsEngine.getTabSession(tabId);
        const { tab }   = await chrome.tabs.get(tabId).then(t => ({ tab: t })).catch(() => ({ tab: null }));
        const url       = tab?.url || '';
        const { extractDomain, isDomainWhitelisted } = await import('../shared/utils.js');
        const domain    = extractDomain(url);
        const whitelisted = isDomainWhitelisted(domain, whitelist);

        return {
          enabled:    settings.enabled,
          whitelisted,
          domain,
          url,
          count:      session?.count ?? 0,
          domains:    session?.domains ?? []
        };
      }

      case MSG.TOGGLE_ENABLED: {
        const settings = await getSettings();
        settings.enabled = msg.enabled ?? !settings.enabled;
        const { saveSettings } = await import('../shared/storage.js');
        await saveSettings(settings);
        await ruleEngine.onSettingsChanged(settings);
        bgLog.info('Extension toggled', settings.enabled ? 'ON' : 'OFF');
        return { enabled: settings.enabled };
      }

      case MSG.PAUSE_SITE: {
        const { domain } = msg;
        if (!domain) throw new Error('No domain provided');
        await whitelistManager.addTemporary(domain, ruleEngine);
        bgLog.info('Site paused', domain);
        return { paused: true };
      }

      case MSG.RESUME_SITE: {
        const { domain } = msg;
        if (!domain) throw new Error('No domain provided');
        await whitelistManager.removeTemporary(domain, ruleEngine);
        bgLog.info('Site resumed', domain);
        return { resumed: true };
      }

      case MSG.GET_RECENT_BLOCKED: {
        const data = await statsEngine.getRecentBlocked();
        return data;
      }

      // ── Options → Background ───────────────────────────────────────────────

      case MSG.UPDATE_SETTINGS: {
        const { settings } = msg;
        const { saveSettings } = await import('../shared/storage.js');
        await saveSettings(settings);
        await ruleEngine.onSettingsChanged(settings);
        return { saved: true };
      }

      case MSG.UPDATE_WHITELIST: {
        const { whitelist } = msg;
        const { saveWhitelist } = await import('../shared/storage.js');
        await saveWhitelist(whitelist);
        whitelistManager.updateCache(whitelist);
        await ruleEngine.syncWhitelistRules(whitelist);
        return { saved: true };
      }

      case MSG.UPDATE_CUSTOM_RULES: {
        const { rules } = msg;
        const { saveCustomRules } = await import('../shared/storage.js');
        await saveCustomRules(rules);
        await ruleEngine.syncCustomRules(rules);
        return { saved: true };
      }

      case MSG.IMPORT_RULES: {
        const { rawText } = msg;
        const result = await ruleEngine.importFilterText(rawText);
        return result;
      }

      case MSG.RESET_ALL: {
        const { resetAll } = await import('../shared/storage.js');
        await resetAll();
        await ruleEngine.init();
        bgLog.info('Full reset performed');
        return { reset: true };
      }

      case MSG.TOGGLE_RULESET: {
        const { rulesetId, enabled } = msg;
        await ruleEngine.toggleStaticRuleset(rulesetId, enabled);
        return { toggled: true };
      }

      // ── Dashboard → Background ─────────────────────────────────────────────

      case MSG.GET_STATS: {
        const { getStats } = await import('../shared/storage.js');
        return await getStats();
      }

      case MSG.GET_HISTORY: {
        const { getHistory } = await import('../shared/storage.js');
        return await getHistory();
      }

      case MSG.CLEAR_STATS: {
        const { saveStats, saveHistory } = await import('../shared/storage.js');
        const { DEFAULTS } = { DEFAULTS: { stats: { total:0,byType:{},byDomain:{},byCategory:{} }, history: { days:[], lastResetDate:'' } } };
        await saveStats({ total:0, byType:{script:0,image:0,stylesheet:0,xmlhttprequest:0,media:0,ping:0,other:0}, byDomain:{}, byCategory:{ads:0,trackers:0,analytics:0,annoyances:0,unknown:0} });
        await saveHistory({ days: [], lastResetDate: '' });
        bgLog.info('Stats cleared');
        return { cleared: true };
      }

      case MSG.GET_TOP_DOMAINS: {
        const { getStats } = await import('../shared/storage.js');
        const stats = await getStats();
        const { sortedEntries } = await import('../shared/utils.js');
        return sortedEntries(stats.byDomain ?? {}, 20);
      }

      default:
        bgLog.warn('Unknown message type', type);
        return null;
    }
  }
}
