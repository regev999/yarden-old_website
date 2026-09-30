import { q, one, getSetting, setSetting } from '../../db';
import { sendMail } from '../../mail';
import { deviceName, endOtherSessions, passwordProblem, setPassword, verifyPassword } from '../auth';
import { publishChanges, logActivity } from '../common';
import { matchCode, newRecoveryCodes, newSecret, otpauthUrl, qrSvg, spaced } from '../totp';
import { adminPage, csrfField, esc, heDate, html, redirect } from '../ui';
import { USERNAME, EMAIL } from './auth';

const back = (msg, type = 'ok', hash = '') => redirect('/admin/settings/' + hash, msg, type);

const STEPS = { password: 'סיסמה', code: 'קוד מהאפליקציה', recovery: 'קוד גיבוי', reset: 'איפוס סיסמה', setup: 'יצירת החשבון' };

/** Two-step sign-in: off, being set up (QR on screen), or on. */
function twoStepPanel(ctx, u) {
  const head = '<h2>אימות דו־שלבי</h2>';
  if (u.totp_enabled) {
    const left = (u.recovery_codes || []).length;
    return `<section class="panel panel--wide" id="twostep">${head}
    <p class="notice notice--ok">פעיל${u.totp_since ? ` מאז ${esc(heDate(u.totp_since, false))}` : ''}. כל כניסה מבקשת גם קוד מהאפליקציה בטלפון.</p>
    <p class="muted">נותרו ${left} קודי גיבוי${left < 3 ? '. כדאי ליצור חדשים' : ''}.</p>
    <div class="twostep-actions">
      <form method="post" class="stack">${csrfField(ctx)}<input type="hidden" name="action" value="totp-codes">
        <label>קוד עכשווי מהאפליקציה <input name="code" required inputmode="numeric" autocomplete="one-time-code" dir="ltr" maxlength="7" class="code-input"></label>
        <button class="btn btn--quiet" type="submit">קודי גיבוי חדשים</button></form>
      <form method="post" class="stack">${csrfField(ctx)}<input type="hidden" name="action" value="totp-disable">
        <label>סיסמה <input name="password" type="password" required autocomplete="current-password" dir="ltr"></label>
        <label>קוד עכשווי מהאפליקציה <input name="code" required inputmode="numeric" autocomplete="one-time-code" dir="ltr" maxlength="7" class="code-input"></label>
        <button class="btn btn--danger" type="submit">כיבוי האימות הדו־שלבי</button></form>
    </div></section>`;
  }
  if (u.totp_secret) {
    const url = otpauthUrl(u.totp_secret, u.username);
    return `<section class="panel panel--wide" id="twostep">${head}
    <ol class="twostep-setup">
      <li><b>מתקינים אפליקציית אימות</b> בטלפון, אם עוד אין: Google Authenticator או Microsoft Authenticator (חינם).</li>
      <li><b>סורקים את הקוד</b> מתוך האפליקציה (״הוספה״ ← ״סריקת קוד QR״).
        <div class="qr">${qrSvg(url)}</div>
        <p class="muted small">בטלפון עצמו? <a href="${esc(url)}">פתיחה באפליקציה</a>, או הקלדה ידנית של המפתח: <code dir="ltr" class="secret">${esc(spaced(u.totp_secret))}</code></p></li>
      <li><b>מקלידים כאן את הקוד</b> בן 6 הספרות שהאפליקציה מציגה:
        <form method="post" class="stack twostep-confirm">${csrfField(ctx)}<input type="hidden" name="action" value="totp-confirm">
          <input name="code" required inputmode="numeric" autocomplete="one-time-code" dir="ltr" maxlength="7" class="code-input" aria-label="קוד מהאפליקציה" autofocus>
          <button class="btn" type="submit">הפעלה</button></form></li>
    </ol>
    <form method="post" class="inline-form">${csrfField(ctx)}<input type="hidden" name="action" value="totp-cancel"><button class="linklike" type="submit">ביטול</button></form>
    </section>`;
  }
  return `<section class="panel panel--wide" id="twostep">${head}
    <p class="notice notice--warn">עדיין לא פעיל. מומלץ מאוד להפעיל.</p>
    <p>עם אימות דו־שלבי, כדי להיכנס לניהול צריך גם את הסיסמה וגם קוד שמתחלף כל 30 שניות באפליקציה בטלפון. גם מי שישיג את הסיסמה לא יוכל להיכנס בלי הטלפון.</p>
    <form method="post">${csrfField(ctx)}<input type="hidden" name="action" value="totp-start"><button class="btn" type="submit">הפעלת אימות דו־שלבי</button></form>
  </section>`;
}

