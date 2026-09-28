<?php
/** Receives edited blocks from the page editor (JSON) and writes the page. */
declare(strict_types=1);
require __DIR__ . '/_lib/bootstrap.php';
require __DIR__ . '/_lib/layout.php';
require __DIR__ . '/_lib/pageedit.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
$fail = function (int $code, string $msg) {
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE);
    exit;
};

if (!current_user()) $fail(401, 'פג תוקף ההתחברות. התחברו שוב בחלון אחר ונסו לשמור שוב.');
content_migrate();
$in = json_decode((string)file_get_contents('php://input'), true);
if (!is_array($in) || !hash_equals(csrf_token(), (string)($in['csrf'] ?? ''))) $fail(400, 'הבקשה לא תקינה. רעננו את העמוד ונסו שוב.');

$path = (string)($in['path'] ?? '');
if (!isset(seo_paths()[$path])) $fail(404, 'העמוד לא נמצא.');
$file = public_file($path);
$html = (string)file_get_contents($file);
if (!hash_equals(sha1($html), (string)($in['hash'] ?? ''))) {
    $fail(409, 'העמוד השתנה מאז שנפתח (אולי בחלון אחר). פתחו אותו מחדש כדי לא לדרוס שינויים.');
}
$edits = is_array($in['edits'] ?? null) ? $in['edits'] : [];
if (!$edits) $fail(422, 'אין שינויים לשמירה.');

$new = apply_block_edits($html, $edits);
write_page($path, $new, 'עריכת טקסט');
$name = $path === '/' ? 'דף הבית' : (seo_read($path)['h1'] ?? $path);
log_activity('ערך עמוד', $name, '/admin/page-edit.php?path=' . rawurlencode($path));
echo json_encode(['ok' => true, 'hash' => sha1($new)]);
