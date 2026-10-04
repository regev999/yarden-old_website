/**
 * Runs before every build and on every start (see package.json "build" and "start").
 * Creates the tables and, on the very first run, loads the migrated content.
 * Never overwrites content that already exists, so edits made in the admin
 * survive every deploy.
 */
import { connect } from '../lib/sqlclient.mjs';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) {
  console.warn('[migrate] DATABASE_URL is not set: skipping. Connect a Postgres database and redeploy.');
  process.exit(0);
}
const sql = connect(url);
const read = (f) => JSON.parse(readFileSync(path.join(root, 'content', f), 'utf8'));

// 1. Schema (statements separated by ";" at line ends)
const schema = readFileSync(path.join(root, 'db', 'schema.sql'), 'utf8')
  .split(/;\s*$/m).map((s) => s.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean);
for (const stmt of schema) await sql.query(stmt);

async function empty(table) {
  const rows = await sql.query(`SELECT 1 FROM ${table} LIMIT 1`);
  return rows.length === 0;
}
// Each table is seeded once in its life: a table the admin has emptied on
// purpose (all testimonials removed, say) stays empty on the next start.
async function seedOnce(table) {
  const key = `seeded:${table}`;
  if ((await sql.query('SELECT 1 FROM settings WHERE key = $1', [key])).length) return false;
  const fresh = await empty(table);
  await sql.query('INSERT INTO settings(key, value) VALUES($1, $2) ON CONFLICT (key) DO NOTHING', [key, new Date().toISOString()]);
  return fresh;
}


// 2. Seed each table once, in one statement per table.
if (await seedOnce('pages')) {
  const pages = read('pages.json').map((p) => ({ ...p, ld: p.ld ?? null }));
  await sql.query(
    `INSERT INTO pages (path, kind, title, seo_title, description, og_type, og_image, canonical, noindex, ld, main)
     SELECT path, kind, title, seo_title, description, og_type, og_image, canonical, noindex, ld, main
     FROM jsonb_to_recordset($1::jsonb) AS x(path text, kind text, title text, seo_title text, description text,
       og_type text, og_image text, canonical text, noindex boolean, ld jsonb, main text)
     ON CONFLICT (path) DO NOTHING`, [JSON.stringify(pages)]);
  console.log(`[migrate] pages: ${pages.length}`);
}

if (await seedOnce('posts')) {
  const posts = read('posts.json').map((p) => ({
    path: p.path, title: p.title, body: p.body, excerpt: p.excerpt || '', seo_title: p.seo_title || '',
    description: p.description || '', og_image: p.og_image || '', categories: p.categories, tags: p.tags,
    is_video: !!p.is_video, duplicate_of: p.duplicate_of, wp_id: p.wp_id, date: p.date, modified: p.modified,
  }));
  await sql.query(
    `INSERT INTO posts (path, title, body, excerpt, seo_title, description, og_image, categories, tags, is_video, duplicate_of, wp_id, date, modified)
     SELECT path, title, body, excerpt, seo_title, description, og_image, categories, tags, is_video, duplicate_of, wp_id, date, modified
     FROM jsonb_to_recordset($1::jsonb) AS x(path text, title text, body text, excerpt text, seo_title text, description text,
       og_image text, categories jsonb, tags jsonb, is_video boolean, duplicate_of text, wp_id int, date timestamp, modified timestamp)
     ON CONFLICT (path) DO NOTHING`, [JSON.stringify(posts)]);
  console.log(`[migrate] posts: ${posts.length}`);
}

if (await seedOnce('terms')) {
  const terms = [
    ...read('categories.json').map((c) => ({ kind: 'category', slug: c.slug, name: c.name })),
    ...read('tags.json').map((t) => ({ kind: 'tag', slug: t.slug, name: t.name })),
  ];
  await sql.query(
    `INSERT INTO terms (kind, slug, name) SELECT kind, slug, name FROM jsonb_to_recordset($1::jsonb) AS x(kind text, slug text, name text)
     ON CONFLICT DO NOTHING`, [JSON.stringify(terms)]);
}

if (await seedOnce('testimonials')) {
  const t = read('testimonials.json');
  await sql.query(
    `INSERT INTO testimonials (name, role, body, show_on_home, position)
     SELECT name, role, body, show_on_home, position FROM jsonb_to_recordset($1::jsonb)
     AS x(name text, role text, body text, show_on_home boolean, position int)`, [JSON.stringify(t)]);
}

if (await seedOnce('redirects')) {
  const r = read('redirects.json').map((x) => ({ source: x.from, target: x.to, note: x.note }));
  await sql.query(
    `INSERT INTO redirects (source, target, note) SELECT source, target, note FROM jsonb_to_recordset($1::jsonb)
     AS x(source text, target text, note text) ON CONFLICT (source) DO NOTHING`, [JSON.stringify(r)]);
  console.log(`[migrate] redirects: ${r.length}`);
}

