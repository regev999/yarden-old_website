/**
 * Local server that routes like Next.js does on Vercel, for testing without npm:
 *   DATABASE_URL=postgres://postgres@127.0.0.1:54329/yk node --import ./test/register.mjs test/server.mjs
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const TYPES = { '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const XML = ['sitemap_index.xml', 'sitemap.xml', 'post-sitemap.xml', 'page-sitemap.xml', 'category-sitemap.xml', 'post_tag-sitemap.xml', 'feed.xml', 'robots.txt'];
const REDIRECTS = [[/^\/feed\/$/, '/feed.xml'], [/^\/comments\/feed\/$/, '/feed.xml'], [/^\/wp-sitemap\.xml$/, '/sitemap_index.xml']];

async function route(pathname) {
  const seg = pathname.split('/').filter(Boolean);
  if (seg[0] === 'admin') return [await import('../app/admin/[[...path]]/route.js'), { path: seg.length > 1 ? seg.slice(1) : undefined }];
  if (seg[0] === 'api' && seg[1] === 'lead') return [await import('../app/api/lead/route.js'), {}];
  if (seg.length === 1 && XML.includes(seg[0])) return [await import(`../app/${seg[0]}/route.js`), {}];
  return [await import('../app/[[...slug]]/route.js'), { slug: seg.length ? seg : undefined }];
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost:3000');
    const p = url.pathname;
    if (p.startsWith('/__blob/')) {
      try { const b = await readFile(path.join(root, 'test', '.blob', decodeURIComponent(p.slice(8)))); res.writeHead(200); return res.end(b); } catch { res.writeHead(404); return res.end(); }
    }
    try {
      const f = path.join(root, 'public', decodeURIComponent(p));
      if (f.startsWith(path.join(root, 'public')) && path.extname(f)) {
        const body = await readFile(f);
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
        return res.end(body);
      }
    } catch {}
    for (const [re, to] of REDIRECTS) if (re.test(p)) { res.writeHead(308, { Location: to }); return res.end(); }
    // trailingSlash: true
    if (!p.endsWith('/') && !path.extname(p)) { res.writeHead(308, { Location: p + '/' + url.search }); return res.end(); }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = new Request(url, { method: req.method, headers: req.headers, duplex: 'half', body: chunks.length ? Buffer.concat(chunks) : undefined });
    request.nextUrl = url;
    const [mod, params] = await route(p);
    const handler = mod[req.method];
    if (!handler) { res.writeHead(405); return res.end(); }
    const r = await handler(request, { params: Promise.resolve(params) });
    const headers = {};
    r.headers.forEach((v, k) => { if (k !== 'set-cookie') headers[k] = v; });
    const cookies = r.headers.getSetCookie();
    if (cookies.length) headers['set-cookie'] = cookies;
    res.writeHead(r.status, headers);
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    console.error(e);
    res.writeHead(500); res.end(String(e.stack));
  }
}).listen(3000, () => console.log('http://localhost:3000'));
