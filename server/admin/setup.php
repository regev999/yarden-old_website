<?php
/** First run only: create the admin account. Disabled once any account exists. */
declare(strict_types=1);
require __DIR__ . '/_lib/bootstrap.php';
require __DIR__ . '/_lib/layout.php';

if (user_count() > 0) {
    redirect('/admin/login.php');
}

$error = null;
$v = ['username' => '', 'email' => ''];
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_csrf();
    $key = trim((string)($_POST['setup_key'] ?? ''));
    $v['username'] = trim((string)($_POST['username'] ?? ''));
    $v['email'] = trim((string)($_POST['email'] ?? ''));
    $pw = (string)($_POST['password'] ?? '');

    if (too_many_attempts('setup|' . ip_hash())) {
        $error = 'יותר מדי ניסיונות. נסו שוב בעוד רבע שעה.';
    } elseif (!hash_equals((string)cfg('setup_key_sha256'), hash('sha256', $key))) {
        record_attempt('setup|' . ip_hash());
        $error = 'קוד ההתקנה שגוי.';
    } elseif (!preg_match('/^[\p{L}\p{N}._-]{3,40}$/u', $v['username'])) {
        $error = 'שם המשתמש צריך להכיל 3–40 אותיות, ספרות, נקודה, מקף או קו תחתון.';
    } elseif (!filter_var($v['email'], FILTER_VALIDATE_EMAIL)) {
        $error = 'כתובת המייל לא תקינה. היא משמשת לאיפוס סיסמה.';
    } elseif ($p = password_problem($pw)) {
        $error = $p;
    } else {
        db()->prepare('INSERT INTO users(username, email, password_hash, created_at) VALUES(?, ?, ?, ?)')
            ->execute([$v['username'], $v['email'], password_hash($pw, PASSWORD_DEFAULT), now()]);
        login_user((int)db()->lastInsertId());
        flash('החשבון נוצר ואתם מחוברים.');
        redirect('/admin/');
    }
}

auth_header('יצירת חשבון ניהול');
?>
<p class="muted">פעם אחת בלבד: יוצרים את החשבון שבו תתחברו לאזור הניהול.</p>
<?php if ($error): ?><p class="notice notice--error" role="alert"><?= e($error) ?></p><?php endif; ?>
<form method="post" class="stack">
  <?= csrf_field() ?>
  <label>קוד התקנה
    <input name="setup_key" required autocomplete="off" dir="ltr">
    <small>הקוד שקיבלתם יחד עם האתר.</small>
  </label>
  <label>שם משתמש
    <input name="username" required value="<?= e($v['username']) ?>" autocomplete="username" dir="ltr">
  </label>
  <label>מייל (לאיפוס סיסמה)
    <input name="email" type="email" required value="<?= e($v['email']) ?>" autocomplete="email" dir="ltr">
  </label>
  <label>סיסמה
    <input name="password" type="password" required minlength="10" autocomplete="new-password" dir="ltr">
    <small>לפחות 10 תווים.</small>
  </label>
  <button class="btn" type="submit">יצירת החשבון</button>
</form>
<?php auth_footer();
