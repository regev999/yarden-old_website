<?php
/** Receives the site's contact / newsletter forms, stores the lead and emails a notification. */
declare(strict_types=1);
require __DIR__ . '/../admin/_lib/bootstrap.php';

header('Content-Type: application/json; charset=utf-8');
header('X-Robots-Tag: noindex');
header('Cache-Control: no-store');

function reply(int $code, array $body): never
{
    http_response_code($code);
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    reply(405, ['ok' => false, 'error' => 'method']);
}

// Only accept posts coming from this site's own pages.
$origin = $_SERVER['HTTP_ORIGIN'] ?? $_SERVER['HTTP_REFERER'] ?? '';
if ($origin !== '' && parse_url($origin, PHP_URL_HOST) !== parse_url(base_url(), PHP_URL_HOST)) {
    reply(403, ['ok' => false, 'error' => 'origin']);
}

// Honeypot: real visitors never see or fill this field.
if (trim((string)($_POST['website'] ?? '')) !== '') {
    reply(200, ['ok' => true]);
}

$key = 'lead|' . ip_hash();
if (too_many_attempts($key, 6, 600)) {
    reply(429, ['ok' => false, 'error' => 'אפשר לשלוח שוב בעוד כמה דקות, או להתקשר ישירות.']);
}

$clip = fn(string $f, int $n) => mb_substr(trim((string)($_POST[$f] ?? '')), 0, $n);
$lead = [
    'name' => $clip('name', 120),
    'phone' => $clip('phone', 40),
    'email' => $clip('email', 160),
    'message' => $clip('message', 4000),
    'kind' => array_key_exists($_POST['form'] ?? '', LEAD_SOURCES) ? $_POST['form'] : 'contact',
    'product' => in_array($_POST['product'] ?? '', ['therapy', 'course'], true) ? $_POST['product'] : null,
    'page' => $clip('page', 300),
];
if ($lead['email'] !== '' && !filter_var($lead['email'], FILTER_VALIDATE_EMAIL)) {
    reply(422, ['ok' => false, 'error' => 'כתובת המייל לא תקינה.']);
}
if ($lead['phone'] === '' && $lead['email'] === '') {
    reply(422, ['ok' => false, 'error' => 'כדי שנוכל לחזור אליך, צריך להשאיר טלפון או מייל.']);
}

record_attempt($key);
db()->prepare('INSERT INTO leads(created_at, name, phone, email, message, kind, product, page, ip_hash)
               VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)')
    ->execute([now(), $lead['name'], $lead['phone'], $lead['email'], $lead['message'],
               $lead['kind'], $lead['product'], $lead['page'], ip_hash()]);
$id = (int)db()->lastInsertId();

$to = setting('notify_email', (string)cfg('notify_email'));
if ($to) {
    $source = LEAD_SOURCES[$lead['product'] ?? $lead['kind']] ?? 'יצירת קשר';
    $lines = array_filter([
        'שם: ' . $lead['name'],
        $lead['phone'] ? 'טלפון: ' . $lead['phone'] : null,
        $lead['email'] ? 'מייל: ' . $lead['email'] : null,
        $lead['message'] ? "\nהודעה:\n" . $lead['message'] : null,
        "\nמקור: $source",
        $lead['page'] ? 'נשלח מהעמוד: ' . base_url() . $lead['page'] : null,
        "\nלצפייה בליד: " . base_url() . '/admin/lead.php?id=' . $id,
    ]);
    send_mail($to, "ליד חדש מהאתר: " . ($lead['name'] ?: $lead['phone'] ?: $lead['email']), implode("\n", $lines), $lead['email'] ?: null);
}

reply(200, ['ok' => true]);
