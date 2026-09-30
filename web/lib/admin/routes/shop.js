/**
 * The shop in the admin: sales (orders), products and payment links.
 * Same flow as the storytelling site's dashboard ("מכירות", "מוצרים",
 * "קישורי תשלום"), on this site's database.
 */
import { randomBytes } from 'node:crypto';
import { q, one } from '../../db';
import { isConfigured } from '../../cardcom';
import { isConfigured as ravmesserReady } from '../../ravmesser';
import { FULFILLMENT, ORDER_STATUS, installmentsText, linkState, newLinkToken, parseShekels, shekels } from '../../shop';
import { logActivity, publishChanges } from '../common';
import { adminPage, csrfField, esc, heDate, html, qs, redirect, SECURITY_HEADERS } from '../ui';

const option = (k, label, cur) => `<option value="${esc(k)}"${String(k) === String(cur) ? ' selected' : ''}>${esc(label)}</option>`;

/** Shown on every shop screen until Cardcom is connected. */
function setupNotice() {
  if (isConfigured()) return '';
  return `<p class="notice notice--warn">הסליקה עוד לא מחוברת, ולכן כפתורי התשלום לא מוצגים באתר. אפשר כבר להכין מוצרים וקישורים.
  כדי לחבר: להגדיר במשתני הסביבה של האפליקציה בשרת את <span dir="ltr">CARDCOM_TERMINAL_NUMBER</span>, <span dir="ltr">CARDCOM_API_NAME</span> ו־<span dir="ltr">CARDCOM_API_PASSWORD</span>, ולהפעיל אותה מחדש.</p>`;
}

/* ================================================================= sales */

function saleFilters(query) {
  const status = query.get('status') in ORDER_STATUS ? query.get('status') : '';
  const text = (query.get('q') || '').trim();
  const where = [];
  const args = [];
  if (status) { args.push(status); where.push(`status = $${args.length}`); }
  if (text) {
    args.push('%' + text.replace(/[\\%_]/g, '\\$&') + '%');
    where.push(`(title ILIKE $${args.length} OR customer_name ILIKE $${args.length} OR customer_email ILIKE $${args.length}
      OR customer_phone ILIKE $${args.length} OR card_owner_name ILIKE $${args.length} OR invoice_number ILIKE $${args.length})`);
  }
  return { status, text, where: where.length ? ' WHERE ' + where.join(' AND ') : '', args };
}

/** Name (and the card owner's, when someone else paid), phone and email in one cell. */
const who = (o) => {
  const other = o.card_owner_name && o.customer_name && o.card_owner_name.trim() !== o.customer_name.trim();
  return '<div class="buyer">' + `<b class="buyer__name">${esc(o.customer_name || o.card_owner_name || '—')}</b>`
    + (other ? `<span class="muted small">בכרטיס של ${esc(o.card_owner_name)}</span>` : '')
    + (o.customer_phone ? `<a dir="ltr" href="tel:${esc(o.customer_phone.replace(/[^\d+]/g, ''))}">${esc(o.customer_phone)}</a>` : '')
    + (o.customer_email ? `<a dir="ltr" href="mailto:${esc(o.customer_email)}">${esc(o.customer_email)}</a>` : '') + '</div>';
};

