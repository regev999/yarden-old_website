/**
 * Copies the Focusing for Freedom blog (Yarden's storytelling site) into this
 * site's blog. It reads that blog's /blog/export.json, adds new posts, updates
 * the ones edited there and turns the ones no longer there into drafts.
 *
 * That blog stays the original: each copy's canonical is its address there,
 * and copies stay out of this site's sitemap, so Google shows the original.
 * Edits made here to a copy last until the post is edited there again.
 *
 * Runs every 15 minutes (instrumentation.js calls app/api/blog-sync) and from
 * the "סנכרון עכשיו" button on the admin's posts screen.
 */
import { q, one } from './db';
import { putFile } from './storage';
import { SITE_URL, esc, plain, youtubeId } from './html';
import { contactHtml } from './content';
import { sanitizeHtml } from './admin/sanitize';
import { makeSlug, publishChanges, uniquePath } from './admin/common';

export const SOURCE_NAME = 'Focusing for Freedom';
const SOURCE = process.env.BLOG_SYNC_URL || 'https://storytelling-site-he.vercel.app/blog/export.json';
const STATE_KEY = 'blog_sync';
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };
const MAX_IMAGE = 15 * 1024 * 1024;

/** The last run: { at, ok, added, updated, hidden, error }. */
export async function lastSync() {
  const row = await one('SELECT value FROM settings WHERE key = $1', [STATE_KEY]);
  try { return row ? JSON.parse(row.value) : null; } catch { return null; }
}

let running = null;
/** One run at a time: a click during a scheduled run waits for that run. */
export function syncBlog() {
  running ??= run().finally(() => { running = null; });
  return running;
}

