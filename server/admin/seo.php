<?php
declare(strict_types=1);
require __DIR__ . '/_lib/bootstrap.php';
require __DIR__ . '/_lib/layout.php';
require __DIR__ . '/_lib/seo.php';

$user = require_login();
$paths = seo_paths();

// ------------------------------------------------------------ edit one page
$edit = isset($_GET['path']) ? (string)$_GET['path'] : null;
if ($edit !== null) {
    if (!isset($paths[$edit]) || !($page = seo_read($edit))) {
        flash('העמוד לא נמצא.', 'error');
        redirect('/admin/seo.php');
    }
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        require_csrf();
        $title = trim(preg_replace('/\s+/', ' ', (string)($_POST['title'] ?? '')));
        $desc = trim(preg_replace('/\s+/', ' ', (string)($_POST['description'] ?? '')));
        $noindex = !empty($_POST['noindex']);
        if ($title === '') {
            flash('הכותרת לא יכולה להיות ריקה.', 'error');
        } elseif (seo_save($edit, $title, $desc, $noindex)) {
            flash('נשמר. השינוי כבר באוויר, וגוגל יעדכן אותו בסריקה הבאה.');
        } else {
            flash('השמירה נכשלה: אין הרשאת כתיבה לקבצי האתר בשרת.', 'error');
        }
        redirect('/admin/seo.php?path=' . rawurlencode($edit));
    }
    $issues = seo_issues($page);
    $url = rtrim((string)cfg('site_url'), '/') . $edit;
    admin_header('עריכת קידום לעמוד', 'seo', $user);
    ?>
    <p class="back"><a href="/admin/seo.php">חזרה לכל העמודים</a></p>
    <div class="seo-edit">
      <form method="post" class="panel stack" data-seo-form>
        <?= csrf_field() ?>
        <p class="muted">עמוד: <a href="<?= e($edit) ?>" target="_blank" rel="noopener"><?= e($page['h1'] ?: $edit) ?></a></p>
        <label>כותרת בגוגל (Title)
          <input name="title" value="<?= e($page['title']) ?>" required data-count="<?= SEO_TITLE_MAX ?>" data-suffix="<?= e(SEO_SITE_SUFFIX) ?>">
          <small data-counter></small>
        </label>
        <label>תיאור בגוגל (Meta description)
          <textarea name="description" rows="3" data-count="<?= SEO_DESC_MAX ?>" data-min="<?= SEO_DESC_MIN ?>"><?= e($page['description']) ?></textarea>
          <small data-counter></small>
        </label>
        <label class="check"><input type="checkbox" name="noindex" value="1"<?= $page['noindex'] ? ' checked' : '' ?>> להסתיר את העמוד מגוגל (noindex)</label>
        <?php if ($page['noindex']): ?><p class="notice notice--warn">העמוד מוסתר כרגע מגוגל.</p><?php endif; ?>
        <button class="btn" type="submit">שמירה</button>
      </form>
      <aside class="panel">
        <h2>כך זה ייראה בגוגל</h2>
        <div class="serp">
          <p class="serp__url" dir="ltr"><?= e(rawurldecode($url)) ?></p>
          <p class="serp__title" data-preview="title"><?= e($page['title']) ?></p>
          <p class="serp__desc" data-preview="description"><?= e($page['description']) ?></p>
        </div>
        <?php if ($issues): ?>
          <h2>הערות</h2>
          <ul class="issues"><?php foreach ($issues as $i): ?><li><?= e($i) ?></li><?php endforeach; ?></ul>
        <?php else: ?>
          <p class="notice notice--ok">אין הערות לעמוד הזה.</p>
        <?php endif; ?>
        <p class="muted small">בסוף כל כותרת מופיע שם האתר, בדיוק כמו באתר הקודם. כדאי להשאיר אותו.</p>
        <p class="muted small">עדיף לא לשנות כותרות של עמודים שכבר מדורגים טוב בלי סיבה. שינוי קטן ומדויק עדיף על שכתוב מלא.</p>
      </aside>
    </div>
    <?php
    admin_footer();
    exit;
}

// ------------------------------------------------------------------- list
$filter = $_GET['filter'] ?? '';
$type = (string)($_GET['type'] ?? '');
$q = trim((string)($_GET['q'] ?? ''));
$rows = seo_all();
$total = count($rows);
$withIssues = count(array_filter($rows, fn($r) => $r['issues']));
$rows = array_filter($rows, function ($r) use ($filter, $type, $q) {
    if ($filter === 'issues' && !$r['issues']) return false;
    if ($type !== '' && $r['type'] !== $type) return false;
    if ($q !== '' && !str_contains($r['title'] . ' ' . $r['path'] . ' ' . $r['h1'], $q)) return false;
    return true;
});
$edited = array_column(db()->query('SELECT path, updated_at FROM seo')->fetchAll(), 'updated_at', 'path');

admin_header('קידום (SEO)', 'seo', $user);
?>
<section class="summary summary--3">
  <div class="summary__item"><b><?= $total ?></b><span>עמודים באתר</span></div>
  <a class="summary__item<?= $withIssues ? ' is-warn' : '' ?>" href="/admin/seo.php?filter=issues"><b><?= $withIssues ?></b><span>עמודים עם הערות</span></a>
  <a class="summary__item" href="/sitemap_index.xml" target="_blank" rel="noopener"><b>מפת אתר</b><span>לשליחה ב־Search Console</span></a>
</section>

<form class="filters" method="get">
  <label>הצגה
    <select name="filter" data-autosubmit>
      <option value="">כל העמודים</option>
      <option value="issues"<?= $filter === 'issues' ? ' selected' : '' ?>>רק עמודים עם הערות</option>
    </select>
  </label>
  <label>סוג
    <select name="type" data-autosubmit>
      <option value="">הכל</option>
      <?php foreach (['עמוד', 'פוסט', 'קטגוריה', 'תגית'] as $t): ?>
        <option<?= $t === $type ? ' selected' : '' ?>><?= $t ?></option>
      <?php endforeach; ?>
    </select>
  </label>
  <label class="filters__search">חיפוש
    <input type="search" name="q" value="<?= e($q) ?>" placeholder="כותרת או כתובת">
  </label>
  <button class="btn btn--quiet" type="submit">סינון</button>
</form>

<div class="table-wrap">
  <table class="table">
    <thead><tr><th>עמוד</th><th>סוג</th><th>כותרת בגוגל</th><th>הערות</th></tr></thead>
    <tbody>
      <?php foreach ($rows as $r): $href = '/admin/seo.php?path=' . rawurlencode($r['path']); ?>
        <tr data-href="<?= e($href) ?>">
          <td><a href="<?= e($href) ?>"><?= e($r['h1'] ?: $r['path']) ?></a>
            <?php if (isset($edited[$r['path']])): ?><span class="tag tag--edited">נערך</span><?php endif; ?>
            <?php if ($r['noindex']): ?><span class="tag tag--closed">מוסתר מגוגל</span><?php endif; ?></td>
          <td class="nowrap muted"><?= e($r['type']) ?></td>
          <td class="clip"><?= e($r['title']) ?></td>
          <td><?= $r['issues'] ? '<span class="warn">' . e(implode(' · ', $r['issues'])) . '</span>' : '<span class="muted">תקין</span>' ?></td>
        </tr>
      <?php endforeach; ?>
    </tbody>
  </table>
</div>
<?php admin_footer();
