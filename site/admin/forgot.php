<?php
declare(strict_types=1);
require __DIR__ . '/_lib/bootstrap.php';
require __DIR__ . '/_lib/layout.php';

$sent = false;
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_csrf();
    $who = trim((string)($_POST['who'] ?? ''));
    $key = 'reset|' . ip_hash();
    if (!too_many_attempts($key, 5, 3600)) {
        record_attempt($key);
        $st = db()->prepare('SELECT id, email, username FROM users WHERE email = ? OR username = ?');
        $st->execute([$who, $who]);
        if ($u = $st->fetch()) {
            $token = bin2hex(random_bytes(32));
            db()->prepare('DELETE FROM password_resets WHERE user_id = ?')->execute([$u['id']]);
            db()->prepare('INSERT INTO password_resets(user_id, token_hash, expires_at) VALUES(?, ?, ?)')
                ->execute([$u['id'], hash('sha256', $token), time() + 3600]);
            $link = base_url() . '/admin/reset.php?token=' . $token;
            send_mail(
                $u['email'],
                'איפוס סיסמה לניהול האתר',
                "שלום {$u['username']},\n\nכדי לבחור סיסמה חדשה לאזור הניהול של האתר, פתחו את הקישור:\n$link\n\n"
                . "הקישור בתוקף לשעה אחת ולשימוש אחד.\nאם לא ביקשתם לאפס סיסמה, אפשר להתעלם מההודעה. הסיסמה הנוכחית לא השתנתה.\n"
            );
        }
    }
    // Same answer whether or not the account exists.
    $sent = true;
}

auth_header('איפוס סיסמה');
if ($sent): ?>
  <p class="notice notice--ok" role="status">אם הפרטים שייכים לחשבון במערכת, שלחנו אליו מייל עם קישור לבחירת סיסמה חדשה. הקישור בתוקף לשעה.</p>
  <p class="muted">לא הגיע? בדקו בתיקיית הספאם, או נסו שוב בעוד כמה דקות.</p>
<?php else: ?>
  <p class="muted">כתבו את המייל או שם המשתמש של החשבון, ונשלח קישור לבחירת סיסמה חדשה.</p>
  <form method="post" class="stack">
    <?= csrf_field() ?>
    <label>מייל או שם משתמש
      <input name="who" required autocomplete="username" autofocus dir="ltr">
    </label>
    <button class="btn" type="submit">שליחת קישור לאיפוס</button>
  </form>
<?php endif; ?>
<p class="auth-card__alt"><a href="/admin/login.php">חזרה לכניסה</a></p>
<?php auth_footer();
