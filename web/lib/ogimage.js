/** Which share image a page uses (server-only: reads public/og/index.json). */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { absUrl } from './html';
import { ogKey } from './og';

let made;
function generated() {
  if (!made) {
    try { made = new Set(JSON.parse(readFileSync(path.join(process.cwd(), 'public', 'og', 'index.json'), 'utf8'))); } catch { made = new Set(); }
  }
  return made;
}

/** An image set in the admin wins (unless it's a missing WordPress upload); then the generated one; then the default. */
export function ogImageFor(pagePath, explicit) {
  if (explicit && !explicit.includes('/wp-content/uploads/')) return explicit;
  const key = ogKey(pagePath);
  if (generated().has(key)) return absUrl(`/og/${key}.jpg`);
  return generated().has('default') ? absUrl('/og/default.jpg') : explicit || '';
}
