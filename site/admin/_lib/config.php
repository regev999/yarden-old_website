<?php
/**
 * Admin / API configuration.
 * Values here are safe to commit. Server-specific secrets (SMTP password)
 * go in config.local.php next to this file, which is not in git.
 */
$CONFIG = [
    'site_url'  => 'https://www.yardenkerem.co.il',
    'timezone'  => 'Asia/Jerusalem',

    // Folder for the database and sessions. Empty = automatic: a "yk-private"
    // folder next to the web root, or admin/_private if that is not writable.
    'data_dir'  => '',

    // One-time key for creating the first admin account (/admin/setup.php).
    // Only its SHA-256 hash is stored; setup is disabled once an account exists.
    'setup_key_sha256' => '167e8f4515c39d3a8b12a15a59b5b41e243c8e3458013460d2cebbbdea114c70',

    // Where new-lead notifications go until changed in the admin settings.
    'notify_email' => 'yardenkerem@gmail.com',

    // Outgoing mail. Leave smtp_host empty to use the server's mail().
    'mail_from'      => '',
    'mail_from_name' => 'האתר של ירדן כרם',
    'smtp_host' => '',
    'smtp_port' => 587,
    'smtp_user' => '',
    'smtp_pass' => '',
];

if (is_file(__DIR__ . '/config.local.php')) {
    require __DIR__ . '/config.local.php';   // may override any $CONFIG key
}