export const sales = {
  async GET(ctx) {
    const f = saleFilters(ctx.query);
    const [month, all, open] = await Promise.all([
      one(`SELECT count(*)::int AS n, coalesce(sum(amount_agorot), 0)::bigint AS sum FROM orders WHERE status = 'paid' AND paid_at >= date_trunc('month', now())`),
      one(`SELECT count(*)::int AS n, coalesce(sum(amount_agorot), 0)::bigint AS sum FROM orders WHERE status = 'paid'`),
      one(`SELECT count(*)::int AS n FROM orders WHERE status = 'pending' AND created_at > now() - interval '14 days' AND (customer_name <> '' OR customer_phone <> '')`),
    ]);
    const rows = await q(`SELECT * FROM orders${f.where} ORDER BY coalesce(paid_at, created_at) DESC LIMIT 500`, f.args);
    const showFulfil = rows.some((o) => o.fulfillment !== 'not_required');
    const table = !rows.length
      ? `<p class="empty">${f.where ? 'אין מכירות שמתאימות לסינון.' : 'עוד אין מכירות. כשמישהו ישלם באתר, התשלום יופיע כאן עם מספר האישור והחשבונית.'}</p>`
      : `<div class="table-wrap"><table class="table sales">
  <thead><tr><th>תאריך</th><th>מה נרכש</th><th>סכום</th><th>קונה</th><th>חשבונית ואישור</th><th>סטטוס</th>${showFulfil ? '<th>רב־מסר</th>' : ''}</tr></thead><tbody>
  ${rows.map((o) => `<tr>
    <td class="nowrap">${esc(heDate(o.paid_at || o.created_at))}</td>
    <td>${esc(o.title)}</td>
    <td class="nowrap">${shekels(o.amount_agorot)} ₪${o.num_payments > 1 && o.status === 'paid' ? `<br><span class="muted small">${o.num_payments} תשלומים</span>` : ''}</td>
    <td>${who(o)}</td>
    <td class="nowrap">${o.invoice_number ? `חשבונית ${esc(o.invoice_number)}` : ''}${o.approval_number ? `<br><span class="muted small">אישור ${esc(o.approval_number)}${o.card_last4 ? ` · <span dir="ltr">•••• ${esc(o.card_last4)}</span>` : ''}</span>` : ''}</td>
    <td><span class="tag tag--order-${esc(o.status)}">${esc(ORDER_STATUS[o.status] || o.status)}</span>${o.error_detail ? `<p class="muted small order-note">${esc(o.error_detail.slice(0, 160))}</p>` : ''}</td>
    ${showFulfil ? `<td>${esc(FULFILLMENT[o.fulfillment] || o.fulfillment)}</td>` : ''}</tr>`).join('')}
  </tbody></table></div>
  <p class="muted">${rows.length} שורות${rows.length === 500 ? ' (מוצגות 500 האחרונות)' : ''}. "ממתין" הוא מי שפתח את עמוד התשלום ולא סיים; כשהשאיר פרטים, אפשר לחזור אליו.</p>`;
    const body = `${setupNotice()}<section class="summary summary--3">
  <div class="summary__item"><b>${shekels(month.sum)} ₪</b><span>${month.n} מכירות החודש</span></div>
  <div class="summary__item"><b>${shekels(all.sum)} ₪</b><span>${all.n} מכירות בסך הכל</span></div>
  <a class="summary__item" href="/admin/sales/?status=pending"><b>${open.n}</b><span>התחילו לשלם ולא סיימו (שבועיים אחרונים)</span></a>
</section>
<form class="filters" method="get">
  <label>סטטוס <select name="status" data-autosubmit><option value="">הכל</option>${Object.entries(ORDER_STATUS).map(([k, v]) => option(k, v, f.status)).join('')}</select></label>
  <label class="filters__search">חיפוש <input type="search" name="q" value="${esc(f.text)}" placeholder="שם, טלפון, מייל, מוצר או מספר חשבונית"></label>
  <button class="btn btn--quiet" type="submit">סינון</button>
  <a class="filters__export" href="/admin/sales-export/${esc(qs({ status: f.status, q: f.text }))}">הורדה לאקסל (CSV)</a>
</form>${table}`;
    return html(await adminPage(ctx, { title: 'מכירות', active: 'sales', body }));
  },
};

