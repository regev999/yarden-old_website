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
# Where the contact forms post to (e.g. a Formspree / Getform URL).
# Left empty, the forms open the visitor's mail app with the details filled in.
FORM_ENDPOINT = ""
HOME_ID = 139
SOCIAL = [
    ("youtube", "יוטיוב", "https://www.youtube.com/@yardenkerem5297"),
    ("facebook", "פייסבוק", "https://www.facebook.com/somatictherapyandfocusing/"),
    ("instagram", "אינסטגרם", "https://www.instagram.com/yarden_kerem/"),
    ("spotify", "ספוטיפיי", "https://open.spotify.com/show/1PdEltqdiPKR4aGi3efIDc"),
    ("linkedin", "לינקדאין", "https://www.linkedin.com/in/yarden-kerem/"),
    ("tiktok", "טיקטוק", "https://www.tiktok.com/@yarden.kerem"),
]

esc = html.escape


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
            f'<a href="{href}" target="_blank" rel="noopener" aria-label="{label}" title="{label}">'
            f'<svg viewBox="0 0 24 24" aria-hidden="true">{ICONS[key]}</svg></a>'
        )
    return f'<div class="{cls}">{"".join(out)}</div>'


def contact_form(kind="contact", with_message=True):
    if kind == "newsletter":
        return (
            '<form class="form form--inline" data-form="newsletter">'
            '<label class="sr-only" for="nl-email">דוא"ל</label>'
            '<input id="nl-email" type="email" name="email" required placeholder="כתובת הדוא&quot;ל שלך" autocomplete="email">'
            '<button class="btn" type="submit">הרשמה לעדכונים</button>'
            '<p class="form__status" role="status"></p></form>'
        )
    msg = (
        '<label class="form__full">במה אוכל לעזור?<textarea name="message" rows="4"></textarea></label>'
        if with_message else ""
    )
    return (
        '<form class="form" data-form="contact">'
        '<label>שם מלא<input type="text" name="name" required autocomplete="name"></label>'
        '<label>טלפון<input type="tel" name="phone" autocomplete="tel" inputmode="tel"></label>'
        '<label class="form__full">דוא"ל<input type="email" name="email" autocomplete="email"></label>'
        f'{msg}<button class="btn" type="submit">שליחה</button>'
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


def post_cards(site, posts):
    if not posts:
        return ""
    cards = []
    for p in posts:
        img, is_video = site.thumb(p)
        cat = site.post_cats(p)
        media = (
            f'<div class="post-card__media{" is-video" if is_video else ""}"><img src="{esc(img)}" alt="" loading="lazy" decoding="async"></div>'
            if img else f'<div class="post-card__media post-card__media--plain"><span>{esc(cat[0]["name"] if cat else SITE_NAME)}</span></div>'
        )
        cards.append(
            f'<article class="post-card"><a href="{esc(site.url(p))}">{media}'
            f'<div class="post-card__body"><p class="post-card__meta">{fmt_date(p["date"])}</p>'
            f'<h3>{esc(p["title"])}</h3><p>{esc(excerpt_of(site, p))}</p></div></a></article>'
        )
    return f'<div class="post-grid">{"".join(cards)}</div>'


def post_list(site, posts):
    if not posts:
        return ""
    rows = "".join(
        f'<li><a href="{esc(site.url(p))}"><span>{esc(p["title"])}</span><time datetime="{p["date"][:10]}">{fmt_date(p["date"])}</time></a></li>'
        for p in posts
    )
    return f'<ul class="post-list">{rows}</ul>'


def contact_block():
    return f"""
<section class="block block--contact" id="contact">
  <div class="wrap cols cols-2">
    <div class="col">
      <p class="eyebrow">צור קשר</p>
      <h2 class="heading">נשמח לשמוע ממך</h2>
      <p>אפשר להשאיר פרטים ואחזור אליך, או ליצור קשר ישירות:</p>
      <ul class="contact-lines">
        <li><a href="tel:+{PHONE_INTL}">{PHONE}</a></li>
        <li><a href="mailto:{EMAIL}">{EMAIL}</a></li>
        <li>פגישות ב{LOCATION}</li>
      </ul>
      {social_links()}
    </div>
    <div class="col">{contact_form()}</div>
  </div>
</section>"""


# --------------------------------------------------------------------------
# Page shell
# --------------------------------------------------------------------------
def build_menu(site):
    items = [i for i in site.data["items"] if i["type"] == "nav_menu_item"]
    items.sort(key=lambda i: i["menu_order"])
    nodes = {}
    for i in items:
        m = i["meta"]
        target = site.items.get(int(m.get("_menu_item_object_id") or 0))
        title = i["title"] or (target["title"] if target else "")
        if m.get("_menu_item_type") == "custom":
            href = rewrite_url(m.get("_menu_item_url") or "#")
        else:
            href = site.url(target) if target else "#"
        nodes[i["id"]] = {"title": title, "href": href, "parent": int(m.get("_menu_item_menu_item_parent") or 0), "children": []}
    roots = []
    for nid, n in nodes.items():
        (nodes[n["parent"]]["children"] if n["parent"] in nodes else roots).append(n)
    return roots


def render_nav(menu, current):
    def li(n, depth=0):
        cur = ' aria-current="page"' if n["href"] == current else ""
        if n["children"]:
            sub = "".join(li(c, depth + 1) for c in n["children"])
            label = esc(n["title"])
            link = f'<a href="{esc(n["href"])}"{cur}>{label}</a>' if n["href"] not in ("#", "") else f'<span class="nav__label">{label}</span>'
            return (
                f'<li class="has-sub">{link}<button class="nav__toggle" type="button" aria-expanded="false" aria-label="פתיחת תת־תפריט {label}"></button>'
                f'<ul class="nav__sub">{sub}</ul></li>'
            )
        return f'<li><a href="{esc(n["href"])}"{cur}>{esc(n["title"])}</a></li>'

    return "".join(li(n) for n in menu)


def page_shell(site, *, path, title, body, description="", hero=None, canonical=None, og_image=None, article=None):
    full_title = f"{title} | {SITE_NAME}" if title and path != "/" else f"{SITE_NAME} – {TAGLINE}"
    desc = esc(description or f"{SITE_NAME} – {TAGLINE}. טיפול אישי, קורסים והרצאות.")
    canon = SITE_URL + urllib.parse.quote(canonical or path)
    nav = render_nav(site.menu, path)
    hero_html = ""
    if hero:
        bg = f' style="--bg:url(\'{esc(hero["bg"])}\')"' if hero.get("bg") else ""
        subs = "".join(f"<p>{s}</p>" for s in hero.get("sub", []))
        hero_html = (
            f'<header class="hero{" hero--image" if hero.get("bg") else ""}"{bg}><div class="wrap">'
            f'{hero.get("eyebrow", "")}<h1>{hero["title"]}</h1>{subs}</div></header>'
        )
    og = f'<meta property="og:image" content="{esc(og_image)}">' if og_image else ""
    ld = ""
    if article:
        ld = '<script type="application/ld+json">' + json.dumps(article, ensure_ascii=False) + "</script>"
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
<meta name="theme-color" content="#2c4a68">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Assistant:wght@400;600;700&family=Frank+Ruhl+Libre:wght@500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/style.css">
{ld}
</head>
<body>
<a class="skip" href="#main">דילוג לתוכן</a>
<div class="topbar"><div class="wrap">
  <span>מטפלת ומרצה · {TAGLINE}</span>
  <a href="tel:+{PHONE_INTL}">{PHONE}</a>
</div></div>
<header class="site-header">
  <div class="wrap site-header__inner">
    <a class="brand" href="/"><span class="brand__mark" aria-hidden="true"></span><span class="brand__name">{SITE_NAME}</span><span class="brand__tag">{TAGLINE}</span></a>
    <button class="menu-btn" type="button" aria-expanded="false" aria-controls="nav"><span></span><span class="sr-only">תפריט</span></button>
    <nav id="nav" class="nav" aria-label="ניווט ראשי"><ul>{nav}</ul></nav>
  </div>
</header>
<main id="main">
{hero_html}
{body}
</main>
<footer class="site-footer">
  <div class="wrap cols cols-3">
    <div class="col">
      <p class="site-footer__brand">{SITE_NAME}</p>
      <p>טיפול דרך מיינדפולנס והקשבה לחוויה הסומטית: {TAGLINE}.</p>
      {social_links()}
    </div>
    <div class="col">
      <p class="site-footer__title">ניווט מהיר</p>
      <ul class="footer-links">
        <li><a href="/אודות/">אודות</a></li>
        <li><a href="/טיפולים-פרטניים/">טיפולים פרטניים</a></li>
        <li><a href="/קורסים/">קורסי התמקדות</a></li>
        <li><a href="/בלוג/">בלוג</a></li>
        <li><a href="/פודקאסט/">פודקאסט</a></li>
        <li><a href="/מדיניות-פרטיות/">מדיניות פרטיות</a></li>
      </ul>
    </div>
    <div class="col">
      <p class="site-footer__title">יצירת קשר</p>
      <ul class="footer-links">
        <li><a href="tel:+{PHONE_INTL}">{PHONE}</a></li>
        <li><a href="mailto:{EMAIL}">{EMAIL}</a></li>
        <li>{LOCATION}</li>
      </ul>
    </div>
  </div>
  <div class="wrap site-footer__bottom">© {year} {SITE_NAME}. כל הזכויות שמורות.</div>
</footer>
<a class="whatsapp" href="https://wa.me/{PHONE_INTL}" target="_blank" rel="noopener" aria-label="שליחת הודעת וואטסאפ">
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


def build_page(site, page):
    path = site.url(page)
    has_contact = False
    if page["meta"].get("_elementor_data"):
        r, body = render_elementor(site, page)
        hero = r.hero or {"title": esc(page["title"])}
        has_contact = 'data-form="contact"' in body
    else:
        body = f'<section class="block"><div class="wrap narrow prose">{clean_html(page["content"])}</div></section>'
        hero = {"title": esc(page["title"])}
    if page["id"] == HOME_ID:
        hero = home_hero(hero)
    if not has_contact and page["slug"] != "מדיניות-פרטיות":
        body += contact_block()
    text = plain_text(body, 155)
    desc = page["meta"].get("_yoast_wpseo_metadesc") or text
    title = SITE_NAME if page["id"] == HOME_ID else page["title"]
    write(path, page_shell(site, path=path, title=title, body=body, description=desc, hero=hero))


def home_hero(h):
    return {
        "title": SITE_NAME,
        "sub": [h["sub"][0] if h.get("sub") else "מטפלת דרך מיינדפולנס והקשבה לחוויה הסומטית"],
        "bg": h.get("bg"),
        "eyebrow": '<p class="eyebrow">טיפול אישי · קורסים · הרצאות</p>',
    }


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
    chips = "".join(f'<a class="chip" href="/category/{esc(c["slug"])}/">{esc(c["name"])}</a>' for c in cats)
    tag_html = "".join(f'<a class="chip chip--quiet" href="/tag/{esc(t["slug"])}/">#{esc(t["name"])}</a>' for t in tags)
    related = []
    if cats:
        related = [x for x in site.posts_in(cat_ids={c["id"] for c in cats}) if x["id"] not in (p["id"], site.canonical_of.get(p["id"]))][:3]
    rel_html = (
        f'<section class="block block--tint"><div class="wrap"><h2 class="heading">עוד באותו נושא</h2>{post_cards(site, related)}</div></section>'
        if related else ""
    )
    body = f"""
<article class="block article">
  <div class="wrap narrow">
    {body_html}
    {f'<p class="chips">{tag_html}</p>' if tag_html else ''}
  </div>
</article>
{rel_html}
{contact_block()}"""
    hero = {
        "title": esc(p["title"]),
        "eyebrow": f'<p class="eyebrow">{chips} <time datetime="{p["date"][:10]}">{fmt_date(p["date"])}</time></p>',
        "sub": [],
    }
    canonical = site.url(site.items[site.canonical_of[p["id"]]]) if p["id"] in site.canonical_of else None
    img, _ = site.thumb(p)
    og = (SITE_URL + urllib.parse.quote(img)) if img and img.startswith("/") else img
    ld = {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        "headline": p["title"],
        "datePublished": p["date"].replace(" ", "T"),
        "dateModified": (p["modified"] or p["date"]).replace(" ", "T"),
        "author": {"@type": "Person", "name": SITE_NAME},
        "inLanguage": "he",
        "mainEntityOfPage": SITE_URL + urllib.parse.quote(path),
    }
    write(path, page_shell(site, path=path, title=p["title"], body=body, description=excerpt_of(site, p, 155),
                           hero=hero, canonical=canonical, og_image=og, article=ld))


def build_archive(site, path, title, posts, eyebrow):
    body = f'<section class="block"><div class="wrap">{post_cards(site, posts) or "<p>אין עדיין פוסטים.</p>"}</div></section>' + contact_block()
    hero = {"title": esc(title), "eyebrow": f'<p class="eyebrow">{eyebrow}</p>', "sub": [f"{len(posts)} פוסטים"]}
    write(path, page_shell(site, path=path, title=title, body=body, description=f"{eyebrow}: {title} – {SITE_NAME}", hero=hero))


def build_404(site):
    body = """<section class="block"><div class="wrap narrow prose">
<p>ייתכן שהקישור השתנה. אפשר לחזור ל<a href="/">דף הבית</a>, לעבור ל<a href="/בלוג/">בלוג</a> או ל<a href="/מאמרים-שאני-כתבתי/">מאמרים</a>.</p>
</div></section>"""
    html_ = page_shell(site, path="/404/", title="הדף לא נמצא", body=body, hero={"title": "הדף לא נמצא"})
    (OUT / "404.html").write_text(html_, encoding="utf-8")


def build_sitemap(site, urls):
    rows = "".join(
        f"<url><loc>{SITE_URL}{urllib.parse.quote(u)}</loc>{f'<lastmod>{m[:10]}</lastmod>' if m else ''}</url>"
        for u, m in urls
    )
    (OUT / "sitemap.xml").write_text(
        f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{rows}</urlset>\n',
        encoding="utf-8",
    )
    (OUT / "robots.txt").write_text(f"User-agent: *\nAllow: /\n\nSitemap: {SITE_URL}/sitemap.xml\n", encoding="utf-8")


def main():
    site = Site(json.loads(DATA.read_text(encoding="utf-8")))
    site.menu = build_menu(site)
    if OUT.exists():
        for child in OUT.iterdir():
            if child.name == "wp-content":
                continue  # uploaded media lives here; never wipe it
            shutil.rmtree(child) if child.is_dir() else child.unlink()
    OUT.mkdir(exist_ok=True)
    shutil.copytree(ASSETS, OUT / "assets")

    urls = []
    for page in site.pages:
        build_page(site, page)
        urls.append((site.url(page), page["modified"]))
    for p in site.posts:
        build_post(site, p)
        if p["id"] not in site.canonical_of:
            urls.append((site.url(p), p["modified"]))
    for c in site.data["categories"]:
        posts = site.posts_in(cat_ids={c["id"]})
        build_archive(site, f"/category/{c['slug']}/", c["name"], posts, "קטגוריה")
        urls.append((f"/category/{c['slug']}/", None))
    for t in site.data["tags"]:
        posts = [p for p in site.posts if t["slug"] in {x["slug"] for x in site.post_tags(p)} and p["id"] not in site.canonical_of]
        if posts:
            build_archive(site, f"/tag/{t['slug']}/", t["name"], posts, "תגית")
            urls.append((f"/tag/{t['slug']}/", None))
    build_404(site)
    build_sitemap(site, urls)
    (OUT / "_redirects").write_text("/ראשי-2/  /  301\n", encoding="utf-8")

    media = sorted(site.images_used)
    (ROOT / "data" / "media-needed.txt").write_text("\n".join(media) + "\n", encoding="utf-8")
    print(f"built {len(site.pages)} pages, {len(site.posts)} posts, {len(urls)} sitemap urls; {len(media)} media files referenced")


if __name__ == "__main__":
    main()
