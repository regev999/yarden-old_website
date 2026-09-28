/** Receives the site's contact / newsletter forms, stores the lead and emails a notification. */
import { q, getSetting } from '@/lib/db';
import { sendMail } from '@/lib/mail';
import { ipHash, recordAttempt, sameOrigin, tooManyAttempts } from '@/lib/security';
import { SITE_URL } from '@/lib/html';
import { LEAD_SOURCES } from '@/lib/leads';

export const dynamic = 'force-dynamic';

function reply(status, body) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}

export async function POST(request) {
  if (!sameOrigin(request)) return reply(403, { ok: false, error: 'origin' });
  let form;
  try {
    form = await request.formData();
  } catch {
    return reply(400, { ok: false, error: 'bad request' });
  }
  const field = (name, n) => String(form.get(name) ?? '').trim().slice(0, n);

  // Honeypot: real visitors never see or fill this field.
  if (field('website', 200)) return reply(200, { ok: true });

  const key = 'lead|' + ipHash(request);
  if (await tooManyAttempts(key, 6, 600)) {
    return reply(429, { ok: false, error: 'אפשר לשלוח שוב בעוד כמה דקות, או להתקשר ישירות.' });
  }

  const kind = field('form', 20);
  const product = field('product', 20);
  const lead = {
    name: field('name', 120), phone: field('phone', 40), email: field('email', 160), message: field('message', 4000),
    kind: kind in LEAD_SOURCES ? kind : 'contact',
    product: ['therapy', 'course'].includes(product) ? product : null,
    page: (() => { try { return decodeURIComponent(field('page', 600)).slice(0, 300); } catch { return field('page', 300); } })(),
  };
  if (lead.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) return reply(422, { ok: false, error: 'כתובת המייל לא תקינה.' });
  if (!lead.phone && !lead.email) return reply(422, { ok: false, error: 'כדי שנוכל לחזור אליך, צריך להשאיר טלפון או מייל.' });

  await recordAttempt(key);
  const [row] = await q(
    `INSERT INTO leads(name, phone, email, message, kind, product, page, ip_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [lead.name, lead.phone, lead.email, lead.message, lead.kind, lead.product, lead.page, ipHash(request)],
  );

  const to = (await getSetting('notify_email')) || process.env.NOTIFY_EMAIL || '';
  if (to) {
    const source = LEAD_SOURCES[lead.product ?? lead.kind] ?? 'יצירת קשר';
    const lines = [
      'שם: ' + lead.name,
      lead.phone && 'טלפון: ' + lead.phone,
      lead.email && 'מייל: ' + lead.email,
      lead.message && '\nהודעה:\n' + lead.message,
      '\nמקור: ' + source,
      lead.page && 'נשלח מהעמוד: ' + SITE_URL + lead.page,
      '\nלצפייה בליד: ' + SITE_URL + '/admin/leads/' + row.id + '/',
    ].filter(Boolean);
    await sendMail({ to, subject: 'ליד חדש מהאתר: ' + (lead.name || lead.phone || lead.email), text: lines.join('\n'), replyTo: lead.email || undefined });
  }
  return reply(200, { ok: true });
}
