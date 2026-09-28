<?php
declare(strict_types=1);
require __DIR__ . '/_lib/bootstrap.php';
require __DIR__ . '/_lib/layout.php';
require __DIR__ . '/_lib/seo.php';

$user = require_login();
$db = db();
$count = fn(string $sql, array $p = []) => (int)(function () use ($db, $sql, $p) {
    $st = $db->prepare($sql);
    $st->execute($p);
    return $st->fetchColumn();
})();

$new = $count("SELECT COUNT(*) FROM leads WHERE status = 'new'");
$week = $count('SELECT COUNT(*) FROM leads WHERE created_at >= ?', [date('Y-m-d 00:00:00', strtotime('-6 days'))]);
$month = $count('SELECT COUNT(*) FROM leads WHERE created_at >= ?', [date('Y-m-01 00:00:00')]);
$latest = $db->query('SELECT * FROM leads ORDER BY created_at DESC LIMIT 6')->fetchAll();
$issues = seo_issue_count();

admin_header('שלום, ' . $user['username'], 'dashboard', $user);
?>
<section class="summary">
  <a class="summary__item<?= $new ? ' is-hot' : '' ?>" href="/admin/leads.php?status=new"><b><?= $new ?></b><span>לידים שמחכים לתשובה</span></a>
  <a class="summary__item" href="/admin/leads.php"><b><?= $week ?></b><span>לידים בשבוע האחרון</span></a>
  <a class="summary__item" href="/admin/leads.php"><b><?= $month ?></b><span>לידים מתחילת החודש</span></a>
  <a class="summary__item<?= $issues ? ' is-warn' : '' ?>" href="/admin/seo.php?filter=issues"><b><?= $issues ?></b><span>עמודים עם הערות קידום</span></a>
</section>

<section class="panel">
  <div class="panel__head"><h2>לידים אחרונים</h2><a href="/admin/leads.php">לכל הלידים</a></div>
  <?php if (!$latest): ?>
    <p class="empty">עוד לא הגיעו לידים. כשמישהו ימלא טופס באתר, הוא יופיע כאן ותקבלו גם מייל.</p>
  <?php else: ?>
    <ul class="lead-rows">
      <?php foreach ($latest as $l): ?>
        <li><a href="/admin/lead.php?id=<?= (int)$l['id'] ?>">
          <span class="lead-rows__name"><?= e($l['name'] ?: ($l['phone'] ?: $l['email'])) ?></span>
          <span class="tag tag--<?= e($l['status']) ?>"><?= e(LEAD_STATUSES[$l['status']] ?? $l['status']) ?></span>
          <span class="muted"><?= e(LEAD_SOURCES[$l['product'] ?? $l['kind']] ?? '') ?></span>
          <time class="muted"><?= e(he_date($l['created_at'])) ?></time>
        </a></li>
      <?php endforeach; ?>
    </ul>
  <?php endif; ?>
</section>
<?php admin_footer();
