/**
 * Pure helpers that build the site's HTML fragments. Only pure imports, so
 * they run the same on the server, in scripts and in tests.
 */
import { artForPost, artVariant } from './art';

export const SITE_NAME = 'ירדן כרם';
// Every page title ends with the site name. The old site added the whole tagline, which pushed
// most titles past what Google shows (about 60 characters), so it is cut down to the name.
export const TITLE_SUFFIX = ' | ירדן כרם';
const OLD_TITLE_SUFFIX = / - ירדן כרם - (התמקדות, הקומי, Somatic Experiencing|Somatic Experience - פסיכותרפיה)$/;
export const HOME_TITLE = 'ירדן כרם | התמקדות, הקומי ו-Somatic Experiencing בהרצליה';
export const SITE_URL = (typeof process !== 'undefined' && process.env.SITE_URL) || 'https://www.yardenkerem.co.il';
export const PHONE = '054-4250910';
export const PHONE_INTL = '972544250910';
export const EMAIL = 'yardenkerem@gmail.com';
export const ESSAY_CATEGORIES = ['מאמרים-שאני-כתבתי', 'מאמרים-שלי-בנושא-טיפול-בטראומה', 'מאמרים-שלי-בנושאים-כלליים'];

export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Percent-encode a path the way WordPress did (lowercase hex). */
export function enc(path) {
  return String(path).split('/').map((s) => encodeURIComponent(s)).join('/').replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase());
}

/** The <title> of a page: its own SEO title if it has one, otherwise its name, then the site name. */
export function fullTitle(title, seoTitle, path = '') {
  const seo = String(seoTitle || '').trim();
  if (path === '/' && (!seo || OLD_TITLE_SUFFIX.test(seo))) return HOME_TITLE;
  const core = seo.replace(OLD_TITLE_SUFFIX, '') || String(title || '').trim();
  if (!core) return SITE_NAME;
  return core.includes(SITE_NAME) ? core : core + TITLE_SUFFIX;
}

/**
 * A description long enough for search results (70–160 characters): short
 * ones are continued with the opening words of the page itself.
 */
export function fullDescription(desc, main = '') {
  const d = String(desc || '').trim();
  if ([...d].length >= 70) return d;
  // the page's own words: an article's body, or the page without its title block
  const body = /<article\b[\s\S]*?<\/article>/.exec(main)?.[0] || String(main).replace(/<header class="page-hero"[\s\S]*?<\/header>/, '');
  let text = plain(body.replace(/<(script|style|nav|form|h1)\b[\s\S]*?<\/\1>/g, '').replace(/<p class="tags">[\s\S]*?<\/p>/g, ''));
  if (d && text.startsWith(d)) text = text.slice(d.length).replace(/^[\s.?!]+/, '');
  const start = d ? (/[.?!]$/.test(d) ? d : d + '.') + ' ' : '';
  const room = 155 - [...start].length;
  if (!d && !text) return '';
  if (text.split(' ').length < 6 || room < 30) {
    return d ? `${start}${SITE_NAME}, מטפלת ומרצה לגישת ההתמקדות, Somatic Experiencing והקומי.` : '';
  }
  let tail = text.length > room ? text.slice(0, room).replace(/\s+\S*$/, '') : text;
  tail = tail.replace(/[,;:\-–\s]+$/, '');
  return start + tail + (text.length > tail.length ? '…' : '');
}

export function absUrl(path) {
  return SITE_URL.replace(/\/$/, '') + enc(path);
}

export function toDate(d) {
  if (d instanceof Date) return d;
  return new Date(String(d).replace(' ', 'T'));
}

