<?php
declare(strict_types=1);
require __DIR__ . '/_lib/bootstrap.php';
require __DIR__ . '/_lib/layout.php';

if (user_count() === 0) {
    redirect('/admin/setup.php');
}
if (current_user()) {
    redirect('/admin/');
}

$error = null;
$username = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_csrf();
    $username = trim((string)($_POST['username'] ?? ''));
    $pw = (string)($_POST['password'] ?? '');
    $ipKey = 'login-ip|' . ip_hash();
    $userKey = 'login-user|' . mb_strtolower($username);

    if (too_many_attempts($ipKey, 10) || too_many_attempts($userKey, 5)) {
        $error = 'יותר מדי ניסיונות כניסה. נסו שוב בעוד רבע שעה, או אפסו את הסיסמה.';
    } else {
        $st = db()->prepare('SELECT id, password_hash FROM users WHERE username = ? OR email = ?');
        $st->execute([$username, $username]);
        $u = $st->fetch();
        // Verify against a dummy hash when the user doesn't exist, so timing doesn't reveal it.
        $hash = $u['password_hash'] ?? '$2y$10$usesomesillystringfore7hnbRJHxXVLeakoG8K30oukPsA.ztMG';
        if (password_verify($pw, $hash) && $u) {
            if (password_needs_rehash($hash, PASSWORD_DEFAULT)) {
                set_password((int)$u['id'], $pw);
            }
            login_user((int)$u['id']);
            $next = (string)($_GET['next'] ?? '');
            redirect(str_starts_with($next, '/admin/') && !str_contains($next, '//') ? $next : '/admin/');
        }
        record_attempt($ipKey);
        record_attempt($userKey);
        $error = 'שם המשתמש או הסיסמה שגויים.';
    }
}

auth_header('כניסה');
?>
<?php if ($error): ?><p class="notice notice--error" role="alert"><?= e($error) ?></p><?php endif; ?>
<form method="post" class="stack">
  <?= csrf_field() ?>
  <label>שם משתמש או מייל
    <input name="username" required value="<?= e($username) ?>" autocomplete="username" autofocus dir="ltr">
  </label>
  <label>סיסמה
    <input name="password" type="password" required autocomplete="current-password" dir="ltr">
  </label>
  <button class="btn" type="submit">כניסה</button>
</form>
<p class="auth-card__alt"><a href="/admin/forgot.php">שכחתי סיסמה</a></p>
<?php auth_footer();
