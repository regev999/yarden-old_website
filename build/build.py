#!/usr/bin/env python3
"""Build the static site in ./site from data/content.json.

Every published page and post keeps the URL it had on the old WordPress
site, so existing links and search results keep working.

    python3 build/extract.py   # only when there is a new WordPress export
    python3 build/build.py
"""
import datetime as dt
import html
import json
import pathlib
import re
import shutil
import urllib.parse

from sanitize import clean_html, plain_text, rewrite_url, video_embed, youtube_id

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "content.json"
OUT = ROOT / "site"
ASSETS = ROOT / "build" / "assets"

SITE_URL = "https://www.yardenkerem.co.il"
SITE_NAME = "ירדן כרם"
TAGLINE = "התמקדות, הקומי, Somatic Experiencing"
PHONE = "054-4250910"
PHONE_INTL = "972544250910"
EMAIL = "yardenkerem@gmail.com"
LOCATION = "הרצליה ובזום"
# Where the contact forms post to. Left empty, the forms open the visitor's
# mail app instead (useful on a host without PHP).
FORM_ENDPOINT = "/api/lead.php"  # PHP endpoint in server/api; leads show up in /admin/
HOME_ID = 139
BLOG_ID = 513
# The old site's title suffix (Yoast default "%%title%% - %%sitename%%"); kept
# verbatim so search results and rankings don't see a title change.
SITE_TITLE = "ירדן כרם - התמקדות, הקומי, Somatic Experiencing"


def enc(path):
    """Percent-encode a path the way WordPress did (lowercase hex)."""
    return re.sub(r"%[0-9A-F]{2}", lambda m: m.group(0).lower(), urllib.parse.quote(path))
SOCIAL = [
    ("youtube", "יוטיוב", "https://www.youtube.com/@yardenkerem5297"),
    ("facebook", "פייסבוק", "https://www.facebook.com/somatictherapyandfocusing/"),
    ("instagram", "אינסטגרם", "https://www.instagram.com/yarden_kerem/"),
    ("spotify", "ספוטיפיי", "https://open.spotify.com/show/1PdEltqdiPKR4aGi3efIDc"),
    ("linkedin", "לינקדאין", "https://www.linkedin.com/in/yarden-kerem/"),
    ("tiktok", "טיקטוק", "https://www.tiktok.com/@yarden.kerem"),
]

esc = html.escape

# Everything the admin area (server/) needs to manage content after launch:
# post bodies, testimonials, categories and the page template. Written to
# site/admin/_lib/seed/ and imported into the database on first run.
SEED = {"posts": [], "testimonials": []}


# --------------------------------------------------------------------------
# Data model
# --------------------------------------------------------------------------
class Site:
    def __init__(self, data):
        self.data = data
        self.items = {i["id"]: i for i in data["items"]}
        self.cats = {c["id"]: c for c in data["categories"]}
        self.cat_by_slug = {c["slug"]: c for c in data["categories"]}
        self.tags = {t["slug"]: t for t in data["tags"]}
        self.attachments = {
            i["id"]: rewrite_url(i["attachment_url"]) for i in data["items"] if i["type"] == "attachment"
        }
        self.pages = [i for i in data["items"] if i["type"] == "page" and i["status"] == "publish"]
        self.posts = sorted(
            (i for i in data["items"] if i["type"] == "post" and i["status"] == "publish"),
            key=lambda p: p["date"],
            reverse=True,
        )
        self.images_used = set()
        self._dupes()
        # WordPress served the page when a page and a post shared a slug, so
        # the page keeps the URL and the post moves to "<slug>-2".
        page_slugs = {pg["slug"] for pg in self.pages}
        self.path_override = {
            p["id"]: f"/{p['slug']}-2/" for p in self.posts if p["slug"] in page_slugs
        }

    def _dupes(self):
        """Some posts were published twice. Keep the URLs but point search
        engines at one copy and show only that copy in listings."""
        norm = lambda s: re.sub(r"[\s.\-–:]+", " ", s).strip()
        seen = {}
        self.canonical_of = {}
        for p in sorted(self.posts, key=lambda p: p["id"]):
            key = norm(p["title"])
            if key in seen:
                self.canonical_of[p["id"]] = seen[key]
            else:
                seen[key] = p["id"]

    def url(self, item):
        if item["id"] == HOME_ID:
            return "/"
        if item["id"] in self.path_override:
            return self.path_override[item["id"]]
        return f"/{item['slug']}/"

    def post_cats(self, p):
        return [self.cat_by_slug[t["slug"]] for t in p["terms"] if t["domain"] == "category" and t["slug"] in self.cat_by_slug]

    def post_tags(self, p):
        return [self.tags[t["slug"]] for t in p["terms"] if t["domain"] == "post_tag" and t["slug"] in self.tags]

    def posts_in(self, cat_ids=None, ids=None, include_dupes=False):
        if ids:
            out = [self.items[i] for i in ids if i in self.items and self.items[i]["status"] == "publish"]
        else:
            out = [p for p in self.posts if any(c["id"] in cat_ids for c in self.post_cats(p))]
        if not include_dupes:
            out = [p for p in out if p["id"] not in self.canonical_of]
        return out

    def image(self, url):
        url = rewrite_url(url or "")
        if url.startswith("/wp-content/uploads/"):
            self.images_used.add(url)
        return url

    def thumb(self, p):
        tid = p["meta"].get("_thumbnail_id")
        if tid and int(tid) in self.attachments:
            return self.image(self.attachments[int(tid)]), False
        m = re.search(r'<img[^>]+src="([^"]+)"', p["content"])
        if m:
            return self.image(m.group(1)), False
        vid = youtube_id(p["content"]) or youtube_id(p["meta"].get("_elementor_data", ""))
        if vid:
            return f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg", True
        return None, False


# --------------------------------------------------------------------------
# Elementor → HTML
# --------------------------------------------------------------------------
def st(el):
    s = el.get("settings")
    return s if isinstance(s, dict) else {}


def link_of(s, key="link"):
    v = s.get(key)
    if isinstance(v, dict):
        return rewrite_url(v.get("url") or "")
    return ""


def inline(raw):
    """Clean a short HTML fragment (headings, card text) and drop wrappers."""
    out = clean_html(raw or "")
    out = re.sub(r"</?p[^>]*>", " ", out)
    return re.sub(r"\s+", " ", out).strip()


