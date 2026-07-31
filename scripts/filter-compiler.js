/**
 * @file scripts/filter-compiler.js
 * @description Professional EasyList → Chrome DNR compiler for ShieldBlock Pro.
 *
 * Pipeline:
 *   1. Read custom filter files (filters/ads.txt, filters/privacy.txt)
 *   2. Read cached remote filter lists (filters/cache/*.txt)
 *   3. Parse every supported EasyList rule type
 *   4. Deduplicate globally
 *   5. Sort by specificity (domain rules first)
 *   6. Cap at Chrome DNR static rule limits
 *   7. Assign sequential IDs
 *   8. Validate schema
 *   9. Write JSON rule files
 *
 * Supported EasyList syntax:
 *   ||domain.com^                 Domain-level block
 *   ||domain.com/path/*           Path with wildcard
 *   ||domain.com^$opt1,opt2       Block with options
 *   ||domain.com^$domain=x.com   Initiator domain filter
 *   ||domain.com^$third-party     Third-party only
 *   ||domain.com^$important       High priority (priority 2)
 *   ||domain.com^$match-case      Case-sensitive urlFilter
 *   /pattern/*$options            Generic URL pattern
 *
 * Skipped syntax (unsupported in Chrome DNR):
 *   @@||...           Exception / allowlist rules
 *   ##selector        Cosmetic (element hide) rules
 *   #@#selector       Exception cosmetic rules
 *   ##+js(...)        Scriptlet rules
 *   #?#selector       Procedural CSS selector rules
 *   ##^elem           HTML filtering rules
 *   $csp=             Content-Security-Policy injection
 *   $redirect=        Resource redirect (complex)
 *   $removeparam=     Query parameter removal (complex)
 *   /regex/           Regex patterns (skip to avoid regex limit)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');

// ── Chrome DNR Constants ─────────────────────────────────────────────────────

/**
 * Total static rule limit per extension (Chrome 120+).
 * We target 28,000 to leave a 2,000-rule buffer.
 */
const CHROME_MAX_STATIC_RULES = 30_000;
const SAFE_MAX_TOTAL          = 28_000;

/**
 * All Chrome DNR resource types.
 * Used as the default when no $type options are specified.
 */
const ALL_RESOURCE_TYPES = [
  'script', 'image', 'stylesheet', 'object', 'xmlhttprequest',
  'sub_frame', 'ping', 'media', 'websocket', 'font', 'other'
];

/** Narrower set for tracker/analytics rules (reduces false positives on pages). */
const TRACKER_RESOURCE_TYPES = [
  'script', 'image', 'xmlhttprequest', 'ping', 'other'
];

/** Valid DNR resource type names. */
const VALID_DNR_TYPES = new Set([
  'main_frame', 'sub_frame', 'stylesheet', 'script', 'image',
  'font', 'object', 'xmlhttprequest', 'ping', 'csp_report',
  'media', 'websocket', 'webtransport', 'webbundle', 'other'
]);

/** Map from EasyList option name → Chrome DNR resource type. */
const TYPE_MAP = {
  script:           'script',
  image:            'image',
  stylesheet:       'stylesheet',
  object:           'object',
  xmlhttprequest:   'xmlhttprequest',
  xhr:              'xmlhttprequest',
  subdocument:      'sub_frame',
  sub_frame:        'sub_frame',
  ping:             'ping',
  media:            'media',
  websocket:        'websocket',
  font:             'font',
  other:            'other',
  // Aliases used in some filter lists
  'css':            'stylesheet',
  'frame':          'sub_frame',
  'object-subrequest': 'object'
};

// ── Ruleset Configuration ─────────────────────────────────────────────────────

/**
 * Each entry describes one output ruleset and its input sources.
 * Sources are processed in order; custom files take highest priority.
 */