export function ymd(d) {
  const t = toDate(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
export function heDate(d) {
  const t = toDate(d);
  return `${t.getDate()} ב${MONTHS[t.getMonth()]} ${t.getFullYear()}`;
}

export function shortDate(d, withTime = false) {
  const t = toDate(d);
  const p = (n) => String(n).padStart(2, '0');
  const s = `${p(t.getDate())}.${p(t.getMonth() + 1)}.${t.getFullYear()}`;
  return withTime ? `${s} ${p(t.getHours())}:${p(t.getMinutes())}` : s;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ', '#160': ' ' };
function decodeRef(num, fallback) {
  const n = /^x/i.test(num) ? parseInt(num.slice(1), 16) : parseInt(num, 10);
  return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : fallback;
}
export function plain(html, limit = 0) {
  let t = String(html || '')
    .replace(/<(br|\/p|\/li|\/h\d)[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#?\w+);/g, (m, e) => ENTITIES[e] ?? (e[0] === '#' ? decodeRef(e.slice(1), m) : m))
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (limit && t.length > limit) {
    const cut = t.slice(0, limit);
    const sp = cut.lastIndexOf(' ');
    t = (sp > 0 ? cut.slice(0, sp) : cut) + '…';
  }
  return t;
}

export function youtubeId(s) {
  const m = /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^\s"'<]*&(?:amp;)?)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/.exec(String(s || ''));
  return m ? m[1] : null;
}

export function videoEmbed(id, title = '') {
  const label = esc(title || 'סרטון');
  return `<div class="video" data-yt="${esc(id)}"><button type="button" class="video__play" aria-label="הפעלת סרטון: ${label}" style="background-image:url(https://i.ytimg.com/vi/${esc(id)}/hqdefault.jpg)"><span class="video__icon" aria-hidden="true"></span></button></div>`;
}

/* ---------------------------------------------------------------- lists */

export function excerptOf(p, n = 140) {
  const src = p.excerpt ? p.excerpt : plain(p.body);
  return src.length > n ? plain(src, n) : src;
}

export function entriesHtml(posts, single = false) {
  if (!posts.length) return '';
  const rows = posts.map((p) => {
    const ex = excerptOf(p, 140);
    const yt = youtubeId(p.body) || /data-yt="([\w-]{11})"/.exec(p.body || '')?.[1];
    const img = yt ? `https://i.ytimg.com/vi/${yt}/mqdefault.jpg` : /<img[^>]+src="(\/wp-content\/uploads\/[^"]+)"/.exec(p.body || '')?.[1];
    // The subject's motif is always underneath, so a picture that fails to load leaves a designed cover
    const thumb = single ? '' : `<span class="entries__thumb entries__thumb--art${yt ? ' entries__thumb--video' : ''}" data-art="${artForPost(p)}" style="${artVariant(p.path)}" aria-hidden="true">`
      + `${img ? `<img src="${esc(img)}" alt="" loading="lazy" decoding="async">` : ''}</span>`;
    const meta = heDate(p.date) + (p.is_video && ex.length < 40 ? ', סרטון' : '');
    return `<li><a href="${esc(p.path)}">${thumb}<h3>${esc(p.title)}</h3>${ex ? `<p>${esc(ex)}</p>` : ''}<small>${esc(meta)}</small></a></li>`;
  });
  return `<ul class="entries${single ? ' entries--single' : ''}">${rows.join('')}</ul>`;
}

export function blogHtml(posts, categories) {
  const nav = categories
    .map((c) => ({ ...c, n: posts.filter((p) => p.categories.includes(c.slug)).length }))
    .filter((c) => c.n)
    .map((c) => `<li><a href="/category/${esc(c.slug)}/">${esc(c.name)}</a> <span class="quiet">${c.n}</span></li>`)
    .join('');
  const years = new Map();
  for (const p of posts) {
    const y = String(toDate(p.date).getFullYear());
    if (!years.has(y)) years.set(y, []);
    years.get(y).push(p);
  }
  const blocks = [...years].map(([y, ps]) => `<section class="year"><h2>${y}</h2>${entriesHtml(ps)}</section>`).join('');
  return `<nav class="topic-nav" aria-label="נושאים"><ul>${nav}</ul></nav>${blocks}`;
}

export function testimonialsHtml(items) {
  const cards = items.map((t) => `<figure class="quote"><blockquote class="prose">${t.body}</blockquote><figcaption><strong>${esc(t.name)}</strong>${t.role ? ` · ${esc(t.role)}` : ''}</figcaption></figure>`);
  return `<div class="quotes">${cards.join('')}</div>`;
}

export function voicesHtml(items) {
  const n = items.length;
  const voices = items.map((t, i) => `<figure class="voice"${i ? ' hidden' : ''}><blockquote>${esc(plain(t.body))}</blockquote><figcaption>${esc([t.name, t.role].filter(Boolean).join(', '))}</figcaption></figure>`).join('');
  const hide = n < 2 ? ' hidden' : '';
  return `<div class="voices" data-voices>${voices}</div>
    <div class="voices__nav">
      <button class="btn btn--line-light btn--sm" type="button" data-voices-next${hide}>המלצה הבאה</button>
      <span class="voices__count" data-voices-count${hide}>1 מתוך ${n}</span>`;
}

/** Replace the contents of <!--yk:NAME--> ... <!--/yk:NAME--> regions. */
export function fillRegions(html, regions) {
  return html.replace(/<!--yk:(\w+)-->[\s\S]*?<!--\/yk:\1-->/g, (m, name) =>
    name in regions ? `<!--yk:${name}-->${regions[name]}<!--/yk:${name}-->` : m);
}

/* ------------------------------------------------------------- post page */

export function postMainHtml(p, { categories, tags, related, contact }) {
  const catName = Object.fromEntries(categories.map((c) => [c.slug, c.name]));
  const tagName = Object.fromEntries(tags.map((t) => [t.slug, t.name]));
  const catLinks = p.categories.map((s) => `<a href="/category/${esc(s)}/">${esc(catName[s] || s)}</a>`).join(', ');
  const tagHtml = p.tags.map((s) => `<a href="/tag/${esc(s)}/">${esc(tagName[s] || s)}</a>`).join('');
  const content = p.format === 'rich' ? `<div class="prose">${p.body}</div>` : p.body;
  const hero = `<header class="page-hero"><div class="wrap"><p class="crumb">${catLinks ? catLinks + ', ' : ''}<time datetime="${ymd(p.date)}">${heDate(p.date)}</time></p><h1>${esc(p.title)}</h1></div></header>`;
  const rel = related.length
    ? `<section class="block block--tint"><div class="wrap"><h2 class="heading">עוד באותו נושא</h2>${entriesHtml(related)}</div></section>`
    : '';
  return `${hero}
<article class="block article">
  <div class="wrap">
    ${content}
    ${tagHtml ? `<p class="tags">${tagHtml}</p>` : ''}
  </div>
</article>
${rel}
${contact}`;
}

const SAME_AS = [
  'https://www.youtube.com/@yardenkerem5297', 'https://www.facebook.com/somatictherapyandfocusing/',
  'https://www.instagram.com/yarden_kerem/', 'https://open.spotify.com/show/1PdEltqdiPKR4aGi3efIDc',
  'https://www.linkedin.com/in/yarden-kerem/', 'https://www.tiktok.com/@yarden.kerem',
];

/**
 * Structured data for every page: the site, Yarden, her clinic, the page
 * itself and its place under the home page. `extra` (an article, say) joins the graph.
 */
export function siteLd({ path, name, description, extra }) {
  const home = absUrl('/');
  const person = {
    '@type': 'Person', '@id': `${home}#yarden`, name: SITE_NAME, url: absUrl('/אודות/'),
    jobTitle: 'מטפלת ומרצה לגישת ההתמקדות', email: EMAIL, telephone: `+${PHONE_INTL}`,
    image: absUrl('/assets/yarden-arch.jpg'), knowsAbout: ['התמקדות', 'Focusing', 'Somatic Experiencing', 'הקומי', 'טיפול בטראומה', 'וידאו תרפיה'],
    sameAs: SAME_AS,
  };
  const clinic = {
    '@type': 'ProfessionalService', '@id': `${home}#clinic`, name: `${SITE_NAME} – התמקדות וטיפול דרך הגוף`, url: home,
    telephone: `+${PHONE_INTL}`, email: EMAIL, image: absUrl('/assets/yarden-arch.jpg'),
    address: { '@type': 'PostalAddress', addressLocality: 'הרצליה', addressCountry: 'IL' },
    areaServed: 'IL', founder: { '@id': person['@id'] }, sameAs: SAME_AS,
  };
  const site = { '@type': 'WebSite', '@id': `${home}#site`, url: home, name: SITE_NAME, inLanguage: 'he', publisher: { '@id': person['@id'] } };
  const url = absUrl(path);
  const page = {
    '@type': 'WebPage', '@id': `${url}#page`, url, name, inLanguage: 'he',
    isPartOf: { '@id': site['@id'] }, about: { '@id': person['@id'] }, ...(description ? { description } : {}),
  };
  const graph = [site, person, clinic, page];
  if (path !== '/') {
    graph.push({ '@type': 'BreadcrumbList', '@id': `${url}#crumbs`, itemListElement: [
      { '@type': 'ListItem', position: 1, name: SITE_NAME, item: home },
      { '@type': 'ListItem', position: 2, name, item: url },
    ] });
    page.breadcrumb = { '@id': `${url}#crumbs` };
  }
  if (extra) { const { '@context': _, ...rest } = extra; graph.push({ ...rest, isPartOf: { '@id': page['@id'] } }); }
  return { '@context': 'https://schema.org', '@graph': graph };
}

export function postLd(p) {
  return {
    '@context': 'https://schema.org', '@type': 'BlogPosting', headline: p.title,
    datePublished: ymd(p.date), dateModified: ymd(p.modified || p.date),
    author: { '@type': 'Person', '@id': `${absUrl('/')}#yarden`, name: SITE_NAME }, inLanguage: 'he', mainEntityOfPage: absUrl(p.path),
  };
}

/* ------------------------------------------------------- image delivery */

/**
 * Serve content images through Next's image optimizer: the browser gets a
 * resized AVIF/WebP instead of the original upload.
 */
export function optimizeImages(html) {
  return html.replace(/<img\b([^>]*?)\ssrc="([^"]+)"([^>]*)>/g, (m, before, src, after) => {
    if (!/^\/wp-content\/uploads\/|^\/files\/uploads\/|^https:\/\/[\w.-]+\.public\.blob\.vercel-storage\.com\//.test(src) || /\.gif$/i.test(src)) return m;
    const u = (w) => `/_next/image?url=${encodeURIComponent(src)}&amp;w=${w}&amp;q=75`;
    const srcset = [640, 1080, 1920].map((w) => `${u(w)} ${w}w`).join(', ');
    return `<img${before} src="${u(1080)}" srcset="${srcset}" sizes="(max-width: 760px) 100vw, 760px"${after}>`;
  });
}

/* ------------------------------------------------ tidying migrated pages */

function linkKind(href) {
  if (/youtube\.com|youtu\.be/.test(href)) return ['video', 'סרטון ביוטיוב'];
  if (href.startsWith('/')) return ['read', 'באתר'];
  let host = '';
  try { host = new URL(href.replace(/&amp;/g, '&')).hostname.replace(/^www\./, ''); } catch {}
  return ['article', host || 'קישור'];
}

function linkCard(href, title) {
  const [kind, where] = linkKind(href);
  const ext = /^https?:/.test(href) ? ' target="_blank" rel="noopener"' : '';
  const clean = title.replace(/\s*[-–:]?\s*(לצפייה|לינק למאמר|קישור לרכישת הספר)?\s*[-–:]?\s*לחץ כאן\s*$/, '').replace(/[\s:–-]+$/, '').trim();
  return `<ul class="linkcards"><li><a class="linkcard linkcard--${kind}" href="${href}"${ext}><span class="linkcard__icon" aria-hidden="true"></span>`
    + `<span class="linkcard__title">${clean || where}</span><span class="linkcard__where">${where}</span></a></li></ul><!--lc-->`;
}

/**
 * Old WordPress pages have "click here" headings, several contact forms and
 * headings that end in a colon. Turn them into link cards, keep one form.
 */
export function tidyLegacy(html) {
  const H = '<h2 class="heading">';
  let out = html
    // "Title:" followed by a separate "click here" heading
    .replace(/<h2 class="heading">((?:(?!<\/h2>).)*?)<\/h2>\s*<h2 class="heading"><a href="([^"]+)"[^>]*>\s*לחץ כאן\s*<\/a><\/h2>/g,
      (m, title, href) => linkCard(href, title.replace(/<[^>]+>/g, '')))
    // "Title: click here" in one linked heading
    .replace(/<h2 class="heading"><a href="([^"]+)"[^>]*>((?:(?!<\/a>).)*?לחץ כאן\s*)<\/a><\/h2>/g,
      (m, href, title) => linkCard(href, title.replace(/<[^>]+>/g, '')))
    // Headings that end with a colon
    .replace(/(<h[23] class="heading">(?:(?!<\/h[23]>)[^<])*?)\s*:\s*(<\/h[23]>)/g, '$1$2');
  // A row of columns that only hold link cards becomes one list of cards
  out = out.replace(/<div class="cols[^"]*">((?:\s*<div class="col">\s*<ul class="linkcards">(?:(?!<\/ul>).)*<\/ul><!--lc-->\s*<\/div>)+)\s*<\/div>/g,
    (m, inner) => '<ul class="linkcards">' + [...inner.matchAll(/<li>(?:(?!<\/li>).)*<\/li>/g)].map((x) => x[0]).join('') + '</ul><!--lc-->');
  // Merge only the card lists made here, never a list the page already had
  out = out.replace(/<\/ul><!--lc-->\s*<ul class="linkcards">/g, '').replaceAll('<!--lc-->', '');
  // Keep only the last contact form section
  const parts = out.split(/(?=<section\b)/);
  const withForm = parts.map((s, i) => (/data-form="contact"/.test(s) ? i : -1)).filter((i) => i >= 0);
  if (withForm.length > 1) out = parts.filter((s, i) => !withForm.slice(0, -1).includes(i)).join('');
  return out.replaceAll(H + '</h2>', '');
}
