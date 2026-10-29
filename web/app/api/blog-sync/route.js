/**
 * Copies new and edited posts from the Focusing for Freedom blog (lib/blogsync.js),
 * that site's testimonial videos to /המלצות/ (lib/videosync.js), and the date and
 * price of its flagship lecture to /הרצאה/ (lib/lecturesync.js).
 * instrumentation.js calls it every 15 minutes. It only ever reads that blog, and
 * runs at most every 5 minutes, so a call from anywhere else changes nothing.
 */
import { lastSync, syncBlog } from '@/lib/blogsync';
import { syncVideos } from '@/lib/videosync';
import { syncLecture } from '@/lib/lecturesync';

export const dynamic = 'force-dynamic';

const HEADERS = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };
const MIN_GAP = 5 * 60 * 1000;

export async function GET() {
  const last = await lastSync();
  if (last && Date.now() - Date.parse(last.at) < MIN_GAP) return Response.json({ skipped: true, last }, { headers: HEADERS });
  const [blog, videos, lecture] = await Promise.all([syncBlog(), syncVideos(), syncLecture()]);
  return Response.json({ ...blog, videos, lecture }, { headers: HEADERS });
}
