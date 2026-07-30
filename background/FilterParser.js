/**
 * @file background/FilterParser.js
 * @description Multi-stage EasyList-compatible filter parser.
 * Converts raw filter list text into structured rule objects
 * for use by the RuleEngine.
 */

import { parseLog } from '../shared/logger.js';
import { RULE_TYPES, BLOCKABLE_RESOURCE_TYPES } from '../shared/constants.js';

// ── Resource type map (EasyList → DNR) ───────────────────────────────────────
const TYPE_MAP = {
  'script':         'script',
  'image':          'image',
  'stylesheet':     'stylesheet',
  'object':         'object',
  'xmlhttprequest': 'xmlhttprequest',
  'xhr':            'xmlhttprequest',
  'subdocument':    'sub_frame',
  'frame':          'sub_frame',
  'media':          'media',
  'font':           'font',
  'websocket':      'websocket',
  'ping':           'ping',
  'other':          'other'
};

export class FilterParser {
  /**
   * Parse a raw filter list text string.
   *
   * @param {string} rawText
   * @returns {{ network: object[], cosmetic: object[], errors: number }}
   */
  parse(rawText) {
    if (!rawText || typeof rawText !== 'string') {
      return { network: [], cosmetic: [], errors: 0 };
    }

    const lines = rawText.split(/\r?\n/);
    const network  = [];
    const cosmetic = [];
    let errors = 0;

    for (const rawLine of lines) {
      const line = rawLine.trim();

      // Skip empty lines and comments
      if (!line || line.startsWith('!') || line.startsWith('[')) continue;

      try {
        const result = this._parseLine(line);
        if (!result) continue;

        if (result.type === RULE_TYPES.COSMETIC) {
          cosmetic.push(result);
        } else {
          network.push(result);
        }
      } catch {
        errors++;
      }
    }

    parseLog.info('Parse complete', { network: network.length, cosmetic: cosmetic.length, errors });
    return { network, cosmetic, errors };
  }

  /**
   * Parse a single filter line.
   *
   * @param {string} line
   * @returns {object|null}
   */
  _parseLine(line) {
    // Cosmetic exception: domain#@#selector
    if (line.includes('#@#')) {
      return this._parseCosmeticException(line);
    }
    // Cosmetic rule: [domain]##selector
    if (line.includes('##')) {
      return this._parseCosmeticRule(line);
    }
    // Network exception: @@rule
    if (line.startsWith('@@')) {
      return this._parseNetworkRule(line.slice(2), true);
    }
    // Skip pure regex rules (too complex for DNR conversion)
    if (line.startsWith('/') && line.endsWith('/')) {
      return null;
    }
    // Network blocking rule
    return this._parseNetworkRule(line, false);
  }

  /**
   * Parse a network rule (blocking or exception).
   *
   * @param {string} line - rule text (without @@ prefix for exceptions)
   * @param {boolean} isException
   * @returns {object|null}
   */
  _parseNetworkRule(line, isException) {
    // Split off options after last $ not preceded by a pattern escape
    const dollarIdx = this._findOptionsDelimiter(line);
    const pattern   = dollarIdx >= 0 ? line.slice(0, dollarIdx) : line;
    const optStr    = dollarIdx >= 0 ? line.slice(dollarIdx + 1) : '';
    const options   = this._parseOptions(optStr);

    // Build urlFilter from pattern
    const urlFilter = this._patternToUrlFilter(pattern);
    if (!urlFilter) return null;

    // Determine resource types
    const resourceTypes = options.types.length > 0
      ? options.types.filter(t => BLOCKABLE_RESOURCE_TYPES.includes(t))
      : [...BLOCKABLE_RESOURCE_TYPES];

    if (resourceTypes.length === 0) return null;

    return {
      raw:  (isException ? '@@' : '') + line,
      type: isException ? RULE_TYPES.EXCEPTION : RULE_TYPES.NETWORK,
      urlFilter,
      resourceTypes,
      domainOptions: options.domains,
      thirdPartyOnly: options.thirdParty
    };
  }

