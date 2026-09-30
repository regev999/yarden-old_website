/** Yoast-compatible sitemaps, RSS feed and robots.txt, built from the database. */
import { unstable_cache } from 'next/cache';
import { q } from './db';
import { SITE_URL, absUrl, esc, excerptOf, toDate, ymd } from './html';
import { SITE_TITLE } from './shell';
import { CONTENT_TAG } from './render';

const GROUPS = ['post', 'page', 'category', 'post_tag'];

async function rowsFor(name) {
  if (name === 'post') {
    return q(`SELECT path, modified AS lastmod FROM posts WHERE status = 'published' AND NOT noindex AND duplicate_of IS NULL ORDER BY date DESC`);
  }
  const kind = { page: 'page', category: 'category', post_tag: 'tag' }[name];
  const rows = await q('SELECT path, updated_at AS lastmod FROM pages WHERE kind = $1 AND NOT noindex AND canonical IS NULL ORDER BY path', [kind]);
  return kind === 'page' ? rows : rows.map((r) => ({ path: r.path, lastmod: null }));
}

const xmlHead = '<?xml version="1.0" encoding="UTF-8"?>\n';

export const sitemap = (name) => unstable_cache(async () => {
  if (!GROUPS.includes(name)) return null;
  const rows = await rowsFor(name);
  const body = rows.map((r) => `<url><loc>${esc(absUrl(r.path))}</loc>${r.lastmod ? `<lastmod>${ymd(r.lastmod)}</lastmod>` : ''}</url>`).join('');
  return `${xmlHead}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>\n`;
}, ['sitemap', name], { tags: [CONTENT_TAG], revalidate: 86400 })();

export const sitemapIndex = unstable_cache(async () => {
  let index = '';
  for (const name of GROUPS) {
    const rows = await rowsFor(name);
    const dates = rows.map((r) => r.lastmod).filter(Boolean).map((d) => ymd(d)).sort();
    const last = dates.at(-1) || ymd(new Date());
    index += `<sitemap><loc>${SITE_URL}/${name}-sitemap.xml</loc><lastmod>${last}</lastmod></sitemap>`;
  }
  return `${xmlHead}<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${index}</sitemapindex>\n`;
}, ['sitemap-index'], { tags: [CONTENT_TAG], revalidate: 86400 });

/** RFC 822 date for a post's Israel wall-clock time, with Israel's offset that day (+0200 or +0300). */
function israelDate(d) {
  const wall = toDate(d);
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', timeZoneName: 'shortOffset' })
    .formatToParts(new Date(wall.getTime() - 2 * 3600e3)).find((x) => x.type === 'timeZoneName')?.value || 'GMT+2';
  const h = Number(/GMT\+(\d+)/.exec(name)?.[1] || 2);
  return wall.toUTCString().replace('GMT', `+0${h}00`);
}

export const rssFeed = unstable_cache(async () => {
  const posts = await q(`SELECT path, title, excerpt, body, date FROM posts WHERE status = 'published' AND duplicate_of IS NULL ORDER BY date DESC LIMIT 20`);
  const items = posts.map((p) => {
    const link = esc(absUrl(p.path));
    return `<item><title>${esc(p.title)}</title><link>${link}</link><guid>${link}</guid>`
      + `<pubDate>${israelDate(p.date)}</pubDate><description>${esc(excerptOf(p, 300))}</description></item>`;
  }).join('');
  return `${xmlHead}<rss version="2.0"><channel><title>${esc(SITE_TITLE)}</title><link>${SITE_URL}/</link>`
    + `<description>התמקדות, הקומי, Somatic Experiencing</description><language>he-IL</language>${items}</channel></rss>\n`;
}, ['rss'], { tags: [CONTENT_TAG], revalidate: 86400 });

export function robotsTxt() {
  return `User-agent: *\nDisallow: /admin/\nDisallow: /api/\n\nSitemap: ${SITE_URL}/sitemap_index.xml\n`;
}

export function xmlResponse(body, type = 'application/xml') {
  if (body === null) return new Response('Not found', { status: 404 });
  return new Response(body, { headers: { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400' } });
}