class Renderer:
    def __init__(self, site, page):
        self.site = site
        self.page = page
        self.shown_posts = set()
        self.template_depth = 0
        self.hero = None

    # --- structure ------------------------------------------------------
    def render(self, elements):
        elements = list(elements)
        if elements and self._is_hero(elements[0]):
            self.hero = self._hero(elements[0])
            elements = elements[1:]
        return "\n".join(self.section(e) for e in elements)

    def _widgets(self, el):
        for e in el.get("elements", []):
            if e.get("elType") == "widget":
                yield e
            else:
                yield from self._widgets(e)

    def _is_hero(self, el):
        s = st(el)
        ws = list(self._widgets(el))
        return bool((s.get("background_image") or {}).get("url")) and ws and all(
            w["widgetType"] in ("heading", "icon", "spacer", "divider", "animated-headline") for w in ws
        )

    def _hero(self, el):
        s = st(el)
        bg = self.site.image(s["background_image"]["url"])
        heads = [inline(st(w).get("title")) for w in self._widgets(el) if w["widgetType"] == "heading"]
        heads = [h for h in heads if h]
        title = heads[0] if heads else esc(self.page["title"])
        sub = heads[1:]
        return {"title": title, "sub": sub, "bg": bg}

    def section(self, el):
        s = st(el)
        cols = [c for c in el.get("elements", []) if c.get("elType") == "column"]
        rendered = [self.column(c) for c in cols]
        rendered = [r for r in rendered if r.strip()]
        if not rendered:
            return ""
        bg = (s.get("background_image") or {}).get("url")
        cls = ["block"]
        style = ""
        if bg:
            cls.append("block--image")
            style = f' style="--bg:url(\'{esc(self.site.image(bg))}\')"'
        elif s.get("background_color") or s.get("background_background") == "classic":
            cls.append("block--tint")
        n = len(rendered)
        grid = f'<div class="cols cols-{min(n, 4)}">' + "".join(f'<div class="col">{r}</div>' for r in rendered) + "</div>" if n > 1 else rendered[0]
        return f'<section class="{" ".join(cls)}"{style}><div class="wrap">{grid}</div></section>'

    def column(self, col):
        parts = []
        for e in col.get("elements", []):
            if e.get("elType") == "widget":
                parts.append(self.widget(e))
            elif e.get("elType") == "section":
                inner = [self.column(c) for c in e.get("elements", [])]
                inner = [i for i in inner if i.strip()]
                if len(inner) > 1:
                    parts.append(f'<div class="cols cols-{min(len(inner), 4)}">' + "".join(f'<div class="col">{i}</div>' for i in inner) + "</div>")
                elif inner:
                    parts.append(inner[0])
        return "\n".join(p for p in parts if p)

    # --- widgets --------------------------------------------------------
    def widget(self, w):
        fn = getattr(self, "w_" + w["widgetType"].replace("-", "_"), None)
        if not fn:
            return ""
        return fn(st(w)) or ""

    def w_heading(self, s):
        t = inline(s.get("title"))
        if not t:
            return ""
        level = {"h1": 2, "h2": 2, "h3": 3, "h4": 3, "h5": 4, "h6": 4}.get(s.get("header_size"), 2)
        href = link_of(s)
        if href:
            t = f'<a href="{esc(href)}">{t}</a>'
        return f"<h{level} class=\"heading\">{t}</h{level}>"

    def w_text_editor(self, s):
        imgs = []
        out = clean_html(s.get("editor"), imgs)
        for i in imgs:
            self.site.image(i)
        return f'<div class="prose">{out}</div>' if out else ""

    def w_video(self, s):
        url = s.get("youtube_url") or s.get("link") or ""
        vid = youtube_id(url)
        if vid:
            return video_embed(vid)
        if s.get("vimeo_url"):
            return f'<p><a href="{esc(s["vimeo_url"])}" target="_blank" rel="noopener">צפייה בסרטון</a></p>'
        return ""

    def w_divider(self, s):
        return '<hr class="divider">'

    def w_image(self, s):
        url = (s.get("image") or {}).get("url")
        if not url or "placeholder" in url:
            return ""
        src = self.site.image(url)
        img = f'<img src="{esc(src)}" alt="{esc((s.get("image") or {}).get("alt") or "")}" loading="lazy" decoding="async">'
        href = link_of(s)
        if href and s.get("link_to") == "custom":
            img = f'<a href="{esc(href)}">{img}</a>'
        cap = s.get("caption")
        return f'<figure class="figure">{img}{f"<figcaption>{esc(cap)}</figcaption>" if cap else ""}</figure>'

    def w_button(self, s):
        text = inline(s.get("text")) or "לפרטים"
        href = link_of(s) or "#"
        return f'<p class="btn-row"><a class="btn" href="{esc(href)}">{text}</a></p>'

    def w_template(self, s):
        tid = int(s.get("template_id") or 0)
        tpl = self.site.items.get(tid)
        if not tpl or self.template_depth > 2 or not tpl["meta"].get("_elementor_data"):
            return ""
        self.template_depth += 1
        out = "".join(self.column({"elements": [e]}) if e.get("elType") != "section" else self._flatten(e)
                      for e in json.loads(tpl["meta"]["_elementor_data"]))
        self.template_depth -= 1
        return out

    def _flatten(self, sec):
        cols = [self.column(c) for c in sec.get("elements", [])]
        cols = [c for c in cols if c.strip()]
        if len(cols) > 1:
            return f'<div class="cols cols-{min(len(cols), 4)}">' + "".join(f'<div class="col">{c}</div>' for c in cols) + "</div>"
        return cols[0] if cols else ""

    def w_form(self, s):
        fields = s.get("form_fields") or []
        types = [f.get("field_type") or "text" for f in fields]
        if types == ["email"]:
            return contact_form(kind="newsletter")
        return contact_form(with_message="textarea" in types)

    def w_flip_box(self, s):
        title = inline(s.get("title_text_a"))
        front = inline(s.get("description_text_a"))
        back = clean_html(s.get("description_text_b") or "")
        href = link_of(s)
        btn = inline(s.get("button_text")) or "לקריאה נוספת"
        body = back or (f"<p>{front}</p>" if front else "")
        more = f'<a class="card__link" href="{esc(href)}">{btn}</a>' if href else ""
        return f'<article class="card card--service"><h3 class="card__title">{title}</h3><div class="card__body prose">{body}</div>{more}</article>'

    def w_icon_box(self, s):
        title = inline(s.get("title_text")).rstrip(":").strip()
        desc = clean_html(s.get("description_text") or "")
        href = link_of(s)
        if title and not desc:
            return f'<div class="chip-card">{title}</div>'
        more = f'<a class="card__link" href="{esc(href)}">לקריאה נוספת</a>' if href else ""
        return f'<article class="card"><h3 class="card__title">{title}</h3><div class="card__body prose">{desc}</div>{more}</article>'

    def w_icon_list(self, s):
        items = []
        for it in s.get("icon_list") or []:
            t = esc(it.get("text") or "")
            href = link_of(it)
            if href.upper().startswith("TEL:"):
                href = "tel:" + re.sub(r"[^\d+]", "", href[4:])
            items.append(f'<li><a href="{esc(href)}">{t}</a></li>' if href else f"<li>{t}</li>")
        return f'<ul class="ticks">{"".join(items)}</ul>' if items else ""

    def w_social_icons(self, s):
        links = [link_of(x) for x in s.get("social_icon_list") or []]
        return social_links() if any(links) else ""

    def w_media_carousel(self, s):
        figs = []
        for sl in s.get("slides") or []:
            url = (sl.get("image") or {}).get("url")
            if url:
                figs.append(f'<figure><img src="{esc(self.site.image(url))}" alt="" loading="lazy" decoding="async"></figure>')
        return f'<div class="gallery">{"".join(figs)}</div>' if figs else ""

    def w_testimonial_carousel(self, s):
        cards = []
        for sl in s.get("slides") or []:
            body = clean_html(sl.get("content") or "")
            name = esc(sl.get("name") or "")
            role = esc(sl.get("title") or "")
            if body:
                cards.append(
                    f'<figure class="quote"><blockquote class="prose">{body}</blockquote>'
                    f'<figcaption><strong>{name}</strong>{f" · {role}" if role else ""}</figcaption></figure>'
                )
        return f'<div class="quotes">{"".join(cards)}</div>' if cards else ""

    def w_animated_headline(self, s):
        before = esc((s.get("before_text") or "").strip())
        hl = esc((s.get("highlighted_text") or "").strip())
        return f'<p class="motto">{before} <em>{hl}</em></p>'

    def w_price_table(self, s):
        head = inline(s.get("heading"))
        sub = inline(s.get("sub_heading"))
        period = esc(s.get("period") or "")
        feats = "".join(f"<li>{inline(f.get('item_text'))}</li>" for f in s.get("features_list") or [] if f.get("item_text"))
        href = link_of(s)
        btn = inline(s.get("button_text")) or "לפרטים נוספים"
        return (
            f'<article class="card card--course"><h3 class="card__title">{head}</h3>'
            f'{f"<p class=card__meta>{sub}</p>" if sub else ""}'
            f'{f"<h4>{period}</h4>" if period else ""}'
            f'{f"<ul class=ticks>{feats}</ul>" if feats else ""}'
            f'{f"<a class=btn href={chr(34)}{esc(href)}{chr(34)}>{btn}</a>" if href else ""}</article>'
        )

    def w_posts(self, s):
        ids = [int(i) for i in s.get("posts_posts_ids") or []]
        cats = [int(i) for i in s.get("posts_include_term_ids") or s.get("posts_category_ids") or []]
        posts = self.site.posts_in(cat_ids=set(cats), ids=ids)
        posts = [p for p in posts if p["id"] not in self.shown_posts]
        per = int(s.get("classic_posts_per_page") or s.get("cards_posts_per_page") or 6)
        if not ids:
            posts = posts[:per]
        self.shown_posts.update(p["id"] for p in posts)
        return post_cards(self.site, posts)

    def w_ae_post_blocks(self, s):
        cats = {int(i) for i in s.get("category_ae_ids") or []}
        posts = [p for p in self.site.posts_in(cat_ids=cats) if p["id"] not in self.shown_posts]
        self.shown_posts.update(p["id"] for p in posts)
        return post_list(self.site, posts)


