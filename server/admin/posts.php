<?php
declare(strict_types=1);
require __DIR__ . '/_lib/bootstrap.php';
require __DIR__ . '/_lib/layout.php';

$user = require_login();
content_migrate();

$cats = terms('category');
$q = trim((string)($_GET['q'] ?? ''));
$cat = (string)($_GET['cat'] ?? '');
$status = (string)($_GET['status'] ?? '');

$rows = array_map('post_row', db()->query('SELECT id, path, title, excerpt, body, categories, tags, status, is_video, duplicate_of, wp_id, format, date, modified FROM posts ORDER BY date DESC')->fetchAll());
$counts = ['all' => count($rows), 'published' => 0, 'draft' => 0];
foreach ($rows as $r) $counts[$r['status']] = ($counts[$r['status']] ?? 0) + 1;
$rows = array_values(array_filter($rows, function ($r) use ($q, $cat, $status) {
    if ($status !== '' && $r['status'] !== $status) return false;
    if ($cat !== '' && !in_array($cat, $r['categories'], true)) return false;
    if ($q !== '' && mb_stripos($r['title'] . ' ' . plain($r['body']), $q) === false) return false;
    return true;
}));
$perPage = 30;
$page = max(1, (int)($_GET['p'] ?? 1));
$pages = max(1, (int)ceil(count($rows) / $perPage));
$shown = array_slice($rows, ($page - 1) * $perPage, $perPage);

admin_header('מאמרים ובלוג', 'posts', $user, '<a class="btn" href="/admin/post-edit.php">מאמר חדש</a>');
?>
<nav class="tabs" aria-label="סטטוס">
  <a href="?"<?= $status === '' ? ' aria-current="page"' : '' ?>>הכל <span><?= $counts['all'] ?></span></a>
  <a href="?status=published"<?= $status === 'published' ? ' aria-current="page"' : '' ?>>מפורסמים <span><?= $counts['published'] ?></span></a>
  <a href="?status=draft"<?= $status === 'draft' ? ' aria-current="page"' : '' ?>>טיוטות <span><?= $counts['draft'] ?></span></a>
</nav>
<form class="filters" method="get">
  <input type="hidden" name="status" value="<?= e($status) ?>">
  <label class="filters__search">חיפוש בכותרת ובטקסט <input type="search" name="q" value="<?= e($q) ?>"></label>
  <label>נושא
    <select name="cat" data-autosubmit>
      <option value="">כל הנושאים</option>
      <?php foreach ($cats as $slug => $name): ?><option value="<?= e($slug) ?>"<?= $slug === $cat ? ' selected' : '' ?>><?= e($name) ?></option><?php endforeach; ?>
    </select>
  </label>
  <button class="btn btn--quiet" type="submit">סינון</button>
</form>

<?php if (!$shown): ?>
  <p class="empty">לא נמצאו מאמרים. <a href="/admin/post-edit.php">כתיבת מאמר חדש</a></p>
<?php else: ?>
  <div class="table-wrap">
    <table class="table">
      <thead><tr><th>כותרת</th><th>נושא</th><th>תאריך</th><th></th></tr></thead>
      <tbody>
      <?php foreach ($shown as $r): $edit = '/admin/post-edit.php?id=' . (int)$r['id']; ?>
        <tr data-href="<?= e($edit) ?>">
          <td>
            <a href="<?= e($edit) ?>" class="strong"><?= e($r['title']) ?></a>
            <?php if ($r['status'] === 'draft'): ?><span class="tag">טיוטה</span><?php endif; ?>
            <?php if ($r['duplicate_of']): ?><span class="tag tag--closed" title="עותק כפול מהאתר הקודם, לא מוצג ברשימות">עותק כפול</span><?php endif; ?>
            <?php if ($r['is_video']): ?><span class="tag">סרטון</span><?php endif; ?>
            <div class="muted small clip"><?= e(plain($r['body'], 110)) ?></div>
          </td>
          <td class="small"><?= e(implode(', ', array_map(fn($s) => $cats[$s] ?? $s, $r['categories']))) ?></td>
          <td class="nowrap small"><?= e(he_date($r['date'], false)) ?></td>
          <td class="nowrap"><?php if ($r['status'] === 'published'): ?><a href="<?= e($r['path']) ?>" target="_blank" rel="noopener" class="small">צפייה</a><?php endif; ?></td>
        </tr>
      <?php endforeach; ?>
      </tbody>
    </table>
  </div>
  <?php if ($pages > 1): ?>
    <nav class="pager"><?php for ($i = 1; $i <= $pages; $i++): ?><a href="?<?= e(http_build_query(['q' => $q, 'cat' => $cat, 'status' => $status, 'p' => $i])) ?>"<?= $i === $page ? ' aria-current="page"' : '' ?>><?= $i ?></a><?php endfor; ?></nav>
  <?php endif; ?>
<?php endif; ?>
<?php admin_footer();
