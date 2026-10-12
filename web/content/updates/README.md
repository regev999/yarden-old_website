# Page redesigns (content updates)

Each redesigned page is two files here:

- `<id>.json`: `{ "id", "path", "file": "<id>.body.html", "contact": true, "description" }`
- `<id>.body.html`: the new `<main>` content of the page (without the contact section when `contact` is true; it is appended from `content/contact.html`).

`scripts/migrate.mjs` applies each update once (it runs on every start/build). The page as it was is saved to the revisions table, so it can be restored from the admin.
Use the id format `2026-09-<latin-slug>`.

With `"title"` (and optionally `"seo_title"`) the update renames the page, and if no page exists at `path` yet it creates one there (a new page, linked from the menu in `lib/shell.js` if it belongs there).

An update can also carry no body and only point search engines elsewhere:
`{ "id", "path", "canonical": "/other-page/" }` for a page that repeats another one,
or `{ "id", "path", "duplicate_of": "/original/" }` for an old post that does.
`{ "id", "path": "/", "products": [{ slug, title, description, price (₪), max_payments, page_path, position, active }] }` adds shop products once (an existing slug is left as edited in the admin; `was_title` corrects a product still named as an earlier update made it).
`{ "id", "path": "/", "products_off": [slug, …] }` takes products off sale (switched back on from the admin).
`{ "id", "path", "replace": [[from, to], …] }` makes exact replacements in the page as it is now, so edits made in the admin stay.
`{ "id", "path", "retire": "/other-page/" }` takes a page or post off the site: its address redirects (301) to the other page, and it leaves the sitemap and the blog (the content stays in the admin: a page as hidden from search, a post as a draft).
A `replace`/`remove` update can also set the page's `"description"`.
`{ "id", "path", "remove": [text, [from, through], …] }` removes an exact text, or everything from `from` up to and including the next `through` (a whole card or section, even if its inside was edited in the admin).

Preview one update locally: `DATABASE_URL=... ONLY_UPDATE=<id> node scripts/migrate.mjs`.

## The brief

The site belongs to Yarden Kerem, a somatic therapist (Focusing, Hakomi, Somatic Experiencing, video and photo therapy) who also runs courses. Visitors are people looking for therapy, often around trauma, and students looking for courses. The old pages are WordPress walls of text: repeated paragraphs, "לחץ כאן" links, several forms, no structure.

Redesign each page so it is easy to scan and pleasant to read, using the components below. The words are Yarden's: keep every fact, name, number, link and video, keep her first-person voice, and do not invent anything (no new claims, prices, dates or quotes). You may:

- reorder content so the page answers, in order: what is this, who is it for, how does it work, what's it like / proof (videos, testimonials, press), how to start;
- remove duplicated paragraphs (the old pages often repeat the intro), and drop "לחץ כאן" wording;
- split long paragraphs, shorten wordy sentences and fix typos, as long as the meaning stays;
- write short headings and a one-sentence hero subtitle drawn from the page's own text;
- move long secondary text (history, definitions, detailed theory) into `<details class="model">` so it opens on request.

Hebrew style: plain, warm, direct. Sentence case. No exclamation marks unless in a quote. Don't prefix headings with "א." "ב.". No ALL CAPS labels, no decorative eyebrows above headings.

## Page skeleton

```html
<header class="page-hero"><div class="wrap">
<h1>Title</h1>
<p class="page-hero__sub">One sentence that says what this is and for whom.</p>
<!-- optional: <div class="actions"><a class="btn btn--paper" href="#contact">קביעת פגישה</a></div> -->
</div></header>

<section class="block" id="short-latin-id"><div class="wrap"> ... </div></section>
<section class="block block--tint" id="..."><div class="wrap"> ... </div></section>
...
```

- Alternate plain `block` and `block--tint` sections for rhythm. Every section starts with `<h2 class="heading">`. Pages with 3+ sections get an automatic sticky contents bar built from those headings, so make them short (2–4 words).
- Keep sections to one idea each. Aim for 4–8 sections on a long page, 2–4 on a short one.
- Do not add a contact form: set `"contact": true` in the json and the standard one is appended. Remove the old form sections.
- Keep `<!--yk:NAME-->...<!--/yk:NAME-->` markers exactly if the original page has them (they are live lists filled by the server).

## Components (all styled in `public/assets/style.css`)

Heading + text side by side (good for an intro):
```html
<div class="split"><h2 class="heading">מה זה</h2><div class="prose prose--lead"><p>…</p></div></div>
```
Plain text: `<div class="prose"><p>…</p><ul><li>…</li></ul><blockquote><p>…</p></blockquote></div>` (keep under ~1400 characters per block; longer ones collapse behind "להמשך קריאה" automatically).

Lead line under a heading: `<p class="section-intro">…</p>`

Parallel ideas (3–6 items, not a sequence):
```html
<ul class="facets"><li><h3>Title</h3><p>One or two sentences.</p></li>…</ul>
```
A real sequence (process, stages): `<ol class="steps"><li><h3>…</h3><p>…</p></li>…</ol>`

Dates or a career path: `<ol class="timeline"><li><span class="timeline__when">2010</span><p>…</p></li>…</ol>`

Expandable items with a summary (models, approaches, FAQs, long theory):
```html
<div class="models">
<details class="model"><summary><span class="model__head"><h3>Title</h3><span class="model__sum">One-line summary.</span></span></summary>
<div class="prose"><p>Full text…</p></div></details>
</div>
```
Many short expandable items (people, FAQs): `<div class="models models--grid">` lays them out in two columns.

Short tags (issues a therapy helps with, audiences): `<ul class="chips"><li>חרדה</li>…</ul>`

A few true numbers from the text: `<ul class="stats"><li><b>50</b><span>קבוצות וידאו תרפיה</span></li>…</ul>`

One sentence that matters (a motto or a key quote): `<blockquote class="callout">…<cite>שם</cite></blockquote>`

Courses / services with facts:
```html
<div class="offers"><article class="offer"><h3>…</h3><p>…</p><dl><dt>מתי</dt><dd>…</dd><dt>איפה</dt><dd>…</dd></dl><a class="btn" href="#contact">להרשמה</a></article>…</div>
```
Links (articles, interviews, videos elsewhere, other pages) – always as cards that say where they lead:
```html
<ul class="linkcards">
<li><a class="linkcard linkcard--video" href="https://www.youtube.com/watch?v=…" target="_blank" rel="noopener"><span class="linkcard__icon" aria-hidden="true"></span><span class="linkcard__title">What it is</span><span class="linkcard__where">סרטון ביוטיוב</span></a></li>
<li><a class="linkcard linkcard--article" href="https://…" target="_blank" rel="noopener">…<span class="linkcard__where">ynet</span></a></li>
<li><a class="linkcard linkcard--read" href="/internal-page/">…<span class="linkcard__where">באתר</span></a></li>
</ul>
```
Embedded YouTube (keep the exact markup; `data-yt` is the video id):
```html
<div class="video" data-yt="ID"><button type="button" class="video__play" aria-label="הפעלת סרטון: Title" style="background-image:url(https://i.ytimg.com/vi/ID/hqdefault.jpg)"><span class="video__icon" aria-hidden="true"></span></button></div>
```
Several videos with captions: `<div class="films"><figure class="film">VIDEO<figcaption><h3>…</h3><p>…</p></figcaption></figure>…</div>`

Also available: `.cols.cols-2|3` with `.col`, `.card`, `.quotes`/`.quote` (testimonials), `.figure` (images), `.gallery`, `.actions` + `.btn`, `.btn--line`.

See `2026-09-video-therapy.body.html` for a finished example.