# --------------------------------------------------------------------------
# Shared components
# --------------------------------------------------------------------------
ICONS = {
    "youtube": '<path d="M23 7.2a3 3 0 0 0-2.1-2.1C19 4.6 12 4.6 12 4.6s-7 0-8.9.5A3 3 0 0 0 1 7.2 31 31 0 0 0 .5 12a31 31 0 0 0 .5 4.8 3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .5-4.8 31 31 0 0 0-.5-4.8ZM9.7 15V9l5.8 3-5.8 3Z"/>',
    "facebook": '<path d="M14 8.5V6.6c0-.9.6-1.1 1-1.1h2.6V1.6L14 1.5c-4 0-4.9 3-4.9 4.9v2.1H6.8v4h2.3v10h4.9v-10h3.3l.4-4H14Z"/>',
    "instagram": '<path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 8.2a3.2 3.2 0 1 1 0-6.4 3.2 3.2 0 0 1 0 6.4ZM17.3 5.5a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4ZM12 2.2c-2.7 0-3 0-4.1.1C4.2 2.4 2.4 4.2 2.3 7.9 2.2 9 2.2 9.3 2.2 12s0 3 .1 4.1c.1 3.7 1.9 5.5 5.6 5.6 1.1.1 1.4.1 4.1.1s3 0 4.1-.1c3.7-.1 5.5-1.9 5.6-5.6.1-1.1.1-1.4.1-4.1s0-3-.1-4.1c-.1-3.7-1.9-5.5-5.6-5.6-1.1-.1-1.4-.1-4.1-.1Zm0 1.8c2.7 0 3 0 4 .1 2.7.1 3.9 1.4 4 4 .1 1 .1 1.3.1 3.9s0 3-.1 4c-.1 2.6-1.3 3.9-4 4-1 .1-1.3.1-4 .1s-3 0-4-.1c-2.7-.1-3.9-1.4-4-4-.1-1-.1-1.3-.1-4s0-2.9.1-3.9c.1-2.6 1.3-3.9 4-4 1 0 1.3-.1 4-.1Z"/>',
    "spotify": '<path d="M12 1.5a10.5 10.5 0 1 0 0 21 10.5 10.5 0 0 0 0-21Zm4.8 15.2a.7.7 0 0 1-.9.2c-2.5-1.5-5.6-1.8-9.3-1a.7.7 0 1 1-.3-1.3c4-.9 7.5-.5 10.3 1.2.3.2.4.6.2.9Zm1.3-2.9a.8.8 0 0 1-1.1.3c-2.8-1.7-7.2-2.2-10.5-1.2a.8.8 0 1 1-.5-1.6c3.8-1.1 8.6-.6 11.8 1.4.4.3.5.8.3 1.1Zm.1-3c-3.4-2-9-2.2-12.2-1.2a1 1 0 1 1-.6-1.8c3.7-1.1 9.9-.9 13.8 1.4a1 1 0 0 1-1 1.6Z"/>',
    "linkedin": '<path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 9.8h4V21H3V9.8Zm6.5 0h3.8v1.5h.1c.5-1 1.8-2 3.8-2 4 0 4.8 2.6 4.8 6V21h-4v-5c0-1.2 0-2.8-1.7-2.8s-2 1.3-2 2.7V21h-4V9.8Z"/>',
    "tiktok": '<path d="M16.6 2h-3.4v13.4a2.9 2.9 0 1 1-2.9-2.9c.3 0 .6 0 .9.1V9.1a6.3 6.3 0 1 0 5.4 6.3V8.6a7.9 7.9 0 0 0 4.6 1.5V6.7a4.6 4.6 0 0 1-4.6-4.7Z"/>',
}


def social_links(cls="social"):
    out = []
    for key, label, href in SOCIAL:
        out.append(
            f'<a href="{href}" target="_blank" rel="noopener">'
            f'<svg viewBox="0 0 24 24" aria-hidden="true">{ICONS[key]}</svg>{label}</a>'
        )
    return f'<div class="{cls}">{"".join(out)}</div>'


def contact_form(kind="contact", with_message=True):
    if kind == "newsletter":
        return (
            '<form class="form form--inline" data-form="newsletter">'
            '<label class="sr-only" for="nl-email">דוא"ל</label>'
            '<input id="nl-email" type="email" name="email" required placeholder="כתובת הדוא&quot;ל שלך" autocomplete="email">'
            '<button class="btn" type="submit">הרשמה לעדכונים</button>'
            + '<div class="hp" aria-hidden="true"><label>אתר<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>' +
            '<p class="form__status" role="status"></p></form>'
        )
    msg = (
        '<label class="form__full">במה אוכל לעזור?<textarea name="message" rows="4"></textarea></label>'
        if with_message else ""
    )
    return (
        '<form class="form" data-form="contact"><input type="hidden" name="product" value="">'
        '<label>שם מלא<input type="text" name="name" required autocomplete="name"></label>'
        '<label>טלפון<input type="tel" name="phone" autocomplete="tel" inputmode="tel"></label>'
        '<label class="form__full">דוא"ל<input type="email" name="email" autocomplete="email"></label>'
        f'{msg}' + '<div class="hp" aria-hidden="true"><label>אתר<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>' + '<button class="btn" type="submit">שליחה</button>'
        '<p class="form__status" role="status"></p></form>'
    )


def fmt_date(d):
    months = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"]
    t = dt.datetime.strptime(d[:10], "%Y-%m-%d")
    return f"{t.day} ב{months[t.month - 1]} {t.year}"


def excerpt_of(site, p, n=150):
    if p["excerpt"].strip():
        return plain_text(p["excerpt"], n)
    txt = plain_text(p["content"], n)
    if not txt and p["meta"].get("_elementor_data"):
        txt = plain_text(" ".join(re.findall(r'"editor":"(.*?)"', p["meta"]["_elementor_data"])).encode().decode("unicode_escape", "ignore"), n)
    return txt


def post_cards(site, posts, single=False):
    """Posts as a quiet two-column list: title, one line, date."""
    if not posts:
        return ""
    rows = []
    for p in posts:
        _, is_video = site.thumb(p)
        ex = excerpt_of(site, p, 140)
        meta = fmt_date(p["date"]) + (" · סרטון" if is_video and len(ex) < 40 else "")
        rows.append(
            f'<li><a href="{esc(site.url(p))}"><h3>{esc(p["title"])}</h3>'
            f'{f"<p>{esc(ex)}</p>" if ex else ""}<small>{meta}</small></a></li>'
        )
    return f'<ul class="entries{" entries--single" if single else ""}">{"".join(rows)}</ul>'


