<?php
/**
 * SEO data for the static pages. The site is plain HTML, so an edit is saved
 * in the database AND written straight into that page's index.html. The
 * overrides are also exported to seo-overrides.json so a rebuild keeps them.
 */
declare(strict_types=1);

const SEO_TITLE_MAX = 60;   // for the page-name part of the title
// Every title ends with the site name, exactly as on the old site. It is kept
// on purpose (changing established titles can cost rankings), so length checks
// look only at the part before it.
const SEO_SITE_SUFFIX = ' - ירדן כרם - התמקדות, הקומי, Somatic Experiencing';
const SEO_DESC_MIN = 70;
const SEO_DESC_MAX = 160;

function site_root(): string
{
    return realpath(APP_ROOT) ?: APP_ROOT;
}

/** All public URLs, read from the sitemaps the build writes. */
function seo_paths(): array
{
    $paths = [];
    foreach (['page' => 'עמוד', 'post' => 'פוסט', 'category' => 'קטגוריה', 'post_tag' => 'תגית'] as $file => $label) {
        $xml = @file_get_contents(site_root() . "/$file-sitemap.xml");
        if (!$xml) continue;
        preg_match_all('#<loc>([^<]+)</loc>#', $xml, $m);
        foreach ($m[1] as $loc) {
            $path = rawurldecode((string)parse_url($loc, PHP_URL_PATH));
            $paths[$path] = $label;
        }
    }
    return $paths;
}

function seo_file(string $path): ?string
{
    if (!str_starts_with($path, '/') || str_contains($path, '..')) {
        return null;
    }
    $f = site_root() . ($path === '/' ? '/index.html' : rtrim($path, '/') . '/index.html');
    return is_file($f) ? $f : null;
}

function seo_read(string $path): ?array
{
    $f = seo_file($path);
    if (!$f) return null;
    $html = (string)file_get_contents($f);
    $get = function (string $re) use ($html): string {
        return preg_match($re, $html, $m) ? html_entity_decode($m[1], ENT_QUOTES | ENT_HTML5, 'UTF-8') : '';
    };
    $h1 = $get('#<h1[^>]*>(.*?)</h1>#s');
    return [
        'path' => $path,
        'title' => $get('#<title>(.*?)</title>#s'),
        'description' => $get('#<meta name="description" content="([^"]*)"#'),
        'h1' => trim(preg_replace('/\s+/', ' ', strip_tags($h1))),
        'noindex' => (bool)preg_match('#<meta name="robots" content="noindex#', $html),
    ];
}

function seo_issues(array $p): array
{
    $out = [];
    $core = str_ends_with($p['title'], SEO_SITE_SUFFIX) ? mb_substr($p['title'], 0, -mb_strlen(SEO_SITE_SUFFIX)) : $p['title'];
    $tl = mb_strlen($core);
    $dl = mb_strlen($p['description']);
    if ($tl === 0) $out[] = 'חסרה כותרת';
    elseif ($tl > SEO_TITLE_MAX) $out[] = "שם העמוד בכותרת ארוך ($tl תווים)";
    if ($dl === 0) $out[] = 'חסר תיאור';
    elseif ($dl < SEO_DESC_MIN) $out[] = "תיאור קצר ($dl תווים)";
    elseif ($dl > SEO_DESC_MAX) $out[] = "תיאור ארוך ($dl תווים)";
    if ($p['h1'] === '') $out[] = 'אין כותרת ראשית בעמוד';
    return $out;
}

function seo_all(): array
{
    $rows = [];
    foreach (seo_paths() as $path => $type) {
        if ($p = seo_read($path)) {
            $p['type'] = $type;
            $p['issues'] = seo_issues($p);
            $rows[] = $p;
        }
    }
    return $rows;
}

function seo_issue_count(): int
{
    return count(array_filter(seo_all(), fn($p) => $p['issues']));
}

/** Write title / description / noindex into the page's HTML file. */
function seo_apply(string $path, string $title, string $desc, bool $noindex): bool
{
    $f = seo_file($path);
    if (!$f) return false;
    $html = (string)file_get_contents($f);
    $t = htmlspecialchars($title, ENT_QUOTES, 'UTF-8');
    $d = htmlspecialchars($desc, ENT_QUOTES, 'UTF-8');
    $html = preg_replace('#<title>.*?</title>#s', '<title>' . $t . '</title>', $html, 1);
    $html = preg_replace('#<meta name="description" content="[^"]*">#', '<meta name="description" content="' . $d . '">', $html, 1);
    $html = preg_replace('#<meta property="og:description" content="[^"]*">#', '<meta property="og:description" content="' . $d . '">', $html, 1);
    $html = preg_replace('#\s*<meta name="robots" content="noindex[^"]*">#', '', $html);
    if ($noindex) {
        $html = preg_replace('#<meta name="description"#', '<meta name="robots" content="noindex, follow">' . "\n" . '<meta name="description"', $html, 1);
    }
    $tmp = $f . '.tmp';
    if (file_put_contents($tmp, $html) === false) return false;
    return rename($tmp, $f);
}

function seo_save(string $path, string $title, string $desc, bool $noindex): bool
{
    if (!seo_apply($path, $title, $desc, $noindex)) {
        return false;
    }
    db()->prepare('INSERT INTO seo(path, title, description, noindex, updated_at) VALUES(?, ?, ?, ?, ?)
                   ON CONFLICT(path) DO UPDATE SET title = excluded.title, description = excluded.description,
                   noindex = excluded.noindex, updated_at = excluded.updated_at')
        ->execute([$path, $title, $desc, $noindex ? 1 : 0, now()]);
    seo_export();
    return true;
}

/** Keep a JSON copy the build script can read, so a rebuild doesn't lose edits. */
function seo_export(): void
{
    $rows = db()->query('SELECT path, title, description, noindex, updated_at FROM seo ORDER BY path')->fetchAll();
    file_put_contents(data_dir() . '/seo-overrides.json', json_encode($rows, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
}
