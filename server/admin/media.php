<?php
declare(strict_types=1);
require __DIR__ . '/_lib/bootstrap.php';
require __DIR__ . '/_lib/layout.php';
require __DIR__ . '/_lib/media.php';

$user = require_login();
$json = ($_GET['format'] ?? '') === 'json' || str_contains($_SERVER['HTTP_ACCEPT'] ?? '', 'application/json');

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_csrf();
    $action = $_POST['action'] ?? 'upload';
    try {
        if ($action === 'upload') {
            $urls = [];
            $files = $_FILES['files'] ?? null;
            if (!$files) throw new RuntimeException('לא נבחרו קבצים.');
            foreach ((array)$files['tmp_name'] as $i => $tmp) {
                $err = (int)$files['error'][$i];
                if ($err === UPLOAD_ERR_INI_SIZE || $err === UPLOAD_ERR_FORM_SIZE) throw new RuntimeException('הקובץ ' . $files['name'][$i] . ' גדול מדי לשרת.');
                if ($err !== UPLOAD_ERR_OK || !is_uploaded_file($tmp)) continue;
                $urls[] = media_store($tmp, (string)$files['name'][$i]);
            }
            if (!$urls) throw new RuntimeException('ההעלאה לא הצליחה.');
            log_activity('העלה ' . count($urls) . ' קבצים', basename(end($urls)), '/admin/media.php');
            if ($json) {
                header('Content-Type: application/json');
                echo json_encode(['ok' => true, 'urls' => $urls], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
                exit;
            }
            flash(count($urls) === 1 ? 'הקובץ הועלה.' : count($urls) . ' קבצים הועלו.');
        } elseif ($action === 'delete') {
            $url = (string)($_POST['url'] ?? '');
            $file = realpath(site_root() . $url);
            if (!$file || !str_starts_with($file, realpath(uploads_dir()) . '/') || !is_file($file)) throw new RuntimeException('הקובץ לא נמצא.');
            unlink($file);
            log_activity('מחק קובץ', basename($file));
            flash('הקובץ נמחק.');
        } elseif ($action === 'zip') {
            $f = $_FILES['zip'] ?? null;
            if (!$f || $f['error'] !== UPLOAD_ERR_OK) throw new RuntimeException('קובץ ה־ZIP לא הועלה. ייתכן שהוא גדול מהמותר בשרת; אפשר להעלות אותו בחלקים.');
            [$added, $skipped] = media_import_zip($f['tmp_name'], !empty($_POST['overwrite']));
            log_activity('ייבא תמונות מ־ZIP', "$added קבצים");
            flash("נוספו $added קבצים" . ($skipped ? ", $skipped דולגו (קיימים כבר או מסוג לא נתמך)" : '') . '.');
        }
    } catch (RuntimeException $ex) {
        if ($json) {
            http_response_code(422);
            header('Content-Type: application/json');
            echo json_encode(['ok' => false, 'error' => $ex->getMessage()], JSON_UNESCAPED_UNICODE);
            exit;
        }
        flash($ex->getMessage(), 'error');
    }
    redirect('/admin/media.php');
}

$q = trim((string)($_GET['q'] ?? ''));
$type = (string)($_GET['type'] ?? '');
$items = media_list($q);
if ($type === 'image') $items = array_values(array_filter($items, fn($i) => $i['image']));

