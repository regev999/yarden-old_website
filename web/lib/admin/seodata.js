/** SEO fields of every public page and post, and the checks shown in the admin. */
import { q } from '../db';
import { TITLE_SUFFIX, fullTitle, plain } from '../html';

export const TITLE_MAX = 60; // for the page-name part of the title
export const DESC_MIN = 70;
export const DESC_MAX = 160;
// Every title ends with the site name; length checks look only at the part before it.
export const SITE_SUFFIX = TITLE_SUFFIX;

const TYPES = { page: 'עמוד', post: 'פוסט', category: 'קטגוריה', tag: 'תגית' };

export function issuesOf(r) {
  const out = [];
  const core = r.title.endsWith(SITE_SUFFIX) ? r.title.slice(0, -SITE_SUFFIX.length) : r.title;
  const tl = [...core].length;
  const dl = [...r.description].length;
  if (!tl) out.push('חסרה כותרת');
  else if (tl > TITLE_MAX) out.push(`שם העמוד בכותרת ארוך (${tl} תווים)`);
  if (!dl) out.push('חסר תיאור');
  else if (dl < DESC_MIN) out.push(`תיאור קצר (${dl} תווים)`);
  else if (dl > DESC_MAX) out.push(`תיאור ארוך (${dl} תווים)`);
  if (!r.h1) out.push('אין כותרת ראשית בעמוד');
  return out;
}

function h1Of(main) {
  const m = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(main || '');
  return m ? plain(m[1]) : '';
}

export async function seoRows() {
  const pages = await q(`SELECT path, kind, title, seo_title, description, noindex, main, updated_at FROM pages WHERE kind IN ('page', 'category', 'tag')`);
  const posts = await q(`SELECT id, path, title, seo_title, description, noindex FROM posts WHERE status = 'published'`);
  const rows = [
    ...pages.map((p) => ({ path: p.path, type: TYPES[p.kind], kind: 'page', title: fullTitle(p.title, p.seo_title, p.path), description: p.description, h1: h1Of(p.main), noindex: p.noindex })),
    ...posts.map((p) => ({ path: p.path, type: TYPES.post, kind: 'post', id: p.id, title: fullTitle(p.title, p.seo_title, p.path), description: p.description, h1: p.title, noindex: p.noindex })),
  ];
  for (const r of rows) r.issues = issuesOf(r);
  return rows;
}
