import { sitemap, xmlResponse } from '@/lib/feeds';

export const dynamic = 'force-dynamic';
export async function GET() {
  return xmlResponse(await sitemap('category'));
}
