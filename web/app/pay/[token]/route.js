/**
 * A payment link, /pay/<token>/: a charge made in the admin with no product
 * or page behind it (registration fee, deposit, an agreed price). Asks who is
 * paying, then goes on to Cardcom like any other purchase. The amount shown
 * is read again on the server when "pay" is pressed, so the address can't
 * change it. Not indexed; it only reaches whoever it was sent to.
 */
import { pageDocument } from '@/lib/shell';
import { getSetting } from '@/lib/db';
import { esc } from '@/lib/html';
import { isConfigured } from '@/lib/cardcom';
import { installmentsText, linkByToken, linkState, paidLinkCount, shekels } from '@/lib/shop';

export const dynamic = 'force-dynamic';

function page(title, main, status = 200) {
  return getSetting('ga_id', '').then((gaId) => new Response(
    pageDocument({ path: '/pay/', title, seoTitle: `${title} - תשלום מאובטח`, noindex: true, main, gaId }),
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } },
  ));
}

const hero = (title, sub = '') => `<header class="page-hero"><div class="wrap">
<p class="crumb">תשלום מאובטח</p>
<h1>${esc(title)}</h1>${sub ? `<p class="page-hero__sub">${esc(sub)}</p>` : ''}
</div></header>`;

export async function GET(request, { params }) {
  const { token } = await params;
  const t = String(token || '').slice(0, 120);
  const link = /^[\w-]+$/.test(t) ? await linkByToken(t) : null;
  const state = linkState(link, link?.max_uses != null ? await paidLinkCount(link.id) : 0);

  // Back from Cardcom after paying: thank them, even though a single-use link is now used up
  if (link && new URL(request.url).searchParams.get('payment') === 'success') {
    return page(link.title, `${hero('תודה, התשלום התקבל', link.title)}
<section class="block"><div class="wrap"><div class="paybox">
<p>קבלה נשלחת אליכם במייל. אם יש שאלה, אפשר לפנות לירדן ישירות.</p>
<div class="actions"><a class="btn" href="/">לדף הבית</a><a class="btn btn--line" href="/צור-קשר/">יצירת קשר</a></div>
</div></div></section>`);
  }

  const ready = await isConfigured();
  if (!state.ok || !ready) {
    const msg = !ready ? 'התשלום באתר עוד לא הופעל.' : state.message;
    return page('תשלום', `${hero('התשלום לא זמין', msg)}
<section class="block"><div class="wrap"><div class="paybox">
<p>אם קיבלתם את הקישור מירדן, כדאי לפנות אליה ישירות ולבקש קישור חדש.</p>
<div class="actions"><a class="btn" href="/צור-קשר/">יצירת קשר</a></div>
</div></div></section>`, state.reason === 'not_found' ? 404 : 410);
  }

  return page(link.title, `${hero(link.title, link.description)}
<section class="block"><div class="wrap"><div class="paybox">
<p class="price"><b>${shekels(link.amount_agorot)} ₪</b><span>${esc(installmentsText(link.amount_agorot, link.max_payments))}</span></p>
<form class="form paybox__form" data-checkout-token="${esc(link.token)}" novalidate>
<label class="form__full">שם מלא<input name="name" required autocomplete="name"></label>
<label>טלפון<input name="phone" type="tel" required autocomplete="tel" inputmode="tel"></label>
<label>מייל, לקבלה<input name="email" type="email" required autocomplete="email" dir="ltr"></label>
<button class="btn" type="submit">להמשך לתשלום מאובטח</button>
<p class="form__status" role="status"></p>
</form>
<p class="secure-note">התשלום בעמוד המאובטח של קארדקום. חשבונית נשלחת אליכם במייל.</p>
</div></div></section>`);
}

export const HEAD = GET;
