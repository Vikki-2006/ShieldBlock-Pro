/**
 * @file background/index.js
 * @description Service Worker entry point for ShieldBlock Pro.
 *
 * CRITICAL: All event listeners MUST be registered at the top level (synchronously).
 * The MV3 service worker is ephemeral — it can be terminated after ~30s of inactivity.
 * Never store state in module-level variables; always read from chrome.storage.
 */

import { MessageRouter } from './MessageRouter.js';
import { RuleEngine } from './RuleEngine.js';
import { WhitelistManager } from './WhitelistManager.js';
import { StatsEngine } from './StatsEngine.js';
import { BadgeManager } from './BadgeManager.js';
import { AlarmManager } from './AlarmManager.js';
import { ContextMenuManager } from './ContextMenuManager.js';
import { runMigrations } from '../shared/storage.js';
import { bgLog } from '../shared/logger.js';
import { PAGES, ALARMS } from '../shared/constants.js';
import { extractDomain } from '../shared/utils.js';

// ── Module singletons ─────────────────────────────────────────────────────────
const ruleEngine = new RuleEngine();
const whitelistManager = new WhitelistManager();
const statsEngine = new StatsEngine();
const badgeManager = new BadgeManager();
const alarmManager = new AlarmManager(statsEngine);
const contextMenu = new ContextMenuManager(whitelistManager, ruleEngine);

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
      await router.handle({ type: 'popup/toggle' }, { tab }, () => { });
    }
    if (command === 'pause-site') {
      const domain = new URL(tab.url).hostname.replace(/^www\./, '');
      await router.handle({ type: 'popup/pause', domain }, { tab }, () => { });
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

const ruleMatchedEvent = chrome.declarativeNetRequest.onRuleMatchedDebug || chrome.declarativeNetRequest.onRuleMatched;
if (ruleMatchedEvent) {
  ruleMatchedEvent.addListener(async (info) => {
    try {
      // Chrome MV3 onRuleMatchedDebug info shape:
      //   Newer Chrome:  { request: { tabId, url, type, initiator }, rule: { rulesetId, ruleId } }
      //   Older Chrome:  { tabId, url, type, rule: { rulesetId, ruleId } }
      // Always normalise to a flat shape so the rest of the handler is version-agnostic.
      const req      = info.request ?? info;           // prefer info.request
      const tabId    = req.tabId    ?? info.tabId;
      const url      = req.url      ?? info.url ?? '';
      const resType  = req.type     ?? info.type ?? 'other';
      const rule     = info.rule    ?? {};
      const rulesetId = rule.rulesetId ?? '';

      if (!url || !tabId || tabId === -1) return;

      const domain = extractDomain(url);

      // Determine category based on rulesetId and URL content
      let category = 'unknown';
      if (rulesetId === 'ads') {
        category = 'ads';
      } else if (rulesetId === 'privacy') {
        // Heuristic: analytics tools vs general trackers
        const analyticsKeywords = ['analytics', 'gtm', 'gtag', 'metric', 'telemetry', 'measure'];
        const isAnalytics = analyticsKeywords.some(kw => url.includes(kw) || domain.includes(kw));
        category = isAnalytics ? 'analytics' : 'trackers';
      } else {
        // Dynamic / custom rules — guess from domain
        const adKeywords = ['ad', 'ads', 'advert', 'banner', 'sponsor', 'promo'];
        category = adKeywords.some(kw => domain.includes(kw)) ? 'ads' : 'trackers';
      }

      bgLog.info('DNR Block matched', { url, domain, rulesetId, tabId, category });

      await statsEngine.recordBlock({
        tabId,
        domain,
        type: resType || 'other',
        category,
        count: 1
      });

      await badgeManager.update(tabId);
    } catch (err) {
      bgLog.error('onRuleMatched handler failed', err);
    }
  });
}


