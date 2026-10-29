/**
 * The flagship lecture ("למה זה לא זז?") is sold on the Focusing for Freedom
 * site, where its price and date are set from that site's dashboard (product
 * "lecture"). The lecture page here (/הרצאה/) shows the same: this reads that
 * product's public /api/product, keeps it in settings, and lib/content.js draws
 * it into the page's <!--yk:lecturefacts--> and <!--yk:lecturewhen--> regions.
 * A failed answer, or a product taken off sale there, changes nothing here.
 *
 * Runs with the blog copy (app/api/blog-sync, every 15 minutes).
 */
import { setSetting } from './db';
import { LECTURE_KEY, lectureEvent } from './content';
import { publishChanges } from './admin/common';

const SOURCE = process.env.LECTURE_SYNC_URL || 'https://storytelling-site-he.vercel.app/api/product?slug=lecture';

const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export async function syncLecture() {
  try {
    const res = await fetch(SOURCE, { headers: { accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(30000) });
    if (!res.ok) return { ok: false, error: `status ${res.status}` };
    const p = await res.json().catch(() => null);
    if (typeof p?.price_agorot !== 'number') return { ok: false, error: 'unexpected answer' };
    const ev = {
      price: Math.max(0, Math.round(p.price_agorot / 100)),
      date: clean(p.event_date, 80),
      time: clean(p.event_time, 20),
      location: clean(p.event_location, 60),
    };
    if (JSON.stringify(ev) !== JSON.stringify(await lectureEvent())) {
      await setSetting(LECTURE_KEY, JSON.stringify(ev));
      publishChanges();
    }
    return { ok: true, ...ev };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}
