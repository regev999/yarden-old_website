import { q, one, getSetting, setSetting } from '../../db';
import { sendMail } from '../../mail';
import { endOtherSessions, passwordProblem, setPassword, verifyPassword } from '../auth';
import { publishChanges, logActivity } from '../common';
import { adminPage, csrfField, esc, html, redirect } from '../ui';
import { USERNAME, EMAIL } from './auth';

const back = (msg, type = 'ok') => redirect('/admin/settings/', msg, type);

export const page = {
  async GET(ctx) {
    const notify = await getSetting('notify_email', process.env.NOTIFY_EMAIL || '');
    const ga = await getSetting('ga_id', '');
    const mailReady = !!process.env.RESEND_API_KEY;
    const body = `<div class="settings-grid">
  <section class="panel">
    <h2>התראות על לידים</h2>
    ${mailReady ? '' : '<p class="notice notice--warn">שליחת מיילים עוד לא מחוברת: צריך להגדיר RESEND_API_KEY בוורסל. הלידים נשמרים כאן בכל מקרה.</p>'}
    <form method="post" class="stack">${csrfField(ctx)}<input type="hidden" name="action" value="notify">
      <label>לאיזה מייל לשלוח כל ליד חדש <input name="notify_email" type="email" value="${esc(notify)}" dir="ltr">
        <small>השאירו ריק כדי לא לקבל מיילים. הלידים נשמרים כאן בכל מקרה.</small></label>
      <button class="btn" type="submit">שמירה</button>
    </form>
    <form method="post" class="inline-form">${csrfField(ctx)}<input type="hidden" name="action" value="test">
      <button class="btn btn--quiet" type="submit">שליחת מייל בדיקה</button></form>
  </section>
  <section class="panel">
    <h2>Google Analytics</h2>
    <form method="post" class="stack">${csrfField(ctx)}<input type="hidden" name="action" value="ga">
      <label>מזהה מדידה (Measurement ID) <input name="ga_id" value="${esc(ga)}" placeholder="G-XXXXXXXXXX" dir="ltr">
        <small>נטען רק אחרי שהגולש מאשר עוגיות סטטיסטיקה. השאירו ריק כדי לכבות.</small></label>
      <button class="btn" type="submit">שמירה</button>
    </form>
  </section>
  <section class="panel">
    <h2>פרטי החשבון</h2>
    <form method="post" class="stack">${csrfField(ctx)}<input type="hidden" name="action" value="account">
      <label>שם משתמש <input name="username" value="${esc(ctx.user.username)}" required dir="ltr" autocomplete="username"></label>
      <label>מייל (לאיפוס סיסמה) <input name="email" type="email" value="${esc(ctx.user.email)}" required dir="ltr" autocomplete="email"></label>
      <button class="btn" type="submit">שמירה</button>
    </form>
  </section>
  <section class="panel">
    <h2>החלפת סיסמה</h2>
    <form method="post" class="stack">${csrfField(ctx)}<input type="hidden" name="action" value="password">
      <label>סיסמה נוכחית <input name="current" type="password" required autocomplete="current-password" dir="ltr"></label>
      <label>סיסמה חדשה <input name="new" type="password" required minlength="10" autocomplete="new-password" dir="ltr"><small>לפחות 10 תווים. מנתק את כל שאר המכשירים.</small></label>
      <label>שוב, לאימות <input name="new2" type="password" required minlength="10" autocomplete="new-password" dir="ltr"></label>
      <button class="btn" type="submit">החלפת סיסמה</button>
    </form>
  </section>
</div>`;
    return html(await adminPage(ctx, { title: 'הגדרות', active: 'settings', body }));
  },

  async POST(ctx) {
    const f = (k) => String(ctx.form.get(k) || '').trim();
    switch (ctx.form.get('action')) {
      case 'password': {
        const u = await one('SELECT password_hash FROM users WHERE id = $1', [ctx.user.id]);
        const next = String(ctx.form.get('new') || '');
        if (!(await verifyPassword(String(ctx.form.get('current') || ''), u.password_hash))) return back('הסיסמה הנוכחית שגויה.', 'error');
        const p = passwordProblem(next);
        if (p) return back(p, 'error');
        if (next !== String(ctx.form.get('new2') || '')) return back('הסיסמאות החדשות לא זהות.', 'error');
        await setPassword(ctx.user.id, next);
        await endOtherSessions(ctx.user.id, ctx.request);
        return back('הסיסמה עודכנה.');
      }
      case 'account': {
        const username = f('username');
        const email = f('email');
        if (!USERNAME.test(username)) return back('שם המשתמש צריך להכיל 3–40 אותיות, ספרות, נקודה, מקף או קו תחתון.', 'error');
        if (!EMAIL.test(email)) return back('כתובת המייל לא תקינה.', 'error');
        try {
          await q('UPDATE users SET username = $1, email = $2 WHERE id = $3', [username, email, ctx.user.id]);
        } catch {
          return back('שם המשתמש או המייל כבר בשימוש.', 'error');
        }
        return back('פרטי החשבון עודכנו.');
      }
      case 'notify': {
        const to = f('notify_email');
        if (to && !EMAIL.test(to)) return back('כתובת המייל לא תקינה.', 'error');
        await setSetting('notify_email', to);
        return back(to ? `התראות על לידים חדשים יישלחו אל ${to}` : 'התראות במייל כבויות. הלידים עדיין נשמרים במערכת.');
      }
      case 'ga': {
        const id = f('ga_id').toUpperCase();
        if (id && !/^G-[A-Z0-9]{4,20}$/.test(id)) return back('המזהה צריך להיראות כך: G-XXXXXXXXXX', 'error');
        await setSetting('ga_id', id);
        publishChanges();
        await logActivity(ctx, id ? 'חיבר את Google Analytics' : 'ניתק את Google Analytics', id);
        return back(id ? 'Google Analytics מחובר. המדידה תתחיל תוך דקה.' : 'Google Analytics כבוי.');
      }
      case 'test': {
        const to = (await getSetting('notify_email', process.env.NOTIFY_EMAIL || '')) || ctx.user.email;
        const ok = await sendMail({ to, subject: 'בדיקת מייל מהאתר', text: 'זו הודעת בדיקה מאזור הניהול של האתר.\nאם היא הגיעה, התראות הלידים ואיפוס הסיסמה יעבדו.' });
        return ok ? back(`נשלחה הודעת בדיקה אל ${to}. אם היא לא מגיעה תוך כמה דקות, בדקו בספאם.`)
          : back('השליחה נכשלה. צריך להגדיר RESEND_API_KEY ו־MAIL_FROM בוורסל (ולאמת את הדומיין ב־Resend).', 'error');
      }
      default:
        return back('');
    }
  },
};
