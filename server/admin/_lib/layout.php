<?php
declare(strict_types=1);

require_once __DIR__ . '/seo.php';
require_once __DIR__ . '/content.php';

function admin_headers(): void
{
    header('X-Frame-Options: SAMEORIGIN');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: same-origin');
    header('X-Robots-Tag: noindex, nofollow');
    header("Content-Security-Policy: default-src 'self'; img-src 'self' data: https://i.ytimg.com; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-src 'self'; form-action 'self'; frame-ancestors 'self'; base-uri 'none'");
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

const NAV_ICONS = [
    'dashboard' => '<path d="M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z"/>',
    'leads' => '<path d="M4 5h16v11H7l-3 3V5Zm2 2v7.2l.8-.8H18V7H6Zm2 2h8v1.5H8V9Zm0 2.5h5V13H8v-1.5Z"/>',
    'pages' => '<path d="M6 3h8l4 4v14H6V3Zm2 2v14h8V8h-3V5H8Zm1.5 6h5v1.5h-5V11Zm0 3h5v1.5h-5V14Z"/>',
    'posts' => '<path d="M4 4h12v2H4V4Zm0 4h16v2H4V8Zm0 4h16v2H4v-2Zm0 4h10v2H4v-2Zm13 0 3-3 1.5 1.5-3 3H17V16Z"/>',
    'testimonials' => '<path d="M6 7h5v5.5c0 2.5-1.6 4.3-4 4.5v-2c1.1-.3 1.8-1.1 2-2.5H6V7Zm7 0h5v5.5c0 2.5-1.6 4.3-4 4.5v-2c1.1-.3 1.8-1.1 2-2.5h-3V7Z"/>',
    'media' => '<path d="M4 5h16v14H4V5Zm2 2v8.6l3.5-3.6 2.5 2.5 3-3.5 3 3.6V7H6Zm3 3.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z"/>',
    'seo' => '<path d="M10 4a6 6 0 0 1 4.8 9.6l4.8 4.8-1.4 1.4-4.8-4.8A6 6 0 1 1 10 4Zm0 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/>',
    'settings' => '<path d="M11 3h2l.5 2.4 1.6.7 2-1.4 1.4 1.4-1.4 2 .7 1.6L20 11v2l-2.4.5-.7 1.6 1.4 2-1.4 1.4-2-1.4-1.6.7L13 21h-2l-.5-2.4-1.6-.7-2 1.4-1.4-1.4 1.4-2-.7-1.6L4 13v-2l2.4-.5.7-1.6-1.4-2 1.4-1.4 2 1.4 1.6-.7L11 3Zm1 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"/>',
];

/** Full admin page with the sidebar. */
function admin_header(string $title, string $active, array $user, string $actions = ''): void
{
    content_migrate();
    page_open($title, 'app');
    $newLeads = (int)db()->query("SELECT COUNT(*) FROM leads WHERE status = 'new'")->fetchColumn();
    $groups = [
        '' => [
            'dashboard' => ['/admin/', 'סקירה'],
            'leads' => ['/admin/leads.php', 'לידים', $newLeads],
        ],
        'תוכן' => [
            'pages' => ['/admin/pages.php', 'עמודים'],
            'posts' => ['/admin/posts.php', 'מאמרים ובלוג'],
            'testimonials' => ['/admin/testimonials.php', 'המלצות'],
            'media' => ['/admin/media.php', 'תמונות וקבצים'],
        ],
        'אתר' => [
            'seo' => ['/admin/seo.php', 'קידום (SEO)'],
            'settings' => ['/admin/settings.php', 'הגדרות'],
        ],
    ];
    echo '<div class="shell"><aside class="side" id="side" aria-label="תפריט ניהול">'
        . '<a class="side__brand" href="/admin/"><span class="side__logo" aria-hidden="true"></span><span>ירדן כרם<small>ניהול האתר</small></span></a>'
        . '<a class="side__new" href="/admin/post-edit.php">מאמר חדש</a><nav>';
    foreach ($groups as $label => $items) {
        if ($label !== '') echo '<p class="side__group">' . e($label) . '</p>';
        echo '<ul>';
        foreach ($items as $key => $item) {
            [$href, $text] = $item;
            $badge = !empty($item[2]) ? '<span class="side__badge">' . (int)$item[2] . '</span>' : '';
            $cur = $key === $active ? ' aria-current="page"' : '';
            echo '<li><a href="' . e($href) . '"' . $cur . '><svg viewBox="0 0 24 24" aria-hidden="true">' . NAV_ICONS[$key] . '</svg><span>'
                . e($text) . '</span>' . $badge . '</a></li>';
        }
        echo '</ul>';
    }
    echo '</nav><div class="side__foot"><a href="/" target="_blank" rel="noopener">צפייה באתר</a>'
        . '<div class="side__user"><span>' . e($user['username']) . '</span>'
        . '<form method="post" action="/admin/logout.php">' . csrf_field() . '<button type="submit" class="linklike">יציאה</button></form></div></div>'
        . '</aside><div class="side-scrim" data-close-side></div>'
        . '<div class="content"><header class="topbar"><button class="menu-toggle" type="button" aria-controls="side" aria-expanded="false" data-toggle-side>'
        . '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v2H4V6Zm0 5h16v2H4v-2Zm0 5h16v2H4v-2Z"/></svg><span class="sr-only">תפריט</span></button>'
        . '<h1>' . e($title) . '</h1><div class="topbar__actions">' . $actions . '</div></header><main class="main">';
    if ($f = flash()) {
        echo '<p class="notice notice--' . e($f[0]) . '" role="status">' . e($f[1]) . '</p>';
    }
}

function admin_footer(array $scripts = []): void
{
    echo '</main></div></div><script src="/admin/assets/admin.js"></script>';
    foreach ($scripts as $s) echo '<script src="/admin/assets/' . e($s) . '.js"></script>';
    echo '</body></html>';
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