async function sessionsPanel(ctx) {
  const rows = await q(`SELECT id, created_at, expires_at, ip, user_agent FROM sessions WHERE user_id = $1 AND expires_at > now() ORDER BY created_at DESC`, [ctx.user.id]);
  const list = rows.map((r) => `<li><span><b>${esc(deviceName(r.user_agent))}</b>${r.id === ctx.sessionId ? ' <span class="tag tag--new">המכשיר הזה</span>' : ''}</span>
    <span class="muted small">נכנס ${esc(heDate(r.created_at))}${r.ip ? ` · <span dir="ltr">${esc(r.ip)}</span>` : ''}</span></li>`).join('');
  return `<section class="panel" id="devices"><h2>מכשירים מחוברים</h2>
    <ul class="device-list">${list}</ul>
    ${rows.length > 1 ? `<form method="post">${csrfField(ctx)}<input type="hidden" name="action" value="signout-others"><button class="btn btn--quiet" type="submit">ניתוק כל שאר המכשירים</button></form>` : ''}
    <p class="muted small">חיבור מתנתק אחרי 12 שעות בלי פעילות, ואחרי שבוע בכל מקרה.</p></section>`;
}

async function signinsPanel() {
  const rows = await q('SELECT at, username, ok, step, ip_hint, user_agent FROM signins ORDER BY id DESC LIMIT 12');
  const failed = (await one(`SELECT count(*)::int AS n FROM signins WHERE NOT ok AND at > now() - interval '7 days'`)).n;
  const list = rows.map((r) => `<tr><td>${esc(heDate(r.at))}</td><td>${r.ok ? '<span class="tag tag--ok">הצליחה</span>' : '<span class="tag tag--fail">נכשלה</span>'}</td>
    <td>${esc(STEPS[r.step] || r.step)}</td><td>${esc(deviceName(r.user_agent))}${r.ip_hint ? ` <span class="muted small" dir="ltr">${esc(r.ip_hint)}</span>` : ''}</td></tr>`).join('');
  return `<section class="panel panel--wide" id="signins"><h2>כניסות אחרונות</h2>
    ${failed ? `<p class="muted">${failed} ניסיונות כניסה שנכשלו בשבוע האחרון. ניסיונות חוזרים נחסמים אוטומטית לרבע שעה.</p>` : ''}
    ${rows.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>מתי</th><th>תוצאה</th><th>שלב</th><th>מכשיר</th></tr></thead><tbody>${list}</tbody></table></div>` : '<p class="empty">עוד אין כניסות.</p>'}
  </section>`;
}

/** Shown once, right after they are made: only their hashes are kept. */
function recoveryPage(ctx, codes, first) {
  const text = `קודי גיבוי לניהול האתר של ירדן כרם\n(כל קוד עובד פעם אחת, כשאין את הטלפון)\n\n${codes.join('\n')}\n`;
  return adminPage(ctx, { title: 'קודי גיבוי', active: 'settings', body: `<section class="panel recovery">
  ${first ? '<p class="notice notice--ok">האימות הדו־שלבי פעיל.</p>' : ''}
  <h2>שמרו את קודי הגיבוי</h2>
  <p>אם הטלפון יאבד, אפשר להיכנס עם אחד הקודים האלה במקום הקוד מהאפליקציה. כל קוד עובד פעם אחת. הם מוצגים עכשיו בלבד.</p>
  <ul class="recovery__codes" dir="ltr">${codes.map((c) => `<li><code>${esc(c)}</code></li>`).join('')}</ul>
  <p><a class="btn btn--quiet" download="yarden-kerem-recovery-codes.txt" href="data:text/plain;charset=utf-8,${encodeURIComponent(text)}">הורדה כקובץ</a></p>
  <p class="muted">אפשר גם לצלם מסך ולשמור במקום בטוח, לא באותו טלפון.</p>
  <p><a class="btn" href="/admin/settings/?twostep=on#twostep">שמרתי, להמשך</a></p></section>` });
}

export const page = {
  async GET(ctx) {
    const notify = await getSetting('notify_email', process.env.NOTIFY_EMAIL || '');
    const ga = await getSetting('ga_id', '');
    const mailReady = !!process.env.RESEND_API_KEY;
    const u = await one('SELECT username, totp_enabled, totp_secret, totp_since, recovery_codes FROM users WHERE id = $1', [ctx.user.id]);
    const body = `<div class="settings-grid">
  ${twoStepPanel(ctx, u)}
  ${await sessionsPanel(ctx)}
  <section class="panel">
    <h2>התראות על לידים</h2>
    ${mailReady ? '' : '<p class="notice notice--warn">שליחת מיילים עוד לא מחוברת: צריך להגדיר RESEND_API_KEY במשתני הסביבה של האפליקציה בשרת. הלידים נשמרים כאן בכל מקרה.</p>'}
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
      <label>הסיסמה הנוכחית <input name="current" type="password" required dir="ltr" autocomplete="current-password"><small>לאישור השינוי: המייל הזה מקבל את קישורי איפוס הסיסמה.</small></label>
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
  ${await signinsPanel()}
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
        const p = passwordProblem(next, ctx.user);
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
        const me = await one('SELECT password_hash FROM users WHERE id = $1', [ctx.user.id]);
        if (!(await verifyPassword(String(ctx.form.get('current') || ''), me.password_hash))) return back('הסיסמה הנוכחית שגויה.', 'error');
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
          : back('השליחה נכשלה. צריך להגדיר RESEND_API_KEY ו־MAIL_FROM במשתני הסביבה של האפליקציה בשרת (ולאמת את הדומיין ב־Resend).', 'error');
      }
      case 'totp-start': {
        await q('UPDATE users SET totp_secret = $1 WHERE id = $2 AND NOT totp_enabled', [newSecret(), ctx.user.id]);
        return back(null, 'ok', '#twostep');
      }
      case 'totp-cancel': {
        await q('UPDATE users SET totp_secret = NULL WHERE id = $1 AND NOT totp_enabled', [ctx.user.id]);
        return back('ההפעלה בוטלה. האימות הדו־שלבי כבוי.', 'ok', '#twostep');
      }
      case 'totp-confirm': {
        const u = await one('SELECT totp_secret, totp_enabled FROM users WHERE id = $1', [ctx.user.id]);
        if (u.totp_enabled) return back('האימות הדו־שלבי כבר פעיל.', 'ok', '#twostep');
        const step = matchCode(u.totp_secret, f('code'));
        if (step === null) return back('הקוד לא תאם. ודאו שהשעה בטלפון מכוונת אוטומטית, והקלידו את הקוד שמופיע עכשיו.', 'error', '#twostep');
        const { codes, hashes } = newRecoveryCodes();
        await q(`UPDATE users SET totp_enabled = true, totp_since = now(), totp_last_step = $1, recovery_codes = $2::jsonb WHERE id = $3`,
          [step, JSON.stringify(hashes), ctx.user.id]);
        await endOtherSessions(ctx.user.id, ctx.request);
        await logActivity(ctx, 'הפעיל אימות דו־שלבי');
        return html(await recoveryPage(ctx, codes, true));
      }
      case 'totp-codes': {
        const u = await one('SELECT totp_secret, totp_last_step, totp_enabled FROM users WHERE id = $1', [ctx.user.id]);
        const step = u.totp_enabled ? matchCode(u.totp_secret, f('code'), Number(u.totp_last_step)) : null;
        if (step === null) return back('הקוד מהאפליקציה שגוי.', 'error', '#twostep');
        const { codes, hashes } = newRecoveryCodes();
        await q('UPDATE users SET totp_last_step = $1, recovery_codes = $2::jsonb WHERE id = $3', [step, JSON.stringify(hashes), ctx.user.id]);
        await logActivity(ctx, 'יצר קודי גיבוי חדשים');
        return html(await recoveryPage(ctx, codes, false));
      }
      case 'totp-disable': {
        const u = await one('SELECT password_hash, totp_secret, totp_last_step, totp_enabled FROM users WHERE id = $1', [ctx.user.id]);
        if (!u.totp_enabled) return back('', 'ok', '#twostep');
        if (!(await verifyPassword(String(ctx.form.get('password') || ''), u.password_hash))) return back('הסיסמה שגויה.', 'error', '#twostep');
        if (matchCode(u.totp_secret, f('code'), Number(u.totp_last_step)) === null) return back('הקוד מהאפליקציה שגוי.', 'error', '#twostep');
        await q(`UPDATE users SET totp_enabled = false, totp_secret = NULL, totp_since = NULL, recovery_codes = '[]'::jsonb WHERE id = $1`, [ctx.user.id]);
        await logActivity(ctx, 'כיבה אימות דו־שלבי');
        return back('האימות הדו־שלבי כבוי. הכניסה עכשיו בסיסמה בלבד.', 'ok', '#twostep');
      }
      case 'signout-others': {
        await endOtherSessions(ctx.user.id, ctx.request);
        return back('כל שאר המכשירים נותקו.', 'ok', '#devices');
      }
      default:
        return back('');
    }
  },
};
