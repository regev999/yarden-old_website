/** 301 redirects manager and the list of addresses visitors reached that don't exist (404). */
import { q, one } from '../../db';
import { findRedirect, normalizeSource, pathExists, saveRedirect, smartRedirect } from '../../redirects';
import { adminPage, csrfField, esc, heDate, html, pager, qs, redirect } from '../ui';
import { logActivity, publishChanges } from '../common';

const PER_PAGE = 50;
const show = (p) => { try { return decodeURI(p); } catch { return p; } };

function form(ctx, r = {}) {
  const editing = !!r.id;
  return `<form method="post" class="panel stack" id="redirect-form">${csrfField(ctx)}
  <input type="hidden" name="action" value="save"><input type="hidden" name="id" value="${r.id || ''}">
  <h2>${editing ? 'עריכת הפניה' : 'הפניה חדשה'}</h2>
  <div class="redirect-fields">
    <label>מהכתובת <input name="from" value="${esc(show(r.source || ''))}" required dir="ltr" placeholder="/כתובת-ישנה/"></label>
    <label>אל <input name="to" value="${esc(show(r.target || ''))}" required dir="ltr" placeholder="/כתובת-חדשה/ או https://…"></label>
  </div>
  <label>הערה (לא חובה) <input name="note" value="${esc(r.note || '')}" placeholder="למשל: עמוד שהוחלף"></label>
  <p class="muted small">אפשר להדביק כתובת מלאה מהדפדפן. אם היעד עצמו כבר מופנה הלאה, ההפניה תישמר ישר ליעד הסופי (בלי שרשרת).</p>
  <div class="actions"><button class="btn" type="submit">${editing ? 'שמירה' : 'הוספת הפניה'}</button>${editing ? '<a class="btn btn--quiet" href="/admin/redirects/">ביטול</a>' : ''}</div>
</form>`;
}

