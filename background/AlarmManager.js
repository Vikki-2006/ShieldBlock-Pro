/**
 * @file background/AlarmManager.js
 * @description Manages recurring Chrome alarms for scheduled tasks.
 * Primary use: daily stats reset at midnight.
 */

import { bgLog }   from '../shared/logger.js';
import { ALARMS }  from '../shared/constants.js';

export class AlarmManager {
  /**
   * @param {import('./StatsEngine.js').StatsEngine} statsEngine
   */
  constructor(statsEngine) {
    this._statsEngine = statsEngine;
  }

  /**
   * Register all alarms. Safe to call multiple times (existing alarms are replaced).
   * Must be called from a user gesture or from onInstalled/onStartup.
   */
  scheduleAll() {
    this._scheduleDailyReset();
  }

  /**
   * Schedule the daily stats reset alarm.
   * Fires once per day at midnight (Chrome minimum alarm period is 1 minute).
   */
  _scheduleDailyReset() {
    // Calculate milliseconds until next midnight
    const now       = new Date();
    const midnight  = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const delayMs   = midnight.getTime() - now.getTime();
    const delayMins = Math.max(1, Math.ceil(delayMs / 60_000));

    chrome.alarms.create(ALARMS.DAILY_RESET, {
      delayInMinutes:    delayMins,
      periodInMinutes:   60 * 24 // Repeat every 24 hours
    });

    bgLog.info('Daily reset alarm scheduled', {
      nextFire: midnight.toISOString(),
      delayMins
    });
  }

  /**
   * Cancel all scheduled alarms (e.g. on extension disable).
   */
  async cancelAll() {
    await chrome.alarms.clearAll();
    bgLog.info('All alarms cancelled');
  }
}
