<?php
declare(strict_types=1);
require __DIR__ . '/_lib/bootstrap.php';
require __DIR__ . '/_lib/layout.php';

$user = require_login();
content_migrate();

$q = trim((string)($_GET['q'] ?? ''));
$rows = [];
foreach (seo_paths() as $path => $type) {
    if ($type !== 'עמוד') continue;
    $p = seo_read($path);
    if (!$p) continue;
    if ($q !== '' && mb_stripos($p['h1'] . ' ' . $path, $q) === false) continue;
    $rows[] = $p;
}
// Most-used pages first, then alphabetical.
$top = ['/', '/אודות/', '/טיפולים-פרטניים/', '/קורסים/', '/טראומה-מורכבת/', '/לקוחות-מספרים/', '/צור-קשר/', '/בלוג/', '/פודקאסט/'];
usort($rows, function ($a, $b) use ($top) {
    $ia = array_search($a['path'], $top, true);
    $ib = array_search($b['path'], $top, true);
    if ($ia !== false || $ib !== false) return ($ia === false ? 99 : $ia) <=> ($ib === false ? 99 : $ib);
    return strcmp($a['h1'], $b['h1']);
});
$lastEdit = [];
foreach (db()->query('SELECT path, MAX(created_at) AS at FROM revisions GROUP BY path')->fetchAll() as $r) $lastEdit[$r['path']] = $r['at'];

admin_header('עמודים', 'pages', $user);
?>
<p class="muted">בוחרים עמוד, לוחצים על טקסט ומשנים אותו ישירות על העמוד. כל שמירה נשמרת גם כגרסה, כך שתמיד אפשר לחזור אחורה.</p>
<form class="filters" method="get">
  <label class="filters__search">חיפוש עמוד <input type="search" name="q" value="<?= e($q) ?>"></label>
  <button class="btn btn--quiet" type="submit">חיפוש</button>
</form>
<div class="table-wrap">
  <table class="table">
    <thead><tr><th>עמוד</th><th>כתובת</th><th>נערך לאחרונה</th><th></th></tr></thead>
    <tbody>
    <?php foreach ($rows as $r): $edit = '/admin/page-edit.php?path=' . rawurlencode($r['path']); ?>
      <tr data-href="<?= e($edit) ?>">
        <td><a class="strong" href="<?= e($edit) ?>"><?= e($r['path'] === '/' ? 'דף הבית' : ($r['h1'] ?: $r['path'])) ?></a></td>
        <td class="muted small" dir="ltr"><?= e(rawurldecode($r['path'])) ?></td>
        <td class="small nowrap"><?= isset($lastEdit[$r['path']]) ? e(he_date($lastEdit[$r['path']])) : '<span class="muted">—</span>' ?></td>
        <td class="nowrap small"><a href="<?= e($edit) ?>">עריכה</a> · <a href="/admin/revisions.php?path=<?= e(rawurlencode($r['path'])) ?>">גרסאות</a> · <a href="<?= e($r['path']) ?>" target="_blank" rel="noopener">צפייה</a></td>
      </tr>
    <?php endforeach; ?>
    </tbody>
  </table>
</div>
<?php admin_footer();
