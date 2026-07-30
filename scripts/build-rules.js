/**
 * @file scripts/build-rules.js
 * @description Validates and checks the integrity of declarativeNetRequest static rulesets.
 * Runs during the build phase to catch rule syntax or ID collision bugs early.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir   = join(__dirname, '..');

const RULESETS = [
  { id: 'ads', path: 'rules/static_rules.json' },
  { id: 'privacy', path: 'rules/privacy_rules.json' }
];

console.log('Starting ruleset validation and build...');

let totalErrors = 0;
let totalRules = 0;

for (const ruleset of RULESETS) {
  const fullPath = join(rootDir, ruleset.path);
  console.log(`Validating ruleset "${ruleset.id}" at ${ruleset.path}...`);

  try {
    const rawContent = readFileSync(fullPath, 'utf8');
    const rules = JSON.parse(rawContent);

    if (!Array.isArray(rules)) {
      console.error(`Error: Ruleset "${ruleset.id}" is not a JSON array.`);
      totalErrors++;
      continue;
    }

    const ids = new Set();
    rules.forEach((rule, idx) => {
      const ruleDesc = `rule #${idx} (ID: ${rule.id || 'missing'})`;

      if (rule.id === undefined || typeof rule.id !== 'number' || rule.id <= 0) {
        console.error(`  [ERROR] Invalid or missing "id" in ${ruleDesc}. Must be a positive integer.`);
        totalErrors++;
      } else if (ids.has(rule.id)) {
        console.error(`  [ERROR] Duplicate rule ID ${rule.id} found in ${ruleDesc}.`);
        totalErrors++;
      } else {
        ids.add(rule.id);
      }

      if (!rule.action || !rule.action.type) {
        console.error(`  [ERROR] Missing or invalid "action.type" in ${ruleDesc}.`);
        totalErrors++;
      }

      if (!rule.condition || !rule.condition.urlFilter) {
        console.error(`  [ERROR] Missing or invalid "condition.urlFilter" in ${ruleDesc}.`);
        totalErrors++;
      }

      if (rule.condition && rule.condition.resourceTypes) {
        if (!Array.isArray(rule.condition.resourceTypes)) {
          console.error(`  [ERROR] "condition.resourceTypes" in ${ruleDesc} must be an array.`);
          totalErrors++;
        }
      }
    });

    console.log(`  [OK] Ruleset "${ruleset.id}" has ${rules.length} valid rules.`);
    totalRules += rules.length;

  } catch (err) {
    console.error(`  [FATAL] Failed to read or parse ruleset "${ruleset.id}":`, err.message);
    totalErrors++;
  }
}

console.log('\n--- Build Summary ---');
console.log(`Total rules validated: ${totalRules}`);
console.log(`Total build errors: ${totalErrors}`);

if (totalErrors > 0) {
  console.error('\nBuild failed due to validation errors.');
  process.exit(1);
} else {
  console.log('\nBuild succeeded!');
  process.exit(0);
}