const RULESET_CONFIGS = [
  {
    name:         'Ads',
    category:     'ads',
    sources: [
      { label: 'Custom Ads',    path: 'filters/ads.txt',                 optional: false }
    ],
    output:       'rules/static_rules.json',
    maxRules:     450,
    defaultTypes: ALL_RESOURCE_TYPES
  },
  {
    name:         'Privacy',
    category:     'privacy',
    sources: [
      { label: 'Custom Privacy', path: 'filters/privacy.txt',              optional: false }
    ],
    output:       'rules/privacy_rules.json',
    maxRules:     350,
    defaultTypes: TRACKER_RESOURCE_TYPES
  }
];

// ── EasyList Parser ────────────────────────────────────────────────────────────

/**
 * Returns true if the line is a comment, blank, or section header.
 * @param {string} line
 */
function isComment(line) {
  return !line || line.startsWith('!') || line.startsWith('#') || line.startsWith('[');
}

/**
 * Returns true if the line contains a cosmetic or scriptlet rule.
 * @param {string} line
 */
function isCosmeticOrScriptlet(line) {
  return (
    line.includes('##')   ||
    line.includes('#@#')  ||
    line.includes('#?#')  ||
    line.includes('#$#')  ||
    line.includes('##+js') ||
    line.includes('#+js') ||
    line.includes('##^')
  );
}

/**
 * Returns true if the line is an exception (@@) rule.
 * We skip these — we're building a block-list, not an allowlist.
 * @param {string} line
 */
function isException(line) {
  return line.startsWith('@@');
}

/**
 * Returns true if the line is a regex pattern (/pattern/).
 * We skip these to avoid the 1,000-regex-rule Chrome limit.
 * @param {string} line
 */
function isRegex(line) {
  if (!line.startsWith('/')) return false;
  const end = line.lastIndexOf('/');
  return end > 0 && end > 1;
}

/**
 * Parse the options string (the part after `$`) into a structured object.
 *
 * @param {string|null}  optStr        The raw options string (e.g. "script,third-party")
 * @param {string[]}     defaultTypes  Default resource types for this ruleset
 * @returns {{ resourceTypes:string[], domainType?:string, initiatorDomains?:string[], 
 *             excludedInitiatorDomains?:string[], priority?:number, 
 *             isUrlFilterCaseSensitive?:boolean } | null}
 *          Returns null to signal "skip this rule entirely".
 */
