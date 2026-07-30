/**
 * @file scripts/generate-icons.js
 * @description Generates extension icons at all required sizes (16, 32, 48, 128)
 * using the Canvas API via Node.js with the 'canvas' package, or falls back
 * to creating SVG placeholders if canvas is not available.
 *
 * Run: node scripts/generate-icons.js
 */

import { createCanvas } from 'canvas';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir    = join(__dirname, '..', 'assets', 'icons');

mkdirSync(outDir, { recursive: true });

const SIZES = [16, 32, 48, 128];

for (const size of SIZES) {
  const canvas = createCanvas(size, size);
  const ctx    = canvas.getContext('2d');

  const cx = size / 2;
  const cy = size / 2;
  const r  = size / 2 - 1;

  // Background circle
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  const bg = ctx.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0, '#1a1b2e');
  bg.addColorStop(1, '#0a0b0f');
  ctx.fillStyle = bg;
  ctx.fill();

  // Shield path (scaled to size)
  const scale = size / 128;
  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(64, 64);

  const grad = ctx.createLinearGradient(0, -48, 0, 48);
  grad.addColorStop(0, '#818cf8');
  grad.addColorStop(1, '#6366f1');

  ctx.beginPath();
  ctx.moveTo(0, -46);
  ctx.lineTo(-36, -28);
  ctx.lineTo(-36, 2);
  ctx.quadraticCurveTo(-36, 36, 0, 46);
  ctx.quadraticCurveTo(36, 36, 36, 2);
  ctx.lineTo(36, -28);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Checkmark
  ctx.strokeStyle = 'white';
  ctx.lineWidth = size < 32 ? 8 : 6;
  ctx.lineCap   = 'round';
  ctx.lineJoin  = 'round';
  ctx.beginPath();
  ctx.moveTo(-16, 4);
  ctx.lineTo(-4, 18);
  ctx.lineTo(18, -12);
  ctx.stroke();

  ctx.restore();

  const buf = canvas.toBuffer('image/png');
  writeFileSync(join(outDir, `icon${size}.png`), buf);
  console.log(`Generated icon${size}.png`);
}
