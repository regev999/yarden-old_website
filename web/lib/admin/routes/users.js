/** Admin accounts: everyone listed can use the whole admin. A new account gets a link to choose its own password. */
import { q, one } from '../../db';
import { mailReady, sendMail } from '../../mail';
import { takeAttempt } from '../../security';
import { siteBase } from '../../shop';
import { passwordLink, verifyPassword } from '../auth';
import { logActivity } from '../common';
import { adminPage, csrfField, esc, heDate, html, qs, redirect } from '../ui';
import { USERNAME, EMAIL } from './auth';

const INVITE_MINUTES = 7 * 24 * 60;
const LINK = /^\/admin\/reset\/\?token=[\w-]{30,60}$/;

/** A fresh invitation link (earlier ones stop working), sent by mail; returns the message for the next page. */
async function invite(ctx, u) {
  const base = siteBase(ctx.request);
  const path = await passwordLink(u.id, INVITE_MINUTES);
  const sent = await sendMail({
    to: u.email, subject: 'הזמנה לניהול האתר',
    text: `שלום ${u.username},\n\nנפתח לך חשבון באזור הניהול של האתר ${base}.\n`
      + `כדי לבחור סיסמה ולהיכנס, פתחו את הקישור:\n${base}${path}\n\n`
      + 'הקישור בתוקף לשבוע ולשימוש אחד.\n'
      + `בפעמים הבאות נכנסים בכתובת ${base}/admin/ עם שם המשתמש ${u.username} (או עם המייל הזה) והסיסמה שבחרתם.\n`,
  });
  return {
    text: sent ? `נשלחה הזמנה במייל אל ${u.email}.` : `המייל לא נשלח, אז העבירו ל־${u.username} את הקישור שלמטה בעצמכם.`,
    link: path, who: u.username,
  };
}

