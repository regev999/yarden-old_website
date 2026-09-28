"""HTML clean-up for content coming from WordPress / Elementor / Wix.

Keeps a small whitelist of semantic tags, drops inline styling and page
builder markup, converts bare YouTube links into embeds and rewrites links
that point at the old domain to site-relative paths.
"""
import html
import re
import urllib.parse
from html.parser import HTMLParser

OLD_HOSTS = {"yardenkerem.co.il", "www.yardenkerem.co.il"}

KEEP = {
    "p", "br", "strong", "b", "em", "i", "u", "a", "ul", "ol", "li", "h2", "h3", "h4",
    "blockquote", "cite", "table", "thead", "tbody", "tr", "td", "th", "img", "figure",
    "figcaption", "hr", "sup", "sub",
}
RENAME = {"h1": "h2", "h5": "h4", "h6": "h4"}
# <object> is unwrapped, not dropped: old Wix content wraps YouTube links in it.
DROP_WITH_CONTENT = {"style", "script", "noscript", "button", "form", "svg"}
VOID = {"br", "img", "hr"}
ATTRS = {
    "a": {"href"},
    "img": {"src", "alt"},
    "td": {"colspan", "rowspan"},
    "th": {"colspan", "rowspan"},
}
DIR_TAGS = {"p", "li", "h2", "h3", "h4", "blockquote", "td"}
# Layout wrappers that are dropped but still separate lines of text.
SOFT_BLOCKS = {"div", "section", "article", "header", "footer"}
TEXT_CONTAINERS = {"p", "li", "h2", "h3", "h4", "td", "th", "figcaption"}
BREAK = "\x00"
BLOCK_RE = re.compile(r"^\s*<(p|div|h[1-6]|ul|ol|li|blockquote|table|tbody|tr|td|figure|iframe|section|article|hr|style|object)\b", re.I)

YT_RE = re.compile(
    r"(?:youtube(?:-nocookie)?\.com/(?:watch\?(?:[^\s\"'<]*&(?:amp;)?)?v=|embed/|shorts/|live/)|youtu\.be/)([\w-]{11})"
)


def youtube_id(url):
    m = YT_RE.search(url or "")
    return m.group(1) if m else None


def rewrite_url(url):
    """Map links on the old domain to root-relative paths on the new site."""
    if not url:
        return url
    url = html.unescape(url.strip())
    parts = urllib.parse.urlsplit(url)
    if parts.netloc.lower() in OLD_HOSTS:
        path = urllib.parse.unquote(parts.path) or "/"
        if not path.startswith("/wp-content/") and not path.endswith("/") and "." not in path.rsplit("/", 1)[-1]:
            path += "/"
        return path + (("#" + parts.fragment) if parts.fragment else "")
    if url.startswith("/") and not url.startswith("//"):
        return urllib.parse.unquote(url)
    return url


def video_embed(vid, title=""):
    label = html.escape(title or "סרטון")
    return (
        f'<div class="video" data-yt="{vid}">'
        f'<button type="button" class="video__play" aria-label="הפעלת סרטון: {label}" '
        f'style="background-image:url(https://i.ytimg.com/vi/{vid}/hqdefault.jpg)">'
        f'<span class="video__icon" aria-hidden="true"></span></button></div>'
    )


