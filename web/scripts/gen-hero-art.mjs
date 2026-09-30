/**
 * The home hero's artwork: the lens (rings around a soft core) with a ribbon
 * of fine lines flowing through it — listening inward, moving outward.
 * Writes public/assets/art/hero.svg. Run: node scripts/gen-hero-art.mjs
 */
import { writeFileSync } from 'node:fs';

const W = 1000, H = 1000, C = 500;
const r2 = (n) => Math.round(n * 10) / 10;

// seeded random, so the file only changes when this script does
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

// Rings: fine, fading outward; a few dashed ones turn slowly
const rings = [];
for (let i = 1; i <= 15; i++) {
  const r = 34 * i + i * i * 0.9;
  const o = r2(0.34 - i * 0.018);
  const dashed = i % 4 === 2;
  rings.push(`<circle cx="${C}" cy="${C}" r="${r2(r)}"${dashed ? ` stroke-dasharray="${r2(r / 18)} ${r2(r / 11)}" class="turn${i % 8 === 2 ? ' rev' : ''}"` : ''} stroke-opacity="${Math.max(o, 0.06)}"/>`);
}

// The ribbon: lines that share a slow wave and twist around each other,
// gathering in the centre and fanning out toward the edges
const lines = [];
const N = 26;
for (let i = 0; i < N; i++) {
  const t = i / (N - 1);
  const pts = [];
  for (let x = -60; x <= W + 60; x += 12) {
    const u = (x - C) / 520;
    const gather = 0.18 + 0.82 * Math.min(1, u * u * 1.6);          // narrow at the core
    const wave = 120 * Math.sin(x / 190 + 0.6) * Math.exp(-u * u * 0.9);
    const twist = 150 * gather * Math.sin(x / 150 + t * Math.PI * 1.25);
    const lift = (t - 0.5) * 70 * gather;
    pts.push([x, C + wave + twist * 0.55 + lift - u * 60]);
  }
  let d = `M${r2(pts[0][0])} ${r2(pts[0][1])}`;
  for (let k = 1; k < pts.length - 1; k++) {
    const [x1, y1] = pts[k], [x2, y2] = pts[k + 1];
    d += ` Q${r2(x1)} ${r2(y1)} ${r2((x1 + x2) / 2)} ${r2((y1 + y2) / 2)}`;
  }
  lines.push(`<path d="${d}" stroke-opacity="${r2(0.35 + 0.55 * Math.sin(t * Math.PI))}"/>`);
}

// Specks of light scattered on the rings
const specks = [];
for (let i = 0; i < 70; i++) {
  const ring = 2 + Math.floor(rnd() * 12);
  const r = 34 * ring + ring * ring * 0.9;
  const a = rnd() * Math.PI * 2;
  const size = r2(0.8 + rnd() * 2.2);
  specks.push(`<circle cx="${r2(C + r * Math.cos(a))}" cy="${r2(C + r * Math.sin(a))}" r="${size}" opacity="${r2(0.25 + rnd() * 0.6)}"${i % 5 === 0 ? ' class="blink"' : ''} style="animation-delay:${r2(rnd() * 6)}s"/>`);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" fill="none">
<defs>
  <radialGradient id="glow" cx="50%" cy="50%" r="50%">
    <stop offset="0" stop-color="#ffffff" stop-opacity=".95"/>
    <stop offset=".06" stop-color="#dfe7fb" stop-opacity=".8"/>
    <stop offset=".2" stop-color="#5b86ff" stop-opacity=".42"/>
    <stop offset=".5" stop-color="#2e57c4" stop-opacity=".16"/>
    <stop offset="1" stop-color="#2e57c4" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="warm" cx="50%" cy="50%" r="50%">
    <stop offset="0" stop-color="#f6e2b8" stop-opacity=".55"/>
    <stop offset=".35" stop-color="#f6e2b8" stop-opacity=".12"/>
    <stop offset="1" stop-color="#f6e2b8" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="thread" x1="0" y1="0" x2="${W}" y2="0" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#5b86ff" stop-opacity="0"/>
    <stop offset=".22" stop-color="#5b86ff"/>
    <stop offset=".5" stop-color="#ffffff"/>
    <stop offset=".78" stop-color="#b9cbf5"/>
    <stop offset="1" stop-color="#b9cbf5" stop-opacity="0"/>
  </linearGradient>
  <radialGradient id="fade" cx="50%" cy="50%" r="50%">
    <stop offset=".62" stop-color="#fff"/>
    <stop offset="1" stop-color="#fff" stop-opacity="0"/>
  </radialGradient>
  <mask id="soft"><rect width="${W}" height="${H}" fill="url(#fade)"/></mask>
</defs>
<style>
  .rings { stroke: #b9cbf5; stroke-width: 1; }
  .ribbon { stroke: url(#thread); stroke-width: 1.1; }
  .specks { fill: #dfe7fb; }
  .turn { transform-origin: 500px 500px; animation: turn 90s linear infinite; }
  .rev { animation-direction: reverse; animation-duration: 120s; }
  .core { transform-origin: 500px 500px; animation: breathe 9s ease-in-out infinite; }
  .ribbon { animation: drift 14s ease-in-out infinite; }
  .blink { animation: blink 6s ease-in-out infinite; }
  @keyframes turn { to { transform: rotate(360deg); } }
  @keyframes breathe { 0%, 100% { transform: scale(.94); opacity: .85; } 50% { transform: scale(1.06); opacity: 1; } }
  @keyframes drift { 0%, 100% { transform: translateY(-6px); } 50% { transform: translateY(8px); } }
  @keyframes blink { 0%, 100% { opacity: .15; } 50% { opacity: .9; } }
  @media (prefers-reduced-motion: reduce) { .turn, .core, .ribbon, .blink { animation: none; } }
</style>
<g mask="url(#soft)">
  <g class="core"><circle cx="${C}" cy="${C}" r="470" fill="url(#glow)"/><circle cx="${C}" cy="${C}" r="210" fill="url(#warm)"/></g>
  <g class="rings">${rings.join('')}</g>
  <g class="ribbon">${lines.join('')}</g>
  <g class="specks">${specks.join('')}</g>
  <circle cx="${C}" cy="${C}" r="5" fill="#fff"/>
</g>
</svg>
`;
writeFileSync(new URL('../public/assets/art/hero.svg', import.meta.url), svg);
console.log('hero.svg', svg.length, 'bytes');
