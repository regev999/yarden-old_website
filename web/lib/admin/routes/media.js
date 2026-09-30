/**
 * Images and files. Images are resized and compressed in the browser before
 * upload (see admin.js), stored in Vercel Blob or on the server's disk (see
 * lib/storage.js), and served to visitors through Next's image optimizer
 * (AVIF/WebP in the size each screen needs).
 */
import { putFile, deleteFile } from '../../storage';
import { q, one } from '../../db';
import { logActivity } from '../common';
import { adminPage, csrfField, esc, heDate, html, humanSize, json, pager, qs, redirect } from '../ui';

const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'application/pdf': 'pdf', 'video/mp4': 'mp4' };
const MAX = 4 * 1024 * 1024; // Vercel functions accept request bodies up to 4.5 MB
const PER_PAGE = 48;

function safeName(name, ext) {
  const base = String(name).replace(/\.[^.]+$/, '').normalize('NFC').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'file';
  return `${base}.${ext}`;
}

async function store(file) {
  const type = file.type;
  if (!TYPES[type]) throw new Error(`הקובץ ${file.name} מסוג שלא נתמך (אפשר: תמונות, PDF, MP4).`);
  if (file.size > MAX) throw new Error(`הקובץ ${file.name} גדול מ־4MB. תמונות מוקטנות אוטומטית; קבצים אחרים צריך להקטין לפני ההעלאה.`);
  const buf = Buffer.from(await file.arrayBuffer());
  // Check the file really is what it claims to be (magic bytes).
  const sig = buf.subarray(0, 12).toString('hex');
  const okSig = { 'image/jpeg': /^ffd8ff/, 'image/png': /^89504e47/, 'image/gif': /^47494638/, 'image/webp': /^52494646.{8}57454250/, 'application/pdf': /^25504446/, 'image/avif': /^.{8}66747970/, 'video/mp4': /^.{8}66747970/ }[type];
  if (!okSig.test(sig)) throw new Error(`הקובץ ${file.name} פגום או לא תואם לסוג שלו.`);
  const d = new Date();
  const name = `uploads/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${safeName(file.name, TYPES[type])}`;
  const url = await putFile(name, buf, type);
  await q('INSERT INTO media(url, name, size, content_type) VALUES($1, $2, $3, $4) ON CONFLICT (url) DO NOTHING',
    [url, file.name.slice(0, 200), buf.length, type]);
  return url;
}

