/**
 * Copies new and edited posts from the Focusing for Freedom blog (lib/blogsync.js).
 * instrumentation.js calls it every 15 minutes. It only ever reads that blog, and
 * runs at most every 5 minutes, so a call from anywhere else changes nothing.
 */
import { lastSync, syncBlog } from '@/lib/blogsync';

export const dynamic = 'force-dynamic';

const HEADERS = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };
const MIN_GAP = 5 * 60 * 1000;

export async function GET() {
  const last = await lastSync();
  if (last && Date.now() - Date.parse(last.at) < MIN_GAP) return Response.json({ skipped: true, last }, { headers: HEADERS });
  return Response.json(await syncBlog(), { headers: HEADERS });
}
