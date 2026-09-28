<?php
/**
 * Content engine: posts, testimonials, revisions, activity log, and the
 * functions that turn them into the site's static HTML files.
 *
 * After launch the server is the source of truth. The Python build only
 * produced the first version of the site and the seed files in _lib/seed/.
 */
declare(strict_types=1);

const SITE_TITLE_SUFFIX = ' - ירדן כרם - התמקדות, הקומי, Somatic Experiencing';
const RESERVED_SLUGS = ['admin', 'api', 'assets', 'wp-content', 'category', 'tag', 'feed', 'page', 'author', 'wp-admin'];

/* ------------------------------------------------------------------ schema */

function content_migrate(): void
{
    static $done = false;
    if ($done) return;
    $done = true;
    db()->exec(<<<SQL
    CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        excerpt TEXT NOT NULL DEFAULT '',
        seo_title TEXT NOT NULL DEFAULT '',
        categories TEXT NOT NULL DEFAULT '[]',
        tags TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'published',
        is_video INTEGER NOT NULL DEFAULT 0,
        duplicate_of TEXT,
        wp_id INTEGER,
        format TEXT NOT NULL DEFAULT 'legacy',   -- legacy: body is final HTML from the migration; rich: editor HTML
        date TEXT NOT NULL,
        modified TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS terms (
        slug TEXT NOT NULL,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        PRIMARY KEY (kind, slug)
    );
    CREATE TABLE IF NOT EXISTS testimonials (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL,
        show_on_home INTEGER NOT NULL DEFAULT 0,
        published INTEGER NOT NULL DEFAULT 1,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS revisions (
        id INTEGER PRIMARY KEY,
        path TEXT NOT NULL,
        html BLOB NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        user TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS revisions_path ON revisions(path, id);
    CREATE TABLE IF NOT EXISTS activity (
        id INTEGER PRIMARY KEY,
        user TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT NOT NULL DEFAULT '',
        link TEXT NOT NULL DEFAULT '',
        at TEXT NOT NULL
    );
    SQL);
    content_seed();
}

/** First run: import the posts, terms and testimonials the build exported. */
function content_seed(): void
{
    if (setting('seeded') === '1') return;
    $dir = __DIR__ . '/seed';
    if (!is_dir($dir)) return;
    $read = fn($f) => json_decode((string)@file_get_contents("$dir/$f.json"), true) ?: [];
    $pdo = db();
    $pdo->beginTransaction();
    $st = $pdo->prepare('INSERT OR IGNORE INTO posts(path, title, body, excerpt, categories, tags, is_video, duplicate_of, wp_id, date, modified)
                         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    foreach ($read('posts') as $p) {
        $st->execute([$p['path'], $p['title'], $p['body'], $p['excerpt'], json_encode($p['categories'], JSON_UNESCAPED_UNICODE),
                      json_encode($p['tags'], JSON_UNESCAPED_UNICODE), $p['is_video'] ? 1 : 0, $p['duplicate_of'], $p['wp_id'],
                      $p['date'], $p['modified']]);
    }
    $st = $pdo->prepare('INSERT OR IGNORE INTO terms(slug, kind, name) VALUES(?, ?, ?)');
    foreach ($read('categories') as $c) $st->execute([$c['slug'], 'category', $c['name']]);
    foreach ($read('tags') as $t) $st->execute([$t['slug'], 'tag', $t['name']]);
    if ((int)$pdo->query('SELECT COUNT(*) FROM testimonials')->fetchColumn() === 0) {
        $st = $pdo->prepare('INSERT INTO testimonials(name, role, body, show_on_home, position, created_at) VALUES(?, ?, ?, ?, ?, ?)');
        foreach ($read('testimonials') as $t) {
            $st->execute([$t['name'], $t['role'], $t['body'], $t['show_on_home'] ? 1 : 0, $t['position'], now()]);
        }
    }
    set_setting('seeded', '1');
    $pdo->commit();
}

/* ---------------------------------------------------------------- activity */

function log_activity(string $action, string $target = '', string $link = ''): void
{
    $u = current_user();
    db()->prepare('INSERT INTO activity(user, action, target, link, at) VALUES(?, ?, ?, ?, ?)')
        ->execute([$u['username'] ?? 'system', $action, $target, $link, now()]);
}

/* ------------------------------------------------------- files + revisions */

function public_file(string $path): string
{
    if (!str_starts_with($path, '/') || str_contains($path, '..') || str_contains($path, "\0")) {
        throw new InvalidArgumentException('bad path');
    }
    return site_root() . ($path === '/' ? '/index.html' : rtrim($path, '/') . '/index.html');
}

/** Write a public page, keeping the previous version as a revision. */
function write_page(string $path, string $html, string $note): void
{
    $file = public_file($path);
    if (is_file($file)) {
        $old = (string)file_get_contents($file);
        if ($old === $html) return;
        $u = current_user();
        db()->prepare('INSERT INTO revisions(path, html, note, user, created_at) VALUES(?, ?, ?, ?, ?)')
            ->execute([$path, gzcompress($old, 6), $note, $u['username'] ?? '', now()]);
        // Keep the 25 most recent versions per page.
        db()->prepare('DELETE FROM revisions WHERE path = ? AND id NOT IN (SELECT id FROM revisions WHERE path = ? ORDER BY id DESC LIMIT 25)')
            ->execute([$path, $path]);
    } elseif (!is_dir(dirname($file)) && !mkdir(dirname($file), 0755, true)) {
        throw new RuntimeException('cannot create folder');
    }
    $tmp = $file . '.tmp' . bin2hex(random_bytes(3));
    if (file_put_contents($tmp, $html) === false || !rename($tmp, $file)) {
        @unlink($tmp);
        throw new RuntimeException('cannot write ' . $path);
    }
}

function write_text_file(string $name, string $content): void
{
    $f = site_root() . '/' . $name;
    $tmp = $f . '.tmp';
    file_put_contents($tmp, $content);
    rename($tmp, $f);
}

function revisions_for(string $path): array
{
    $st = db()->prepare('SELECT id, note, user, created_at, LENGTH(html) AS size FROM revisions WHERE path = ? ORDER BY id DESC');
    $st->execute([$path]);
    return $st->fetchAll();
}

function restore_revision(int $id): ?string
{
    $st = db()->prepare('SELECT path, html FROM revisions WHERE id = ?');
    $st->execute([$id]);
    $r = $st->fetch();
    if (!$r) return null;
    write_page($r['path'], gzuncompress($r['html']), 'לפני שחזור גרסה');
    return $r['path'];
}

/* ------------------------------------------------------------------ helpers */

function enc_path(string $path): string
{
    $parts = array_map('rawurlencode', explode('/', $path));
    return preg_replace_callback('/%[0-9A-F]{2}/', fn($m) => strtolower($m[0]), implode('/', $parts));
}

function site_url(): string
{
    return rtrim((string)cfg('site_url'), '/');
}

function he_long_date(string $d): string
{
    $months = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
    $t = strtotime($d);
    return (int)date('j', $t) . ' ב' . $months[(int)date('n', $t) - 1] . ' ' . date('Y', $t);
}

function plain(string $html, int $limit = 0): string
{
    $t = html_entity_decode(strip_tags(preg_replace('/<(br|\/p|\/li|\/h\d)>/i', ' ', $html)), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $t = trim(preg_replace('/\s+/u', ' ', preg_replace('#https?://\S+#', '', $t)));
    if ($limit && mb_strlen($t) > $limit) {
        $cut = mb_substr($t, 0, $limit);
        $sp = mb_strrpos($cut, ' ');
        return ($sp ? mb_substr($cut, 0, $sp) : $cut) . '…';
    }
    return $t;
}

/** Turn a title into a URL slug the way WordPress did for Hebrew titles. */
function make_slug(string $title): string
{
    $s = mb_strtolower(trim($title));
    $s = str_replace(['"', "'", '״', '׳', '`'], '', $s);
    $s = preg_replace('/[^\p{L}\p{N}]+/u', '-', $s);
    $s = trim(mb_substr(trim($s, '-'), 0, 70), '-');
    return $s !== '' ? $s : 'post';
}

function unique_path(string $slug, ?int $ignoreId = null): string
{
    if (in_array($slug, RESERVED_SLUGS, true)) $slug .= '-post';
    $n = 1;
    $base = $slug;
    while (true) {
        $path = '/' . $slug . '/';
        $st = db()->prepare('SELECT id FROM posts WHERE path = ?');
        $st->execute([$path]);
        $id = $st->fetchColumn();
        $taken = ($id !== false && (int)$id !== $ignoreId) || ($id === false && is_file(public_file($path)));
        if (!$taken) return $path;
        $slug = $base . '-' . (++$n);
    }
}

function youtube_id(string $s): ?string
{
    return preg_match('~(?:youtube(?:-nocookie)?\.com/(?:watch\?(?:[^\s"\'<]*&(?:amp;)?)?v=|embed/|shorts/|live/)|youtu\.be/)([\w-]{11})~', $s, $m) ? $m[1] : null;
}

function video_embed(string $id, string $title = ''): string
{
    $label = e($title ?: 'סרטון');
    return '<div class="video" data-yt="' . e($id) . '"><button type="button" class="video__play" aria-label="הפעלת סרטון: ' . $label
        . '" style="background-image:url(https://i.ytimg.com/vi/' . e($id) . '/hqdefault.jpg)"><span class="video__icon" aria-hidden="true"></span></button></div>';
}

/* --------------------------------------------------------------- sanitizer */

/**
 * Clean HTML coming from the editor: keep a small set of semantic tags,
 * drop styles and scripts, turn YouTube links on their own line into embeds.
 */
function sanitize_html(string $html, bool $inline = false): string
{
    // Video embeds come back from the editor as a marker paragraph.
    $html = preg_replace_callback('#<div class="video" data-yt="([\w-]{11})".*?</div>#s', fn($m) => '<p>https://youtu.be/' . $m[1] . '</p>', $html);
    $allowed = $inline
        ? ['strong' => [], 'b' => [], 'em' => [], 'i' => [], 'u' => [], 'a' => ['href'], 'br' => []]
        : ['p' => ['dir'], 'br' => [], 'strong' => [], 'b' => [], 'em' => [], 'i' => [], 'u' => [], 'a' => ['href'],
           'ul' => [], 'ol' => [], 'li' => ['dir'], 'h2' => ['dir'], 'h3' => ['dir'], 'h4' => ['dir'], 'blockquote' => [],
           'img' => ['src', 'alt'], 'figure' => [], 'figcaption' => [], 'hr' => [], 'table' => [], 'thead' => [],
           'tbody' => [], 'tr' => [], 'td' => ['colspan', 'rowspan'], 'th' => ['colspan', 'rowspan'], 'sup' => [], 'sub' => []];
    $rename = ['h1' => 'h2', 'h5' => 'h4', 'h6' => 'h4'];
    // Site classes that may stay on edited content (anything else is dropped).
    $safeClasses = ['plain-list', 'issue-list', 'vision', 'epigraph', 'more', 'quiet', 'lead', 'ticks', 'tags', 'card__link', 'btn', 'btn--line', 'btn--quiet', 'btn-row'];
    if (!$inline) { $allowed['cite'] = []; }
    $drop = ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'svg', 'math', 'template', 'noscript'];

    $doc = new DOMDocument();
    libxml_use_internal_errors(true);
    $doc->loadHTML('<?xml encoding="UTF-8"><div id="yk-root">' . $html . '</div>', LIBXML_NONET | LIBXML_HTML_NODEFDTD | LIBXML_HTML_NOIMPLIED);
    libxml_clear_errors();
    $root = $doc->getElementById('yk-root');
    if (!$root) return '';

    $out = '';
    $walk = function (DOMNode $node) use (&$walk, $allowed, $rename, $drop, $inline, $safeClasses): string {
        $s = '';
        foreach ($node->childNodes as $c) {
            if ($c instanceof DOMText) {
                $s .= htmlspecialchars($c->nodeValue, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                continue;
            }
            if (!$c instanceof DOMElement) continue;
            $tag = strtolower($c->nodeName);
            if (in_array($tag, $drop, true)) continue;
            $tag = $rename[$tag] ?? $tag;
            $cls = array_values(array_intersect(preg_split('/\s+/', trim($c->getAttribute('class'))), $safeClasses));
            if ($tag === 'div') $tag = ($cls && !$inline) ? 'div' : 'p';
            if ($inline && in_array($tag, ['p', 'div'], true)) { $s .= $walk($c) . ' '; continue; }
            if ($tag === 'div') { $s .= '<div class="' . e(implode(' ', $cls)) . '">' . $walk($c) . '</div>'; continue; }
            if (!isset($allowed[$tag])) { $s .= $walk($c); continue; }
            $attrs = '';
            foreach ($allowed[$tag] as $a) {
                if (!$c->hasAttribute($a)) continue;
                $v = trim($c->getAttribute($a));
                if (in_array($a, ['href', 'src'], true)) {
                    if (!preg_match('#^(https?://|/|mailto:|tel:|\#)#i', $v)) continue;   // no javascript: etc.
                }
                if ($a === 'dir' && $v !== 'ltr') continue;
                $attrs .= ' ' . $a . '="' . htmlspecialchars($v, ENT_QUOTES, 'UTF-8') . '"';
            }
            if ($tag === 'a' && preg_match('#^https?://#i', $c->getAttribute('href')) && !str_contains($c->getAttribute('href'), parse_url(site_url(), PHP_URL_HOST))) {
                $attrs .= ' target="_blank" rel="noopener"';
            }
            if ($tag === 'img') $attrs .= ' loading="lazy" decoding="async"';
            if ($cls && in_array($tag, ['p', 'ul', 'ol', 'a', 'blockquote'], true)) $attrs .= ' class="' . e(implode(' ', $cls)) . '"';
            if (in_array($tag, ['br', 'img', 'hr'], true)) { $s .= "<$tag$attrs>"; continue; }
            $s .= "<$tag$attrs>" . $walk($c) . "</$tag>";
        }
        return $s;
    };
    $out = $walk($root);

    if (!$inline) {
        // A paragraph holding only a YouTube link becomes a player.
        $out = preg_replace_callback('#<p[^>]*>\s*(?:<a [^>]*>)?\s*(https?://[^\s<]+)\s*(?:</a>)?\s*</p>#u', function ($m) {
            $id = youtube_id($m[1]);
            return $id ? video_embed($id) : $m[0];
        }, $out);
        $out = preg_replace('~<(p|h2|h3|h4|li)(?: [^>]*)?>(?:\s|&nbsp;|&#160;|<br>)*</\1>~u', '', $out);
    }
    return trim(preg_replace('/(<br>\s*){3,}/', '<br><br>', $out));
}

/** Editor-friendly form of stored HTML: players become plain YouTube links, layout wrappers go. */
function html_for_editor(string $html): string
{
    $html = preg_replace_callback('#<div class="video" data-yt="([\w-]{11})".*?</div>#s',
        fn($m) => '<p>https://youtu.be/' . $m[1] . '</p>', $html);
    $html = preg_replace('#</?(div|section|article|figure)\b[^>]*>#', '', $html);
    return sanitize_html($html);
}

/* ---------------------------------------------------------------- queries */

function post_row(array $r): array
{
    $r['categories'] = json_decode($r['categories'], true) ?: [];
    $r['tags'] = json_decode($r['tags'], true) ?: [];
    return $r;
}

/** Published posts shown in lists (duplicates stay online but are not listed). */
function listed_posts(?string $category = null, ?string $tag = null): array
{
    $rows = db()->query("SELECT * FROM posts WHERE status = 'published' AND duplicate_of IS NULL ORDER BY date DESC")->fetchAll();
    $rows = array_map('post_row', $rows);
    if ($category !== null) $rows = array_values(array_filter($rows, fn($p) => in_array($category, $p['categories'], true)));
    if ($tag !== null) $rows = array_values(array_filter($rows, fn($p) => in_array($tag, $p['tags'], true)));
    return $rows;
}

function terms(string $kind): array
{
    $st = db()->prepare('SELECT slug, name FROM terms WHERE kind = ? ORDER BY name');
    $st->execute([$kind]);
    return array_column($st->fetchAll(), 'name', 'slug');
}

/* ---------------------------------------------------------------- render */

function entries_html(array $posts, bool $single = false): string
{
    if (!$posts) return '';
    $rows = '';
    foreach ($posts as $p) {
        $ex = $p['excerpt'] !== '' ? mb_substr($p['excerpt'], 0, 141) : plain($p['body'], 140);
        if (mb_strlen($ex) > 140) $ex = plain($ex, 140);
        $meta = he_long_date($p['date']) . ($p['is_video'] && mb_strlen($ex) < 40 ? ' · סרטון' : '');
        $rows .= '<li><a href="' . e($p['path']) . '"><h3>' . e($p['title']) . '</h3>'
            . ($ex !== '' ? '<p>' . e($ex) . '</p>' : '') . '<small>' . e($meta) . '</small></a></li>';
    }
    return '<ul class="entries' . ($single ? ' entries--single' : '') . '">' . $rows . '</ul>';
}

function render_shell(array $o): string
{
    $shell = (string)file_get_contents(__DIR__ . '/seed/shell.html');
    $ld = $o['ld'] ?? null;
    $map = [
        '__YK_SEOTITLE__' => e($o['seo_title']),
        '__YK_TITLE__' => e($o['title']),
        '__YK_DESC__' => e($o['description']),
        '__YK_URL__' => site_url() . enc_path($o['path']),
        '__YK_OGTYPE__' => $o['og_type'] ?? 'article',
        '__YK_OGLINE__' => !empty($o['og_image']) ? '<meta property="og:image" content="' . e($o['og_image']) . '">' : '',
        '__YK_LDSCRIPT__' => $ld ? '<script type="application/ld+json">' . json_encode($ld, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . '</script>' : '',
        '__YK_BODY__' => $o['body'],
    ];
    return strtr($shell, $map);
}

function contact_html(): string
{
    return (string)file_get_contents(__DIR__ . '/seed/contact.html');
}

function render_post_page(array $p): string
{
    $cats = terms('category');
    $tagNames = terms('tag');
    $catLinks = implode(', ', array_map(fn($s) => '<a href="/category/' . e($s) . '/">' . e($cats[$s] ?? $s) . '</a>', $p['categories']));
    $tagHtml = implode('', array_map(fn($s) => '<a href="/tag/' . e($s) . '/">' . e($tagNames[$s] ?? $s) . '</a>', $p['tags']));
    $related = [];
    foreach (listed_posts() as $o) {
        if ($o['path'] === $p['path'] || $o['path'] === $p['duplicate_of']) continue;
        if (array_intersect($o['categories'], $p['categories'])) $related[] = $o;
        if (count($related) === 3) break;
    }
    $hero = '<header class="page-hero"><div class="wrap"><p class="crumb">' . ($catLinks ? $catLinks . ', ' : '')
        . '<time datetime="' . e(substr($p['date'], 0, 10)) . '">' . e(he_long_date($p['date'])) . '</time></p><h1>' . e($p['title']) . '</h1></div></header>';
    $content = ($p['format'] ?? 'legacy') === 'rich' ? '<div class="prose">' . $p['body'] . '</div>' : $p['body'];
    $body = $hero . "\n<article class=\"block article\">\n  <div class=\"wrap\">\n    " . $content . "\n    "
        . ($tagHtml ? '<p class="tags">' . $tagHtml . '</p>' : '') . "\n  </div>\n</article>\n"
        . ($related ? '<section class="block block--tint"><div class="wrap"><h2 class="heading">עוד באותו נושא</h2>' . entries_html($related) . '</div></section>' : '')
        . "\n" . contact_html();
    $desc = $p['excerpt'] !== '' ? $p['excerpt'] : plain($p['body'], 155);
    return render_shell([
        'path' => $p['path'],
        'title' => $p['title'],
        'seo_title' => $p['seo_title'] !== '' ? $p['seo_title'] : $p['title'] . SITE_TITLE_SUFFIX,
        'description' => $desc,
        'body' => $body,
        'og_image' => preg_match('#<img[^>]+src="(/[^"]+)"#', $p['body'], $m) ? site_url() . enc_path(rawurldecode($m[1])) : '',
        'ld' => [
            '@context' => 'https://schema.org', '@type' => 'BlogPosting', 'headline' => $p['title'],
            'datePublished' => str_replace(' ', 'T', $p['date']), 'dateModified' => str_replace(' ', 'T', $p['modified']),
            'author' => ['@type' => 'Person', 'name' => 'ירדן כרם'], 'inLanguage' => 'he',
            'mainEntityOfPage' => site_url() . enc_path($p['path']),
        ],
    ]);
}

function render_archive_page(string $path, string $name, string $kindLabel, array $posts): string
{
    $hero = '<header class="page-hero"><div class="wrap"><p class="crumb">' . e($kindLabel) . '</p><h1>' . e($name) . '</h1></div></header>';
    $body = $hero . '<section class="block"><div class="wrap"><!--yk:list-->' . (entries_html($posts) ?: '<p>אין כאן עדיין פרסומים.</p>')
        . '<!--/yk:list--></div></section>' . contact_html();
    return render_shell([
        'path' => $path, 'title' => $name, 'seo_title' => $name . ' Archives' . SITE_TITLE_SUFFIX,
        'description' => "$kindLabel: $name – ירדן כרם", 'body' => $body, 'og_type' => 'website',
    ]);
}

/** Replace the content between <!--yk:NAME--> markers in a public page. */
function replace_region(string $path, string $name, string $inner, string $note): bool
{
    $file = public_file($path);
    if (!is_file($file)) return false;
    $html = (string)file_get_contents($file);
    $re = '#(<!--yk:' . preg_quote($name, '#') . '-->).*?(<!--/yk:' . preg_quote($name, '#') . '-->)#s';
    if (!preg_match($re, $html)) return false;
    $new = preg_replace_callback($re, fn($m) => $m[1] . $inner . $m[2], $html, 1);
    write_page($path, $new, $note);
    return true;
}

/* ------------------------------------------------------ site-wide refresh */

/** Rebuild every list that shows posts, plus the sitemap and RSS feed. */
function refresh_listings(): void
{
    $all = listed_posts();
    $cats = terms('category');

    // Blog index: topic links + posts by year.
    $nav = '';
    foreach ($cats as $slug => $name) {
        $n = count(listed_posts($slug));
        if ($n) $nav .= '<li><a href="/category/' . e($slug) . '/">' . e($name) . '</a> <span class="quiet">' . $n . '</span></li>';
    }
    $years = [];
    foreach ($all as $p) $years[substr($p['date'], 0, 4)][] = $p;
    $blocks = '';
    foreach ($years as $y => $ps) $blocks .= '<section class="year"><h2>' . e((string)$y) . '</h2>' . entries_html($ps) . '</section>';
    replace_region('/בלוג/', 'blog', '<nav class="topic-nav" aria-label="נושאים"><ul>' . $nav . '</ul></nav>' . $blocks, 'עדכון רשימת הבלוג');
    replace_region('/בלוג/', 'count', (string)count($all), 'עדכון מספר הפוסטים');

    // Category and tag archives (new terms get a new page).
    foreach ($cats as $slug => $name) {
        $path = '/category/' . $slug . '/';
        $posts = listed_posts($slug);
        if (!replace_region($path, 'list', entries_html($posts) ?: '<p>אין כאן עדיין פרסומים.</p>', 'עדכון רשימה')) {
            write_page($path, render_archive_page($path, $name, 'קטגוריה', $posts), 'יצירת עמוד קטגוריה');
        }
    }
    foreach (terms('tag') as $slug => $name) {
        $posts = listed_posts(null, $slug);
        if (!$posts) continue;
        $path = '/tag/' . $slug . '/';
        if (!replace_region($path, 'list', entries_html($posts), 'עדכון רשימה')) {
            write_page($path, render_archive_page($path, $name, 'תגית', $posts), 'יצירת עמוד תגית');
        }
    }

    // Home page: latest long essays.
    $essays = array_values(array_filter(listed_posts(), fn($p) => array_intersect($p['categories'], ['מאמרים-שאני-כתבתי', 'מאמרים-שלי-בנושא-טיפול-בטראומה', 'מאמרים-שלי-בנושאים-כלליים'])
        && mb_strlen(plain($p['body'])) > 1500));
    replace_region('/', 'essays', entries_html(array_slice($essays, 0, 5), true), 'עדכון מאמרים בדף הבית');

    refresh_post_sitemap();
    refresh_feed();
}

function refresh_post_sitemap(): void
{
    $rows = db()->query("SELECT path, modified FROM posts WHERE status = 'published' ORDER BY date DESC")->fetchAll();
    $xml = '<?xml version="1.0" encoding="UTF-8"?>' . "\n" . '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
    foreach ($rows as $r) {
        $xml .= '<url><loc>' . e(site_url() . enc_path($r['path'])) . '</loc><lastmod>' . e(substr($r['modified'], 0, 10)) . '</lastmod></url>';
    }
    write_text_file('post-sitemap.xml', $xml . "</urlset>\n");
    // Tag archives may have been created.
    $tags = '';
    foreach (terms('tag') as $slug => $name) {
        if (is_file(public_file('/tag/' . $slug . '/'))) $tags .= '<url><loc>' . e(site_url() . enc_path('/tag/' . $slug . '/')) . '</loc></url>';
    }
    write_text_file('post_tag-sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>' . "\n" . '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . $tags . "</urlset>\n");
}

function refresh_feed(): void
{
    $items = '';
    foreach (array_slice(db()->query("SELECT * FROM posts WHERE status = 'published' ORDER BY date DESC")->fetchAll(), 0, 20) as $p) {
        $link = e(site_url() . enc_path($p['path']));
        $items .= '<item><title>' . e($p['title']) . "</title><link>$link</link><guid>$link</guid><pubDate>"
            . date('D, d M Y H:i:s +0000', strtotime($p['date'])) . '</pubDate><description>'
            . e($p['excerpt'] !== '' ? $p['excerpt'] : plain($p['body'], 300)) . '</description></item>';
    }
    write_text_file('feed.xml', '<?xml version="1.0" encoding="UTF-8"?>' . "\n" . '<rss version="2.0"><channel><title>'
        . e(ltrim(SITE_TITLE_SUFFIX, ' -')) . '</title><link>' . site_url() . '/</link><description>התמקדות, הקומי, Somatic Experiencing</description>'
        . '<language>he-IL</language>' . $items . "</channel></rss>\n");
}

/* --------------------------------------------------------- testimonials */

function testimonials(bool $publishedOnly = false): array
{
    return db()->query('SELECT * FROM testimonials' . ($publishedOnly ? ' WHERE published = 1' : '') . ' ORDER BY position, id')->fetchAll();
}

function refresh_testimonials(): void
{
    $cards = '';
    foreach (testimonials(true) as $t) {
        $cards .= '<figure class="quote"><blockquote class="prose">' . $t['body'] . '</blockquote><figcaption><strong>'
            . e($t['name']) . '</strong>' . ($t['role'] !== '' ? ' · ' . e($t['role']) : '') . '</figcaption></figure>';
    }
    replace_region('/לקוחות-מספרים/', 'testimonials', '<div class="quotes">' . $cards . '</div>', 'עדכון המלצות');

    $home = array_values(array_filter(testimonials(true), fn($t) => $t['show_on_home']));
    $voices = '';
    foreach ($home as $i => $t) {
        $voices .= '<figure class="voice"' . ($i ? ' hidden' : '') . '><blockquote>' . e(plain($t['body'])) . '</blockquote><figcaption>'
            . e(trim($t['name'] . ($t['role'] !== '' ? ', ' . $t['role'] : ''))) . '</figcaption></figure>';
    }
    $n = count($home);
    replace_region('/', 'voices', '<div class="voices" data-voices>' . $voices . '</div>' . "\n    <div class=\"voices__nav\">\n"
        . '      <button class="btn btn--line-light btn--sm" type="button" data-voices-next' . ($n < 2 ? ' hidden' : '') . '>המלצה הבאה</button>' . "\n"
        . '      <span class="voices__count" data-voices-count' . ($n < 2 ? ' hidden' : '') . '>1 מתוך ' . $n . '</span>', 'עדכון המלצות בדף הבית');
}
