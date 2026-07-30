/**
 * @file messages.js
 * @description Typed message bus for ShieldBlock Pro.
 * All inter-context communication (content ↔ background ↔ popup ↔ dashboard)
 * uses these message types. Never use raw strings for message routing.
 */

/**
 * All message type constants.
 * Naming convention: <SENDER>/<ACTION>
 */
export const MSG = Object.freeze({
  // ── Content → Background ───────────────────────────────────────────────────

  /** Content script initialized and ready. Payload: { tabId, url, domain } */
  CONTENT_READY: 'content/ready',

  /** Report a blocked/hidden item. Payload: { domain, type, category, count } */
  REPORT_STAT: 'content/stat',

  /** Popup was blocked by PopupBlocker. Payload: { url, tabId } */
  REPORT_POPUP_BLOCKED: 'content/popupBlocked',

  /** Redirect was intercepted. Payload: { from, to, tabId } */
  REPORT_REDIRECT_BLOCKED: 'content/redirectBlocked',

  /** User created a cosmetic rule via element picker. Payload: { selector, domain } */
  ADD_COSMETIC_RULE: 'content/addCosmetic',

  // ── Popup → Background ─────────────────────────────────────────────────────

  /** Get current tab status. Payload: { tabId }. Response: TabStatus */
  GET_TAB_STATUS: 'popup/getStatus',

  /** Toggle extension on/off. Payload: { enabled } */
  TOGGLE_ENABLED: 'popup/toggle',

  /** Pause blocking on domain. Payload: { domain, duration? } */
  PAUSE_SITE: 'popup/pause',

  /** Resume blocking on domain. Payload: { domain } */
  RESUME_SITE: 'popup/resume',

  /** Get recent blocked items. Response: RecentBlocked[] */
  GET_RECENT_BLOCKED: 'popup/getRecent',

  // ── Options → Background ───────────────────────────────────────────────────

  /** Update settings object. Payload: { settings } */
  UPDATE_SETTINGS: 'options/settings',

  /** Update whitelist array. Payload: { whitelist } */
  UPDATE_WHITELIST: 'options/whitelist',

  /** Update custom rules array. Payload: { rules } */
  UPDATE_CUSTOM_RULES: 'options/rules',

  /** Parse and import raw filter text. Payload: { rawText, source } */
  IMPORT_RULES: 'options/import',

  /** Reset all data to defaults. No payload. */
  RESET_ALL: 'options/reset',

  /** Toggle a static ruleset on/off. Payload: { rulesetId, enabled } */
  TOGGLE_RULESET: 'options/toggleRuleset',

  // ── Dashboard → Background ─────────────────────────────────────────────────

  /** Get aggregated statistics. Response: Stats */
  GET_STATS: 'dashboard/stats',

  /** Get history array. Response: HistoryDay[] */
  GET_HISTORY: 'dashboard/history',

  /** Clear all statistics. No payload. */
  CLEAR_STATS: 'dashboard/clear',

  /** Get top blocked domains. Response: DomainEntry[] */
  GET_TOP_DOMAINS: 'dashboard/topDomains',

  // ── Background → Content (via scripting.executeScript or stored messages) ──

  /** Tell content script its init config. Payload: ContentInitConfig */
  CONTENT_INIT: 'background/contentInit',

  /** Request content script to activate element picker mode */
  ACTIVATE_PICKER: 'background/activatePicker',

  /** Deactivate element picker mode */
  DEACTIVATE_PICKER: 'background/deactivatePicker'
});

/**
 * Send a message to the background service worker.
 * Handles the case where the service worker is sleeping (auto-retries once).
 *
 * @param {string} type - MSG constant
 * @param {object} [payload={}] - message payload
 * @returns {Promise<any>} - response from handler
 */
export async function sendToBackground(type, payload = {}) {
  try {
    return await chrome.runtime.sendMessage({ type, ...payload });
  } catch (err) {
    // If the service worker was terminated, this will throw.
    // In that case, the extension will simply not get a response.
    if (err.message?.includes('Could not establish connection')) {
      console.warn('[ShieldBlock] Background not available:', type);
      return null;
    }
    throw err;
  }
}

/**
 * Send a message to a specific tab's content scripts.
 *
 * @param {number} tabId - target tab ID
 * @param {string} type - MSG constant
 * @param {object} [payload={}] - message payload
 * @returns {Promise<any>}
 */
export async function sendToTab(tabId, type, payload = {}) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type, ...payload });
  } catch (err) {
    // Tab may not have content scripts (e.g., chrome:// pages)
    return null;
  }
}
