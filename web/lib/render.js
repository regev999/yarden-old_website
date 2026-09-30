/**
 * Resolves a public address to a response body: page, post, redirect or 404.
 * Results are cached (tag "content") and cleared whenever the admin saves.
 */
import { unstable_cache } from 'next/cache';
import { getSetting } from './db';
import { getPage, getPost, pageMain, postLd, postMain } from './content';
import { findRedirect, smartRedirect } from './redirects';
import { pageDocument } from './shell';
import { ogImageFor } from './ogimage';

export const CONTENT_TAG = 'content';

async function gaId() {
  return (await getSetting('ga_id')) || process.env.GA_ID || '';
}

async function resolve(path, { drafts = false } = {}) {
  const redirect = await findRedirect(path);
  if (redirect) return { type: 'redirect', target: redirect.target, id: redirect.id };

  const page = path === '/404/' ? null : await getPage(path);
  if (page) {
    return {
      type: 'page',
      html: pageDocument({
        path, title: page.title, seoTitle: page.seo_title, description: page.description, canonical: page.canonical,
        ogType: page.og_type, ogImage: ogImageFor(path, page.og_image), noindex: page.noindex, ld: page.ld, main: await pageMain(page), gaId: await gaId(),
      }),
    };
  }

  const post = await getPost(path, { drafts });
  if (post) {
    return {
      type: 'page',
      html: pageDocument({
        path, title: post.title, seoTitle: post.seo_title, description: post.description,
        ogType: 'article', ogImage: ogImageFor(path, post.og_image), noindex: post.noindex || post.status !== 'published', ld: postLd(post),
        main: await postMain(post), gaId: await gaId(),
      }),
    };
  }

  const smart = await smartRedirect(path);
  if (smart && smart !== path) return { type: 'redirect', target: smart, id: null };
  return { type: 'none' };
}

export const resolvePath = (path) => process.env.NO_CONTENT_CACHE ? resolve(path) : unstable_cache(() => resolve(path), ['path', path], { tags: [CONTENT_TAG], revalidate: 86400 })();

/** Preview for the admin: drafts included, never cached. */
export const resolvePreview = (path) => resolve(path, { drafts: true });

export const notFoundDocument = unstable_cache(async () => {
  const page = await getPage('/404/');
  return pageDocument({
    path: '/404/', title: page?.title || 'הדף לא נמצא', seoTitle: page?.seo_title, description: page?.description,
    noindex: true, main: page ? await pageMain(page) : '<section class="block"><div class="wrap"><h1>הדף לא נמצא</h1><p><a href="/">לדף הבית</a></p></div></section>',
    gaId: await gaId(),
  });
}, ['notfound-doc'], { tags: [CONTENT_TAG], revalidate: 86400 });
