/** Pages list, inline page editor, saving, and revision history. */
import { createHash } from 'node:crypto';
import { q, one } from '../../db';
import { pageMain } from '../../content';
import { plain } from '../../html';
import { pageDocument } from '../../shell';
import { applyEdits, withMarkers } from '../pageedit';
import { logActivity, publishChanges, saveRevision } from '../common';
import { adminPage, csrfField, esc, heDate, html, json, qs, redirect, SECURITY_HEADERS } from '../ui';

const TOP = ['/', '/אודות/', '/טיפולים-פרטניים/', '/קורסים/', '/טראומה-מורכבת/', '/לקוחות-מספרים/', '/צור-קשר/', '/בלוג/', '/פודקאסט/'];
const sha1 = (s) => createHash('sha1').update(s).digest('hex');
const nameOf = (p) => (p.path === '/' ? 'דף הבית' : plain(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(p.main)?.[1] || '') || p.title || p.path);
const show = (p) => { try { return decodeURI(p); } catch { return p; } };

export const list = {
  async GET(ctx) {
    const text = (ctx.query.get('q') || '').trim();
    const pages = await q(`SELECT p.path, p.title, p.main, (SELECT max(created_at) FROM revisions r WHERE r.path = p.path) AS edited
                           FROM pages p WHERE p.kind = 'page'`);
    let rows = pages.map((p) => ({ ...p, name: nameOf(p) })).filter((p) => !text || `${p.name} ${show(p.path)}`.includes(text));
    const rank = (p) => (TOP.includes(p.path) ? TOP.indexOf(p.path) : 99);
    rows = rows.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'he'));
    const body = `<p class="muted">בוחרים עמוד, לוחצים על טקסט ומשנים אותו ישירות על העמוד. כל שמירה נשמרת גם כגרסה, כך שתמיד אפשר לחזור אחורה.</p>
<form class="filters" method="get"><label class="filters__search">חיפוש עמוד <input type="search" name="q" value="${esc(text)}"></label><button class="btn btn--quiet" type="submit">חיפוש</button></form>
<div class="table-wrap"><table class="table"><thead><tr><th>עמוד</th><th>כתובת</th><th>נערך לאחרונה</th><th></th></tr></thead><tbody>
${rows.map((r) => {
  const edit = '/admin/page-edit/' + qs({ path: r.path });
  return `<tr data-href="${esc(edit)}"><td><a class="strong" href="${esc(edit)}">${esc(r.name)}</a></td><td class="muted small" dir="ltr">${esc(show(r.path))}</td>
    <td class="small nowrap">${r.edited ? esc(heDate(r.edited)) : '<span class="muted">—</span>'}</td>
    <td class="nowrap small"><a href="${esc(edit)}">עריכה</a> · <a href="/admin/revisions/${esc(qs({ path: r.path }))}">גרסאות</a> · <a href="${esc(r.path)}" target="_blank" rel="noopener">צפייה</a></td></tr>`;
}).join('')}
</tbody></table></div>`;
    return html(await adminPage(ctx, { title: 'עמודים', active: 'pages', body }));
  },
};

const EDIT_CSP = "default-src 'self'; img-src 'self' data: https://i.ytimg.com https://*.public.blob.vercel-storage.com; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'";

