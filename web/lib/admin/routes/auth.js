/** Login, logout, password reset and first-run account setup. */
import { q, one } from '../../db';
import { sendMail } from '../../mail';
import { ipHash, recordAttempt, sha256, token, tooManyAttempts } from '../../security';
import { currentSession, endSession, hashPassword, passwordProblem, setPassword, startSession, userCount, verifyPassword } from '../auth';
import { authPage, esc, html, redirect } from '../ui';

const USERNAME = /^[\p{L}\p{N}._-]{3,40}$/u;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const errorBox = (e) => (e ? `<p class="notice notice--error" role="alert">${esc(e)}</p>` : '');

function safeNext(next) {
  return next && next.startsWith('/admin/') && !next.includes('//') && !next.includes('\\') ? next : '/admin/';
}

function loginForm(ctx, error = '', username = '') {
  return html(authPage(ctx, 'כניסה', `${errorBox(error)}
<form method="post" class="stack">
  <label>שם משתמש או מייל <input name="username" required value="${esc(username)}" autocomplete="username" autofocus dir="ltr"></label>
  <label>סיסמה <input name="password" type="password" required autocomplete="current-password" dir="ltr"></label>
  <button class="btn" type="submit">כניסה</button>
</form>
<p class="auth-card__alt"><a href="/admin/forgot/">שכחתי סיסמה</a></p>`), error ? 401 : 200);
}

export const login = {
  async GET(ctx) {
    if (!(await userCount())) return redirect('/admin/setup/');
    if (await currentSession(ctx.request)) return redirect('/admin/');
    return loginForm(ctx);
  },
  async POST(ctx) {
    const username = String(ctx.form.get('username') || '').trim();
    const pw = String(ctx.form.get('password') || '');
    const ipKey = 'login-ip|' + ipHash(ctx.request);
    const userKey = 'login-user|' + username.toLowerCase();
    if ((await tooManyAttempts(ipKey, 10, 900)) || (await tooManyAttempts(userKey, 5, 900))) {
      return loginForm(ctx, 'יותר מדי ניסיונות כניסה. נסו שוב בעוד רבע שעה, או אפסו את הסיסמה.', username);
    }
    const u = await one('SELECT id, password_hash FROM users WHERE lower(username) = lower($1) OR lower(email) = lower($1)', [username]);
    const ok = await verifyPassword(pw, u?.password_hash);
    if (u && ok) {
      const cookie = await startSession(ctx.request, u.id);
      return redirect(safeNext(ctx.query.get('next') || ''), null, 'ok', [cookie]);
    }
    await recordAttempt(ipKey);
    await recordAttempt(userKey);
    return loginForm(ctx, 'שם המשתמש או הסיסמה שגויים.', username);
  },
};

export const logout = {
  async GET() { return redirect('/admin/'); },
  async POST(ctx) {
    const cookie = await endSession(ctx.request);
    return redirect('/admin/login/', 'יצאתם מהמערכת.', 'ok', [cookie]);
  },
};

export const forgot = {
  async GET(ctx) {
    return html(authPage(ctx, 'איפוס סיסמה', `<p class="muted">כתבו את המייל או שם המשתמש של החשבון, ונשלח קישור לבחירת סיסמה חדשה.</p>
<form method="post" class="stack">
  <label>מייל או שם משתמש <input name="who" required autocomplete="username" autofocus dir="ltr"></label>
  <button class="btn" type="submit">שליחת קישור לאיפוס</button>
</form>
<p class="auth-card__alt"><a href="/admin/login/">חזרה לכניסה</a></p>`));
  },
  async POST(ctx) {
    const who = String(ctx.form.get('who') || '').trim();
    const key = 'reset|' + ipHash(ctx.request);
    if (who && !(await tooManyAttempts(key, 5, 3600))) {
      await recordAttempt(key);
      const u = await one('SELECT id, email, username FROM users WHERE lower(email) = lower($1) OR lower(username) = lower($1)', [who]);
      if (u) {
        const t = token();
        await q('DELETE FROM password_resets WHERE user_id = $1', [u.id]);
        await q(`INSERT INTO password_resets(token_hash, user_id, expires_at) VALUES($1, $2, now() + interval '1 hour')`, [sha256(t), u.id]);
        const link = `${ctx.url.origin}/admin/reset/?token=${t}`;
        await sendMail({
          to: u.email, subject: 'איפוס סיסמה לניהול האתר',
          text: `שלום ${u.username},\n\nכדי לבחור סיסמה חדשה לאזור הניהול של האתר, פתחו את הקישור:\n${link}\n\n`
            + 'הקישור בתוקף לשעה אחת ולשימוש אחד.\nאם לא ביקשתם לאפס סיסמה, אפשר להתעלם מההודעה. הסיסמה הנוכחית לא השתנתה.\n',
        });
      }
    }
    // Same answer whether or not the account exists.
    return html(authPage(ctx, 'איפוס סיסמה', `<p class="notice notice--ok" role="status">אם הפרטים שייכים לחשבון במערכת, שלחנו אליו מייל עם קישור לבחירת סיסמה חדשה. הקישור בתוקף לשעה.</p>
<p class="muted">לא הגיע? בדקו בתיקיית הספאם, או נסו שוב בעוד כמה דקות.</p><p class="auth-card__alt"><a href="/admin/login/">חזרה לכניסה</a></p>`));
  },
};

