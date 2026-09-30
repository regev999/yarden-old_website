/**
 * Cardcom's server-to-server notice about a payment page (WebHookUrl).
 *
 * The notice itself is not trusted for the money: only its LowProfileId is
 * used, to fetch the authoritative result with GetLpResult, and the order is
 * updated from that. The answer is always 200, even on our own errors, so
 * Cardcom doesn't retry forever; problems are logged and shown on the order.
 */
import { getLpResult, isConfigured, parseResult } from '@/lib/cardcom';
import { findOrder, patchOrder, shekels } from '@/lib/shop';
import { addSubscriber, isConfigured as ravmesserReady } from '@/lib/ravmesser';
import { getSetting, one } from '@/lib/db';
import { sendMail } from '@/lib/mail';
import { SITE_URL } from '@/lib/html';

export const dynamic = 'force-dynamic';

const ok = () => Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });

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
  const body = await readBody(request);
  const lowProfileId = body.LowProfileId || body.lowProfileId || body.LowProfile?.LowProfileId || body.lowprofilecode || '';
  if (!lowProfileId) {
    console.warn('[cardcom-webhook] no LowProfileId:', JSON.stringify(body).slice(0, 400));
    return ok();
  }
  try {
    const { httpOk, data } = await getLpResult(lowProfileId);
    if (!httpOk) {
      console.error('[cardcom-webhook] GetLpResult HTTP error for', lowProfileId);
      return ok();
    }
    const r = parseResult(data);
    const order = await findOrder({ id: r.returnValue, lowProfileId });
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
    const claimed = await one(`UPDATE orders SET status = 'paid', paid_at = now(), lowprofile_id = $2
                               WHERE id = $1 AND status IN ('pending', 'failed') RETURNING id`, [order.id, String(lowProfileId)]);
    if (!claimed) return ok();

    const charged = r.amount != null ? Math.round(Number(r.amount) * 100) : null;
    const notes = [];
    if (charged != null && Math.abs(charged - order.amount_agorot) > 1) notes.push(`אזהרה: נגבו ${shekels(charged)} ₪ במקום ${shekels(order.amount_agorot)} ₪`);
    // What the buyer typed for us wins; Cardcom's values fill the gaps
    const email = order.customer_email || r.cardOwnerEmail || '';
    const phone = order.customer_phone || r.cardOwnerPhone || '';
    const name = order.customer_name || r.cardOwnerName || '';
    let f;
    try { f = await fulfil(order, email, phone, name); } catch (e) { f = { fulfillment: 'failed', note: String(e?.message || e) }; }
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
          `\nכל המכירות: ${SITE_URL}/admin/sales/`].filter(Boolean).join('\n'),
        replyTo: email || undefined,
      });
    }
    return ok();
  } catch (e) {
    console.error('[cardcom-webhook] error:', e);
    return ok();
  }
}
