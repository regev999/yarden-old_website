/**
 * Runs before every build on Vercel (see package.json "build").
 * Creates the tables and, on the very first run, loads the migrated content.
 * Never overwrites content that already exists, so edits made in the admin
 * survive every deploy.
 */
import { connect } from '../lib/sqlclient.mjs';
import { readFileSync } from 'node:fs';
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

// 2. Seed each table once, in one statement per table.
if (await empty('pages')) {
  const pages = read('pages.json').map((p) => ({ ...p, ld: p.ld ?? null }));
  await sql.query(
    `INSERT INTO pages (path, kind, title, seo_title, description, og_type, og_image, canonical, noindex, ld, main)
     SELECT path, kind, title, seo_title, description, og_type, og_image, canonical, noindex, ld, main
     FROM jsonb_to_recordset($1::jsonb) AS x(path text, kind text, title text, seo_title text, description text,
       og_type text, og_image text, canonical text, noindex boolean, ld jsonb, main text)
     ON CONFLICT (path) DO NOTHING`, [JSON.stringify(pages)]);
  console.log(`[migrate] pages: ${pages.length}`);
}

if (await empty('posts')) {
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

if (await empty('terms')) {
  const terms = [
    ...read('categories.json').map((c) => ({ kind: 'category', slug: c.slug, name: c.name })),
    ...read('tags.json').map((t) => ({ kind: 'tag', slug: t.slug, name: t.name })),
  ];
  await sql.query(
    `INSERT INTO terms (kind, slug, name) SELECT kind, slug, name FROM jsonb_to_recordset($1::jsonb) AS x(kind text, slug text, name text)
     ON CONFLICT DO NOTHING`, [JSON.stringify(terms)]);
}

if (await empty('testimonials')) {
  const t = read('testimonials.json');
  await sql.query(
    `INSERT INTO testimonials (name, role, body, show_on_home, position)
     SELECT name, role, body, show_on_home, position FROM jsonb_to_recordset($1::jsonb)
     AS x(name text, role text, body text, show_on_home boolean, position int)`, [JSON.stringify(t)]);
}

if (await empty('redirects')) {
  const r = read('redirects.json').map((x) => ({ source: x.from, target: x.to, note: x.note }));
  await sql.query(
    `INSERT INTO redirects (source, target, note) SELECT source, target, note FROM jsonb_to_recordset($1::jsonb)
     AS x(source text, target text, note text) ON CONFLICT (source) DO NOTHING`, [JSON.stringify(r)]);
  console.log(`[migrate] redirects: ${r.length}`);
}

console.log('[migrate] done');
await sql.end?.();
