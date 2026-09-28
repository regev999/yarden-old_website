import { q, one } from '../../db';
import { plain } from '../../html';
import { htmlForEditor, sanitizeHtml } from '../sanitize';
import { logActivity, publishChanges } from '../common';
import { adminPage, csrfField, esc, html, redirect } from '../ui';

const all = () => q('SELECT * FROM testimonials ORDER BY position, id');

export const page = {
  async GET(ctx) {
    const editParam = ctx.query.get('edit');
    if (editParam !== null) {
      const id = parseInt(editParam, 10) || 0;
      const t = (id && (await one('SELECT * FROM testimonials WHERE id = $1', [id]))) || { id: 0, name: '', role: '', body: '', show_on_home: false, published: true };
      const body = `<p class="back"><a href="/admin/testimonials/">חזרה לכל ההמלצות</a></p>
<form method="post" class="panel stack narrow-form" data-track-changes>${csrfField(ctx)}<input type="hidden" name="action" value="save"><input type="hidden" name="id" value="${t.id}">
  <label>שם <input name="name" value="${esc(t.name)}" placeholder="למשל: מיכל כהן"></label>
  <label>תיאור קצר (לא חובה) <input name="role" value="${esc(t.role)}" placeholder="למשל: תלמידת קורס התמקדות, 2025"></label>
  <div><p class="label">הטקסט</p><div class="rte" data-rte data-name="body" data-label="טקסט ההמלצה"></div>
    <textarea name="body" hidden>${esc(htmlForEditor(t.body))}</textarea></div>
  <label class="check"><input type="checkbox" name="published" value="1"${t.published ? ' checked' : ''}> להציג באתר</label>
  <label class="check"><input type="checkbox" name="show_on_home" value="1"${t.show_on_home ? ' checked' : ''}> להציג גם בדף הבית (עדיף המלצות קצרות)</label>
  <button class="btn" type="submit">שמירה</button>
</form>`;
      return html(await adminPage(ctx, { title: t.id ? 'עריכת המלצה' : 'המלצה חדשה', active: 'testimonials', body, scripts: ['editor'] }));
    }
    const list = await all();
    const body = `<p class="muted">ההמלצות מוצגות בעמוד <a href="/לקוחות-מספרים/" target="_blank" rel="noopener">לקוחות מספרים</a> לפי הסדר כאן. המסומנות "בדף הבית" מתחלפות בדף הבית.</p>
<ol class="t-list">${list.map((t, i) => `<li id="t${t.id}" class="t-item${t.published ? '' : ' is-hidden'}">
  <div class="t-item__text"><p>${esc(plain(t.body, 220))}</p>
    <p class="small"><b>${esc(t.name || 'ללא שם')}</b>${t.role ? ' · ' + esc(t.role) : ''}
    ${t.published ? '' : '<span class="tag tag--closed">מוסתרת</span>'}${t.show_on_home ? '<span class="tag tag--new">בדף הבית</span>' : ''}</p></div>
  <div class="t-item__actions"><a href="?edit=${t.id}">עריכה</a>
    <form method="post" class="inline">${csrfField(ctx)}<input type="hidden" name="id" value="${t.id}">
      <button class="icon-btn" name="action" value="up" title="למעלה" aria-label="להזיז למעלה"${i === 0 ? ' disabled' : ''}>↑</button>
      <button class="icon-btn" name="action" value="down" title="למטה" aria-label="להזיז למטה"${i === list.length - 1 ? ' disabled' : ''}>↓</button>
      <button class="linklike small" name="action" value="toggle-home">${t.show_on_home ? 'להוריד מדף הבית' : 'להציג בדף הבית'}</button></form>
    <form method="post" class="inline" data-confirm="למחוק את ההמלצה?">${csrfField(ctx)}<input type="hidden" name="id" value="${t.id}">
      <button class="linklike linklike--danger small" name="action" value="delete">מחיקה</button></form>
  </div></li>`).join('')}</ol>`;
    return html(await adminPage(ctx, { title: 'המלצות', active: 'testimonials', body, actions: '<a class="btn" href="/admin/testimonials/?edit=0">המלצה חדשה</a>' }));
  },

  async POST(ctx) {
    const action = String(ctx.form.get('action') || '');
    const id = parseInt(ctx.form.get('id'), 10) || 0;
    if (action === 'save') {
      const name = String(ctx.form.get('name') || '').trim().slice(0, 120);
      const role = String(ctx.form.get('role') || '').trim().slice(0, 200);
      const body = sanitizeHtml(String(ctx.form.get('body') || ''));
      const home = !!ctx.form.get('show_on_home');
      const pub = !!ctx.form.get('published');
      if (!plain(body)) return redirect(`/admin/testimonials/?edit=${id}`, 'חסר טקסט להמלצה.', 'error');
      if (id) await q('UPDATE testimonials SET name=$1, role=$2, body=$3, show_on_home=$4, published=$5 WHERE id=$6', [name, role, body, home, pub, id]);
      else await q('INSERT INTO testimonials(name, role, body, show_on_home, published, position) VALUES($1,$2,$3,$4,$5,(SELECT coalesce(min(position), 0) - 1 FROM testimonials))', [name, role, body, home, pub]);
      publishChanges();
      await logActivity(ctx, id ? 'עדכן המלצה' : 'הוסיף המלצה', name || 'ללא שם', '/admin/testimonials/');
      return redirect('/admin/testimonials/', 'ההמלצה נשמרה ומוצגת באתר תוך דקה.');
    }
    if (action === 'delete' && id) {
      await q('DELETE FROM testimonials WHERE id = $1', [id]);
      publishChanges();
      await logActivity(ctx, 'מחק המלצה');
      return redirect('/admin/testimonials/', 'ההמלצה נמחקה.');
    }
    if ((action === 'up' || action === 'down') && id) {
      const ids = (await all()).map((t) => t.id);
      const i = ids.indexOf(id);
      const j = action === 'up' ? i - 1 : i + 1;
      if (i !== -1 && j >= 0 && j < ids.length) {
        [ids[i], ids[j]] = [ids[j], ids[i]];
        await q('UPDATE testimonials t SET position = x.pos FROM unnest($1::int[]) WITH ORDINALITY AS x(id, pos) WHERE t.id = x.id', [ids]);
        publishChanges();
      }
    }
    if (action === 'toggle-home' && id) {
      await q('UPDATE testimonials SET show_on_home = NOT show_on_home WHERE id = $1', [id]);
      publishChanges();
    }
    return redirect(`/admin/testimonials/#t${id}`);
  },
};
