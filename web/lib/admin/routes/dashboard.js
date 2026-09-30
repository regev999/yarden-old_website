import { q, one } from '../../db';
import { LEAD_SOURCES, LEAD_STATUSES } from '../../leads';
import { seoRows } from '../seodata';
import { adminPage, esc, heDate, html, wallDate } from '../ui';

const n = async (sql, p = []) => (await one(sql, p)).n;

export const home = {
  async GET(ctx) {
    const [newLeads, week, month, posts, drafts, testimonials, notFound] = await Promise.all([
      n(`SELECT count(*)::int AS n FROM leads WHERE status = 'new'`),
      n(`SELECT count(*)::int AS n FROM leads WHERE created_at >= date_trunc('day', now()) - interval '6 days'`),
      n(`SELECT count(*)::int AS n FROM leads WHERE created_at >= date_trunc('month', now())`),
      n(`SELECT count(*)::int AS n FROM posts WHERE status = 'published'`),
      n(`SELECT count(*)::int AS n FROM posts WHERE status = 'draft'`),
      n('SELECT count(*)::int AS n FROM testimonials WHERE published'),
      n(`SELECT count(*)::int AS n FROM notfound WHERE last_seen > now() - interval '30 days'`),
    ]);
    const issues = (await seoRows()).filter((r) => r.issues.length).length;
    const latest = await q('SELECT * FROM leads ORDER BY created_at DESC LIMIT 6');
    const activity = await q('SELECT * FROM activity ORDER BY id DESC LIMIT 8');
    const lastPost = await one(`SELECT title, date FROM posts WHERE status = 'published' ORDER BY date DESC LIMIT 1`);
    const weeks = await q(`SELECT to_char(w, 'DD.MM') AS label, (SELECT count(*)::int FROM leads WHERE created_at >= w AND created_at < w + interval '7 days') AS n
                           FROM generate_series(date_trunc('week', now()) - interval '7 weeks', date_trunc('week', now()), interval '1 week') AS w ORDER BY w`);
    const max = Math.max(1, ...weeks.map((w) => w.n));
    const hour = +new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem', hour: 'numeric', hour12: false });
    const greet = hour < 12 ? 'בוקר טוב' : hour < 18 ? 'צהריים טובים' : 'ערב טוב';

    const leadRows = latest.length ? `<ul class="lead-rows">${latest.map((l) => `<li><a href="/admin/lead/?id=${l.id}">
      <span class="lead-rows__name">${esc(l.name || l.phone || l.email)}</span>
      <span class="tag tag--${esc(l.status)}">${esc(LEAD_STATUSES[l.status] || l.status)}</span>
      <span class="muted small">${esc(LEAD_SOURCES[l.product || l.kind] || '')}</span>
      <time class="muted small">${esc(heDate(l.created_at))}</time></a></li>`).join('')}</ul>`
      : '<p class="empty">עוד לא הגיעו לידים. כשמישהו ימלא טופס באתר, הוא יופיע כאן ותקבלו גם מייל.</p>';

    const twoStep = ctx.user.totp_enabled ? '' : `<p class="notice notice--warn">הכניסה לניהול מוגנת בסיסמה בלבד. מומלץ להפעיל אימות דו־שלבי עם אפליקציה בטלפון: <a href="/admin/settings/#twostep">להפעלה (שתי דקות)</a></p>`;
    const body = `${twoStep}<section class="summary">
  <a class="summary__item${newLeads ? ' is-hot' : ''}" href="/admin/leads/?status=new"><b>${newLeads}</b><span>לידים שמחכים לתשובה</span></a>
  <a class="summary__item" href="/admin/leads/"><b>${week}</b><span>לידים בשבוע האחרון · ${month} החודש</span></a>
  <a class="summary__item" href="/admin/posts/"><b>${posts}</b><span>מאמרים באתר${drafts ? ` · ${drafts} טיוטות` : ''}</span></a>
  <a class="summary__item${issues ? ' is-warn' : ''}" href="/admin/seo/?filter=issues"><b>${issues}</b><span>עמודים עם הערות קידום</span></a>
</section>
<div class="dash-grid">
  <section class="panel">
    <div class="panel__head"><h2>לידים אחרונים</h2><a href="/admin/leads/">לכל הלידים</a></div>
    ${leadRows}
    <h3 class="small muted trend-title">לידים לפי שבוע</h3>
    <div class="trend" role="img" aria-label="לידים בשמונת השבועות האחרונים: ${weeks.map((w) => w.n).join(', ')}">
      ${weeks.map((w) => `<div class="trend__col"><span class="trend__n">${w.n || ''}</span><span class="trend__bar" style="height:${Math.max(3, Math.round((w.n / max) * 100))}%"></span><span class="trend__label">${esc(w.label)}</span></div>`).join('')}
    </div>
  </section>
  <div class="dash-side">
    <section class="panel">
      <h2>פעולות מהירות</h2>
      <div class="quick">
        <a href="/admin/post-edit/"><b>מאמר חדש</b><span>לבלוג${lastPost ? ' · האחרון: ' + esc(wallDate(lastPost.date)) : ''}</span></a>
        <a href="/admin/page-edit/?path=%2F"><b>עריכת דף הבית</b><span>שינוי טקסטים ישירות על העמוד</span></a>
        <a href="/admin/testimonials/?edit=0"><b>המלצה חדשה</b><span>${testimonials} המלצות באתר</span></a>
        <a href="/admin/redirects/"><b>הפניות ו־404</b><span>${notFound ? `${notFound} כתובות שלא נמצאו החודש` : 'אין כתובות שבורות החודש'}</span></a>
      </div>
    </section>
    <section class="panel">
      <h2>שינויים אחרונים</h2>
      ${activity.length ? `<ul class="activity">${activity.map((a) => `<li><span>${esc(a.action)}${a.target ? ': ' + (a.link ? `<a href="${esc(a.link)}">${esc(a.target)}</a>` : esc(a.target)) : ''}</span>
        <time class="muted small">${esc(heDate(a.at))} · ${esc(a.username)}</time></li>`).join('')}</ul>`
        : '<p class="muted small">כאן יופיעו פעולות שנעשו באתר: עריכות, מאמרים חדשים, העלאות.</p>'}
    </section>
  </div>
</div>`;
    return html(await adminPage(ctx, { title: `${greet}, ${ctx.user.username}`, active: 'dashboard', body }));
  },
};
