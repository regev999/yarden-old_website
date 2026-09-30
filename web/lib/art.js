/**
 * Which line illustration (public/assets/art/<key>.svg, see scripts/gen-art.mjs)
 * belongs to which subject. Used for page heroes, method icons, link cards and
 * article covers.
 */

const BY_PATH = {
  '/התמקדות/': 'focus',
  '/טיפולים-פרטניים/': 'focus',
  '/טיפול-פרטני/': 'focus',
  '/פגישות-1-על-1/': 'focus',
  '/אודות/': 'focus',
  '/צור-קשר/': 'focus',
  '/404/': 'focus',
  '/טיפול-בטראומה-2/': 'waves',
  '/החוויה-הסומטית-להתגברות-על-טראומה/': 'waves',
  '/טראומה-מורכבת/': 'waves',
  '/טיפול-בחרדה/': 'waves',
  '/טיפול-בדיכאון-תסמינים-ושלבים/': 'waves',
  '/הקומי/': 'organic',
  '/וידאו-תרפיה/': 'film',
  '/פוטותרפיה/': 'aperture',
  '/גרינברג/': 'touch',
  '/דיקור-סיני-לכאבי-גב/': 'touch',
  '/שיטת-פאולה/': 'rings',
  '/קורסים/': 'group',
  '/פוקוסינג-לחיי-היום-יום/': 'group',
  '/חגיגת-אביב-התמקדות/': 'group',
  '/פוקוס-מרצים/': 'group',
  '/מי-אנחנו-ומה-החזון-של-ביהס-פוקוס/': 'group',
  '/מדוע-ללמוד-בביהס-פוקס/': 'group',
  '/פודקאסט/': 'sound',
  '/לקוחות-מספרים/': 'voices',
  '/המלצות/': 'voices',
  '/בלוג/': 'lines',
  '/מאמרים-שאני-כתבתי/': 'lines',
  '/מאמרים-שלי-בנושא-טיפול-בטראומה/': 'lines',
  '/מאמרים-שלי-בנושאים-כלליים/': 'lines',
  '/מאמרים-שכתב-יוגין-גנדלין/': 'lines',
  '/מאמרים-כללי/': 'lines',
  '/מן-העיתונות-כתבו-עליי/': 'lines',
  '/מן-העיתונות-אני-כתבתי/': 'lines',
};

/** The motif for a page address, or null (the home page keeps the plain lens). */
export function artForPath(path) {
  let p = path;
  try { p = decodeURIComponent(path); } catch {}
  if (BY_PATH[p]) return BY_PATH[p];
  if (/^\/(category|tag)\//.test(p) || /^\/(בלוג|מאמרים|מן-העיתונות|מדיניות|תנאי|הצהרת)/.test(p)) return 'lines';
  return null;
}

/** The motif for an article, from its subject. */
export function artForPost(p) {
  const t = `${p.title} ${(p.categories || []).join(' ')} ${(p.tags || []).join(' ')}`;
  if (/טראומ|היקשרות|התקשרות|אטצ'מנט|חרדה|הצפה|fight|flight/i.test(t)) return 'waves';
  if (/פודקאסט|פרק |שיחה|סשן/.test(t)) return 'sound';
  if (/וידאו|קולנוע|סרט/.test(t)) return 'film';
  if (/צילום|פוטו/.test(t)) return 'aperture';
  if (/קורס|מפגש היכרות|תלמיד|הזמנה/.test(t)) return 'group';
  if (/ג'נדלין|גנדלין|פילוסופ|שפה|מאמר/.test(t)) return 'lines';
  if (/התמקדות|פוקוסינג|focusing/i.test(t)) return 'focus';
  return 'organic';
}

/** A small, stable variation per article so covers of the same subject differ. */
export function artVariant(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  h >>>= 0;
  return `--art-rot:${(h % 31) - 15}deg;--art-x:${22 + (h >> 9) % 56}%;--art-s:${(0.95 + ((h >> 17) % 40) / 100).toFixed(2)}`;
}

/** Mark the page's hero and internal links with their motif. */
export function withArt(html, key) {
  let out = key ? html.replace('<header class="page-hero"', `<header class="page-hero" data-art="${key}"`) : html;
  out = out.replace(/<a\b([^>]*?)\shref="(\/[^"#?]*)"/g, (m, attrs, href) => {
    if (/\sdata-art=/.test(attrs)) return m;
    const k = BY_PATH[safeDecode(href)];
    return k ? `<a${attrs} href="${href}" data-art="${k}"` : m;
  });
  return out;
}

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}
