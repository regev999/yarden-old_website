/** End-to-end run through the admin and the public site (local test server must be running). */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';

const B = 'http://localhost:3000';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('dialog', (d) => d.accept());
const step = (s) => console.log('✓', s);
const shot = (n) => page.screenshot({ path: `/tmp/ykpg/shot-${n}.png`, fullPage: false });

// A large test photo (4000x3000 JPEG), drawn in the browser
{
  const fs = await import('node:fs');
  const data = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 4000; c.height = 3000;
    const g = c.getContext('2d');
    for (let i = 0; i < 4000; i++) { g.fillStyle = `hsl(${Math.random() * 360},70%,${30 + Math.random() * 50}%)`; g.fillRect(Math.random() * 4000, Math.random() * 3000, 60 + Math.random() * 200, 60 + Math.random() * 200); }
    return c.toDataURL('image/jpeg', 0.97);
  });
  fs.writeFileSync('/tmp/ykpg/photo.jpg', Buffer.from(data.split(',')[1], 'base64'));
}

// Setup
await page.goto(B + '/admin/');
assert.match(page.url(), /\/admin\/setup\/$/);
await page.fill('[name=setup_key]', 'wrong');
await page.fill('[name=username]', 'yarden');
await page.fill('[name=email]', 'yarden@example.com');
await page.fill('[name=password]', 'correct-horse-9');
await page.click('button[type=submit]');
assert.match(await page.textContent('.notice--error'), /קוד ההתקנה שגוי/);
await page.fill('[name=setup_key]', 'test-setup-key');
await page.fill('[name=password]', 'correct-horse-9');
await page.click('button[type=submit]');
await page.waitForURL(B + '/admin/');
assert.match(await page.textContent('.notice'), /החשבון נוצר/);
await shot('dashboard');
step('setup + dashboard');

// Lead from the public form shows up
const r = await page.request.post(B + '/api/lead/', { multipart: { name: 'דנה', phone: '050-1112233', form: 'contact', product: 'course', message: 'שלום', page: '/' }, headers: { Origin: B } });
assert.equal(r.status(), 200);
await page.goto(B + '/admin/leads/');
await page.click('text=דנה');
await page.check('input[value=contacted]');
await page.fill('[name=notes]', 'חזרתי אליה');
await page.click('button:has-text("שמירה")');
assert.match(await page.textContent('.notice'), /נשמרו/);
const csv = await page.request.get(B + '/admin/export/');
assert.match(await csv.text(), /דנה/);
assert.match(csv.headers()['content-disposition'], /leads-/);
step('leads: list, edit, CSV');

// SEO edit shows on the public page
await page.goto(B + '/admin/seo/?filter=issues');
await page.goto(B + '/admin/seo/?path=' + encodeURIComponent('/אודות/'));
await page.fill('[name=description]', 'ירדן כרם, מטפלת בהתמקדות, הקומי ו־Somatic Experiencing, קליניקה בהרצליה ומפגשים בזום. כך הגעתי לעבודה הזאת.');
await page.click('button:has-text("שמירה")');
assert.match(await page.textContent('.notice'), /נשמר/);
const about = await (await page.request.get(B + '/' + encodeURIComponent('אודות') + '/')).text();
assert.match(about, /קליניקה בהרצליה ומפגשים בזום. כך הגעתי/);
step('SEO edit → live page');

// Redirects: add, test, 404 monitor
await page.goto(B + '/admin/redirects/');
await page.fill('#redirect-form [name=from]', B + '/עמוד-ישן/');
await page.fill('#redirect-form [name=to]', '/אודות/');
await page.click('#redirect-form button[type=submit]');
assert.match(await page.textContent('.notice'), /ההפניה נשמרה/);
let res = await page.request.get(B + '/' + encodeURIComponent('עמוד-ישן') + '/', { maxRedirects: 0 });
assert.equal(res.status(), 301);
assert.equal(decodeURIComponent(res.headers().location), '/אודות/');
await page.fill('#redirect-form [name=from]', '/a-loop/');
await page.fill('#redirect-form [name=to]', '/a-loop/');
await page.click('#redirect-form button[type=submit]');
assert.match(await page.textContent('.notice--error'), /זהים/);
await page.request.get(B + '/no-such-page-xyz/');
await page.goto(B + '/admin/redirects/?tab=404');
assert.ok((await page.content()).includes('/no-such-page-xyz/'));
await page.click('a:has-text("הפניה")');
await page.fill('#redirect-form [name=to]', '/בלוג/');
await page.click('#redirect-form button[type=submit]');
res = await page.request.get(B + '/no-such-page-xyz/', { maxRedirects: 0 });
assert.equal(res.status(), 301);
await page.goto(B + '/admin/redirects/?test=' + encodeURIComponent('/?p=10'));
assert.match(await page.textContent('.notice'), /מופנית \(301\)/);
await page.goto(B + '/admin/redirects/');
await page.click('summary:has-text("הוספה מרובה")');
await page.fill('[name=lines]', '/bulk-1/ /אודות/\n/bulk-2/, /קורסים/\nbad');
await page.click('button:has-text("הוספת כולן")');
assert.match(await page.textContent('.notice'), /נוספו 2 הפניות/);
await shot('redirects');
step('redirects: add, loop refused, 404 → redirect, test tool, bulk');