async function findReset(t) {
  if (!/^[\w-]{30,60}$/.test(t || '')) return null;
  return one('SELECT user_id FROM password_resets WHERE token_hash = $1 AND expires_at > now()', [sha256(t)]);
}

function resetForm(ctx, t, error = '') {
  return html(authPage(ctx, 'בחירת סיסמה חדשה', `${errorBox(error)}
<form method="post" class="stack">
  <input type="hidden" name="token" value="${esc(t)}">
  <label>סיסמה חדשה <input name="password" type="password" required minlength="10" autocomplete="new-password" autofocus dir="ltr"><small>לפחות 10 תווים.</small></label>
  <label>שוב, לאימות <input name="password2" type="password" required minlength="10" autocomplete="new-password" dir="ltr"></label>
  <button class="btn" type="submit">שמירת הסיסמה</button>
</form>
<p class="auth-card__alt"><a href="/admin/login/">חזרה לכניסה</a></p>`));
}

const badLink = (ctx) => html(authPage(ctx, 'בחירת סיסמה חדשה', `<p class="notice notice--error" role="alert">הקישור לא תקף. ייתכן שפג תוקפו (שעה) או שכבר השתמשו בו.</p>
<p><a class="btn" href="/admin/forgot/">שליחת קישור חדש</a></p>`), 400);

export const reset = {
  async GET(ctx) {
    const t = ctx.query.get('token') || '';
    return (await findReset(t)) ? resetForm(ctx, t) : badLink(ctx);
  },
  async POST(ctx) {
    const t = String(ctx.form.get('token') || '');
    const r = await findReset(t);
    if (!r) return badLink(ctx);
    const pw = String(ctx.form.get('password') || '');
    const problem = passwordProblem(pw) || (pw !== String(ctx.form.get('password2') || '') ? 'הסיסמאות לא זהות.' : null);
    if (problem) return resetForm(ctx, t, problem);
    await setPassword(r.user_id, pw); // also invalidates this link
    await q('DELETE FROM sessions WHERE user_id = $1', [r.user_id]);
    const cookie = await startSession(ctx.request, r.user_id);
    return redirect('/admin/', 'הסיסמה עודכנה ואתם מחוברים.', 'ok', [cookie]);
  },
};

function setupForm(ctx, error = '', v = {}) {
  const configured = !!process.env.ADMIN_SETUP_KEY;
  return html(authPage(ctx, 'יצירת חשבון ניהול', `<p class="muted">פעם אחת בלבד: יוצרים את החשבון שבו תתחברו לאזור הניהול.</p>
${configured ? '' : '<p class="notice notice--error">חסר קוד התקנה: הגדירו משתנה סביבה ADMIN_SETUP_KEY בוורסל ופרסו מחדש.</p>'}${errorBox(error)}
<form method="post" class="stack">
  <label>קוד התקנה <input name="setup_key" required autocomplete="off" dir="ltr"><small>הערך של ADMIN_SETUP_KEY שהגדרתם בוורסל.</small></label>
  <label>שם משתמש <input name="username" required value="${esc(v.username || '')}" autocomplete="username" dir="ltr"></label>
  <label>מייל (לאיפוס סיסמה) <input name="email" type="email" required value="${esc(v.email || '')}" autocomplete="email" dir="ltr"></label>
  <label>סיסמה <input name="password" type="password" required minlength="10" autocomplete="new-password" dir="ltr"><small>לפחות 10 תווים.</small></label>
  <button class="btn" type="submit">יצירת החשבון</button>
</form>`), error ? 400 : 200);
}

export const setup = {
  async GET(ctx) {
    if (await userCount()) return redirect('/admin/login/');
    return setupForm(ctx);
  },
  async POST(ctx) {
    if (await userCount()) return redirect('/admin/login/');
    const v = { username: String(ctx.form.get('username') || '').trim(), email: String(ctx.form.get('email') || '').trim() };
    const pw = String(ctx.form.get('password') || '');
    const key = 'setup|' + ipHash(ctx.request);
    const expected = process.env.ADMIN_SETUP_KEY || '';
    if (await tooManyAttempts(key, 5, 900)) return setupForm(ctx, 'יותר מדי ניסיונות. נסו שוב בעוד רבע שעה.', v);
    if (!expected || sha256(String(ctx.form.get('setup_key') || '').trim()) !== sha256(expected)) {
      await recordAttempt(key);
      return setupForm(ctx, 'קוד ההתקנה שגוי.', v);
    }
    if (!USERNAME.test(v.username)) return setupForm(ctx, 'שם המשתמש צריך להכיל 3–40 אותיות, ספרות, נקודה, מקף או קו תחתון.', v);
    if (!EMAIL.test(v.email)) return setupForm(ctx, 'כתובת המייל לא תקינה. היא משמשת לאיפוס סיסמה.', v);
    const p = passwordProblem(pw);
    if (p) return setupForm(ctx, p, v);
    const [u] = await q('INSERT INTO users(username, email, password_hash) VALUES($1, $2, $3) RETURNING id', [v.username, v.email, await hashPassword(pw)]);
    const cookie = await startSession(ctx.request, u.id);
    return redirect('/admin/', 'החשבון נוצר ואתם מחוברים.', 'ok', [cookie]);
  },
};

export { USERNAME, EMAIL };
