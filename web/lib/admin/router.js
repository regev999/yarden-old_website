/**
 * The admin area: one entry point that checks the session and CSRF token,
 * then hands the request to the screen for that address.
 */
import { currentSession, cookieValue, userCount } from './auth';
import { html, json, redirect, SECURITY_HEADERS } from './ui';
import { sameOrigin } from '../security';
import * as authRoutes from './routes/auth';
import * as dashboard from './routes/dashboard';
import * as leads from './routes/leads';
import * as settings from './routes/settings';
import * as posts from './routes/posts';
import * as pages from './routes/pages';
import * as testimonials from './routes/testimonials';
import * as media from './routes/media';
import * as seo from './routes/seo';
import * as redirectsRoutes from './routes/redirects';

const PUBLIC = {
  'login': authRoutes.login, 'forgot': authRoutes.forgot, 'reset': authRoutes.reset, 'setup': authRoutes.setup,
};
const PRIVATE = {
  '': dashboard.home, 'logout': authRoutes.logout,
  'leads': leads.list, 'lead': leads.oneLead, 'export': leads.exportCsv,
  'settings': settings.page,
  'posts': posts.list, 'post-edit': posts.edit, 'preview': posts.preview,
  'pages': pages.list, 'page-edit': pages.edit, 'page-save': pages.save, 'revisions': pages.revisions,
  'testimonials': testimonials.page,
  'media': media.page,
  'seo': seo.page, 'links': seo.links,
  'redirects': redirectsRoutes.page,
};

async function readBody(request) {
  const type = request.headers.get('content-type') || '';
  if (type.includes('application/json')) {
    try { return { json: await request.json() }; } catch { return { json: null }; }
  }
  try {
    const fd = await request.formData();
    return { form: fd };
  } catch {
    return { form: new FormData() };
  }
}

export async function handle(request, segments) {
  const url = new URL(request.url);
  const name = (segments || []).join('/');
  const method = request.method === 'HEAD' ? 'GET' : request.method;
  const route = PUBLIC[name] || PRIVATE[name];
  if (!route || !route[method]) return html('<p>הדף לא נמצא.</p>', 404);

  const ctx = { request, url, method, query: url.searchParams, flash: null, user: null, csrf: '' };
  const f = cookieValue(request, 'yk_flash');
  if (f) { try { ctx.flash = JSON.parse(f); } catch { /* ignore */ } }

  if (method === 'POST') {
    // Every change must come from the admin's own pages.
    if (!sameOrigin(request)) return html('<p>הבקשה נחסמה.</p>', 403);
    Object.assign(ctx, await readBody(request));
  }

  if (PRIVATE[name]) {
    const s = await currentSession(request);
    if (!s) {
      if (!(await userCount())) return redirect('/admin/setup/');
      if (name === 'page-save' || ctx.query.get('format') === 'json') return json({ ok: false, error: 'פג תוקף ההתחברות. התחברו שוב בחלון אחר ונסו שוב.' }, 401);
      const next = method === 'GET' && name ? `?next=${encodeURIComponent(url.pathname + url.search)}` : '';
      return redirect('/admin/login/' + next);
    }
    ctx.user = s.user;
    ctx.csrf = s.csrf;
    if (method === 'POST') {
      const sent = ctx.form?.get('csrf') ?? ctx.json?.csrf ?? request.headers.get('x-csrf') ?? '';
      if (!sent || sent !== s.csrf) {
        if (ctx.json !== undefined || ctx.query.get('format') === 'json') return json({ ok: false, error: 'הבקשה לא תקינה. רעננו את העמוד ונסו שוב.' }, 400);
        return html('<p>פג תוקף הטופס. חזרו לדף הקודם, רעננו ונסו שוב.</p>', 400);
      }
    }
  }

  const res = await route[method](ctx);
  // A message is shown once: clear it after an HTML page used it.
  if (ctx.flash && (res.headers.get('content-type') || '').startsWith('text/html')) {
    res.headers.append('Set-Cookie', 'yk_flash=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0');
  }
  return res;
}

export { SECURITY_HEADERS };