function parseOptions(optStr, defaultTypes) {
  if (!optStr) {
    return { resourceTypes: defaultTypes };
  }

  // Tokenise the option string
  const tokens      = optStr.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
  const includeTypes = [];
  const excludeTypes = [];
  let   domainType  = undefined;
  const initDomains = [];
  const exclDomains = [];
  let   priority    = 1;
  let   caseSensitive = false;
  let   skip        = false;

  // Hard-skip options that require complex DNR features we don't implement
  const SKIP_OPTIONS = new Set([
    'redirect', 'redirect-rule', 'csp', 'removeparam', 'replace',
    'rewrite', 'inline-script', 'inline-font', 'empty', 'mp4',
    'badfilter', 'app', 'network', 'specifichide', 'genericblock',
    'all'
  ]);

  // Benign options we can safely ignore without skipping the rule
  const IGNORE_OPTIONS = new Set([
    'popup', 'document', 'elemhide', 'generichide', 'object-subrequest',
    'collapse', 'sitekey', 'content', 'xbl', 'dtd', 'popunder'
  ]);

  for (const token of tokens) {
    // ── Skip triggers ──────────────────────────────────────────────────────
    const rawToken = token.startsWith('~') ? token.slice(1) : token;

    if (SKIP_OPTIONS.has(rawToken) || SKIP_OPTIONS.has(token)) {
      skip = true;
      break;
    }

    if (IGNORE_OPTIONS.has(rawToken)) continue;

    // ── Domain type ────────────────────────────────────────────────────────
    if (token === 'third-party' || token === '3p') {
      domainType = 'thirdParty';
      continue;
    }
    if (token === '~third-party' || token === '~3p' || token === 'first-party' || token === '1p') {
      domainType = 'firstParty';
      continue;
    }

    // ── Important (higher priority) ────────────────────────────────────────
    if (token === 'important') {
      priority = 2;
      continue;
    }

    // ── Match-case ─────────────────────────────────────────────────────────
    if (token === 'match-case') {
      caseSensitive = true;
      continue;
    }

    // ── domain= option → initiatorDomains / excludedInitiatorDomains ──────
    if (token.startsWith('domain=')) {
      const domainSpec = optStr.split(',').find(t => t.trim().startsWith('domain='));
      if (domainSpec) {
        const domainsStr = domainSpec.trim().slice(7); // remove 'domain='
        for (const d of domainsStr.split('|')) {
          const dn = d.trim();
          if (!dn) continue;
          if (dn.startsWith('~')) {
            exclDomains.push(dn.slice(1));
          } else {
            initDomains.push(dn);
          }
        }
      }
      continue;
    }

    // ── Resource type ──────────────────────────────────────────────────────
    if (token.startsWith('~')) {
      const mapped = TYPE_MAP[token.slice(1)];
      if (mapped) excludeTypes.push(mapped);
      continue; // Unknown negated type → ignore safely
    }

    const mappedType = TYPE_MAP[token];
    if (mappedType) {
      includeTypes.push(mappedType);
      continue;
    }

    // Unknown positive option → skip the rule to avoid broken rules
    skip = true;
    break;
  }

  if (skip) return null;

  // Resolve final resource types
  let types = includeTypes.length > 0 ? [...new Set(includeTypes)] : [...defaultTypes];
  if (excludeTypes.length > 0) {
    types = types.filter(t => !excludeTypes.includes(t));
  }
  if (types.length === 0) return null;

  const result = { resourceTypes: types, priority };
  if (domainType)          result.domainType = domainType;
  if (initDomains.length)  result.initiatorDomains = initDomains;
  if (exclDomains.length)  result.excludedInitiatorDomains = exclDomains;
  if (caseSensitive)       result.isUrlFilterCaseSensitive = true;
  return result;
}

/**
 * Build a deduplication key that captures the "logical identity" of a rule.
 * Rules with the same urlFilter AND same domainType are considered duplicates.
 * Different resource types for the same domain → we keep the most general (first seen).
 *
 * @param {string}  urlFilter
 * @param {string?} domainType
 * @returns {string}
 */
function dedupKey(urlFilter, domainType) {
  return `${urlFilter.toLowerCase()}|${domainType ?? ''}`;
}

/**
 * Parse a single raw filter-list line into a structured DNR condition,
 * or return null if the line should be skipped.
 *
 * @param {string}   rawLine
 * @param {string[]} defaultTypes
 * @returns {{ urlFilter:string, resourceTypes:string[], domainType?:string,
 *             initiatorDomains?:string[], excludedInitiatorDomains?:string[],
 *             priority?:number, isUrlFilterCaseSensitive?:boolean } | null}
 */
