/** Site header, navigation and footer (same markup as the static build). */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { EMAIL, PHONE, PHONE_INTL, SITE_NAME, SITE_URL, absUrl, esc, formFallback, fullDescription, fullTitle, lazyVideoThumbs, siteLd } from './html';
import { versionAssets } from './versions';

/** ?v=<hash> on each asset, so browsers fetch it again as soon as it changes (assets are cached for 30 days). */
const assetVersions = {};
function asset(file) {
  if (!(file in assetVersions)) {
    try {
      assetVersions[file] = createHash('sha1').update(readFileSync(path.join(process.cwd(), 'public', 'assets', file))).digest('hex').slice(0, 10);
    } catch { assetVersions[file] = ''; }
  }
  return `/assets/${file}${assetVersions[file] ? `?v=${assetVersions[file]}` : ''}`;
}

export const SITE_TITLE = 'ירדן כרם - התמקדות, הקומי, Somatic Experiencing';
const TAGLINE = 'התמקדות, הקומי, Somatic Experiencing';

export const NAV = [
  ['טיפול', [
    ['טיפול אישי', '/טיפול-אישי/'], ['כל סוגי הטיפול', '/טיפולים-פרטניים/'], ['התמקדות', '/התמקדות/'],
    ['Somatic Experiencing', '/טיפול-בטראומה-2/'], ['הקומי', '/הקומי/'],
    ['וידאו תרפיה', '/וידאו-תרפיה/'], ['פוטותרפיה', '/פוטותרפיה/'],
    ['טיפול במגע: שיטת גרינברג', '/גרינברג/'], ['שיטת פאולה', '/שיטת-פאולה/'],
  ]],
  ['קורסים', [
    ['קורסי התמקדות', '/קורסים/'], ['טראומה מורכבת', '/טראומה-מורכבת/'],
    ['The Inner Freedom Map', '/פוקוסינג-לחיי-היום-יום/'], ['אפליקציית Focusing Parts Map', '/focusing-parts-map/'],
  ]],
  ['על ירדן', [
    ['אודות', '/אודות/'], ['לקוחות מספרים', '/לקוחות-מספרים/'], ['המלצות בווידאו', '/המלצות/'],
    ['כתבו עליי', '/מן-העיתונות-כתבו-עליי/'], ['מאמרים שפרסמתי בעיתונות', '/מן-העיתונות-אני-כתבתי/'],
  ]],
  ['מאמרים', [
    ['על התמקדות', '/מאמרים-שאני-כתבתי/'], ['על טיפול בטראומה', '/מאמרים-שלי-בנושא-טיפול-בטראומה/'],
    ['נושאים כלליים', '/מאמרים-שלי-בנושאים-כלליים/'], ["מאמרים של יוג'ין ג'נדלין", '/מאמרים-שכתב-יוגין-גנדלין/'],
    ['בלוג', '/בלוג/'],
  ]],
  ['פודקאסט', '/פודקאסט/'],
];

export function navHtml(current) {
  return NAV.map(([label, target]) => {
    if (typeof target === 'string') {
      return `<li><a href="${esc(target)}"${target === current ? ' aria-current="page"' : ''}>${esc(label)}</a></li>`;
    }
    const sub = target.map(([t, h]) => `<li><a href="${esc(h)}"${h === current ? ' aria-current=page' : ''}>${esc(t)}</a></li>`).join('');
    return `<li class="has-sub"><span class="nav__label" tabindex="0">${esc(label)}</span>`
      + `<button class="nav__toggle" type="button" aria-expanded="false" aria-label="${esc(label)}: פתיחת תפריט"></button>`
      + `<ul class="nav__sub">${sub}</ul></li>`;
  }).join('');
}

export function headerHtml(current, book = '#contact') {
  return `<header class="site-header">
  <div class="wrap site-header__inner">
    <a class="brand" href="/"><b>${SITE_NAME}</b><span>התמקדות וטיפול דרך הגוף</span></a>
    <nav id="nav" class="nav" aria-label="ניווט ראשי"><ul>${navHtml(current)}</ul></nav>
    <a class="btn btn--sm header-cta" href="${book}">קביעת פגישה</a>
    <button class="menu-btn" type="button" aria-expanded="false" aria-controls="nav">תפריט</button>
  </div>
</header>`;
}

/** Phones: the three ways to get in touch, where the thumb is. */
function actionBarHtml(book) {
  return `<nav class="actionbar" aria-label="יצירת קשר מהירה">
  <a class="actionbar__btn actionbar__btn--primary" href="${book}">קביעת פגישה</a>
  <a class="actionbar__btn" href="https://wa.me/${PHONE_INTL}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z"/></svg>וואטסאפ</a>
  <a class="actionbar__btn" href="tel:+${PHONE_INTL}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1l-2.3 2.2Z"/></svg>התקשרות</a>
</nav>`;
}

