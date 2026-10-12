/** Files uploaded in the admin when running on a regular server (see lib/storage.js). */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { uploadDir } from '@/lib/storage';

const TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', pdf: 'application/pdf', mp4: 'video/mp4' };

export async function GET(_req, { params }) {
  const { path: parts } = await params;
  const root = uploadDir();
  const file = path.resolve(root, ...parts.map((p) => decodeURIComponent(p)));
  const type = TYPES[path.extname(file).slice(1).toLowerCase()];
  if (!type || !file.startsWith(root + path.sep)) return new Response('Not found', { status: 404 });
  try {
    const body = await readFile(file);
    return new Response(body, { headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