def post_list(site, posts):
    if not posts:
        return ""
    rows = "".join(
        f'<li><a href="{esc(site.url(p))}"><span>{esc(p["title"])}</span><time datetime="{p["date"][:10]}">{fmt_date(p["date"])}</time></a></li>'
        for p in posts
    )
    return f'<ul class="post-list">{rows}</ul>'


def contact_section(title="איפה להתחיל?", intro="אפשר להשאיר פרטים ואחזור אליך לתיאום, או לפנות ישירות בטלפון או במייל."):
    return f"""
<section class="section section--ink block--contact" id="contact">
  <div class="wrap contact">
    <div>
      <h2>{title}</h2>
      <p class="quiet">{intro}</p>
      <dl class="contact-lines">
        <dt>טלפון</dt><dd><a href="tel:+{PHONE_INTL}" dir="ltr">{PHONE}</a></dd>
        <dt>מייל</dt><dd><a href="mailto:{EMAIL}">{EMAIL}</a></dd>
        <dt>איפה</dt><dd>קליניקה בהרצליה, ומפגשים בזום</dd>
      </dl>
      {social_links()}
    </div>
    {contact_form()}
  </div>
</section>"""


def contact_block():
    return contact_section()


# --------------------------------------------------------------------------
# Page shell
# --------------------------------------------------------------------------
NAV = [
    ("טיפול", [
        ("כל סוגי הטיפול", "/טיפולים-פרטניים/"), ("התמקדות", "/התמקדות/"),
        ("Somatic Experiencing", "/טיפול-בטראומה-2/"), ("הקומי", "/הקומי/"),
        ("וידאו תרפיה", "/וידאו-תרפיה/"), ("פוטותרפיה", "/פוטותרפיה/"),
        ("טיפול במגע: שיטת גרינברג", "/גרינברג/"), ("שיטת פאולה", "/שיטת-פאולה/"),
    ]),
    ("קורסים", [
        ("קורסי התמקדות", "/קורסים/"), ("טראומה מורכבת", "/טראומה-מורכבת/"),
        ("להתיידד עם הנמר", "/פוקוסינג-לחיי-היום-יום/"),
    ]),
    ("על ירדן", [
        ("אודות", "/אודות/"), ("לקוחות מספרים", "/לקוחות-מספרים/"), ("המלצות בווידאו", "/המלצות/"),
        ("כתבו עליי", "/מן-העיתונות-כתבו-עליי/"), ("מאמרים שפרסמתי בעיתונות", "/מן-העיתונות-אני-כתבתי/"),
    ]),
    ("מאמרים", [
        ("על התמקדות", "/מאמרים-שאני-כתבתי/"), ("על טיפול בטראומה", "/מאמרים-שלי-בנושא-טיפול-בטראומה/"),
        ("נושאים כלליים", "/מאמרים-שלי-בנושאים-כלליים/"), ("מאמרים של יוג'ין ג'נדלין", "/מאמרים-שכתב-יוגין-גנדלין/"),
        ("בלוג", "/בלוג/"),
    ]),
    ("פודקאסט", "/פודקאסט/"),
]


def render_nav(current):
    out = []
    for label, target in NAV:
        if isinstance(target, str):
            cur = ' aria-current="page"' if target == current else ""
            out.append(f'<li><a href="{esc(target)}"{cur}>{esc(label)}</a></li>')
            continue
        sub = "".join(
            f'<li><a href="{esc(h)}"{" aria-current=page" if h == current else ""}>{esc(t)}</a></li>' for t, h in target
        )
        out.append(
            f'<li class="has-sub"><span class="nav__label" tabindex="0">{esc(label)}</span>'
            f'<button class="nav__toggle" type="button" aria-expanded="false" aria-label="{esc(label)}: פתיחת תפריט"></button>'
            f'<ul class="nav__sub">{sub}</ul></li>'
        )
    return "".join(out)


def page_shell(site, *, path, title, body, description="", hero=None, canonical=None, og_image=None, article=None, seo_title=None):
    full_title = seo_title or f"{title} - {SITE_TITLE}"
    desc = esc(description or f"{SITE_NAME} – {TAGLINE}. טיפול אישי וקורסים בגישת ההתמקדות.")
    canon = SITE_URL + enc(canonical or path)
    hero_html = ""
    if hero:
        subs = "".join(f'<p class="page-hero__sub">{s_}</p>' for s_ in hero.get("sub", []) if s_)
        hero_html = (
            f'<header class="page-hero"><div class="wrap">{hero.get("crumb", "")}'
            f'<h1>{hero["title"]}</h1>{subs}</div></header>'
        )
    og = f'<meta property="og:image" content="{esc(og_image)}">' if og_image else ""
    ld = '<script type="application/ld+json">' + json.dumps(article, ensure_ascii=False) + "</script>" if article else ""
    year = dt.date.today().year
    return f"""<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(full_title)}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{canon}">
<meta property="og:type" content="{'article' if article else 'website'}">
<meta property="og:title" content="{esc(title or SITE_NAME)}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{canon}">
<meta property="og:locale" content="he_IL">
<meta property="og:site_name" content="{SITE_NAME}">
{og}
<meta name="theme-color" content="#0f2140">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/assets/fonts/IBMPlexSansHebrew-ExtraLight.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/IBMPlexSansHebrew-Regular.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/style.css">
<link rel="alternate" type="application/rss+xml" title="{esc(SITE_TITLE)}" href="{SITE_URL}/feed/">
{ld}
</head>
<body>
<a class="skip" href="#main">דילוג לתוכן</a>
<header class="site-header">
  <div class="wrap site-header__inner">
    <a class="brand" href="/"><b>{SITE_NAME}</b><span>התמקדות וטיפול דרך הגוף</span></a>
    <nav id="nav" class="nav" aria-label="ניווט ראשי"><ul>{render_nav(path)}</ul></nav>
    <a class="btn btn--sm header-cta" href="#contact">קביעת פגישה</a>
    <button class="menu-btn" type="button" aria-expanded="false" aria-controls="nav">תפריט</button>
  </div>
</header>
<main id="main">
{hero_html}
{body}
</main>
<footer class="site-footer">
  <div class="wrap">
    <div class="site-footer__grid">
      <div>
        <p class="site-footer__brand">{SITE_NAME}</p>
        <p class="quiet">טיפול, קורסים והרצאות בגישת ההתמקדות, Somatic Experiencing והקומי.</p>
        <p><a href="https://www.focusingfreedom.co.il/" target="_blank" rel="noopener">Focusing for Freedom</a></p>
      </div>
      <div><h2>טיפול וקורסים</h2><ul>
        <li><a href="/טיפולים-פרטניים/">טיפול אישי</a></li><li><a href="/קורסים/">קורסי התמקדות</a></li>
        <li><a href="/טראומה-מורכבת/">טראומה מורכבת</a></li><li><a href="/פוקוסינג-לחיי-היום-יום/">להתיידד עם הנמר</a></li></ul></div>
      <div><h2>לקרוא ולהאזין</h2><ul>
        <li><a href="/מאמרים-שאני-כתבתי/">מאמרים</a></li><li><a href="/בלוג/">בלוג</a></li>
        <li><a href="/פודקאסט/">פודקאסט</a></li><li><a href="/לקוחות-מספרים/">לקוחות מספרים</a></li></ul></div>
      <div><h2>יצירת קשר</h2><ul>
        <li><a href="tel:+{PHONE_INTL}" dir="ltr">{PHONE}</a></li><li><a href="mailto:{EMAIL}">{EMAIL}</a></li>
        <li><a href="/מדיניות-פרטיות/">מדיניות פרטיות</a></li></ul></div>
    </div>
    <p class="site-footer__bottom">© {year} {SITE_NAME}</p>
  </div>
</footer>
<a class="whatsapp" href="https://wa.me/{PHONE_INTL}" target="_blank" rel="noopener" aria-label="שליחת הודעה בוואטסאפ">
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z"/></svg>
</a>
<script>window.SITE_FORM = {{endpoint: {json.dumps(FORM_ENDPOINT)}, email: {json.dumps(EMAIL)}}};</script>
<script src="/assets/main.js" defer></script>
</body>
</html>
"""


