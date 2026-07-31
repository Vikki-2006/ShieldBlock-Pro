/**
 * @file scripts/download-filters.js
 * @description Downloads and caches real ad/tracker filter lists for ShieldBlock Pro.
 *
 * Filter sources:
 *   • EasyList          — https://easylist.to/easylist/easylist.txt
 *   • EasyPrivacy       — https://easylist.to/easylist/easyprivacy.txt
 *   • Peter Lowe's list — https://pgl.yoyo.org/adservers/...
 *   • AdGuard Base      — https://filters.adtidy.org/extension/chromium/filters/2.txt
 *
 * Cached for 7 days in filters/cache/.
 * Falls back to cached file if download fails.
 * Can be run standalone:  node scripts/download-filters.js [--force]
 */

import { createWriteStream, existsSync, mkdirSync, statSync, renameSync, unlinkSync } from 'fs';
import { get as httpsGet } from 'https';
import { get as httpGet }  from 'http';
import { join, dirname }   from 'path';
import { fileURLToPath }   from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT      = join(__dirname, '..');
export const CACHE_DIR = join(ROOT, 'filters', 'cache');

/** Cache TTL: 7 days in milliseconds */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * All remote filter list sources.
 * @type {Array<{id:string, name:string, url:string, filename:string, category:'ads'|'privacy'}>}
 */
export const FILTER_SOURCES = [
  {
    id:       'easylist',
    name:     'EasyList',
    url:      'https://easylist.to/easylist/easylist.txt',
    filename: 'easylist.txt',
    category: 'ads'
  },
  {
    id:       'easyprivacy',
    name:     'EasyPrivacy',
    url:      'https://easylist.to/easylist/easyprivacy.txt',
    filename: 'easyprivacy.txt',
    category: 'privacy'
  },
  {
    id:       'peter-lowe',
    name:     "Peter Lowe's Ad & Tracking List",
    url:      'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext',
    filename: 'peter-lowe.txt',
    category: 'privacy'
  },
  {
    id:       'adguard-base',
    name:     'AdGuard Base Filter',
    url:      'https://filters.adtidy.org/extension/chromium/filters/2.txt',
    filename: 'adguard-base.txt',
    category: 'ads'
  }
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns true if the cached file is older than CACHE_TTL_MS or doesn't exist.
 * @param {string} filepath
 * @returns {boolean}
 */
function isStale(filepath) {
  if (!existsSync(filepath)) return true;
  try {
    return (Date.now() - statSync(filepath).mtimeMs) > CACHE_TTL_MS;
  } catch {
    return true;
  }
}

/**
 * Download a URL to a destination file, following up to 8 redirects.
 * @param {string} url
 * @param {string} dest
 * @param {number} [redirectDepth=0]
 * @returns {Promise<void>}
 */
function downloadTo(url, dest, redirectDepth = 0) {
  return new Promise((resolve, reject) => {
    if (redirectDepth > 8) {
      return reject(new Error('Too many redirects'));
    }

    const isHttps   = url.startsWith('https');
    const transport = isHttps ? httpsGet : httpGet;
    const file      = createWriteStream(dest);
    let   settled   = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      try { file.close(); } catch {}
      try { unlinkSync(dest); } catch {}
      reject(err);
    };

    const req = transport(
      url,
      { headers: { 'User-Agent': 'ShieldBlock-Pro-Compiler/2.0', 'Accept': 'text/plain' } },
      (res) => {
        // Follow redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          try { file.close(); } catch {}
          const target = res.headers.location.startsWith('http')
            ? res.headers.location
            : new URL(res.headers.location, url).href;
          downloadTo(target, dest, redirectDepth + 1).then(resolve).catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          return fail(new Error(`HTTP ${res.statusCode}`));
        }

        res.pipe(file);
        file.on('finish', () => {
          if (settled) return;
          settled = true;
          file.close();
          resolve();
        });
        file.on('error', fail);
      }
    );

    req.on('error', fail);
    req.setTimeout(90_000, () => {
      req.destroy();
      fail(new Error('Connection timed out'));
    });
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Download all configured filter lists, caching results in filters/cache/.
 *
 * @param {boolean} [force=false]  If true, bypass the 7-day cache and re-download.
 * @returns {Promise<Array<{id:string, name:string, category:string, path:string|null, status:string}>>}
 */
export async function downloadAll(force = false) {
  // Ensure the cache directory exists
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }

  const results = [];

  for (const src of FILTER_SOURCES) {
    const destPath = join(CACHE_DIR, src.filename);
    const tmpPath  = destPath + '.tmp';

    // Check if the cache is still fresh
    if (!force && !isStale(destPath)) {
      const kb = Math.round(statSync(destPath).size / 1024);
      console.log(`  ✓ CACHED    ${src.name.padEnd(38)} (${kb} KB)`);
      results.push({ ...src, path: destPath, status: 'cached' });
      continue;
    }

    process.stdout.write(`  ↓ DOWNLOAD  ${src.name.padEnd(38)} … `);

    try {
      await downloadTo(src.url, tmpPath);
      renameSync(tmpPath, destPath);
      const kb = Math.round(statSync(destPath).size / 1024);
      console.log(`OK (${kb} KB)`);
      results.push({ ...src, path: destPath, status: 'downloaded' });
    } catch (err) {
      process.stdout.write(`FAILED (${err.message})`);
      if (existsSync(tmpPath)) { try { unlinkSync(tmpPath); } catch {} }

      if (existsSync(destPath)) {
        console.log(' → using cache');
        results.push({ ...src, path: destPath, status: 'fallback' });
      } else {
        console.log(' → SKIPPED (no cache)');
        results.push({ ...src, path: null, status: 'unavailable' });
      }
    }
  }

  return results;
}

// ── Standalone run ────────────────────────────────────────────────────────────

// Run directly: node scripts/download-filters.js [--force]
if (process.argv[1].endsWith('download-filters.js')) {
  const force = process.argv.includes('--force');
  console.log('\nShieldBlock Pro — Filter List Downloader');
  console.log('─'.repeat(60));
  downloadAll(force)
    .then(results => {
      const ok  = results.filter(r => r.status !== 'unavailable').length;
      const bad = results.filter(r => r.status === 'unavailable').length;
      console.log(`\n  Downloaded/cached: ${ok}  |  Unavailable: ${bad}`);
    })
    .catch(err => { console.error(err); process.exit(1); });
}
