/** Newsletter: everyone who signed up on the site, and whether they reached the Rav-Messer list. */
import { q, one } from '../../db';
import { isConfigured as ravmesserReady } from '../../ravmesser';
import { LIST_STATUSES, listId, sendToList } from '../../newsletter';
import { adminPage, csrfField, esc, heDate, html, pager, qs, redirect, SECURITY_HEADERS } from '../ui';
import { csvRow, logActivity } from '../common';

const TAGS = { sent: 'ok', failed: 'fail', waiting: 'closed' };

function filters(query) {
  const status = query.get('status') in LIST_STATUSES ? query.get('status') : '';
  const text = (query.get('q') || '').trim();
  const where = [];
  const args = [];
  if (status) { args.push(status); where.push(`list_status = $${args.length}`); }
  if (text) {
    args.push('%' + text.replace(/[\\%_]/g, '\\$&') + '%');
    where.push(`(email ILIKE $${args.length} OR name ILIKE $${args.length})`);
  }
  return { status, text, where: where.length ? ' WHERE ' + where.join(' AND ') : '', args };
}

const pageLink = (p) => (/^\/(?![/\\])/.test(p || '') ? `<a href="${esc(p)}" target="_blank" rel="noopener">${esc(p === '/' ? 'דף הבית' : p.replace(/^\/|\/$/g, ''))}</a>` : '');