// Inline page editing + revision restore
await page.goto(B + '/admin/page-edit/?path=' + encodeURIComponent('/אודות/'));
const h1 = page.locator('h1[data-yk-edit]').first();
const oldH1 = (await h1.textContent()).trim();
await h1.click();
await page.keyboard.press('End');
await page.keyboard.type(' בדיקה');
await page.click('[data-yk-save]');
await page.waitForLoadState('load');
await page.waitForTimeout(1500);
let live = await (await page.request.get(B + '/' + encodeURIComponent('אודות') + '/')).text();
assert.ok(live.includes(oldH1 + ' בדיקה'), 'edited heading is live');
await page.goto(B + '/admin/revisions/?path=' + encodeURIComponent('/אודות/'));
await page.click('button:has-text("שחזור")');
live = await (await page.request.get(B + '/' + encodeURIComponent('אודות') + '/')).text();
assert.ok(!live.includes(oldH1 + ' בדיקה'), 'restored');
step('inline page edit + revision restore');

// New post with an uploaded (compressed) image
await page.goto(B + '/admin/post-edit/');
await page.fill('[name=title]', 'מאמר בדיקה חדש');
await page.click('.rte [contenteditable]');
await page.keyboard.type('פסקה ראשונה של המאמר, עם מספיק טקסט כדי שיהיה תוכן אמיתי.');
await page.check('input[name=categories][value="בלוג"]');
await page.fill('[name=tags]', 'התמקדות, תגית חדשה');
await page.fill('[name=excerpt]', 'תקציר קצר של מאמר הבדיקה.');
await page.click('button[value=publish]');
assert.match(await page.textContent('.notice'), /פורסם/);
const postHtml = await (await page.request.get(B + '/' + encodeURIComponent('מאמר-בדיקה-חדש') + '/')).text();
assert.match(postHtml, /פסקה ראשונה של המאמר/);
assert.match(postHtml, /BlogPosting/);
const blog = await (await page.request.get(B + '/' + encodeURIComponent('בלוג') + '/')).text();
assert.match(blog, /מאמר בדיקה חדש/);
assert.match(blog, /כל <!--yk:count-->93</);
step('post published, listed in blog (count 93)');

// Media upload: 4000x3000 JPEG is compressed in the browser
await page.goto(B + '/admin/media/');
await page.setInputFiles('#files', '/tmp/ykpg/photo.jpg');
await page.waitForSelector('.media-grid img', { timeout: 15000 });
const size = await page.textContent('.media-grid__meta .muted');
console.log('   uploaded photo stored as:', size.trim(), '(original', Math.round((await import('node:fs')).statSync('/tmp/ykpg/photo.jpg').size / 1024), 'KB)');
await shot('media');
step('media upload with compression');

// Testimonials
await page.goto(B + '/admin/testimonials/?edit=0');
await page.fill('[name=name]', 'ממליצה חדשה');
await page.click('.rte [contenteditable]');
await page.keyboard.type('ההמלצה החדשה שלי');
await page.click('button:has-text("שמירה")');
const clients = await (await page.request.get(B + '/' + encodeURIComponent('לקוחות-מספרים') + '/')).text();
assert.match(clients, /ההמלצה החדשה שלי/);
step('testimonial added and live');

// Settings + links + logout + login
await page.goto(B + '/admin/settings/');
await page.fill('[name=ga_id]', 'G-TEST1234');
await page.click('form:has([name=ga_id]) button');
assert.match(await (await page.request.get(B + '/')).text(), /data-consent="analytics"[^>]*gtag\/js\?id=G-TEST1234/);
await page.goto(B + '/admin/links/');
await shot('links');
await page.click('button:has-text("יציאה")');
await page.waitForURL(/\/admin\/login\//);
await page.goto(B + '/admin/leads/');
assert.match(page.url(), /login\/\?next=/);
await page.fill('[name=username]', 'yarden');
await page.fill('[name=password]', 'wrong-password');
await page.click('button[type=submit]');
assert.match(await page.textContent('.notice--error'), /שגויים/);
await page.fill('[name=password]', 'correct-horse-9');
await page.click('button[type=submit]');
await page.waitForURL(/\/admin\/leads\/$/);
step('settings (GA), links report, logout, login with next=');

// CSRF: a POST without the token is refused
const bad = await page.request.post(B + '/admin/lead/', { form: { id: '1', action: 'delete' }, headers: { Origin: B } });
assert.equal(bad.status(), 400);
const cross = await page.request.post(B + '/admin/lead/', { form: { id: '1', action: 'delete' }, headers: { Origin: 'https://evil.example' } });
assert.equal(cross.status(), 403);
step('CSRF + cross-origin POSTs refused');

// Mobile sidebar
await page.setViewportSize({ width: 390, height: 800 });
await page.goto(B + '/admin/');
await page.click('[data-toggle-side]');
assert.ok(await page.isVisible('#side.is-open'));
await shot('mobile');
step('mobile sidebar');

console.log(errors.length ? 'browser errors:\n' + errors.join('\n') : 'no browser errors');
await browser.close();
