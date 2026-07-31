/**
 * @file dashboard/index.js
 * @description ShieldBlock Pro statistics dashboard controller.
 * Renders bar chart, donut chart, top domains, and live feed.
 * All charts are pure SVG/Canvas — no external libraries.
 */

import { sendToBackground, MSG } from '../shared/messages.js';
import { getStats, getHistory }  from '../shared/storage.js';
import { formatNumber, formatCount, timeAgo, lastNDays, formatDateShort, sortedEntries } from '../shared/utils.js';

// ── Color Palette ─────────────────────────────────────────────────────────

const COLORS = {
  accent:  '#818cf8',
  danger:  '#f87171',
  warning: '#fbbf24',
  success: '#34d399',
  purple:  '#a78bfa',
  muted:   '#475569'
};

const TYPE_COLORS = {
  script:         COLORS.danger,
  image:          COLORS.warning,
  xmlhttprequest: COLORS.accent,
  media:          COLORS.purple,
  stylesheet:     COLORS.success,
  ping:           '#67e8f9',
  other:          COLORS.muted
};

// ── Init ───────────────────────────────────────────────────────────────────

async function init() {
  await render();

  // Live updates via storage changes (handles settings changes from other pages)
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area === 'local' && (changes.stats || changes.history)) {
      await render();
    }
  });

  // Real-time push: refresh immediately when background signals a new block
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'background/statsUpdated') {
      render().catch(() => {});
    }
  });

  // Poll session data (recent blocked) every 2 seconds as fallback
  setInterval(loadFeed, 2000);

  // Button events
  document.getElementById('clearStatsBtn')?.addEventListener('click', async () => {
    if (!confirm('Clear all statistics? This cannot be undone.')) return;
    await sendToBackground(MSG.CLEAR_STATS);
    await render();
  });

  document.getElementById('openSettings')?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

async function render() {
  const [stats, history] = await Promise.all([getStats(), getHistory()]);

  renderHero(stats, history);
  renderStatCards(stats, history);
  renderBarChart(history);
  renderDonutChart(stats);
  renderDomains(stats);
  await loadFeed();
}

// ── Hero ─────────────────────────────────────────────────────────────────

function renderHero(stats, history) {
  const heroEl = document.getElementById('heroCounter');
  if (heroEl) animateNumber(heroEl, stats.total || 0);

  const sinceEl = document.getElementById('heroSince');
  if (sinceEl && history.days?.length > 0) {
    sinceEl.textContent = `Since ${history.days[0]?.date || 'installation'}`;
  }
}

// ── Stat Cards ────────────────────────────────────────────────────────────

function renderStatCards(stats, history) {
  const today = new Date().toISOString().slice(0, 10);
  const todayEntry = history.days?.find(d => d.date === today);
  setText('statToday',    formatNumber(todayEntry?.blocked || 0));
  setText('statAds',      formatNumber(stats.byCategory?.ads || 0));
  setText('statTrackers', formatNumber(stats.byCategory?.trackers || 0));
  setText('statDomains',  formatCount(Object.keys(stats.byDomain || {}).length));
}

// ── Bar Chart ─────────────────────────────────────────────────────────────