export const list = {
  async GET(ctx) {
    const f = filters(ctx.query);
    const PER = 100;
    const [list, connected, counts] = await Promise.all([
      listId(), ravmesserReady(),
      one(`SELECT count(*)::int AS total, count(*) FILTER (WHERE list_status <> 'sent')::int AS unsent FROM subscribers`),
    ]);
    const total = f.where ? (await one(`SELECT count(*)::int AS n FROM subscribers${f.where}`, f.args)).n : counts.total;
    const pages = Math.max(1, Math.ceil(total / PER));
    const pageNo = Math.min(pages, Math.max(1, parseInt(ctx.query.get('p') || '1', 10) || 1));
    const rows = await q(`SELECT * FROM subscribers${f.where} ORDER BY created_at DESC LIMIT ${PER} OFFSET ${(pageNo - 1) * PER}`, f.args);

    let state;
    if (!connected) state = `<p class="notice notice--warn">רב־מסר עוד לא מחובר, כך שהנרשמים נשמרים כאן בלבד. <a href="/admin/connections/#ravmesser">לחיבור רב־מסר</a></p>`;
    else if (!list) state = `<p class="notice notice--warn">עוד לא נבחרה רשימה ברב־מסר, כך שהנרשמים נשמרים כאן בלבד. <a href="/admin/settings/#newsletter">לבחירת הרשימה</a></p>`;
    else state = `<p class="muted">כל מי שנרשם בטופס שבתחתית האתר נכנס לרשימה <b dir="ltr">${esc(list.split(',').join(', '))}</b> ברב־מסר. <a href="/admin/settings/#newsletter">שינוי הרשימה</a></p>`;
    const sync = connected && list && counts.unsent
      ? `<form method="post" class="inline-form">${csrfField(ctx)}<input type="hidden" name="action" value="sync">
        <button class="btn btn--quiet" type="submit">הוספת ${counts.unsent} שעוד לא נוספו לרב־מסר</button></form>` : '';

    const table = !rows.length
      ? `<p class="empty">${f.where ? 'אין נרשמים שמתאימים לסינון.' : 'עוד אין נרשמים. כשמישהו יירשם בטופס שבתחתית האתר, הוא יופיע כאן.'}</p>`
      : `<div class="table-wrap"><table class="table">
      <thead><tr><th>תאריך</th><th>שם</th><th>מייל</th><th>רב־מסר</th><th>נרשם בעמוד</th><th><span class="sr-only">פעולות</span></th></tr></thead><tbody>
      ${rows.map((s) => `<tr><td class="nowrap">${esc(heDate(s.created_at))}</td>
          <td>${esc(s.name)}</td>
          <td dir="ltr"><a href="mailto:${esc(s.email)}">${esc(s.email)}</a></td>
          <td><span class="tag tag--${TAGS[s.list_status] || 'closed'}"${s.list_error ? ` title="${esc(s.list_error)}"` : ''}>${esc(LIST_STATUSES[s.list_status] || s.list_status)}</span></td>
          <td>${pageLink(s.page)}</td>
          <td><form method="post" class="inline" data-confirm="להסיר את ${esc(s.email)} מהרשימה באתר? (ברב־מסר הוא נשאר)">${csrfField(ctx)}
            <input type="hidden" name="id" value="${s.id}"><button class="linklike linklike--danger small" name="action" value="delete">הסרה</button></form></td></tr>`).join('')}
      </tbody></table></div>
      ${pager(pageNo, pages, { status: f.status, q: f.text })}
      <p class="muted">${total} נרשמים</p>`;
    const body = `${state}
<form class="filters" method="get">
  <label>רב־מסר <select name="status" data-autosubmit><option value="">הכל</option>${Object.entries(LIST_STATUSES).map(([k, v]) => `<option value="${esc(k)}"${k === f.status ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
  <label class="filters__search">חיפוש <input type="search" name="q" value="${esc(f.text)}" placeholder="שם או מייל"></label>
  <button class="btn btn--quiet" type="submit">סינון</button>
  <a class="filters__export" href="/admin/newsletter-export/${esc(qs({ status: f.status, q: f.text }))}">הורדה לאקסל (CSV)</a>
</form>${table}`;
    return html(await adminPage(ctx, { title: 'ניוזלטר', active: 'newsletter', body, actions: sync }));
  },

  async POST(ctx) {
    const action = String(ctx.form.get('action') || '');
    if (action === 'delete') {
      const s = await one('DELETE FROM subscribers WHERE id = $1 RETURNING email', [parseInt(ctx.form.get('id'), 10) || 0]);
      if (s) await logActivity(ctx, 'הסיר נרשם לניוזלטר', s.email, '/admin/newsletter/');
      return redirect('/admin/newsletter/', s ? `${s.email} הוסר מהרשימה באתר.` : 'הנרשם לא נמצא.', s ? 'ok' : 'error');
    }
    if (action === 'sync') {
      const list = await listId();
      if (!list || !(await ravmesserReady())) return redirect('/admin/newsletter/', 'צריך לחבר את רב־מסר ולבחור רשימה לפני השליחה.', 'error');
      // A few at a time, and only as many as fit in one request; the button stays for the rest
      const started = Date.now();
      let sent = 0;
      let failed = 0;
      let lastError = '';
      const rows = await q(`SELECT * FROM subscribers WHERE list_status <> 'sent' ORDER BY created_at LIMIT 60`);
      for (let i = 0; i < rows.length && Date.now() - started < 18_000; i += 5) {
        const results = await Promise.all(rows.slice(i, i + 5).map((r) => sendToList(r, list)));
        for (const r of results) { if (r.ok) sent++; else { failed++; lastError = r.error || lastError; } }
      }
      const left = (await one(`SELECT count(*)::int AS n FROM subscribers WHERE list_status <> 'sent'`)).n;
      if (sent) await logActivity(ctx, 'הוסיף נרשמים לרב־מסר', String(sent), '/admin/newsletter/');
      const msg = [sent && `${sent} נוספו לרב־מסר.`, failed && `${failed} לא נוספו: ${lastError}`, left && !failed && `נותרו ${left}, לחצו שוב להמשך.`].filter(Boolean).join(' ');
      return redirect('/admin/newsletter/', msg || 'אין נרשמים שממתינים.', failed ? 'error' : 'ok');
    }
    return redirect('/admin/newsletter/');
  },
};

export const exportCsv = {
  async GET(ctx) {
    const f = filters(ctx.query);
    const rows = await q(`SELECT * FROM subscribers${f.where} ORDER BY created_at DESC`, f.args);
    const lines = [['תאריך', 'שם', 'מייל', 'רב־מסר', 'רשימה', 'נרשם בעמוד']];
    for (const s of rows) lines.push([heDate(s.created_at), s.name, s.email, LIST_STATUSES[s.list_status] || s.list_status, s.list_id, s.page]);
    const csv = '﻿' + lines.map(csvRow).join('\r\n') + '\r\n';
    const day = new Date().toISOString().slice(0, 10);
    return new Response(csv, { headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="newsletter-${day}.csv"` } });
  },
};
