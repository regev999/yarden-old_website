/** Shared by the admin screens: activity log, revisions and clearing the public cache. */
import { revalidateTag } from 'next/cache';
import { q } from '../db';
import { CONTENT_TAG } from '../render';

export function publishChanges() {
  revalidateTag(CONTENT_TAG);
}

export async function logActivity(ctx, action, target = '', link = '') {
  await q('INSERT INTO activity(username, action, target, link) VALUES($1, $2, $3, $4)', [ctx.user.username, action, target, link]);
}

/** Keep the row as it was before a change (pages and posts). */
export async function saveRevision(ctx, kind, row, note) {
  await q('INSERT INTO revisions(path, kind, content, note, username) VALUES($1, $2, $3, $4, $5)',
    [row.path, kind, JSON.stringify(row), note, ctx.user.username]);
}

export const RESERVED_SLUGS = ['admin', 'api', 'assets', 'admin-assets', 'wp-content', 'category', 'tag', 'feed', 'page', 'author', 'wp-admin', '_next'];

/** Turn a title into a URL slug the way WordPress did for Hebrew titles. */
export function makeSlug(title) {
  let s = String(title).trim().toLowerCase().replace(/["'״׳`]/g, '');
  s = s.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  s = [...s].slice(0, 70).join('').replace(/-+$/, '');
  return s || 'post';
}

export async function uniquePath(slug, ignoreId = null) {
  if (RESERVED_SLUGS.includes(slug)) slug += '-post';
  const base = slug;
  for (let n = 1; ; ) {
    const path = `/${slug}/`;
    const rows = await q(`SELECT id FROM posts WHERE path = $1 UNION ALL SELECT -1 FROM pages WHERE path = $1
                          UNION ALL SELECT -2 FROM redirects WHERE source = $1`, [path]);
    if (!rows.some((r) => r.id !== ignoreId)) return path;
    slug = `${base}-${++n}`;
  }
}