export const edit = {
  async GET(ctx) {
    const path = ctx.query.get('path') || '';
    const post = await one('SELECT id FROM posts WHERE path = $1', [path]);
    if (post) return redirect(`/admin/post-edit/?id=${post.id}`);
    const page = await one(`SELECT * FROM pages WHERE path = $1 AND kind = 'page'`, [path]);
    if (!page) return redirect('/admin/pages/', 'העמוד לא נמצא.', 'error');
    const { html: marked, count } = withMarkers(page.main);
    // Lists inside the page are shown filled in, as on the site (they are not editable).
    const shown = await pageMain({ ...page, main: marked });
    const bar = `<div class="yk-bar" data-yk-bar data-path="${esc(path)}" data-hash="${sha1(page.main)}" data-csrf="${esc(ctx.csrf)}">
<a class="yk-bar__back" href="/admin/pages/">חזרה</a>
<span class="yk-bar__title">עריכת עמוד: <b>${esc(nameOf(page))}</b> <span class="yk-bar__hint">לחצו על טקסט כדי לשנות אותו · ${count} אזורים לעריכה</span></span>
<span class="yk-bar__status" data-yk-status role="status"></span>
<a class="yk-bar__link" href="/admin/revisions/${esc(qs({ path }))}">גרסאות</a>
<button type="button" class="yk-bar__save" data-yk-save disabled>שמירה</button></div>`;
    let doc = pageDocument({ path, title: page.title, seoTitle: page.seo_title, description: page.description, noindex: true, main: shown });
    doc = doc.replace('</head>', '<link rel="stylesheet" href="/admin-assets/page-edit.css"></head>')
      .replace(/<body([^>]*)>/, `<body$1 class="yk-editing">${bar}`)
      .replace(/<script src="\/assets\/main\.js"[^>]*><\/script>/, '')
      .replace(/<script>window\.SITE_FORM[\s\S]*?<\/script>/, '')
      .replace('</body>', '<script src="/admin-assets/compress.js"></script><script src="/admin-assets/editor.js"></script><script src="/admin-assets/page-edit.js"></script></body>');
    return new Response(doc, { headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': EDIT_CSP } });
  },
};

export const save = {
  async POST(ctx) {
    const input = ctx.json || {};
    const page = await one(`SELECT * FROM pages WHERE path = $1 AND kind = 'page'`, [String(input.path || '')]);
    if (!page) return json({ ok: false, error: 'העמוד לא נמצא.' }, 404);
    if (sha1(page.main) !== input.hash) return json({ ok: false, error: 'העמוד השתנה מאז שנפתח (אולי בחלון אחר). פתחו אותו מחדש כדי לא לדרוס שינויים.' }, 409);
    const edits = input.edits && typeof input.edits === 'object' ? input.edits : {};
    if (!Object.keys(edits).length) return json({ ok: false, error: 'אין שינויים לשמירה.' }, 422);
    const main = applyEdits(page.main, edits);
    await saveRevision(ctx, 'page', page, 'עריכת טקסט');
    // Only save if nobody else saved in between.
    const done = await one('UPDATE pages SET main = $1, updated_at = now() WHERE path = $2 AND md5(main) = md5($3) RETURNING path', [main, page.path, page.main]);
    if (!done) return json({ ok: false, error: 'העמוד השתנה בזמן השמירה. פתחו אותו מחדש.' }, 409);
    publishChanges();
    await logActivity(ctx, 'ערך עמוד', nameOf(page), '/admin/page-edit/' + qs({ path: page.path }));
    return json({ ok: true, hash: sha1(main) });
  },
};

export const revisions = {
  async GET(ctx) {
    const view = parseInt(ctx.query.get('view') || '0', 10);
    if (view) {
      const r = await one('SELECT * FROM revisions WHERE id = $1', [view]);
      if (!r) return html('<p>לא נמצא</p>', 404);
      const c = r.content;
      const main = r.kind === 'page' ? await pageMain(c) : `<article class="block article"><div class="wrap"><h1>${esc(c.title)}</h1>${c.format === 'rich' ? `<div class="prose">${c.body}</div>` : c.body}</div></article>`;
      const doc = pageDocument({ path: c.path, title: c.title, noindex: true, main })
        .replace(/<script\b[\s\S]*?<\/script>/g, '')
        .replace('<body>', `<body><div style="position:sticky;top:0;z-index:100;background:#0f2140;color:#fff;text-align:center;padding:8px;font:500 15px sans-serif">גרסה שמורה מ־${esc(heDate(r.created_at))} · לא מה שמוצג כרגע באתר</div>`);
      return new Response(doc, { headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'none'" } });
    }
    const path = ctx.query.get('path') || '';
    const revs = await q('SELECT id, kind, note, username, created_at FROM revisions WHERE path = $1 ORDER BY id DESC LIMIT 100', [path]);
    const page = await one('SELECT path, title, main FROM pages WHERE path = $1', [path]);
    const post = page ? null : await one('SELECT id, title FROM posts WHERE path = $1', [path]);
    const name = page ? nameOf(page) : post?.title || show(path);
    const backLink = post ? `<a href="/admin/post-edit/?id=${post.id}">חזרה למאמר</a>` : '<a href="/admin/pages/">חזרה לעמודים</a>';
    const body = `<p class="back">${backLink}</p><p>עמוד: <b>${esc(name)}</b> · <a href="${esc(path)}" target="_blank" rel="noopener">הגרסה הנוכחית באתר</a></p>
${!revs.length ? '<p class="empty">עוד אין גרסאות קודמות. בכל פעם שהעמוד נשמר, הגרסה שהייתה לפניו תישמר כאן.</p>'
  : `<div class="table-wrap"><table class="table"><thead><tr><th>נשמרה</th><th>מה קרה אחריה</th><th>מי</th><th></th></tr></thead><tbody>
${revs.map((r) => `<tr><td class="nowrap">${esc(heDate(r.created_at))}</td><td>${esc(r.note)}</td><td>${esc(r.username)}</td>
  <td class="nowrap"><a href="?view=${r.id}" target="_blank" rel="noopener">צפייה</a>
  <form method="post" class="inline" data-confirm="לשחזר את הגרסה הזו? היא תחליף את מה שמוצג עכשיו באתר.">${csrfField(ctx)}<input type="hidden" name="id" value="${r.id}">
  <button class="linklike" type="submit">שחזור</button></form></td></tr>`).join('')}
</tbody></table></div>`}`;
    return html(await adminPage(ctx, { title: 'גרסאות קודמות', active: post ? 'posts' : 'pages', body }));
  },

  async POST(ctx) {
    const r = await one('SELECT * FROM revisions WHERE id = $1', [parseInt(ctx.form.get('id'), 10) || 0]);
    if (!r) return redirect('/admin/pages/', 'הגרסה לא נמצאה.', 'error');
    const c = r.content;
    const back = '/admin/revisions/' + qs({ path: r.path });
    if (r.kind === 'page') {
      const cur = await one('SELECT * FROM pages WHERE path = $1', [r.path]);
      if (cur) await saveRevision(ctx, 'page', cur, 'לפני שחזור גרסה');
      await q(`INSERT INTO pages(path, kind, title, seo_title, description, og_type, og_image, canonical, noindex, ld, main)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
               ON CONFLICT (path) DO UPDATE SET title = EXCLUDED.title, seo_title = EXCLUDED.seo_title, description = EXCLUDED.description,
               noindex = EXCLUDED.noindex, main = EXCLUDED.main, updated_at = now()`,
      [c.path, c.kind || 'page', c.title, c.seo_title || '', c.description || '', c.og_type || 'website', c.og_image || '', c.canonical ?? null, !!c.noindex, c.ld ? JSON.stringify(c.ld) : null, c.main]);
    } else {
      const cur = await one('SELECT * FROM posts WHERE path = $1', [r.path]);
      if (!cur) return redirect(back, 'המאמר כבר לא קיים, אי אפשר לשחזר אליו גרסה.', 'error');
      await saveRevision(ctx, 'post', cur, 'לפני שחזור גרסה');
      await q(`UPDATE posts SET title = $1, body = $2, format = $3, excerpt = $4, seo_title = $5, description = $6, categories = $7, tags = $8, modified = now() WHERE path = $9`,
        [c.title, c.body, c.format || 'legacy', c.excerpt || '', c.seo_title || '', c.description || '', JSON.stringify(c.categories || []), JSON.stringify(c.tags || []), r.path]);
    }
    publishChanges();
    await logActivity(ctx, 'שחזר גרסה קודמת', r.path === '/' ? 'דף הבית' : show(r.path));
    return redirect(back, 'הגרסה שוחזרה והיא מוצגת באתר תוך דקה. הגרסה שהייתה לפני כן נשמרה ברשימה.');
  },
};
