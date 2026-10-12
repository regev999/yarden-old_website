/** Login, logout, password reset and first-run account setup. */
import { q, one } from '../../db';
import { mailReady, sendMail } from '../../mail';
import { clearAttempts, ipHash, ipHint, sameSecret, sha256, takeAttempt, token } from '../../security';
import { siteBase } from '../../shop';
import { currentPending, currentSession, deviceName, endPending, endSession, hashPassword, knownDevice, logSignin, passwordProblem, setPassword, startPending, startSession, userCount, verifyPassword } from '../auth';
import { matchCode, matchRecoveryCode } from '../totp';
import { authPage, esc, html, redirect } from '../ui';

const USERNAME = /^[\p{L}\p{N}._-]{3,40}$/u;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const errorBox = (e) => (e ? `<p class="notice notice--error" role="alert">${esc(e)}</p>` : '');

function safeNext(next) {
  return next && next.startsWith('/admin/') && !next.includes('//') && !next.includes('\\') ? next : '/admin/';
}

/** A completed sign-in: logged, and from a browser not seen before, reported by mail. */
async function signedIn(ctx, userId, step) {
  const u = await one('SELECT username, email FROM users WHERE id = $1', [userId]);
  const known = await knownDevice(ctx.request, u.username);
  await logSignin(ctx.request, { username: u.username, ok: true, step });
  if (!known && (await mailReady())) {
    const when = new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', dateStyle: 'short', timeStyle: 'short' });
    const where = ipHint(ctx.request);
    await sendMail({
      to: u.email, subject: 'כניסה חדשה לניהול האתר',
      text: `שלום ${u.username},\n\nהייתה כניסה לאזור הניהול של האתר ממכשיר שלא נכנס לפני כן:\n`
        + `${deviceName(ctx.request.headers.get('user-agent'))}, ${when}${where ? ` (${where})` : ''}\n\n`
        + `אם זה הייתם אתם, אין צורך לעשות דבר.\nאם לא: היכנסו לניהול, החליפו סיסמה (הגדרות ← החלפת סיסמה) ונתקו את שאר המכשירים.\n${siteBase(ctx.request)}/admin/settings/\n`,
    });
  }
  return startSession(ctx.request, userId);
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
    const username = String(ctx.form.get('username') || '').trim().slice(0, 200);
    const pw = String(ctx.form.get('password') || '').slice(0, 1000);
    const u = await one('SELECT id, username, password_hash, totp_enabled FROM users WHERE lower(username) = lower($1) OR lower(email) = lower($1)', [username]);
    const ipKey = 'login-ip|' + ipHash(ctx.request);
    // Per account, whichever name or mail was typed for it
    const userKey = 'login-user|' + (u ? `#${u.id}` : username.toLowerCase());
    const ipBlocked = await takeAttempt(ipKey, 10, 900);
    const userBlocked = await takeAttempt(userKey, 5, 900);
    const ok = await verifyPassword(pw, u?.password_hash);
    // Wrong guesses from elsewhere can't lock the owner out of a browser she has signed in from before
    const trusted = u && ok && userBlocked && !ipBlocked && (await knownDevice(ctx.request, u.username));
    if ((ipBlocked || userBlocked) && !trusted) {
      return loginForm(ctx, 'יותר מדי ניסיונות כניסה. נסו שוב בעוד רבע שעה, או אפסו את הסיסמה.', username);
    }
    if (u && ok) {
      await clearAttempts(userKey);
      const next = safeNext(ctx.query.get('next') || '');
      // Two-step sign-in: the password alone doesn't open a session
      if (u.totp_enabled) return redirect('/admin/verify/', null, 'ok', [await startPending(ctx.request, u.id, next)]);
      return redirect(next, null, 'ok', [await signedIn(ctx, u.id, 'password')]);
    }
    await logSignin(ctx.request, { username, ok: false });
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

function verifyForm(ctx, error = '') {
  return html(authPage(ctx, 'אימות דו־שלבי', `${errorBox(error)}
<p class="muted">פתחו את אפליקציית האימות בטלפון והקלידו את הקוד בן 6 הספרות שמופיע ליד <b dir="ltr">Yarden Kerem</b>.</p>
<form method="post" class="stack">
  <label>קוד מהאפליקציה <input name="code" required inputmode="numeric" autocomplete="one-time-code" autofocus dir="ltr" maxlength="11" class="code-input"></label>
  <button class="btn" type="submit">כניסה</button>
</form>
<details class="auth-card__more"><summary>הטלפון לא איתי</summary>
<p class="muted">אפשר להקליד באותו שדה את אחד מקודי הגיבוי ששמרתם כשהפעלתם את האימות (למשל <span dir="ltr">a1b2c-3d4e5</span>). כל קוד גיבוי עובד פעם אחת.</p></details>
<p class="auth-card__alt"><a href="/admin/login/">חזרה לכניסה</a></p>`), error ? 401 : 200);
}

export const verify = {
  async GET(ctx) {
    if (!(await currentPending(ctx.request))) return redirect('/admin/login/');
    return verifyForm(ctx);
  },
  async POST(ctx) {
    const p = await currentPending(ctx.request);
    if (!p) return redirect('/admin/login/', 'עבר זמן רב מדי מאז הסיסמה. היכנסו שוב.', 'error');
    // Wrong codes count per account, across sign-ins, so the password can't be used to keep guessing
    const codeKey = `mfa|${p.user_id}`;
    // Each try is counted before the code is checked, so parallel guesses can't share one count
    const tries = await one('UPDATE mfa_pending SET tries = tries + 1 WHERE id = $1 AND tries < 5 RETURNING tries', [p.id]);
    if (!tries || (await takeAttempt(codeKey, 10, 900))) {
      const cookie = await endPending(ctx.request, p.id);
      return redirect('/admin/login/', 'יותר מדי קודים שגויים. נסו שוב בעוד רבע שעה.', 'error', [cookie]);
    }
    const code = String(ctx.form.get('code') || '').trim();
    const step = matchCode(p.totp_secret, code, Number(p.totp_last_step));
    const recovery = step === null ? matchRecoveryCode(p.recovery_codes, code) : -1;
    // Each code works once, even if the same one is sent twice at the same moment
    const used = step !== null
      ? await one('UPDATE users SET totp_last_step = $1 WHERE id = $2 AND totp_last_step < $1 RETURNING id', [step, p.user_id])
      : recovery >= 0
        ? await one('UPDATE users SET recovery_codes = recovery_codes - $1::text WHERE id = $2 AND recovery_codes ? $1 RETURNING id', [p.recovery_codes[recovery], p.user_id])
        : null;
    if (used) {
      const cookies = [await endPending(ctx.request, p.id), await signedIn(ctx, p.user_id, recovery >= 0 ? 'recovery' : 'code')];
      const note = recovery >= 0 ? 'נכנסתם עם קוד גיבוי. הוא לא יעבוד שוב; אפשר ליצור קודים חדשים בהגדרות.' : null;
      return redirect(p.next || '/admin/', note, 'ok', cookies);
    }
    await logSignin(ctx.request, { username: p.username, ok: false, step: 'code' });
    if (tries.tries >= 5) {
      const cookie = await endPending(ctx.request, p.id);
      return redirect('/admin/login/', 'יותר מדי קודים שגויים. היכנסו שוב עם הסיסמה.', 'error', [cookie]);
    }
    return verifyForm(ctx, 'הקוד שגוי או שפג תוקפו. הקלידו את הקוד שמופיע עכשיו באפליקציה.');
  },
};

export const forgot = {
  async GET(ctx) {
    const noMail = (await mailReady()) ? '' : '<p class="notice notice--warn">שליחת מיילים מהאתר כבויה, ולכן קישור האיפוס לא יישלח. אפשר לאפס עם קוד ההתקנה, למטה.</p>';
    return html(authPage(ctx, 'איפוס סיסמה', `${noMail}<p class="muted">כתבו את המייל או שם המשתמש של החשבון, ונשלח קישור לבחירת סיסמה חדשה.</p>
<form method="post" class="stack">
  <label>מייל או שם משתמש <input name="who" required autocomplete="username" autofocus dir="ltr"></label>
  <button class="btn" type="submit">שליחת קישור לאיפוס</button>
</form>
<details class="auth-card__more"${(await mailReady()) ? '' : ' open'}><summary>המייל לא מגיע? איפוס עם קוד ההתקנה</summary>
<form method="post" class="stack"><input type="hidden" name="action" value="setup-key">
  <label>קוד ההתקנה <input name="setup_key" required autocomplete="off" dir="ltr"><small>הקוד שקיבלתם כשהאתר הותקן (ADMIN_SETUP_KEY בשרת).</small></label>
  <button class="btn btn--quiet" type="submit">המשך לבחירת סיסמה חדשה</button>
</form></details>
<p class="auth-card__alt"><a href="/admin/login/">חזרה לכניסה</a></p>`));
  },
  async POST(ctx) {
    // The setup code works as a recovery key for the one account: it lives only
    // on the server and with the site's owner. Limited, logged, and 2FA still applies.
    if (ctx.form.get('action') === 'setup-key') {
      const expected = process.env.ADMIN_SETUP_KEY || '';
      const limited = await takeAttempt('reset-key|' + ipHash(ctx.request), 5, 900);
      const ok = !limited && expected && sameSecret(sha256(String(ctx.form.get('setup_key') || '').trim()), sha256(expected));
      const u = ok ? await one('SELECT id, username FROM users ORDER BY id LIMIT 1') : null;
      if (!u) {
        await logSignin(ctx.request, { username: '', ok: false, step: 'setup-key' });
        return html(authPage(ctx, 'איפוס סיסמה', `<p class="notice notice--error" role="alert">${limited ? 'יותר מדי ניסיונות. נסו שוב בעוד רבע שעה.' : 'קוד ההתקנה שגוי.'}</p>
<p><a class="btn" href="/admin/forgot/">חזרה</a></p>`), 400);
      }
      const t = token();
      await q('DELETE FROM password_resets WHERE user_id = $1', [u.id]);
      await q(`INSERT INTO password_resets(token_hash, user_id, expires_at) VALUES($1, $2, now() + interval '15 minutes')`, [sha256(t), u.id]);
      await logSignin(ctx.request, { username: u.username, ok: true, step: 'setup-key' });
      return redirect(`/admin/reset/?token=${t}`);
    }
    const who = String(ctx.form.get('who') || '').trim();
    const key = 'reset|' + ipHash(ctx.request);
    if (who && !(await takeAttempt(key, 5, 3600))) {
      const u = await one('SELECT id, email, username FROM users WHERE lower(email) = lower($1) OR lower(username) = lower($1)', [who]);
      if (u) {
        const t = token();
        await q('DELETE FROM password_resets WHERE user_id = $1', [u.id]);
        await q(`INSERT INTO password_resets(token_hash, user_id, expires_at) VALUES($1, $2, now() + interval '1 hour')`, [sha256(t), u.id]);
        const link = `${siteBase(ctx.request)}/admin/reset/?token=${t}`;
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
    const u = await one('SELECT username, email, totp_enabled FROM users WHERE id = $1', [r.user_id]);
    const problem = passwordProblem(pw, u || {}) || (pw !== String(ctx.form.get('password2') || '') ? 'הסיסמאות לא זהות.' : null);
    if (problem) return resetForm(ctx, t, problem);
    await setPassword(r.user_id, pw); // also invalidates this link
    await q('DELETE FROM sessions WHERE user_id = $1', [r.user_id]);
    // A reset link proves the mailbox, not the phone: the code is still needed
    if (u?.totp_enabled) return redirect('/admin/verify/', 'הסיסמה עודכנה. נשאר להקליד את הקוד מהאפליקציה.', 'ok', [await startPending(ctx.request, r.user_id, '/admin/')]);
    return redirect('/admin/', 'הסיסמה עודכנה ואתם מחוברים.', 'ok', [await signedIn(ctx, r.user_id, 'reset')]);
  },
};

function setupForm(ctx, error = '', v = {}) {
  const configured = !!process.env.ADMIN_SETUP_KEY;
  return html(authPage(ctx, 'יצירת חשבון ניהול', `<p class="muted">פעם אחת בלבד: יוצרים את החשבון שבו תתחברו לאזור הניהול.</p>
${configured ? '' : '<p class="notice notice--error">חסר קוד התקנה: צריך להגדיר ADMIN_SETUP_KEY במשתני הסביבה של האפליקציה בשרת ולהפעיל אותה מחדש.</p>'}${errorBox(error)}
<form method="post" class="stack">
  <label>קוד התקנה <input name="setup_key" required autocomplete="off" dir="ltr"><small>הקוד שקיבלתם להתקנה (ADMIN_SETUP_KEY בהגדרות האפליקציה בשרת).</small></label>
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
    if (await takeAttempt(key, 5, 900)) return setupForm(ctx, 'יותר מדי ניסיונות. נסו שוב בעוד רבע שעה.', v);
    if (!expected || !sameSecret(sha256(String(ctx.form.get('setup_key') || '').trim()), sha256(expected))) {
      return setupForm(ctx, 'קוד ההתקנה שגוי.', v);
    }
    if (!USERNAME.test(v.username)) return setupForm(ctx, 'שם המשתמש צריך להכיל 3–40 אותיות, ספרות, נקודה, מקף או קו תחתון.', v);
    if (!EMAIL.test(v.email)) return setupForm(ctx, 'כתובת המייל לא תקינה. היא משמשת לאיפוס סיסמה.', v);
    const p = passwordProblem(pw, v);
    if (p) return setupForm(ctx, p, v);
    let u;
    try {
      [u] = await q('INSERT INTO users(username, email, password_hash) SELECT $1, $2, $3 WHERE NOT EXISTS (SELECT 1 FROM users) RETURNING id',
        [v.username, v.email, await hashPassword(pw)]);
    } catch { /* a second account at the same moment: the database refuses it */ }
    if (!u) return redirect('/admin/login/');
    await logSignin(ctx.request, { username: v.username, ok: true, step: 'setup' });
    const cookie = await startSession(ctx.request, u.id);
    return redirect('/admin/settings/#twostep', 'החשבון נוצר ואתם מחוברים. מומלץ להפעיל עכשיו אימות דו־שלבי.', 'ok', [cookie]);
  },
};

export { USERNAME, EMAIL };
