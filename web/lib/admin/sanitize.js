/**
 * HTML cleaner for text written in the admin (port of the PHP sanitize_html).
 * The output is rebuilt from tokens: only whitelisted tags and attributes are
 * ever written, with escaped values, so nothing unexpected passes through.
 */
import { esc, videoEmbed, youtubeId } from '../html';

const BLOCK_ALLOWED = {
  p: ['dir'], br: [], strong: [], b: [], em: [], i: [], u: [], a: ['href'], ul: [], ol: [], li: ['dir'],
  h2: ['dir'], h3: ['dir'], h4: ['dir'], blockquote: [], img: ['src', 'alt'], figure: [], figcaption: [], hr: [],
  table: [], thead: [], tbody: [], tr: [], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'], sup: [], sub: [], cite: [],
};
const INLINE_ALLOWED = { strong: [], b: [], em: [], i: [], u: [], a: ['href'], br: [] };
const RENAME = { h1: 'h2', h5: 'h4', h6: 'h4' };
const SAFE_CLASSES = ['plain-list', 'issue-list', 'vision', 'epigraph', 'more', 'quiet', 'lead', 'ticks', 'tags', 'card__link', 'btn', 'btn--line', 'btn--quiet', 'btn-row'];
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'svg', 'math', 'template', 'noscript', 'textarea', 'select', 'head', 'title']);
const VOID = new Set(['br', 'img', 'hr', 'input', 'meta', 'link', 'source', 'wbr', 'col', 'area', 'base', 'param', 'track', 'embed']);
const SITE_HOST = 'yardenkerem.co.il';

const TOKEN = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>|<!\w[^>]*>/g;
const ATTR = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function decodeAttr(v) {
  return v.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|#39);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&';
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'quot') return '"';
    if (k === 'apos' || k === '#39') return "'";
    const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
  });
}

function parseAttrs(s) {
  const out = {};
  for (const m of s.matchAll(ATTR)) out[m[1].toLowerCase()] = decodeAttr(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}

function escText(t) {
  return t.replace(/&(?!(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function sanitizeHtml(html, inline = false) {
  html = String(html || '').replace(/<div class="video" data-yt="([\w-]{11})"[\s\S]*?<\/button><\/div>/g, (m, id) => `<p>https://youtu.be/${id}</p>`);
  const allowed = inline ? INLINE_ALLOWED : BLOCK_ALLOWED;
  let out = '';
  const stack = []; // { src: source tag name, out: emitted tag name or null, suffix: text after close }
  let last = 0;
  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(html))) {
    out += escText(html.slice(last, m.index));
    last = TOKEN.lastIndex;
    if (!m[2]) continue; // comment / doctype
    const closing = m[1] === '/';
    const src = m[2].toLowerCase();

    if (!closing && DROP.has(src)) {
      // Skip everything up to the matching close tag.
      if (!VOID.has(src)) {
        const end = html.toLowerCase().indexOf(`</${src}`, last);
        const stop = end === -1 ? html.length : html.indexOf('>', end) + 1 || html.length;
        TOKEN.lastIndex = last = stop;
      }
      continue;
    }

    if (closing) {
      const i = stack.map((s) => s.src).lastIndexOf(src);
      if (i === -1) continue;
      while (stack.length > i) {
        const s = stack.pop();
        if (s.out) out += `</${s.out}>`;
        out += s.suffix || '';
      }
      continue;
    }

    const attrs = parseAttrs(m[3] || '');
    let tag = RENAME[src] || src;
    const cls = (attrs.class || '').split(/\s+/).filter((c) => SAFE_CLASSES.includes(c));
    if (tag === 'div') tag = cls.length && !inline ? 'div' : 'p';
    const isVoid = VOID.has(src);
    const push = (entry) => { if (!isVoid) stack.push({ src, ...entry }); };

    if (inline && (tag === 'p' || tag === 'div')) { push({ out: null, suffix: ' ' }); continue; }
    if (tag === 'div') { out += `<div class="${esc(cls.join(' '))}">`; push({ out: 'div' }); continue; }
    if (!(tag in allowed)) { push({ out: null }); continue; }

    let a = '';
    for (const name of allowed[tag]) {
      if (!(name in attrs)) continue;
      const v = attrs[name].trim();
      if ((name === 'href' || name === 'src') && !/^(https?:\/\/|\/|mailto:|tel:|#)/i.test(v)) continue;
      if (name === 'dir' && v !== 'ltr') continue;
      if ((name === 'colspan' || name === 'rowspan') && !/^\d{1,2}$/.test(v)) continue;
      a += ` ${name}="${esc(v)}"`;
    }
    if (tag === 'a' && /^https?:\/\//i.test(attrs.href || '') && !(attrs.href || '').includes(SITE_HOST)) a += ' target="_blank" rel="noopener"';
    if (tag === 'img' && !a.includes(' src=')) continue;
    if (tag === 'img') a += ' loading="lazy" decoding="async"';
    if (cls.length && ['p', 'ul', 'ol', 'a', 'blockquote'].includes(tag)) a += ` class="${esc(cls.join(' '))}"`;
    out += `<${tag}${a}>`;
    if (['br', 'img', 'hr'].includes(tag)) continue;
    if (isVoid) { out += `</${tag}>`; continue; }
    push({ out: tag });
  }
  out += escText(html.slice(last));
  while (stack.length) {
    const s = stack.pop();
    if (s.out) out += `</${s.out}>`;
  }

  if (!inline) {
    // A paragraph holding only a YouTube link becomes a player.
    out = out.replace(/<p[^>]*>\s*(?:<a [^>]*>)?\s*(https?:\/\/[^\s<]+)\s*(?:<\/a>)?\s*<\/p>/gu, (whole, url) => {
      const id = youtubeId(url.replace(/&amp;/g, '&'));
      return id ? videoEmbed(id) : whole;
    });
    out = out.replace(/<(p|h2|h3|h4|li)(?: [^>]*)?>(?:\s|&nbsp;|&#160;|<br>)*<\/\1>/gu, '');
  }
  return out.replace(/(<br>\s*){3,}/g, '<br><br>').trim();
}

/** Editor-friendly form of stored HTML: players become plain YouTube links, layout wrappers go. */
export function htmlForEditor(html) {
  html = String(html || '').replace(/<div class="video" data-yt="([\w-]{11})"[\s\S]*?<\/button><\/div>/g, (m, id) => `<p>https://youtu.be/${id}</p>`);
  html = html.replace(/<\/?(div|section|article|figure)\b[^>]*>/g, '');
  return sanitizeHtml(html);
}
