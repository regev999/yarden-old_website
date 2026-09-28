<?php
declare(strict_types=1);
require __DIR__ . '/_lib/bootstrap.php';
require __DIR__ . '/_lib/layout.php';

$user = require_login();
content_migrate();
$path = (string)($_GET['path'] ?? $_POST['path'] ?? '');

if (isset($_GET['view'])) {
    // Show one saved version as it looked.
    $st = db()->prepare('SELECT html, created_at FROM revisions WHERE id = ?');
    $st->execute([(int)$_GET['view']]);
    $r = $st->fetch();
    if (!$r) { http_response_code(404); exit('לא נמצא'); }
    header('X-Robots-Tag: noindex');
    header("Content-Security-Policy: default-src 'self'; img-src 'self' data: https://i.ytimg.com; style-src 'self' 'unsafe-inline'; script-src 'none'");
    echo str_replace('<body>', '<body><div style="position:sticky;top:0;z-index:100;background:#0f2140;color:#fff;text-align:center;padding:8px;font:500 15px sans-serif">גרסה שמורה מ־'
        . e(he_date($r['created_at'])) . ' · לא מה שמוצג כרגע באתר</div>', gzuncompress($r['html']));
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_csrf();
    if ($p = restore_revision((int)($_POST['id'] ?? 0))) {
        // Posts keep their data in the database; restoring the page file is a snapshot of the page.
        log_activity('שחזר גרסה קודמת', $p === '/' ? 'דף הבית' : rawurldecode($p));
        flash('הגרסה שוחזרה והיא מוצגת עכשיו באתר. הגרסה שהייתה לפני כן נשמרה ברשימה.');
    } else {
        flash('הגרסה לא נמצאה.', 'error');
    }
    redirect('/admin/revisions.php?path=' . rawurlencode($path));
}

$revs = $path !== '' ? revisions_for($path) : [];
$name = $path === '/' ? 'דף הבית' : (seo_read($path)['h1'] ?? rawurldecode($path));
admin_header('גרסאות קודמות', 'pages', $user);
?>
<p class="back"><a href="/admin/pages.php">חזרה לעמודים</a></p>
<p>עמוד: <b><?= e($name) ?></b> · <a href="<?= e($path) ?>" target="_blank" rel="noopener">הגרסה הנוכחית באתר</a></p>
<?php if (!$revs): ?>
  <p class="empty">עוד אין גרסאות קודמות. בכל פעם שהעמוד נשמר, הגרסה שהייתה לפניו תישמר כאן.</p>
<?php else: ?>
  <div class="table-wrap"><table class="table">
    <thead><tr><th>נשמרה</th><th>מה קרה אחריה</th><th>מי</th><th></th></tr></thead>
    <tbody>
    <?php foreach ($revs as $r): ?>
      <tr>
        <td class="nowrap"><?= e(he_date($r['created_at'])) ?></td>
        <td><?= e($r['note']) ?></td>
        <td><?= e($r['user']) ?></td>
        <td class="nowrap">
          <a href="?view=<?= (int)$r['id'] ?>" target="_blank" rel="noopener">צפייה</a>
          <form method="post" class="inline" data-confirm="לשחזר את הגרסה הזו? היא תחליף את מה שמוצג עכשיו באתר.">
            <?= csrf_field() ?><input type="hidden" name="id" value="<?= (int)$r['id'] ?>"><input type="hidden" name="path" value="<?= e($path) ?>">
            <button class="linklike" type="submit">שחזור</button>
          </form>
        </td>
      </tr>
    <?php endforeach; ?>
    </tbody>
  </table></div>
<?php endif; ?>
<?php admin_footer();
