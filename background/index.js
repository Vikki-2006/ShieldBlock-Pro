/**
 * @file background/index.js
 * @description Service Worker entry point for ShieldBlock Pro.
 *
 * CRITICAL: All event listeners MUST be registered at the top level (synchronously).
 * The MV3 service worker is ephemeral — it can be terminated after ~30s of inactivity.
 * Never store state in module-level variables; always read from chrome.storage.
 */

import { MessageRouter }      from './MessageRouter.js';
import { RuleEngine }          from './RuleEngine.js';
import { WhitelistManager }    from './WhitelistManager.js';
import { StatsEngine }         from './StatsEngine.js';
import { BadgeManager }        from './BadgeManager.js';
import { AlarmManager }        from './AlarmManager.js';
import { ContextMenuManager }  from './ContextMenuManager.js';
import { runMigrations }       from '../shared/storage.js';
import { bgLog }               from '../shared/logger.js';
import { PAGES, ALARMS }       from '../shared/constants.js';

// ── Module singletons ─────────────────────────────────────────────────────────
const ruleEngine       = new RuleEngine();
const whitelistManager = new WhitelistManager();
const statsEngine      = new StatsEngine();
const badgeManager     = new BadgeManager();
const alarmManager     = new AlarmManager(statsEngine);
const contextMenu      = new ContextMenuManager(whitelistManager);

// Pass deps to MessageRouter so handlers can call them
const router = new MessageRouter({
  ruleEngine,
  whitelistManager,
  statsEngine,
  badgeManager
});

// ── Install / Update ──────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  bgLog.info(`Extension ${reason}`, { version: chrome.runtime.getManifest().version });

  try {
    await runMigrations();
    await ruleEngine.init();
    await contextMenu.init();
    alarmManager.scheduleAll();

    if (reason === 'install') {
      // Open the options page on first install to let users configure the extension
      chrome.tabs.create({ url: chrome.runtime.getURL(PAGES.OPTIONS) });
    }
  } catch (err) {
    bgLog.error('onInstalled setup failed', err);
  }
});

// ── Service Worker Startup ────────────────────────────────────────────────────
// This runs every time the service worker wakes up (not just on install).

(async function onStartup() {
  try {
    await ruleEngine.init();
  } catch (err) {
    bgLog.error('Startup RuleEngine init failed', err);
  }
})();

// ── Message Routing ───────────────────────────────────────────────────────────
// Central message handler — delegates to MessageRouter.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Return true to keep the message channel open for async response
  router.handle(message, sender, sendResponse);
  return true;
});

// ── Navigation Events ─────────────────────────────────────────────────────────

chrome.webNavigation.onCommitted.addListener(async ({ tabId, url, frameId }) => {
  if (frameId !== 0) return; // Only main frame
  if (!url.startsWith('http')) return; // Skip chrome:// etc.

  try {
    await badgeManager.reset(tabId);
    await statsEngine.resetTabSession(tabId, url);
  } catch (err) {
    bgLog.error('onCommitted handler failed', err);
  }
});

// ── Tab Events ────────────────────────────────────────────────────────────────

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    await badgeManager.refreshFromStorage(tabId);
  } catch (err) {
    bgLog.error('onActivated handler failed', err);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  try {
    await statsEngine.cleanupTab(tabId);
  } catch (err) {
    bgLog.error('onRemoved handler failed', err);
  }
});

// ── Alarms ────────────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async ({ name }) => {
  if (name === ALARMS.DAILY_RESET) {
    bgLog.info('Daily reset alarm fired');
    await statsEngine.performDailyReset();
  }
});

// ── Keyboard Commands ─────────────────────────────────────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  bgLog.info('Command received', command);
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    if (command === 'toggle-extension') {
      await router.handle({ type: 'popup/toggle' }, { tab }, () => {});
    }
    if (command === 'pause-site') {
      const domain = new URL(tab.url).hostname.replace(/^www\./, '');
      await router.handle({ type: 'popup/pause', domain }, { tab }, () => {});
    }
    if (command === 'open-dashboard') {
      chrome.tabs.create({ url: chrome.runtime.getURL(PAGES.DASHBOARD) });
    }
  } catch (err) {
    bgLog.error('Command handler failed', err);
  }
});

// ── Context Menu Clicks ───────────────────────────────────────────────────────

chrome.contextMenus.onClicked.addListener((info, tab) => {
  contextMenu.handleClick(info, tab);
});

// ── Storage Changes ───────────────────────────────────────────────────────────
// Sync in-memory caches when storage changes (e.g. from options page).

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  if ('settings' in changes) {
    const { newValue } = changes.settings;
    if (newValue) ruleEngine.onSettingsChanged(newValue);
  }
  if ('whitelist' in changes) {
    const { newValue } = changes.whitelist;
    if (newValue) whitelistManager.updateCache(newValue);
  }
  if ('customRules' in changes) {
    const { newValue } = changes.customRules;
    if (newValue) ruleEngine.syncCustomRules(newValue);
  }
});
