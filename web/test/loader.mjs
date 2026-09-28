import { pathToFileURL } from 'node:url';
import path from 'node:path';
const root = path.resolve(new URL('..', import.meta.url).pathname);
const alias = {
  'next/cache': 'test/stubs/next-cache.mjs',
  '@neondatabase/serverless': 'test/stubs/neon.mjs',
  '@vercel/blob': 'test/stubs/blob.mjs',
};
export async function resolve(spec, ctx, next) {
  if (alias[spec]) return next(pathToFileURL(path.join(root, alias[spec])).href, ctx);
  if (spec.startsWith('@/')) {
    let p = path.join(root, spec.slice(2));
    if (!path.extname(p)) p += '.js';
    return next(pathToFileURL(p).href, ctx);
  }
  if ((spec.startsWith('./') || spec.startsWith('../')) && !path.extname(spec) && ctx.parentURL?.startsWith('file:')) {
    return next(new URL(spec + '.js', ctx.parentURL).href, ctx);
  }
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  // Project files are ES modules (Next compiles them); tell Node so.
  if (url.startsWith(pathToFileURL(root).href) && url.endsWith('.js')) return next(url, { ...ctx, format: 'module' });
  return next(url, ctx);
}
