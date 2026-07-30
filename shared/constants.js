/**
 * @file constants.js
 * @description Central constants for ShieldBlock Pro.
 * Shared across background, popup, options, and dashboard.
 */

// ── Storage Schema Version ────────────────────────────────────────────────────
export const STORAGE_VERSION = 1;

// ── Rule ID Partitions ────────────────────────────────────────────────────────
// declarativeNetRequest requires globally unique integer IDs per dynamic rule.
// Static ruleset IDs are scoped within their JSON files and don't conflict.
export const RULE_ID_RANGES = Object.freeze({
  SESSION_WHITELIST: { start: 1,     end: 999   }, // "Pause on site" rules (cleared on restart)
  CUSTOM_USER_RULES: { start: 1000,  end: 9999  }, // User-defined network rules
  DYNAMIC_PATCH:     { start: 10000, end: 19999 }, // Reserved for future filter patches
  RESERVED:          { start: 20000, end: 29999 }  // Reserved for v2+
});

// ── Static Ruleset IDs ────────────────────────────────────────────────────────
export const STATIC_RULESET_IDS = Object.freeze({
  ADS:     'ads',
  PRIVACY: 'privacy'
});

// ── DNR Rule Priority ─────────────────────────────────────────────────────────
// Higher number = higher priority in declarativeNetRequest
export const RULE_PRIORITY = Object.freeze({
  BASE:             1,    // Bundled static blocking rules
  CUSTOM_BLOCK:     10,   // User-defined blocking rules
  CUSTOM_ALLOW:     100,  // User-defined exception rules
  WHITELIST:        1000  // "Pause on site" / permanent whitelist rules
});

// ── Resource Types ────────────────────────────────────────────────────────────
// Chrome declarativeNetRequest resource types
export const RESOURCE_TYPES = Object.freeze([
  'main_frame', 'sub_frame', 'stylesheet', 'script', 'image',
  'font', 'object', 'xmlhttprequest', 'ping', 'media',
  'websocket', 'webbundle', 'other'
]);

// Resource types used for ad/tracker blocking (excludes main_frame to not block navigation)
export const BLOCKABLE_RESOURCE_TYPES = Object.freeze([
  'sub_frame', 'script', 'image', 'xmlhttprequest',
  'ping', 'media', 'websocket', 'other'
]);

// ── Stats Limits ──────────────────────────────────────────────────────────────
export const STATS_LIMITS = Object.freeze({
  MAX_DOMAIN_ENTRIES:  100,  // Cap on per-domain stat tracking
  MAX_RECENT_BLOCKED:  50,   // Ring buffer size for recent activity
  MAX_HISTORY_DAYS:    30,   // Rolling daily history window
  MAX_CUSTOM_RULES:    500,  // Max user-defined rules
  MAX_WHITELIST_SIZE:  200,  // Max whitelist domains
  MAX_ERROR_LOG:       10    // Max persisted error entries
});

// ── Badge ─────────────────────────────────────────────────────────────────────
export const BADGE = Object.freeze({
  MAX_DISPLAY:       999,      // Numbers above this show as '999+'
  DEBOUNCE_MS:       150,      // Badge update debounce delay
  COLOR_ACTIVE:      '#818cf8', // Indigo — extension is active
  COLOR_PAUSED:      '#64748b', // Slate — paused on this site
  COLOR_DISABLED:    '#ef4444'  // Red — extension disabled globally
});

// ── Default Settings ──────────────────────────────────────────────────────────
export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  theme: 'auto',           // 'auto' | 'dark' | 'light'
  accentColor: '#818cf8',
  animations: true,
  filters: {
    ads:     true,
    privacy: true
  },
  blocking: {
    scripts:    true,
    images:     true,
    media:      true,
    thirdParty: true
  },
  cosmetic: {
    enabled:      true,
    cookieBanner: true,
    popups:       true,
    floatingAds:  true
  },
  antiRedirect: {
    enabled:    true,
    cleanUrls:  true
  },
  popupBlocker: {
    enabled: true
  },
  notifications: {
    enabled:             false, // Requires optional permission
    popupBlocked:        false,
    redirectBlocked:     false,
    highVolume:          false,
    highVolumeThreshold: 200
  }
});

// ── Tracking URL Parameters (stripped by AntiRedirect) ────────────────────────
export const TRACKING_PARAMS = Object.freeze([
  // UTM parameters (Google Analytics campaigns)
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'utm_id', 'utm_source_platform', 'utm_creative_format', 'utm_marketing_tactic',
  // Google
  'gclid', 'gclsrc', 'dclid', '_ga', '_gl',
  // Facebook / Meta
  'fbclid', 'fb_action_ids', 'fb_action_types', 'fb_source', 'fb_ref',
  // Microsoft / Bing
  'msclkid',
  // Twitter / X
  'twclid',
  // LinkedIn
  'li_fat_id',
  // Other trackers
  'mc_cid', 'mc_eid',   // Mailchimp
  'igshid',              // Instagram
  'yclid',               // Yandex
  'wickedid',            // Wicked Reports
  'zanpid',              // Zanox
  'origin',              // Sometimes used for tracking
  'ref',                 // Generic referral tracker
  'referrer',            // Generic referral
  '_hsenc', '_hsmi',     // HubSpot
  'mkt_tok',             // Marketo
  'hsa_cam', 'hsa_grp', 'hsa_mt', 'hsa_src', 'hsa_ad', 'hsa_acc',
  'hsa_net', 'hsa_kw', 'hsa_tgt', 'hsa_ver', // HubSpot Ads
  's_cid',               // Adobe Campaign
  'ncid',                // IBM
  'sxsrf', 'ved', 'uact' // Google search tracking
]);

// ── Alarm Names ───────────────────────────────────────────────────────────────
export const ALARMS = Object.freeze({
  DAILY_RESET: 'shieldblock_daily_reset'
});

// ── Context Menu IDs ──────────────────────────────────────────────────────────
export const CONTEXT_MENU = Object.freeze({
  WHITELIST_SITE:  'sb_whitelist_site',
  PAUSE_EXTENSION: 'sb_pause_extension',
  OPEN_DASHBOARD:  'sb_open_dashboard',
  SEPARATOR:       'sb_separator'
});

// ── Extension Pages ───────────────────────────────────────────────────────────
export const PAGES = Object.freeze({
  POPUP:     'popup/index.html',
  OPTIONS:   'options/index.html',
  DASHBOARD: 'dashboard/index.html'
});

// ── Category Labels ───────────────────────────────────────────────────────────
export const CATEGORIES = Object.freeze({
  ADS:        'ads',
  TRACKERS:   'trackers',
  ANALYTICS:  'analytics',
  ANNOYANCES: 'annoyances',
  UNKNOWN:    'unknown'
});

// ── Rule Types ────────────────────────────────────────────────────────────────
export const RULE_TYPES = Object.freeze({
  NETWORK:   'network',
  COSMETIC:  'cosmetic',
  EXCEPTION: 'exception'
});
