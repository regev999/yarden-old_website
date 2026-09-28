// Local stand-in for next/cache: no caching, invalidations are just recorded.
export const revalidated = [];
export function unstable_cache(fn) { return fn; }
export function revalidateTag(tag) { revalidated.push(tag); }
export function revalidatePath(p) { revalidated.push(p); }
