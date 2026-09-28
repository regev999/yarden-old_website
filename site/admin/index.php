<?php
declare(strict_types=1);
require __DIR__ . '/_lib/bootstrap.php';
require __DIR__ . '/_lib/layout.php';

$user = require_login();
content_migrate();
$db = db();
$one = function (string $sql, array $p = []) use ($db) {
    $st = $db->prepare($sql);
    $st->execute($p);
    return (int)$st->fetchColumn();
};

$new = $one("SELECT COUNT(*) FROM leads WHERE status = 'new'");
$week = $one('SELECT COUNT(*) FROM leads WHERE created_at >= ?', [date('Y-m-d 00:00:00', strtotime('-6 days'))]);
$month = $one('SELECT COUNT(*) FROM leads WHERE created_at >= ?', [date('Y-m-01 00:00:00')]);
$posts = $one("SELECT COUNT(*) FROM posts WHERE status = 'published'");
$drafts = $one("SELECT COUNT(*) FROM posts WHERE status = 'draft'");
$testimonials = $one('SELECT COUNT(*) FROM testimonials WHERE published = 1');
$issues = seo_issue_count();
$latest = $db->query('SELECT * FROM leads ORDER BY created_at DESC LIMIT 6')->fetchAll();
$activity = $db->query('SELECT * FROM activity ORDER BY id DESC LIMIT 8')->fetchAll();
$lastPost = $db->query("SELECT title, date FROM posts WHERE status = 'published' ORDER BY date DESC LIMIT 1")->fetch();

// Lead trend: last 8 weeks.
$weeks = [];
for ($i = 7; $i >= 0; $i--) {
    $from = date('Y-m-d 00:00:00', strtotime("monday this week -$i week"));
    $to = date('Y-m-d 00:00:00', strtotime("monday this week -" . ($i - 1) . ' week'));
    $weeks[] = [date('d.m', strtotime($from)), $one('SELECT COUNT(*) FROM leads WHERE created_at >= ? AND created_at < ?', [$from, $to])];
}
$maxWeek = max(1, ...array_column($weeks, 1));
$hour = (int)date('G');
$greet = $hour < 12 ? 'בוקר טוב' : ($hour < 18 ? 'צהריים טובים' : 'ערב טוב');

admin_header($greet . ', ' . $user['username'], 'dashboard', $user);
?>
<section class="summary">
  <a class="summary__item<?= $new ? ' is-hot' : '' ?>" href="/admin/leads.php?status=new"><b><?= $new ?></b><span>לידים שמחכים לתשובה</span></a>
  <a class="summary__item" href="/admin/leads.php"><b><?= $week ?></b><span>לידים בשבוע האחרון · <?= $month ?> החודש</span></a>
  <a class="summary__item" href="/admin/posts.php"><b><?= $posts ?></b><span>מאמרים באתר<?= $drafts ? " · $drafts טיוטות" : '' ?></span></a>
  <a class="summary__item<?= $issues ? ' is-warn' : '' ?>" href="/admin/seo.php?filter=issues"><b><?= $issues ?></b><span>עמודים עם הערות קידום</span></a>
</section>

<div class="dash-grid">
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
            <span class="muted small"><?= e(LEAD_SOURCES[$l['product'] ?? $l['kind']] ?? '') ?></span>
            <time class="muted small"><?= e(he_date($l['created_at'])) ?></time>
          </a></li>
        <?php endforeach; ?>
      </ul>
    <?php endif; ?>
    <h3 class="small muted trend-title">לידים לפי שבוע</h3>
    <div class="trend" role="img" aria-label="לידים בשמונת השבועות האחרונים: <?= e(implode(', ', array_column($weeks, 1))) ?>">
      <?php foreach ($weeks as [$label, $n]): ?>
        <div class="trend__col"><span class="trend__n"><?= $n ?: '' ?></span><span class="trend__bar" style="height:<?= max(3, (int)round($n / $maxWeek * 100)) ?>%"></span><span class="trend__label"><?= e($label) ?></span></div>
      <?php endforeach; ?>
    </div>
  </section>

  <div class="dash-side">
    <section class="panel">
      <h2>פעולות מהירות</h2>
      <div class="quick">
        <a href="/admin/post-edit.php"><b>מאמר חדש</b><span>לבלוג<?= $lastPost ? ' · האחרון: ' . e(he_date($lastPost['date'], false)) : '' ?></span></a>
        <a href="/admin/page-edit.php?path=%2F"><b>עריכת דף הבית</b><span>שינוי טקסטים ישירות על העמוד</span></a>
        <a href="/admin/testimonials.php?edit=0"><b>המלצה חדשה</b><span><?= $testimonials ?> המלצות באתר</span></a>
        <a href="/admin/media.php"><b>העלאת תמונות</b><span>לספריית התמונות</span></a>
      </div>
    </section>
    <section class="panel">
      <h2>שינויים אחרונים</h2>
      <?php if (!$activity): ?>
        <p class="muted small">כאן יופיעו פעולות שנעשו באתר: עריכות, מאמרים חדשים, העלאות.</p>
      <?php else: ?>
        <ul class="activity">
          <?php foreach ($activity as $a): ?>
            <li><span><?= e($a['action']) ?><?= $a['target'] !== '' ? ': ' . ($a['link'] ? '<a href="' . e($a['link']) . '">' . e($a['target']) . '</a>' : e($a['target'])) : '' ?></span>
              <time class="muted small"><?= e(he_date($a['at'])) ?> · <?= e($a['user']) ?></time></li>
          <?php endforeach; ?>
        </ul>
      <?php endif; ?>
    </section>
  </div>
</div>
<?php admin_footer();
