/**
 * Inline editing of stored pages (port of pageedit.php). Editable blocks are
 * found in the page's <main> HTML by their opening tags, skipping forms,
 * videos and live lists (<!--yk:...-->). The same scan runs when the page is
 * opened and when it is saved, so block numbers always match.
 */
import { sanitizeHtml } from './sanitize';

const PATTERNS = [
  ['rich', /<div class="(?:prose|card__body prose|body|vision)"[^>]*>/g],
  ['rich', /<dl\b[^>]*>/g],
  ['inline', /<h[1-4]\b[^>]*>/g],
  ['inline', /<p class="(?:lead|page-hero__sub|hero__place|way__kind|motto|crumb)"[^>]*>/g],
  ['inline', /<span class="methods__(?:name|desc)"[^>]*>/g],
  ['inline', /<figcaption\b[^>]*>/g],
];
const BLOCKED = [
  /<!--yk:(\w+)-->[\s\S]*?<!--\/yk:\1-->/g, /<section class="[^"]*block--contact[^"]*"[\s\S]*?<\/section>/g, /<form\b[\s\S]*?<\/form>/g,
  /<div class="video"[\s\S]*?<\/button><\/div>/g, /<nav\b[\s\S]*?<\/nav>/g, /<script\b[\s\S]*?<\/script>/g,
];

/** End of the element opening at pos (handles nesting of the same tag): [innerStart, innerEnd, elementEnd]. */
function elementEnd(html, pos, tag) {
  const innerStart = html.indexOf('>', pos) + 1;
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = pos;
  let depth = 0;
  let m;
  while ((m = re.exec(html))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return [innerStart, m.index, re.lastIndex];
  }
  return null;
}

/** List editable blocks: { kind, tag, inner, innerEnd, pos }, in document order. */
export function editableBlocks(html) {
  const blocked = [];
  for (const re of BLOCKED) for (const m of html.matchAll(re)) blocked.push([m.index, m.index + m[0].length]);
  const inside = (p) => blocked.some(([a, b]) => p >= a && p < b);
  const found = [];
  for (const [kind, re] of PATTERNS) {
    for (const m of html.matchAll(re)) {
      if (inside(m.index)) continue;
      const tag = /^<(\w+)/.exec(m[0])[1].toLowerCase();
      const end = elementEnd(html, m.index, tag);
      if (!end) continue;
      found.push({ kind, tag, inner: end[0], innerEnd: end[1], pos: m.index });
      blocked.push([m.index, end[2]]); // nothing inside a chosen block is picked again
    }
  }
  return found.sort((a, b) => a.pos - b.pos);
}

export function withMarkers(html) {
  const blocks = editableBlocks(html);
  for (let i = blocks.length - 1; i >= 0; i--) {
    const at = blocks[i].inner - 1; // the '>' of the opening tag
    html = html.slice(0, at) + ` data-yk-edit="${i}" data-yk-kind="${blocks[i].kind}"` + html.slice(at);
  }
  return { html, count: blocks.length };
}

function sanitizeDl(html) {
  let out = '';
  for (const m of String(html).matchAll(/<(dt|dd)\b[^>]*>([\s\S]*?)<\/\1>/g)) out += `<${m[1]}>${sanitizeHtml(m[2], true)}</${m[1]}>`;
  return out;
}

/** Apply edited blocks ({index: html}) to the page HTML. */
export function applyEdits(html, edits) {
  const blocks = editableBlocks(html);
  const keys = Object.keys(edits).map(Number).filter((i) => Number.isInteger(i)).sort((a, b) => b - a);
  for (const i of keys) {
    const b = blocks[i];
    const content = edits[i];
    if (!b || typeof content !== 'string') continue;
    const clean = b.tag === 'dl' ? sanitizeDl(content) : sanitizeHtml(content, b.kind !== 'rich');
    html = html.slice(0, b.inner) + clean + html.slice(b.innerEnd);
  }
  return html;
}
