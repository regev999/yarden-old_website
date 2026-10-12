/**
 * Where uploaded files live.
 * - With BLOB_READ_WRITE_TOKEN (Vercel): Vercel Blob.
 * - Otherwise (a regular server, e.g. Proginter): on disk in UPLOAD_DIR
 *   (default: ./storage next to the app), served at /files/… by app/files.
 */
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

export const uploadDir = () => path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), 'storage'));
const onBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;

/** Save a file; `name` is like uploads/2026/09/photo.jpg. Returns its public URL. */
export async function putFile(name, buf, contentType) {
  if (onBlob()) {
    const { put } = await import('@vercel/blob');
    const blob = await put(name, buf, { access: 'public', contentType, addRandomSuffix: true, cacheControlMaxAge: 31536000 });
    return blob.url;
  }
  const final = name.replace(/(\.\w+)$/, `-${randomBytes(4).toString('hex')}$1`);
  const file = path.join(uploadDir(), final);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, buf);
  return '/files/' + final.split('/').map(encodeURIComponent).join('/');
}

export async function deleteFile(url) {
  if (url.startsWith('/files/')) {
    const rel = decodeURIComponent(url.slice(7));
    const file = path.resolve(uploadDir(), rel);
    if (file.startsWith(uploadDir() + path.sep)) await rm(file, { force: true });
    return;
  }
  if (onBlob()) {
    const { del } = await import('@vercel/blob');
    await del(url);
  }
}
