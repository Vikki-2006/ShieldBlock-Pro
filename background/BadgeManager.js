/**
 * @file background/BadgeManager.js
 * @description Manages the extension action badge (the number shown on the toolbar icon).
 * Debounces updates to avoid hammering the Chrome API on rapid stat increments.
 */

import { bgLog }      from '../shared/logger.js';
import { BADGE }      from '../shared/constants.js';
import { badgeText }  from '../shared/utils.js';
import { sessionGet } from '../shared/storage.js';

const SESSION_KEY = 'tabStats';

export class BadgeManager {
  constructor() {
    /** @type {Map<number, ReturnType<setTimeout>>} debounce timers per tabId */
    this._timers = new Map();
  }

  /**
   * Schedule a badge update for a tab (debounced).
   * Multiple rapid calls within BADGE.DEBOUNCE_MS are collapsed into one update.
   *
   * @param {number} tabId
   */
  update(tabId) {
    // Clear any pending timer for this tab
    if (this._timers.has(tabId)) {
      clearTimeout(this._timers.get(tabId));
    }

    const timer = setTimeout(() => {
      this._timers.delete(tabId);
      this._applyBadge(tabId).catch(err =>
        bgLog.error('Badge update failed', err)
      );
    }, BADGE.DEBOUNCE_MS);

    this._timers.set(tabId, timer);
  }

  /**
   * Immediately reset the badge for a tab (on navigation).
   *
   * @param {number} tabId
   */
  async reset(tabId) {
    // Cancel any pending update
    if (this._timers.has(tabId)) {
      clearTimeout(this._timers.get(tabId));
      this._timers.delete(tabId);
    }
    try {
      await chrome.action.setBadgeText({ tabId, text: '' });
    } catch {
      // Tab may have been closed
    }
  }

  /**
   * Refresh badge from storage (called when switching tabs).
   *
   * @param {number} tabId
   */
  async refreshFromStorage(tabId) {
    await this._applyBadge(tabId);
  }

  /**
   * Apply the current count from session storage to the badge.
   *
   * @param {number} tabId
   * @private
   */
  async _applyBadge(tabId) {
    try {
      const session  = await sessionGet(SESSION_KEY);
      const tabStats = session[SESSION_KEY] ?? {};
      const count    = tabStats[tabId]?.count ?? 0;
      const text     = badgeText(count);
      const color    = count > 0 ? BADGE.COLOR_ACTIVE : '#64748b';

      await chrome.action.setBadgeText({ tabId, text });
      await chrome.action.setBadgeBackgroundColor({ tabId, color });
    } catch {
      // Tab may not exist anymore — safe to ignore
    }
  }

  /**
   * Set the badge to indicate the extension is disabled.
   *
   * @param {number} tabId
   */
  async setDisabled(tabId) {
    try {
      await chrome.action.setBadgeText({ tabId, text: 'OFF' });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE.COLOR_DISABLED });
    } catch {}
  }

  /**
   * Set the badge to indicate the extension is paused on this site.
   *
   * @param {number} tabId
   */
  async setPaused(tabId) {
    try {
      await chrome.action.setBadgeText({ tabId, text: '||' });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE.COLOR_PAUSED });
    } catch {}
  }
}
