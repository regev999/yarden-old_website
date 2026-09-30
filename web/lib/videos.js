/** Video titles and removed videos (server-only: reads content/video-titles.json). */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { esc } from './html';

let videoTitles;
function titles() {
  if (!videoTitles) {
    try { videoTitles = JSON.parse(readFileSync(path.join(process.cwd(), 'content', 'video-titles.json'), 'utf8')); } catch { videoTitles = {}; }
  }
  return videoTitles;
}

const VIDEO_RE = /<div class="video" data-yt="([\w-]{11})"><button type="button" class="video__play" aria-label="[^"]*"([^>]*)><span class="video__icon" aria-hidden="true"><\/span><\/button><\/div>/g;

/**
 * Videos get their YouTube title (content/video-titles.json, fetched from
 * YouTube's oEmbed): as the play button's label, and as a caption in plain
 * video grids. Videos removed from YouTube show a note instead of a dead player.
 */
export function titleVideos(html) {
  const T = titles();
  const one = (id, rest) => {
    const t = T[id];
    if (t?.unavailable === 404) return `<div class="video video--gone" data-yt="${id}"><p>הסרטון הזה הוסר מיוטיוב</p></div>`;
    const label = t?.title ? `הפעלת סרטון: ${esc(t.title)}` : 'הפעלת סרטון';
    return `<div class="video" data-yt="${id}"><button type="button" class="video__play" aria-label="${label}"${rest}><span class="video__icon" aria-hidden="true"></span></button></div>`;
  };
  // Plain grids of videos become captioned films
  let out = html.replace(/<div class="video-grid">((?:\s*<div class="video" data-yt="[\w-]{11}"><button[^>]*><span class="video__icon" aria-hidden="true"><\/span><\/button><\/div>)+)\s*<\/div>/g, (m, inner) => {
    const figs = [...inner.matchAll(/<div class="video" data-yt="([\w-]{11})"><button type="button" class="video__play" aria-label="[^"]*"([^>]*)>/g)].map(([, id, rest]) => {
      const t = T[id]?.title;
      return `<figure class="film">${one(id, rest)}${t ? `<figcaption><h3>${esc(t)}</h3></figcaption>` : ''}</figure>`;
    });
    return `<div class="films films--grid">${figs.join('')}</div>`;
  });
  out = out.replace(VIDEO_RE, (m, id, rest) => one(id, rest));
  return out;
}
