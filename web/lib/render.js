/**
 * Resolves a public address to a response body: page, post, redirect or 404.
 * Results are cached (tag "content") and cleared whenever the admin saves.
 */
import { unstable_cache } from 'next/cache';
import { getSetting, one } from './db';
import { getPage, getPost, pageMain, postLd, postMain } from './content';
import { findRedirect, smartRedirect } from './redirects';
import { pageDocument } from './shell';
import { ogImageFor } from './ogimage';

export const CONTENT_TAG = 'content';

async function gaId() {
  return (await getSetting('ga_id')) || process.env.GA_ID || '';
}

/** Category and tag pages came with "תגית: X – ירדן כרם" as their description; say what's on them instead. */
function termDescription(page) {
  const m = /^(?:תגית|קטגוריה): (.+?) – ירדן כרם$/.exec(page.description || '');
  if (!m) return page.description;
  return `${m[1]}: מאמרים, סרטונים ופוסטים באתר של ירדן כרם, מטפלת ומרצה לגישת ההתמקדות, Somatic Experiencing והקומי בהרצליה.`;
}

async function resolve(path, { drafts = false } = {}) {
  const redirect = await findRedirect(path);
  if (redirect) return { type: 'redirect', target: redirect.target, id: redirect.id };

  const page = path === '/404/' ? null : await getPage(path);
  if (page) {
    return {
      type: 'page',
      html: pageDocument({
        path, title: page.title, seoTitle: page.seo_title, description: termDescription(page), canonical: page.canonical,
        ogType: page.og_type, ogImage: ogImageFor(path, page.og_image), noindex: page.noindex, main: await pageMain(page), gaId: await gaId(),
      }),
    };
  }

  const post = await getPost(path, { drafts });
  if (post) {
    return {
      type: 'page',
      html: pageDocument({
        path, title: post.title, seoTitle: post.seo_title, description: post.description,
        // an old copy of another page sends search engines to the original
        canonical: post.duplicate_of || null,
        ogType: 'article', ogImage: ogImageFor(path, post.og_image), noindex: post.noindex || post.status !== 'published',
        ld: post.duplicate_of ? null : { ...postLd(post), image: ogImageFor(path, post.og_image) },
        main: await postMain(post), gaId: await gaId(),
      }),
    };
  }

  const smart = await smartRedirect(path);
  if (smart && smart !== path) return { type: 'redirect', target: smart, id: null };
  return { type: 'none' };
}

const cachedResolve = (path) => unstable_cache(() => resolve(path), ['path', path], { tags: [CONTENT_TAG], revalidate: 86400 })();

/** A page or post stored at this exact address (a cheap indexed lookup). */
const stored = async (path) => !!(await one('SELECT 1 FROM pages WHERE path = $1 UNION ALL SELECT 1 FROM posts WHERE path = $1 LIMIT 1', [path]));

/**
 * Pages and posts are cached; any other address (redirects, 404s, random
 * requests) is looked up each time, so unknown addresses never fill the cache.
 */
export const resolvePath = async (path) => (process.env.NO_CONTENT_CACHE || !(await stored(path)) ? resolve(path) : cachedResolve(path));

/** Preview for the admin: drafts included, never cached. */
export const resolvePreview = (path) => resolve(path, { drafts: true });

async function notFound() {
  const page = await getPage('/404/');
  return pageDocument({
    path: '/404/', title: page?.title || 'הדף לא נמצא', seoTitle: page?.seo_title, description: page?.description,
    noindex: true, main: page ? await pageMain(page) : '<section class="block"><div class="wrap"><h1>הדף לא נמצא</h1><p><a href="/">לדף הבית</a></p></div></section>',
    gaId: await gaId(),
  });
}
const cachedNotFound = unstable_cache(notFound, ['notfound-doc'], { tags: [CONTENT_TAG], revalidate: 86400 });
export const notFoundDocument = () => process.env.NO_CONTENT_CACHE ? notFound() : cachedNotFound();
