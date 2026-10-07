// Fill the banner template's hexagon slots with earned stickers.
// Sticker PNGs are embedded as data URIs: GitHub serves README images through
// <img>, and SVGs rendered that way never fetch external or relative files.

const INK = '#09232E';
const CREAM = '#F6F1EA';
const FILLED_FACE = '#E9E1D6';
const SOCKET_SHADOW = '#BDB3A8';
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";
const DIVIDER_CENTER = { x: 512, y: 250.6 };

// Hexagon geometry inside the 324x376 PNGs written by extract-sticker.mjs:
// a regular pointy-top hexagon (outer ink outline), with the drop shadow
// spilling down and to the left of it.
const STICKER_PNG = { width: 324, height: 376 };
const STICKER_HEX = { cx: 166.5, cy: 180.5, r: 172.5 };

// Sockets are the same hexagon, a little larger, so stickers sit with an even margin
const SOCKET_RADIUS = 53;
const SOCKET_CORNER = 6;
const SOCKET_STROKE = 3.6;
const SOCKET_SHADOW_DROP = 5;
const STICKER_RADIUS = 41;

const SLOT_RE = /<g id="slot-(\d+)" data-cx="([\d.]+)" data-cy="([\d.]+)"[^>]*><g class="frame">[\s\S]*?<\/g><g class="dashes">[\s\S]*?<\/g><\/g>/g;

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const fmt = n => +n.toFixed(2);

/**
 * Path for a pointy-top hexagon with rounded corners.
 */
function hexPath(cx, cy, r, corner = 0) {
  const vertices = Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  });
  const toward = ([x, y], [tx, ty], d) => {
    const len = Math.hypot(tx - x, ty - y);
    return [x + ((tx - x) / len) * d, y + ((ty - y) / len) * d];
  };
  return vertices.map((v, i) => {
    const prev = vertices[(i + 5) % 6];
    const next = vertices[(i + 1) % 6];
    const [ax, ay] = toward(v, prev, corner);
    const [bx, by] = toward(v, next, corner);
    return `${i === 0 ? 'M' : 'L'}${fmt(ax)} ${fmt(ay)}Q${fmt(v[0])} ${fmt(v[1])} ${fmt(bx)} ${fmt(by)}`;
  }).join('') + 'Z';
}

/**
 * Parse the slot groups out of the template, in left-to-right order.
 */
export function parseSlots(template) {
  return [...template.matchAll(SLOT_RE)]
    .map(([source, index, cx, cy]) => ({ source, index: Number(index), cx: Number(cx), cy: Number(cy) }))
    .sort((a, b) => a.index - b.index);
}

/**
 * Decide what each slot shows. With more stickers than slots, the last slot
 * becomes a "+N more" teaser pointing at the sticker book.
 */
export function planSlots(slotCount, stickers) {
  const overflow = stickers.length > slotCount;
  const shown = overflow ? stickers.slice(0, slotCount - 1) : stickers;
  return Array.from({ length: slotCount }, (_, i) => {
    if (i < shown.length) return { kind: 'sticker', sticker: shown[i] };
    if (overflow && i === slotCount - 1) return { kind: 'more', count: stickers.length - shown.length };
    return { kind: 'empty' };
  });
}

/**
 * The hexagon socket a sticker sits in: beige drop shadow, ink outline, and a
 * face that is tinted when filled or carries a dashed guide line when empty.
 */
function renderSocket({ cx, cy }, filled) {
  const outline = hexPath(cx, cy, SOCKET_RADIUS, SOCKET_CORNER);
  let svg = `<path fill="${SOCKET_SHADOW}" d="${hexPath(cx, cy + SOCKET_SHADOW_DROP, SOCKET_RADIUS, SOCKET_CORNER)}"/>` +
    `<path fill="${filled ? FILLED_FACE : CREAM}" stroke="${INK}" stroke-width="${SOCKET_STROKE}" stroke-linejoin="round" d="${outline}"/>`;
  if (!filled) {
    svg += `<path fill="none" stroke="${INK}" stroke-width="1.5" stroke-dasharray="4.5 4" stroke-linecap="round" ` +
      `d="${hexPath(cx, cy, SOCKET_RADIUS - 7.5, SOCKET_CORNER - 1.5)}"/>`;
  }
  return svg;
}

