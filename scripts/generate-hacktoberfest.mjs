#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, cpSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderBanner } from './lib/banner.mjs';
import { extractStickerFile } from './lib/extract-sticker.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..');

const DEFAULT_MANIFEST_PATH = resolve(ROOT_DIR, 'data/hacktoberfest.json');
const DEFAULT_README_PATH = resolve(ROOT_DIR, 'README.md');
const ASSETS_SOURCE = resolve(ROOT_DIR, 'assets/hacktoberfest');
const DOCS_ASSETS_DEST = resolve(ROOT_DIR, 'docs/assets/hacktoberfest');
const BANNER_TEMPLATE_PATH = resolve(ROOT_DIR, 'assets/hacktoberfest/branding/banner-template.svg');
const BANNER_OUTPUT_PATH = resolve(ROOT_DIR, 'assets/hacktoberfest/branding/banner.svg');
const BANNER_README_SRC = 'assets/hacktoberfest/branding/banner.svg';
const STICKER_BOOK_PATH = resolve(ROOT_DIR, 'docs/index.html');
const BOOK_START_MARKER = '/* STICKER_DATA:START */';
const BOOK_END_MARKER = '/* STICKER_DATA:END */';

const START_MARKER = '<!-- HACKTOBERFEST:START -->';
const END_MARKER = '<!-- HACKTOBERFEST:END -->';

/**
 * Synchronize assets to docs/assets for GitHub Pages
 */
export function syncDocsAssets() {
  if (existsSync(ASSETS_SOURCE)) {
    mkdirSync(dirname(DOCS_ASSETS_DEST), { recursive: true });
    cpSync(ASSETS_SOURCE, DOCS_ASSETS_DEST, {
      recursive: true,
      filter: src => basename(src) !== 'banner-template.svg',
    });
  }
}

/**
 * Escape HTML special characters for attributes and text
 */
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Load and parse the sticker manifest JSON
 */
export function loadManifest(manifestPath = DEFAULT_MANIFEST_PATH) {
  if (!existsSync(manifestPath)) {
    throw new Error(`Manifest file not found: ${manifestPath}`);
  }
  const content = readFileSync(manifestPath, 'utf8');
  try {
    return JSON.parse(content);
  } catch (err) {
    throw new Error(`Malformed JSON in manifest: ${err.message}`);
  }
}

/**
 * Cut sticker images out of their certificates. Runs for earned stickers whose
 * image is missing, or for every earned sticker when `force` is set.
 */
export function extractStickers(manifest, { force = false, baseDir = ROOT_DIR } = {}) {
  const extracted = [];
  for (const s of manifest.stickers || []) {
    if (!s.earned || !s.image || !s.certificate) continue;
    const imagePath = resolve(baseDir, s.image);
    const certificatePath = resolve(baseDir, s.certificate);
    if (!force && existsSync(imagePath)) continue;
    if (!existsSync(certificatePath)) {
      throw new Error(`Certificate file not found for sticker "${s.id}": ${s.certificate}`);
    }
    extractStickerFile(certificatePath, imagePath);
    extracted.push(s.id);
  }
  return extracted;
}

/**
 * Validate manifest schema, fields, uniqueness and file existence
 */
export function validateManifest(manifest, baseDir = ROOT_DIR) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('Manifest must be a valid JSON object');
  }

  const requiredRootFields = ['year', 'owner', 'username', 'stickers'];
  for (const field of requiredRootFields) {
    if (manifest[field] === undefined || manifest[field] === null) {
      throw new Error(`Manifest missing required root field: "${field}"`);
    }
  }

  if (!Array.isArray(manifest.stickers)) {
    throw new Error('Manifest "stickers" must be an array');
  }

  const seenIds = new Set();

  for (let i = 0; i < manifest.stickers.length; i++) {
    const s = manifest.stickers[i];
    const indexStr = `sticker at index ${i} (${s?.id || 'unidentified'})`;

    if (!s.id || typeof s.id !== 'string') {
      throw new Error(`Missing or invalid "id" for ${indexStr}`);
    }
    if (seenIds.has(s.id)) {
      throw new Error(`Duplicate sticker id "${s.id}" found in manifest`);
    }
    seenIds.add(s.id);

    if (typeof s.displayOrder !== 'number') {
      throw new Error(`Missing or invalid "displayOrder" for sticker "${s.id}"`);
    }
    if (!s.name || typeof s.name !== 'string') {
      throw new Error(`Missing or invalid "name" for sticker "${s.id}"`);
    }
    if (typeof s.earned !== 'boolean') {
      throw new Error(`Missing or non-boolean "earned" status for sticker "${s.id}"`);
    }

    if (s.earned) {
      if (!s.image || typeof s.image !== 'string') {
        throw new Error(`Earned sticker "${s.id}" must have an "image" path`);
      }
      const absoluteImagePath = resolve(baseDir, s.image);
      if (!existsSync(absoluteImagePath)) {
        throw new Error(`Image file not found for sticker "${s.id}": ${s.image}`);
      }

      if (!s.url || typeof s.url !== 'string') {
        throw new Error(`Earned sticker "${s.id}" must have a valid destination "url"`);
      }
      try {
        new URL(s.url);
      } catch {
        throw new Error(`Invalid URL for sticker "${s.id}": "${s.url}"`);
      }
    }
  }

  return true;
}

