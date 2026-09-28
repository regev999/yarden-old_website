import { q, one } from '../../db';
import { LEAD_SOURCES, LEAD_STATUSES } from '../../leads';
import { adminPage, csrfField, esc, heDate, html, qs, redirect, SECURITY_HEADERS } from '../ui';

function filters(query) {
  const status = query.get('status') in LEAD_STATUSES ? query.get('status') : '';
  const source = query.get('source') in LEAD_SOURCES ? query.get('source') : '';
  const text = (query.get('q') || '').trim();
  const where = [];
  const args = [];
  if (status) { args.push(status); where.push(`status = $${args.length}`); }
  if (source) { args.push(source); where.push(`coalesce(product, kind) = $${args.length}`); }
  if (text) {
    args.push('%' + text.replace(/[\\%_]/g, '\\$&') + '%');
    where.push(`(name ILIKE $${args.length} OR phone ILIKE $${args.length} OR email ILIKE $${args.length} OR message ILIKE $${args.length} OR notes ILIKE $${args.length})`);
  }
  return { status, source, text, where: where.length ? ' WHERE ' + where.join(' AND ') : '', args };
}

const option = (k, label, cur) => `<option value="${esc(k)}"${k === cur ? ' selected' : ''}>${esc(label)}</option>`;

export const list = {
  async GET(ctx) {
    const f = filters(ctx.query);
    const leads = await q(`SELECT * FROM leads${f.where} ORDER BY created_at DESC LIMIT 500`, f.args);
    const query = qs({ status: f.status, source: f.source, q: f.text });
    const table = !leads.length
      ? `<p class="empty">${f.where ? 'אין לידים שמתאימים לסינון.' : 'עוד לא הגיעו לידים. כשמישהו ימלא טופס באתר, הוא יופיע כאן.'}</p>`
      : `<div class="table-wrap"><table class="table">
      <thead><tr><th>תאריך</th><th>שם</th><th>טלפון</th><th>מייל</th><th>מקור</th><th>סטטוס</th></tr></thead><tbody>
      ${leads.map((l) => {
        const href = `/admin/lead/?id=${l.id}`;
        return `<tr data-href="${href}"><td class="nowrap">${esc(heDate(l.created_at))}</td>
          <td><a href="${href}">${esc(l.name || 'ללא שם')}</a></td>
          <td dir="ltr" class="nowrap">${l.phone ? `<a href="tel:${esc(l.phone.replace(/[^\d+]/g, ''))}">${esc(l.phone)}</a>` : ''}</td>
          <td dir="ltr">${l.email ? `<a href="mailto:${esc(l.email)}">${esc(l.email)}</a>` : ''}</td>
          <td>${esc(LEAD_SOURCES[l.product || l.kind] || '')}</td>
          <td><span class="tag tag--${esc(l.status)}">${esc(LEAD_STATUSES[l.status] || l.status)}</span></td></tr>`;
      }).join('')}</tbody></table></div>
      <p class="muted">${leads.length} לידים${leads.length === 500 ? ' (מוצגים 500 האחרונים)' : ''}</p>`;
    const body = `<form class="filters" method="get">
  <label>סטטוס <select name="status" data-autosubmit><option value="">הכל</option>${Object.entries(LEAD_STATUSES).map(([k, v]) => option(k, v, f.status)).join('')}</select></label>
  <label>מקור <select name="source" data-autosubmit><option value="">הכל</option>${Object.entries(LEAD_SOURCES).map(([k, v]) => option(k, v, f.source)).join('')}</select></label>
  <label class="filters__search">חיפוש <input type="search" name="q" value="${esc(f.text)}" placeholder="שם, טלפון, מייל או מילה מההודעה"></label>
  <button class="btn btn--quiet" type="submit">סינון</button>
  <a class="filters__export" href="/admin/export/${esc(query)}">הורדה לאקסל (CSV)</a>
</form>${table}`;
    return html(await adminPage(ctx, { title: 'לידים', active: 'leads', body }));
  },
};

async function getLead(ctx) {
  const id = parseInt(ctx.query.get('id') || ctx.form?.get('id') || '0', 10);
  return id ? one('SELECT * FROM leads WHERE id = $1', [id]) : null;
}

