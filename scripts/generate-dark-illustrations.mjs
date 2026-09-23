// Generates Illustrations/dark/*.svg — dark-theme palette variants of the
// unDraw SVGs (which are designed for light backgrounds: glaring #fff,
// muddy #3f3d56/#2f2e41/#090814 that blend into dark surfaces).
//
// Strategy: soften near-whites, lift near-blacks, brighten the brand accent,
// keep chromatic colors (skin, reds, greens) untouched.
//
// Usage: node scripts/generate-dark-illustrations.mjs

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'Illustrations');
const outDir = join(srcDir, 'dark');

/** @type {Record<string, string>} lowercase hex → replacement hex */
const PALETTE = {
  // near-whites / pale grays → soft off-whites (kill the glare)
  '#ffffff': '#e4e4ea',
  '#fff': '#e4e4ea',
  '#f2f2f2': '#d6d6de',
  '#f0f0f0': '#d2d2da',
  '#e6e6e6': '#c8c8d2',
  '#e4e4e4': '#c6c6d0',
  '#d6d6e3': '#b3b3c8',
  '#ccc': '#a9a9b7',
  '#cacaca': '#a5a5b3',
  // mid grays
  '#6f6f6f': '#9191a1',
  // unDraw dark navy/slates → lifted so they don't vanish on dark surfaces
  '#3f3d56': '#7d7ba4',
  '#2f2e41': '#66638c',
  '#2f2e43': '#66638c',
  '#090814': '#514e78',
  // brand accent → slightly brighter on dark
  '#6c71ff': '#8185ff',
};

mkdirSync(outDir, { recursive: true });

let count = 0;
for (const file of readdirSync(srcDir)) {
  if (!file.endsWith('.svg') || file.endsWith('.svg.css')) continue;
  const src = readFileSync(join(srcDir, file), 'utf8');
  const out = src.replace(/#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g, (m) => PALETTE[m.toLowerCase()] ?? m);
  writeFileSync(join(outDir, file), out);
  count += 1;
}

console.log(`Generated ${count} dark illustration(s) in Illustrations/dark/`);