/**
 * Earned stickers to feature, in display order
 */
function featuredStickers(manifest) {
  return manifest.stickers
    .filter(s => s.earned && s.featured !== false)
    .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
}

function collectionStats(manifest) {
  const earned = manifest.stickers.filter(s => s.earned).length;
  return { earned, total: manifest.totalStickers || manifest.stickers.length };
}

/**
 * Render the banner SVG with earned stickers placed in its hexagon slots
 */
export function renderHacktoberfestBanner(manifest, baseDir = ROOT_DIR) {
  validateManifest(manifest, baseDir);
  const { earned, total } = collectionStats(manifest);

  return renderBanner({
    template: readFileSync(BANNER_TEMPLATE_PATH, 'utf8'),
    stickers: featuredStickers(manifest),
    earnedCount: earned,
    totalStickers: total,
    title: `Hacktoberfest ${manifest.year} sticker collection of ${manifest.owner}: ${earned} of ${total} stickers collected`,
    readImage: s => readFileSync(resolve(baseDir, s.image)),
  });
}

/**
 * Render the complete Hacktoberfest section HTML
 */
export function renderHacktoberfestSection(manifest) {
  validateManifest(manifest);

  const { earned, total } = collectionStats(manifest);
  const year = manifest.year || 2026;
  const stickerBookUrl = escapeHtml(manifest.stickerBookUrl || 'docs/index.html');
  const alt = escapeHtml(
    `Hacktoberfest ${year} sticker collection of ${manifest.owner}, ${earned} of ${total} collected: ` +
    featuredStickers(manifest).map(s => s.shortName || s.name).join(', ')
  );

  return `${START_MARKER}
<p align="center">
  <a href="${stickerBookUrl}" title="Open the full Hacktoberfest ${year} sticker book">
    <img src="${BANNER_README_SRC}" width="100%" alt="${alt}" />
  </a>
</p>
${END_MARKER}`;
}

/**
 * Render the sticker book page with the manifest's stickers injected between
 * its STICKER_DATA markers, so the GitHub Pages site always matches the data.
 */
export function renderStickerBook(manifest, html) {
  const start = html.indexOf(BOOK_START_MARKER);
  const end = html.indexOf(BOOK_END_MARKER);
  if (start === -1 || end === -1) {
    throw new Error('Sticker book page is missing its STICKER_DATA markers');
  }

  const book = {
    totalStickers: collectionStats(manifest).total,
    stickers: [...manifest.stickers]
      .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))
      .map(s => ({
        id: s.id,
        name: s.name,
        category: s.category || null,
        earned: s.earned,
        earnedDate: s.earned ? s.earnedDate || null : null,
        description: s.description || '',
        image: s.earned ? s.image : null,
        certificate: s.earned ? s.certificate || null : null,
        url: s.url || null,
      })),
  };
  // Keep "</script>" in any text from closing the inline script early
  const json = JSON.stringify(book, null, 2).replace(/</g, '\\u003c').replace(/\n/g, '\n    ');

  return html.substring(0, start + BOOK_START_MARKER.length) +
    `\n    const STICKER_BOOK = ${json};\n    ` +
    html.substring(end);
}

/**
 * Update README.md deterministically between START and END markers
 */
