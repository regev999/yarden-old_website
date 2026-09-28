<?php
/**
 * 301 redirects and the 404 monitor.
 *
 * Every request for an address that doesn't exist reaches /404.php (via
 * ErrorDocument). It looks the address up here, sends a 301 when there is a
 * match, and otherwise records the miss so it can be redirected from the admin.
 * Links like /?p=123 reach /go.php (see .htaccess) and use the same lookup.
 */
declare(strict_types=1);

function redirects_migrate(): void
{
    static $done = false;
    if ($done) return;
    $done = true;
    db()->exec(<<<SQL
    CREATE TABLE IF NOT EXISTS redirects (
        id INTEGER PRIMARY KEY,
        source TEXT NOT NULL UNIQUE,
        target TEXT NOT NULL,
        code INTEGER NOT NULL DEFAULT 301,
        note TEXT NOT NULL DEFAULT '',
        hits INTEGER NOT NULL DEFAULT 0,
        last_hit TEXT,
        created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notfound (
        path TEXT PRIMARY KEY,
        hits INTEGER NOT NULL DEFAULT 1,
        referrer TEXT NOT NULL DEFAULT '',
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL
    );
    SQL);
    if (setting('redirects_seeded') !== '1') {
        $rows = json_decode((string)@file_get_contents(__DIR__ . '/seed/redirects.json'), true) ?: [];
        $st = db()->prepare('INSERT OR IGNORE INTO redirects(source, target, note, created_at) VALUES(?, ?, ?, ?)');
        db()->beginTransaction();
        foreach ($rows as $r) $st->execute([normalize_source($r['from']), $r['to'], $r['note'], now()]);
        db()->commit();
        set_setting('redirects_seeded', '1');
    }
}

/** Canonical form of a source address: decoded path, single slashes, sorted-free query kept as is. */
function normalize_source(string $s): string
{
    $s = trim($s);
    if (preg_match('#^https?://[^/]+(.*)$#i', $s, $m)) $s = $m[1] ?: '/';   // pasted full URL
    $query = '';
    if (($q = strpos($s, '?')) !== false) {
        $query = substr($s, $q);
        $s = substr($s, 0, $q);
    }
    $s = rawurldecode($s);
    $s = '/' . ltrim(preg_replace('#/+#', '/', $s), '/');
    return $s . $query;
}

function valid_target(string $t): bool
{
    return (bool)preg_match('#^(/[^\s<>"]*|https?://[^\s<>"]+)$#i', $t);
}

/** Find a redirect for a path (+ optional query). Returns [target, id] or null. */
function find_redirect(string $path, string $query = ''): ?array
{
    redirects_migrate();
    $path = normalize_source($path);
    $candidates = [];
    if ($query !== '') {
        // WordPress-style ?p=123 / ?page_id= / ?attachment_id= links.
        parse_str($query, $qs);
        foreach (['p', 'page_id', 'attachment_id'] as $k) {
            if (isset($qs[$k]) && ctype_digit((string)$qs[$k])) $candidates[] = "/?$k=" . $qs[$k];
        }
        $candidates[] = $path . '?' . $query;
    }
    $candidates[] = $path;
    $candidates[] = str_ends_with($path, '/') ? rtrim($path, '/') : $path . '/';
    foreach ($candidates as $c) {
        $st = db()->prepare('SELECT id, target FROM redirects WHERE source = ? COLLATE NOCASE');
        $st->execute([$c]);
        if ($r = $st->fetch()) return [$r['target'], (int)$r['id']];
    }
    return null;
}

/** Built-in rules for common WordPress addresses that no longer exist. */
function smart_redirect(string $path): ?string
{
    $path = normalize_source($path);
    $exists = fn(string $p) => is_file(site_root() . ($p === '/' ? '/index.html' : rtrim($p, '/') . '/index.html')) || is_file(site_root() . $p);
    $rules = [
        '#^(.*/)(?:page/\d+|feed|amp|embed|trackback|comment-page-\d+)/?$#' => '$1',   // pagination, feeds, AMP
        '#^/(?:author|wp-json|wp-includes)(?:/.*)?$#' => '/',
        '#^/\d{4}(?:/\d{2})?(?:/\d{2})?/?$#' => '/בלוג/',                                // date archives
        '#^(.*)/index\.php$#' => '$1/',
    ];
    foreach ($rules as $re => $to) {
        if (preg_match($re, $path)) {
            $t = preg_replace($re, $to, $path);
            if ($t !== $path && $exists($t)) return $t;
            if ($t === '/' || $t === '/בלוג/') return $t;
        }
    }
    // Missing trailing slash.
    if (!str_ends_with($path, '/') && !str_contains(basename($path), '.') && $exists($path . '/')) return $path . '/';
    // Resized image that isn't there: send to the original file.
    if (preg_match('#^(/wp-content/uploads/.+)-\d{2,4}x\d{2,4}(\.(?:jpe?g|png|gif|webp))$#i', $path, $m) && is_file(site_root() . $m[1] . $m[2])) {
        return $m[1] . $m[2];
    }
    // "-2" copies and similar: /slug-2/ → /slug/ when only the original exists.
    if (preg_match('#^/(.+)-\d/$#', $path, $m) && $exists('/' . $m[1] . '/')) return '/' . $m[1] . '/';
    return null;
}

function send_redirect(string $target, ?int $id = null, int $code = 301): never
{
    if ($id) {
        db()->prepare('UPDATE redirects SET hits = hits + 1, last_hit = ? WHERE id = ?')->execute([now(), $id]);
    }
    $loc = str_starts_with($target, '/') ? enc_target($target) : $target;
    header('Cache-Control: public, max-age=3600');
    header('Location: ' . $loc, true, $code);
    exit;
}

function enc_target(string $t): string
{
    [$p, $q] = array_pad(explode('?', $t, 2), 2, null);
    $p = implode('/', array_map('rawurlencode', explode('/', $p)));
    return $p . ($q !== null ? '?' . $q : '');
}

function log_notfound(string $path): void
{
    $path = normalize_source($path);
    // Keep the list about real visitors: ignore scanners probing for other software.
    if (preg_match('#(\.(php|asp|aspx|env|git|sql|bak|ini|cgi|xml\.gz)$|/wp-admin|/wp-login|xmlrpc|/\.well-known/|/cgi-bin/|/vendor/|/\.)#i', $path)) return;
    if (mb_strlen($path) > 400) return;
    $ref = mb_substr((string)($_SERVER['HTTP_REFERER'] ?? ''), 0, 300);
    db()->prepare('INSERT INTO notfound(path, hits, referrer, first_seen, last_seen) VALUES(?, 1, ?, ?, ?)
                   ON CONFLICT(path) DO UPDATE SET hits = hits + 1, last_seen = excluded.last_seen,
                   referrer = CASE WHEN excluded.referrer <> "" THEN excluded.referrer ELSE referrer END')
        ->execute([$path, $ref, now(), now()]);
    if (random_int(1, 50) === 1) {
        db()->prepare("DELETE FROM notfound WHERE last_seen < ? AND hits < 3")->execute([date('Y-m-d H:i:s', strtotime('-180 days'))]);
    }
}

/**
 * Save a redirect. Resolves chains (A→B when B→C becomes A→C) and refuses loops.
 * Returns null on success or an error message.
 */
function save_redirect(string $from, string $to, string $note = '', ?int $id = null): ?string
{
    redirects_migrate();
    $from = normalize_source($from);
    $to = trim($to);
    if (preg_match('#^https?://(www\.)?yardenkerem\.co\.il(/.*)?$#i', $to, $m)) $to = rawurldecode($m[2] ?? '/') ?: '/';
    if ($to !== '' && $to[0] === '/') $to = normalize_source($to);
    if ($from === '/' ) return 'אי אפשר להפנות את דף הבית.';
    if (str_starts_with($from, '/admin') || str_starts_with($from, '/api/')) return 'אי אפשר להפנות כתובות של אזור הניהול.';
    if (!valid_target($to)) return 'כתובת היעד לא תקינה. כתבו כתובת שמתחילה ב־/ (בתוך האתר) או ב־https://';
    // Follow the target through existing redirects to its final address.
    $seen = [$from => true];
    $final = $to;
    for ($i = 0; $i < 10; $i++) {
        $st = db()->prepare('SELECT target FROM redirects WHERE source = ? AND id IS NOT ?');
        $st->execute([$final, $id]);
        $next = $st->fetchColumn();
        if ($next === false) break;
        if (isset($seen[$final])) return 'ההפניה יוצרת לולאה.';
        $seen[$final] = true;
        $final = $next;
    }
    if ($final === $from || rtrim($final, '/') === rtrim($from, '/')) return 'המקור והיעד זהים (או מובילים זה לזה).';
    try {
        if ($id) {
            db()->prepare('UPDATE redirects SET source = ?, target = ?, note = ? WHERE id = ?')->execute([$from, $final, $note, $id]);
        } else {
            db()->prepare('INSERT INTO redirects(source, target, note, created_at) VALUES(?, ?, ?, ?)')->execute([$from, $final, $note, now()]);
        }
    } catch (PDOException) {
        return 'כבר קיימת הפניה מהכתובת הזו.';
    }
    // Anything that pointed at the old source now points straight at the final target.
    db()->prepare('UPDATE redirects SET target = ? WHERE target = ?')->execute([$final, $from]);
    db()->prepare('DELETE FROM notfound WHERE path = ?')->execute([$from]);
    write_htaccess_redirects();
    return null;
}

/**
 * Redirects whose source is still a real page on disk can't be handled by the
 * 404 page, so they are written into a marked block at the top of .htaccess.
 */
function write_htaccess_redirects(): void
{
    $file = site_root() . '/.htaccess';
    if (!is_file($file) || !is_writable($file)) return;
    $lines = [];
    foreach (db()->query("SELECT source, target FROM redirects WHERE source NOT LIKE '%?%'")->fetchAll() as $r) {
        $src = $r['source'];
        $disk = site_root() . ($src === '/' ? '/index.html' : rtrim($src, '/') . '/index.html');
        if (!is_file($disk) && !is_file(site_root() . $src)) continue;
        $pattern = '^' . preg_replace('/([.\\\\+*?\[^\]$(){}=!<>|:#\s-])/u', '\\\\$1', trim($src, '/')) . '/?$';
        $target = str_starts_with($r['target'], '/') ? enc_target($r['target']) : $r['target'];
        if (preg_match('/[\s"]/', $target)) continue;
        $lines[] = 'RewriteRule ' . $pattern . ' ' . $target . ' [R=301,L,NE]';
    }
    $block = "# BEGIN yk-redirects (managed by the admin area)\n<IfModule mod_rewrite.c>\nRewriteEngine On\n"
        . implode("\n", $lines) . "\n</IfModule>\n# END yk-redirects\n";
    $ht = (string)file_get_contents($file);
    $ht = preg_replace('/# BEGIN yk-redirects.*?# END yk-redirects\n?/s', '', $ht);
    if (!$lines) {
        file_put_contents($file, $ht);
        return;
    }
    @copy($file, data_dir() . '/htaccess.backup');
    file_put_contents($file, $block . $ht);
}
