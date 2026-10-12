/** Share images made by scripts/gen-og.mjs: public/og/<ogKey(path)>.jpg */

/** A short, stable file name for a page address (addresses are Hebrew). */
export function ogKey(path) {
  let a = 2166136261, b = 5381;
  for (const ch of String(path)) {
    const c = ch.codePointAt(0);
    a = Math.imul(a ^ c, 16777619);
    b = Math.imul(b, 33) ^ c;
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0').slice(0, 4);
}