export const page = {
  async GET(ctx) {
    const text = (ctx.query.get('q') || '').trim();
    const type = ctx.query.get('type') || '';
    const like = '%' + text.replace(/[\\%_]/g, '\\$&') + '%';
    const where = [];
    const args = [];
    if (text) { args.push(like); where.push(`name ILIKE $${args.length}`); }
    if (type === 'image') where.push(`content_type LIKE 'image/%'`);
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';

    if (ctx.query.get('format') === 'json') {
      const rows = await q(`SELECT url, name FROM media ${w} ORDER BY created_at DESC LIMIT 200`, args);
      return json(rows);
    }
    const { n } = await one(`SELECT count(*)::int AS n FROM media ${w}`, args);
    const pages = Math.max(1, Math.ceil(n / PER_PAGE));
    const pageNo = Math.min(pages, Math.max(1, parseInt(ctx.query.get('p') || '1', 10) || 1));
    const items = await q(`SELECT * FROM media ${w} ORDER BY created_at DESC LIMIT ${PER_PAGE} OFFSET ${(pageNo - 1) * PER_PAGE}`, args);
    const body = `
<div class="media-top">
  <form method="post" enctype="multipart/form-data" class="dropzone" data-dropzone data-upload-form>${csrfField(ctx)}<input type="hidden" name="action" value="upload">
    <input type="file" name="files" id="files" multiple accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,video/mp4">
    <label for="files"><b>העלאת תמונות וקבצים</b><span>גוררים לכאן, או לוחצים לבחירה · תמונות מוקטנות ונדחסות אוטומטית</span></label>
    <p class="muted small" data-upload-status role="status"></p>
  </form>
  <form method="get" class="filters">
    <label class="filters__search">חיפוש לפי שם קובץ <input type="search" name="q" value="${esc(text)}"></label>
    <label>סוג <select name="type" data-autosubmit><option value="">הכל</option><option value="image"${type === 'image' ? ' selected' : ''}>רק תמונות</option></select></label>
  </form>
</div>
<details class="panel restore"><summary><b>התמונות מהאתר הקודם</b> · איך מחזירים אותן</summary>
  <p>התמונות הישנות נשארות בכתובות המקוריות (<code dir="ltr">/wp-content/uploads/…</code>) כדי שהקישורים והדירוג בגוגל יישמרו. מורידים מהאחסון הקודם את התיקייה <code dir="ltr">wp-content/uploads</code>, ומעתיקים אותה לפרויקט אל <code dir="ltr">web/public/wp-content/uploads</code> (אפשר לשלוח לי את ה־ZIP ואני אעשה את זה).</p>
</details>
${!items.length ? `<p class="empty">${text ? 'לא נמצאו קבצים בשם הזה.' : 'עוד אין כאן קבצים. העלו תמונה ראשונה.'}</p>` : `<ul class="media-grid">
${items.map((m) => `<li><a class="media-grid__thumb" href="${esc(m.url)}" target="_blank" rel="noopener">
  ${m.content_type.startsWith('image/') ? `<img src="${esc(m.url)}" alt="" loading="lazy">` : `<span class="filetype">${esc((m.url.split('.').pop() || '').toUpperCase())}</span>`}</a>
  <div class="media-grid__meta"><span class="media-grid__name" title="${esc(m.name)}">${esc(m.name)}</span>
    <span class="muted small">${esc(humanSize(m.size))} · ${esc(heDate(m.created_at, false))}</span>
    <div class="media-grid__actions"><button type="button" class="linklike" data-copy="${esc(m.url)}">העתקת קישור</button>
      <form method="post" data-confirm="למחוק את הקובץ? עמודים שמשתמשים בו יציגו תמונה חסרה.">${csrfField(ctx)}<input type="hidden" name="action" value="delete"><input type="hidden" name="id" value="${m.id}">
        <button type="submit" class="linklike linklike--danger">מחיקה</button></form></div></div></li>`).join('')}
</ul>${pager(pageNo, pages, { q: text, type })}`}`;
    return html(await adminPage(ctx, { title: 'תמונות וקבצים', active: 'media', body }));
  },

  async POST(ctx) {
    const wantsJson = ctx.query.get('format') === 'json' || (ctx.request.headers.get('accept') || '').includes('application/json');
    const action = String(ctx.form.get('action') || 'upload');
    try {
      if (action === 'upload') {
        const files = [...ctx.form.getAll('files'), ...ctx.form.getAll('files[]')].filter((f) => typeof f === 'object' && f.size);
        if (!files.length) throw new Error('לא נבחרו קבצים.');
        const urls = [];
        for (const f of files) urls.push(await store(f));
        await logActivity(ctx, `העלה ${urls.length} קבצים`, files.at(-1).name, '/admin/media/');
        if (wantsJson) return json({ ok: true, urls });
        return redirect('/admin/media/', urls.length === 1 ? 'הקובץ הועלה.' : `${urls.length} קבצים הועלו.`);
      }
      if (action === 'delete') {
        const m = await one('DELETE FROM media WHERE id = $1 RETURNING url, name', [parseInt(ctx.form.get('id'), 10) || 0]);
        if (!m) throw new Error('הקובץ לא נמצא.');
        await deleteFile(m.url).catch(() => {});
        await logActivity(ctx, 'מחק קובץ', m.name);
        return redirect('/admin/media/', 'הקובץ נמחק.');
      }
      throw new Error('פעולה לא מוכרת.');
    } catch (e) {
      if (wantsJson) return json({ ok: false, error: e.message }, 422);
      return redirect('/admin/media/', e.message, 'error');
    }
  },
};
