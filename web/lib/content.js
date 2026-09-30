/**
 * Everything the public site reads from the database, and the logic that
 * turns a stored page or post into the final <main> HTML.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { q, one } from './db';
import { artForPath, artForPost, withArt } from './art';
import {
  ESSAY_CATEGORIES, blogHtml, entriesHtml, fillRegions, optimizeImages, plain, postLd, postMainHtml,
  testimonialsHtml, tidyLegacy, voicesHtml,
} from './html';
import { titleVideos } from './videos';
import { withBuySection } from './shop';

const POST_COLS = 'id, path, title, body, format, excerpt, seo_title, description, og_image, noindex, categories, tags, status, is_video, duplicate_of, date, modified';

let contactCache;
/** The contact section that closes most pages (same markup as the migrated pages). */
export function contactHtml() {
  contactCache ??= readFileSync(path.join(process.cwd(), 'content', 'contact.html'), 'utf8');
  return contactCache;
}

export async function getPage(p) {
  return one('SELECT * FROM pages WHERE path = $1', [p]);
}

export async function getPost(p, { drafts = false } = {}) {
  return one(`SELECT ${POST_COLS} FROM posts WHERE path = $1${drafts ? '' : " AND status = 'published'"}`, [p]);
}

/** Published posts that appear in lists (copies of another post are left out). */
export async function listedPosts() {
  return q(`SELECT id, path, title, excerpt, body, categories, tags, is_video, date, modified FROM posts
            WHERE status = 'published' AND duplicate_of IS NULL ORDER BY date DESC`);
}

export async function terms(kind) {
  return q('SELECT slug, name FROM terms WHERE kind = $1 ORDER BY name', [kind]);
}

export async function testimonials({ homeOnly = false } = {}) {
  return q(`SELECT id, name, role, body FROM testimonials WHERE published${homeOnly ? ' AND show_on_home' : ''} ORDER BY position, id`);
}

/** Fill the live lists inside a stored page. Only queries what the page uses. */
async function regionsFor(page) {
  const used = new Set([...page.main.matchAll(/<!--yk:(\w+)-->/g)].map((m) => m[1]));
  if (!used.size) return {};
  const regions = {};
  const posts = used.has('blog') || used.has('count') || used.has('list') || used.has('essays') ? await listedPosts() : [];
  if (used.has('blog')) regions.blog = blogHtml(posts, await terms('category'));
  if (used.has('count')) regions.count = String(posts.length);
  if (used.has('list')) {
    const m = /^\/(category|tag)\/([^/]+)\/$/.exec(page.path);
    const field = m?.[1] === 'tag' ? 'tags' : 'categories';
    const inTerm = m ? posts.filter((p) => p[field].includes(m[2])) : [];
    regions.list = entriesHtml(inTerm) || '<p>אין כאן עדיין פרסומים.</p>';
    regions._count = inTerm.length;
  }
  if (used.has('essays')) {
    const essays = posts.filter((p) => p.categories.some((c) => ESSAY_CATEGORIES.includes(c)) && plain(p.body).length > 1500).slice(0, 5);
    regions.essays = entriesHtml(essays, true);
  }
  if (used.has('testimonials')) regions.testimonials = testimonialsHtml(await testimonials());
  if (used.has('voices')) {
    const v = await testimonials({ homeOnly: true });
    if (v.length) regions.voices = voicesHtml(v);
  }
  return regions;
}

/** Category and tag pages: a way back to the blog and how many publications there are. */
function termHero(html, count) {
  const sub = count ? `<p class="page-hero__sub">${count === 1 ? 'פרסום אחד' : `${count} פרסומים`}</p>` : '';
  return html
    .replace(/<p class="crumb">(?:קטגוריה|תגית)<\/p>/, '<p class="crumb"><a href="/בלוג/">בלוג</a></p>')
    .replace(/(<header class="page-hero"[^>]*>[\s\S]*?<\/h1>)/, `$1${sub}`);
}

export async function pageMain(page) {
  const regions = await regionsFor(page);
  // One contact block for the whole site, kept in content/contact.html
  let html = tidyLegacy(fillRegions(page.main, regions))
    .replace(/<section class="section section--ink block--contact" id="contact">[\s\S]*?<\/section>/, () => contactHtml().trim());
  if (page.kind === 'category' || page.kind === 'tag') html = termHero(html, regions._count);
  html = await withBuySection(html, page.path);
  return withArt(titleVideos(optimizeImages(html)), artForPath(page.path));
}

export async function postMain(post) {
  const [categories, tags, posts] = await Promise.all([terms('category'), terms('tag'), listedPosts()]);
  const skip = new Set([post.path, post.duplicate_of]);
  const related = post.categories.length
    ? posts.filter((x) => !skip.has(x.path) && x.categories.some((c) => post.categories.includes(c))).slice(0, 3)
    : [];
  return withArt(titleVideos(optimizeImages(postMainHtml(post, { categories, tags, related, contact: contactHtml() }))), artForPost(post));
}

export { postLd };
