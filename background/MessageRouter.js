/**
 * @file background/MessageRouter.js
 * @description Central message bus handler. Routes all chrome.runtime.onMessage
 * calls to the appropriate manager. Type-safe, error-bounded.
 */

import { MSG } from '../shared/messages.js';
import {
  getSettings,
  saveSettings,
  saveWhitelist,
  saveCustomRules,
  resetAll,
  getStats,
  getHistory,
  saveStats,
  saveHistory
} from '../shared/storage.js';
import { bgLog } from '../shared/logger.js';
import { PAGES } from '../shared/constants.js';
import { extractDomain, isDomainWhitelisted, sortedEntries } from '../shared/utils.js';

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
        const settings = await getSettings();
        const whitelist = await whitelistManager.getList();
        const domain = extractDomain(url || '');
        const whitelisted = isDomainWhitelisted(domain, whitelist);

        // Load cosmetic rules from storage
        const cosmeticRules = await ruleEngine.getCosmeticRules(domain);

        return {
          enabled: settings.enabled,
          whitelisted,
          settings,
          cosmeticRules
        };
      }

      case MSG.REPORT_STAT: {
        const { domain, type: resType, category, count = 1 } = msg;
        let tabId = sender?.tab?.id;

        if (!tabId) {
          try {
            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            tabId = activeTab?.id;
          } catch (err) {
            bgLog.error('Failed to query active tab for REPORT_STAT', err);
          }
        }

        if (tabId && domain) {
          await statsEngine.recordBlock({ tabId, domain, type: resType, category, count });
          await badgeManager.update(tabId);
        }
        return null;
      }

      case MSG.REPORT_POPUP_BLOCKED: {
        const { url } = msg;
        let tabId = sender?.tab?.id;
        bgLog.info('Popup blocked', url);

        if (!tabId) {
          try {
            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            tabId = activeTab?.id;
          } catch (err) {
            bgLog.error('Failed to query active tab for REPORT_POPUP_BLOCKED', err);
          }
        }

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
        const settings = await getSettings();
        const whitelist = await whitelistManager.getList();
        const session = await statsEngine.getTabSession(tabId);
        const { tab } = await chrome.tabs.get(tabId).then(t => ({ tab: t })).catch(() => ({ tab: null }));
        const url = tab?.url || '';
        const domain = extractDomain(url);
        const whitelisted = isDomainWhitelisted(domain, whitelist);

        return {
          enabled: settings.enabled,
          whitelisted,
          domain,
          url,
          count: session?.count ?? 0,
          domains: session?.domains ?? []
        };
      }

      case MSG.TOGGLE_ENABLED: {
        const settings = await getSettings();
        settings.enabled = msg.enabled ?? !settings.enabled;
        await saveSettings(settings);
        await ruleEngine.onSettingsChanged(settings);
        bgLog.info('Extension toggled', settings.enabled ? 'ON' : 'OFF');

        // Refresh the badge on all active/available tabs
        try {
          const tabs = await chrome.tabs.query({});
          for (const t of tabs) {
            if (t.id) {
              await badgeManager.refreshFromStorage(t.id);
            }
          }
        } catch (err) {
          bgLog.error('Failed to refresh badges on toggle', err);
        }

        return { enabled: settings.enabled };
      }

      case MSG.PAUSE_SITE: {
        const { domain } = msg;
        if (!domain) throw new Error('No domain provided');
        await whitelistManager.addTemporary(domain, ruleEngine);
        bgLog.info('Site paused', domain);

        // Refresh badge for tabs on this domain
        try {
          const tabs = await chrome.tabs.query({});
          for (const t of tabs) {
            if (t.id && t.url && extractDomain(t.url) === domain) {
              await badgeManager.refreshFromStorage(t.id);
            }
          }
        } catch (err) {
          bgLog.error('Failed to refresh badges on pause', err);
        }

        return { paused: true };
      }

      case MSG.RESUME_SITE: {
        const { domain } = msg;
        if (!domain) throw new Error('No domain provided');
        await whitelistManager.removeTemporary(domain, ruleEngine);
        bgLog.info('Site resumed', domain);

        // Refresh badge for tabs on this domain
        try {
          const tabs = await chrome.tabs.query({});
          for (const t of tabs) {
            if (t.id && t.url && extractDomain(t.url) === domain) {
              await badgeManager.refreshFromStorage(t.id);
            }
          }
        } catch (err) {
          bgLog.error('Failed to refresh badges on resume', err);
        }

        return { resumed: true };
      }

      case MSG.GET_RECENT_BLOCKED: {
        const data = await statsEngine.getRecentBlocked();
        return data;
      }

      // ── Options → Background ───────────────────────────────────────────────

      case MSG.UPDATE_SETTINGS: {
        const { settings } = msg;
        await saveSettings(settings);
        await ruleEngine.onSettingsChanged(settings);
        return { saved: true };
      }

      case MSG.UPDATE_WHITELIST: {
        const { whitelist } = msg;
        await saveWhitelist(whitelist);
        whitelistManager.updateCache(whitelist);
        await ruleEngine.syncWhitelistRules(whitelist);
        return { saved: true };
      }

      case MSG.UPDATE_CUSTOM_RULES: {
        const { rules } = msg;
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
        return await getStats();
      }

      case MSG.GET_HISTORY: {
        return await getHistory();
      }

      case MSG.CLEAR_STATS: {
        await saveStats({ total: 0, byType: { script: 0, image: 0, stylesheet: 0, xmlhttprequest: 0, media: 0, ping: 0, other: 0 }, byDomain: {}, byCategory: { ads: 0, trackers: 0, analytics: 0, annoyances: 0, unknown: 0 } });
        await saveHistory({ days: [], lastResetDate: '' });
        bgLog.info('Stats cleared');
        return { cleared: true };
      }

      case MSG.GET_TOP_DOMAINS: {
        const stats = await getStats();
        return sortedEntries(stats.byDomain ?? {}, 20);
      }

      default:
        bgLog.warn('Unknown message type', type);
        return null;
    }
  }
}