def autop(text):
    """A small port of WordPress' wpautop for classic editor content."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    if not text.strip():
        return ""
    chunks = re.split(r"\n\s*\n", text)
    out = []
    for chunk in chunks:
        chunk = chunk.strip()
        if not chunk:
            continue
        if BLOCK_RE.match(chunk):
            out.append(chunk)
        else:
            out.append("<p>" + chunk.replace("\n", "<br>\n") + "</p>")
    return "\n".join(out)


class _Cleaner(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.out = []
        self.stack = []
        self.drop_depth = 0
        self.images = []

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if self.drop_depth:
            if tag in DROP_WITH_CONTENT:
                self.drop_depth += 1
            return
        if tag in DROP_WITH_CONTENT:
            self.drop_depth = 1
            return
        a = dict(attrs)
        if tag == "iframe":
            vid = youtube_id(a.get("src"))
            if vid:
                self.out.append(video_embed(vid))
            return
        tag = RENAME.get(tag, tag)
        if tag in SOFT_BLOCKS:
            self._soft_break()
            return
        if tag not in KEEP:
            return
        allowed = ATTRS.get(tag, set())
        parts = []
        for k in sorted(allowed):
            v = a.get(k)
            if v is None:
                continue
            if k in ("href", "src"):
                v = rewrite_url(v)
                if k == "src":
                    self.images.append(v)
            parts.append(f'{k}="{html.escape(v, quote=True)}"')
        if tag in DIR_TAGS and (a.get("dir") or "").lower() == "ltr":
            parts.append('dir="ltr"')
        if tag == "a":
            href = a.get("href") or ""
            if href.startswith("http") and urllib.parse.urlsplit(href).netloc.lower() not in OLD_HOSTS:
                parts.append('target="_blank" rel="noopener"')
        if tag == "img":
            parts.append('loading="lazy" decoding="async"')
        self.out.append(f"<{tag}{(' ' + ' '.join(parts)) if parts else ''}>")
        if tag not in VOID:
            self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        tag = RENAME.get(tag.lower(), tag.lower())
        if tag in KEEP and tag not in VOID and self.stack and self.stack[-1] == tag:
            self.stack.pop()
            self.out.append(f"</{tag}>")

    def handle_endtag(self, tag):
        tag = tag.lower()
        if self.drop_depth:
            if tag in DROP_WITH_CONTENT:
                self.drop_depth -= 1
            return
        tag = RENAME.get(tag, tag)
        if tag in SOFT_BLOCKS:
            self._soft_break()
            return
        if tag not in KEEP or tag in VOID:
            return
        if tag in self.stack:
            while self.stack:
                t = self.stack.pop()
                self.out.append(f"</{t}>")
                if t == tag:
                    break

    def _soft_break(self):
        if any(t in TEXT_CONTAINERS for t in self.stack):
            self.out.append("<br>")
        else:
            self.out.append(BREAK)

    def handle_data(self, data):
        if not self.drop_depth:
            self.out.append(data)

    def handle_entityref(self, name):
        if not self.drop_depth:
            self.out.append(f"&{name};")

    def handle_charref(self, name):
        if not self.drop_depth:
            self.out.append(f"&#{name};")

    def close(self):
        super().close()
        while self.stack:
            self.out.append(f"</{self.stack.pop()}>")


BLOCK_START = re.compile(r"^\s*</?(p|ul|ol|li|h[2-4]|blockquote|table|thead|tbody|tr|td|th|figure|figcaption|hr|div)\b", re.I)


def _wrap_loose_text(out):
    """Text left between dropped <div>s becomes its own paragraph."""
    if BREAK not in out:
        return out
    segs = []
    for seg in out.split(BREAK):
        if not seg.strip():
            continue
        # a segment may start with block markup and continue with loose text
        m = re.match(r"^((?:\s*</?(?:p|ul|ol|li|h[2-4]|blockquote|table|thead|tbody|tr|td|th|figure|figcaption|hr)\b[^>]*>)+)(.*)$", seg, re.S | re.I)
        if m and m.group(2).strip() and not BLOCK_START.match(m.group(2)) and "</" not in m.group(2)[:0]:
            segs.append(m.group(1))
            seg = m.group(2)
        if BLOCK_START.match(seg) or not re.sub(r"<[^>]+>", "", seg).strip():
            segs.append(seg)
        else:
            segs.append("<p>" + seg.strip() + "</p>")
    return "\n".join(segs)


URL_ONLY_P = re.compile(r"<p[^>]*>\s*(?:<a [^>]*>)?\s*(https?://[^\s<]+)\s*(?:</a>)?\s*</p>")
BARE_URL = re.compile(r'(?<![="\'>/])(https?://[^\s<>"\']+)')


def clean_html(raw, images=None):
    """Return cleaned HTML. Collected image paths are appended to `images`."""
    if not raw or not raw.strip():
        return ""
    raw = re.sub(r"\[/?(?:var|if|endif|caption|embed)[^\]]*\]", "", raw)
    if "<p" not in raw.lower() and "<div" not in raw.lower():
        raw = autop(raw)
    else:
        raw = autop(raw) if re.search(r"\n\s*\n", raw) and raw.lower().count("<p") < 3 else raw
    c = _Cleaner()
    c.feed(raw)
    c.close()
    if images is not None:
        images.extend(c.images)
    out = _wrap_loose_text("".join(c.out))

    def embed_p(m):
        vid = youtube_id(m.group(1))
        if vid:
            return video_embed(vid)
        url = html.escape(rewrite_url(m.group(1)))
        return f'<p><a href="{url}" target="_blank" rel="noopener">{url}</a></p>'

    out = URL_ONLY_P.sub(embed_p, out)

    # Link any remaining bare URLs that sit in text (not inside tags/attributes).
    def link_text(segment):
        return BARE_URL.sub(
            lambda m: f'<a href="{m.group(1)}" target="_blank" rel="noopener">{m.group(1)}</a>', segment
        )

    pieces = re.split(r"(<a\b.*?</a>|<[^>]+>)", out, flags=re.S)
    out = "".join(p if p.startswith("<") else link_text(p) for p in pieces)

    # Tidy: drop empty paragraphs / headings and collapse whitespace.
    out = re.sub(r"<(p|h2|h3|h4|li|strong|b|u|em)(?: [^>]*)?>(?:\s|&nbsp;|&#160;|<br>)*</\1>", "", out)
    out = re.sub(r"<(p|h2|h3|h4|li|strong|b|u|em)(?: [^>]*)?>(?:\s|&nbsp;|&#160;|<br>)*</\1>", "", out)
    out = re.sub(r"(<br>\s*){3,}", "<br><br>", out)
    out = re.sub(r"(<(?:p|li|h[2-4]|td)(?: [^>]*)?>)(?:\s*<br>)+", r"\1", out)
    out = re.sub(r"(?:<br>\s*)+(</(?:p|li|h[2-4]|td)>)", r"\1", out)
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.strip()


def plain_text(raw, limit=None):
    txt = re.sub(r"<[^>]+>", " ", raw or "")
    txt = re.sub(r"\[[^\]]+\]", " ", txt)
    txt = html.unescape(txt)
    txt = re.sub(r"https?://\S+", "", txt)
    txt = re.sub(r"\s+", " ", txt).strip()
    if limit and len(txt) > limit:
        cut = txt[:limit].rsplit(" ", 1)[0]
        return cut + "…"
    return txt
