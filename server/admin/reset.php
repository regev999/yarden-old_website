<?php
declare(strict_types=1);
require __DIR__ . '/_lib/bootstrap.php';
require __DIR__ . '/_lib/layout.php';

$token = (string)($_GET['token'] ?? $_POST['token'] ?? '');
$reset = null;
if (preg_match('/^[a-f0-9]{64}$/', $token)) {
    $st = db()->prepare('SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?');
    $st->execute([hash('sha256', $token), time()]);
    $reset = $st->fetch() ?: null;
}

$error = null;
if ($reset && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_csrf();
    $pw = (string)($_POST['password'] ?? '');
    if ($p = password_problem($pw)) {
        $error = $p;
    } elseif ($pw !== (string)($_POST['password2'] ?? '')) {
        $error = 'הסיסמאות לא זהות.';
    } else {
        set_password((int)$reset['user_id'], $pw);   // also invalidates this link
        login_user((int)$reset['user_id']);
        flash('הסיסמה עודכנה ואתם מחוברים.');
        redirect('/admin/');
    }
}

auth_header('בחירת סיסמה חדשה');
if (!$reset): ?>
  <p class="notice notice--error" role="alert">הקישור לא תקף. ייתכן שפג תוקפו (שעה) או שכבר השתמשו בו.</p>
  <p><a class="btn" href="/admin/forgot.php">שליחת קישור חדש</a></p>
<?php else: ?>
  <?php if ($error): ?><p class="notice notice--error" role="alert"><?= e($error) ?></p><?php endif; ?>
  <form method="post" class="stack">
    <?= csrf_field() ?>
    <input type="hidden" name="token" value="<?= e($token) ?>">
    <label>סיסמה חדשה
      <input name="password" type="password" required minlength="10" autocomplete="new-password" autofocus dir="ltr">
      <small>לפחות 10 תווים.</small>
    </label>
    <label>שוב, לאימות
      <input name="password2" type="password" required minlength="10" autocomplete="new-password" dir="ltr">
    </label>
    <button class="btn" type="submit">שמירת הסיסמה</button>
  </form>
<?php endif; ?>
<p class="auth-card__alt"><a href="/admin/login.php">חזרה לכניסה</a></p>
<?php auth_footer();
