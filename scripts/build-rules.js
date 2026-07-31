/**
 * @file scripts/build-rules.js
 * @description ShieldBlock Pro full build pipeline.
 *
 * Pipeline:
 *   1. Run filter-compiler.js  — compile filter lists → JSON rulesets
 *   2. Validate JSON rulesets  — no duplicate IDs, valid DNR schema, no malformed JSON
 *
 * Usage:
 *   node scripts/build-rules.js
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runCompiler } from './filter-compiler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir   = join(__dirname, '..');

// ── Valid Chrome DNR resource types ────────────────────────────────────────
const VALID_RESOURCE_TYPES = new Set([
  'main_frame', 'sub_frame', 'stylesheet', 'script', 'image',
  'font', 'object', 'xmlhttprequest', 'ping', 'csp_report',
  'media', 'websocket', 'webtransport', 'webbundle', 'other'
]);

// ── Rulesets to validate ────────────────────────────────────────────────────
const RULESETS = [
  { id: 'ads',     path: 'rules/static_rules.json' },
  { id: 'privacy', path: 'rules/privacy_rules.json' }
];

// ═══════════════════════════════════════════════════════════════════════════
// Step 1 — Compile
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════════════════');
console.log('  STEP 1: Compiling filter lists');
console.log('══════════════════════════════════════════════════════');

let grandTotal = 0;
try {
  const result = runCompiler();
  grandTotal = result.totalRules;
} catch (err) {
  console.error('\n[FATAL] Compiler threw an unexpected error:', err.message);
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 2 — Validate Generated Rulesets
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════════════════');
console.log('  STEP 2: Validating generated rulesets');
console.log('══════════════════════════════════════════════════════\n');

let totalErrors = 0;
let totalRules  = 0;

for (const ruleset of RULESETS) {
  const fullPath = join(rootDir, ruleset.path);
  console.log(`Validating ruleset "${ruleset.id}" at ${ruleset.path}...`);

  let rules;
  try {
    const rawContent = readFileSync(fullPath, 'utf8');
    rules = JSON.parse(rawContent);
  } catch (err) {
    console.error(`  [FATAL] Failed to read/parse "${ruleset.id}":`, err.message);
    totalErrors++;
    continue;
  }

  if (!Array.isArray(rules)) {
    console.error(`  [ERROR] Ruleset "${ruleset.id}" is not a JSON array.`);
    totalErrors++;
    continue;
  }

  const idSet     = new Set();
  const filterSet = new Set();
  let ruleErrors  = 0;

  for (let idx = 0; idx < rules.length; idx++) {
    const rule     = rules[idx];
    const ruleDesc = `rule index #${idx} (ID: ${rule.id ?? 'missing'})`;

    // ── ID validation ──────────────────────────────────────────────────────
    if (rule.id === undefined || typeof rule.id !== 'number' || !Number.isInteger(rule.id) || rule.id <= 0) {
      console.error(`  [ERROR] Invalid/missing "id" in ${ruleDesc}. Must be a positive integer.`);
      ruleErrors++; totalErrors++;
    } else if (idSet.has(rule.id)) {
      console.error(`  [ERROR] Duplicate rule ID ${rule.id} in ${ruleDesc}.`);
      ruleErrors++; totalErrors++;
    } else {
      idSet.add(rule.id);
    }

    // ── Action validation ──────────────────────────────────────────────────
    if (!rule.action || !rule.action.type) {
      console.error(`  [ERROR] Missing/invalid "action.type" in ${ruleDesc}.`);
      ruleErrors++; totalErrors++;
    } else if (!['block', 'allow', 'redirect', 'modifyHeaders', 'upgradeScheme', 'allowAllRequests'].includes(rule.action.type)) {
      console.error(`  [ERROR] Unsupported action.type "${rule.action.type}" in ${ruleDesc}.`);
      ruleErrors++; totalErrors++;
    }

    // ── Condition validation ───────────────────────────────────────────────
    if (!rule.condition) {
      console.error(`  [ERROR] Missing "condition" in ${ruleDesc}.`);
      ruleErrors++; totalErrors++;
      continue;
    }

    if (!rule.condition.urlFilter && !rule.condition.regexFilter) {
      console.error(`  [ERROR] Missing both "urlFilter" and "regexFilter" in ${ruleDesc}.`);
      ruleErrors++; totalErrors++;
    }

    if (rule.condition.urlFilter && typeof rule.condition.urlFilter !== 'string') {
      console.error(`  [ERROR] "condition.urlFilter" must be a string in ${ruleDesc}.`);
      ruleErrors++; totalErrors++;
    }

    if (rule.condition.urlFilter && rule.condition.urlFilter.trim().length < 4) {
      console.error(`  [ERROR] "condition.urlFilter" is too short in ${ruleDesc}.`);
      ruleErrors++; totalErrors++;
    }

    // ── ResourceTypes validation ───────────────────────────────────────────
    if (rule.condition.resourceTypes !== undefined) {
      if (!Array.isArray(rule.condition.resourceTypes)) {
        console.error(`  [ERROR] "condition.resourceTypes" must be an array in ${ruleDesc}.`);
        ruleErrors++; totalErrors++;
      } else if (rule.condition.resourceTypes.length === 0) {
        console.error(`  [ERROR] "condition.resourceTypes" is empty in ${ruleDesc}.`);
        ruleErrors++; totalErrors++;
      } else {
        for (const rt of rule.condition.resourceTypes) {
          if (!VALID_RESOURCE_TYPES.has(rt)) {
            console.error(`  [ERROR] Unknown resource type "${rt}" in ${ruleDesc}.`);
            ruleErrors++; totalErrors++;
          }
        }
      }
    }

    // ── Priority validation ────────────────────────────────────────────────
    if (rule.priority !== undefined && (typeof rule.priority !== 'number' || rule.priority < 1)) {
      console.error(`  [ERROR] Invalid "priority" in ${ruleDesc}. Must be >= 1.`);
      ruleErrors++; totalErrors++;
    }

    // ── Duplicate filter check ─────────────────────────────────────────────
    const filterKey = (rule.condition.urlFilter ?? '').toLowerCase().trim();
    if (filterKey && filterSet.has(filterKey)) {
      console.error(`  [WARN] Duplicate urlFilter "${rule.condition.urlFilter}" in ${ruleDesc}.`);
      // Don't increment totalErrors for this — it's a warning
    }
    if (filterKey) filterSet.add(filterKey);
  }

  if (ruleErrors === 0) {
    console.log(`  [OK] Ruleset "${ruleset.id}" — ${rules.length} rules, 0 errors ✓`);
  } else {
    console.log(`  [FAIL] Ruleset "${ruleset.id}" — ${rules.length} rules, ${ruleErrors} error(s)`);
  }

  totalRules += rules.length;
}

// ═══════════════════════════════════════════════════════════════════════════
// Final Summary
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════════════════');
console.log('  BUILD SUMMARY');
console.log('══════════════════════════════════════════════════════');
console.log(`  Total rules compiled:  ${grandTotal}`);
console.log(`  Total rules validated: ${totalRules}`);
console.log(`  Total build errors:    ${totalErrors}`);
console.log('══════════════════════════════════════════════════════\n');

if (totalErrors > 0) {
  console.error('✗ Build FAILED — fix the above errors and re-run.\n');
  process.exit(1);
} else {
  console.log('✓ Build SUCCEEDED — all rulesets are valid and ready.\n');
  process.exit(0);
}
