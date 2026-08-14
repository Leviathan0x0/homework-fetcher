import { readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

const MAX_ENTRY_KIB = 700;
const MAX_ENTRY_GZIP_KIB = 215;
const distDirectory = path.resolve('dist');
const indexPath = path.join(distDirectory, 'index.html');
const indexHtml = await readFile(indexPath, 'utf8');
const entryMatch = indexHtml.match(
  /<script[^>]*type=["']module["'][^>]*src=["']([^"']+\.js)["'][^>]*>/i,
);

if (!entryMatch) {
  throw new Error('Unable to find the JavaScript entry point in dist/index.html.');
}

const entryPath = path.join(distDirectory, entryMatch[1].replace(/^\//, ''));
const entrySource = await readFile(entryPath);
const entryStats = await stat(entryPath);
const rawKib = entryStats.size / 1024;
const gzipKib = gzipSync(entrySource).byteLength / 1024;
const relativeEntryPath = path.relative(process.cwd(), entryPath);

console.log(
  `Bundle entry ${relativeEntryPath}: ${rawKib.toFixed(1)} KiB raw, ${gzipKib.toFixed(1)} KiB gzip`,
);

const failures = [];
if (rawKib > MAX_ENTRY_KIB) {
  failures.push(`${rawKib.toFixed(1)} KiB raw exceeds ${MAX_ENTRY_KIB} KiB`);
}
if (gzipKib > MAX_ENTRY_GZIP_KIB) {
  failures.push(`${gzipKib.toFixed(1)} KiB gzip exceeds ${MAX_ENTRY_GZIP_KIB} KiB`);
}

if (failures.length > 0) {
  throw new Error(`Entry bundle budget exceeded: ${failures.join('; ')}`);
}