export const page = {
  async GET(ctx) {
    const tab = ctx.query.get('tab') === '404' ? '404' : 'redirects';
    const text = (ctx.query.get('q') || '').trim();
    const pageNo = Math.max(1, parseInt(ctx.query.get('p') || '1', 10) || 1);
    const edit = ctx.query.get('edit') ? await one('SELECT * FROM redirects WHERE id = $1', [parseInt(ctx.query.get('edit'), 10) || 0]) : null;
    const prefill = ctx.query.get('from') ? { source: normalizeSource(ctx.query.get('from')) } : {};
    const { n: total } = await one('SELECT count(*)::int AS n FROM redirects');
    const { n: nf } = await one(`SELECT count(*)::int AS n FROM notfound`);

    // Test an address: where does it lead today?
    let testHtml = '';
    const test = (ctx.query.get('test') || '').trim();
    if (test) {
      const src = normalizeSource(test);
      const [path, query = ''] = src.split(/\?(.*)/s);
      const r = await findRedirect(path, query);
      let result;
      if (r) result = `מופנית (301) אל <a href="${esc(r.target)}" target="_blank" rel="noopener" dir="ltr">${esc(show(r.target))}</a>`;
      else if (await pathExists(path)) result = 'עמוד קיים באתר (200)';
      else {
        const s = await smartRedirect(path);
        result = s ? `מופנית אוטומטית (301) אל <span dir="ltr">${esc(show(s))}</span>` : '<span class="warn">לא קיימת (404)</span> · <a href="/admin/redirects/' + esc(qs({ from: path })) + '#redirect-form">יצירת הפניה</a>';
      }
      testHtml = `<p class="notice notice--ok"><span dir="ltr">${esc(show(src))}</span>: ${result}</p>`;
    }

    let list;
    if (tab === '404') {
      const rows = await q(`SELECT * FROM notfound ORDER BY last_seen DESC LIMIT 300`);
      list = !rows.length ? '<p class="empty">אין כרגע כתובות שבורות. כשמישהו יגיע לכתובת שלא קיימת באתר, היא תופיע כאן.</p>'
        : `<p class="muted">כתובות שגולשים (או גוגל) ניסו לפתוח ולא נמצאו. כדאי להפנות את מה שחוזר על עצמו לעמוד המתאים. אחרי יצירת הפניה, הכתובת יורדת מהרשימה.</p>
<form method="post" class="inline-form" data-confirm="לנקות את כל הרשימה?">${csrfField(ctx)}<input type="hidden" name="action" value="clear404"><button class="linklike small" type="submit">ניקוי הרשימה</button></form>
<div class="table-wrap"><table class="table"><thead><tr><th>כתובת</th><th>פעמים</th><th>לאחרונה</th><th>הגיעו מ־</th><th></th></tr></thead><tbody>
${rows.map((r) => `<tr><td dir="ltr" class="small">${esc(show(r.path))}</td><td>${r.hits}</td><td class="nowrap small">${esc(heDate(r.last_seen))}</td>
  <td class="small clip" dir="ltr">${esc(r.referrer ? show(r.referrer) : '')}</td>
  <td class="nowrap small"><a href="/admin/redirects/${esc(qs({ from: r.path }))}#redirect-form">הפניה</a> ·
  <form method="post" class="inline">${csrfField(ctx)}<input type="hidden" name="action" value="ignore404"><input type="hidden" name="path" value="${esc(r.path)}"><button class="linklike small" type="submit">הסרה</button></form></td></tr>`).join('')}
</tbody></table></div>`;
    } else {
      const like = '%' + text.replace(/[\\%_]/g, '\\$&') + '%';
      const where = text ? 'WHERE source ILIKE $1 OR target ILIKE $1 OR note ILIKE $1' : '';
      const args = text ? [like] : [];
      const { n: count } = await one(`SELECT count(*)::int AS n FROM redirects ${where}`, args);
      const pages = Math.max(1, Math.ceil(count / PER_PAGE));
      const rows = await q(`SELECT * FROM redirects ${where} ORDER BY created_at DESC, id DESC LIMIT ${PER_PAGE} OFFSET ${(Math.min(pageNo, pages) - 1) * PER_PAGE}`, args);
      list = `<form class="filters" method="get"><label class="filters__search">חיפוש בהפניות <input type="search" name="q" value="${esc(text)}" placeholder="כתובת או הערה"></label><button class="btn btn--quiet" type="submit">חיפוש</button></form>
${!rows.length ? '<p class="empty">לא נמצאו הפניות.</p>' : `<div class="table-wrap"><table class="table"><thead><tr><th>מ־</th><th>אל</th><th>הערה</th><th>שימושים</th><th></th></tr></thead><tbody>
${rows.map((r) => `<tr><td dir="ltr" class="small">${esc(show(r.source))}</td><td dir="ltr" class="small"><a href="${esc(r.target)}" target="_blank" rel="noopener">${esc(show(r.target))}</a></td>
  <td class="small">${esc(r.note)}</td><td class="small nowrap">${r.hits}${r.last_hit ? ` · ${esc(heDate(r.last_hit, false))}` : ''}</td>
  <td class="nowrap small"><a href="/admin/redirects/${esc(qs({ edit: r.id }))}#redirect-form">עריכה</a> ·
  <form method="post" class="inline" data-confirm="למחוק את ההפניה? קישורים לכתובת הישנה יפסיקו לעבוד.">${csrfField(ctx)}<input type="hidden" name="action" value="delete"><input type="hidden" name="id" value="${r.id}"><button class="linklike linklike--danger small" type="submit">מחיקה</button></form></td></tr>`).join('')}
</tbody></table></div>`}
${pager(Math.min(pageNo, pages), pages, { q: text })}
<p class="muted small">${count} הפניות, כולל ההפניות שהוקמו אוטומטית מכל הכתובות הישנות של וורדפרס (‎?p=, ‎?page_id=, עמודי קבצים מצורפים ועוד).</p>`;
    }

    const body = `<section class="summary summary--3">
  <a class="summary__item" href="/admin/redirects/"><b>${total}</b><span>הפניות 301 פעילות</span></a>
  <a class="summary__item${nf ? ' is-warn' : ''}" href="/admin/redirects/?tab=404"><b>${nf}</b><span>כתובות שלא נמצאו (404)</span></a>
  <a class="summary__item" href="/admin/links/"><b>קישורים</b><span>בדיקת קישורים שבורים בתוך האתר</span></a>
</section>
<form class="filters" method="get"><label class="filters__search">בדיקת כתובת: לאן היא מובילה היום? <input type="search" name="test" value="${esc(test)}" dir="ltr" placeholder="/?p=123 או https://www.yardenkerem.co.il/…"></label><button class="btn btn--quiet" type="submit">בדיקה</button></form>
${testHtml}
<div class="redirects-layout">
  <div>
    <nav class="tabs" aria-label="תצוגה"><a href="/admin/redirects/"${tab === 'redirects' ? ' aria-current="page"' : ''}>הפניות <span>${total}</span></a><a href="/admin/redirects/?tab=404"${tab === '404' ? ' aria-current="page"' : ''}>לא נמצאו (404) <span>${nf}</span></a></nav>
    ${list}
  </div>
  <div class="stack">
    ${form(ctx, edit || prefill)}
    <details class="panel"><summary><b>הוספה מרובה</b> · הדבקת רשימה</summary>
      <form method="post" class="stack">${csrfField(ctx)}<input type="hidden" name="action" value="bulk">
        <label>שורה לכל הפניה: כתובת ישנה, רווח או פסיק, כתובת חדשה
          <textarea name="lines" rows="6" dir="ltr" placeholder="/old-page/ /new-page/"></textarea></label>
        <button class="btn btn--quiet" type="submit">הוספת כולן</button>
      </form></details>
  </div>
</div>`;
    return html(await adminPage(ctx, { title: 'הפניות 301 ו־404', active: 'redirects', body }));
  },

  async POST(ctx) {
    const f = (k) => String(ctx.form.get(k) || '');
    const action = f('action');
    if (action === 'save') {
      const id = parseInt(f('id'), 10) || null;
      const err = await saveRedirect(f('from'), f('to'), f('note').trim().slice(0, 200), id);
      if (err) return redirect('/admin/redirects/' + qs({ edit: id || '', from: id ? '' : f('from') }) + '#redirect-form', err, 'error');
      publishChanges();
      await logActivity(ctx, id ? 'עדכן הפניה' : 'הוסיף הפניה', normalizeSource(f('from')), '/admin/redirects/');
      return redirect('/admin/redirects/', 'ההפניה נשמרה ופעילה תוך דקה.');
    }
    if (action === 'delete') {
      const r = await one('DELETE FROM redirects WHERE id = $1 RETURNING source', [parseInt(f('id'), 10) || 0]);
      if (r) { publishChanges(); await logActivity(ctx, 'מחק הפניה', r.source); }
      return redirect('/admin/redirects/', 'ההפניה נמחקה.');
    }
    if (action === 'bulk') {
      let ok = 0;
      const errors = [];
      for (const line of f('lines').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 500)) {
        const [from, to] = line.split(/[\s,\t]+/);
        const err = to ? await saveRedirect(from, to, 'הוספה מרובה') : 'חסר יעד';
        if (err) errors.push(`${from}: ${err}`); else ok++;
      }
      if (ok) { publishChanges(); await logActivity(ctx, `הוסיף ${ok} הפניות`); }
      return redirect('/admin/redirects/', `נוספו ${ok} הפניות.${errors.length ? ` ${errors.length} לא נוספו: ${errors.slice(0, 3).join(' · ')}` : ''}`, errors.length && !ok ? 'error' : 'ok');
    }
    if (action === 'ignore404') {
      await q('DELETE FROM notfound WHERE path = $1', [f('path')]);
      return redirect('/admin/redirects/?tab=404');
    }
    if (action === 'clear404') {
      await q('DELETE FROM notfound');
      return redirect('/admin/redirects/?tab=404', 'הרשימה נוקתה.');
    }
    return redirect('/admin/redirects/');
  },
};
