/**
 * ?v=<hash> on files under public/ that pages point to. Browsers keep /assets
 * for 30 days, so without it a replaced photo would show only to new visitors.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const hashes = {};

/** The file's content hash (10 hex digits), or '' when it can't be read. */
export function fileHash(publicPath) {
  if (publicPath.includes('..')) return '';
  if (!(publicPath in hashes)) {
    try {
      hashes[publicPath] = createHash('sha1').update(readFileSync(path.join(process.cwd(), 'public', decodeURI(publicPath)))).digest('hex').slice(0, 10);
    } catch { hashes[publicPath] = ''; }
  }
  return hashes[publicPath];
}

/** Stamp every /assets/ image in a piece of HTML with its version (in srcset lists too). */
export function versionAssets(html) {
  return html.replace(/(["'(]|,\s*)(\/assets\/[\w./-]+\.(?:jpe?g|png|webp|svg|gif))(?=["')\s])/g, (m, pre, p) => {
    const h = fileHash(p);
    return h ? `${pre}${p}?v=${h}` : m;
  });
}