function renderFilledSlot(slot, sticker, imageDataUri) {
  // Scale the PNG so its hexagon has STICKER_RADIUS, then centre that hexagon on the socket
  const scale = STICKER_RADIUS / STICKER_HEX.r;
  const x = slot.cx - STICKER_HEX.cx * scale;
  const y = slot.cy - STICKER_HEX.cy * scale;
  return `<g id="slot-${slot.index}"><title>${escapeXml(sticker.name)}</title>${renderSocket(slot, true)}` +
    `<image x="${fmt(x)}" y="${fmt(y)}" width="${fmt(STICKER_PNG.width * scale)}" height="${fmt(STICKER_PNG.height * scale)}" href="${imageDataUri}"/></g>`;
}

function renderEmptySlot(slot) {
  return `<g id="slot-${slot.index}"><title>Not collected yet</title>${renderSocket(slot, false)}</g>`;
}

function renderMoreSlot(slot, count) {
  const label = `+${count}`;
  return `<g id="slot-${slot.index}"><title>${count} more in the sticker book</title>${renderSocket(slot, false)}` +
    `<text x="${slot.cx}" y="${slot.cy + 3}" text-anchor="middle" font-family="${MONO}" font-weight="800" font-size="22" fill="${INK}" ` +
    `textLength="${label.length * 13}" lengthAdjust="spacingAndGlyphs">${label}</text>` +
    `<text x="${slot.cx}" y="${slot.cy + 18}" text-anchor="middle" font-family="${MONO}" font-weight="700" font-size="8.5" fill="${INK}" ` +
    `textLength="30" lengthAdjust="spacingAndGlyphs">MORE</text></g>`;
}

function renderCounter(earned, total) {
  const label = `${earned} / ${total} COLLECTED`;
  const textWidth = label.length * 6.1;
  const pillWidth = textWidth + 20;
  const { x, y } = DIVIDER_CENTER;
  return `<g id="divider-center"><rect x="${(x - pillWidth / 2).toFixed(2)}" y="${y - 9.5}" width="${pillWidth.toFixed(2)}" height="19" rx="9.5" fill="${INK}"/>` +
    `<text x="${x}" y="${y + 3.4}" text-anchor="middle" font-family="${MONO}" font-weight="700" font-size="9.5" fill="${CREAM}" ` +
    `textLength="${textWidth.toFixed(2)}" lengthAdjust="spacingAndGlyphs">${escapeXml(label)}</text></g>`;
}

/**
 * Render the banner SVG.
 *
 * @param {object} options
 * @param {string} options.template          Contents of banner-template.svg
 * @param {object[]} options.stickers        Earned stickers to show, in display order
 * @param {number} options.earnedCount       Stickers earned so far, for the counter
 * @param {number} options.totalStickers     Size of the full collection, for the counter
 * @param {string} options.title             Accessible title for the image
 * @param {(sticker: object) => Buffer} options.readImage  Returns the sticker PNG bytes
 */
export function renderBanner({ template, stickers, earnedCount = stickers.length, totalStickers, title, readImage }) {
  const slots = parseSlots(template);
  if (slots.length === 0) throw new Error('Banner template has no hexagon slots');
  if (!template.includes('<g id="divider-center">')) throw new Error('Banner template is missing the divider ornament');

  let svg = template;
  planSlots(slots.length, stickers).forEach((plan, i) => {
    const slot = slots[i];
    if (plan.kind === 'sticker') {
      const uri = `data:image/png;base64,${readImage(plan.sticker).toString('base64')}`;
      svg = svg.replace(slot.source, () => renderFilledSlot(slot, plan.sticker, uri));
    } else if (plan.kind === 'more') {
      svg = svg.replace(slot.source, () => renderMoreSlot(slot, plan.count));
    } else {
      svg = svg.replace(slot.source, () => renderEmptySlot(slot));
    }
  });

  // The counter replaces the divider ornament but is drawn last: the divider
  // line segments come after the ornament in the template and would cover it.
  return svg
    .replace(/<g id="divider-center">[\s\S]*?<\/g>\n?/, '')
    .replace('<!--OVERLAY-->', () => renderCounter(earnedCount, Math.max(totalStickers || 0, earnedCount)))
    .replace(/<svg [^>]*>/, open => `${open.replace('<svg ', '<svg role="img" aria-label="' + escapeXml(title) + '" ')}\n<title>${escapeXml(title)}</title>`);
}