async function run() {
  const result = { at: new Date().toISOString(), ok: false, added: 0, updated: 0, hidden: 0, error: '' };
  try {
    const res = await fetch(SOURCE, { headers: { accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(30000) })
      .catch((err) => { throw new Error(err?.name === 'TimeoutError' ? `הבלוג של ${SOURCE_NAME} לא ענה בזמן.` : `אין חיבור לבלוג של ${SOURCE_NAME}.`); });
    if (!res.ok) throw new Error(`הבלוג של ${SOURCE_NAME} לא ענה (${res.status}).`);
    const feed = await res.json().catch(() => null);
    if (!Array.isArray(feed?.posts) || !Array.isArray(feed?.categories)) throw new Error('התשובה מהבלוג לא בפורמט הצפוי.');

    const categories = new Map();
    for (const c of feed.categories) {
      if (c?.slug && c?.name) categories.set(c.slug, await ensureCategory(c));
    }

    const seen = new Set();
    for (const s of feed.posts) {
      if (!s?.id || !s.title || !/^https:\/\//.test(s.url || '')) continue;
      seen.add(String(s.id));
      const done = await syncPost(s, categories);
      if (done) result[done]++;
    }

    // An empty list is more likely a fault there than every post taken down: leave the copies alone
    if (feed.posts.length) {
      const ids = (await q("SELECT id, source_id FROM posts WHERE source_id IS NOT NULL AND status = 'published'"))
        .filter((r) => !seen.has(r.source_id)).map((r) => r.id);
      if (ids.length) {
        // source_modified is cleared, so the post comes back in full if it is published there again
        await q("UPDATE posts SET status = 'draft', source_modified = NULL WHERE id = ANY($1::int[])", [ids]);
        result.hidden = ids.length;
      }
    }
    result.ok = true;
  } catch (err) {
    result.error = String(err?.message || err);
  }
  await q('INSERT INTO settings(key, value) VALUES($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [STATE_KEY, JSON.stringify(result)]);
  if (result.added || result.updated || result.hidden) publishChanges();
  return result;
}

/** A category there becomes one here (with its page), unless one with that address exists. */
async function ensureCategory(c) {
  const slug = makeSlug(c.slug);
  await q(`INSERT INTO terms(kind, slug, name) VALUES('category', $1, $2) ON CONFLICT DO NOTHING`, [slug, c.name]);
  const main = `<header class="page-hero"><div class="wrap"><p class="crumb">קטגוריה</p><h1>${esc(c.name)}</h1></div></header>
<section class="block"><div class="wrap"><!--yk:list--><!--/yk:list--></div></section>
${contactHtml()}`;
  await q(`INSERT INTO pages(path, kind, title, description, main) VALUES($1, 'category', $2, $3, $4) ON CONFLICT (path) DO NOTHING`,
    [`/category/${slug}/`, c.name, `קטגוריה: ${c.name} – ירדן כרם`, main]);
  return slug;
}

/** Adds or updates one post. Returns 'added', 'updated' or null (unchanged). */
async function syncPost(s, categories) {
  const sourceId = String(s.id);
  const version = String(s.updated_at || s.published_at || '');
  const row = await one('SELECT * FROM posts WHERE source_id = $1', [sourceId]);
  if (row && row.source_modified === version) {
    // Same version; only the original's address may have moved (a new domain there)
    if (row.source_url !== s.url) await q('UPDATE posts SET source_url = $2 WHERE id = $1', [row.id, s.url]);
    return null;
  }

  const cover = s.cover_image_url ? await copyImage(s.cover_image_url) : '';
  const body = (cover ? `<figure><img src="${esc(cover)}" alt="${esc(s.cover_image_alt || '')}"></figure>` : '') + await bodyFrom(s.content_html);
  const title = String(s.title).replace(/\s+/g, ' ').trim().slice(0, 300);
  const excerpt = String(s.excerpt || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  const description = String(s.seo_description || '').trim() || excerpt || plain(body, 155);
  const cats = categories.has(s.category) ? [categories.get(s.category)] : [];
  const isVideo = !!youtubeId(body) && plain(body).length < 200;
  const ogImage = cover ? (cover.startsWith('/') ? SITE_URL.replace(/\/$/, '') + cover : cover) : '';
  const published = s.published_at || s.updated_at || new Date().toISOString();
  const vals = [title, body, excerpt, String(s.seo_title || '').trim().slice(0, 300), description, ogImage, JSON.stringify(cats),
    isVideo, published, version || published, s.url, version];

  if (row) {
    await q("INSERT INTO revisions(path, kind, content, note, username) VALUES($1, 'post', $2, $3, 'system')",
      [row.path, JSON.stringify(row), `לפני עדכון מ־${SOURCE_NAME}`]);
    await q(`UPDATE posts SET title=$1, body=$2, format='rich', excerpt=$3, seo_title=$4, description=$5, og_image=$6, categories=$7,
               is_video=$8, date=($9::timestamptz AT TIME ZONE 'Asia/Jerusalem'), modified=($10::timestamptz AT TIME ZONE 'Asia/Jerusalem'),
               source_url=$11, source_modified=$12, status='published' WHERE id=$13`, [...vals, row.id]);
    return 'updated';
  }
  // The address is made once, like a post written here, and stays even if it changes there
  const path = await uniquePath(makeSlug(s.slug || title));
  const added = await q(`INSERT INTO posts(path, title, body, format, excerpt, seo_title, description, og_image, categories, is_video, date, modified,
                           source_url, source_modified, source_id, status)
                         VALUES($13, $1, $2, 'rich', $3, $4, $5, $6, $7, $8, ($9::timestamptz AT TIME ZONE 'Asia/Jerusalem'),
                           ($10::timestamptz AT TIME ZONE 'Asia/Jerusalem'), $11, $12, $14, 'published')
                         ON CONFLICT (source_id) WHERE source_id IS NOT NULL DO NOTHING RETURNING id`, [...vals, path, sourceId]);
  return added.length ? 'added' : null;
}

/** The post's HTML as this site's editor would store it, with its images copied here. */
async function bodyFrom(html) {
  let out = String(html || '')
    // Embeds: YouTube becomes this site's player (the cleaner turns a lone link into one), others a link
    .replace(/<iframe\b[^>]*\ssrc="([^"]+)"[^>]*>[\s\S]*?<\/iframe>/gi, (m, src) => {
      const yt = /youtube(?:-nocookie)?\.com\/embed\/([\w-]{11})/.exec(src)?.[1];
      if (yt) return `<p>https://youtu.be/${yt}</p>`;
      const vimeo = /player\.vimeo\.com\/video\/(\d+)/.exec(src)?.[1];
      return vimeo ? `<p><a href="https://vimeo.com/${vimeo}">לצפייה בסרטון</a></p>` : '';
    })
    // An uploaded video: a link to it
    .replace(/<video\b([^>]*)>([\s\S]*?)<\/video>/gi, (m, attrs, inner) => {
      const src = /\ssrc="([^"]+)"/.exec(attrs)?.[1] || /<source\b[^>]*\ssrc="([^"]+)"/.exec(inner)?.[1];
      return src ? `<p><a href="${src}">לצפייה בסרטון</a></p>` : '';
    })
    // Their only divs wrap embeds; without them a player is not left inside a paragraph
    .replace(/<\/?div\b[^>]*>/gi, '');
  const images = [...new Set([...out.matchAll(/<img\b[^>]*\ssrc="(https:\/\/[^"]+)"/gi)].map((m) => m[1]))];
  for (const src of images) {
    const local = await copyImage(src.replace(/&amp;/g, '&'));
    if (local !== src) out = out.split(`src="${src}"`).join(`src="${esc(local)}"`);
  }
  return sanitizeHtml(out);
}

/** An image is copied here once, so the copy doesn't depend on the other site. If that fails, it stays linked there. */
async function copyImage(src) {
  if (!/^https:\/\//.test(src)) return src;
  const known = await one('SELECT url FROM synced_media WHERE source_url = $1', [src]);
  if (known) return known.url;
  try {
    const res = await fetch(src, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!res.ok || !IMAGE_TYPES[type]) return src;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_IMAGE) return src;
    const name = `${makeSlug(decodeURIComponent(new URL(src).pathname.split('/').pop() || '').replace(/\.\w+$/, '')).slice(0, 60)}.${IMAGE_TYPES[type]}`;
    const url = await putFile(`uploads/blog-sync/${name}`, buf, type);
    await q('INSERT INTO synced_media(source_url, url) VALUES($1, $2) ON CONFLICT (source_url) DO NOTHING', [src, url]);
    await q('INSERT INTO media(url, name, size, content_type) VALUES($1, $2, $3, $4) ON CONFLICT (url) DO NOTHING', [url, name, buf.length, type]);
    return url;
  } catch {
    return src;
  }
}
