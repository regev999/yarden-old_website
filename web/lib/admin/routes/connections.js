/**
 * "חיבורים": the outside services' credentials (Cardcom, Resend, Rav-Messer),
 * entered here instead of on the server. Secrets are stored encrypted and never
 * shown back; a value set on the server is shown as such and can't be changed here.
 */
import { createLowProfile, isConfigured as cardcomReady } from '../../cardcom';
import { describe, canStoreSecrets, save } from '../../integrations';
import { mailReady, sendMail } from '../../mail';
import { isConfigured as ravmesserReady, testConnection as ravmesserTest } from '../../ravmesser';
import { siteBase } from '../../shop';
import { logActivity, publishChanges } from '../common';
import { adminPage, csrfField, esc, html, redirect } from '../ui';

const DOC_TYPES = [
  ['TaxInvoiceAndReceipt', 'חשבונית מס קבלה (עוסק מורשה)'],
  ['Receipt', 'קבלה (עוסק פטור)'],
  ['none', 'בלי מסמך (אין מודול מסמכים במסוף)'],
];

/** One field: editable, or read-only when the server sets it. Secrets are never filled in. */
function field(d, name, label, { secret = false, hint = '', placeholder = '', inputmode = '' } = {}) {
  const f = d[name];
  if (f.fromServer) {
    return `<label>${esc(label)} <input value="${secret ? '••••••••' : esc(f.value)}" disabled dir="ltr"><small>מוגדר בשרת (משתנה ${esc(name)}), ולכן לא נערך כאן.</small></label>`;
  }
  const status = secret && f.unreadable ? '<small class="field-error">הערך השמור לא נקרא (מפתח ההצפנה בשרת השתנה). הזינו אותו שוב.</small>'
    : secret && f.saved ? '<small>נשמר ✓ (מוסתר). השאירו ריק כדי לא לשנות.</small>' : (hint ? `<small>${hint}</small>` : '');
  return `<label>${esc(label)} <input name="${name}" ${secret ? 'type="password" autocomplete="new-password"' : 'autocomplete="off"'}
    value="${secret ? '' : esc(f.value)}" dir="ltr"${placeholder ? ` placeholder="${esc(placeholder)}"` : ''}${inputmode ? ` inputmode="${inputmode}"` : ''}>${status}</label>`;
}

const state = (on, yes, no) => `<p class="conn-state ${on ? 'conn-state--on' : ''}">${on ? `● ${yes}` : `○ ${no}`}</p>`;

