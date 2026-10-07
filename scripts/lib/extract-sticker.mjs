// Cut the hexagon sticker (with its drop shadow) out of an official
// Hacktoberfest certificate image and normalise it onto a fixed canvas.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { decodePng, encodePng } from './png.mjs';

export const STICKER_WIDTH = 324;
export const STICKER_HEIGHT = 376;
const PADDING = 6;
const BG_TOLERANCE = 24; // summed |dR|+|dG|+|dB| below this counts as page background

function colorDistance(data, o, bg) {
  return Math.abs(data[o] - bg[0]) + Math.abs(data[o + 1] - bg[1]) + Math.abs(data[o + 2] - bg[2]);
}

/**
 * Find the connected non-background region containing the image centre.
 * Returns a Uint8Array mask (1 = sticker) and its bounding box.
 */
function findStickerRegion({ width, height, data }, bg) {
  const solid = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    solid[i] = data[i * 4 + 3] > 0 && colorDistance(data, i * 4, bg) > BG_TOLERANCE ? 1 : 0;
  }

  // Seed: the solid pixel closest to the centre (the sticker always sits mid-page)
  const cx = width >> 1, cy = height >> 1;
  let seed = -1;
  for (let r = 0; r < Math.min(cx, cy) && seed < 0; r++) {
    for (let dy = -r; dy <= r && seed < 0; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const i = (cy + dy) * width + cx + dx;
        if (solid[i]) { seed = i; break; }
      }
    }
  }
  if (seed < 0) throw new Error('No sticker found near the centre of the certificate');

  const mask = new Uint8Array(width * height);
  const stack = [seed];
  mask[seed] = 1;
  let x0 = width, y0 = height, x1 = 0, y1 = 0;
  while (stack.length) {
    const i = stack.pop();
    const x = i % width, y = (i / width) | 0;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const n = ny * width + nx;
        if (solid[n] && !mask[n]) { mask[n] = 1; stack.push(n); }
      }
    }
  }
  return { mask, box: { x0, y0, x1, y1 } };
}

/**
 * Build an RGBA crop of the sticker. Background reachable from the crop edge
 * becomes transparent; enclosed pixels stay opaque even if they match the page
 * colour. The one-pixel fringe keeps partial alpha so edges stay smooth.
 */
function cutOut(img, bg, mask, { x0, y0, x1, y1 }) {
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const outside = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const i = stack.pop();
    if (outside[i]) continue;
    const x = i % w, y = (i / w) | 0;
    if (mask[(y + y0) * img.width + x + x0]) continue;
    outside[i] = 1;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - w);
    if (y < h - 1) stack.push(i + w);
  }

  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const o = ((y + y0) * img.width + x + x0) * 4;
      data.set(img.data.subarray(o, o + 3), i * 4);
      if (!outside[i]) {
        data[i * 4 + 3] = 255;
      } else {
        const touchesSticker =
          (x > 0 && !outside[i - 1]) || (x < w - 1 && !outside[i + 1]) ||
          (y > 0 && !outside[i - w]) || (y < h - 1 && !outside[i + w]);
        data[i * 4 + 3] = touchesSticker
          ? Math.min(255, Math.round((colorDistance(img.data, o, bg) / BG_TOLERANCE) * 255))
          : 0;
      }
    }
  }
  return { width: w, height: h, data };
}

/**
 * Area-average resample `src` (premultiplied) and centre it on a fixed canvas.
 */
function fitToCanvas(src, width, height, padding) {
  const scale = Math.min((width - 2 * padding) / src.width, (height - 2 * padding) / src.height);
  const dw = src.width * scale, dh = src.height * scale;
  const ox = (width - dw) / 2, oy = (height - dh) / 2;
  const out = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    const sy0 = (y - oy) / scale, sy1 = (y + 1 - oy) / scale;
    if (sy1 <= 0 || sy0 >= src.height) continue;
    for (let x = 0; x < width; x++) {
      const sx0 = (x - ox) / scale, sx1 = (x + 1 - ox) / scale;
      if (sx1 <= 0 || sx0 >= src.width) continue;
      let r = 0, g = 0, b = 0, a = 0, area = 0;
      for (let sy = Math.max(0, Math.floor(sy0)); sy < Math.min(src.height, Math.ceil(sy1)); sy++) {
        const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0);
        for (let sx = Math.max(0, Math.floor(sx0)); sx < Math.min(src.width, Math.ceil(sx1)); sx++) {
          const wgt = wy * (Math.min(sx + 1, sx1) - Math.max(sx, sx0));
          const o = (sy * src.width + sx) * 4;
          const alpha = src.data[o + 3] / 255;
          r += src.data[o] * alpha * wgt;
          g += src.data[o + 1] * alpha * wgt;
          b += src.data[o + 2] * alpha * wgt;
          a += alpha * wgt;
          area += wgt;
        }
      }
      const o = (y * width + x) * 4;
      if (a > 0) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
        out[o + 3] = Math.round((a / (area || 1)) * 255);
      }
    }
  }
  return { width, height, data: out };
}

/**
 * Extract the sticker from a certificate PNG buffer and return a PNG buffer.
 */
export function extractStickerPng(certificateBuffer) {
  const img = decodePng(certificateBuffer);
  // Page background: sample the bottom-right corner, which is always plain
  const o = ((img.height - 4) * img.width + img.width - 4) * 4;
  const bg = [img.data[o], img.data[o + 1], img.data[o + 2]];
  const { mask, box } = findStickerRegion(img, bg);
  const crop = cutOut(img, bg, mask, box);
  return encodePng(fitToCanvas(crop, STICKER_WIDTH, STICKER_HEIGHT, PADDING));
}

export function extractStickerFile(certificatePath, outputPath) {
  const png = extractStickerPng(readFileSync(certificatePath));
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, png);
  return png.length;
}