# --------------------------------------------------------------------------
# Page builders
# --------------------------------------------------------------------------
def write(path, content):
    target = OUT / path.strip("/") / "index.html" if path != "/" else OUT / "index.html"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def render_elementor(site, item):
    r = Renderer(site, item)
    body = r.render(json.loads(item["meta"]["_elementor_data"]))
    return r, body


# --------------------------------------------------------------------------
# Home page — its own composition, copy taken from the existing home page
# --------------------------------------------------------------------------
# The two things people can buy; checkout links will replace these hrefs.
PRODUCTS = {
    "therapy": {"href": "#contact", "cta": "קביעת פגישת טיפול"},
    "course": {"href": "/קורסים/", "cta": "הרשמה לקורס"},
}
METHODS = [
    ("התמקדות", "/התמקדות/", "הקשבה לתחושה המורגשת בגוף, ה־Felt Sense, שהיא השער לחוכמה הפנימית."),
    ("Somatic Experiencing", "/טיפול-בטראומה-2/", "עבודה עם מערכת העצבים, כדי להשתחרר ממצבים שבהם הגוף עדיין מחזיק את הטראומה."),
    ("הקומי", "/הקומי/", "בשפת ההופי הקומי פירושו how do we stand: מה היחסים שלנו עם כל ממדי הקיום."),
    ("טיפול במגע", "/גרינברג/", "שיטות גרינברג ופאולה, גישות עדינות לעבודה עם טראומות התפתחותיות דרך הגוף הפיזי."),
    ("וידאו תרפיה", "/וידאו-תרפיה/", "הקולנוע ככלי לספר את סיפור חיינו, לצפות בו ולראות אותו באור חדש."),
    ("פוטותרפיה", "/פוטותרפיה/", "צילום כדרך להתבונן בעולם הפנימי, דרך מה שאנחנו בוחרים לראות."),
]
VOICES = [
    ("אחרי שנים של תקיעות ב'מתישהו', מצאתי את האומץ לפתוח קליניקה משלי. זו לא רק עבודה, זו חופש אמיתי שהגיע מתוך תזוזה עמוקה בפנים.", "מטופלת"),
    ("הרגשתי לכודה בדפוסים ישנים, במיוחד במערכות יחסים. דרך ההקשבה לגוף הבנתי מה אני באמת מרגישה, ופתאום יכולתי להציב גבול ברור ששינה הכל.", "מטופלת"),
    ("הכאב היה כמו מפלצת שברחתי ממנה כל חיי. כשלמדתי לעצור ולהקשיב לו בעדינות דרך הגוף, הוא התכווץ והפך לחלק ממני. זוהי השלווה שחיפשתי.", "מטופל"),
]


def podcast_episodes(site, n=2):
    page = site.items.get(1961)
    if not page:
        return []
    eps = []
    pending = None
    def walk(nodes):
        nonlocal pending
        for e in nodes:
            s_ = st(e)
            if e.get("widgetType") == "video":
                pending = youtube_id(s_.get("youtube_url") or "")
            elif e.get("widgetType") == "heading" and pending:
                eps.append((pending, inline(s_.get("title"))))
                pending = None
            walk(e.get("elements", []))
    walk(json.loads(page["meta"]["_elementor_data"]))
    return list(reversed(eps))[:n]


def old_home(site):
    """Pieces of the old home page that the new home keeps, read from the export."""
    out = {"videos": [], "issues": [], "vision": "", "issues_intro": "", "tagline": "", "quote": "", "quote_by": ""}
    def walk(nodes):
        for e in nodes:
            s_ = st(e); w = e.get("widgetType")
            if w == "video":
                vid = youtube_id(s_.get("youtube_url") or "")
                if vid and vid not in out["videos"]:
                    out["videos"].append(vid)
            elif w == "icon-box" and not plain_text(s_.get("description_text") or ""):
                out["issues"].append(inline(s_.get("title_text")).rstrip(": ").strip())
            elif w == "text-editor" and "החזון שלי" in (s_.get("editor") or "") and "Focusing for Freedom" not in (s_.get("editor") or ""):
                out["vision"] = clean_html(s_["editor"])
            elif w == "heading":
                t = inline(s_.get("title"))
                if t.startswith("הטיפול הפרטי מיועד"):
                    out["issues_intro"] = t
                elif t.startswith("מטפלת דרך"):
                    out["tagline"] = t
                elif t == "אוסקר ויילד":
                    out["quote_by"] = t
            elif w == "animated-headline":
                out["quote"] = " ".join(x for x in (s_.get("before_text", "").split() + s_.get("highlighted_text", "").split()))
            walk(e.get("elements", []))
    walk(json.loads(site.items[HOME_ID]["meta"]["_elementor_data"]))
    return out


