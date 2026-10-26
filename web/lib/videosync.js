/**
 * Keeps /המלצות/ showing the testimonial videos of the Focusing for Freedom
 * site (Yarden's storytelling site). It reads that site's
 * /testimonials/export.json: a video added there shows up here, one taken off
 * there goes from here, in that page's order.
 *
 * The list is kept in settings and drawn into the page's <!--yk:videos-->
 * region (lib/content.js). Until a first copy succeeds, the region shows the
 * videos stored in the page. A failed or empty answer changes nothing.
 *
 * Runs with the blog copy (app/api/blog-sync, every 15 minutes) and from the
 * "סנכרון עכשיו" button on the admin's testimonials screen.
 */
import { one, getSetting, setSetting } from './db';
import { VIDEO_LIST_KEY, syncedVideos } from './content';
import { publishChanges } from './admin/common';
import { SOURCE_NAME } from './blogsync';

const SOURCE = process.env.VIDEO_SYNC_URL || 'https://storytelling-site-he.vercel.app/testimonials/export.json';
export const VIDEOS_PAGE = '/המלצות/';
const STATE_KEY = 'video_sync';

const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** The last run: { at, ok, added, removed, error }. */
export async function lastVideoSync() {
  try { return JSON.parse(await getSetting(STATE_KEY, '')); } catch { return null; }
}

let running = null;
/** One run at a time: a click during a scheduled run waits for that run. */
export function syncVideos() {
  running ??= run().finally(() => { running = null; });
  return running;
}

async function run() {
  const result = { at: new Date().toISOString(), ok: false, added: 0, removed: 0, error: '' };
  let changed = false;
  try {
    const res = await fetch(SOURCE, { headers: { accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(30000) })
      .catch((err) => { throw new Error(err?.name === 'TimeoutError' ? `${SOURCE_NAME} לא ענה בזמן.` : `אין חיבור ל־${SOURCE_NAME}.`); });
    if (!res.ok) throw new Error(`${SOURCE_NAME} לא ענה (${res.status}).`);
    const feed = await res.json().catch(() => null);
    if (!Array.isArray(feed?.videos)) throw new Error('התשובה לא בפורמט הצפוי.');

    const videos = [];
    const seen = new Set();
    for (const v of feed.videos) {
      const id = String(v?.id ?? '');
      if (!/^[\w-]{11}$/.test(id) || seen.has(id)) continue;
      seen.add(id);
      // The first label is the card's kind ("המלצה על קורס התמקדות"); any after it tell the video apart
      const labels = Array.isArray(v.labels) ? v.labels.map((l) => clean(l, 120)).filter(Boolean) : [];
      videos.push({ id, name: clean(v.name, 200), note: labels.slice(1, 4).join(' · ') });
    }
    // An empty list is more likely a fault there than every video taken down: leave the page as it is
    if (!videos.length) throw new Error(`בעמוד העדויות של ${SOURCE_NAME} לא נמצאו סרטונים.`);

    const stored = await syncedVideos();
    const before = stored ?? await videosInPage();
    const had = new Set(before.map((v) => v.id));
    result.added = videos.filter((v) => !had.has(v.id)).length;
    result.removed = before.filter((v) => !seen.has(v.id)).length;
    if (JSON.stringify(stored) !== JSON.stringify(videos)) {
      await setSetting(VIDEO_LIST_KEY, JSON.stringify(videos));
      changed = true;
    }
    result.ok = true;
  } catch (err) {
    result.error = String(err?.message || err);
  }
  await setSetting(STATE_KEY, JSON.stringify(result));
  if (changed) publishChanges();
  return result;
}

/** Before the first copy: the videos the page shows from its own stored region. */
async function videosInPage() {
  const page = await one('SELECT main FROM pages WHERE path = $1', [VIDEOS_PAGE]);
  const region = /<!--yk:videos-->([\s\S]*?)<!--\/yk:videos-->/.exec(page?.main || '')?.[1] || '';
  return [...region.matchAll(/data-yt="([\w-]{11})"/g)].map(([, id]) => ({ id }));
}
