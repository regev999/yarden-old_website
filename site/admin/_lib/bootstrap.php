<?php
/**
 * Shared core for the admin area and the public API:
 * config, SQLite storage, sessions, CSRF, auth, mail and small helpers.
 */
declare(strict_types=1);

const APP_ROOT = __DIR__ . '/../..';        // admin/_lib -> site root
require __DIR__ . '/config.php';

date_default_timezone_set(cfg('timezone'));
mb_internal_encoding('UTF-8');

function cfg(string $key)
{
    global $CONFIG;
    return $CONFIG[$key] ?? null;
}

/* ---------------------------------------------------------------- storage */

function data_dir(): string
{
    static $dir = null;
    if ($dir !== null) {
        return $dir;
    }
    // Prefer a folder next to (not inside) the public web root.
    $candidates = [];
    if (cfg('data_dir')) {
        $candidates[] = cfg('data_dir');
    }
    $webRoot = realpath(APP_ROOT) ?: APP_ROOT;
    $candidates[] = dirname($webRoot) . '/yk-private';
    $candidates[] = $webRoot . '/_private';           // protected by .htaccess, last resort
    foreach ($candidates as $c) {
        if ((is_dir($c) || @mkdir($c, 0700, true)) && is_writable($c)) {
            if (str_starts_with(realpath($c) ?: $c, $webRoot)) {
                @file_put_contents($c . '/.htaccess', "Require all denied\nDeny from all\n");
                @file_put_contents($c . '/index.html', '');
            }
            return $dir = rtrim($c, '/');
        }
    }
    http_response_code(500);
    exit('Storage folder is not writable.');
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo) {
        return $pdo;
    }
    $pdo = new PDO('sqlite:' . data_dir() . '/site.sqlite', null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
    migrate($pdo);
    return $pdo;
}

