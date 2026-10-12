/** Admin page layout (right-hand sidebar), small view helpers and response helpers. */
import { one } from '../db';
import { esc } from '../html';

export { esc };

const ICONS = {
  dashboard: '<path d="M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z"/>',
  leads: '<path d="M4 5h16v11H7l-3 3V5Zm2 2v7.2l.8-.8H18V7H6Zm2 2h8v1.5H8V9Zm0 2.5h5V13H8v-1.5Z"/>',
  pages: '<path d="M6 3h8l4 4v14H6V3Zm2 2v14h8V8h-3V5H8Zm1.5 6h5v1.5h-5V11Zm0 3h5v1.5h-5V14Z"/>',
  posts: '<path d="M4 4h12v2H4V4Zm0 4h16v2H4V8Zm0 4h16v2H4v-2Zm0 4h10v2H4v-2Zm13 0 3-3 1.5 1.5-3 3H17V16Z"/>',
  testimonials: '<path d="M6 7h5v5.5c0 2.5-1.6 4.3-4 4.5v-2c1.1-.3 1.8-1.1 2-2.5H6V7Zm7 0h5v5.5c0 2.5-1.6 4.3-4 4.5v-2c1.1-.3 1.8-1.1 2-2.5h-3V7Z"/>',
  media: '<path d="M4 5h16v14H4V5Zm2 2v8.6l3.5-3.6 2.5 2.5 3-3.5 3 3.6V7H6Zm3 3.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z"/>',
  seo: '<path d="M10 4a6 6 0 0 1 4.8 9.6l4.8 4.8-1.4 1.4-4.8-4.8A6 6 0 1 1 10 4Zm0 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/>',
  redirects: '<path d="M4 7h11.2l-2.6-2.6L14 3l5 5-5 5-1.4-1.4L15.2 9H4V7Zm16 10H8.8l2.6 2.6L10 21l-5-5 5-5 1.4 1.4L8.8 15H20v2Z"/>',
  sales: '<path d="M5 3h14v18l-2.3-1.5L14.3 21 12 19.5 9.7 21l-2.4-1.5L5 21V3Zm2 2v12.3l.3-.2 2.4 1.5 2.3-1.5 2.3 1.5 2.4-1.5.3.2V5H7Zm2 3h6v1.6H9V8Zm0 3h6v1.6H9V11Z"/>',
  products: '<path d="M3 11.6V4h7.6l10 10-7.6 7.6-10-10Zm2-5.6v4.8l8 8 4.8-4.8-8-8H5Zm2.5 3.6a1.6 1.6 0 1 1 0-3.2 1.6 1.6 0 0 1 0 3.2Z"/>',
  'pay-links': '<path d="M10.6 13.4a1 1 0 0 1 0-1.4l3.5-3.5a1 1 0 1 1 1.4 1.4l-3.5 3.5a1 1 0 0 1-1.4 0ZM8 18a4 4 0 0 1-2.8-6.8l2.1-2.1 1.4 1.4-2.1 2.1a2 2 0 0 0 2.8 2.8l2.1-2.1 1.4 1.4-2.1 2.1A4 4 0 0 1 8 18Zm8.7-3.1-1.4-1.4 2.1-2.1a2 2 0 0 0-2.8-2.8l-2.1 2.1-1.4-1.4 2.1-2.1a4 4 0 0 1 5.6 5.6l-2.1 2.1Z"/>',
  connections: '<path d="M9 2h2v5h2V2h2v5h1a1 1 0 0 1 1 1v4a5 5 0 0 1-4 4.9V22h-2v-5.1A5 5 0 0 1 7 12V8a1 1 0 0 1 1-1h1V2Zm0 7v3a3 3 0 0 0 6 0V9H9Z"/>',
  settings: '<path d="M11 3h2l.5 2.4 1.6.7 2-1.4 1.4 1.4-1.4 2 .7 1.6L20 11v2l-2.4.5-.7 1.6 1.4 2-1.4 1.4-2-1.4-1.6.7L13 21h-2l-.5-2.4-1.6-.7-2 1.4-1.4-1.4 1.4-2-.7-1.6L4 13v-2l2.4-.5.7-1.6-1.4-2 1.4-1.4 2 1.4 1.6-.7L11 3Zm1 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"/>',
};

const HEAD = (title) => `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<title>${esc(title)} · ניהול האתר</title><link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/admin-assets/admin.css"></head>`;

export function csrfField(ctx) {
  return `<input type="hidden" name="csrf" value="${esc(ctx.csrf)}">`;
}

function flashHtml(ctx) {
  return ctx.flash ? `<p class="notice notice--${ctx.flash.type === 'error' ? 'error' : 'ok'}" role="status">${esc(ctx.flash.text)}</p>` : '';
}