function renderBarChart(history) {
  const canvas = document.getElementById('barChart');
  if (!canvas) return;

  const dpr = window.devicePixelRatio || 1;
  const container = canvas.parentElement;
  const W = container.offsetWidth || 600;
  const H = container.offsetHeight || 160;

  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const days = lastNDays(7);
  const dayMap = {};
  (history.days || []).forEach(d => { dayMap[d.date] = d.blocked; });
  const values = days.map(d => dayMap[d] || 0);
  const maxVal = Math.max(...values, 1);

  // Update weekly total badge
  const total = values.reduce((a, b) => a + b, 0);
  setText('weeklyTotal', formatNumber(total) + ' this week');

  const padL = 8, padR = 8, padT = 10, padB = 28;
  const barW = (W - padL - padR) / days.length;
  const barGap = barW * 0.25;
  const bw = barW - barGap;

  values.forEach((val, i) => {
    const x = padL + i * barW + barGap / 2;
    const barH = val > 0 ? Math.max(4, ((val / maxVal) * (H - padT - padB))) : 2;
    const y = H - padB - barH;

    // Bar
    ctx.fillStyle = COLORS.accent;
    ctx.globalAlpha = 0.8;
    roundRect(ctx, x, y, bw, barH, 3);
    ctx.fill();

    // Glow on hover (static for now)
    ctx.globalAlpha = 0.15;
    roundRect(ctx, x, y, bw, barH, 3);
    ctx.fill();

    ctx.globalAlpha = 1;

    // Day label
    ctx.fillStyle = '#475569';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(formatDateShort(days[i]).replace(/\d{4}/, '').trim(), x + bw / 2, H - 6);
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ── Donut Chart ───────────────────────────────────────────────────────────

function renderDonutChart(stats) {
  const canvas = document.getElementById('donutChart');
  if (!canvas) return;

  const byType = stats.byType || {};
  const entries = Object.entries(byType)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a);

  const total = entries.reduce((s, [, v]) => s + v, 0);

  setText('donutTotal', formatCount(total));

  const dpr = window.devicePixelRatio || 1;
  const SIZE = 140;
  canvas.width  = SIZE * dpr;
  canvas.height = SIZE * dpr;
  canvas.style.width  = SIZE + 'px';
  canvas.style.height = SIZE + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, SIZE, SIZE);

  const cx = SIZE / 2, cy = SIZE / 2;
  const outerR = SIZE / 2 - 6;
  const innerR = outerR - 22;

  if (total === 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fill();
  } else {
    let startAngle = -Math.PI / 2;
    entries.forEach(([type, count]) => {
      const slice = (count / total) * Math.PI * 2;
      const color = TYPE_COLORS[type] || COLORS.muted;

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, outerR, startAngle, startAngle + slice);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();

      startAngle += slice;
    });

    // Inner circle (cutout)
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
    ctx.fillStyle = '#111520';
    ctx.fill();
  }

  // Legend
  const legend = document.getElementById('donutLegend');
  if (legend) {
    legend.innerHTML = entries.slice(0, 5).map(([type, count]) => `
      <div class="legend-item">
        <span class="legend-dot" style="background:${TYPE_COLORS[type] || COLORS.muted}"></span>
        <span class="legend-name">${type}</span>
        <span class="legend-val">${formatCount(count)}</span>
        <span class="legend-pct">${total > 0 ? Math.round((count / total) * 100) : 0}%</span>
      </div>
    `).join('');
  }
}

// ── Top Domains ───────────────────────────────────────────────────────────

function renderDomains(stats) {
  const list = document.getElementById('domainsList');
  if (!list) return;

  const entries = sortedEntries(stats.byDomain || {}, 15);

  if (entries.length === 0) {
    list.innerHTML = '<div class="empty-state">No domains blocked yet.</div>';
    return;
  }

  const maxCount = entries[0]?.[1] || 1;

  list.innerHTML = entries.map(([domain, count], i) => `
    <div class="domain-row">
      <span class="domain-rank">${i + 1}</span>
      <span class="domain-name" title="${escapeHtml(domain)}">${escapeHtml(domain)}</span>
      <div class="domain-bar-wrap">
        <div class="domain-bar" style="width:${Math.round((count / maxCount) * 100)}%"></div>
      </div>
      <span class="domain-count">${formatCount(count)}</span>
    </div>
  `).join('');
}

// ── Live Feed ─────────────────────────────────────────────────────────────

async function loadFeed() {
  const list = document.getElementById('feedList');
  if (!list) return;

  try {
    const recent = await sendToBackground(MSG.GET_RECENT_BLOCKED);
    if (!recent || recent.length === 0) {
      list.innerHTML = '<div class="empty-state">Waiting for activity…</div>';
      return;
    }

    list.innerHTML = recent.slice(0, 20).map(item => `
      <div class="feed-item">
        <span class="feed-dot ${item.category || 'unknown'}"></span>
        <span class="feed-domain" title="${escapeHtml(item.domain || 'unknown')}">${escapeHtml(item.domain || 'unknown')}</span>
        <span class="feed-type">${escapeHtml(item.type || 'other')}</span>
        <span class="feed-time">${timeAgo(item.ts || Date.now())}</span>
      </div>
    `).join('');
  } catch {}
}

// ── Utilities ─────────────────────────────────────────────────────────────

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function animateNumber(el, target) {
  const current = parseInt(el.textContent.replace(/[^0-9]/g, ''), 10) || 0;
  if (current === target) return;
  const steps = Math.min(Math.abs(target - current), 30);
  const step  = (target - current) / steps;
  let val = current, n = 0;
  const timer = setInterval(() => {
    n++;
    val += step;
    el.textContent = formatNumber(Math.round(n < steps ? val : target));
    if (n >= steps) clearInterval(timer);
  }, 25);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Boot ───────────────────────────────────────────────────────────────────

init().catch(err => console.error('[Dashboard] init failed', err));
