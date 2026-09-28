<?php
/** Preview a post as it would look on the site, without saving anything. */
declare(strict_types=1);
require __DIR__ . '/_lib/bootstrap.php';
require __DIR__ . '/_lib/layout.php';

require_login();
content_migrate();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') redirect('/admin/posts.php');
require_csrf();

$tags = [];
foreach (preg_split('/[,،]/u', (string)($_POST['tags'] ?? '')) as $t) {
    if (($t = trim($t)) !== '') $tags[] = array_search($t, terms('tag'), true) ?: make_slug($t);
}
$title = trim((string)($_POST['title'] ?? '')) ?: 'ללא כותרת';
$html = render_post_page([
    'path' => '/preview/', 'title' => $title, 'body' => sanitize_html((string)($_POST['body'] ?? '')), 'format' => 'rich',
    'excerpt' => (string)($_POST['excerpt'] ?? ''), 'seo_title' => (string)($_POST['seo_title'] ?? ''),
    'categories' => array_values((array)($_POST['categories'] ?? [])), 'tags' => $tags, 'duplicate_of' => null,
    'date' => ($d = (string)($_POST['date'] ?? '')) && strtotime($d) ? date('Y-m-d H:i:s', strtotime($d)) : now(), 'modified' => now(),
]);
header('X-Robots-Tag: noindex');
header('Cache-Control: no-store');
echo str_replace('<body>', '<body><div style="position:sticky;top:0;z-index:100;background:#b35c00;color:#fff;text-align:center;padding:8px;font:500 15px sans-serif">תצוגה מקדימה – השינויים עוד לא נשמרו</div>', $html);