  /**
   * Parse a cosmetic hiding rule: [domain##selector].
   *
   * @param {string} line
   * @returns {object|null}
   */
  _parseCosmeticRule(line) {
    const idx = line.indexOf('##');
    const domainsStr = line.slice(0, idx);
    const selector   = line.slice(idx + 2).trim();

    if (!selector) return null;

    // Basic selector safety check (no dangerous characters)
    if (selector.includes('{') || selector.includes('}') || selector.includes('<')) {
      return null;
    }

    const domains = domainsStr
      ? domainsStr.split(',').map(d => d.trim().toLowerCase()).filter(Boolean)
      : [];

    return {
      raw:      line,
      type:     RULE_TYPES.COSMETIC,
      selector,
      domains
    };
  }

  /**
   * Parse a cosmetic exception: [domain#@#selector].
   * These are skipped (we don't un-hide elements).
   *
   * @param {string} _line
   * @returns {null}
   */
  _parseCosmeticException(_line) {
    return null; // Cosmetic exceptions not applied in content scripts
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Find the index of the options delimiter ($) in a filter pattern.
   * Must not be inside a regex segment.
   *
   * @param {string} line
   * @returns {number} index, or -1 if not found
   */
  _findOptionsDelimiter(line) {
    // Scan from end to find $ that is preceded by a valid pattern char
    for (let i = line.length - 1; i >= 0; i--) {
      if (line[i] === '$') {
        // Make sure the $ is not at the start (which would be a pattern char)
        if (i > 0) return i;
      }
    }
    return -1;
  }

  /**
   * Parse the options string (after $) into a structured object.
   *
   * @param {string} optStr - e.g. 'script,third-party,domain=example.com|~other.com'
   * @returns {{ types: string[], thirdParty: boolean|null, domains: object }}
   */
  _parseOptions(optStr) {
    const result = { types: [], thirdParty: null, domains: { include: [], exclude: [] } };
    if (!optStr) return result;

    for (const opt of optStr.split(',')) {
      const o = opt.trim().toLowerCase();
      if (!o) continue;

      if (o === 'third-party' || o === '3p') {
        result.thirdParty = true;
      } else if (o === '~third-party' || o === '~3p') {
        result.thirdParty = false;
      } else if (o.startsWith('domain=')) {
        const domainStr = o.slice(7);
        for (const d of domainStr.split('|')) {
          if (d.startsWith('~')) {
            result.domains.exclude.push(d.slice(1));
          } else if (d) {
            result.domains.include.push(d);
          }
        }
      } else if (TYPE_MAP[o]) {
        result.types.push(TYPE_MAP[o]);
      } else if (o.startsWith('~') && TYPE_MAP[o.slice(1)]) {
        // Negated type — skip for now (DNR doesn't support type negation easily)
      }
    }

    return result;
  }

  /**
   * Convert an EasyList URL pattern to a declarativeNetRequest urlFilter.
   *
   * @param {string} pattern
   * @returns {string|null}
   */
  _patternToUrlFilter(pattern) {
    if (!pattern) return null;

    let filter = pattern;

    // Already in DNR format?
    if (filter.startsWith('||') || filter.startsWith('|')) {
      // DNR supports || and | anchors natively
      return filter;
    }

    // Plain domain: wrap with || and ^
    // e.g. 'ads.example.com' → '||ads.example.com^'
    if (/^[a-z0-9.-]+$/i.test(filter)) {
      return `||${filter}^`;
    }

    // Wildcard patterns: replace * with * (DNR supports wildcards)
    // Sanitise: remove characters that DNR urlFilter doesn't support well
    filter = filter.replace(/\^/g, '*');

    // Must be at least 4 chars to be meaningful
    if (filter.length < 4) return null;

    return filter;
  }
}
