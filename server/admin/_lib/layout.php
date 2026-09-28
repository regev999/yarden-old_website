<?php
declare(strict_types=1);

function admin_headers(): void
{
    header('X-Frame-Options: DENY');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: same-origin');
    header('X-Robots-Tag: noindex, nofollow');
    header("Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    header('Cache-Control: no-store');
}

function page_open(string $title, string $bodyClass): void
{
    admin_headers();
    echo '<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">'
        . '<meta name="viewport" content="width=device-width, initial-scale=1">'
        . '<meta name="robots" content="noindex, nofollow">'
        . '<title>' . e($title) . ' · ניהול האתר</title>'
        . '<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">'
        . '<link rel="stylesheet" href="/admin/assets/admin.css">'
        . '</head><body class="' . e($bodyClass) . '">';
}

/** Full admin page with navigation. */
function admin_header(string $title, string $active, array $user): void
{
    page_open($title, 'app');
    $newLeads = (int)db()->query("SELECT COUNT(*) FROM leads WHERE status = 'new'")->fetchColumn();
    $nav = [
        'dashboard' => ['/admin/', 'סקירה'],
        'leads' => ['/admin/leads.php', 'לידים' . ($newLeads ? ' <span class="badge">' . $newLeads . '</span>' : '')],
        'seo' => ['/admin/seo.php', 'קידום (SEO)'],
        'settings' => ['/admin/settings.php', 'הגדרות'],
    ];
    echo '<header class="bar"><a class="bar__brand" href="/admin/">ניהול האתר</a>'
        . '<nav class="bar__nav" aria-label="ניהול">';
    foreach ($nav as $key => [$href, $label]) {
        $cur = $key === $active ? ' aria-current="page"' : '';
        echo '<a href="' . e($href) . '"' . $cur . '>' . $label . '</a>';
    }
    echo '</nav><div class="bar__user"><a href="/" target="_blank" rel="noopener">לאתר</a>'
        . '<form method="post" action="/admin/logout.php">' . csrf_field()
        . '<button type="submit" class="linklike">יציאה</button></form></div></header>'
        . '<main class="main"><h1>' . e($title) . '</h1>';
    if ($f = flash()) {
        echo '<p class="notice notice--' . e($f[0]) . '" role="status">' . e($f[1]) . '</p>';
    }
}

function admin_footer(): void
{
    echo '</main><script src="/admin/assets/admin.js"></script></body></html>';
}

/** Small centred card for login / reset / setup. */
function auth_header(string $title): void
{
    page_open($title, 'auth');
    echo '<main class="auth-card"><p class="auth-card__brand">ירדן כרם · ניהול האתר</p><h1>' . e($title) . '</h1>';
    if ($f = flash()) {
        echo '<p class="notice notice--' . e($f[0]) . '" role="status">' . e($f[1]) . '</p>';
    }
}

function auth_footer(): void
{
    echo '</main></body></html>';
}
