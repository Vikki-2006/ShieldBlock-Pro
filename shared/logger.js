/**
 * @file logger.js
 * @description Structured logging system with context labels, log levels,
 * and automatic error persistence to chrome.storage for post-hoc debugging.
 */

// ── Log Levels ────────────────────────────────────────────────────────────────

export const LOG_LEVELS = Object.freeze({
  DEBUG: 0,
  INFO:  1,
  WARN:  2,
  ERROR: 3,
  NONE:  99
});

// Minimum level to output. Raise to WARN or ERROR in production.
let globalMinLevel = LOG_LEVELS.INFO;

/**
 * Set the global minimum log level.
 * @param {number} level - LOG_LEVELS constant
 */
export function setLogLevel(level) {
  globalMinLevel = level;
}

// ── Logger Class ──────────────────────────────────────────────────────────────

/**
 * Context-aware logger. Create one per module:
 * @example
 * const log = new Logger('RuleEngine');
 * log.info('Rules loaded', { count: 42 });
 */
export class Logger {
  /**
   * @param {string} context - module/component name (shown in log prefix)
   */
  constructor(context) {
    this.context = context;
  }

  debug(msg, data) { this._emit(LOG_LEVELS.DEBUG, msg, data); }
  info(msg, data)  { this._emit(LOG_LEVELS.INFO,  msg, data); }
  warn(msg, data)  { this._emit(LOG_LEVELS.WARN,  msg, data); }
  error(msg, data) { this._emit(LOG_LEVELS.ERROR, msg, data); }

  /**
   * Internal emit: format, filter, and output the log entry.
   *
   * @param {number} level
   * @param {string} msg
   * @param {any} [data]
   */
  _emit(level, msg, data) {
    if (level < globalMinLevel) return;

    const levelName = Object.keys(LOG_LEVELS).find(k => LOG_LEVELS[k] === level) ?? 'LOG';
    const prefix    = `[ShieldBlock:${this.context}]`;
    const timestamp = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm

    // Choose the appropriate console method
    const consoleFn = {
      [LOG_LEVELS.DEBUG]: console.debug,
      [LOG_LEVELS.INFO]:  console.log,
      [LOG_LEVELS.WARN]:  console.warn,
      [LOG_LEVELS.ERROR]: console.error
    }[level] ?? console.log;

    if (data !== undefined) {
      consoleFn(`${prefix} ${timestamp} ${levelName} — ${msg}`, data);
    } else {
      consoleFn(`${prefix} ${timestamp} ${levelName} — ${msg}`);
    }

    // Persist errors to storage for post-hoc debugging
    if (level >= LOG_LEVELS.ERROR) {
      this._persistError({ ts: Date.now(), ctx: this.context, msg, data: String(data ?? '') });
    }
  }

  /**
   * Append an error entry to the persistent error log (capped at 10 entries).
   *
   * @param {{ ts: number, ctx: string, msg: string, data: string }} entry
   */
  async _persistError(entry) {
    try {
      const result = await chrome.storage.local.get('errorLog');
      const errorLog = Array.isArray(result.errorLog) ? result.errorLog : [];
      errorLog.push(entry);
      if (errorLog.length > 10) errorLog.shift(); // Keep last 10
      await chrome.storage.local.set({ errorLog });
    } catch {
      // Storage unavailable — silently ignore
    }
  }
}

// ── Default Loggers ───────────────────────────────────────────────────────────
// Pre-created loggers for common contexts. Import and use directly.

export const bgLog    = new Logger('Background');
export const uiLog    = new Logger('UI');
export const ruleLog  = new Logger('RuleEngine');
export const statLog  = new Logger('StatsEngine');
export const parseLog = new Logger('Parser');
