/**
 * The shop: products, payment links and orders, and the buy section a page
 * shows for its products. Same flow as the storytelling site: the price comes
 * from the database, Cardcom hosts the payment page, and an order becomes
 * "paid" only after the webhook has verified it with Cardcom.
 */
import { randomUUID, randomBytes } from 'node:crypto';
import { q, one } from './db';
import { esc, SITE_URL } from './html';
import { isConfigured } from './cardcom';

/* --------------------------------------------------------------- money */

/** 180000 → "1,800" (agorot shown only when there are any). */
export function shekels(agorot) {
  const n = Math.round(Number(agorot) || 0) / 100;
  return n.toLocaleString('he-IL', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
}

/** "1,800" or "1800.50" typed in the admin → agorot, or null. */
export function parseShekels(text) {
  const s = String(text ?? '').replace(/[₪,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(parseFloat(s) * 100);
}

/** The line under a price: "או עד 10 תשלומים של 180 ₪". */
export function installmentsText(agorot, maxPayments) {
  const n = Number(maxPayments) || 1;
  return n > 1 ? `אפשר לחלק עד ${n} תשלומים של ${shekels(Math.round(agorot / n))} ₪` : 'תשלום אחד';
}

/* ------------------------------------------------------------ products */

export async function activeProduct(slug) {
  return one('SELECT * FROM products WHERE slug = $1 AND active', [slug]);
}

export async function productsForPage(path) {
  return q('SELECT * FROM products WHERE active AND page_path = $1 ORDER BY position, id', [path]);
}

/* ------------------------------------------------------- payment links */

export const newLinkToken = () => randomBytes(6).toString('hex');

export async function linkByToken(token) {
  return one('SELECT * FROM payment_links WHERE token = $1', [token]);
}

/** How many times a link was actually paid (from the orders, so an abandoned checkout never uses it up). */
export async function paidLinkCount(id) {
  return (await one(`SELECT count(*)::int AS n FROM orders WHERE payment_link_id = $1 AND status = 'paid'`, [id])).n;
}

/** Can the link be paid right now? One place, so the page and the checkout always agree. */
export function linkState(link, paidCount = 0) {
  if (!link) return { ok: false, reason: 'not_found', message: 'קישור התשלום לא נמצא.' };
  if (!link.active) return { ok: false, reason: 'inactive', message: 'קישור התשלום אינו פעיל.' };
  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) return { ok: false, reason: 'expired', message: 'פג תוקפו של קישור התשלום.' };
  if (link.max_uses != null && paidCount >= link.max_uses) return { ok: false, reason: 'used', message: 'קישור התשלום כבר נוצל.' };
  return { ok: true, reason: 'ok', message: '' };
}

/* -------------------------------------------------------------- orders */

const ORDER_FIELDS = ['product_id', 'payment_link_id', 'title', 'amount_agorot', 'num_payments', 'customer_name', 'customer_email',
  'customer_phone', 'card_owner_name', 'status', 'fulfillment', 'lowprofile_id', 'transaction_id', 'approval_number',
  'invoice_number', 'card_last4', 'page', 'paid_at', 'fulfilled_at', 'error_detail'];

export async function createOrder(fields) {
  const id = randomUUID();
  const cols = Object.keys(fields).filter((k) => ORDER_FIELDS.includes(k));
  await q(`INSERT INTO orders(id, ${cols.join(', ')}) VALUES($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})`,
    [id, ...cols.map((k) => fields[k])]);
  return { id, ...fields };
}

export async function patchOrder(id, fields) {
  const cols = Object.keys(fields).filter((k) => ORDER_FIELDS.includes(k));
  if (!cols.length) return;
  await q(`UPDATE orders SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...cols.map((k) => fields[k])]);
}

export async function findOrder({ id, lowProfileId }) {
  if (id) {
    const o = await one('SELECT * FROM orders WHERE id = $1', [String(id)]);
    if (o) return o;
  }
  return lowProfileId ? one('SELECT * FROM orders WHERE lowprofile_id = $1', [String(lowProfileId)]) : null;
}

export const ORDER_STATUS = { pending: 'ממתין', paid: 'שולם', failed: 'נכשל', refunded: 'זוכה' };
export const FULFILLMENT = { not_required: '—', pending: 'ממתין', sent: 'נשלח', failed: 'נכשל' };

/* ---------------------------------------------------------------- site */

/**
 * The address Cardcom sends the buyer back to and posts the result to. The
 * request's own host is used only when it is one of this site's addresses,
 * so a forged Host header can't point Cardcom elsewhere.
 */
export function siteBase(request) {
  if (process.env.SHOP_BASE_URL) return process.env.SHOP_BASE_URL.replace(/\/$/, '');
  const url = new URL(request.url);
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || url.host;
  const own = new URL(SITE_URL).host.replace(/^www\./, '');
  const allowed = new RegExp(`^(www\\.)?${own.replace(/\./g, '\\.')}$|^yarden\\.to-web\\.co\\.il$|^localhost(:\\d+)?$|^127\\.0\\.0\\.1(:\\d+)?$`);
  if (!allowed.test(host)) return SITE_URL.replace(/\/$/, '');
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  return `${local ? url.protocol.replace(':', '') : 'https'}://${host}`;
}

/* ------------------------------------------------------ the buy section */

/** Offers with a live price and a button, for a page's active products (only once Cardcom is connected). */
export function buySectionHtml(products) {
  if (!products.length || !isConfigured()) return '';
  const offers = products.map((p) => `<article class="offer offer--buy">
<h3>${esc(p.title)}</h3>${p.description ? `<p>${esc(p.description)}</p>` : ''}
<p class="price"><b>${shekels(p.price_agorot)} ₪</b><span>${esc(installmentsText(p.price_agorot, p.max_payments))}</span></p>
<button class="btn" type="button" data-checkout="${esc(p.slug)}">לתשלום מאובטח</button>
</article>`).join('');
  return `<section class="block block--buy" id="buy"><div class="wrap">
<h2 class="heading">הרשמה ותשלום</h2>
<div class="offers">${offers}</div>
<p class="secure-note">התשלום בעמוד המאובטח של קארדקום. חשבונית נשלחת אליכם במייל.</p>
</div></section>`;
}

/** Put the buy section where the page asks for it (<!--yk:buy-->), else just before the contact block. */
export async function withBuySection(html, path) {
  if (!isConfigured()) return html;
  const section = buySectionHtml(await productsForPage(path).catch(() => []));
  if (!section) return html;
  if (html.includes('<!--yk:buy-->')) return html.replace('<!--yk:buy-->', section);
  const at = html.indexOf('<section class="section section--ink block--contact"');
  return at >= 0 ? html.slice(0, at) + section + '\n' + html.slice(at) : html + section;
}
