/**
 * @file storage.js
 * @description Type-safe Chrome storage API wrapper with schema versioning and migration.
 * All reads return defaults for missing keys; all writes are error-guarded.
 */

import { DEFAULT_SETTINGS, STORAGE_VERSION, STATS_LIMITS } from './constants.js';

// ── Schema ────────────────────────────────────────────────────────────────────

/**
 * Default storage schema. All keys must have a defined default.
 */
const DEFAULTS = {
  _version:    STORAGE_VERSION,
  settings:    { ...DEFAULT_SETTINGS },
  whitelist:   [],
  customRules: [],
  stats: {
    total:      0,
    byType:     { script: 0, image: 0, stylesheet: 0, xmlhttprequest: 0, media: 0, ping: 0, other: 0 },
    byDomain:   {},
    byCategory: { ads: 0, trackers: 0, analytics: 0, annoyances: 0, unknown: 0 }
  },
  history: {
    days:          [],
    lastResetDate: ''
  },
  errorLog: []
};

// ── Core API ──────────────────────────────────────────────────────────────────

/**
 * Get one or more keys from chrome.storage.local.
 * Missing keys are filled with their defaults.
 *
 * @param {string|string[]} keys - key or array of keys to retrieve
 * @returns {Promise<object>} - retrieved values (with defaults for missing)
 */
export async function storageGet(keys) {
  const keyArr = Array.isArray(keys) ? keys : [keys];

  // Build defaults object for requested keys
  const defaults = {};
  for (const k of keyArr) {
    if (k in DEFAULTS) defaults[k] = deepClone(DEFAULTS[k]);
  }

  try {
    const result = await chrome.storage.local.get(keyArr);
    return { ...defaults, ...result };
  } catch (err) {
    console.error('[ShieldBlock:storage] get failed', err);
    return defaults;
  }
}

/**
 * Set one or more keys in chrome.storage.local.
 *
 * @param {object} data - key-value pairs to store
 * @returns {Promise<boolean>} - true on success
 */
export async function storageSet(data) {
  try {
    await chrome.storage.local.set(data);
    return true;
  } catch (err) {
    console.error('[ShieldBlock:storage] set failed', err, Object.keys(data));
    return false;
  }
}

/**
 * Remove keys from chrome.storage.local.
 *
 * @param {string|string[]} keys
 * @returns {Promise<boolean>}
 */
export async function storageRemove(keys) {
  try {
    await chrome.storage.local.remove(Array.isArray(keys) ? keys : [keys]);
    return true;
  } catch (err) {
    console.error('[ShieldBlock:storage] remove failed', err);
    return false;
  }
}

// ── Session Storage API ───────────────────────────────────────────────────────
// chrome.storage.session is cleared on browser restart.
// Used for ephemeral per-tab data that doesn't need to survive restarts.

/**
 * Get session data (ephemeral, cleared on browser restart).
 *
 * @param {string|string[]} keys
 * @returns {Promise<object>}
 */
export async function sessionGet(keys) {
  const keyArr = Array.isArray(keys) ? keys : [keys];
  try {
    return await chrome.storage.session.get(keyArr);
  } catch (err) {
    // chrome.storage.session may not be available in older Chrome versions
    console.warn('[ShieldBlock:storage] session.get failed', err);
    return {};
  }
}

/**
 * Set session data.
 *
 * @param {object} data
 * @returns {Promise<boolean>}
 */
export async function sessionSet(data) {
  try {
    await chrome.storage.session.set(data);
    return true;
  } catch (err) {
    console.warn('[ShieldBlock:storage] session.set failed', err);
    return false;
  }
}

// ── Typed Getters ─────────────────────────────────────────────────────────────

/** @returns {Promise<object>} merged settings with defaults */
export async function getSettings() {
  const { settings } = await storageGet('settings');
  return deepMerge(deepClone(DEFAULTS.settings), settings);
}

/** @returns {Promise<string[]>} whitelist domains */
export async function getWhitelist() {
  const { whitelist } = await storageGet('whitelist');
  return Array.isArray(whitelist) ? whitelist : [];
}

/** @returns {Promise<object[]>} custom rules array */
export async function getCustomRules() {
  const { customRules } = await storageGet('customRules');
  return Array.isArray(customRules) ? customRules : [];
}

/** @returns {Promise<object>} aggregated statistics */
export async function getStats() {
  const { stats } = await storageGet('stats');
  return deepMerge(deepClone(DEFAULTS.stats), stats);
}

/** @returns {Promise<object>} history object */
export async function getHistory() {
  const { history } = await storageGet('history');
  return deepMerge(deepClone(DEFAULTS.history), history);
}

// ── Typed Setters ─────────────────────────────────────────────────────────────

/** @param {object} settings */
export async function saveSettings(settings) {
  return storageSet({ settings });
}

/** @param {string[]} whitelist */
export async function saveWhitelist(whitelist) {
  return storageSet({ whitelist });
}

/** @param {object[]} rules */
export async function saveCustomRules(rules) {
  const capped = rules.slice(0, STATS_LIMITS.MAX_CUSTOM_RULES);
  return storageSet({ customRules: capped });
}

/** @param {object} stats */
export async function saveStats(stats) {
  return storageSet({ stats });
}

/** @param {object} history */
export async function saveHistory(history) {
  return storageSet({ history });
}

// ── Schema Migration ──────────────────────────────────────────────────────────

/**
 * Run migrations if the stored schema version is older than current.
 * Called once on service worker startup.
 */
export async function runMigrations() {
  // Query raw storage directly from chrome.storage.local to bypass defaults injection
  const raw = await chrome.storage.local.get('_version');
  const _version = raw._version;
  if (_version === STORAGE_VERSION) return; // Up to date

  // v0 → v1: Initialize with defaults
  if (!_version || _version < 1) {
    const existing = await chrome.storage.local.get(Object.keys(DEFAULTS));
    const migrated = {};
    for (const [k, v] of Object.entries(DEFAULTS)) {
      migrated[k] = deepMerge(deepClone(v), existing[k] ?? {});
    }
    migrated._version = 1;
    await chrome.storage.local.set(migrated);
  }
}

/**
 * Reset all storage to factory defaults.
 */
export async function resetAll() {
  await chrome.storage.local.clear();
  await storageSet(deepClone(DEFAULTS));
  try { await chrome.storage.session.clear(); } catch {}
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function deepMerge(target, source) {
  if (!source || typeof source !== 'object') return target;
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && !Array.isArray(v) &&
        target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) {
      deepMerge(target[k], v);
    } else if (v !== undefined) {
      target[k] = v;
    }
  }
  return target;
}