function parseLine(rawLine, defaultTypes) {
  const line = rawLine.trim();
  if (!line)                    return null;
  if (isComment(line))          return null;
  if (isCosmeticOrScriptlet(line)) return null;
  if (isException(line))        return null;
  if (isRegex(line))            return null;

  // ── Separate URL pattern from $options ───────────────────────────────────
  let urlPart   = line;
  let optionStr = null;

  // Find the '$' that starts the options section.
  // We look for the LAST '$' because a URL path may contain '$'.
  // Options are identified by only containing [a-z0-9,~\-_=.|~] after the '$'.
  const lastDollar = line.lastIndexOf('$');
  if (lastDollar > 0 && lastDollar < line.length - 1) {
    const candidate = line.slice(lastDollar + 1);
    // A valid options string only contains these characters
    if (/^[a-zA-Z0-9,~\-_=.|~]+$/.test(candidate)) {
      urlPart   = line.slice(0, lastDollar).trim();
      optionStr = candidate.toLowerCase();
    }
  }

  if (!urlPart) return null;

  // ── Parse options ─────────────────────────────────────────────────────────
  const opts = parseOptions(optionStr, defaultTypes);
  if (!opts) return null;

  // ── Build urlFilter ───────────────────────────────────────────────────────
  let urlFilter;

  if (urlPart.startsWith('||')) {
    // Domain anchor (most common pattern)
    urlFilter = urlPart;

    // If the pattern is a pure domain (no path, no wildcard), append '^'
    if (!urlFilter.endsWith('^') && !urlFilter.endsWith('/') && !urlFilter.includes('*')) {
      // Remove trailing dots or ports if any before appending ^
      urlFilter += '^';
    }

    // Validate: must have a domain part after '||'
    const domain = urlFilter.slice(2).split(/[\^\/\?]/)[0];
    if (!domain || domain.length < 3 || domain.includes(' ')) return null;

  } else if (urlPart.startsWith('|https://') || urlPart.startsWith('|http://')) {
    // Absolute URL anchor
    urlFilter = urlPart;

  } else if (urlPart.startsWith('/') || urlPart.startsWith('*')) {
    // Generic pattern without domain anchor
    // Only accept patterns that are long enough to be meaningful
    if (urlPart.length < 8) return null;
    urlFilter = urlPart;

  } else if (!urlPart.startsWith('|') && urlPart.length >= 8 && !urlPart.startsWith('.')) {
    // Bare pattern — accept only if it has slashes (path-like)
    if (!urlPart.includes('/') && !urlPart.includes('*')) return null;
    urlFilter = urlPart;

  } else {
    return null; // Unrecognised pattern shape
  }

  // ── Final validation ──────────────────────────────────────────────────────
  if (!urlFilter || urlFilter.length < 4) return null;
  if (/^[|^*.\s]+$/.test(urlFilter)) return null; // All anchors/wildcards
  if (urlFilter.includes(' ')) return null;

  return { urlFilter, ...opts };
}

// ── Per-source compiler ────────────────────────────────────────────────────

/**
 * Compile a single filter source file.
 *
 * @param {string}   filepath
 * @param {string[]} defaultTypes
 * @param {Set}      globalSeen   Shared dedup set (modified in place)
 * @param {object}   stats        Shared stats object (modified in place)
 * @returns {Array<object>}  Array of partial DNR rule objects (no id yet)
 */
function compileSource(filepath, defaultTypes, globalSeen, stats) {
  let text;
  try {
    text = readFileSync(filepath, 'utf-8');
  } catch (err) {
    console.warn(`    [WARN] Could not read ${filepath}: ${err.message}`);
    return [];
  }

  const lines   = text.split(/\r?\n/);
  const rules   = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Fast-path skips (avoid full parseLine overhead)
    if (!line)                          { stats.blank++;     continue; }
    if (line.startsWith('!'))           { stats.comments++;  continue; }
    if (line.startsWith('#'))           { stats.comments++;  continue; }
    if (line.startsWith('['))           { stats.comments++;  continue; }
    if (line.startsWith('@@'))          { stats.exceptions++;continue; }
    if (line.includes('##'))            { stats.cosmetic++;  continue; }
    if (line.includes('#@#'))           { stats.cosmetic++;  continue; }
    if (line.includes('#?#'))           { stats.cosmetic++;  continue; }
    if (line.includes('#$#'))           { stats.cosmetic++;  continue; }
    if (line.includes('##+js'))         { stats.scriptlets++;continue; }
    if (line.includes('#+js'))          { stats.scriptlets++;continue; }
    if (line.includes('##^'))           { stats.htmlFilters++;continue; }

    const parsed = parseLine(line, defaultTypes);
    if (!parsed) { stats.invalid++; continue; }

    const { urlFilter, resourceTypes, domainType, initiatorDomains,
            excludedInitiatorDomains, priority, isUrlFilterCaseSensitive } = parsed;

    // Deduplication (global across all sources in this ruleset)
    const key = dedupKey(urlFilter, domainType);
    if (globalSeen.has(key)) { stats.duplicates++; continue; }
    globalSeen.set(key, true);

    // Build partial DNR rule (no id yet — assigned after sorting)
    const condition = { urlFilter, resourceTypes };
    if (domainType)                      condition.domainType = domainType;
    if (initiatorDomains?.length)        condition.initiatorDomains = initiatorDomains;
    if (excludedInitiatorDomains?.length)condition.excludedInitiatorDomains = excludedInitiatorDomains;
    if (isUrlFilterCaseSensitive)        condition.isUrlFilterCaseSensitive = true;

    rules.push({
      priority: priority ?? 1,
      action:   { type: 'block' },
      condition,
      // Metadata for reporting (stripped before JSON output)
      _urlFilter: urlFilter
    });

    stats.compiled++;
  }

  return rules;
}