export function updateReadme(readmePath = DEFAULT_README_PATH, newSectionContent) {
  if (!existsSync(readmePath)) {
    throw new Error(`README file not found: ${readmePath}`);
  }

  const originalContent = readFileSync(readmePath, 'utf8');

  let updatedContent;
  if (originalContent.includes(START_MARKER) && originalContent.includes(END_MARKER)) {
    const startIndex = originalContent.indexOf(START_MARKER);
    const endIndex = originalContent.indexOf(END_MARKER) + END_MARKER.length;
    updatedContent = originalContent.substring(0, startIndex) +
                     newSectionContent +
                     originalContent.substring(endIndex);
  } else {
    // Insert after "About Me" section if possible, otherwise after first heading
    const insertionPointRegex = /(#+ [^\n]*About Me[^\n]*\n[\s\S]*?(?=\n#+ |\n## Socials|\n## 🌐 Socials|$))/i;
    const match = originalContent.match(insertionPointRegex);

    if (match) {
      const matchEnd = match.index + match[0].length;
      updatedContent = originalContent.substring(0, matchEnd) +
                       '\n\n' + newSectionContent + '\n' +
                       originalContent.substring(matchEnd);
    } else {
      // Fallback: prepend to beginning of README
      updatedContent = newSectionContent + '\n\n' + originalContent;
    }
  }

  const changed = updatedContent !== originalContent;
  if (changed) {
    writeFileSync(readmePath, updatedContent, 'utf8');
  }

  return { changed, updatedContent };
}

/**
 * CLI Main
 */
export function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Hacktoberfest Sticker Showcase Generator
Usage:
  node scripts/generate-hacktoberfest.mjs [options]

Options:
  --manifest <path>   Custom path to sticker manifest JSON
  --readme <path>     Custom path to README.md
  --check             Check that README.md, banner.svg and docs/index.html are up to date without writing (exits 1 if not)
  --extract           Re-extract every earned sticker image from its certificate
  --help, -h          Display this help message
`);
    process.exit(0);
  }

  let manifestPath = DEFAULT_MANIFEST_PATH;
  let readmePath = DEFAULT_README_PATH;
  const isCheckMode = args.includes('--check');
  const forceExtract = args.includes('--extract');

  const manifestArgIndex = args.indexOf('--manifest');
  if (manifestArgIndex !== -1 && args[manifestArgIndex + 1]) {
    manifestPath = resolve(process.cwd(), args[manifestArgIndex + 1]);
  }

  const readmeArgIndex = args.indexOf('--readme');
  if (readmeArgIndex !== -1 && args[readmeArgIndex + 1]) {
    readmePath = resolve(process.cwd(), args[readmeArgIndex + 1]);
  }

  try {
    console.log(`[1/5] Loading manifest from: ${manifestPath}`);
    const manifest = loadManifest(manifestPath);

    if (!isCheckMode) {
      console.log('[2/5] Extracting sticker images from certificates...');
      const extracted = extractStickers(manifest, { force: forceExtract });
      console.log(extracted.length ? `      extracted: ${extracted.join(', ')}` : '      nothing to extract');
    }

    console.log('[3/5] Validating sticker manifest and assets...');
    validateManifest(manifest);

    console.log('[4/5] Rendering banner and README section...');
    const bannerSvg = renderHacktoberfestBanner(manifest);
    const sectionHtml = renderHacktoberfestSection(manifest);
    const bannerChanged = !existsSync(BANNER_OUTPUT_PATH) || readFileSync(BANNER_OUTPUT_PATH, 'utf8') !== bannerSvg;
    const currentBook = readFileSync(STICKER_BOOK_PATH, 'utf8');
    const stickerBook = renderStickerBook(manifest, currentBook);
    const bookChanged = stickerBook !== currentBook;

    console.log(`[5/5] Updating README: ${readmePath}`);
    if (isCheckMode) {
      const currentReadme = readFileSync(readmePath, 'utf8');
      const start = currentReadme.indexOf(START_MARKER);
      const end = currentReadme.indexOf(END_MARKER);
      const readmeStale = start === -1 || end === -1 ||
        currentReadme.substring(start, end + END_MARKER.length) !== sectionHtml;
      if (readmeStale || bannerChanged || bookChanged) {
        const stale = [readmeStale && 'README.md', bannerChanged && 'banner.svg', bookChanged && 'docs/index.html']
          .filter(Boolean).join(', ');
        console.error(`❌ Check failed: ${stale} not up to date with manifest.`);
        process.exit(1);
      }
      console.log('✅ Check passed: README.md, banner.svg and the sticker book are up to date.');
      process.exit(0);
    }

    if (bannerChanged) writeFileSync(BANNER_OUTPUT_PATH, bannerSvg, 'utf8');
    console.log(bannerChanged ? '✨ banner.svg regenerated.' : '👌 banner.svg is already up-to-date.');

    if (bookChanged) writeFileSync(STICKER_BOOK_PATH, stickerBook, 'utf8');
    console.log(bookChanged ? '✨ Sticker book (docs/index.html) updated.' : '👌 Sticker book is already up-to-date.');

    const { changed } = updateReadme(readmePath, sectionHtml);
    if (changed) {
      console.log('✨ README.md updated successfully with new Hacktoberfest section.');
    } else {
      console.log('👌 README.md is already up-to-date. No changes made.');
    }

    // Keep docs/assets synchronized for GitHub Pages
    syncDocsAssets();
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }
}

// Run CLI when executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