def home_body(site):
    old = old_home(site)
    essays = [p for p in site.posts_in(cat_ids={6, 15, 16}) if len(plain_text(p["content"])) > 1500][:5]
    episodes = podcast_episodes(site)
    also = [
        ("The Focusing Shift", "#contact", "תכנית דיגיטלית של 90 יום: שיעורים מוקלטים, התמקדויות מודרכות ומפגשי זום קבוצתיים."),
        ("קורס טראומה מתקדם", "/טראומה-מורכבת/", "לימודי המשך למי שסיים שנה א' בהתמקדות: עבודה עם חלקי העצמי הפגיעים, התוקפים והמגינים."),
        ("להתיידד עם הנמר", "/פוקוסינג-לחיי-היום-יום/", "תכנית מקוונת לעבודה אישית, לשחרור ממצבי טראומה וחסימות."),
        ("קורס פוטותרפיה", "/פוטותרפיה/", "קורס למטפלים ולקהל הרחב במרכז גוף נפש ברמת השרון: צילום ככלי להכרת עצמי."),
    ]
    voices = "".join(
        f'<figure class="voice"{"" if i == 0 else " hidden"}><blockquote>{esc(q)}</blockquote><figcaption>{esc(w)}</figcaption></figure>'
        for i, (q, w) in enumerate(VOICES)
    )
    return f"""
<section class="hero">
  <div class="wrap">
    <h1><span>להקשיב פנימה.</span><span>לזוז החוצה.</span></h1>
    <div class="hero__foot">
      <div>
        <p class="lead">מה שדיברת עליו שנים, הגוף שלך כבר יודע. טיפול אישי וקורסים בגישת ההתמקדות, עם ירדן כרם.</p>
        <p class="hero__place">{old["tagline"]}. קליניקה בהרצליה, ומפגשים בזום.</p>
      </div>
      <div class="actions">
        <a class="btn" href="{PRODUCTS['therapy']['href']}" data-product="therapy">{PRODUCTS['therapy']['cta']}</a>
        <a class="btn btn--line" href="{PRODUCTS['course']['href']}" data-product="course">{PRODUCTS['course']['cta']}</a>
      </div>
    </div>
  </div>
</section>

<section class="section" style="padding-top:0" aria-label="שתי דרכים להתחיל">
  <div class="wrap">
    <div class="ways">
      <article class="way way--ink">
        <p class="way__kind">פגישה שבועית, בהרצליה או בזום</p>
        <h2>טיפול אישי</h2>
        <dl>
          <div><dt>למי זה מתאים</dt><dd>למי שמחפשת ליווי אישי צמוד ועבודת עומק על כאב ספציפי, טראומה מורכבת או דפוסים שקשה לשחרר לבד.</dd></div>
          <div><dt>מה קורה במפגש</dt><dd>שעה של הקשבה ל־Felt Sense שלך, במרחב בטוח ותומך, שבו אפשר לפרק בעדינות את מה שתקוע וליצור תנועה פנימית אמיתית.</dd></div>
        </dl>
        <div class="actions">
          <a class="btn btn--paper" href="{PRODUCTS['therapy']['href']}" data-product="therapy">{PRODUCTS['therapy']['cta']}</a>
          <a class="btn btn--line-light" href="/טיפולים-פרטניים/">על שיטות הטיפול</a>
        </div>
      </article>
      <article class="way way--mist">
        <p class="way__kind">קורס שנתי, אונליין או פרונטלי</p>
        <h2>קורס התמקדות</h2>
        <dl>
          <div><dt>למי זה מתאים</dt><dd>למי שרוצה ללמוד את שפת הגוף לעומק: להתפתחות אישית, כקורס שנתי למתחילים או כהשלמה מקצועית למטפלים.</dd></div>
          <div><dt>מה לומדים</dt><dd>את יסודות גישת ההתמקדות, איך להנחות אדם אחר בתהליך, ואיך לפתח קשב פנימי שילווה אותך כל החיים.</dd></div>
        </dl>
        <div class="actions">
          <a class="btn" href="{PRODUCTS['course']['href']}" data-product="course">{PRODUCTS['course']['cta']}</a>
          <a class="btn btn--line" href="/קורסים/">סילבוס ומועדים</a>
        </div>
      </article>
    </div>
    <div class="also">
      <p>דרכים נוספות</p>
      <ul>{"".join(f'<li><a href="{h}"><b>{t}</b><span>{d}</span></a></li>' for t, h, d in also)}</ul>
    </div>
  </div>
</section>

<section class="section section--mist">
  <div class="wrap split">
    <h2>כשהבנה לא הופכת לתנועה</h2>
    <div class="body">
      <p>ניסית כבר הרבה: טיפולי שיחה, סדנאות, מדיטציה, ספרים. צברת תובנות עמוקות, ובכל זאת משהו בפנים עדיין תקוע.</p>
      <p>כשאנחנו תקועים, זה לרוב מפני שמערכת העצבים והגוף מחזיקים את הקושי בצורה פיזית, והבנה שכלית לבדה לא מזיזה חסימה שיושבת בגוף.</p>
      <p>התמקדות היא לא עוד שיטה שמנסה לתקן אותך. זו דרך עדינה ומבוססת מחקר, שפיתח יוג'ין ג'נדלין, לפגוש את מה שחי בתוכך ולתת לגוף מרחב לדבר ולנוע בקצב שלו.</p>
      <ul class="plain-list">
        <li>התהליך ממוקד יותר, כי עובדים עם מפה ולא בתוך ערפל.</li>
        <li>אפשר לעשות תהליך אישי קצר לאורך היום, גם בלי תלות באדם אחר.</li>
        <li>מתפתחת עצמאות: היכולת להוביל את החיים מבפנים.</li>
      </ul>
    </div>
  </div>
</section>

<section class="section">
  <div class="wrap split">
    <h2>למי מתאים הטיפול</h2>
    <div class="body">
      <p>{old["issues_intro"]}</p>
      <ul class="issue-list">{"".join(f"<li>{i}</li>" for i in old["issues"])}</ul>
    </div>
  </div>
</section>

<section class="section section--ink" aria-label="מה אומרים מטופלים">
  <div class="wrap">
    <!--yk:voices--><div class="voices" data-voices>{voices}</div>
    <div class="voices__nav">
      <button class="btn btn--line-light btn--sm" type="button" data-voices-next>המלצה הבאה</button>
      <span class="voices__count" data-voices-count>1 מתוך {len(VOICES)}</span><!--/yk:voices-->
      <a href="/לקוחות-מספרים/">כל ההמלצות</a>
    </div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <h2 class="section__title">השיטות שאני עובדת איתן</h2>
    <ul class="methods">{"".join(f'<li><a href="{h}"><span class="methods__name">{n}</span><span class="methods__desc">{d}</span></a></li>' for n, h, d in METHODS)}</ul>
  </div>
</section>

<section class="section section--mist">
  <div class="wrap about">
    <h2>אני כאן כדי ללמד הקשבה לגוף</h2>
    <div class="body">
      <p>אני מטפלת ומרצה כבר 30 שנה, מרצה בכירה לגישת ההתמקדות ולקורסים שעוסקים בטראומה. לימדתי יותר מ־750 תלמידים, ומאחוריי יותר מ־25,000 שעות טיפול.</p>
      <p>בעלת תואר ראשון בפילוסופיה, תואר שני בקולנוע ובטיפול דרך הבעה ויצירה, ותואר שני בעבודה סוציאלית קלינית. מנהלת אקדמית ומרצה במרכז הישראלי לרפואת גוף נפש ברמת השרון, ומגישה את הפודקאסט "פוקוסינג עם ירדן כרם".</p>
      <div class="vision">{old["vision"]}</div>
      <blockquote class="epigraph"><p>{old["quote"]}</p><cite>{old["quote_by"]}</cite></blockquote>
      <p><a class="more" href="/אודות/">עוד עליי</a></p>
    </div>
  </div>
</section>

<section class="section">
  <div class="wrap media-split">
    <div>
      <h2>להאזין: פוקוסינג עם ירדן כרם</h2>
      {"".join(f'<div class="episode">{video_embed(v, t)}<p>{t}</p></div>' for v, t in episodes)}
      <p><a class="more" href="/פודקאסט/">כל פרקי הפודקאסט</a></p>
    </div>
    <div>
      <h2>לקרוא: מאמרים</h2>
      <!--yk:essays-->{post_cards(site, essays, single=True)}<!--/yk:essays-->
      <p style="margin-top:24px"><a class="more" href="/מאמרים-שאני-כתבתי/">כל המאמרים</a></p>
    </div>
  </div>
</section>
<section class="section section--mist">
  <div class="wrap">
    <h2 class="section__title">לצפות</h2>
    <div class="video-grid">{"".join(video_embed(v) for v in old["videos"])}</div>
  </div>
</section>
{contact_section(intro="לבחירתך הדרך שמדברת אל ליבך. השאירו פרטים ואחזור אליכם לשיחת היכרות קצרה, או פנו ישירות.")}
"""


def testimonials_region(site, page, body):
    """Collect every testimonial (page carousel, old-home-only ones, home voices)
    into SEED and replace the page's quotes with one admin-managed region."""
    seen = set()
    def add(name, role, content_html, on_home=False):
        key = plain_text(content_html)[:60]
        if not key or key in seen:
            return
        seen.add(key)
        SEED["testimonials"].append({"name": name or "", "role": role or "", "body": content_html,
                                     "show_on_home": on_home, "position": len(SEED["testimonials"])})
    def slides_of(item):
        out = []
        def walk(nodes):
            for e in nodes:
                if e.get("widgetType") == "testimonial-carousel":
                    out.extend(st(e).get("slides") or [])
                walk(e.get("elements", []))
        walk(json.loads(item["meta"]["_elementor_data"]))
        return out
    for q, who in VOICES:
        add(who, "", f"<p>{esc(q)}</p>", on_home=True)
    for sl in slides_of(page) + slides_of(site.items[HOME_ID]):
        add(sl.get("name"), sl.get("title"), clean_html(sl.get("content") or ""))
    quotes = [t for t in SEED["testimonials"]]
    region = "<!--yk:testimonials-->" + testimonials_html(quotes) + "<!--/yk:testimonials-->"
    first = re.search(r'<div class="quotes">.*?</div>', body, flags=re.S)
    if not first:
        return body + f'<section class="block"><div class="wrap">{region}</div></section>'
    start = first.start()
    body = re.sub(r'<div class="quotes">.*?</div>', "", body, flags=re.S)   # every old carousel
    return body[:start] + region + body[start:]


