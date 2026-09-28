<?php
declare(strict_types=1);
require __DIR__ . '/_lib/bootstrap.php';
require __DIR__ . '/_lib/layout.php';

$user = require_login();
$id = (int)($_GET['id'] ?? $_POST['id'] ?? 0);
$st = db()->prepare('SELECT * FROM leads WHERE id = ?');
$st->execute([$id]);
$lead = $st->fetch();
if (!$lead) {
    flash('הליד לא נמצא.', 'error');
    redirect('/admin/leads.php');
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_csrf();
    if (($_POST['action'] ?? '') === 'delete') {
        db()->prepare('DELETE FROM leads WHERE id = ?')->execute([$id]);
        flash('הליד נמחק.');
        redirect('/admin/leads.php');
    }
    $status = array_key_exists($_POST['status'] ?? '', LEAD_STATUSES) ? $_POST['status'] : $lead['status'];
    $notes = mb_substr((string)($_POST['notes'] ?? ''), 0, 10000);
    db()->prepare('UPDATE leads SET status = ?, notes = ?, updated_at = ? WHERE id = ?')->execute([$status, $notes, now(), $id]);
    flash('השינויים נשמרו.');
    redirect('/admin/lead.php?id=' . $id);
}

admin_header($lead['name'] ?: 'ליד ללא שם', 'leads', $user);
$phoneDigits = preg_replace('/[^\d]/', '', (string)$lead['phone']);
$wa = $phoneDigits ? 'https://wa.me/' . (str_starts_with($phoneDigits, '0') ? '972' . substr($phoneDigits, 1) : $phoneDigits) : '';
?>
<p class="back"><a href="/admin/leads.php">חזרה לרשימת הלידים</a></p>
<div class="lead-layout">
  <section class="panel">
    <dl class="facts">
      <dt>התקבל</dt><dd><?= e(he_date($lead['created_at'])) ?></dd>
      <dt>מקור</dt><dd><?= e(LEAD_SOURCES[$lead['product'] ?? $lead['kind']] ?? '') ?></dd>
      <?php if ($lead['phone']): ?><dt>טלפון</dt><dd dir="ltr"><?= e($lead['phone']) ?></dd><?php endif; ?>
      <?php if ($lead['email']): ?><dt>מייל</dt><dd dir="ltr"><?= e($lead['email']) ?></dd><?php endif; ?>
      <?php if ($lead['page']): ?><dt>נשלח מהעמוד</dt><dd><a href="<?= e($lead['page']) ?>" target="_blank" rel="noopener"><?= e($lead['page'] === '/' ? 'דף הבית' : trim(urldecode($lead['page']), '/')) ?></a></dd><?php endif; ?>
    </dl>
    <?php if ($lead['message']): ?>
      <h2>ההודעה</h2>
      <p class="message"><?= nl2br(e($lead['message'])) ?></p>
    <?php endif; ?>
    <div class="actions">
      <?php if ($lead['phone']): ?><a class="btn" href="tel:<?= e($phoneDigits) ?>">חיוג</a><a class="btn btn--quiet" href="<?= e($wa) ?>" target="_blank" rel="noopener">וואטסאפ</a><?php endif; ?>
      <?php if ($lead['email']): ?><a class="btn btn--quiet" href="mailto:<?= e($lead['email']) ?>">שליחת מייל</a><?php endif; ?>
    </div>
  </section>

  <section class="panel">
    <form method="post" class="stack">
      <?= csrf_field() ?>
      <input type="hidden" name="id" value="<?= (int)$lead['id'] ?>">
      <fieldset class="status-pick">
        <legend>סטטוס</legend>
        <?php foreach (LEAD_STATUSES as $k => $label): ?>
          <label><input type="radio" name="status" value="<?= e($k) ?>"<?= $k === $lead['status'] ? ' checked' : '' ?>> <?= e($label) ?></label>
        <?php endforeach; ?>
      </fieldset>
      <label>הערות שלי
        <textarea name="notes" rows="6" placeholder="למשל: דיברנו ביום ראשון, מעוניינת בפגישה בזום"><?= e($lead['notes']) ?></textarea>
      </label>
      <button class="btn" type="submit">שמירה</button>
    </form>
    <form method="post" class="danger-zone" data-confirm="למחוק את הליד לצמיתות?">
      <?= csrf_field() ?>
      <input type="hidden" name="id" value="<?= (int)$lead['id'] ?>">
      <input type="hidden" name="action" value="delete">
      <button type="submit" class="linklike linklike--danger">מחיקת הליד</button>
    </form>
  </section>
</div>
<?php admin_footer();
