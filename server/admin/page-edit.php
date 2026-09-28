<?php
/** Shows a page from the site in edit mode: text blocks become editable in place. */
declare(strict_types=1);
require __DIR__ . '/_lib/bootstrap.php';
require __DIR__ . '/_lib/layout.php';
require __DIR__ . '/_lib/pageedit.php';

$user = require_login();
content_migrate();
$path = (string)($_GET['path'] ?? '');
$paths = seo_paths();
if (!isset($paths[$path])) { flash('העמוד לא נמצא.', 'error'); redirect('/admin/pages.php'); }

// Posts are edited in the article editor.
$st = db()->prepare('SELECT id FROM posts WHERE path = ?');
$st->execute([$path]);
if ($pid = $st->fetchColumn()) redirect('/admin/post-edit.php?id=' . (int)$pid);

$file = public_file($path);
$html = (string)file_get_contents($file);
$hash = sha1($html);
$marked = page_with_markers($html);
$count = substr_count($marked, 'data-yk-edit=');
$name = $path === '/' ? 'דף הבית' : (seo_read($path)['h1'] ?? $path);

$bar = '<div class="yk-bar" data-yk-bar data-path="' . e($path) . '" data-hash="' . e($hash) . '" data-csrf="' . e(csrf_token()) . '">'
    . '<a class="yk-bar__back" href="/admin/pages.php">חזרה</a>'
    . '<span class="yk-bar__title">עריכת עמוד: <b>' . e($name) . '</b> <span class="yk-bar__hint">לחצו על טקסט כדי לשנות אותו · ' . $count . ' אזורים לעריכה</span></span>'
    . '<span class="yk-bar__status" data-yk-status role="status"></span>'
    . '<a class="yk-bar__link" href="/admin/revisions.php?path=' . e(rawurlencode($path)) . '">גרסאות</a>'
    . '<button type="button" class="yk-bar__save" data-yk-save disabled>שמירה</button></div>';

$inject = '<link rel="stylesheet" href="/admin/assets/page-edit.css">';
$marked = str_replace('</head>', $inject . '</head>', $marked);
$marked = preg_replace('#<body([^>]*)>#', '<body$1 class="yk-editing">' . $bar, $marked, 1);
// The site's own script is not needed while editing; the editor scripts are.
$marked = preg_replace('#<script src="/assets/main.js"[^>]*></script>#', '', $marked);
$marked = preg_replace('#<script>window\.SITE_FORM.*?</script>#s', '', $marked);
$marked = str_replace('</body>', '<script src="/admin/assets/editor.js"></script><script src="/admin/assets/page-edit.js"></script></body>', $marked);

admin_headers();
header("Content-Security-Policy: default-src 'self'; img-src 'self' data: https://i.ytimg.com; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; frame-ancestors 'self'; base-uri 'none'");
echo $marked;