def testimonials_html(items):
    cards = []
    for t in items:
        role = f" · {esc(t['role'])}" if t["role"] else ""
        cards.append(f'<figure class="quote"><blockquote class="prose">{t["body"]}</blockquote>'
                     f'<figcaption><strong>{esc(t["name"])}</strong>{role}</figcaption></figure>')
    return f'<div class="quotes">{"".join(cards)}</div>'


def blog_body(site):
    posts = site.posts_in(cat_ids={c["id"] for c in site.data["categories"]})
    cats = []
    for c in site.data["categories"]:
        n = len(site.posts_in(cat_ids={c["id"]}))
        if n:
            cats.append(f'<li><a href="/category/{esc(c["slug"])}/">{esc(c["name"])}</a> <span class="quiet">{n}</span></li>')
    years = {}
    for p in posts:
        years.setdefault(p["date"][:4], []).append(p)
    blocks = "".join(
        f'<section class="year"><h2>{y}</h2>{post_cards(site, ps)}</section>' for y, ps in years.items()
    )
    return (
        f'<section class="block"><div class="wrap"><!--yk:blog-->'
        f'<nav class="topic-nav" aria-label="נושאים"><ul>{"".join(cats)}</ul></nav>{blocks}<!--/yk:blog--></div></section>'
        + contact_block()
    )


def build_page(site, page):
    path = site.url(page)
    if page["id"] == BLOG_ID:
        n = len(site.posts_in(cat_ids={c["id"] for c in site.data["categories"]}))
        hero = {"title": "בלוג", "sub": [f"כל <!--yk:count-->{n}<!--/yk:count--> הפוסטים והמאמרים, מ־2018 ועד היום."]}
        write(path, page_shell(site, path=path, title="בלוג", body=blog_body(site), hero=hero,
                               description="כל הפוסטים והמאמרים של ירדן כרם על התמקדות, טיפול בטראומה, Somatic Experiencing וטיפול דרך הגוף."))
        return
    if page["id"] == HOME_ID:
        ld = {"@context": "https://schema.org", "@graph": [
            {"@type": "WebSite", "name": SITE_TITLE, "url": SITE_URL + "/", "inLanguage": "he"},
            {"@type": "Person", "name": SITE_NAME, "url": SITE_URL + "/", "jobTitle": "מטפלת ומרצה לגישת ההתמקדות",
             "email": EMAIL, "telephone": "+" + PHONE_INTL,
             "address": {"@type": "PostalAddress", "addressLocality": "הרצליה", "addressCountry": "IL"},
             "sameAs": [u for _, _, u in SOCIAL]},
        ]}
        write(path, page_shell(site, path=path, title=SITE_NAME, body=home_body(site), article=ld,
                               seo_title="דף הבית - " + SITE_TITLE,
                               description="מה שדיברת עליו שנים, הגוף שלך כבר יודע. טיפול אישי וקורסים בגישת ההתמקדות עם ירדן כרם, בהרצליה ובזום."))
        return
    has_contact = False
    if page["meta"].get("_elementor_data"):
        r, body = render_elementor(site, page)
        hero = r.hero or {"title": esc(page["title"])}
        has_contact = 'data-form="contact"' in body
    else:
        body = f'<section class="block"><div class="wrap prose" style="max-width:var(--measure)">{clean_html(page["content"])}</div></section>'
        hero = {"title": esc(page["title"])}
    hero["sub"] = hero.get("sub", [])[:1]
    if page["slug"] == "לקוחות-מספרים":
        body = testimonials_region(site, page, body)
    if not has_contact and page["slug"] != "מדיניות-פרטיות":
        body += contact_block()
    desc = page["meta"].get("_yoast_wpseo_metadesc") or plain_text(body, 155)
    write(path, page_shell(site, path=path, title=page["title"], body=body, description=desc, hero=hero,
                           seo_title=page["meta"].get("_yoast_wpseo_title") or None))


def build_post(site, p):
    path = site.url(p)
    cats = site.post_cats(p)
    tags = site.post_tags(p)
    if p["meta"].get("_elementor_data"):
        # Posts sit in a single narrow column, so flatten Elementor sections.
        r = Renderer(site, p)
        body_html = "\n".join(r._flatten(e) for e in json.loads(p["meta"]["_elementor_data"]))
        if not body_html.strip():
            body_html = f'<div class="prose">{clean_html(p["content"])}</div>'
    else:
        imgs = []
        body_html = f'<div class="prose">{clean_html(p["content"], imgs)}</div>'
        for i in imgs:
            site.image(i)
    cat_links = ", ".join(f'<a href="/category/{esc(c["slug"])}/">{esc(c["name"])}</a>' for c in cats)
    tag_html = "".join(f'<a href="/tag/{esc(t["slug"])}/">{esc(t["name"])}</a>' for t in tags)
    related = []
    if cats:
        related = [x for x in site.posts_in(cat_ids={c["id"] for c in cats}) if x["id"] not in (p["id"], site.canonical_of.get(p["id"]))][:3]
    rel_html = (
        f'<section class="block block--tint"><div class="wrap"><h2 class="heading">עוד באותו נושא</h2>{post_cards(site, related)}</div></section>'
        if related else ""
    )
    body = f"""
<article class="block article">
  <div class="wrap">
    {body_html}
    {f'<p class="tags">{tag_html}</p>' if tag_html else ''}
  </div>
</article>
{rel_html}
{contact_block()}"""
    hero = {
        "title": esc(p["title"]),
        "crumb": f'<p class="crumb">{cat_links + ", " if cat_links else ""}<time datetime="{p["date"][:10]}">{fmt_date(p["date"])}</time></p>',
        "sub": [],
    }
    canonical = None
    SEED["posts"].append({
        "wp_id": p["id"],
        "path": path,
        "slug": path.strip("/"),
        "title": p["title"],
        "date": p["date"],
        "modified": p["modified"] or p["date"],
        "categories": [c["slug"] for c in cats],
        "tags": [t["slug"] for t in tags],
        "body": body_html,
        "excerpt": excerpt_of(site, p, 155),
        "is_video": site.thumb(p)[1],
        "duplicate_of": site.url(site.items[site.canonical_of[p["id"]]]) if p["id"] in site.canonical_of else None,
    })
    img, _ = site.thumb(p)
    og = (SITE_URL + enc(img)) if img and img.startswith("/") else img
    ld = {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        "headline": p["title"],
        "datePublished": p["date"].replace(" ", "T"),
        "dateModified": (p["modified"] or p["date"]).replace(" ", "T"),
        "author": {"@type": "Person", "name": SITE_NAME},
        "inLanguage": "he",
        "mainEntityOfPage": SITE_URL + enc(path),
    }
    write(path, page_shell(site, path=path, title=p["title"], body=body, description=excerpt_of(site, p, 155),
                           hero=hero, canonical=canonical, og_image=og, article=ld))


def build_archive(site, path, title, posts, eyebrow):
    seo_title = f"{title} Archives - {SITE_TITLE}"
    body = (f'<section class="block"><div class="wrap"><!--yk:list-->{post_cards(site, posts) or "<p>אין כאן עדיין פרסומים.</p>"}'
            f'<!--/yk:list--></div></section>' + contact_block())
    hero = {"title": esc(title), "crumb": f'<p class="crumb">{eyebrow}</p>', "sub": []}
    write(path, page_shell(site, path=path, title=title, body=body, description=f"{eyebrow}: {title} – {SITE_NAME}", hero=hero, seo_title=seo_title))