export const salesExport = {
  async GET(ctx) {
    const f = saleFilters(ctx.query);
    const rows = await q(`SELECT * FROM orders${f.where} ORDER BY coalesce(paid_at, created_at) DESC`, f.args);
    // Cells that start with = + - @ would run as formulas in Excel; prefix them.
    const cell = (v) => {
      let s = String(v ?? '');
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [['תאריך סליקה', 'נוצר', 'מה נרכש', 'סכום', 'תשלומים', 'שם', 'בעל הכרטיס', 'טלפון', 'מייל', 'חשבונית', 'אישור', '4 ספרות', 'סטטוס', 'רב־מסר', 'הערות']];
    for (const o of rows) {
      lines.push([o.paid_at ? heDate(o.paid_at) : '', heDate(o.created_at), o.title, (o.amount_agorot / 100).toFixed(2), o.num_payments || '',
        o.customer_name, o.card_owner_name, o.customer_phone, o.customer_email, o.invoice_number, o.approval_number, o.card_last4,
        ORDER_STATUS[o.status] || o.status, FULFILLMENT[o.fulfillment] || o.fulfillment, o.error_detail]);
    }
    const csv = '﻿' + lines.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
    const day = new Date().toISOString().slice(0, 10);
    return new Response(csv, { headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="sales-${day}.csv"` } });
  },
};

/* ============================================================== products */

async function pageOptions(current) {
  const pages = await q(`SELECT path, title FROM pages WHERE kind = 'page' AND NOT noindex ORDER BY title`);
  return `<option value="">לא מוצג באתר</option>${pages.map((p) => option(p.path, `${p.title} (${decodeURI(p.path)})`, current)).join('')}`;
}

export const products = {
  async GET(ctx) {
    const editParam = ctx.query.get('edit');
    if (editParam !== null) {
      const id = parseInt(editParam, 10) || 0;
      const p = (id && (await one('SELECT * FROM products WHERE id = $1', [id])))
        || { id: 0, title: '', description: '', price_agorot: '', max_payments: 1, page_path: '', ravmesser_list: '', active: true, slug: '' };
      const body = `<p class="back"><a href="/admin/products/">חזרה לכל המוצרים</a></p>${setupNotice()}
<form method="post" class="panel stack narrow-form" data-track-changes>${csrfField(ctx)}<input type="hidden" name="action" value="save"><input type="hidden" name="id" value="${p.id}">
  <label>שם המוצר <input name="title" value="${esc(p.title)}" required maxlength="120" placeholder="למשל: קורס התמקדות שנתי">
    <small>מופיע באתר, בעמוד התשלום ובחשבונית.</small></label>
  <label>שורת הסבר (לא חובה) <input name="description" value="${esc(p.description)}" maxlength="240" placeholder="למשל: 12 מפגשים בזום, פתיחה בנובמבר"></label>
  <div class="two">
    <label>מחיר (₪) <input name="price" value="${p.price_agorot === '' ? '' : esc(String(p.price_agorot / 100))}" required inputmode="decimal" dir="ltr"></label>
    <label>עד כמה תשלומים <input name="max_payments" type="number" min="1" max="36" value="${esc(p.max_payments)}" required dir="ltr">
      <small>הקונה בוחר בעמוד התשלום.</small></label>
  </div>
  <label>באיזה עמוד להציג את הכפתור <select name="page_path">${await pageOptions(p.page_path)}</select>
    <small>אזור "הרשמה ותשלום" מתווסף לעמוד, לפני בלוק יצירת הקשר.</small></label>
  <label>מזהה רשימה ברב־מסר (לא חובה) <input name="ravmesser_list" value="${esc(p.ravmesser_list)}" dir="ltr" maxlength="120">
    <small>מי שישלם יתווסף לרשימה הזו אוטומטית.${ravmesserReady() ? '' : ' (רב־מסר עוד לא מחובר לאתר.)'}</small></label>
  <label class="check"><input type="checkbox" name="active" value="1"${p.active ? ' checked' : ''}> פעיל (מוצג באתר ואפשר לשלם עליו)</label>
  ${p.slug ? `<p class="muted small">מזהה לכפתור מותאם: <code dir="ltr">data-checkout="${esc(p.slug)}"</code></p>` : ''}
  <button class="btn" type="submit">שמירה</button>
</form>`;
      return html(await adminPage(ctx, { title: p.id ? 'עריכת מוצר' : 'מוצר חדש', active: 'products', body }));
    }
    const list = await q(`SELECT p.*, (SELECT count(*)::int FROM orders o WHERE o.product_id = p.id AND o.status = 'paid') AS sold,
      (SELECT title FROM pages WHERE path = p.page_path) AS page_title FROM products p ORDER BY p.active DESC, p.position, p.id`);
    const body = `${setupNotice()}<p class="muted">מוצר הוא משהו שמשלמים עליו באתר: קורס, סדנה, סדרת מפגשים. המחיר כאן הוא המחיר שנגבה, ואזור התשלום מופיע בעמוד שבוחרים לו.</p>
${list.length ? `<div class="table-wrap"><table class="table">
  <thead><tr><th>מוצר</th><th>מחיר</th><th>עמוד באתר</th><th>נמכר</th><th>מצב</th><th></th></tr></thead><tbody>
  ${list.map((p) => `<tr><td><a href="?edit=${p.id}">${esc(p.title)}</a>${p.description ? `<br><span class="muted small">${esc(p.description)}</span>` : ''}</td>
    <td class="nowrap">${shekels(p.price_agorot)} ₪<br><span class="muted small">${esc(installmentsText(p.price_agorot, p.max_payments))}</span></td>
    <td>${p.page_path ? `<a href="${esc(p.page_path)}#buy" target="_blank" rel="noopener">${esc(p.page_title || decodeURI(p.page_path))}</a>` : '<span class="muted">לא מוצג</span>'}</td>
    <td>${p.sold}</td>
    <td><span class="tag${p.active ? ' tag--ok' : ' tag--closed'}">${p.active ? 'פעיל' : 'כבוי'}</span></td>
    <td class="nowrap"><a href="?edit=${p.id}">עריכה</a>
      <form method="post" class="inline">${csrfField(ctx)}<input type="hidden" name="id" value="${p.id}"><button class="linklike small" name="action" value="toggle">${p.active ? 'כיבוי' : 'הפעלה'}</button></form>
      ${p.sold ? '' : `<form method="post" class="inline" data-confirm="למחוק את המוצר?">${csrfField(ctx)}<input type="hidden" name="id" value="${p.id}"><button class="linklike linklike--danger small" name="action" value="delete">מחיקה</button></form>`}</td></tr>`).join('')}
  </tbody></table></div>` : '<p class="empty">עוד אין מוצרים. מוצר חדש: שם, מחיר ובאיזה עמוד להציג אותו.</p>'}`;
    return html(await adminPage(ctx, { title: 'מוצרים', active: 'products', body, actions: '<a class="btn" href="/admin/products/?edit=0">מוצר חדש</a>' }));
  },

  async POST(ctx) {
    const action = String(ctx.form.get('action') || '');
    const id = parseInt(ctx.form.get('id'), 10) || 0;
    const f = (k, n = 240) => String(ctx.form.get(k) || '').trim().slice(0, n);
    if (action === 'save') {
      const back = (msg) => redirect(`/admin/products/?edit=${id}`, msg, 'error');
      const title = f('title', 120);
      const price = parseShekels(f('price', 20));
      const maxPayments = parseInt(f('max_payments', 3), 10);
      const pagePath = f('page_path', 300);
      if (!title) return back('חסר שם למוצר.');
      if (!price || price < 100) return back('המחיר צריך להיות מספר בשקלים, למשל 1800.');
      if (!(maxPayments >= 1 && maxPayments <= 36)) return back('מספר התשלומים צריך להיות בין 1 ל־36.');
      if (pagePath && !(await one('SELECT 1 FROM pages WHERE path = $1', [pagePath]))) return back('העמוד שנבחר לא נמצא.');
      const vals = [title, f('description'), price, maxPayments, pagePath, f('ravmesser_list', 120).replace(/\s/g, ''), !!ctx.form.get('active')];
      if (id) {
        await q(`UPDATE products SET title=$1, description=$2, price_agorot=$3, max_payments=$4, page_path=$5, ravmesser_list=$6, active=$7, updated_at=now() WHERE id=$8`, [...vals, id]);
      } else {
        await q(`INSERT INTO products(title, description, price_agorot, max_payments, page_path, ravmesser_list, active, slug) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [...vals, 'p-' + randomBytes(4).toString('hex')]);
      }
      publishChanges();
      await logActivity(ctx, id ? 'עדכן מוצר' : 'הוסיף מוצר', title, '/admin/products/');
      return redirect('/admin/products/', isConfigured() && pagePath ? 'המוצר נשמר ומוצג בעמוד תוך דקה.' : 'המוצר נשמר.');
    }
    if (action === 'toggle' && id) {
      await q('UPDATE products SET active = NOT active, updated_at = now() WHERE id = $1', [id]);
      publishChanges();
    }
    if (action === 'delete' && id) {
      // Products that were sold stay, for the sales history (they can be switched off)
      await q(`DELETE FROM products WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM orders WHERE product_id = $1 AND status = 'paid')`, [id]);
      publishChanges();
      await logActivity(ctx, 'מחק מוצר');
    }
    return redirect('/admin/products/');
  },
};

