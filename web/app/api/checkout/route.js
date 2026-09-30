/**
 * Starts a purchase: checks what is being bought, records a 'pending' order,
 * opens a Cardcom payment page and returns its address for the browser.
 *
 *   { slug }  a product (managed in the admin, shown on its page)
 *   { token } a payment link: a one-off charge with no product behind it
 *
 * The amount always comes from the database row, never from the browser.
 */
import { createLowProfile, isConfigured } from '@/lib/cardcom';
import { activeProduct, createOrder, linkByToken, linkState, paidLinkCount, patchOrder, siteBase } from '@/lib/shop';
import { ipHash, recordAttempt, sameOrigin, tooManyAttempts } from '@/lib/security';

export const dynamic = 'force-dynamic';

function reply(status, body) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}

const clean = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

/** Only a path on this site, so the return address can't send the buyer elsewhere. */
function returnPath(value) {
  let p = clean(value, 400);
  try { p = decodeURI(p); } catch { return '/'; }
  return /^\/(?!\/)[^\s\\?#]*$/.test(p) ? p : '/';
}

export async function POST(request) {
  if (!sameOrigin(request)) return reply(403, { error: 'הבקשה נחסמה.' });
  const key = 'checkout|' + ipHash(request);
  if (await tooManyAttempts(key, 12, 300)) return reply(429, { error: 'יותר מדי ניסיונות. אפשר לנסות שוב בעוד כמה דקות.' });
  await recordAttempt(key);
  if (!isConfigured()) return reply(503, { error: 'התשלום באתר עוד לא הופעל. אפשר ליצור קשר בטלפון או בוואטסאפ.' });

  let body;
  try { body = await request.json(); } catch { return reply(400, { error: 'בקשה לא תקינה.' }); }
  const slug = clean(body?.slug, 120);
  const token = clean(body?.token, 120);
  if (!slug && !token) return reply(400, { error: 'בקשה לא תקינה.' });

  // Who is paying, as they typed it for us (the payment link page asks). Cardcom
  // reports the name on the card, which is someone else whenever a partner or
  // parent pays; kept on the order even if the payment is abandoned.
  const buyer = { customer_name: clean(body.name, 120), customer_phone: clean(body.phone, 40), customer_email: clean(body.email, 160).toLowerCase() };
  if (buyer.customer_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyer.customer_email)) return reply(422, { error: 'כתובת המייל לא תקינה.' });

  let charge;
  if (token) {
    const link = await linkByToken(token);
    const state = linkState(link, link?.max_uses != null ? await paidLinkCount(link.id) : 0);
    if (!state.ok) return reply(state.reason === 'not_found' ? 404 : 409, { error: state.message });
    charge = { title: link.title, amount: link.amount_agorot, maxPayments: link.max_payments, fields: { payment_link_id: link.id } };
  } else {
    const product = await activeProduct(slug);
    if (!product) return reply(404, { error: 'המוצר לא נמצא או שאינו זמין כרגע.' });
    charge = { title: product.title, amount: product.price_agorot, maxPayments: product.max_payments, fields: { product_id: product.id } };
  }

  const base = siteBase(request);
  const back = base + encodeURI(returnPath(body.returnPath));
  const order = await createOrder({
    ...charge.fields, ...buyer,
    title: charge.title, amount_agorot: charge.amount, num_payments: charge.maxPayments,
    status: 'pending', page: returnPath(body.returnPath),
  });

  const lp = await createLowProfile({
    amountShekel: Math.round(charge.amount) / 100,
    productName: charge.title,
    orderId: order.id,
    successUrl: `${back}?payment=success`,
    failedUrl: `${back}?payment=failed`,
    webhookUrl: `${base}/api/cardcom-webhook/`,
    maxPayments: charge.maxPayments,
  });
  if (!lp.ok) {
    console.error('[checkout] Cardcom Create failed:', lp.error, JSON.stringify(lp.raw || {}).slice(0, 600));
    await patchOrder(order.id, { status: 'failed', error_detail: String(lp.error).slice(0, 500) }).catch(() => {});
    return reply(502, { error: 'לא הצלחנו לפתוח את עמוד התשלום. נסו שוב בעוד רגע, או צרו קשר בטלפון.' });
  }
  // The webhook can find the order by this too, if the return value is missing
  await patchOrder(order.id, { lowprofile_id: String(lp.lowProfileId || '') || null }).catch(() => {});
  return reply(200, { url: lp.url });
}