function migrate(PDO $pdo): void
{
    $pdo->exec(<<<SQL
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_login_at TEXT
    );
    CREATE TABLE IF NOT EXISTS password_resets (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at INTEGER NOT NULL,
        used_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS login_attempts (
        id INTEGER PRIMARY KEY,
        key TEXT NOT NULL,
        at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS login_attempts_key ON login_attempts(key, at);
    CREATE TABLE IF NOT EXISTS leads (
        id INTEGER PRIMARY KEY,
        created_at TEXT NOT NULL,
        name TEXT, phone TEXT, email TEXT, message TEXT,
        kind TEXT NOT NULL DEFAULT 'contact',
        product TEXT,
        page TEXT,
        status TEXT NOT NULL DEFAULT 'new',
        notes TEXT NOT NULL DEFAULT '',
        ip_hash TEXT,
        updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS leads_created ON leads(created_at);
    CREATE TABLE IF NOT EXISTS seo (
        path TEXT PRIMARY KEY,
        title TEXT,
        description TEXT,
        noindex INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    );
    SQL);
}

function setting(string $key, ?string $default = null): ?string
{
    $st = db()->prepare('SELECT value FROM settings WHERE key = ?');
    $st->execute([$key]);
    $v = $st->fetchColumn();
    return $v === false ? $default : $v;
}

function set_setting(string $key, ?string $value): void
{
    db()->prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        ->execute([$key, $value]);
}

function now(): string
{
    return date('Y-m-d H:i:s');
}

/* ------------------------------------------------------------ http helpers */

function e(?string $s): string
{
    return htmlspecialchars((string)$s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function is_https(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}

function base_url(): string
{
    $host = $_SERVER['HTTP_HOST'] ?? parse_url((string)cfg('site_url'), PHP_URL_HOST);
    return (is_https() ? 'https://' : 'http://') . $host;
}

function redirect(string $to): never
{
    header('Location: ' . $to, true, 303);
    exit;
}

function client_ip(): string
{
    return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
}

/** Per-install random secret, created on first use and kept in the data folder. */
function app_secret(): string
{
    $f = data_dir() . '/secret.key';
    if (!is_file($f)) {
        file_put_contents($f, bin2hex(random_bytes(32)));
        @chmod($f, 0600);
    }
    return trim((string)file_get_contents($f));
}

function ip_hash(): string
{
    return hash('sha256', client_ip() . '|' . app_secret());
}

/* ------------------------------------------------------------- sessions */

function start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    session_name('yk_admin');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/admin/',
        'secure' => is_https(),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    ini_set('session.use_strict_mode', '1');
    ini_set('session.gc_maxlifetime', '43200');
    $dir = data_dir() . '/sessions';
    if (!is_dir($dir)) {
        @mkdir($dir, 0700, true);
    }
    if (is_writable($dir)) {
        session_save_path($dir);
    }
    session_start();
    // Idle timeout: 12 hours.
    if (isset($_SESSION['seen']) && time() - $_SESSION['seen'] > 43200) {
        $_SESSION = [];
        session_regenerate_id(true);
    }
    $_SESSION['seen'] = time();
}

function csrf_token(): string
{
    start_session();
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf'];
}

function csrf_field(): string
{
    return '<input type="hidden" name="csrf" value="' . e(csrf_token()) . '">';
}

function require_csrf(): void
{
    $sent = $_POST['csrf'] ?? '';
    if (!is_string($sent) || !hash_equals(csrf_token(), $sent)) {
        http_response_code(400);
        exit('פג תוקף הטופס. חזרו לדף הקודם, רעננו ונסו שוב.');
    }
}

function flash(?string $message = null, string $type = 'ok'): ?array
{
    start_session();
    if ($message !== null) {
        $_SESSION['flash'] = [$type, $message];
        return null;
    }
    $f = $_SESSION['flash'] ?? null;
    unset($_SESSION['flash']);
    return $f;
}

/* ----------------------------------------------------------------- auth */

function user_count(): int
{
    return (int)db()->query('SELECT COUNT(*) FROM users')->fetchColumn();
}

function current_user(): ?array
{
    start_session();
    if (empty($_SESSION['uid'])) {
        return null;
    }
    $st = db()->prepare('SELECT id, username, email FROM users WHERE id = ?');
    $st->execute([$_SESSION['uid']]);
    return $st->fetch() ?: null;
}

function require_login(): array
{
    if (user_count() === 0) {
        redirect('/admin/setup.php');
    }
    $u = current_user();
    if (!$u) {
        redirect('/admin/login.php');
    }
    return $u;
}

function too_many_attempts(string $key, int $max = 5, int $window = 900): bool
{
    db()->prepare('DELETE FROM login_attempts WHERE at < ?')->execute([time() - 86400]);
    $st = db()->prepare('SELECT COUNT(*) FROM login_attempts WHERE key = ? AND at > ?');
    $st->execute([$key, time() - $window]);
    return (int)$st->fetchColumn() >= $max;
}

function record_attempt(string $key): void
{
    db()->prepare('INSERT INTO login_attempts(key, at) VALUES(?, ?)')->execute([$key, time()]);
}

function login_user(int $id): void
{
    start_session();
    session_regenerate_id(true);
    $_SESSION['uid'] = $id;
    $_SESSION['csrf'] = bin2hex(random_bytes(32));
    db()->prepare('UPDATE users SET last_login_at = ? WHERE id = ?')->execute([now(), $id]);
}

function password_problem(string $pw): ?string
{
    if (mb_strlen($pw) < 10) {
        return 'הסיסמה צריכה להכיל לפחות 10 תווים.';
    }
    return null;
}

function set_password(int $userId, string $pw): void
{
    db()->prepare('UPDATE users SET password_hash = ? WHERE id = ?')
        ->execute([password_hash($pw, PASSWORD_DEFAULT), $userId]);
    // Any outstanding reset links stop working once the password changes.
    db()->prepare('DELETE FROM password_resets WHERE user_id = ?')->execute([$userId]);
}

/* ----------------------------------------------------------------- mail */

function send_mail(string $to, string $subject, string $text, ?string $replyTo = null): bool
{
    $from = cfg('mail_from') ?: ('no-reply@' . preg_replace('/^www\./', '', (string)parse_url(base_url(), PHP_URL_HOST)));
    $fromName = cfg('mail_from_name') ?: 'האתר של ירדן כרם';
    $encSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    $headers = [
        'From' => '=?UTF-8?B?' . base64_encode($fromName) . "?= <$from>",
        'MIME-Version' => '1.0',
        'Content-Type' => 'text/plain; charset=UTF-8',
        'Content-Transfer-Encoding' => 'base64',
    ];
    if ($replyTo && filter_var($replyTo, FILTER_VALIDATE_EMAIL)) {
        $headers['Reply-To'] = $replyTo;
    }
    $body = chunk_split(base64_encode($text));

    if (cfg('smtp_host')) {
        return smtp_send($from, $to, $encSubject, $headers, $body);
    }
    $h = '';
    foreach ($headers as $k => $v) {
        $h .= "$k: $v\r\n";
    }
    return @mail($to, $encSubject, $body, $h, '-f' . $from);
}

/** Minimal SMTP client (SSL on 465 or STARTTLS on 587) for hosts without mail(). */
function smtp_send(string $from, string $to, string $subject, array $headers, string $body): bool
{
    $host = cfg('smtp_host');
    $port = (int)(cfg('smtp_port') ?: 587);
    $secure = $port === 465 ? 'ssl://' : '';
    $fp = @stream_socket_client($secure . $host . ':' . $port, $errno, $err, 15);
    if (!$fp) {
        error_log("SMTP connect failed: $err");
        return false;
    }
    $read = function () use ($fp): string {
        $out = '';
        while (($line = fgets($fp, 515)) !== false) {
            $out .= $line;
            if (isset($line[3]) && $line[3] === ' ') {
                break;
            }
        }
        return $out;
    };
    $cmd = function (string $c, array $ok) use ($fp, $read): bool {
        fwrite($fp, $c . "\r\n");
        $r = $read();
        if (!in_array((int)substr($r, 0, 3), $ok, true)) {
            error_log('SMTP error after ' . explode(' ', $c)[0] . ': ' . trim($r));
            return false;
        }
        return true;
    };
    $read();
    $ehlo = 'EHLO ' . (gethostname() ?: 'localhost');
    if (!$cmd($ehlo, [250])) return false;
    if ($secure === '') {
        if (!$cmd('STARTTLS', [220])) return false;
        if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) return false;
        if (!$cmd($ehlo, [250])) return false;
    }
    if (cfg('smtp_user')) {
        if (!$cmd('AUTH LOGIN', [334])) return false;
        if (!$cmd(base64_encode((string)cfg('smtp_user')), [334])) return false;
        if (!$cmd(base64_encode((string)cfg('smtp_pass')), [235])) return false;
    }
    if (!$cmd("MAIL FROM:<$from>", [250])) return false;
    if (!$cmd("RCPT TO:<$to>", [250, 251])) return false;
    if (!$cmd('DATA', [354])) return false;
    $msg = "To: $to\r\nSubject: $subject\r\nDate: " . date('r') . "\r\n";
    foreach ($headers as $k => $v) {
        $msg .= "$k: $v\r\n";
    }
    $msg .= "\r\n" . str_replace("\n.", "\n..", $body) . "\r\n.";
    if (!$cmd($msg, [250])) return false;
    $cmd('QUIT', [221]);
    fclose($fp);
    return true;
}

/* ------------------------------------------------------------- formatting */

function he_date(string $dt, bool $withTime = true): string
{
    $t = strtotime($dt);
    return $withTime ? date('d.m.Y H:i', $t) : date('d.m.Y', $t);
}

const LEAD_STATUSES = [
    'new' => 'חדש',
    'contacted' => 'חזרתי אליו',
    'scheduled' => 'נקבעה פגישה',
    'client' => 'נרשם / מטופל',
    'closed' => 'לא רלוונטי',
];

const LEAD_SOURCES = [
    'therapy' => 'טיפול אישי',
    'course' => 'קורס',
    'contact' => 'יצירת קשר',
    'newsletter' => 'הרשמה לעדכונים',
];