export function footerHtml() {
  return `<footer class="site-footer">
  <div class="wrap">
    <div class="site-footer__grid">
      <div>
        <p class="site-footer__brand">${SITE_NAME}</p>
        <p class="quiet">טיפול, קורסים והרצאות בגישת ההתמקדות, Somatic Experiencing והקומי.</p>
        <p><a href="https://www.focusingfreedom.co.il/" target="_blank" rel="noopener">Focusing for Freedom</a></p>
      </div>
      <div><h2>טיפול וקורסים</h2><ul>
        <li><a href="/טיפול-אישי/">טיפול אישי</a></li><li><a href="/קורסים/">קורסי התמקדות</a></li>
        <li><a href="/טראומה-מורכבת/">טראומה מורכבת</a></li><li><a href="/פוקוסינג-לחיי-היום-יום/">The Inner Freedom Map</a></li>
        <li><a href="/focusing-parts-map/">אפליקציית Focusing Parts Map</a></li></ul></div>
      <div><h2>לקרוא ולהאזין</h2><ul>
        <li><a href="/מאמרים-שאני-כתבתי/">מאמרים</a></li><li><a href="/בלוג/">בלוג</a></li>
        <li><a href="/פודקאסט/">פודקאסט</a></li><li><a href="/לקוחות-מספרים/">לקוחות מספרים</a></li></ul></div>
      <div><h2>יצירת קשר</h2><ul>
        <li><a href="tel:+${PHONE_INTL}" dir="ltr">${PHONE}</a></li><li><a href="mailto:${EMAIL}">${EMAIL}</a></li>
        <li><a href="/מדיניות-פרטיות/">מדיניות פרטיות</a></li>
        <li><a href="/תנאי-שימוש/">תנאי שימוש</a></li>
        <li><a href="/הצהרת-נגישות/">הצהרת נגישות</a></li>
        <li><button type="button" class="footer-cookie" data-consent-open>הגדרות עוגיות</button></li></ul></div>
    </div>
    <p class="site-footer__bottom">© ${new Date().getFullYear()} ${SITE_NAME}</p>
  </div>
</footer>
<a class="whatsapp" href="https://wa.me/${PHONE_INTL}" target="_blank" rel="noopener" aria-label="שליחת הודעה בוואטסאפ">
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z"/></svg>
</a>`;
}

function gaTags(id) {
  if (!/^G-[A-Z0-9]+$/.test(id || '')) return '';
  return `<script type="text/plain" data-consent="analytics" data-src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>`
    + `<script type="text/plain" data-consent="analytics">window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}`
    + `gtag("js",new Date());gtag("config","${id}",{anonymize_ip:true});</script>`;
}

/**
 * Chrome and Edge load a page in the background once the pointer rests on a
 * link to it (or a finger touches it), so the click opens it instantly. Only
 * plain public pages: not the admin, forms' endpoints, payment or downloads.
 */
const SPECULATION = `<script type="speculationrules">${JSON.stringify({
  prerender: [{
    where: { and: [
      { href_matches: '/*' },
      { not: { href_matches: ['/admin/*', '/api/*', '/pay/*', '/files/*', '/*.xml', '/*\\?*'] } },
      { not: { selector_matches: '[target], [download], [data-no-prerender]' } },
    ] },
    eagerness: 'moderate',
  }],
})}</script>`;

function ldScript(ld) {
  if (!ld) return '';
  return `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`;
}

/**
 * The full HTML document for a public page. `main` is the finished <main>
 * content; everything else is head metadata.
 */
export function pageDocument({ path, title, seoTitle, description, canonical, ogType, ogImage, noindex, ld, main, gaId, extraHead = '', extraBody = '' }) {
  const docTitle = fullTitle(title, seoTitle, path);
  const plainDesc = fullDescription(description, main) || `${SITE_NAME} – ${TAGLINE}. טיפול אישי וקורסים בגישת ההתמקדות, בהרצליה ובזום.`;
  const desc = esc(plainDesc);
  const canon = absUrl(canonical || path);
  // Pages kept out of search get no structured data; the rest describe the site, Yarden and the page
  const graph = noindex ? null : siteLd({ path: canonical || path, name: title || SITE_NAME, description: plainDesc, extra: ld });
  // Pages without the contact block (legal pages) send "book a session" to the contact page
  const book = main.includes('id="contact"') ? '#contact' : '/צור-קשר/#contact';
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(docTitle)}</title>
${noindex ? '<meta name="robots" content="noindex, follow">\n' : ''}<meta name="description" content="${desc}">
<link rel="canonical" href="${canon}">
<meta property="og:type" content="${esc(ogType || 'website')}">
<meta property="og:title" content="${esc(title || SITE_NAME)}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${canon}">
<meta property="og:locale" content="he_IL">
<meta property="og:site_name" content="${SITE_NAME}">
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">${/\/og\//.test(ogImage) ? '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">' : ''}<meta name="twitter:card" content="summary_large_image">` : ''}
<meta name="theme-color" content="#0f2140">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/assets/fonts/IBMPlexSansHebrew-ExtraLight.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/IBMPlexSansHebrew-Regular.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${asset('style.css')}">
<script src="${asset('a11y.js')}"></script>
<script src="${asset('consent.js')}" defer></script>
${gaTags(gaId)}
<link rel="alternate" type="application/rss+xml" title="${esc(SITE_TITLE)}" href="${SITE_URL}/feed/">
${ldScript(graph)}${SPECULATION}${extraHead}
</head>
<body>
<a class="skip" href="#main">דילוג לתוכן</a>
${headerHtml(path, book)}
<main id="main">
${versionAssets(lazyVideoThumbs(formFallback(main)))}
</main>
${footerHtml()}
${actionBarHtml(book)}
<script>window.SITE_FORM = {endpoint: "/api/lead/", email: ${JSON.stringify(EMAIL)}};</script>
<script src="${asset('main.js')}" defer></script>${extraBody}
</body>
</html>
`;
}
