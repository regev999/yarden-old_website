/**
 * Cardcom's server-to-server notice about a payment page (WebHookUrl).
 *
 * The notice itself is not trusted for the money: only its LowProfileId is
 * used, to fetch the authoritative result with GetLpResult, and the order is
 * updated from that. Until the order is claimed, a failure on our side (the
 * database, a timeout asking Cardcom) answers 500, so Cardcom sends the notice
 * again; once claimed, the answer is 200 and problems are shown on the order.
 */
import { getLpResult, isConfigured, parseResult } from '@/lib/cardcom';
import { findOrder, patchOrder, paidLinkCount, shekels, siteBase } from '@/lib/shop';
import { addSubscriber, isConfigured as ravmesserReady } from '@/lib/ravmesser';
import { getSetting, one } from '@/lib/db';
import { sendMail } from '@/lib/mail';
import { bodyTooLarge, ipHash, takeAttempt } from '@/lib/security';

export const dynamic = 'force-dynamic';

const ok = () => Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
const retry = () => Response.json({ ok: false }, { status: 500, headers: { 'Cache-Control': 'no-store' } });

async function readBody(request) {
  const type = request.headers.get('content-type') || '';
  try {
    if (type.includes('json')) return await request.json();
    return Object.fromEntries(new URLSearchParams(await request.text()));
  } catch {
    return {};
  }
}

/** Add the buyer to the Rav-Messer list of what they bought. Never undoes a payment. */
async function fulfil(order, email, phone, name) {
  const source = order.product_id
    ? await one('SELECT ravmesser_list FROM products WHERE id = $1', [order.product_id])
    : order.payment_link_id ? await one('SELECT ravmesser_list FROM payment_links WHERE id = $1', [order.payment_link_id]) : null;
  const listId = source?.ravmesser_list || '';
  if (!listId) return { fulfillment: 'not_required' };
  if (!ravmesserReady()) return { fulfillment: 'pending', note: 'רב־מסר לא מחובר (חסרים RAVMESSER_CLIENT_ID/SECRET/USER_TOKEN)' };
  if (!email) return { fulfillment: 'failed', note: 'אין מייל של הקונה לרישום לרשימה' };
  const r = await addSubscriber({ listId, email, name, phone });
  return r.ok ? { fulfillment: 'sent', fulfilled_at: new Date().toISOString() } : { fulfillment: 'failed', note: r.error };
}

