import { q, one } from '../../db';
import { absUrl } from '../../html';
import { adminPage, csrfField, esc, html, qs, redirect } from '../ui';
import { logActivity, publishChanges } from '../common';
import { DESC_MAX, DESC_MIN, SITE_SUFFIX, TITLE_MAX, seoRows } from '../seodata';

async function editPage(ctx, row) {
  const issues = row.issues;
  const body = `<p class="back"><a href="/admin/seo/">חזרה לכל העמודים</a></p>
<div class="seo-edit">
  <form method="post" class="panel stack" data-seo-form>${csrfField(ctx)}<input type="hidden" name="path" value="${esc(row.path)}">
    <p class="muted">עמוד: <a href="${esc(row.path)}" target="_blank" rel="noopener">${esc(row.h1 || row.path)}</a></p>
    <label>כותרת בגוגל (Title)
      <input name="title" value="${esc(row.title)}" required data-count="${TITLE_MAX}" data-suffix="${esc(SITE_SUFFIX)}"><small data-counter></small></label>
    <label>תיאור בגוגל (Meta description)
      <textarea name="description" rows="3" data-count="${DESC_MAX}" data-min="${DESC_MIN}">${esc(row.description)}</textarea><small data-counter></small></label>
    <label class="check"><input type="checkbox" name="noindex" value="1"${row.noindex ? ' checked' : ''}> להסתיר את העמוד מגוגל (noindex)</label>
    ${row.noindex ? '<p class="notice notice--warn">העמוד מוסתר כרגע מגוגל.</p>' : ''}
    <button class="btn" type="submit">שמירה</button>
  </form>
  <aside class="panel">
    <h2>כך זה ייראה בגוגל</h2>
    <div class="serp"><p class="serp__url" dir="ltr">${esc(decodeURI(absUrl(row.path)))}</p>
      <p class="serp__title" data-preview="title">${esc(row.title)}</p><p class="serp__desc" data-preview="description">${esc(row.description)}</p></div>
    ${issues.length ? `<h2>הערות</h2><ul class="issues">${issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '<p class="notice notice--ok">אין הערות לעמוד הזה.</p>'}
    <p class="muted small">בסוף כל כותרת מופיע שם האתר, בדיוק כמו באתר הקודם. כדאי להשאיר אותו.</p>
    <p class="muted small">עדיף לא לשנות כותרות של עמודים שכבר מדורגים טוב בלי סיבה. שינוי קטן ומדויק עדיף על שכתוב מלא.</p>
  </aside>
</div>`;
  return html(await adminPage(ctx, { title: 'עריכת קידום לעמוד', active: 'seo', body }));
}

export const page = {
  async GET(ctx) {
    const rows = await seoRows();
    const path = ctx.query.get('path');
    if (path !== null) {
      const row = rows.find((r) => r.path === path);
      return row ? editPage(ctx, row) : redirect('/admin/seo/', 'העמוד לא נמצא.', 'error');
    }
    const filter = ctx.query.get('filter') || '';
    const type = ctx.query.get('type') || '';
    const text = (ctx.query.get('q') || '').trim();
    const withIssues = rows.filter((r) => r.issues.length).length;
    const shown = rows.filter((r) => (filter !== 'issues' || r.issues.length) && (!type || r.type === type)
      && (!text || `${r.title} ${r.path} ${r.h1}`.includes(text)));
    const body = `<section class="summary summary--3">
  <div class="summary__item"><b>${rows.length}</b><span>עמודים באתר</span></div>
  <a class="summary__item${withIssues ? ' is-warn' : ''}" href="/admin/seo/?filter=issues"><b>${withIssues}</b><span>עמודים עם הערות</span></a>
  <a class="summary__item" href="/admin/links/"><b>קישורים</b><span>בדיקת קישורים שבורים בתוך האתר</span></a>
</section>
<p class="muted small">מפת האתר לשליחה ב־Search Console: <a href="/sitemap_index.xml" target="_blank" rel="noopener" dir="ltr">/sitemap_index.xml</a></p>
<form class="filters" method="get">
  <label>הצגה <select name="filter" data-autosubmit><option value="">כל העמודים</option><option value="issues"${filter === 'issues' ? ' selected' : ''}>רק עמודים עם הערות</option></select></label>
  <label>סוג <select name="type" data-autosubmit><option value="">הכל</option>${['עמוד', 'פוסט', 'קטגוריה', 'תגית'].map((t) => `<option${t === type ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
  <label class="filters__search">חיפוש <input type="search" name="q" value="${esc(text)}" placeholder="כותרת או כתובת"></label>
  <button class="btn btn--quiet" type="submit">סינון</button>
</form>
<div class="table-wrap"><table class="table">
  <thead><tr><th>עמוד</th><th>סוג</th><th>כותרת בגוגל</th><th>הערות</th></tr></thead><tbody>
  ${shown.map((r) => {
    const href = '/admin/seo/' + qs({ path: r.path });
    return `<tr data-href="${esc(href)}"><td><a href="${esc(href)}">${esc(r.h1 || r.path)}</a>${r.noindex ? ' <span class="tag tag--closed">מוסתר מגוגל</span>' : ''}</td>
      <td class="nowrap muted">${esc(r.type)}</td><td class="clip">${esc(r.title)}</td>
      <td>${r.issues.length ? `<span class="warn">${esc(r.issues.join(' · '))}</span>` : '<span class="muted">תקין</span>'}</td></tr>`;
  }).join('')}
  </tbody></table></div>`;
    return html(await adminPage(ctx, { title: 'קידום (SEO)', active: 'seo', body }));
  },

  async POST(ctx) {
    const path = String(ctx.form.get('path') || '');
    const row = (await seoRows()).find((r) => r.path === path);
    const back = '/admin/seo/' + qs({ path });
    if (!row) return redirect('/admin/seo/', 'העמוד לא נמצא.', 'error');
    const title = String(ctx.form.get('title') || '').replace(/\s+/g, ' ').trim();
    const desc = String(ctx.form.get('description') || '').replace(/\s+/g, ' ').trim();
    const noindex = !!ctx.form.get('noindex');
    if (!title) return redirect(back, 'הכותרת לא יכולה להיות ריקה.', 'error');
    if (row.kind === 'post') await q('UPDATE posts SET seo_title = $1, description = $2, noindex = $3 WHERE path = $4', [title, desc, noindex, path]);
    else await q('UPDATE pages SET seo_title = $1, description = $2, noindex = $3, updated_at = now() WHERE path = $4', [title, desc, noindex, path]);
    publishChanges();
    await logActivity(ctx, 'עדכן קידום', row.h1 || path, back);
    return redirect(back, 'נשמר. השינוי יופיע באתר תוך דקה, וגוגל יעדכן אותו בסריקה הבאה.');
  },
};

/* ------------------------------------------------- broken internal links */

export const links = {
  async GET(ctx) {
    const pages = await q(`SELECT path, title, main AS html, 'page' AS kind FROM pages WHERE kind <> 'system'`);
    const posts = await q(`SELECT id, path, title, body AS html, 'post' AS kind FROM posts WHERE status = 'published'`);
    const known = new Set([...pages, ...posts].map((p) => p.path));
    const redirects = new Map((await q('SELECT source, target FROM redirects')).map((r) => [r.source, r.target]));
    const media = new Set((await q('SELECT url FROM media')).map((m) => m.url));
    const staticOk = /^\/(assets|admin-assets|_next)\/|^\/(sitemap_index|sitemap|feed)\.xml$|^\/robots\.txt$|^\/admin\//;
    const broken = [];
    for (const p of [...pages, ...posts]) {
      for (const m of p.html.matchAll(/<a\b[^>]*\shref="([^"#?]+)[^"]*"/g)) {
        let href = m[1];
        if (/^https?:\/\/(www\.)?yardenkerem\.co\.il/i.test(href)) href = href.replace(/^https?:\/\/[^/]+/i, '') || '/';
        if (!href.startsWith('/') || href.startsWith('//')) continue;
        let path;
        try { path = decodeURIComponent(href); } catch { path = href; }
        if (staticOk.test(path) || known.has(path) || media.has(path)) continue;
        if (/^\/wp-content\/uploads\//.test(path)) continue; // files from the old site: see the media screen
        if (!/\.\w+$/.test(path) && !path.endsWith('/') && known.has(path + '/')) continue;
        const target = redirects.get(path);
        broken.push({ from: p, path, target });
      }
    }
    const seen = new Set();
    const rows = broken.filter((b) => { const k = b.from.path + '|' + b.path; if (seen.has(k)) return false; seen.add(k); return true; });
    const editLink = (p) => (p.kind === 'post' ? `/admin/post-edit/?id=${p.id}` : '/admin/page-edit/' + qs({ path: p.path }));
    const body = `<p class="back"><a href="/admin/seo/">חזרה לקידום</a></p>
<p class="muted">בדיקה של כל הקישורים בתוך האתר (${pages.length + posts.length} עמודים ומאמרים). קישור שמוביל להפניה עובד, אבל עדיף לעדכן אותו לכתובת הסופית.</p>
${!rows.length ? '<p class="notice notice--ok">לא נמצאו קישורים שבורים.</p>' : `<div class="table-wrap"><table class="table">
<thead><tr><th>בעמוד</th><th>קישור אל</th><th>מצב</th><th></th></tr></thead><tbody>
${rows.map((b) => `<tr><td><a href="${esc(b.from.path)}" target="_blank" rel="noopener">${esc(b.from.title || b.from.path)}</a></td>
  <td dir="ltr" class="small">${esc(b.path)}</td>
  <td>${b.target ? `<span class="muted">מפנה אל ${esc(b.target)}</span>` : '<span class="warn">לא קיים (404)</span>'}</td>
  <td class="nowrap small"><a href="${esc(editLink(b.from))}">עריכת העמוד</a>${b.target ? '' : ` · <a href="/admin/redirects/${esc(qs({ from: b.path }))}">יצירת הפניה</a>`}</td></tr>`).join('')}
</tbody></table></div>`}`;
    return html(await adminPage(ctx, { title: 'בדיקת קישורים', active: 'seo', body }));
  },
};
