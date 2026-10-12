/**
 * Receives the site's contact / newsletter forms, stores the lead and emails a
 * notification. The page's script sends it and reads a JSON answer; a form
 * sent without the script (blocked, still loading) gets a thank-you page.
 */
import { q, getSetting } from '@/lib/db';
import { sendMail } from '@/lib/mail';
import { bodyTooLarge, ipHash, sameOrigin, takeAttempt } from '@/lib/security';
import { esc } from '@/lib/html';
import { LEAD_SOURCES } from '@/lib/leads';
import { siteBase } from '@/lib/shop';
import { pageDocument } from '@/lib/shell';

export const dynamic = 'force-dynamic';

const HEADERS = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };

/** Only a path on this site, never another address (it becomes a link in the admin and in the mail). */
function localPath(v) {
  let p = String(v || '').trim();
  try { p = decodeURIComponent(p); } catch { /* keep as sent */ }
  return /^\/(?![/\\])[^\s\\@<>"]*$/.test(p) ? p.slice(0, 300) : '';
}

function answer(request, status, body, back = '/') {
  if ((request.headers.get('accept') || '').includes('application/json')) return Response.json(body, { status, headers: HEADERS });
  const ok = status === 200 && body.ok;
  const title = ok ? 'תודה, הפרטים התקבלו' : 'השליחה לא הצליחה';
  const text = ok ? 'אחזור אליך בהקדם.' : (body.error || 'אפשר לנסות שוב, או להתקשר ישירות.');
  const main = `<header class="page-hero"><div class="wrap"><h1>${esc(title)}</h1><p class="page-hero__sub">${esc(text)}</p>
<div class="actions"><a class="btn btn--paper" href="${esc(back)}">חזרה לעמוד</a></div></div></header>`;
  return new Response(pageDocument({ path: '/api/lead/', title, noindex: true, main }), { status, headers: { ...HEADERS, 'Content-Type': 'text/html; charset=utf-8' } });
}

export async function POST(request) {
  if (!sameOrigin(request)) return answer(request, 403, { ok: false, error: 'הבקשה נחסמה.' });
  if (bodyTooLarge(request, 64 * 1024)) return answer(request, 413, { ok: false, error: 'ההודעה ארוכה מדי.' });
  let form;
  try {
    form = await request.formData();
  } catch {
    return answer(request, 400, { ok: false, error: 'הבקשה לא תקינה.' });
  }
  const field = (name, n) => String(form.get(name) ?? '').trim().slice(0, n);
  let referer = '';
  try { referer = new URL(request.headers.get('referer') || '').pathname; } catch { /* none */ }
  const page = localPath(field('page', 600) || referer);
  const back = (page || '/') + '#contact';

  // Honeypot: real visitors never see or fill this field.
  if (field('website', 200)) return answer(request, 200, { ok: true }, back);

  const key = 'lead|' + ipHash(request);
  if (await takeAttempt(key, 6, 600)) {
    return answer(request, 429, { ok: false, error: 'אפשר לשלוח שוב בעוד כמה דקות, או להתקשר ישירות.' }, back);
  }

  const kind = field('form', 20);
  const product = field('product', 20);
  const lead = {
    name: field('name', 120), phone: field('phone', 40), email: field('email', 160), message: field('message', 4000),
    kind: kind in LEAD_SOURCES ? kind : 'contact',
    product: ['therapy', 'course'].includes(product) ? product : null,
    page,
  };
  if (lead.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) return answer(request, 422, { ok: false, error: 'כתובת המייל לא תקינה.' }, back);
  if (!lead.phone && !lead.email) return answer(request, 422, { ok: false, error: 'כדי שנוכל לחזור אליך, צריך להשאיר טלפון או מייל.' }, back);

  const [row] = await q(
    `INSERT INTO leads(name, phone, email, message, kind, product, page, ip_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [lead.name, lead.phone, lead.email, lead.message, lead.kind, lead.product, lead.page, ipHash(request)],
  );

  const to = (await getSetting('notify_email')) || process.env.NOTIFY_EMAIL || '';
  if (to) {
    const base = siteBase(request);
    const source = LEAD_SOURCES[lead.product ?? lead.kind] ?? 'יצירת קשר';
    const lines = [
      'שם: ' + lead.name,
      lead.phone && 'טלפון: ' + lead.phone,
      lead.email && 'מייל: ' + lead.email,
      lead.message && '\nהודעה:\n' + lead.message,
      '\nמקור: ' + source,
      lead.page && 'נשלח מהעמוד: ' + base + encodeURI(lead.page),
      '\nלצפייה בליד: ' + base + '/admin/lead/?id=' + row.id,
    ].filter(Boolean);
    await sendMail({ to, subject: 'ליד חדש מהאתר: ' + (lead.name || lead.phone || lead.email), text: lines.join('\n'), replyTo: lead.email || undefined });
  }
  return answer(request, 200, { ok: true }, back);
}
