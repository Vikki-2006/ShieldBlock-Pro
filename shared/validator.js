/**
 * @file validator.js
 * @description Input validation and sanitisation for all user-provided data.
 * Every piece of user input passes through here before being stored or applied.
 */

import { RULE_TYPES } from './constants.js';

// ── Domain Validation ─────────────────────────────────────────────────────────

// RFC-compliant hostname pattern (covers most real domains)
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

/**
 * Validate a bare domain string (e.g. 'example.com', 'sub.example.co.uk').
 *
 * @param {string} domain
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateDomain(domain) {
  if (!domain || typeof domain !== 'string') {
    return { valid: false, error: 'Domain must be a non-empty string' };
  }
  const cleaned = domain.trim().toLowerCase().replace(/^www\./, '');
  if (cleaned.length > 253) {
    return { valid: false, error: 'Domain is too long' };
  }
  if (!DOMAIN_RE.test(cleaned)) {
    return { valid: false, error: 'Invalid domain format' };
  }
  return { valid: true };
}

// ── CSS Selector Validation ───────────────────────────────────────────────────

/**
 * Validate a CSS selector by attempting to use it in the browser engine.
 * Only works in content script / page contexts (not in service worker).
 *
 * @param {string} selector
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateCssSelector(selector) {
  if (!selector || typeof selector !== 'string') {
    return { valid: false, error: 'Selector must be a non-empty string' };
  }
  if (selector.length > 1000) {
    return { valid: false, error: 'Selector is too long (max 1000 chars)' };
  }
  try {
    // This will throw if the selector is invalid
    document.querySelector(selector);
    return { valid: true };
  } catch (err) {
    return { valid: false, error: `Invalid CSS selector: ${err.message}` };
  }
}

// ── Filter Rule Validation ────────────────────────────────────────────────────

const MAX_RULE_LENGTH = 500;

/**
 * Validate a single raw filter rule line.
 *
 * @param {string} rule - raw rule text (e.g. '||example.com^', '##.ad-banner')
 * @returns {{ valid: boolean, type?: string, error?: string }}
 */
export function validateFilterRule(rule) {
  if (!rule || typeof rule !== 'string') {
    return { valid: false, error: 'Rule must be a non-empty string' };
  }
  const trimmed = rule.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: 'Empty rule' };
  }
  if (trimmed.length > MAX_RULE_LENGTH) {
    return { valid: false, error: `Rule too long (max ${MAX_RULE_LENGTH} chars)` };
  }
  // Skip comment lines
  if (trimmed.startsWith('!') || trimmed.startsWith('[')) {
    return { valid: false, error: 'Comment line' };
  }
  // Detect rule type
  if (trimmed.includes('#@#')) {
    return { valid: true, type: RULE_TYPES.EXCEPTION };
  }
  if (trimmed.includes('##')) {
    return { valid: true, type: RULE_TYPES.COSMETIC };
  }
  if (trimmed.startsWith('@@')) {
    return { valid: true, type: RULE_TYPES.EXCEPTION };
  }
  // Basic network rule validation: must not be pure whitespace or only wildcards
  if (/^\*+$/.test(trimmed)) {
    return { valid: false, error: 'Wildcard-only rules are not supported' };
  }
  return { valid: true, type: RULE_TYPES.NETWORK };
}

// ── Batch Rule Validation ─────────────────────────────────────────────────────

/**
 * Validate an array of raw filter rules.
 *
 * @param {string[]} rules
 * @returns {{ valid: object[], invalid: object[] }}
 */
export function validateFilterRules(rules) {
  const valid = [];
  const invalid = [];
  for (const rule of rules) {
    const result = validateFilterRule(rule);
    if (result.valid) {
      valid.push({ raw: rule, type: result.type });
    } else {
      invalid.push({ raw: rule, error: result.error });
    }
  }
  return { valid, invalid };
}

// ── Settings Validation ───────────────────────────────────────────────────────

/**
 * Validate and sanitise a settings object.
 * Returns a cleaned settings object (missing fields get defaults).
 *
 * @param {any} settings
 * @returns {{ valid: boolean, cleaned?: object, errors: string[] }}
 */
export function validateSettings(settings) {
  const errors = [];
  if (!settings || typeof settings !== 'object') {
    return { valid: false, errors: ['Settings must be an object'] };
  }
  const cleaned = {};

  // enabled
  if ('enabled' in settings) {
    cleaned.enabled = Boolean(settings.enabled);
  }

  // theme
  if ('theme' in settings) {
    if (!['auto', 'dark', 'light'].includes(settings.theme)) {
      errors.push('Invalid theme value');
    } else {
      cleaned.theme = settings.theme;
    }
  }

  // accentColor
  if ('accentColor' in settings) {
    if (!/^#[0-9a-fA-F]{6}$/.test(settings.accentColor)) {
      errors.push('Invalid accent color (must be 6-digit hex)');
    } else {
      cleaned.accentColor = settings.accentColor;
    }
  }

  // animations
  if ('animations' in settings) {
    cleaned.animations = Boolean(settings.animations);
  }

  return {
    valid: errors.length === 0,
    cleaned,
    errors
  };
}

// ── Import Text Validation ────────────────────────────────────────────────────

const MAX_IMPORT_SIZE = 512 * 1024; // 512 KB

/**
 * Validate raw filter list text before parsing.
 *
 * @param {string} text
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateImportText(text) {
  if (!text || typeof text !== 'string') {
    return { valid: false, error: 'Import text must be a non-empty string' };
  }
  if (text.length > MAX_IMPORT_SIZE) {
    return { valid: false, error: `File too large (max ${MAX_IMPORT_SIZE / 1024}KB)` };
  }
  // Must have at least one non-comment line
  const hasRules = text.split('\n').some(l => {
    const t = l.trim();
    return t.length > 0 && !t.startsWith('!') && !t.startsWith('[');
  });
  if (!hasRules) {
    return { valid: false, error: 'No valid rules found in file' };
  }
  return { valid: true };
}
