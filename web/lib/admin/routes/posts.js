/** Articles and blog: list, editor (new / edit / publish / draft / delete) and preview. */
import { q, one } from '../../db';
import { contactHtml, terms } from '../../content';
import { SITE_URL, TITLE_SUFFIX, plain, postMainHtml, youtubeId } from '../../html';
import { pageDocument } from '../../shell';
import { htmlForEditor, sanitizeHtml } from '../sanitize';
import { logActivity, makeSlug, publishChanges, saveRevision, uniquePath } from '../common';
import { adminPage, csrfField, esc, html, wallDate, pager, qs, redirect, SECURITY_HEADERS } from '../ui';

const PER_PAGE = 30;
const show = (p) => { try { return decodeURI(p); } catch { return p; } };
const termMap = async (kind) => Object.fromEntries((await terms(kind)).map((t) => [t.slug, t.name]));

export const list = {
  async GET(ctx) {
    const cats = await termMap('category');
    const text = (ctx.query.get('q') || '').trim();
    const cat = ctx.query.get('cat') || '';
    const status = ctx.query.get('status') || '';
    const all = await q('SELECT id, path, title, body, categories, status, is_video, duplicate_of, date FROM posts ORDER BY date DESC');
    const counts = { all: all.length, published: all.filter((r) => r.status === 'published').length, draft: all.filter((r) => r.status === 'draft').length };
    const rows = all.filter((r) => (!status || r.status === status) && (!cat || r.categories.includes(cat))
      && (!text || `${r.title} ${plain(r.body)}`.toLowerCase().includes(text.toLowerCase())));
    const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
    const pageNo = Math.min(pages, Math.max(1, parseInt(ctx.query.get('p') || '1', 10) || 1));
    const shown = rows.slice((pageNo - 1) * PER_PAGE, pageNo * PER_PAGE);
    const tab = (v, label, n) => `<a href="${esc(qs({ status: v }))}"${status === v ? ' aria-current="page"' : ''}>${label} <span>${n}</span></a>`;
    const body = `<nav class="tabs" aria-label="סטטוס">${tab('', 'הכל', counts.all)}${tab('published', 'מפורסמים', counts.published)}${tab('draft', 'טיוטות', counts.draft)}</nav>
<form class="filters" method="get"><input type="hidden" name="status" value="${esc(status)}">
  <label class="filters__search">חיפוש בכותרת ובטקסט <input type="search" name="q" value="${esc(text)}"></label>
  <label>נושא <select name="cat" data-autosubmit><option value="">כל הנושאים</option>${Object.entries(cats).map(([s, n]) => `<option value="${esc(s)}"${s === cat ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
  <button class="btn btn--quiet" type="submit">סינון</button></form>
${!shown.length ? '<p class="empty">לא נמצאו מאמרים. <a href="/admin/post-edit/">כתיבת מאמר חדש</a></p>' : `<div class="table-wrap"><table class="table">
<thead><tr><th>כותרת</th><th>נושא</th><th>תאריך</th><th></th></tr></thead><tbody>
${shown.map((r) => {
  const edit = `/admin/post-edit/?id=${r.id}`;
  return `<tr data-href="${edit}"><td><a href="${edit}" class="strong">${esc(r.title)}</a>
    ${r.status === 'draft' ? '<span class="tag">טיוטה</span>' : ''}${r.duplicate_of ? '<span class="tag tag--closed" title="עותק כפול מהאתר הקודם, לא מוצג ברשימות">עותק כפול</span>' : ''}${r.is_video ? '<span class="tag">סרטון</span>' : ''}
    <div class="muted small clip">${esc(plain(r.body, 110))}</div></td>
    <td class="small">${esc(r.categories.map((s) => cats[s] || s).join(', '))}</td>
    <td class="nowrap small">${esc(wallDate(r.date))}</td>
    <td class="nowrap">${r.status === 'published' ? `<a href="${esc(r.path)}" target="_blank" rel="noopener" class="small">צפייה</a>` : ''}</td></tr>`;
}).join('')}</tbody></table></div>${pager(pageNo, pages, { q: text, cat, status })}`}`;
    return html(await adminPage(ctx, { title: 'מאמרים ובלוג', active: 'posts', body, actions: '<a class="btn" href="/admin/post-edit/">מאמר חדש</a>' }));
  },
};

/** Build a post from the submitted form. */
async function fromForm(ctx, post, tagNames) {
  const f = (k) => String(ctx.form.get(k) || '');
  const p = { ...(post || { id: 0, path: '', status: 'draft', wp_id: null, duplicate_of: null }) };
  p.title = f('title').replace(/\s+/g, ' ').trim().slice(0, 300);
  p.body = sanitizeHtml(f('body'));
  p.format = 'rich';
  p.excerpt = f('excerpt').replace(/\s+/g, ' ').trim().slice(0, 500);
  p.seo_title = f('seo_title').replace(/\s+/g, ' ').trim().slice(0, 300);
  p.categories = ctx.form.getAll('categories').map(String);
  const byName = Object.fromEntries(Object.entries(tagNames).map(([s, n]) => [n, s]));
  p.tag_names = {};
  for (const t of f('tags').split(/[,،]/).map((x) => x.trim()).filter(Boolean)) p.tag_names[byName[t] || makeSlug(t)] = t;
  p.tags = Object.keys(p.tag_names);
  // Post dates are Israel wall-clock times (as WordPress stored them).
  const d = f('date');
  p.date = /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(d) ? d.replace('T', ' ') + ':00' : post?.date || israelNow();
  p.is_video = !!youtubeId(p.body) && plain(p.body).length < 200;
  return p;
}

function israelNow() {
  const x = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    .formatToParts(new Date()).map((p) => [p.type, p.value]));
  return `${x.year}-${x.month}-${x.day} ${x.hour === '24' ? '00' : x.hour}:${x.minute}:${x.second}`;
}

/** Stored dates come back as Date objects holding the wall-clock time in UTC fields. */
function dateInput(d) {
  if (typeof d === 'string') return d.slice(0, 16).replace(' ', 'T');
  return d.toISOString().slice(0, 16);
}

async function editorPage(ctx, v, errors = []) {
  const cats = await termMap('category');
  const tagNames = await termMap('tag');
  const isNew = !v.id;
  const published = v.status === 'published' && !isNew;
  const slugLocked = published || !!v.wp_id;
  const tagText = v.tags.map((s) => tagNames[s] || v.tag_names?.[s] || s).join(', ');
  const body = `<p class="back"><a href="/admin/posts/">חזרה לכל המאמרים</a></p>
${errors.map((e) => `<p class="notice notice--error" role="alert">${esc(e)}</p>`).join('')}
<form method="post" class="editor-layout" data-track-changes id="post-form">${csrfField(ctx)}<input type="hidden" name="id" value="${v.id || 0}">
  <div class="editor-main">
    <input class="title-input" name="title" value="${esc(v.title)}" placeholder="כותרת המאמר" required aria-label="כותרת" data-slug-source>
    <p class="slug-line muted small">כתובת:
      ${slugLocked ? `<span dir="ltr">${esc(show(SITE_URL + v.path))}</span> <span class="hint">(קבועה, כדי לשמור על הקידום)</span>`
        : `<span dir="ltr">${esc(SITE_URL)}/</span><input name="slug" value="${esc(show(v.path).replace(/^\/|\/$/g, ''))}" placeholder="נוצרת אוטומטית מהכותרת" data-slug class="slug-input">/`}
    </p>
    <div class="rte" data-rte data-name="body" data-label="תוכן המאמר"></div>
    <textarea name="body" hidden>${esc(v.body ? htmlForEditor(v.body) : '')}</textarea>
    <p class="muted small">טיפ: כדי להוסיף סרטון, הדביקו קישור יוטיוב בשורה נפרדת. טקסט שמודבק מוורד או מאתר אחר מגיע נקי.</p>
  </div>
  <aside class="editor-side">
    <section class="panel stack"><h2>פרסום</h2>
      <p class="muted small">סטטוס: <b>${published ? 'מפורסם באתר' : isNew ? 'חדש' : 'טיוטה'}</b></p>
      <label>תאריך <input type="datetime-local" name="date" value="${esc(dateInput(v.date))}"></label>
      <div class="btn-stack">
        <button class="btn" type="submit" name="action" value="publish">${published ? 'עדכון באתר' : 'פרסום באתר'}</button>
        <button class="btn btn--quiet" type="submit" name="action" value="draft">${published ? 'הורדה מהאתר (לטיוטה)' : 'שמירה כטיוטה'}</button>
        <button class="btn btn--quiet" type="submit" formaction="/admin/preview/" formtarget="_blank" name="action" value="preview">תצוגה מקדימה</button>
      </div>
    </section>
    <section class="panel stack"><h2>נושאים</h2>
      <div class="checks">${Object.entries(cats).map(([s, n]) => `<label class="check"><input type="checkbox" name="categories" value="${esc(s)}"${v.categories.includes(s) ? ' checked' : ''}> ${esc(n)}</label>`).join('')}</div>
      <label>תגיות <input name="tags" value="${esc(tagText)}" list="tag-list" placeholder="מופרדות בפסיקים">
        <datalist id="tag-list">${Object.values(tagNames).map((n) => `<option value="${esc(n)}">`).join('')}</datalist></label>
    </section>
    <section class="panel stack"><h2>גוגל</h2>
      <label>תיאור קצר <textarea name="excerpt" rows="3" data-count="160" data-min="70" placeholder="משפט או שניים שיופיעו בגוגל וברשימות">${esc(v.excerpt || '')}</textarea><small data-counter></small></label>
      <label>כותרת לגוגל (לא חובה) <input name="seo_title" value="${esc(v.seo_title || '')}" placeholder="${esc((v.title || 'כותרת המאמר') + TITLE_SUFFIX)}"></label>
    </section>
    ${isNew ? '' : `<section class="panel"><h2>גרסאות קודמות</h2>
      <p class="small"><a href="/admin/revisions/${esc(qs({ path: v.path }))}">היסטוריית שינויים ושחזור</a></p>
      <button type="submit" form="delete-form" class="linklike linklike--danger small">מחיקת המאמר</button></section>`}
  </aside>
</form>
${isNew ? '' : `<form method="post" id="delete-form" data-confirm="${v.wp_id ? 'המאמר הזה היה באתר הקודם וייתכן שמדורג בגוגל. אחרי המחיקה תוכלו להפנות את הכתובת שלו (301) למאמר אחר במסך ההפניות. למחוק בכל זאת?' : 'למחוק את המאמר לצמיתות?'}">
${csrfField(ctx)}<input type="hidden" name="id" value="${v.id}"><input type="hidden" name="action" value="delete"></form>`}`;
  const actions = published ? `<a class="btn btn--quiet" href="${esc(v.path)}" target="_blank" rel="noopener">צפייה באתר</a>` : '';
  return html(await adminPage(ctx, { title: isNew ? 'מאמר חדש' : 'עריכת מאמר', active: 'posts', body, actions, scripts: ['editor'] }), errors.length ? 422 : 200);
}

async function loadPost(ctx) {
  const id = parseInt(ctx.query.get('id') || ctx.form?.get('id') || '0', 10);
  return id ? one('SELECT * FROM posts WHERE id = $1', [id]) : null;
}

export const edit = {
  async GET(ctx) {
    const post = await loadPost(ctx);
    if (ctx.query.get('id') && !post) return redirect('/admin/posts/', 'המאמר לא נמצא.', 'error');
    return editorPage(ctx, post || { id: 0, title: '', body: '', excerpt: '', seo_title: '', categories: [], tags: [], status: 'draft', date: israelNow(), path: '', wp_id: null });
  },

  async POST(ctx) {
    const post = await loadPost(ctx);
    if (ctx.form.get('id') && ctx.form.get('id') !== '0' && !post) return redirect('/admin/posts/', 'המאמר לא נמצא.', 'error');
    const action = String(ctx.form.get('action') || 'publish');

    if (action === 'delete' && post) {
      await saveRevision(ctx, 'post', post, 'לפני מחיקה');
      await q('DELETE FROM posts WHERE id = $1', [post.id]);
      publishChanges();
      await logActivity(ctx, 'מחק מאמר', post.title);
      const hint = post.status === 'published' ? ' כדי לא לאבד את הקידום, כדאי להפנות את הכתובת שלו למאמר קרוב.' : '';
      return redirect(post.status === 'published' ? '/admin/redirects/' + qs({ from: post.path }) + '#redirect-form' : '/admin/posts/', 'המאמר נמחק.' + hint);
    }

    const cats = await termMap('category');
    const tagNames = await termMap('tag');
    const p = await fromForm(ctx, post, tagNames);
    const errors = [];
    if (!p.title) errors.push('חסרה כותרת.');
    if (!plain(p.body) && !p.body.includes('<img') && !p.body.includes('data-yt')) errors.push('המאמר ריק.');
    if (p.categories.some((c) => !(c in cats))) errors.push('נושא לא מוכר.');
    if (errors.length) return editorPage(ctx, p, errors);

    const wasPublished = post?.status === 'published';
    p.status = action === 'draft' ? 'draft' : 'published';
    // The address is fixed once a post has been published (changing it would lose rankings).
    if (!wasPublished && !post?.wp_id) {
      p.path = await uniquePath(makeSlug(String(ctx.form.get('slug') || '').trim() || p.title), post?.id ?? null);
    }
    for (const [slug, name] of Object.entries(p.tag_names)) {
      await q(`INSERT INTO terms(kind, slug, name) VALUES('tag', $1, $2) ON CONFLICT DO NOTHING`, [slug, name]);
      // A new tag gets its page, listing its posts, so the tag's link on the post leads somewhere
      const main = `<header class="page-hero"><div class="wrap"><p class="crumb">תגית</p><h1>${esc(name)}</h1></div></header>
<section class="block"><div class="wrap"><!--yk:list--><!--/yk:list--></div></section>
${contactHtml()}`;
      await q(`INSERT INTO pages(path, kind, title, description, main) VALUES($1, 'tag', $2, $3, $4) ON CONFLICT (path) DO NOTHING`,
        [`/tag/${slug}/`, name, `תגית: ${name} – ירדן כרם`, main]);
    }
    const description = p.excerpt || plain(p.body, 155);
    const vals = [p.path, p.title, p.body, p.excerpt, p.seo_title, description, JSON.stringify(p.categories), JSON.stringify(p.tags), p.status, p.is_video, p.date];
    let id;
    if (post) {
      await saveRevision(ctx, 'post', post, wasPublished ? 'עריכת מאמר' : 'עריכת טיוטה');
      await q(`UPDATE posts SET path=$1, title=$2, body=$3, format='rich', excerpt=$4, seo_title=$5, description=$6, categories=$7, tags=$8, status=$9, is_video=$10, date=$11, modified=(now() AT TIME ZONE 'Asia/Jerusalem') WHERE id=$12`, [...vals, post.id]);
      id = post.id;
    } else {
      [{ id }] = await q(`INSERT INTO posts(path, title, body, format, excerpt, seo_title, description, categories, tags, status, is_video, date, modified)
                          VALUES($1,$2,$3,'rich',$4,$5,$6,$7,$8,$9,$10,$11, now()) RETURNING id`, vals);
    }
    publishChanges();
    const isPub = p.status === 'published';
    await logActivity(ctx, isPub ? (post ? 'עדכן מאמר' : 'פרסם מאמר חדש') : 'שמר טיוטה', p.title, `/admin/post-edit/?id=${id}`);
    return redirect(`/admin/post-edit/?id=${id}`, isPub ? 'המאמר פורסם באתר (מופיע תוך דקה).' : 'הטיוטה נשמרה. היא לא מופיעה באתר עד שתפרסמו אותה.');
  },
};

export const preview = {
  async GET() { return redirect('/admin/posts/'); },
  async POST(ctx) {
    const tagNames = await termMap('tag');
    const p = await fromForm(ctx, null, tagNames);
    p.title ||= 'ללא כותרת';
    const [categories, tags] = await Promise.all([terms('category'), terms('tag')]);
    const main = postMainHtml({ ...p, path: '/preview/' }, { categories, tags: [...tags, ...Object.entries(p.tag_names).map(([slug, name]) => ({ slug, name }))], related: [], contact: contactHtml() });
    const doc = pageDocument({ path: '/preview/', title: p.title, noindex: true, main })
      .replace('<body>', '<body><div style="position:sticky;top:0;z-index:100;background:#b35c00;color:#fff;text-align:center;padding:8px;font:500 15px sans-serif">תצוגה מקדימה – השינויים עוד לא נשמרו</div>');
    return new Response(doc, { headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; frame-src https://www.youtube-nocookie.com https://www.youtube.com" } });
  },
};
