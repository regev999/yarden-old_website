#!/usr/bin/env python3
"""Extract the public content of the WordPress export into data/content.json.

The raw export (data/wordpress-export.xml) is not committed: it contains
comment authors' emails/IPs and other private data. This script keeps only
what the public site needs.
"""
import json
import re
import pathlib
import urllib.parse
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "wordpress-export.xml"
OUT = ROOT / "data" / "content.json"

NS = {
    "wp": "http://wordpress.org/export/1.2/",
    "content": "http://purl.org/rss/1.0/modules/content/",
    "excerpt": "http://wordpress.org/export/1.2/excerpt/",
}
PUBLIC_EMAIL = "yardenkerem@gmail.com"
KEEP_TYPES = {"post", "page", "attachment", "nav_menu_item", "elementor_library", "elementor-hf"}
KEEP_META = {
    "_elementor_data", "_thumbnail_id", "_wp_page_template", "_wp_attached_file",
    "_menu_item_object_id", "_menu_item_menu_item_parent", "_menu_item_url",
    "_menu_item_type", "_menu_item_object", "_yoast_wpseo_metadesc", "_yoast_wpseo_title",
}


def text(el, path):
    return el.findtext(path, namespaces=NS) or ""


def main():
    channel = ET.parse(SRC).getroot().find("channel")
    data = {
        "site": {
            "title": text(channel, "title").strip(),
            "description": text(channel, "description").strip(),
            "link": text(channel, "link").strip(),
        },
        "categories": [
            {
                "id": int(text(c, "wp:term_id")),
                "slug": urllib.parse.unquote(text(c, "wp:category_nicename")),
                "name": text(c, "wp:cat_name"),
            }
            for c in channel.findall("wp:category", NS)
        ],
        "tags": [
            {
                "id": int(text(t, "wp:term_id")),
                "slug": urllib.parse.unquote(text(t, "wp:tag_slug")),
                "name": text(t, "wp:tag_name"),
            }
            for t in channel.findall("wp:tag", NS)
        ],
        "items": [],
    }
    for it in channel.findall("item"):
        ptype = text(it, "wp:post_type")
        if ptype not in KEEP_TYPES:
            continue
        meta = {
            text(m, "wp:meta_key"): text(m, "wp:meta_value")
            for m in it.findall("wp:postmeta", NS)
            if text(m, "wp:meta_key") in KEEP_META
        }
        if "_elementor_data" in meta:
            # Old form settings carry third-party addresses; keep only the public one.
            meta["_elementor_data"] = re.sub(
                r"[\w.+-]+@[\w-]+\.[\w.]+",
                lambda m: m.group(0) if m.group(0) == PUBLIC_EMAIL else "",
                meta["_elementor_data"],
            )
        data["items"].append({
            "id": int(text(it, "wp:post_id")),
            "type": ptype,
            "status": text(it, "wp:status"),
            "title": it.findtext("title") or "",
            "slug": urllib.parse.unquote(text(it, "wp:post_name")),
            "date": text(it, "wp:post_date"),
            "modified": text(it, "wp:post_modified"),
            "parent": int(text(it, "wp:post_parent") or 0),
            "menu_order": int(text(it, "wp:menu_order") or 0),
            "content": text(it, "content:encoded"),
            "excerpt": text(it, "excerpt:encoded"),
            "attachment_url": text(it, "wp:attachment_url"),
            "terms": [
                {"domain": c.get("domain"), "slug": urllib.parse.unquote(c.get("nicename") or ""), "name": c.text}
                for c in it.findall("category")
            ],
            "meta": meta,
        })
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {OUT} ({len(data['items'])} items)")


if __name__ == "__main__":
    main()