export const page = {
  async GET(ctx) {
    const d = await describe();
    const [cardcom, mail, rav] = await Promise.all([cardcomReady(), mailReady(), ravmesserReady()]);
    const docNow = d.CARDCOM_CREATE_DOCUMENT.value === 'false' ? 'none' : (d.CARDCOM_DOCUMENT_TYPE.value || 'TaxInvoiceAndReceipt');
    const docLocked = d.CARDCOM_CREATE_DOCUMENT.fromServer || d.CARDCOM_DOCUMENT_TYPE.fromServer;
    const noKey = canStoreSecrets() ? '' : '<p class="notice notice--error">אי אפשר לשמור סיסמאות: חסר בשרת משתנה שממנו נגזר מפתח ההצפנה (ADMIN_SETUP_KEY או SETTINGS_SECRET).</p>';
    const body = `${noKey}
<p class="muted">כאן מחברים את השירותים החיצוניים של האתר. סיסמאות ומפתחות נשמרים מוצפנים ולא מוצגים שוב אחרי השמירה.</p>

<section class="panel" id="cardcom">
  <h2>קארדקום (סליקה)</h2>
  ${state(cardcom, 'מחובר: כפתורי התשלום פעילים באתר', 'לא מחובר: כפתורי התשלום לא מוצגים באתר')}
  <form method="post" class="stack narrow-form" autocomplete="off">${csrfField(ctx)}<input type="hidden" name="service" value="cardcom">
    ${field(d, 'CARDCOM_TERMINAL_NUMBER', 'מספר מסוף', { inputmode: 'numeric', hint: 'מופיע בממשק קארדקום, בדרך כלל 4–7 ספרות.' })}
    ${field(d, 'CARDCOM_API_NAME', 'API Name (שם משתמש ל־API)', { hint: 'בממשק קארדקום: הגדרות ← ניהול מפתחות API.' })}
    ${field(d, 'CARDCOM_API_PASSWORD', 'API Password', { secret: true, hint: 'באותו מקום. נדרש להפקת חשבוניות וקבלות.' })}
    <label>מה נשלח לקונה אחרי התשלום
      <select name="doc"${docLocked ? ' disabled' : ''}>${DOC_TYPES.map(([v, l]) => `<option value="${v}"${v === docNow ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <small>${docLocked ? 'מוגדר בשרת.' : 'המסמך נשלח במייל לקונה ונשמר בקארדקום. "בלי מסמך" רק אם אין במסוף מודול מסמכים.'}</small></label>
    <div class="actions">
      <button class="btn" type="submit" name="action" value="save">שמירה</button>
      <button class="btn btn--quiet" type="submit" name="action" value="test">בדיקת חיבור</button>
    </div>
    <p class="muted small">בדיקת החיבור פותחת בקארדקום עמוד תשלום של ‎1 ₪‎ ולא משלמת בו: כך רואים שהפרטים נכונים, בלי חיוב.</p>
  </form>
  ${cardcom ? `<form method="post" data-confirm="לנתק את קארדקום? כפתורי התשלום ייעלמו מהאתר.">${csrfField(ctx)}<input type="hidden" name="service" value="cardcom">
    <button class="linklike linklike--danger" type="submit" name="action" value="clear">ניתוק קארדקום</button></form>` : ''}
</section>

<section class="panel" id="mail">
  <h2>מיילים (Resend)</h2>
  ${state(mail, 'מחובר: התראות על לידים ומכירות, ואיפוס סיסמה', 'לא מחובר: לא נשלחים מיילים מהאתר')}
  <form method="post" class="stack narrow-form" autocomplete="off">${csrfField(ctx)}<input type="hidden" name="service" value="mail">
    ${field(d, 'RESEND_API_KEY', 'מפתח API של Resend', { secret: true, hint: 'נרשמים בחינם ב־resend.com ← API Keys ← Create API Key.' })}
    ${field(d, 'MAIL_FROM', 'כתובת השולח', { placeholder: 'אתר ירדן כרם <site@yardenkerem.co.il>', hint: 'כתובת בדומיין שאומת ב־Resend. בלי זה המיילים יוצאים מכתובת הבדיקה של Resend.' })}
    <div class="actions">
      <button class="btn" type="submit" name="action" value="save">שמירה</button>
      <button class="btn btn--quiet" type="submit" name="action" value="test">שליחת מייל בדיקה אליי</button>
    </div>
    <p class="muted small">לאן יגיעו ההתראות על לידים ומכירות: <a href="/admin/settings/">בהגדרות</a>.</p>
  </form>
</section>

<section class="panel" id="ravmesser">
  <h2>רב־מסר (רשימות תפוצה)</h2>
  ${state(rav, 'מחובר: קונים נרשמים אוטומטית לרשימה של המוצר', 'לא מחובר (לא חובה)')}
  <form method="post" class="stack narrow-form" autocomplete="off">${csrfField(ctx)}<input type="hidden" name="service" value="ravmesser">
    ${field(d, 'RAVMESSER_CLIENT_ID', 'Client ID')}
    ${field(d, 'RAVMESSER_CLIENT_SECRET', 'Client Secret', { secret: true })}
    ${field(d, 'RAVMESSER_USER_TOKEN', 'User Token', { secret: true, hint: 'שלושת הפרטים מתקבלים מרב־מסר (Responder) לחיבור API.' })}
    <div class="actions">
      <button class="btn" type="submit" name="action" value="save">שמירה</button>
      <button class="btn btn--quiet" type="submit" name="action" value="test">בדיקת חיבור</button>
    </div>
  </form>
</section>`;
    return html(await adminPage(ctx, { title: 'חיבורים', active: 'connections', body }));
  },

  async POST(ctx) {
    const service = String(ctx.form.get('service') || '');
    const action = String(ctx.form.get('action') || 'save');
    const back = (text, type = 'ok') => redirect(`/admin/connections/#${service}`, text, type);
    const f = (n, max = 300) => {
      const v = ctx.form.get(n);
      return v === null ? undefined : String(v).trim().slice(0, max);
    };
    const keep = (values) => Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));

    if (service === 'cardcom') {
      if (action === 'clear') {
        await save({ CARDCOM_TERMINAL_NUMBER: null, CARDCOM_API_NAME: null, CARDCOM_API_PASSWORD: null, CARDCOM_DOCUMENT_TYPE: null, CARDCOM_CREATE_DOCUMENT: null });
        publishChanges();
        await logActivity(ctx, 'ניתק את קארדקום', '');
        return back('קארדקום נותק. כפתורי התשלום הוסרו מהאתר.');
      }
      if (action === 'save') {
        const terminal = f('CARDCOM_TERMINAL_NUMBER', 20);
        if (terminal && !/^\d{1,12}$/.test(terminal)) return back('מספר המסוף צריך להכיל ספרות בלבד.', 'error');
        const doc = f('doc', 40);
        const values = keep({ CARDCOM_TERMINAL_NUMBER: terminal, CARDCOM_API_NAME: f('CARDCOM_API_NAME', 120), CARDCOM_API_PASSWORD: f('CARDCOM_API_PASSWORD', 200) });
        if (doc !== undefined && DOC_TYPES.some(([v]) => v === doc)) {
          Object.assign(values, doc === 'none' ? { CARDCOM_CREATE_DOCUMENT: 'false', CARDCOM_DOCUMENT_TYPE: null } : { CARDCOM_CREATE_DOCUMENT: null, CARDCOM_DOCUMENT_TYPE: doc });
        }
        if (values.CARDCOM_API_PASSWORD && !canStoreSecrets()) return back('אי אפשר לשמור את הסיסמה: חסר מפתח הצפנה בשרת.', 'error');
        await save(values);
        publishChanges(); // pages with products show (or hide) their buy section
        await logActivity(ctx, 'עדכן את חיבור קארדקום', '');
        return back((await cardcomReady()) ? 'נשמר. מומלץ ללחוץ על "בדיקת חיבור".' : 'נשמר. כדי לחבר צריך גם מספר מסוף וגם API Name.');
      }
      if (action === 'test') {
        if (!(await cardcomReady())) return back('קודם שומרים מספר מסוף ו־API Name.', 'error');
        const base = siteBase(ctx.request);
        const r = await createLowProfile({
          amountShekel: 1, productName: 'בדיקת חיבור מהאתר', orderId: 'connection-test',
          successUrl: `${base}/`, failedUrl: `${base}/`, webhookUrl: `${base}/api/cardcom-webhook/`, maxPayments: 1,
        });
        if (r.ok) return back('החיבור לקארדקום תקין ✓ (נפתח עמוד תשלום לבדיקה, ולא חויב דבר).');
        const code = r.raw?.ResponseCode ?? r.raw?.responseCode;
        const hint = code === 650 || /document/i.test(r.error || '') ? ' נראה שאין במסוף מודול מסמכים: בחרו "בלי מסמך" ושמרו.' : '';
        return back(`קארדקום החזירה שגיאה: ${r.error}.${hint}`, 'error');
      }
    }

    if (service === 'mail') {
      if (action === 'save') {
        const from = f('MAIL_FROM', 200);
        if (from && !/^[^<>]*<[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>$|^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(from)) return back('כתובת השולח לא תקינה. למשל: אתר ירדן כרם <site@yardenkerem.co.il>', 'error');
        const values = keep({ RESEND_API_KEY: f('RESEND_API_KEY', 200), MAIL_FROM: from });
        if (values.RESEND_API_KEY && !canStoreSecrets()) return back('אי אפשר לשמור את המפתח: חסר מפתח הצפנה בשרת.', 'error');
        await save(values);
        await logActivity(ctx, 'עדכן את חיבור המיילים', '');
        return back('נשמר. מומלץ לשלוח מייל בדיקה.');
      }
      if (action === 'test') {
        if (!(await mailReady())) return back('קודם שומרים מפתח API של Resend.', 'error');
        const sent = await sendMail({ to: ctx.user.email, subject: 'בדיקת מיילים מהאתר', text: 'אם המייל הזה הגיע, שליחת המיילים מהאתר עובדת.\n' });
        return sent ? back(`נשלח מייל בדיקה אל ${ctx.user.email}. אם לא הגיע תוך דקה, בדקו בספאם.`)
          : back('השליחה נכשלה. בדקו את המפתח, ושכתובת השולח בדומיין שאומת ב־Resend.', 'error');
      }
    }

    if (service === 'ravmesser') {
      if (action === 'save') {
        const values = keep({ RAVMESSER_CLIENT_ID: f('RAVMESSER_CLIENT_ID', 120), RAVMESSER_CLIENT_SECRET: f('RAVMESSER_CLIENT_SECRET', 300), RAVMESSER_USER_TOKEN: f('RAVMESSER_USER_TOKEN', 300) });
        if ((values.RAVMESSER_CLIENT_SECRET || values.RAVMESSER_USER_TOKEN) && !canStoreSecrets()) return back('אי אפשר לשמור: חסר מפתח הצפנה בשרת.', 'error');
        await save(values);
        await logActivity(ctx, 'עדכן את חיבור רב־מסר', '');
        return back('נשמר. מומלץ ללחוץ על "בדיקת חיבור".');
      }
      if (action === 'test') {
        const r = await ravmesserTest();
        return r.ok ? back('החיבור לרב־מסר תקין ✓') : back(`רב־מסר החזירה שגיאה: ${r.error}`, 'error');
      }
    }
    return back('הפעולה לא מוכרת.', 'error');
  },
};