/** A full admin page with the sidebar. */
export async function adminPage(ctx, { title, active, body, actions = '', scripts = [] }) {
  const { n: newLeads } = await one(`SELECT count(*)::int AS n FROM leads WHERE status = 'new'`);
  // Sales in the last day, as a badge (0 when the shop tables aren't there yet)
  const newSales = (await one(`SELECT count(*)::int AS n FROM orders WHERE status = 'paid' AND paid_at > now() - interval '1 day'`).catch(() => null))?.n || 0;
  const groups = [
    ['', [['dashboard', '/admin/', 'סקירה'], ['leads', '/admin/leads/', 'לידים', newLeads]]],
    ['תוכן', [['pages', '/admin/pages/', 'עמודים'], ['posts', '/admin/posts/', 'מאמרים ובלוג'],
      ['testimonials', '/admin/testimonials/', 'המלצות'], ['media', '/admin/media/', 'תמונות וקבצים']]],
    ['מכירות', [['sales', '/admin/sales/', 'מכירות', newSales], ['products', '/admin/products/', 'מוצרים'], ['pay-links', '/admin/pay-links/', 'קישורי תשלום']]],
    ['אתר', [['seo', '/admin/seo/', 'קידום (SEO)'], ['redirects', '/admin/redirects/', 'הפניות 301 ו־404'], ['connections', '/admin/connections/', 'חיבורים'], ['settings', '/admin/settings/', 'הגדרות']]],
  ];
  const nav = groups.map(([label, items]) => (label ? `<p class="side__group">${esc(label)}</p>` : '') + '<ul>'
    + items.map(([key, href, text, badge]) => `<li><a href="${href}"${key === active ? ' aria-current="page"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[key]}</svg><span>${esc(text)}</span>${badge ? `<span class="side__badge">${badge}</span>` : ''}</a></li>`).join('')
    + '</ul>').join('');
  return `${HEAD(title)}<body class="app"><div class="shell"><aside class="side" id="side" aria-label="תפריט ניהול">
<a class="side__brand" href="/admin/"><span class="side__logo" aria-hidden="true"></span><span>ירדן כרם<small>ניהול האתר</small></span></a>
<a class="side__new" href="/admin/post-edit/">מאמר חדש</a><nav>${nav}</nav>
<div class="side__foot"><a href="/" target="_blank" rel="noopener">צפייה באתר</a><div class="side__user"><span>${esc(ctx.user.username)}</span>
<form method="post" action="/admin/logout/">${csrfField(ctx)}<button type="submit" class="linklike">יציאה</button></form></div></div>
</aside><div class="side-scrim" data-close-side></div>
<div class="content"><header class="topbar"><button class="menu-toggle" type="button" aria-controls="side" aria-expanded="false" data-toggle-side>
<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v2H4V6Zm0 5h16v2H4v-2Zm0 5h16v2H4v-2Z"/></svg><span class="sr-only">תפריט</span></button>
<h1>${esc(title)}</h1><div class="topbar__actions">${actions}</div></header><main class="main">${flashHtml(ctx)}
${body}
</main></div></div><script src="/admin-assets/admin.js"></script><script src="/admin-assets/compress.js"></script>${scripts.map((s) => `<script src="/admin-assets/${s}.js"></script>`).join('')}</body></html>`;
}

/** Small centred card for login / reset / setup. */
export function authPage(ctx, title, body) {
  return `${HEAD(title)}<body class="auth"><main class="auth-card"><p class="auth-card__brand">ירדן כרם · ניהול האתר</p><h1>${esc(title)}</h1>${flashHtml(ctx)}${body}</main></body></html>`;
}

/* ------------------------------------------------------------ formatting */

const tz = { timeZone: 'Asia/Jerusalem' };
export function heDate(d, withTime = true) {
  if (!d) return '';
  const t = d instanceof Date ? d : new Date(String(d).replace(' ', 'T'));
  const date = t.toLocaleDateString('he-IL', { ...tz, day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.');
  return withTime ? `${date} ${t.toLocaleTimeString('he-IL', { ...tz, hour: '2-digit', minute: '2-digit', hour12: false })}` : date;
}

/** Post dates (Israel wall-clock time stored without a time zone). */
export function wallDate(d) {
  const t = d instanceof Date ? d : new Date(String(d).replace(' ', 'T') + 'Z');
  const p = (n) => String(n).padStart(2, '0');
  return `${p(t.getUTCDate())}.${p(t.getUTCMonth() + 1)}.${t.getUTCFullYear()}`;
}

export function humanSize(b) {
  if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
  return Math.max(1, Math.round(b / 1024)) + ' KB';
}

export function qs(params) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== '' && v !== null && v !== undefined) u.set(k, v);
  const s = u.toString();
  return s ? '?' + s : '';
}

export function pager(page, pages, params) {
  if (pages < 2) return '';
  let s = '<nav class="pager">';
  for (let i = 1; i <= pages; i++) s += `<a href="${esc(qs({ ...params, p: i }))}"${i === page ? ' aria-current="page"' : ''}>${i}</a>`;
  return s + '</nav>';
}

/* ------------------------------------------------------------- responses */

const CSP = "default-src 'self'; img-src 'self' data: blob: https://i.ytimg.com https://*.public.blob.vercel-storage.com; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; connect-src 'self'; frame-src 'self'; form-action 'self'; frame-ancestors 'self'; base-uri 'none'";

export const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Frame-Options': 'SAMEORIGIN',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': CSP,
};

export function html(body, status = 200, headers = {}) {
  return new Response(body, { status, headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8', ...headers } });
}

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8' } });
}

/** 303 redirect, optionally with a one-time message shown on the next page. */
export function redirect(location, flash = null, type = 'ok', extraCookies = []) {
  const h = new Headers({ ...SECURITY_HEADERS, Location: location });
  if (flash) h.append('Set-Cookie', `yk_flash=${encodeURIComponent(JSON.stringify({ text: flash, type }))}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=60`);
  for (const c of extraCookies) h.append('Set-Cookie', c);
  return new Response(null, { status: 303, headers: h });
}