// ── Category detection ─────────────────────────────────────────────────────

/**
 * Attempt to detect the blocking category of a compiled rule from its urlFilter.
 * Used only for statistics reporting — doesn't affect blocking behaviour.
 *
 * @param {string} urlFilter
 * @returns {string}
 */
function detectCategory(urlFilter) {
  const u = urlFilter.toLowerCase();
  if (/analytic|gtm|gtag|pixel|tracker|tracking|telemetry|metric|measure|beacon|insight|collect|log\./.test(u))
    return 'analytics';
  if (/facebook|instagram|twitter|tiktok|pinterest|snapchat|linkedin|reddit|discord|threads/.test(u))
    return 'social';
  if (/samsung|xiaomi|huawei|oppo|vivo|realme|oneplus|miui|hicloud|coloros|heytap/.test(u))
    return 'telemetry';
  if (/intercom|drift|crisp|livechat|tawk|hubspot|braze|klaviyo|zendesk|freshworks/.test(u))
    return 'customer';
  if (/sentry|bugsnag|rollbar|raygun|logrocket|datadog/.test(u))
    return 'errorTracking';
  if (/ads\.|adserver|adsystem|adnxs|adsrvr|adform|adroll|doubleclick|syndication/.test(u))
    return 'ads';
  return 'other';
}

// ── Main compiler ──────────────────────────────────────────────────────────

/**
 * Run the full compilation pipeline for all configured rulesets.
 * Exported so build-rules.js can call it.
 *
 * @returns {{ totalRules:number, rulesets:Array<{name:string,rules:number}>, stats:object }}
 */
