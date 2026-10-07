#!/usr/bin/env node
// One-off: convert a banner SVG exported from Recraft into the generator template.
// Strips metadata and the full-bleed background, crops to the card, and tags the
// six hexagon slots and the divider ornament so the generator can fill them.
//
// Usage: node scripts/prepare-banner-template.mjs <exported.svg> [output.svg]

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [input, output = resolve(ROOT_DIR, 'assets/hacktoberfest/branding/banner-template.svg')] = process.argv.slice(2);
if (!input) {
  console.error('Usage: node scripts/prepare-banner-template.mjs <exported.svg> [output.svg]');
  process.exit(1);
}

const SLOT_COUNT = 6;
const INK = '#09232E';
const VIEWBOX = { x: 8, y: 54, width: 1008, height: 391 }; // the rounded card, without the outer margin

const paths = [...readFileSync(input, 'utf8').matchAll(/<path fill="(#[0-9A-Fa-f]+)" d="([^"]+)"\/>/g)]
  .map(([raw, fill, d]) => {
    const n = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
    const xs = n.filter((_, i) => i % 2 === 0), ys = n.filter((_, i) => i % 2 === 1);
    return { raw, fill: fill.toUpperCase(), box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
  });

const width = p => p.box[2] - p.box[0];
const height = p => p.box[3] - p.box[1];
const inside = (p, o) => p.box[0] >= o.box[0] - 1 && p.box[1] >= o.box[1] - 1 && p.box[2] <= o.box[2] + 1 && p.box[3] <= o.box[3] + 1;

// Each slot is a contiguous run: dark outline, shadow, cream face, then the dashes
const slots = paths
  .map((p, i) => ({ p, i }))
  .filter(({ p }) => p.fill === INK && width(p) > 78 && width(p) < 90 && height(p) > 135 && height(p) < 152)
  .map(({ p, i }) => {
    const run = [i];
    while (run.at(-1) + 1 < paths.length && inside(paths[run.at(-1) + 1], p)) run.push(run.at(-1) + 1);
    return { run, face: paths[i + 2] };
  })
  .sort((a, b) => a.face.box[0] - b.face.box[0]);

if (slots.length !== SLOT_COUNT) throw new Error(`Expected ${SLOT_COUNT} hexagon slots, found ${slots.length}`);

const starIndex = paths.findIndex(p => p.fill === '#F2A963' && width(p) < 30 && height(p) < 30 &&
  Math.abs((p.box[0] + p.box[2]) / 2 - 512) < 10 && p.box[1] > 230 && p.box[3] < 270);
if (starIndex < 0) throw new Error('Divider ornament not found');

const slotStart = new Map(slots.map((s, k) => [s.run[0], k]));
const slotMember = new Set(slots.flatMap(s => s.run));
const fmt = n => +n.toFixed(2);

// Path 0 is the full-bleed background rectangle. Swap it for a rounded card so the
// corners are transparent while gaps in the edge artwork stay filled.
let body = `<rect x="9.8" y="56.5" width="1004.9" height="386.2" rx="16" fill="${INK}"/>\n`;
for (let i = 1; i < paths.length; i++) {
  if (i === starIndex) {
    body += `<g id="divider-center">${paths[i].raw}</g>\n`;
  } else if (slotStart.has(i)) {
    const k = slotStart.get(i);
    const { run, face } = slots[k];
    const [outline, shadow, faceRaw, ...dashes] = run.map(j => paths[j].raw);
    body += `<g id="slot-${k + 1}" data-cx="${fmt((face.box[0] + face.box[2]) / 2)}" data-cy="${fmt((face.box[1] + face.box[3]) / 2)}" ` +
      `data-w="${fmt(width(face))}" data-h="${fmt(height(face))}"><g class="frame">${outline}${shadow}<g class="face">${faceRaw}</g></g>` +
      `<g class="dashes">${dashes.join('')}</g></g>\n`;
  } else if (!slotMember.has(i)) {
    body += paths[i].raw + '\n';
  }
}

const { x, y, width: w, height: h } = VIEWBOX;
writeFileSync(output, `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}">\n${body}<!--OVERLAY-->\n</svg>\n`);
console.log(`Wrote ${output}`);
