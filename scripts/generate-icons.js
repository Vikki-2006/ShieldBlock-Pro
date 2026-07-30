/**
 * @file scripts/generate-icons.js
 * @description Generates extension icons at all required sizes from the master logo.
 * Uses the 'canvas' package if installed.
 */

import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir   = join(__dirname, '..');
const outDir    = join(rootDir, 'assets', 'icons');
const masterPath = join(rootDir, 'assets', 'logo.png');

async function run() {
  let createCanvas, Image;
  try {
    const canvasModule = await import('canvas');
    createCanvas = canvasModule.createCanvas;
    Image = canvasModule.Image;
  } catch (err) {
    console.warn('\n[Warning] "canvas" package is not installed. Skipping icon generation.');
    console.warn('Pre-generated icons are already available in assets/icons/.');
    process.exit(0);
  }

  const masterData = readFileSync(masterPath);
  const img = new Image();
  img.src = masterData;

  const SIZES = [16, 32, 48, 128];
  for (const size of SIZES) {
    const canvas = createCanvas(size, size);
    const ctx    = canvas.getContext('2d');
    
    // High-quality resizing
    ctx.patternQuality = 'best';
    ctx.quality = 'best';
    ctx.imageSmoothingEnabled = true;
    
    ctx.drawImage(img, 0, 0, size, size);

    const buf = canvas.toBuffer('image/png');
    writeFileSync(join(outDir, `icon${size}.png`), buf);
    console.log(`Generated icon${size}.png`);
  }
}

run().catch(err => {
  console.error('Failed to run icon generation:', err);
  process.exit(1);
});