export async function POST(request) {
  if (!isConfigured()) return ok();
  if (bodyTooLarge(request, 64 * 1024)) return ok();
  // Each notice makes a call to Cardcom; a flood from one address shouldn't
  if (await takeAttempt('webhook|' + ipHash(request), 60, 300)) return Response.json({ ok: false }, { status: 429 });
  const body = await readBody(request);
  const lowProfileId = body.LowProfileId || body.lowProfileId || body.LowProfile?.LowProfileId || body.lowprofilecode || '';
  if (!lowProfileId) {
    console.warn('[cardcom-webhook] no LowProfileId:', JSON.stringify(body).slice(0, 400));
    return ok();
  }
  let order, r, claimed;
  try {
    const { httpOk, data } = await getLpResult(lowProfileId);
    if (!httpOk) {
      console.error('[cardcom-webhook] GetLpResult HTTP error for', lowProfileId);
      return retry();
    }
    r = parseResult(data);
    order = await findOrder({ id: r.returnValue, lowProfileId });
    if (!order) {
      console.error('[cardcom-webhook] order not found', { returnValue: r.returnValue, lowProfileId });
      return ok();
    }
    // Cardcom may call more than once for the same payment
    if (order.status === 'paid') return ok();
    // The result must belong to this very payment page
    if (order.lowprofile_id && order.lowprofile_id !== String(lowProfileId)) {
      console.error('[cardcom-webhook] LowProfileId mismatch for order', order.id);
      return ok();
    }

    if (!r.approved) {
      await patchOrder(order.id, { status: 'failed', lowprofile_id: String(lowProfileId), error_detail: `Cardcom ${r.responseCode}: ${r.description}`.slice(0, 500) });
      return ok();
    }

    // Claim the order, so two notices arriving together are handled once
    claimed = await one(`UPDATE orders SET status = 'paid', paid_at = now(), lowprofile_id = $2
                         WHERE id = $1 AND status IN ('pending', 'failed') RETURNING id`, [order.id, String(lowProfileId)]);
    if (!claimed) return ok();
  } catch (e) {
    console.error('[cardcom-webhook] error before the order was recorded:', e);
    return retry();
  }

  try {
    const charged = r.amount != null ? Math.round(Number(r.amount) * 100) : null;
    const notes = [];
    const wrongAmount = charged != null && Math.abs(charged - order.amount_agorot) > 1;
    if (wrongAmount) notes.push(`אזהרה: נגבו ${shekels(charged)} ₪ במקום ${shekels(order.amount_agorot)} ₪. לא נשלח לרשימה; לבדוק ידנית`);
    if (order.payment_link_id) {
      const link = await one('SELECT max_uses FROM payment_links WHERE id = $1', [order.payment_link_id]);
      if (link?.max_uses != null && (await paidLinkCount(order.payment_link_id)) > link.max_uses) notes.push(`אזהרה: קישור התשלום שולם יותר מ־${link.max_uses} פעמים`);
    }
    // What the buyer typed for us wins; Cardcom's values fill the gaps
    const email = order.customer_email || r.cardOwnerEmail || '';
    const phone = order.customer_phone || r.cardOwnerPhone || '';
    const name = order.customer_name || r.cardOwnerName || '';
    let f;
    if (wrongAmount) f = { fulfillment: 'pending' };
    else try { f = await fulfil(order, email, phone, name); } catch (e) { f = { fulfillment: 'failed', note: String(e?.message || e) }; }
    if (f.note) notes.push(`אספקה: ${f.note}`);

    await patchOrder(order.id, {
      transaction_id: r.transactionId != null ? String(r.transactionId) : null,
      approval_number: r.approvalNumber != null ? String(r.approvalNumber) : null,
      invoice_number: r.documentNumber != null ? String(r.documentNumber) : null,
      card_last4: r.last4 != null ? String(r.last4) : null,
      num_payments: r.numPayments || order.num_payments,
      customer_name: name,
      customer_email: email,
      customer_phone: phone,
      card_owner_name: r.cardOwnerName || order.card_owner_name || '',
      fulfillment: f.fulfillment,
      fulfilled_at: f.fulfilled_at || null,
      error_detail: notes.join(' | ').slice(0, 500),
    });

    // A note to Yarden about the sale (when mail is connected)
    const to = (await getSetting('notify_email')) || process.env.NOTIFY_EMAIL || '';
    if (to) {
      await sendMail({
        to, subject: `מכירה חדשה: ${order.title} · ${shekels(order.amount_agorot)} ₪`,
        text: [`${order.title}`, `סכום: ${shekels(order.amount_agorot)} ₪${r.numPayments > 1 ? ` (${r.numPayments} תשלומים)` : ''}`,
          name && `שם: ${name}`, phone && `טלפון: ${phone}`, email && `מייל: ${email}`,
          r.documentNumber && `חשבונית: ${r.documentNumber}`, notes.length && `\n${notes.join('\n')}`,
          `\nכל המכירות: ${siteBase(request)}/admin/sales/`].filter(Boolean).join('\n'),
        replyTo: email || undefined,
      });
    }
    return ok();
  } catch (e) {
    // Paid and recorded; what failed is the details or the mail. Say so on the order.
    console.error('[cardcom-webhook] error after the order was recorded:', e);
    await patchOrder(order.id, { error_detail: `שגיאה בעדכון פרטי התשלום: ${String(e?.message || e)}`.slice(0, 500) }).catch(() => {});
    return ok();
  }
}