export const page = {
  async GET(ctx) {
    const users = await q(`SELECT id, username, email, password_hash = '' AS invited, totp_enabled, created_at, last_login_at FROM users ORDER BY id`);
    const inv = ctx.flash && LINK.test(ctx.flash.link || '') ? ctx.flash : null;
    const pre = { username: ctx.query.get('username') || '', email: ctx.query.get('email') || '' };
    const linkBox = inv ? `<section class="panel stack invite">
  <h2>קישור ההזמנה של ${esc(inv.who)}</h2>
  <div class="invite__link"><input readonly value="${esc(siteBase(ctx.request) + inv.link)}" dir="ltr" aria-label="קישור ההזמנה">
    <button class="btn btn--quiet" type="button" data-copy="${esc(inv.link)}">העתקה</button></div>
  <p class="muted small">הקישור מוצג רק עכשיו. הוא בתוקף לשבוע ולשימוש אחד, ואפשר להעביר אותו גם בוואטסאפ או בהודעה.</p>
</section>` : '';
    const rows = users.map((u) => {
      const me = u.id === ctx.user.id;
      const remove = `<form method="post" class="inline" data-confirm="למחוק את החשבון של ${esc(u.username)}? הגישה לניהול תיחסם מיד.">${csrfField(ctx)}
    <input type="hidden" name="id" value="${u.id}"><button class="linklike linklike--danger small" name="action" value="delete">מחיקה</button></form>`;
      const actions = me ? '<a href="/admin/settings/">עריכה בהגדרות</a>'
        : (u.invited ? `<form method="post" class="inline">${csrfField(ctx)}<input type="hidden" name="id" value="${u.id}">
    <button class="linklike small" name="action" value="reinvite">שליחת הזמנה מחדש</button></form> · ` : '') + remove;
      return `<tr><td dir="ltr" class="strong">${esc(u.username)}</td><td dir="ltr" class="small">${esc(u.email)}</td>
  <td>${u.invited ? '<span class="tag">טרם נבחרה סיסמה</span>' : '<span class="tag tag--ok">פעיל</span>'}${me ? ' <span class="tag tag--new">החשבון שלך</span>' : ''}</td>
  <td class="small">${u.totp_enabled ? 'פעיל' : '<span class="warn">כבוי</span>'}</td>
  <td class="small nowrap">${u.last_login_at ? esc(heDate(u.last_login_at)) : '—'}</td><td class="small nowrap">${esc(heDate(u.created_at, false))}</td>
  <td class="small nowrap">${actions}</td></tr>`;
    }).join('');
    const body = `<div class="stack">${linkBox}
<div class="table-wrap"><table class="table"><thead><tr><th>שם משתמש</th><th>מייל</th><th>מצב</th><th>אימות דו־שלבי</th><th>כניסה אחרונה</th><th>נוצר</th><th></th></tr></thead>
<tbody>${rows}</tbody></table></div>
<section class="panel narrow-form" id="new-user">
  <h2>משתמש חדש</h2>
  ${(await mailReady()) ? '' : '<p class="notice notice--warn">שליחת מיילים מהאתר כבויה (בחיבורים), אז אחרי ההוספה יוצג כאן קישור ההזמנה ותעבירו אותו בעצמכם.</p>'}
  <form method="post" class="stack">${csrfField(ctx)}<input type="hidden" name="action" value="add">
    <label>שם משתמש <input name="username" required value="${esc(pre.username)}" dir="ltr" autocomplete="off"><small>3–40 אותיות, ספרות, נקודה, מקף או קו תחתון. משמש לכניסה.</small></label>
    <label>מייל <input name="email" type="email" required value="${esc(pre.email)}" dir="ltr" autocomplete="off"><small>לכאן נשלחת ההזמנה לבחירת סיסמה. משמש גם לאיפוס סיסמה.</small></label>
    <label>הסיסמה שלכם, לאישור <input name="current" type="password" required autocomplete="current-password" dir="ltr"></label>
    <button class="btn" type="submit">הוספה ושליחת הזמנה</button>
  </form>
  <p class="muted small">לכל המשתמשים יש גישה מלאה לניהול, כולל הוספה ומחיקה של משתמשים. כל אחד בוחר סיסמה משלו ומפעיל אימות דו־שלבי משלו בהגדרות.</p>
</section></div>`;
    return html(await adminPage(ctx, { title: 'משתמשים', active: 'users', body }));
  },

  async POST(ctx) {
    const f = (k) => String(ctx.form.get(k) || '').trim();
    const action = f('action');
    if (action === 'add') {
      const v = { username: f('username'), email: f('email') };
      const back = (msg) => redirect('/admin/users/' + qs(v), msg, 'error');
      // A new manager is a lasting way in, so it takes the password, not just a signed-in browser
      const me = await one('SELECT password_hash FROM users WHERE id = $1', [ctx.user.id]);
      if (await takeAttempt(`confirm|#${ctx.user.id}`, 5, 900)) return back('יותר מדי ניסיונות. נסו שוב בעוד רבע שעה.');
      if (!(await verifyPassword(String(ctx.form.get('current') || ''), me.password_hash))) return back('הסיסמה שלכם שגויה.');
      if (!USERNAME.test(v.username)) return back('שם המשתמש צריך להכיל 3–40 אותיות, ספרות, נקודה, מקף או קו תחתון.');
      if (!EMAIL.test(v.email)) return back('כתובת המייל לא תקינה.');
      // Sign-in takes either one, in any letter case, so both must be unique that way
      if (await one('SELECT 1 FROM users WHERE lower(username) = lower($1) OR lower(email) = lower($2)', [v.username, v.email])) {
        return back('כבר יש משתמש עם שם המשתמש או המייל האלה.');
      }
      // No password until the invited person chooses one (an empty hash never matches)
      const u = await one(`INSERT INTO users(username, email, password_hash) VALUES($1, $2, '') RETURNING id, username, email`, [v.username, v.email]);
      await logActivity(ctx, 'הוסיף משתמש', u.username, '/admin/users/');
      const m = await invite(ctx, u);
      return redirect('/admin/users/', { ...m, text: `החשבון של ${u.username} נוצר. ${m.text}` });
    }
    const id = parseInt(f('id'), 10) || 0;
    if (action === 'reinvite') {
      const u = await one(`SELECT id, username, email FROM users WHERE id = $1 AND password_hash = ''`, [id]);
      if (!u) return redirect('/admin/users/');
      const m = await invite(ctx, u);
      return redirect('/admin/users/', { ...m, text: `נוצר קישור הזמנה חדש, והקודם כבר לא פעיל. ${m.text}` });
    }
    if (action === 'delete') {
      if (id === ctx.user.id) return redirect('/admin/users/', 'אי אפשר למחוק את החשבון שאיתו אתם מחוברים.', 'error');
      const u = await one('DELETE FROM users WHERE id = $1 RETURNING username', [id]);
      if (u) await logActivity(ctx, 'מחק משתמש', u.username);
      return redirect('/admin/users/', u ? `החשבון של ${u.username} נמחק.` : null);
    }
    return redirect('/admin/users/');
  },
};
