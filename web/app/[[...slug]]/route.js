/**
 * Every public page. Pages are plain HTML (the same markup the static build
 * produced), so there is no client-side framework on the public site.
 */
import { resolvePath, notFoundDocument } from '@/lib/render';
import { countHit, encTarget, findRedirect, logNotFound, normalizeSource } from '@/lib/redirects';

export const dynamic = 'force-dynamic';

// A shared cache in front (a CDN, if there is one) keeps a page up to a minute, so an admin save shows within a minute.
const CACHED = 'public, max-age=0, s-maxage=60, stale-while-revalidate=86400';

function pathOf(slug) {
  if (!slug?.length) return '/';
  const last = slug[slug.length - 1];
  return normalizeSource('/' + slug.join('/') + (last.includes('.') ? '' : '/'));
}

function redirect(target, id) {
  if (id) countHit(id);
  return new Response(null, { status: 301, headers: { Location: encTarget(target), 'Cache-Control': 'public, max-age=3600, s-maxage=3600' } });
}

export async function GET(request, { params }) {
  const { slug } = await params;
  const path = pathOf(slug);
  const query = request.nextUrl.search.slice(1);

  // WordPress links by number: /?p=123, /?page_id=45, /?attachment_id=67
  if (query && /(^|&)(p|page_id|attachment_id)=\d+/.test(query)) {
    const r = await findRedirect(path, query);
    if (r) return redirect(r.target, r.id);
  }

  const res = await resolvePath(path);
  if (res.type === 'redirect') return redirect(res.target, res.id);
  if (res.type === 'page') {
    return new Response(res.html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': CACHED } });
  }

  await logNotFound(path, request.headers.get('referer') || '').catch(() => {});
  return new Response(await notFoundDocument(), {
    status: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export const HEAD = GET;