/* ========================================================= payment links */

const LINK_STATE = { ok: 'פעיל', inactive: 'כבוי', expired: 'פג תוקף', used: 'נוצל' };

export const payLinks = {
  async GET(ctx) {
    const editParam = ctx.query.get('edit');
    if (editParam !== null) {
      const id = parseInt(editParam, 10) || 0;
      const l = (id && (await one('SELECT * FROM payment_links WHERE id = $1', [id])))
        || { id: 0, token: newLinkToken(), title: '', description: '', amount_agorot: '', max_payments: 1, max_uses: null, expires_at: null, ravmesser_list: '', internal_note: '', active: true };
      const expires = l.expires_at ? new Date(l.expires_at).toISOString().slice(0, 10) : '';
      const body = `<p class="back"><a href="/admin/pay-links/">חזרה לכל הקישורים</a></p>${setupNotice()}
<form method="post" class="panel stack narrow-form" data-track-changes>${csrfField(ctx)}<input type="hidden" name="action" value="save"><input type="hidden" name="id" value="${l.id}">
  <label>על מה משלמים <input name="title" value="${esc(l.title)}" required maxlength="120" placeholder="למשל: דמי הרשמה לקורס התמקדות">
    <small>מופיע בעמוד התשלום ובחשבונית.</small></label>
  <div class="two">
    <label>סכום (₪) <input name="amount" value="${l.amount_agorot === '' ? '' : esc(String(l.amount_agorot / 100))}" required inputmode="decimal" dir="ltr"></label>
    <label>עד כמה תשלומים <input name="max_payments" type="number" min="1" max="36" value="${esc(l.max_payments)}" required dir="ltr"></label>
  </div>
  <label>הסבר קצר (לא חובה) <textarea name="description" rows="2" maxlength="400">${esc(l.description)}</textarea></label>
  <div class="two">
    <label>כמה פעמים אפשר לשלם דרכו <input name="max_uses" type="number" min="1" value="${l.max_uses ?? ''}" placeholder="ללא הגבלה" dir="ltr">
      <small>להנחה אישית: 1. לדמי הרשמה לכולם: ריק.</small></label>
    <label>בתוקף עד (לא חובה) <input name="expires" type="date" value="${esc(expires)}" dir="ltr"></label>
  </div>
  <label>מזהה הקישור <input name="token" value="${esc(l.token)}" required pattern="[a-z0-9\\-]{4,40}" maxlength="40" dir="ltr">
    <small>מה שמופיע בכתובת. נוצר אקראית כדי שאי אפשר יהיה לנחש קישור של הנחה.</small></label>
  <label>מזהה רשימה ברב־מסר (לא חובה) <input name="ravmesser_list" value="${esc(l.ravmesser_list)}" dir="ltr" maxlength="120"></label>
  <label>הערה פנימית (לא חובה) <input name="internal_note" value="${esc(l.internal_note)}" maxlength="200"><small>רק בשבילך, למשל למי נשלח.</small></label>
  <label class="check"><input type="checkbox" name="active" value="1"${l.active ? ' checked' : ''}> הקישור פעיל</label>
  <button class="btn" type="submit">שמירה</button>
</form>`;
      return html(await adminPage(ctx, { title: l.id ? 'עריכת קישור תשלום' : 'קישור תשלום חדש', active: 'pay-links', body }));
    }
    const list = await q(`SELECT l.*, (SELECT count(*)::int FROM orders o WHERE o.payment_link_id = l.id AND o.status = 'paid') AS paid
      FROM payment_links l ORDER BY l.created_at DESC`);
    const body = `${setupNotice()}<p class="muted">גבייה בלי מוצר ובלי עמוד: דמי הרשמה, מקדמה, או מחיר מוסכם ללקוחה אחת. יוצרים קישור ושולחים אותו בוואטסאפ או במייל.</p>
${list.length ? `<div class="table-wrap"><table class="table">
  <thead><tr><th>על מה</th><th>סכום</th><th>שולם</th><th>תוקף</th><th>מצב</th><th>קישור</th><th></th></tr></thead><tbody>
  ${list.map((l) => {
    const state = linkState(l, l.paid);
    return `<tr><td><a href="?edit=${l.id}">${esc(l.title)}</a>${l.internal_note ? `<br><span class="muted small">${esc(l.internal_note)}</span>` : ''}</td>
    <td class="nowrap">${shekels(l.amount_agorot)} ₪${l.max_payments > 1 ? `<br><span class="muted small">עד ${l.max_payments} תשלומים</span>` : ''}</td>
    <td>${l.paid}${l.max_uses != null ? ` מתוך ${l.max_uses}` : ''}</td>
    <td class="nowrap">${l.expires_at ? esc(heDate(l.expires_at, false)) : 'ללא הגבלה'}</td>
    <td><span class="tag${state.ok ? ' tag--ok' : ' tag--closed'}">${LINK_STATE[state.reason] || ''}</span></td>
    <td><button type="button" class="btn btn--quiet btn--sm" data-copy="/pay/${esc(l.token)}/">העתקת קישור</button></td>
    <td class="nowrap"><a href="?edit=${l.id}">עריכה</a>
      <form method="post" class="inline">${csrfField(ctx)}<input type="hidden" name="id" value="${l.id}"><button class="linklike small" name="action" value="toggle">${l.active ? 'כיבוי' : 'הפעלה'}</button></form>
      <form method="post" class="inline" data-confirm="למחוק את הקישור? תשלומים שכבר בוצעו נשארים במכירות.">${csrfField(ctx)}<input type="hidden" name="id" value="${l.id}"><button class="linklike linklike--danger small" name="action" value="delete">מחיקה</button></form></td></tr>`;
  }).join('')}
  </tbody></table></div>` : '<p class="empty">עוד אין קישורי תשלום.</p>'}`;
    return html(await adminPage(ctx, { title: 'קישורי תשלום', active: 'pay-links', body, actions: '<a class="btn" href="/admin/pay-links/?edit=0">קישור תשלום חדש</a>' }));
  },

  async POST(ctx) {
    const action = String(ctx.form.get('action') || '');
    const id = parseInt(ctx.form.get('id'), 10) || 0;
    const f = (k, n = 240) => String(ctx.form.get(k) || '').trim().slice(0, n);
    if (action === 'save') {
      const back = (msg) => redirect(`/admin/pay-links/?edit=${id}`, msg, 'error');
      const title = f('title', 120);
      const amount = parseShekels(f('amount', 20));
      const maxPayments = parseInt(f('max_payments', 3), 10);
      const maxUses = f('max_uses', 6) ? parseInt(f('max_uses', 6), 10) : null;
      const expires = f('expires', 10);
      const token = f('token', 40).toLowerCase();
      if (!title) return back('חסר תיאור של מה משלמים.');
      if (!amount || amount < 100) return back('הסכום צריך להיות מספר בשקלים, למשל 350.');
      if (!(maxPayments >= 1 && maxPayments <= 36)) return back('מספר התשלומים צריך להיות בין 1 ל־36.');
      if (maxUses !== null && !(maxUses >= 1)) return back('מספר הפעמים צריך להיות 1 או יותר, או ריק.');
      if (expires && !/^\d{4}-\d{2}-\d{2}$/.test(expires)) return back('התאריך לא תקין.');
      if (!/^[a-z0-9-]{4,40}$/.test(token)) return back('מזהה הקישור: 4–40 אותיות אנגליות קטנות, ספרות או מקף.');
      if (await one('SELECT 1 FROM payment_links WHERE token = $1 AND id <> $2', [token, id])) return back('יש כבר קישור עם המזהה הזה.');
      // Valid through the end of the chosen day, Israel time
      const expiresAt = expires ? new Date(`${expires}T23:59:59+03:00`).toISOString() : null;
      const vals = [token, title, f('description', 400), amount, maxPayments, maxUses, expiresAt, f('ravmesser_list', 120).replace(/\s/g, ''), f('internal_note', 200), !!ctx.form.get('active')];
      if (id) {
        await q(`UPDATE payment_links SET token=$1, title=$2, description=$3, amount_agorot=$4, max_payments=$5, max_uses=$6, expires_at=$7,
          ravmesser_list=$8, internal_note=$9, active=$10, updated_at=now() WHERE id=$11`, [...vals, id]);
      } else {
        await q(`INSERT INTO payment_links(token, title, description, amount_agorot, max_payments, max_uses, expires_at, ravmesser_list, internal_note, active)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, vals);
      }
      await logActivity(ctx, id ? 'עדכן קישור תשלום' : 'יצר קישור תשלום', title, '/admin/pay-links/');
      return redirect('/admin/pay-links/', `הקישור נשמר: ${ctx.url.origin}/pay/${token}/`);
    }
    if (action === 'toggle' && id) await q('UPDATE payment_links SET active = NOT active, updated_at = now() WHERE id = $1', [id]);
    if (action === 'delete' && id) {
      await q('DELETE FROM payment_links WHERE id = $1', [id]);
      await logActivity(ctx, 'מחק קישור תשלום');
    }
    return redirect('/admin/pay-links/');
  },
};
