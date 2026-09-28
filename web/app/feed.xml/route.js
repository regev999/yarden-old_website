import { rssFeed, xmlResponse } from '@/lib/feeds';

export const dynamic = 'force-dynamic';
export async function GET() {
  return xmlResponse(await rssFeed(), 'application/rss+xml');
}
