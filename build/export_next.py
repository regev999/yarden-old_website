#!/usr/bin/env python3
"""Export the built static site into the data files the Next.js app seeds from.

    python3 build/build.py && python3 build/export_next.py

Writes web/content/*.json and copies the public assets to web/public/.
Each page keeps its exact <main> HTML and head metadata, so the Next.js
site renders byte-for-byte the same content, titles and canonicals.
"""
import json
import pathlib
import re
import shutil
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
SEED = SITE / "admin" / "_lib" / "seed"
WEB = ROOT / "web"
OUT = WEB / "content"


def meta(html, pattern):
    m = re.search(pattern, html, re.S)
    return m.group(1) if m else ""


def unescape(s):
    import html as h
    return h.unescape(s)


def page_record(path, html, kind):
    main = meta(html, r'<main id="main">\s*(.*?)\s*</main>')
    ld = meta(html, r'<script type="application/ld\+json">(.*?)</script>')
    canonical = meta(html, r'<link rel="canonical" href="([^"]+)"')
    canon_path = urllib.parse.unquote(urllib.parse.urlsplit(canonical).path) if canonical else path
    return {
        "path": path,
        "kind": kind,
        "title": unescape(meta(html, r'<meta property="og:title" content="([^"]*)"')),
        "seo_title": unescape(meta(html, r"<title>(.*?)</title>")),
        "description": unescape(meta(html, r'<meta name="description" content="([^"]*)"')),
        "og_type": meta(html, r'<meta property="og:type" content="([^"]*)"') or "website",
        "og_image": meta(html, r'<meta property="og:image" content="([^"]*)"'),
        "canonical": canon_path if canon_path != path else None,
        "noindex": 'name="robots" content="noindex' in html,
        "ld": json.loads(ld) if ld else None,
        "main": main,
    }


def sitemap_paths(name):
    xml = (SITE / f"{name}-sitemap.xml").read_text(encoding="utf-8")
    return [urllib.parse.unquote(urllib.parse.urlsplit(u).path) for u in re.findall(r"<loc>([^<]+)</loc>", xml)]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    posts = json.loads((SEED / "posts.json").read_text(encoding="utf-8"))
    post_paths = {p["path"] for p in posts}

    pages = []
    for kind, name in (("page", "page"), ("category", "category"), ("tag", "post_tag")):
        for path in sitemap_paths(name):
            f = SITE / "index.html" if path == "/" else SITE / path.strip("/") / "index.html"
            pages.append(page_record(path, f.read_text(encoding="utf-8"), kind))
    # 404 page body
    pages.append(page_record("/404/", (SITE / "404.html").read_text(encoding="utf-8"), "system"))

    # Posts keep their fields (for the editor) plus the exact head data of the migrated page.
    for p in posts:
        f = SITE / p["path"].strip("/") / "index.html"
        rec = page_record(p["path"], f.read_text(encoding="utf-8"), "post")
        p["seo_title"] = rec["seo_title"]
        p["description"] = rec["description"]
        p["og_image"] = rec["og_image"]

    (OUT / "pages.json").write_text(json.dumps(pages, ensure_ascii=False), encoding="utf-8")
    (OUT / "posts.json").write_text(json.dumps(posts, ensure_ascii=False), encoding="utf-8")
    for name in ("testimonials", "categories", "tags", "redirects"):
        shutil.copy(SEED / f"{name}.json", OUT / f"{name}.json")
    (OUT / "contact.html").write_text((SEED / "contact.html").read_text(encoding="utf-8"), encoding="utf-8")
    (OUT / "media-needed.txt").write_text((ROOT / "data" / "media-needed.txt").read_text(encoding="utf-8"), encoding="utf-8")

    # Static assets used by the site (style, scripts, fonts, icon).
    pub = WEB / "public" / "assets"
    if pub.exists():
        shutil.rmtree(pub)
    shutil.copytree(ROOT / "build" / "assets", pub)
    print(f"exported {len(pages)} pages, {len(posts)} posts to {OUT.relative_to(ROOT)}")
    assert not (post_paths & {p["path"] for p in pages}), "a post and a page share a path"


if __name__ == "__main__":
    main()
