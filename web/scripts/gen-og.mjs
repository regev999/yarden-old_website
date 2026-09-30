/**
 * Share images (og:image, 1200×630) for pages and for articles without a
 * picture of their own, in the site's look: the subject's motif in the lens,
 * the title in IBM Plex Sans Hebrew. Written to public/og/<ogKey(path)>.jpg.
 *
 * Needs Playwright with Chromium, so it runs on a developer machine, not on the
 * server: node scripts/gen-og.mjs   (then commit public/og)
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { artForPath, artForPost } from '../lib/art.js';
import { ogKey } from '../lib/og.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'public', 'og');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs'));
}

const read = (f) => JSON.parse(readFileSync(path.join(root, 'content', f), 'utf8'));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Inline everything: a page made with setContent can't load file:// URLs
const data = (file, type) => `data:${type};base64,${readFileSync(path.join(root, file)).toString('base64')}`;
const font = (w, f) => `@font-face{font-family:P;font-weight:${w};src:url(${data(`public/assets/fonts/${f}`, 'font/woff2')}) format("woff2")}`;
const artUrl = (k) => data(`public/assets/art/${k}.svg`, 'image/svg+xml');

function html(title, art, photo, pod) {
  const size = title.length > 60 ? 64 : title.length > 36 ? 76 : 96;
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>
${font(200, 'IBMPlexSansHebrew-ExtraLight.woff2')}@font-face{font-family:K;font-weight:700;src:url(${data('public/assets/fonts/Karantina-Bold-hebrew.woff2', 'font/woff2')}) format("woff2")}${font(400, 'IBMPlexSansHebrew-Regular.woff2')}${font(500, 'IBMPlexSansHebrew-Medium.woff2')}
*{box-sizing:border-box;margin:0}
html,body{width:1200px;height:630px;overflow:hidden}
body{background:#0f2140;color:#fff;font-family:P,sans-serif}
.frame{position:fixed;inset:0;overflow:hidden}
.lens{position:absolute;left:-190px;top:50%;width:760px;height:760px;margin-top:-380px;border-radius:50%;
 background:radial-gradient(circle,rgba(46,87,196,.55) 0,rgba(46,87,196,.18) 26%,transparent 52%),repeating-radial-gradient(circle,transparent 0 34px,rgba(185,203,245,.16) 34px 35px);
 -webkit-mask-image:radial-gradient(circle,#000 42%,transparent 71%)}
.art{position:absolute;left:52px;top:50%;width:300px;height:300px;margin-top:-150px;background:#b9cbf5;opacity:.92;
 -webkit-mask:url(${art ? artUrl(art) : artUrl('focus')}) center/contain no-repeat}
.photo{position:absolute;left:62px;top:50%;width:280px;height:280px;margin-top:-140px;border-radius:50%;background:center/cover no-repeat;box-shadow:0 0 0 14px #0f2140,0 0 0 15px #b9cbf5,0 0 0 30px #0f2140,0 0 0 31px rgba(185,203,245,.35)}
.text{position:absolute;right:80px;left:460px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;gap:28px}
.brand{display:flex;align-items:center;gap:14px;font-size:30px;font-weight:500;color:#e8eef7}
.brand i{width:38px;height:38px;border-radius:50%;box-shadow:inset 0 0 0 2px #b9cbf5;background:radial-gradient(circle,#b9cbf5 0 6px,transparent 7px)}
h1{font-weight:200;font-size:${size}px;line-height:1.08;letter-spacing:-.02em;text-wrap:balance}
.pod{font-family:K,P,sans-serif;font-weight:700;font-size:150px;line-height:.84;letter-spacing:0}.pod span{display:block}.pod span+span{color:#c5b518}
.foot{position:absolute;right:80px;bottom:44px;font-size:24px;color:#a9b8cf;letter-spacing:.02em}
</style></head><body><div class="frame"><div class="lens"></div>${photo ? `<div class="photo" style="background-image:url(${photo})"></div>` : '<div class="art"></div>'}
<div class="text"><div class="brand"><i></i>${pod ? 'הפודקאסט של ירדן כרם' : 'ירדן כרם'}</div>${pod ? '<h1 class="pod"><span>פוקוסינג</span><span>עם ירדן כרם</span></h1>' : `<h1>${esc(title)}</h1>`}</div>
<div class="foot">התמקדות וטיפול דרך הגוף</div></div></body></html>`;
}

// The page's own heading from its latest redesign, when there is one
const upDir = path.join(root, 'content', 'updates');
const heading = {};
for (const f of readdirSync(upDir).filter((x) => x.endsWith('.json')).sort()) {
  const u = JSON.parse(readFileSync(path.join(upDir, f), 'utf8'));
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(readFileSync(path.join(upDir, u.file), 'utf8'));
  if (h1) heading[u.path] = h1[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
const clean = (t) => String(t).replace(/\s*[-–|]\s*ירדן כרם\s*$/, '').trim();

// Pages whose share image shows Yarden rather than a motif
const PHOTO_PAGES = ['/', '/אודות/', '/טיפולים-פרטניים/', '/צור-קשר/', '/פודקאסט/'];
let photoUrl = null;
try { photoUrl = data('public/assets/yarden.jpg', 'image/jpeg'); } catch {}

const jobs = [];
for (const p of read('pages.json')) {
  if (p.kind === 'system') continue;
  const title = p.path === '/' ? 'להקשיב פנימה. לזוז החוצה.' : heading[p.path] || clean(p.title);
  jobs.push({ key: ogKey(p.path), title, art: p.path === '/' ? 'focus' : artForPath(p.path) || 'focus', photo: PHOTO_PAGES.includes(p.path), pod: p.path === '/פודקאסט/' });
}
for (const p of read('posts.json')) {
  if (p.og_image || (p.status && p.status !== 'published')) continue;
  jobs.push({ key: ogKey(p.path), title: clean(p.title), art: artForPost(p) });
}
jobs.push({ key: 'default', title: 'טיפול וקורסים בגישת ההתמקדות', art: 'focus' });

const b = await chromium.launch();
const page = await (await b.newContext({ viewport: { width: 1200, height: 630 } })).newPage();
for (const j of jobs) {
  await page.setContent(html(j.title, j.art, j.photo ? photoUrl : null, j.pod), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(out, `${j.key}.jpg`), type: 'jpeg', quality: 82 });
}
await b.close();
writeFileSync(path.join(out, 'index.json'), JSON.stringify(jobs.map((j) => j.key).sort()));
console.log(`og: ${jobs.length} images → ${out}`);
