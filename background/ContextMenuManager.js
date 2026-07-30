/**
 * @file background/ContextMenuManager.js
 * @description Manages the right-click context menu items for ShieldBlock Pro.
 */

import { bgLog }         from '../shared/logger.js';
import { CONTEXT_MENU, PAGES } from '../shared/constants.js';
import { extractDomain } from '../shared/utils.js';

export class ContextMenuManager {
  /**
   * @param {import('./WhitelistManager.js').WhitelistManager} whitelistManager
   */
  constructor(whitelistManager) {
    this._whitelist = whitelistManager;
  }

  /**
   * Create all context menu items. Called on extension install.
   * Must be called from onInstalled to avoid duplicate menu items on restart.
   */
  async init() {
    // Remove all existing items first to prevent duplicates
    await chrome.contextMenus.removeAll();

    chrome.contextMenus.create({
      id:       CONTEXT_MENU.WHITELIST_SITE,
      title:    'Whitelist this site',
      contexts: ['page', 'action']
    });

    chrome.contextMenus.create({
      id:       CONTEXT_MENU.PAUSE_EXTENSION,
      title:    'Pause ShieldBlock Pro here',
      contexts: ['page', 'action']
    });

    chrome.contextMenus.create({
      id:       CONTEXT_MENU.SEPARATOR,
      type:     'separator',
      contexts: ['action']
    });

    chrome.contextMenus.create({
      id:       CONTEXT_MENU.OPEN_DASHBOARD,
      title:    'Open Dashboard',
      contexts: ['action']
    });

    bgLog.info('Context menus initialized');
  }

  /**
   * Handle a context menu item click.
   *
   * @param {chrome.contextMenus.OnClickData} info
   * @param {chrome.tabs.Tab} tab
   */
  async handleClick(info, tab) {
    const { menuItemId } = info;
    const domain = tab?.url ? extractDomain(tab.url) : null;

    bgLog.debug('Context menu clicked', { menuItemId, domain });

    try {
      switch (menuItemId) {
        case CONTEXT_MENU.WHITELIST_SITE: {
          if (!domain) return;
          const { RuleEngine } = await import('./RuleEngine.js');
          // We use a fresh import here since ContextMenuManager doesn't hold a ruleEngine ref
          // In production, wire this through the service worker index.js
          bgLog.info('Whitelist site clicked for', domain);
          // Send message to self to trigger whitelist add
          chrome.runtime.sendMessage({ type: 'options/whitelist', whitelist: [domain] });
          break;
        }

        case CONTEXT_MENU.PAUSE_EXTENSION: {
          if (!domain || !tab?.id) return;
          chrome.runtime.sendMessage({ type: 'popup/pause', domain, tabId: tab.id });
          bgLog.info('Pause extension clicked for', domain);
          break;
        }

        case CONTEXT_MENU.OPEN_DASHBOARD: {
          chrome.tabs.create({ url: chrome.runtime.getURL(PAGES.DASHBOARD) });
          break;
        }

        default:
          break;
      }
    } catch (err) {
      bgLog.error('Context menu handler failed', err);
    }
  }
}