// 3. Content updates (content/updates/): each one is applied once.
//    Each update is content/updates/<id>.json (path, file, contact, description)
//    plus the page body in <id>.body.html. An update can also only set a
//    page's "canonical", mark an old post as a "duplicate_of" another page,
//    add "products" to the shop or take some off sale ("products_off").
//    The page as it was is saved to revisions, so it can be restored in the admin.
const upDir = path.join(root, 'content', 'updates');
const only = process.env.ONLY_UPDATE; // apply just this one (local preview)
const updates = readdirSync(upDir).filter((f) => f.endsWith('.json')).sort()
  .map((f) => JSON.parse(readFileSync(path.join(upDir, f), 'utf8')))
  .filter((u) => !only || u.id === only);
const contact = readFileSync(path.join(root, 'content', 'contact.html'), 'utf8');
for (const u of updates) {
  const key = `content_update:${u.id}`;
  // FORCE_CONTENT_UPDATES=1 re-applies them (for working on an update locally).
  if (!process.env.FORCE_CONTENT_UPDATES && !only && (await sql.query('SELECT 1 FROM settings WHERE key = $1', [key])).length) continue;
  if (u.products) {
    // Products for the shop, added once (never overwriting one edited in the admin)
    for (const pr of u.products) {
      // A product still exactly as an earlier update made it can be corrected
      if (pr.was_title) {
        await sql.query('UPDATE products SET title = $2, description = $3, updated_at = now() WHERE slug = $1 AND title = $4',
          [pr.slug, pr.title, pr.description || '', pr.was_title]);
      }
      await sql.query(`INSERT INTO products(slug, title, description, price_agorot, max_payments, page_path, position, active)
                       VALUES($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (slug) DO NOTHING`,
        [pr.slug, pr.title, pr.description || '', Math.round(pr.price * 100), pr.max_payments || 1, pr.page_path || '', pr.position || 0, !!pr.active]);
    }
  } else if (u.products_off) {
    // Products taken off sale: their buttons go back to being links to the contact form
    await sql.query('UPDATE products SET active = false, updated_at = now() WHERE slug = ANY($1::text[]) AND active', [u.products_off]);
  } else if (u.duplicate_of) {
    // An old post that repeats another page: its canonical and the sitemap point to the original.
    const done = await sql.query('UPDATE posts SET duplicate_of = $2 WHERE path = $1 RETURNING id', [u.path, u.duplicate_of]);
    if (!done.length) { console.warn(`[migrate] update ${u.id}: no post at ${u.path}`); continue; }
  } else {
    const [page] = await sql.query('SELECT * FROM pages WHERE path = $1', [u.path]);
    if (!page) { console.warn(`[migrate] update ${u.id}: no page at ${u.path}`); continue; }
    if (u.replace || u.remove) {
      // Exact replacements inside the page as it is now, so edits made in the admin stay
      let main = page.main;
      for (const [from, to] of u.replace || []) {
        if (main.includes(to)) continue;
        if (!main.includes(from)) { console.warn(`[migrate] update ${u.id}: text not found on ${u.path}, skipped`); continue; }
        main = main.split(from).join(to);
      }
      // Removals: an exact text, or [from, through] to cut from the first "from" up to and
      // including the next "through" (whatever was edited in between in the admin goes too)
      for (const r of u.remove || []) {
        const [from, through] = Array.isArray(r) ? r : [r, ''];
        const start = main.indexOf(from);
        const end = start < 0 ? -1 : main.indexOf(through, start + from.length);
        if (end < 0) { console.warn(`[migrate] update ${u.id}: text not found on ${u.path}, skipped`); continue; }
        main = main.slice(0, start) + main.slice(end + through.length);
      }
      if (main !== page.main) {
        await sql.query("INSERT INTO revisions(path, kind, content, note, username) VALUES($1, 'page', $2, $3, 'system')", [u.path, JSON.stringify(page), 'לפני עדכון']);
        await sql.query('UPDATE pages SET main = $2, updated_at = now() WHERE path = $1', [u.path, main]);
      }
    }
    if (u.file) {
      const main = readFileSync(path.join(upDir, u.file), 'utf8') + (u.contact ? '\n' + contact : '');
      await sql.query("INSERT INTO revisions(path, kind, content, note, username) VALUES($1, 'page', $2, $3, 'system')",
        [u.path, JSON.stringify(page), 'לפני עדכון העיצוב']);
      await sql.query('UPDATE pages SET main = $2, description = COALESCE($3, description), updated_at = now() WHERE path = $1',
        [u.path, main, u.description ?? null]);
    }
    // "canonical": the page this one repeats (it then leaves the sitemap)
    if ('canonical' in u) await sql.query('UPDATE pages SET canonical = $2 WHERE path = $1', [u.path, u.canonical || null]);
  }
  await sql.query('INSERT INTO settings(key, value) VALUES($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, new Date().toISOString()]);
  console.log(`[migrate] update ${u.id}: ${u.path}`);
}

// Pages are cached by Next (unstable_cache) and hold the asset versions of the
// build that made them; start every run with a fresh cache.
rmSync(path.join(root, '.next', 'cache', 'fetch-cache'), { recursive: true, force: true });

console.log('[migrate] done');
await sql.end?.();