export function runCompiler() {
  const startTime = Date.now();
  let grandTotal  = 0;
  const rulesetResults = [];
  const grandStats = {
    ads: 0, privacy: 0, analytics: 0, social: 0,
    telemetry: 0, customer: 0, errorTracking: 0, other: 0,
    duplicates: 0, cosmetic: 0, scriptlets: 0, htmlFilters: 0,
    exceptions: 0, invalid: 0
  };

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║   ShieldBlock Pro — Filter Compiler v3.0                ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  for (const cfg of RULESET_CONFIGS) {
    console.log(`── Compiling "${cfg.name}" ruleset ──────────────────────────────`);

    const globalSeen = new Map();
    const allRules   = [];
    const stats = {
      compiled: 0, duplicates: 0, blank: 0, comments: 0,
      exceptions: 0, cosmetic: 0, scriptlets: 0, htmlFilters: 0, invalid: 0
    };

    for (const src of cfg.sources) {
      const filepath = join(ROOT, src.path);
      if (!existsSync(filepath)) {
        if (src.optional) {
          console.log(`  ○ SKIP  ${src.label} (not cached yet)`);
        } else {
          console.error(`  ✗ FAIL  ${src.label} not found: ${src.path}`);
          process.exit(1);
        }
        continue;
      }

      const sizekb  = Math.round(readFileSync(filepath).length / 1024);
      const before  = stats.compiled;
      const rules   = compileSource(filepath, cfg.defaultTypes, globalSeen, stats);
      allRules.push(...rules);
      const added   = stats.compiled - before;
      console.log(`  ✓ READ  ${src.label.padEnd(20)} — ${String(added).padStart(6)} new rules  (${sizekb} KB)`);
    }

    // ── Sort: domain-level first, path-level second, generic last ──────────
    // Within each tier, preserve source order (custom rules come first due to push order)
    allRules.sort((a, b) => {
      const scoreA = ruleScore(a.condition.urlFilter);
      const scoreB = ruleScore(b.condition.urlFilter);
      return scoreA - scoreB; // lower score = higher priority
    });

    // ── Cap at max rules ───────────────────────────────────────────────────
    const cappedRules = allRules.slice(0, cfg.maxRules);
    if (allRules.length > cfg.maxRules) {
      console.log(`  ! CAP   ${allRules.length} → ${cfg.maxRules} rules (Chrome static rule limit)`);
    }

    // ── Assign sequential IDs and collect category stats ───────────────────
    const categoryStats = {};
    const outputRules   = cappedRules.map((rule, idx) => {
      const cat = detectCategory(rule._urlFilter || rule.condition.urlFilter);
      categoryStats[cat] = (categoryStats[cat] ?? 0) + 1;

      const { _urlFilter, ...cleanRule } = rule;
      return { id: idx + 1, ...cleanRule };
    });

    // ── Validation pass ────────────────────────────────────────────────────
    const idSet     = new Set();
    const filterSet = new Set();
    let   valErrors = 0;

    for (const rule of outputRules) {
      if (idSet.has(rule.id)) { console.error(`  [ERR] Duplicate ID ${rule.id}`); valErrors++; }
      idSet.add(rule.id);

      const uf = rule.condition?.urlFilter?.toLowerCase?.() ?? '';
      if (filterSet.has(uf)) { /* warn only for near-duplicates */ }
      filterSet.add(uf);

      if (!rule.condition?.urlFilter) { console.error(`  [ERR] Rule ${rule.id} missing urlFilter`); valErrors++; }
      if (!Array.isArray(rule.condition?.resourceTypes) || rule.condition.resourceTypes.length === 0) {
        console.error(`  [ERR] Rule ${rule.id} missing resourceTypes`); valErrors++;
      }
    }

    if (valErrors > 0) {
      console.error(`\n  [FATAL] ${valErrors} validation errors. Aborting.`);
      process.exit(1);
    }

    // ── Write output ───────────────────────────────────────────────────────
    const outputPath = join(ROOT, cfg.output);
    const outputDir  = outputPath.slice(0, outputPath.lastIndexOf('/') > -1 ? outputPath.lastIndexOf('/') : outputPath.lastIndexOf('\\'));
    if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
    writeFileSync(outputPath, JSON.stringify(outputRules, null, 2), 'utf-8');

    // ── Per-ruleset stats ──────────────────────────────────────────────────
    console.log(`\n  ┌─ "${cfg.name}" Results ──────────────────────────────────────┐`);
    console.log(`  │  Rules compiled:         ${String(stats.compiled).padEnd(8)}                      │`);
    console.log(`  │  Duplicates removed:     ${String(stats.duplicates).padEnd(8)}                      │`);
    console.log(`  │  Cosmetic rules skipped: ${String(stats.cosmetic).padEnd(8)}                      │`);
    console.log(`  │  Scriptlets skipped:     ${String(stats.scriptlets).padEnd(8)}                      │`);
    console.log(`  │  Exception rules:        ${String(stats.exceptions).padEnd(8)}                      │`);
    console.log(`  │  HTML filters:           ${String(stats.htmlFilters).padEnd(8)}                      │`);
    console.log(`  │  Invalid/unsupported:    ${String(stats.invalid).padEnd(8)}                      │`);
    console.log(`  │  Final rule count:       ${String(outputRules.length).padEnd(8)}                      │`);
    console.log(`  └───────────────────────────────────────────────────────────┘`);

    if (Object.keys(categoryStats).length > 0) {
      console.log(`  Category breakdown:`);
      for (const [cat, count] of Object.entries(categoryStats).sort((a, b) => b[1] - a[1])) {
        console.log(`    ${cat.padEnd(18)} ${String(count).padStart(6)}`);
      }
    }
    console.log();

    grandTotal += outputRules.length;
    rulesetResults.push({ name: cfg.name, rules: outputRules.length });

    // Accumulate grand stats
    grandStats.duplicates   += stats.duplicates;
    grandStats.cosmetic     += stats.cosmetic;
    grandStats.scriptlets   += stats.scriptlets;
    grandStats.exceptions   += stats.exceptions;
    grandStats.invalid      += stats.invalid;
    for (const [cat, count] of Object.entries(categoryStats)) {
      grandStats[cat] = (grandStats[cat] ?? 0) + count;
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  // ── Grand summary ──────────────────────────────────────────────────────────
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   Compilation Complete                                  ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  for (const r of rulesetResults) {
    const label = `║  ${r.name.padEnd(12)} →  ${String(r.rules).padStart(6)} rules`;
    console.log(label.padEnd(59) + '║');
  }
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Ads rules:           ${String(grandStats.ads ?? 0).padStart(6)}                             ║`);
  console.log(`║  Analytics rules:     ${String(grandStats.analytics ?? 0).padStart(6)}                             ║`);
  console.log(`║  Social rules:        ${String(grandStats.social ?? 0).padStart(6)}                             ║`);
  console.log(`║  Telemetry rules:     ${String(grandStats.telemetry ?? 0).padStart(6)}                             ║`);
  console.log(`║  Error tracking:      ${String(grandStats.errorTracking ?? 0).padStart(6)}                             ║`);
  console.log(`║  Customer platform:   ${String(grandStats.customer ?? 0).padStart(6)}                             ║`);
  console.log(`║  Other rules:         ${String(grandStats.other ?? 0).padStart(6)}                             ║`);
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Duplicates removed:  ${String(grandStats.duplicates).padStart(6)}                             ║`);
  console.log(`║  Cosmetic skipped:    ${String(grandStats.cosmetic).padStart(6)}                             ║`);
  console.log(`║  Scriptlets skipped:  ${String(grandStats.scriptlets).padStart(6)}                             ║`);
  console.log(`║  Exceptions skipped:  ${String(grandStats.exceptions).padStart(6)}                             ║`);
  console.log(`║  Invalid skipped:     ${String(grandStats.invalid).padStart(6)}                             ║`);
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  TOTAL RULES:         ${String(grandTotal).padStart(6)}                             ║`);
  console.log(`║  Compile time:        ${String(elapsed + 's').padStart(6)}                             ║`);
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  if (grandTotal > CHROME_MAX_STATIC_RULES) {
    console.error(`[FATAL] Total rules (${grandTotal}) exceeds Chrome limit (${CHROME_MAX_STATIC_RULES}). Reduce maxRules in RULESET_CONFIGS.`);
    process.exit(1);
  }

  return { totalRules: grandTotal, rulesets: rulesetResults, stats: grandStats, elapsed };
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Assign a sort score to a rule's urlFilter.
 * Lower score = higher priority = included first when hitting the cap.
 * 1 = domain-level (||domain.com^)
 * 2 = domain + path (||domain.com/path/)
 * 3 = generic (no domain anchor)
 *
 * @param {string} urlFilter
 * @returns {number}
 */
function ruleScore(urlFilter) {
  if (urlFilter.startsWith('||')) {
    const after = urlFilter.slice(2);
    if (/^[a-zA-Z0-9.\-]+\^?$/.test(after)) return 1; // Pure domain
    if (after.includes('/'))                  return 2; // Domain + path
    return 2;
  }
  return 3; // Generic pattern
}

// ── Standalone run ─────────────────────────────────────────────────────────

// Run directly: node scripts/filter-compiler.js
if (process.argv[1].endsWith('filter-compiler.js')) {
  runCompiler();
}
