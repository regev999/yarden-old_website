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
await page.waitForURL(B + '/admin/settings/#twostep');
assert.match(await page.textContent('.notice'), /החשבון נוצר/);
// The setup screen closes after the first account (more are added from the Users screen)
await page.goto(B + '/admin/setup/');
assert.match(page.url(), /\/admin\/(login\/)?$/);
await page.goto(B + '/admin/');
assert.match(await page.textContent('.notice--warn'), /אימות דו־שלבי/);
await shot('dashboard');
step('setup (closes after the first account) + dashboard');

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
// The editor reloads itself once the save is done
await Promise.all([page.waitForEvent('framenavigated', (f) => f === page.mainFrame()), page.click('[data-yk-save]')]);
await page.waitForLoadState('load');
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
assert.match(blog, /כל <!--yk:count-->90</); // 89 published (old duplicates and two retired posts left out) + this one
step('post published, listed in blog (count 90)');

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

// Users: password to add, duplicate refused, re-invite, password from the link, delete
await page.goto(B + '/admin/users/');
const addUser = async (username, email, current = 'correct-horse-9') => {
  await page.fill('#new-user [name=username]', username);
  await page.fill('#new-user [name=email]', email);
  await page.fill('#new-user [name=current]', current);
  await page.click('#new-user button[type=submit]');
};
await addUser('Noa.K', 'noa@example.com', 'not-my-password');
assert.match(await page.textContent('.notice--error'), /הסיסמה שלכם שגויה/);
assert.equal(await page.inputValue('#new-user [name=email]'), 'noa@example.com');
await addUser('YARDEN', 'other@example.com');
assert.match(await page.textContent('.notice--error'), /כבר יש משתמש/);
await addUser('Noa.K', 'noa@example.com');
assert.match(await page.textContent('.notice'), /החשבון של Noa\.K נוצר/);
const firstLink = await page.inputValue('.invite input');
await page.click('button:has-text("שליחת הזמנה מחדש")');
const inviteLink = await page.inputValue('.invite input');
assert.notEqual(inviteLink, firstLink);
const noa = await (await browser.newContext()).newPage();
await noa.goto(firstLink);
assert.match(await noa.textContent('.notice--error'), /הקישור לא תקף/);
await noa.goto(inviteLink);
assert.match(await noa.textContent('main'), /ברוכים הבאים[\s\S]*Noa\.K/);
await noa.fill('[name=password]', 'a-river-of-tea-7');
await noa.fill('[name=password2]', 'a-river-of-tea-7');
await noa.click('button[type=submit]');
await noa.waitForURL(B + '/admin/settings/#twostep');
assert.match(await noa.textContent('.side__user'), /Noa\.K/);
await page.goto(B + '/admin/users/');
assert.match(await page.textContent('tr:has-text("Noa.K")'), /פעיל/);
assert.equal(await page.locator('tr:has-text("yarden@") button[value=delete]').count(), 0, 'no delete button on your own account');
await shot('users');
await page.goto(B + '/admin/settings/');
assert.match(await page.textContent('#signins'), /Noa\.K[\s\S]*הזמנה/);
await page.goto(B + '/admin/users/');
await page.click('tr:has-text("Noa.K") button[value=delete]');
assert.match(await page.textContent('.notice'), /החשבון של Noa\.K נמחק/);
await noa.goto(B + '/admin/leads/');
assert.match(noa.url(), /\/admin\/login\//);
await noa.context().close();
step('users: password to add, duplicate refused, re-invite, password from link, delete ends the session');

// Main menu: the blog is a top-level item, not inside "מאמרים"
await page.goto(B + '/');
assert.equal(await page.locator('#nav > ul > li > a', { hasText: 'בלוג' }).count(), 1);
assert.equal(await page.locator('#nav .nav__sub a', { hasText: 'בלוג' }).count(), 0);
step('main menu: blog at the top level');

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

// Shop: a product on a page, checkout through Cardcom (test/cardcom-mock.mjs when it runs), sales, payment links
{
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(B + '/admin/products/?edit=0');
  await page.fill('[name=title]', 'קורס התמקדות שנתי');
  await page.fill('[name=description]', 'מפגשים שבועיים בזום');
  await page.fill('[name=price]', '1800');
  await page.fill('[name=max_payments]', '3');
  await page.selectOption('[name=page_path]', '/התמקדות/');
  await page.click('button:has-text("שמירה")');
  assert.match(await page.textContent('table'), /קורס התמקדות שנתי[\s\S]*1,800/);
  // A new price shows in the card's own "מחיר" line too, with or without Cardcom
  await page.click('a:has-text("The Inner Freedom Map")');
  await page.fill('[name=price]', '2250');
  await page.check('[name=active]');
  await page.click('button:has-text("שמירה")');
  const ifm = await (await page.request.get(B + encodeURI('/פוקוסינג-לחיי-היום-יום/'))).text();
  assert.match(ifm, /<dt>מחיר<\/dt><dd>2,250 ₪, אפשר לחלק עד 10 תשלומים של 225 ₪<\/dd>/);
  assert.doesNotMatch(ifm, /2,400/);
  const configured = !(await page.$('.notice--warn'));
  if (!configured) {
    // Without Cardcom credentials nothing is offered on the site
    await page.goto(B + encodeURI('/התמקדות/'));
    assert.equal(await page.$('#buy'), null);
    step('shop: products saved, no buy button while Cardcom is not connected');
  } else {
    const mock = 'http://localhost:4010';
    await page.goto(B + encodeURI('/התמקדות/'));
    assert.match(await page.textContent('#buy'), /1,800 ₪[\s\S]*עד 3 תשלומים של 600 ₪/);
    await page.click('#buy [data-checkout]');
    await page.waitForURL(/localhost:4010\/pay\//);
    const lowProfileId = page.url().split('/pay/')[1];
    const sent = await (await page.request.get(mock + '/last')).json();
    assert.equal(sent.Amount, 1800);
    assert.equal(sent.MaxNumOfPayments, 3);
    assert.match(sent.WebHookUrl, /\/api\/cardcom-webhook\/$/);
    assert.equal(sent.Document.DocumentTypeToCreate, 'TaxInvoiceAndReceipt');
    assert.equal(sent.Document.Products[0].UnitCost, 1800);
    await page.click('#pay');
    await page.waitForURL(/\/%D7%94%D7%AA%D7%9E%D7%A7%D7%93%D7%95%D7%AA\/(\?payment=success)?$/);
    assert.match(await page.textContent('.pay-toast'), /התשלום התקבל/);
    assert.ok(!page.url().includes('payment='), 'the notice shows once');
    await page.goto(B + '/admin/sales/');
    const row = await page.textContent('table.sales tbody tr:first-child');
    assert.match(row, /קורס התמקדות שנתי[\s\S]*1,800[\s\S]*בעלת הכרטיס[\s\S]*card-owner@example\.com[\s\S]*חשבונית \d+[\s\S]*אישור 0123456[\s\S]*שולם/);

    // A second notice for the same payment changes nothing
    await page.request.post(B + '/api/cardcom-webhook/', { data: { LowProfileId: lowProfileId } });
    await page.reload();
    assert.equal((await page.$$('table.sales tbody tr')).length, 1);
    assert.match(await page.textContent('.summary'), /1,800 ₪[\s\S]*1 מכירות החודש/);

    // Payment link: asks who pays, declined first, then paid, then used up
    await page.goto(B + '/admin/pay-links/?edit=0');
    await page.fill('[name=title]', 'דמי הרשמה');
    await page.fill('[name=amount]', '350');
    await page.fill('[name=max_uses]', '1');
    const token = await page.inputValue('[name=token]');
    await page.click('button:has-text("שמירה")');
    assert.match(await page.textContent('.notice'), new RegExp(`/pay/${token}/`));
    for (const choice of ['decline', 'pay']) {
      await page.goto(`${B}/pay/${token}/`);
      assert.match(await page.textContent('.paybox'), /350 ₪/);
      await page.click('.paybox__form button');
      assert.match(await page.textContent('.form__status'), /נא למלא/);
      await page.fill('[name=name]', 'דנה כהן');
      await page.fill('[name=phone]', '050-1234567');
      await page.fill('[name=email]', 'dana@example.com');
      await page.click('.paybox__form button');
      await page.waitForURL(/localhost:4010\/pay\//);
      await page.click('#' + choice);
      await page.waitForURL(new RegExp(`/pay/${token}/`));
      assert.match(await page.textContent('.pay-toast'), choice === 'pay' ? /התשלום התקבל/ : /לא הושלם/);
    }
    await page.goto(`${B}/pay/${token}/`);
    assert.match(await page.textContent('main'), /כבר נוצל/);
    await page.goto(B + '/admin/sales/');
    const t = await page.textContent('table.sales');
    assert.match(t, /דמי הרשמה[\s\S]*דנה כהן[\s\S]*בכרטיס של בעלת הכרטיס[\s\S]*שולם/);
    assert.match(t, /דמי הרשמה[\s\S]*נכשל/);
    const csvRes = await page.request.get(B + '/admin/sales-export/');
    assert.match(await csvRes.text(), /דנה כהן/);

    // The browser never sets the price; other sites can't start a checkout
    const cross = await page.request.post(B + '/api/checkout/', { data: { slug: 'x', amount: 1 }, headers: { Origin: 'https://evil.example' } });
    assert.equal(cross.status(), 403);
    step('shop: product on its page, Cardcom checkout + verified webhook, sales, payment link (declined, paid, used up), CSV');
  }
}

// Two-step sign-in: enable with the QR's secret, sign in with a code, then with a recovery code
{
  const { codeAt, stepAt } = await import('../lib/admin/totp.js');
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(B + '/admin/settings/');
  await page.click('button:has-text("הפעלת אימות דו־שלבי")');
  await page.waitForSelector('.qr svg');
  const secret = (await page.textContent('.secret')).replace(/\s/g, '');
  // Each code works once: take the next unused time step (waiting for the clock when needed)
  let lastUsed = 0;
  const freshCode = async () => {
    while (stepAt() < lastUsed) await new Promise((r) => setTimeout(r, 1000));
    lastUsed = Math.max(lastUsed + 1, stepAt() - 1);
    return codeAt(secret, lastUsed);
  };
  await page.fill('.twostep-confirm .code-input', '000000');
  await page.click('.twostep-confirm button');
  assert.match(await page.textContent('.notice--error'), /הקוד לא תאם/);
  const firstCode = await freshCode();
  await page.fill('.twostep-confirm .code-input', firstCode);
  await page.click('.twostep-confirm button');
  const codes = await page.$$eval('.recovery__codes code', (els) => els.map((e) => e.textContent));
  assert.equal(codes.length, 8);
  await page.click('text=שמרתי, להמשך');
  assert.match(await page.textContent('#twostep'), /פעיל/);
  await shot('twostep');

  // The password alone no longer opens a session
  await page.click('button:has-text("יציאה")');
  await page.fill('[name=username]', 'yarden');
  await page.fill('[name=password]', 'correct-horse-9');
  await page.click('button[type=submit]');
  await page.waitForURL(/\/admin\/verify\/$/);
  await page.goto(B + '/admin/leads/');
  assert.match(page.url(), /login/, 'no session before the code');
  await page.fill('[name=username]', 'yarden');
  await page.fill('[name=password]', 'correct-horse-9');
  await page.click('button[type=submit]');
  await page.fill('[name=code]', '123456');
  await page.click('button[type=submit]');
  assert.match(await page.textContent('.notice--error'), /הקוד שגוי/);
  // The code used to switch it on can't be used again; a new one works
  await page.fill('[name=code]', firstCode);
  await page.click('button[type=submit]');
  assert.match(await page.textContent('.notice--error'), /הקוד שגוי/);
  await page.fill('[name=code]', await freshCode());
  await page.click('button[type=submit]');
  await page.waitForURL(B + '/admin/leads/');   // the page asked for before signing in

  // A recovery code works once
  await page.click('button:has-text("יציאה")');
  for (const expectOk of [true, false]) {
    await page.fill('[name=username]', 'yarden');
    await page.fill('[name=password]', 'correct-horse-9');
    await page.click('button[type=submit]');
    await page.fill('[name=code]', codes[0]);
    await page.click('button[type=submit]');
    if (expectOk) {
      await page.waitForURL(B + '/admin/');
      assert.match(await page.textContent('.notice'), /קוד גיבוי/);
      await page.click('button:has-text("יציאה")');
    } else {
      assert.match(await page.textContent('.notice--error'), /הקוד שגוי/);
    }
  }
  // Sign-in log and devices
  await page.fill('[name=code]', await freshCode());
  await page.click('button[type=submit]');
  await page.waitForURL(B + '/admin/');
  await page.goto(B + '/admin/settings/');
  assert.match(await page.textContent('#signins'), /נכשלה/);
  assert.match(await page.textContent('#signins'), /קוד גיבוי/);
  assert.match(await page.textContent('#devices'), /המכשיר הזה/);
  step('two-step sign-in: QR secret, codes, no replay, recovery code once, sign-in log');
}

// Newsletter: the form in the footer, the subscribers list and its Rav-Messer list in the admin
{
  const visitor = await browser.newPage();
  await visitor.goto(B + '/');
  await visitor.fill('#footer-nl-name', 'נועה');
  await visitor.fill('#footer-nl-email', 'Noa@Example.com');
  await visitor.click('.news-form button[type=submit]');
  await visitor.waitForFunction(() => /תודה/.test(document.querySelector('.news-form .form__status').textContent));
  await visitor.close();
  const leadsNow = await page.request.get(B + '/admin/export/');
  assert.doesNotMatch(await leadsNow.text(), /noa@example\.com/i, 'a sign-up is not a lead');

  await page.goto(B + '/admin/settings/');
  await page.fill('#newsletter [name=list_id]', ' 123 ');
  await page.click('#newsletter button[type=submit]');
  assert.match(await page.textContent('.notice'), /לרשימה 123 ברב־מסר/);
  await page.goto(B + '/admin/newsletter/');
  assert.match(await page.textContent('table'), /נועה[\s\S]*noa@example\.com[\s\S]*עוד לא נשלח/);
  assert.match(await page.textContent('.notice--warn'), /רב־מסר עוד לא מחובר/);
  const csv = await (await page.request.get(B + '/admin/newsletter-export/')).text();
  assert.match(csv, /נועה,noa@example\.com,עוד לא נשלח/);
  step('newsletter: footer sign-up, kept apart from leads, list id in settings, admin list + CSV');
}

console.log(errors.length ? 'browser errors:\n' + errors.join('\n') : 'no browser errors');
await browser.close();
