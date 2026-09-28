import { robotsTxt, xmlResponse } from '@/lib/feeds';

export function GET() {
  return xmlResponse(robotsTxt(), 'text/plain');
}
