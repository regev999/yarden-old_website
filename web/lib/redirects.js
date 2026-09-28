/** 301 redirects: lookup, built-in rules for old WordPress addresses, and saving with chain/loop checks. */
import { q, one } from './db';
import { enc } from './html';

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** Canonical form of a source address: decoded path, single slashes, query kept as is. */
export function normalizeSource(s) {
  s = String(s || '').trim();
  const full = /^https?:\/\/[^/]+(.*)$/i.exec(s);
  if (full) s = full[1] || '/';
  let query = '';
  const qi = s.indexOf('?');
  if (qi !== -1) { query = s.slice(qi); s = s.slice(0, qi); }
  s = safeDecode(s);
  s = '/' + s.replace(/\/+/g, '/').replace(/^\//, '');
  return s + query;
}

export function validTarget(t) {
  return /^(\/[^\s<>"]*|https?:\/\/[^\s<>"]+)$/i.test(t);
}

/** Encode a stored target for the Location header. */
export function encTarget(t) {
  if (!t.startsWith('/')) return t;
  const [p, qs] = t.split(/\?(.*)/s);
  return enc(p) + (qs !== undefined ? '?' + qs : '');
}

/** Find a redirect for a path (+ optional query string without "?"). */
export async function findRedirect(path, query = '') {
  path = normalizeSource(path);
  const candidates = [];
  if (query) {
    const qs = new URLSearchParams(query);
    for (const k of ['p', 'page_id', 'attachment_id']) {
      const v = qs.get(k);
      if (v && /^\d+$/.test(v)) candidates.push(`/?${k}=${v}`);
    }
    candidates.push(`${path}?${query}`);
  }
  candidates.push(path, path.endsWith('/') ? path.replace(/\/+$/, '') || '/' : path + '/');
  const rows = await q('SELECT id, source, target FROM redirects WHERE lower(source) = ANY($1::text[])', [candidates.map((c) => c.toLowerCase())]);
  for (const c of candidates) {
    const r = rows.find((x) => x.source.toLowerCase() === c.toLowerCase());
    if (r) return r;
  }
  return null;
}

export async function countHit(id) {
  await q('UPDATE redirects SET hits = hits + 1, last_hit = now() WHERE id = $1', [id]).catch(() => {});
}

/** Does a public address exist (page or published post)? */
export async function pathExists(p) {
  const r = await one(`SELECT 1 AS x FROM pages WHERE path = $1 UNION ALL SELECT 1 FROM posts WHERE path = $1 AND status = 'published' LIMIT 1`, [p]);
  return !!r;
}

/** Built-in rules for common WordPress addresses that no longer exist. */
export async function smartRedirect(path) {
  path = normalizeSource(path);
  const rules = [
    [/^(.*\/)(?:page\/\d+|feed|amp|embed|trackback|comment-page-\d+)\/?$/, '$1'], // pagination, feeds, AMP
    [/^\/(?:author|wp-json|wp-includes)(?:\/.*)?$/, '/'],
    [/^\/\d{4}(?:\/\d{2})?(?:\/\d{2})?\/?$/, '/בלוג/'], // date archives
    [/^(.*)\/index\.php$/, '$1/'],
  ];
  for (const [re, to] of rules) {
    if (re.test(path)) {
      const t = path.replace(re, to);
      if (t === '/' || t === '/בלוג/') return t;
      if (t !== path && (await pathExists(t))) return t;
    }
  }
  // Resized image that isn't there: send to the original file (served from /public or Blob).
  const img = /^(\/wp-content\/uploads\/.+)-\d{2,4}x\d{2,4}(\.(?:jpe?g|png|gif|webp))$/i.exec(path);
  if (img) return img[1] + img[2];
  // "-2" copies: /slug-2/ → /slug/ when only the original exists.
  const dup = /^\/(.+)-\d\/$/.exec(path);
  if (dup && (await pathExists(`/${dup[1]}/`))) return `/${dup[1]}/`;
  return null;
}

const SCANNER = /(\.(php|asp|aspx|env|git|sql|bak|ini|cgi|xml\.gz)$|\/wp-admin|\/wp-login|xmlrpc|\/\.well-known\/|\/cgi-bin\/|\/vendor\/|\/\.)/i;

export async function logNotFound(path, referrer = '') {
  path = normalizeSource(path);
  if (SCANNER.test(path) || path.length > 400) return;
  await q(`INSERT INTO notfound(path, hits, referrer) VALUES($1, 1, $2)
           ON CONFLICT (path) DO UPDATE SET hits = notfound.hits + 1, last_seen = now(),
           referrer = CASE WHEN EXCLUDED.referrer <> '' THEN EXCLUDED.referrer ELSE notfound.referrer END`,
  [path, String(referrer).slice(0, 300)]);
  if (Math.random() < 0.02) {
    await q(`DELETE FROM notfound WHERE last_seen < now() - interval '180 days' AND hits < 3`);
  }
}

const OWN_SITE = /^https?:\/\/(www\.)?yardenkerem\.co\.il(\/.*)?$/i;

/**
 * Save a redirect. Resolves chains (A→B when B→C becomes A→C) and refuses loops.
 * Returns null on success or an error message (Hebrew, shown in the admin).
 */
export async function saveRedirect(from, to, note = '', id = null) {
  from = normalizeSource(from);
  to = String(to || '').trim();
  const own = OWN_SITE.exec(to);
  if (own) to = safeDecode(own[2] || '/') || '/';
  if (to.startsWith('/')) to = normalizeSource(to);
  if (from === '/') return 'אי אפשר להפנות את דף הבית.';
  if (from.startsWith('/admin') || from.startsWith('/api/')) return 'אי אפשר להפנות כתובות של אזור הניהול.';
  if (!validTarget(to)) return 'כתובת היעד לא תקינה. כתבו כתובת שמתחילה ב־/ (בתוך האתר) או ב־https://';
  const seen = new Set([from]);
  let final = to;
  for (let i = 0; i < 10; i++) {
    const next = await one('SELECT target FROM redirects WHERE source = $1 AND id IS DISTINCT FROM $2', [final, id]);
    if (!next) break;
    if (seen.has(final)) return 'ההפניה יוצרת לולאה.';
    seen.add(final);
    final = next.target;
  }
  const strip = (s) => s.replace(/\/+$/, '');
  if (final === from || strip(final) === strip(from)) return 'המקור והיעד זהים (או מובילים זה לזה).';
  try {
    if (id) await q('UPDATE redirects SET source = $1, target = $2, note = $3 WHERE id = $4', [from, final, note, id]);
    else await q('INSERT INTO redirects(source, target, note) VALUES($1, $2, $3)', [from, final, note]);
  } catch {
    return 'כבר קיימת הפניה מהכתובת הזו.';
  }
  await q('UPDATE redirects SET target = $1 WHERE target = $2', [final, from]);
  await q('DELETE FROM notfound WHERE path = $1', [from]);
  return null;
}
