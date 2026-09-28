import { handle } from '@/lib/admin/router';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

async function run(request, { params }) {
  const { path } = await params;
  return handle(request, path);
}

export const GET = run;
export const POST = run;
export const HEAD = run;