def build_404(site):
    body = """<section class="block"><div class="wrap narrow prose">
<p>ייתכן שהקישור השתנה. אפשר לחזור ל<a href="/">דף הבית</a>, לעבור ל<a href="/בלוג/">בלוג</a> או ל<a href="/מאמרים-שאני-כתבתי/">מאמרים</a>.</p>
</div></section>"""
    html_ = page_shell(site, path="/404/", title="הדף לא נמצא", body=body, hero={"title": "הדף לא נמצא"})
    (OUT / "404.html").write_text(html_, encoding="utf-8")


def build_sitemaps(groups):
    """Yoast-compatible sitemaps: sitemap_index.xml plus one file per type."""
    def urlset(rows):
        body = "".join(
            f"<url><loc>{SITE_URL}{enc(u)}</loc>{f'<lastmod>{m[:10]}</lastmod>' if m else ''}</url>" for u, m in rows
        )
        return f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{body}</urlset>\n'
    today = dt.date.today().isoformat()
    index = ""
    for name, rows in groups.items():
        (OUT / f"{name}-sitemap.xml").write_text(urlset(rows), encoding="utf-8")
        last = max((m[:10] for _, m in rows if m), default=today)
        index += f"<sitemap><loc>{SITE_URL}/{name}-sitemap.xml</loc><lastmod>{last}</lastmod></sitemap>"
    xml = f'<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{index}</sitemapindex>\n'
    (OUT / "sitemap_index.xml").write_text(xml, encoding="utf-8")
    (OUT / "sitemap.xml").write_text(xml, encoding="utf-8")
    (OUT / "robots.txt").write_text(
        f"User-agent: *\nDisallow: /admin/\nDisallow: /api/\n\nSitemap: {SITE_URL}/sitemap_index.xml\n", encoding="utf-8")


def apply_seo_overrides():
    """Titles/descriptions edited in the admin (exported to data/seo-overrides.json)
    survive a rebuild."""
    f = ROOT / "data" / "seo-overrides.json"
    if not f.exists():
        return
    for row in json.loads(f.read_text(encoding="utf-8")):
        target = OUT / "index.html" if row["path"] == "/" else OUT / row["path"].strip("/") / "index.html"
        if not target.exists():
            continue
        h = target.read_text(encoding="utf-8")
        t, d = esc(row["title"] or ""), esc(row["description"] or "")
        h = re.sub(r"<title>.*?</title>", lambda m: f"<title>{t}</title>", h, count=1, flags=re.S)
        h = re.sub(r'<meta name="description" content="[^"]*">', lambda m: f'<meta name="description" content="{d}">', h, count=1)
        h = re.sub(r'<meta property="og:description" content="[^"]*">', lambda m: f'<meta property="og:description" content="{d}">', h, count=1)
        if row.get("noindex"):
            h = h.replace('<meta name="description"', '<meta name="robots" content="noindex, follow">\n<meta name="description"', 1)
        target.write_text(h, encoding="utf-8")


def export_seed(site):
    """Files the admin area imports on first run and uses to render new pages."""
    out = OUT / "admin" / "_lib" / "seed"
    out.mkdir(parents=True, exist_ok=True)
    # Page template: the real site shell with placeholders the PHP side fills in.
    shell = page_shell(site, path="/__YK_PATH__/", title="__YK_TITLE__", body="__YK_BODY__",
                       description="__YK_DESC__", og_image="__YK_OG__", article={"yk": "__YK_LD__"},
                       seo_title="__YK_SEOTITLE__")
    shell = shell.replace(SITE_URL + "/__YK_PATH__/", "__YK_URL__")
    shell = re.sub(r'<meta property="og:image" content="__YK_OG__">', "__YK_OGLINE__", shell)
    shell = re.sub(r'<script type="application/ld\+json">.*?</script>', "__YK_LDSCRIPT__", shell, flags=re.S)
    shell = shell.replace('content="article"', 'content="__YK_OGTYPE__"', 1)
    (out / "shell.html").write_text(shell, encoding="utf-8")
    (out / "contact.html").write_text(contact_block(), encoding="utf-8")
    cats = [{"slug": c["slug"], "name": c["name"], "wp_id": c["id"]} for c in site.data["categories"]]
    tags = [{"slug": t["slug"], "name": t["name"]} for t in site.data["tags"]]
    for name, data in (("posts", SEED["posts"]), ("testimonials", SEED["testimonials"]),
                       ("categories", cats), ("tags", tags)):
        (out / f"{name}.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def build_feed(site):
    items = ""
    for p in site.posts[:20]:
        link = SITE_URL + enc(site.url(p))
        date = dt.datetime.strptime(p["date"], "%Y-%m-%d %H:%M:%S").strftime("%a, %d %b %Y %H:%M:%S +0000")
        items += (f"<item><title>{esc(p['title'])}</title><link>{link}</link><guid>{link}</guid>"
                  f"<pubDate>{date}</pubDate><description>{esc(excerpt_of(site, p, 300))}</description></item>")
    rss = (f'<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>{esc(SITE_TITLE)}</title>'
           f"<link>{SITE_URL}/</link><description>{esc(TAGLINE)}</description><language>he-IL</language>{items}</channel></rss>\n")
    (OUT / "feed.xml").write_text(rss, encoding="utf-8")


def main():
    site = Site(json.loads(DATA.read_text(encoding="utf-8")))
    if OUT.exists():
        for child in OUT.iterdir():
            if child.name == "wp-content":
                continue  # uploaded media lives here; never wipe it
            shutil.rmtree(child) if child.is_dir() else child.unlink()
    OUT.mkdir(exist_ok=True)
    shutil.copytree(ASSETS, OUT / "assets")
    # Admin area + form endpoint (PHP). A local config.local.php is never copied.
    for part in ("admin", "api"):
        shutil.copytree(ROOT / "server" / part, OUT / part,
                        ignore=shutil.ignore_patterns("config.local.php", "_private"))
    shutil.copy(ROOT / "server" / "htaccess", OUT / ".htaccess")

    groups = {"post": [], "page": [], "category": [], "post_tag": []}
    for page in site.pages:
        build_page(site, page)
        groups["page"].append((site.url(page), page["modified"]))
    for p in site.posts:
        build_post(site, p)
        groups["post"].append((site.url(p), p["modified"]))
    for c in site.data["categories"]:
        posts = site.posts_in(cat_ids={c["id"]})
        build_archive(site, f"/category/{c['slug']}/", c["name"], posts, "קטגוריה")
        groups["category"].append((f"/category/{c['slug']}/", None))
    for t in site.data["tags"]:
        posts = [p for p in site.posts if t["slug"] in {x["slug"] for x in site.post_tags(p)} and p["id"] not in site.canonical_of]
        if posts:
            build_archive(site, f"/tag/{t['slug']}/", t["name"], posts, "תגית")
            groups["post_tag"].append((f"/tag/{t['slug']}/", None))
    build_404(site)
    export_seed(site)
    apply_seo_overrides()
    build_sitemaps(groups)
    build_feed(site)
    (OUT / "_redirects").write_text(
        "# Netlify / Cloudflare Pages\n"
        "/ראשי-2/  /  301\n"
        "/feed  /feed.xml  200\n"
        "/feed/  /feed.xml  200\n"
        "/comments/feed/  /feed.xml  301\n"
        "/wp-sitemap.xml  /sitemap_index.xml  301\n"
        "/page-sitemap1.xml  /page-sitemap.xml  301\n",
        encoding="utf-8",
    )

    media = sorted(site.images_used)
    (ROOT / "data" / "media-needed.txt").write_text("\n".join(media) + "\n", encoding="utf-8")
    (OUT / "admin" / "_lib" / "seed" / "media-needed.txt").write_text("\n".join(media) + "\n", encoding="utf-8")
    total = sum(len(v) for v in groups.values())
    print(f"built {len(site.pages)} pages, {len(site.posts)} posts, {total} sitemap urls; {len(media)} media files referenced")


if __name__ == "__main__":
    main()