export const oneLead = {
  async GET(ctx) {
    const lead = await getLead(ctx);
    if (!lead) return redirect('/admin/leads/', 'הליד לא נמצא.', 'error');
    const digits = lead.phone.replace(/\D/g, '');
    const wa = digits ? 'https://wa.me/' + (digits.startsWith('0') ? '972' + digits.slice(1) : digits) : '';
    const body = `<p class="back"><a href="/admin/leads/">חזרה לרשימת הלידים</a></p>
<div class="lead-layout">
  <section class="panel">
    <dl class="facts">
      <dt>התקבל</dt><dd>${esc(heDate(lead.created_at))}</dd>
      <dt>מקור</dt><dd>${esc(LEAD_SOURCES[lead.product || lead.kind] || '')}</dd>
      ${lead.phone ? `<dt>טלפון</dt><dd dir="ltr">${esc(lead.phone)}</dd>` : ''}
      ${lead.email ? `<dt>מייל</dt><dd dir="ltr">${esc(lead.email)}</dd>` : ''}
      ${lead.page ? `<dt>נשלח מהעמוד</dt><dd><a href="${esc(lead.page)}" target="_blank" rel="noopener">${esc(lead.page === '/' ? 'דף הבית' : lead.page.replace(/^\/|\/$/g, ''))}</a></dd>` : ''}
    </dl>
    ${lead.message ? `<h2>ההודעה</h2><p class="message">${esc(lead.message).replace(/\n/g, '<br>')}</p>` : ''}
    <div class="actions">
      ${lead.phone ? `<a class="btn" href="tel:${esc(digits)}">חיוג</a><a class="btn btn--quiet" href="${esc(wa)}" target="_blank" rel="noopener">וואטסאפ</a>` : ''}
      ${lead.email ? `<a class="btn btn--quiet" href="mailto:${esc(lead.email)}">שליחת מייל</a>` : ''}
    </div>
  </section>
  <section class="panel">
    <form method="post" class="stack">${csrfField(ctx)}<input type="hidden" name="id" value="${lead.id}">
      <fieldset class="status-pick"><legend>סטטוס</legend>
        ${Object.entries(LEAD_STATUSES).map(([k, v]) => `<label><input type="radio" name="status" value="${esc(k)}"${k === lead.status ? ' checked' : ''}> ${esc(v)}</label>`).join('')}
      </fieldset>
      <label>הערות שלי <textarea name="notes" rows="6" placeholder="למשל: דיברנו ביום ראשון, מעוניינת בפגישה בזום">${esc(lead.notes)}</textarea></label>
      <button class="btn" type="submit">שמירה</button>
    </form>
    <form method="post" class="danger-zone" data-confirm="למחוק את הליד לצמיתות?">${csrfField(ctx)}
      <input type="hidden" name="id" value="${lead.id}"><input type="hidden" name="action" value="delete">
      <button type="submit" class="linklike linklike--danger">מחיקת הליד</button>
    </form>
  </section>
</div>`;
    // Opening a new lead marks it as seen only when its status is changed by hand.
    return html(await adminPage(ctx, { title: lead.name || 'ליד ללא שם', active: 'leads', body }));
  },
  async POST(ctx) {
    const lead = await getLead(ctx);
    if (!lead) return redirect('/admin/leads/', 'הליד לא נמצא.', 'error');
    if (ctx.form.get('action') === 'delete') {
      await q('DELETE FROM leads WHERE id = $1', [lead.id]);
      return redirect('/admin/leads/', 'הליד נמחק.');
    }
    const status = ctx.form.get('status') in LEAD_STATUSES ? ctx.form.get('status') : lead.status;
    const notes = String(ctx.form.get('notes') || '').slice(0, 10000);
    await q('UPDATE leads SET status = $1, notes = $2, updated_at = now() WHERE id = $3', [status, notes, lead.id]);
    return redirect(`/admin/lead/?id=${lead.id}`, 'השינויים נשמרו.');
  },
};

export const exportCsv = {
  async GET(ctx) {
    const f = filters(ctx.query);
    const rows = await q(`SELECT * FROM leads${f.where} ORDER BY created_at DESC`, f.args);
    // Cells that start with = + - @ would run as formulas in Excel; prefix them.
    const cell = (v) => {
      let s = String(v ?? '');
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [['תאריך', 'שם', 'טלפון', 'מייל', 'מקור', 'סטטוס', 'הודעה', 'הערות', 'עמוד']];
    for (const l of rows) {
      lines.push([heDate(l.created_at), l.name, l.phone, l.email, LEAD_SOURCES[l.product || l.kind] || '', LEAD_STATUSES[l.status] || l.status, l.message, l.notes, l.page]);
    }
    const csv = '﻿' + lines.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
    const day = new Date().toISOString().slice(0, 10);
    return new Response(csv, { headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="leads-${day}.csv"` } });
  },
};
