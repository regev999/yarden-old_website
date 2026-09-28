// Local stand-in for @vercel/blob: files go to test/.blob and are served at /__blob/.
import { mkdirSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
const dir = path.join(process.cwd(), 'test', '.blob');
export async function put(name, body, opts = {}) {
  mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
  const final = opts.addRandomSuffix ? name.replace(/(\.\w+)$/, '-' + Math.random().toString(36).slice(2, 8) + '$1') : name;
  writeFileSync(path.join(dir, final), Buffer.from(await new Response(body).arrayBuffer()));
  return { url: 'http://localhost:3000/__blob/' + final, pathname: final, contentType: opts.contentType };
}
export async function del(urls) {
  for (const u of [].concat(urls)) rmSync(path.join(dir, new URL(u).pathname.replace('/__blob/', '')), { force: true });
}
export async function list() {
  let blobs = [];
  try { blobs = readdirSync(dir).map((f) => ({ url: 'http://localhost:3000/__blob/' + f, pathname: f, size: statSync(path.join(dir, f)).size })); } catch {}
  return { blobs };
}
