/**
 * Draws the site's line illustrations into public/assets/art/.
 * Each subject gets one motif, used as a CSS mask so it takes any colour:
 *   <key>.svg       detailed, for page heroes and article covers
 *   <key>-icon.svg  simplified, for small icons
 * Strokes don't scale (vector-effect), so lines stay hairline-thin at any size.
 * Run: node scripts/gen-art.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'public', 'assets', 'art');
mkdirSync(out, { recursive: true });

const f = (n) => Math.round(n * 100) / 100;
const TAU = Math.PI * 2;

function svg(body, stroke) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" fill="none" stroke="#000" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">`
    + `<style>*{vector-effect:non-scaling-stroke}</style>${body}</svg>\n`;
}
const circle = (cx, cy, r, extra = '') => `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}"${extra}/>`;
const dot = (cx, cy, r) => circle(cx, cy, r, ' fill="#000" stroke="none"');
const line = (x1, y1, x2, y2) => `<path d="M${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}"/>`;
const poly = (pts, close = false) => `<path d="M${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}${close ? 'Z' : ''}"/>`;
function arc(cx, cy, r, a0, a1) {
  const p = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  return `<path d="M${f(x0)} ${f(y0)}A${f(r)} ${f(r)} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${f(x1)} ${f(y1)}"/>`;
}

const art = {
  // Focusing: rings drawing closer and closer to one point
  focus: {
    hero: () => [92, 75, 60, 47, 36, 27, 20, 14, 9].map((r) => circle(100, 100, r)).join('') + dot(100, 100, 3),
    icon: () => [86, 58, 32].map((r) => circle(100, 100, r)).join('') + dot(100, 100, 10),
  },
  // Somatic Experiencing: pendulation, a swing between expansion and contraction that settles
  waves: {
    hero: () => {
      const wave = (sign, amp0) => {
        const pts = [];
        for (let x = 8; x <= 192; x += 1.5) {
          const a = amp0 * Math.exp(-(x - 8) / 90);
          pts.push([x, 100 + sign * a * Math.sin((x - 8) * TAU / 62)]);
        }
        return poly(pts);
      };
      return wave(1, 62) + wave(-1, 62) + wave(1, 30) + wave(-1, 30) + line(8, 100, 192, 100) + dot(192, 100, 3);
    },
    icon: () => {
      const wave = (sign) => {
        const pts = [];
        for (let x = 12; x <= 188; x += 2) pts.push([x, 100 + sign * 66 * Math.exp(-(x - 12) / 95) * Math.sin((x - 12) * TAU / 88)]);
        return poly(pts);
      };
      return wave(1) + wave(-1) + line(12, 100, 188, 100);
    },
  },
  // Hakomi: organic, nested layers of experience around a core
  organic: {
    hero: () => [88, 71, 55, 40, 26, 14].map((R, i) => {
      const pts = [];
      for (let t = 0; t <= 360; t += 3) {
        const a = (t * Math.PI) / 180;
        const r = R * (1 + 0.07 * Math.sin(3 * a + i * 0.9) + 0.04 * Math.sin(5 * a + i * 1.7));
        pts.push([100 + r * Math.cos(a), 100 + r * Math.sin(a)]);
      }
      return poly(pts, true);
    }).join('') + dot(100, 100, 3),
    icon: () => [84, 54, 26].map((R, i) => {
      const pts = [];
      for (let t = 0; t <= 360; t += 4) {
        const a = (t * Math.PI) / 180;
        const r = R * (1 + 0.09 * Math.sin(3 * a + i));
        pts.push([100 + r * Math.cos(a), 100 + r * Math.sin(a)]);
      }
      return poly(pts, true);
    }).join(''),
  },
  // Video therapy: a film frame with a lens inside it
  film: {
    hero: () => {
      let s = '<rect x="18" y="40" width="164" height="120" rx="8"/>' + line(18, 60, 182, 60) + line(18, 140, 182, 140);
      for (let x = 27; x < 180; x += 14) s += `<rect x="${x}" y="46" width="7" height="8" rx="1.5"/><rect x="${x}" y="146" width="7" height="8" rx="1.5"/>`;
      return s + [30, 20, 11].map((r) => circle(100, 100, r)).join('') + dot(100, 100, 2.5);
    },
    icon: () => {
      let s = '<rect x="16" y="34" width="168" height="132" rx="14"/>' + line(16, 62, 184, 62) + line(16, 138, 184, 138);
      for (let x = 34; x < 180; x += 36) s += `<rect x="${x}" y="42" width="12" height="12" rx="2"/><rect x="${x}" y="146" width="12" height="12" rx="2"/>`;
      return s + circle(100, 100, 22);
    },
  },
  // Phototherapy: the aperture of a camera
  aperture: {
    hero: () => {
      const R = 90;
      const hex = Array.from({ length: 6 }, (_, i) => {
        const a = (i * 60 + 15) * Math.PI / 180;
        return [100 + 30 * Math.cos(a), 100 + 30 * Math.sin(a)];
      });
      let s = circle(100, 100, R) + circle(100, 100, R - 7) + poly(hex, true);
      hex.forEach((p, i) => {
        const q = hex[(i + 1) % 6];
        const d = [q[0] - p[0], q[1] - p[1]];
        const px = p[0] - 100, py = p[1] - 100;
        const A = d[0] ** 2 + d[1] ** 2, B = 2 * (px * d[0] + py * d[1]), C = px ** 2 + py ** 2 - (R - 7) ** 2;
        const t = (-B + Math.sqrt(B * B - 4 * A * C)) / (2 * A);
        s += line(p[0], p[1], p[0] + t * d[0], p[1] + t * d[1]);
      });
      return s;
    },
    icon: () => {
      const R = 84;
      const hex = Array.from({ length: 6 }, (_, i) => {
        const a = (i * 60 + 15) * Math.PI / 180;
        return [100 + 34 * Math.cos(a), 100 + 34 * Math.sin(a)];
      });
      let s = circle(100, 100, R) + poly(hex, true);
      hex.forEach((p, i) => {
        const q = hex[(i + 1) % 6];
        const d = [q[0] - p[0], q[1] - p[1]];
        const px = p[0] - 100, py = p[1] - 100;
        const A = d[0] ** 2 + d[1] ** 2, B = 2 * (px * d[0] + py * d[1]), C = px ** 2 + py ** 2 - R ** 2;
        const t = (-B + Math.sqrt(B * B - 4 * A * C)) / (2 * A);
        s += line(p[0], p[1], p[0] + t * d[0], p[1] + t * d[1]);
      });
      return s;
    },
  },
  // Touch (Greenberg): two sets of ripples meeting
  touch: {
    hero: () => '<defs><clipPath id="c"><circle cx="100" cy="100" r="92"/></clipPath></defs><g clip-path="url(#c)">'
      + [12, 26, 40, 54, 68].map((r) => circle(70, 100, r) + circle(130, 100, r)).join('') + '</g>' + dot(100, 100, 3),
    icon: () => [28, 58].map((r) => circle(70, 100, r) + circle(130, 100, r)).join(''),
  },
  // Paula method: ring muscles along the body's axis
  rings: {
    hero: () => line(100, 14, 100, 186) + [[34, 22, 6], [68, 42, 10], [104, 58, 13], [140, 44, 10], [170, 26, 6]]
      .map(([y, rx, ry]) => `<ellipse cx="100" cy="${y}" rx="${rx}" ry="${ry}"/><ellipse cx="100" cy="${y}" rx="${f(rx * 0.55)}" ry="${f(ry * 0.55)}"/>`).join(''),
    icon: () => line(100, 16, 100, 184) + [[46, 44, 12], [100, 70, 18], [154, 44, 12]]
      .map(([y, rx, ry]) => `<ellipse cx="100" cy="${y}" rx="${rx}" ry="${ry}"/>`).join(''),
  },
  // Courses and the school: a circle of people around a shared centre
  group: {
    hero: () => {
      let s = circle(100, 100, 72, ' stroke-dasharray="2 5"') + circle(100, 100, 26) + circle(100, 100, 12) + dot(100, 100, 3);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU - Math.PI / 2;
        s += circle(100 + 72 * Math.cos(a), 100 + 72 * Math.sin(a), 9);
      }
      return s;
    },
    icon: () => {
      let s = circle(100, 100, 24);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        s += circle(100 + 70 * Math.cos(a), 100 + 70 * Math.sin(a), 14);
      }
      return s;
    },
  },
  // Articles and press: lines of (right-to-left) text seen through the lens
  lines: {
    hero: () => {
      let s = circle(100, 100, 90);
      const lens = [0.92, 0.7, 1, 0.82, 0.55, 0.95, 0.74, 0.4];
      [52, 66, 80, 94, 108, 122, 136, 150].forEach((y, i) => {
        const w = Math.sqrt(90 ** 2 - (y - 100) ** 2) - 20;
        s += line(100 + w, y, 100 + w - lens[i] * 2 * w, y);
      });
      return s;
    },
    icon: () => {
      let s = circle(100, 100, 86);
      [[66, 0.9], [92, 1], [118, 0.75], [144, 0.5]].forEach(([y, k]) => {
        const w = Math.sqrt(86 ** 2 - (y - 100) ** 2) - 24;
        s += line(100 + w, y, 100 + w - k * 2 * w, y);
      });
      return s;
    },
  },
  // Podcast: a voice going out in waves
  sound: {
    hero: () => [18, 34, 50, 66, 82, 98, 114].map((r) => arc(46, 100, r, -0.95, 0.95)).join('') + dot(46, 100, 4),
    icon: () => [40, 80, 120].map((r) => arc(38, 100, r, -0.8, 0.8)).join('') + dot(38, 100, 12),
  },
  // Testimonials: two voices meeting
  voices: {
    hero: () => [16, 32, 48, 64].map((r) => arc(34, 100, r, -0.9, 0.9) + arc(166, 100, r, Math.PI - 0.9, Math.PI + 0.9)).join('')
      + dot(34, 100, 3.5) + dot(166, 100, 3.5),
    icon: () => [34, 68].map((r) => arc(30, 100, r, -0.85, 0.85) + arc(170, 100, r, Math.PI - 0.85, Math.PI + 0.85)).join('')
      + dot(30, 100, 10) + dot(170, 100, 10),
  },
};

for (const [key, { hero, icon }] of Object.entries(art)) {
  writeFileSync(path.join(out, `${key}.svg`), svg(hero(), 1.3));
  writeFileSync(path.join(out, `${key}-icon.svg`), svg(icon(), 1.8));
}
console.log(`art: ${Object.keys(art).length} motifs → ${out}`);