if ($json) {
    header('Content-Type: application/json');
    echo json_encode(array_slice($items, 0, 200), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

$perPage = 48;
$page = max(1, (int)($_GET['p'] ?? 1));
$pages = max(1, (int)ceil(count($items) / $perPage));
$shown = array_slice($items, ($page - 1) * $perPage, $perPage);
$missing = is_file(APP_ROOT . '/admin/_lib/seed/media-needed.txt')
    ? array_filter(file(APP_ROOT . '/admin/_lib/seed/media-needed.txt', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES), fn($u) => !is_file(site_root() . $u))
    : [];
$max = ini_get('upload_max_filesize');

admin_header('תמונות וקבצים', 'media', $user);
?>
<div class="media-top">
  <form method="post" enctype="multipart/form-data" class="dropzone" data-dropzone>
    <?= csrf_field() ?><input type="hidden" name="action" value="upload">
    <input type="file" name="files[]" id="files" multiple accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,video/mp4" data-autosubmit>
    <label for="files"><b>העלאת תמונות וקבצים</b><span>גוררים לכאן, או לוחצים לבחירה · עד <?= e($max) ?> לקובץ</span></label>
  </form>
  <form method="get" class="filters">
    <label class="filters__search">חיפוש לפי שם קובץ <input type="search" name="q" value="<?= e($q) ?>"></label>
    <label>סוג
      <select name="type" data-autosubmit><option value="">הכל</option><option value="image"<?= $type === 'image' ? ' selected' : '' ?>>רק תמונות</option></select>
    </label>
  </form>
</div>

<?php if ($missing): ?>
  <details class="panel restore">
    <summary><b><?= count($missing) ?> תמונות מהאתר הקודם עדיין חסרות</b> · שחזור מקובץ ZIP</summary>
    <p>הורידו מהאחסון הקודם את התיקייה <code dir="ltr">wp-content/uploads</code> כקובץ ZIP, והעלו אותו כאן. הקבצים יחזרו בדיוק לכתובות שהיו להם, כך שכל התמונות בעמודים ובגוגל יעבדו שוב.</p>
    <form method="post" enctype="multipart/form-data" class="inline-fields">
      <?= csrf_field() ?><input type="hidden" name="action" value="zip">
      <input type="file" name="zip" accept=".zip,application/zip" required>
      <label class="check"><input type="checkbox" name="overwrite" value="1"> להחליף קבצים שכבר קיימים</label>
      <button class="btn" type="submit">ייבוא</button>
    </form>
    <p class="muted small">קובץ גדול מ־<?= e($max) ?>? אפשר לחלק אותו לכמה קבצי ZIP לפי שנים, או להעלות את התיקייה דרך מנהל הקבצים של האחסון.</p>
  </details>
<?php endif; ?>

<?php if (!$shown): ?>
  <p class="empty"><?= $q ? 'לא נמצאו קבצים בשם הזה.' : 'עוד אין כאן קבצים. העלו תמונה ראשונה, או שחזרו את התמונות מהאתר הקודם.' ?></p>
<?php else: ?>
  <ul class="media-grid">
    <?php foreach ($shown as $m): ?>
      <li>
        <a class="media-grid__thumb" href="<?= e($m['url']) ?>" target="_blank" rel="noopener">
          <?php if ($m['image']): ?><img src="<?= e($m['url']) ?>" alt="" loading="lazy"><?php else: ?><span class="filetype"><?= e(strtoupper(pathinfo($m['name'], PATHINFO_EXTENSION))) ?></span><?php endif; ?>
        </a>
        <div class="media-grid__meta">
          <span class="media-grid__name" title="<?= e($m['name']) ?>"><?= e($m['name']) ?></span>
          <span class="muted small"><?= e(human_size($m['size'])) ?> · <?= e(date('d.m.Y', $m['time'])) ?></span>
          <div class="media-grid__actions">
            <button type="button" class="linklike" data-copy="<?= e($m['url']) ?>">העתקת קישור</button>
            <form method="post" data-confirm="למחוק את הקובץ? עמודים שמשתמשים בו יציגו תמונה חסרה.">
              <?= csrf_field() ?><input type="hidden" name="action" value="delete"><input type="hidden" name="url" value="<?= e($m['url']) ?>">
              <button type="submit" class="linklike linklike--danger">מחיקה</button>
            </form>
          </div>
        </div>
      </li>
    <?php endforeach; ?>
  </ul>
  <?php if ($pages > 1): ?>
    <nav class="pager"><?php for ($i = 1; $i <= $pages; $i++): ?><a href="?<?= e(http_build_query(['q' => $q, 'type' => $type, 'p' => $i])) ?>"<?= $i === $page ? ' aria-current="page"' : '' ?>><?= $i ?></a><?php endfor; ?></nav>
  <?php endif; ?>
<?php endif; ?>
<?php admin_footer();
