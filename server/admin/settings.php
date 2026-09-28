<?php
declare(strict_types=1);
require __DIR__ . '/_lib/bootstrap.php';
require __DIR__ . '/_lib/layout.php';

$user = require_login();

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_csrf();
    $action = $_POST['action'] ?? '';

    if ($action === 'password') {
        $st = db()->prepare('SELECT password_hash FROM users WHERE id = ?');
        $st->execute([$user['id']]);
        $new = (string)($_POST['new'] ?? '');
        if (!password_verify((string)($_POST['current'] ?? ''), (string)$st->fetchColumn())) {
            flash('הסיסמה הנוכחית שגויה.', 'error');
        } elseif ($p = password_problem($new)) {
            flash($p, 'error');
        } elseif ($new !== (string)($_POST['new2'] ?? '')) {
            flash('הסיסמאות החדשות לא זהות.', 'error');
        } else {
            set_password((int)$user['id'], $new);
            session_regenerate_id(true);
            flash('הסיסמה עודכנה.');
        }
    }

    if ($action === 'account') {
        $username = trim((string)($_POST['username'] ?? ''));
        $email = trim((string)($_POST['email'] ?? ''));
        if (!preg_match('/^[\p{L}\p{N}._-]{3,40}$/u', $username)) {
            flash('שם המשתמש צריך להכיל 3–40 אותיות, ספרות, נקודה, מקף או קו תחתון.', 'error');
        } elseif (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            flash('כתובת המייל לא תקינה.', 'error');
        } else {
            try {
                db()->prepare('UPDATE users SET username = ?, email = ? WHERE id = ?')->execute([$username, $email, $user['id']]);
                flash('פרטי החשבון עודכנו.');
            } catch (PDOException) {
                flash('שם המשתמש או המייל כבר בשימוש.', 'error');
            }
        }
    }

    if ($action === 'notify') {
        $to = trim((string)($_POST['notify_email'] ?? ''));
        if ($to !== '' && !filter_var($to, FILTER_VALIDATE_EMAIL)) {
            flash('כתובת המייל לא תקינה.', 'error');
        } else {
            set_setting('notify_email', $to);
            flash($to ? 'התראות על לידים חדשים יישלחו אל ' . $to : 'התראות במייל כבויות. הלידים עדיין נשמרים במערכת.');
        }
    }

    if ($action === 'test') {
        $to = setting('notify_email', (string)cfg('notify_email')) ?: $user['email'];
        $ok = send_mail($to, 'בדיקת מייל מהאתר', "זו הודעת בדיקה מאזור הניהול של האתר.\nאם היא הגיעה, התראות הלידים ואיפוס הסיסמה יעבדו.");
        flash($ok ? "נשלחה הודעת בדיקה אל $to. אם היא לא מגיעה תוך כמה דקות, בדקו בספאם." : 'השליחה נכשלה. צריך להגדיר שרת דואר (SMTP) בקובץ ההגדרות.', $ok ? 'ok' : 'error');
    }

    redirect('/admin/settings.php');
}

$notify = setting('notify_email', (string)cfg('notify_email'));
admin_header('הגדרות', 'settings', $user);
?>
<div class="settings-grid">
  <section class="panel">
    <h2>התראות על לידים</h2>
    <form method="post" class="stack">
      <?= csrf_field() ?><input type="hidden" name="action" value="notify">
      <label>לאיזה מייל לשלוח כל ליד חדש
        <input name="notify_email" type="email" value="<?= e($notify) ?>" dir="ltr">
        <small>השאירו ריק כדי לא לקבל מיילים. הלידים נשמרים כאן בכל מקרה.</small>
      </label>
      <button class="btn" type="submit">שמירה</button>
    </form>
    <form method="post" class="inline-form">
      <?= csrf_field() ?><input type="hidden" name="action" value="test">
      <button class="btn btn--quiet" type="submit">שליחת מייל בדיקה</button>
    </form>
  </section>

  <section class="panel">
    <h2>פרטי החשבון</h2>
    <form method="post" class="stack">
      <?= csrf_field() ?><input type="hidden" name="action" value="account">
      <label>שם משתמש <input name="username" value="<?= e($user['username']) ?>" required dir="ltr" autocomplete="username"></label>
      <label>מייל (לאיפוס סיסמה) <input name="email" type="email" value="<?= e($user['email']) ?>" required dir="ltr" autocomplete="email"></label>
      <button class="btn" type="submit">שמירה</button>
    </form>
  </section>

  <section class="panel">
    <h2>החלפת סיסמה</h2>
    <form method="post" class="stack">
      <?= csrf_field() ?><input type="hidden" name="action" value="password">
      <label>סיסמה נוכחית <input name="current" type="password" required autocomplete="current-password" dir="ltr"></label>
      <label>סיסמה חדשה <input name="new" type="password" required minlength="10" autocomplete="new-password" dir="ltr"><small>לפחות 10 תווים.</small></label>
      <label>שוב, לאימות <input name="new2" type="password" required minlength="10" autocomplete="new-password" dir="ltr"></label>
      <button class="btn" type="submit">החלפת סיסמה</button>
    </form>
  </section>
</div>
<?php admin_footer();
