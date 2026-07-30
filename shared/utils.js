/**
 * @file utils.js
 * @description Pure utility functions shared across all extension contexts.
 * No Chrome API dependencies — safe to import anywhere.
 */

// ── Domain Extraction ─────────────────────────────────────────────────────────

/**
 * Extract the registrable domain from a URL or hostname.
 * Examples: 'https://sub.example.com/path' → 'example.com'
 *
 * @param {string} urlOrHost
 * @returns {string} bare domain
 */
export function extractDomain(urlOrHost) {
  try {
    let host = urlOrHost;
    if (urlOrHost.includes('://')) {
      host = new URL(urlOrHost).hostname;
    }
    // Remove www. prefix
    host = host.replace(/^www\./, '');
    // Handle IP addresses (return as-is)
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return host;
    // Return the registrable domain (last two parts)
    const parts = host.split('.');
    return parts.length > 2 ? parts.slice(-2).join('.') : host;
  } catch {
    return urlOrHost || '';
  }
}

/**
 * Get the full hostname (without stripping subdomains).
 *
 * @param {string} url
 * @returns {string}
 */
export function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * Check if a domain matches a whitelist entry.
 * Supports exact match and subdomain matching.
 *
 * @param {string} domain - domain to check (e.g. 'sub.example.com')
 * @param {string[]} whitelist - array of bare domains (e.g. ['example.com'])
 * @returns {boolean}
 */
export function isDomainWhitelisted(domain, whitelist) {
  if (!domain || !Array.isArray(whitelist) || whitelist.length === 0) return false;
  const normalised = domain.replace(/^www\./, '').toLowerCase();
  return whitelist.some(entry => {
    const e = entry.toLowerCase();
    return normalised === e || normalised.endsWith('.' + e);
  });
}

// ── Number Formatting ─────────────────────────────────────────────────────────

/**
 * Format a large number for display: 1234567 → '1.2M'
 *
 * @param {number} n
 * @returns {string}
 */
export function formatCount(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

/**
 * Format a number with comma separators: 12345 → '12,345'
 *
 * @param {number} n
 * @returns {string}
 */
export function formatNumber(n) {
  return new Intl.NumberFormat().format(Math.round(n));
}

// ── Date Utilities ────────────────────────────────────────────────────────────

/**
 * Get today's date string in YYYY-MM-DD format.
 *
 * @returns {string}
 */
export function todayString() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Get the last N days as YYYY-MM-DD strings (today last).
 *
 * @param {number} n
 * @returns {string[]}
 */
export function lastNDays(n) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (n - 1 - i));
    return d.toISOString().slice(0, 10);
  });
}

/**
 * Format a date string for human display: '2024-01-15' → 'Jan 15'
 *
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {string}
 */
export function formatDateShort(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Format a timestamp as human-readable relative time.
 *
 * @param {number} ts - Unix milliseconds
 * @returns {string} e.g. 'just now', '2 min ago', '3 hours ago'
 */
export function timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60_000)  return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
}

// ── String Utilities ──────────────────────────────────────────────────────────

/**
 * Truncate a string at maxLen with ellipsis.
 *
 * @param {string} str
 * @param {number} maxLen
 * @returns {string}
 */
export function truncate(str, maxLen = 40) {
  return str.length > maxLen ? str.slice(0, maxLen - 1) + '…' : str;
}

/**
 * Sanitise a domain string: lowercase, remove protocol/path.
 *
 * @param {string} input
 * @returns {string}
 */
export function sanitiseDomain(input) {
  const cleaned = input.trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./, '');
  return cleaned;
}

/**
 * Escape HTML entities in a string (prevent XSS in text output).
 *
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Array Utilities ───────────────────────────────────────────────────────────

/**
 * Update a bounded frequency map, evicting lowest-count entries when at capacity.
 * Used for per-domain statistics.
 *
 * @param {object} map - { [key]: count }
 * @param {string} key - entry to increment
 * @param {number} maxSize - maximum number of entries
 * @returns {object} updated map
 */
export function updateFrequencyMap(map, key, maxSize = 100) {
  const updated = { ...map };
  updated[key] = (updated[key] ?? 0) + 1;

  if (Object.keys(updated).length > maxSize) {
    // Evict the entry with the lowest count
    const minKey = Object.entries(updated).reduce((a, b) => a[1] < b[1] ? a : b)[0];
    delete updated[minKey];
  }
  return updated;
}

/**
 * Sort an object by values (descending) and return as array of [key, value] pairs.
 *
 * @param {object} obj
 * @param {number} [limit]
 * @returns {[string, number][]}
 */
export function sortedEntries(obj, limit) {
  const entries = Object.entries(obj).sort(([, a], [, b]) => b - a);
  return limit ? entries.slice(0, limit) : entries;
}

/**
 * Deep-clone an object using JSON serialisation.
 *
 * @param {any} obj
 * @returns {any}
 */
export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// ── Badge Utilities ───────────────────────────────────────────────────────────

/**
 * Convert a block count to a badge display string.
 *
 * @param {number} count
 * @returns {string}
 */
export function badgeText(count) {
  if (count <= 0) return '';
  if (count > 999) return '999+';
  return String(count);
}

// ── Rule ID Generation ────────────────────────────────────────────────────────

/**
 * Generate a unique rule ID within a given range.
 * Uses the current time to reduce collision probability.
 *
 * @param {number} start - range start (inclusive)
 * @param {number} end - range end (inclusive)
 * @returns {number}
 */
export function generateRuleId(start, end) {
  return start + (Date.now() % (end - start + 1));
}

/**
 * Generate a unique string ID for custom rules (e.g., 'cr_1705123456789').
 *
 * @returns {string}
 */
export function generateCustomRuleId() {
  return `cr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}
