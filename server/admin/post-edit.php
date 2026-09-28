<?php
declare(strict_types=1);
require __DIR__ . '/_lib/bootstrap.php';
require __DIR__ . '/_lib/layout.php';

$user = require_login();
content_migrate();

$id = (int)($_GET['id'] ?? $_POST['id'] ?? 0);
$post = null;
if ($id) {
    $st = db()->prepare('SELECT * FROM posts WHERE id = ?');
    $st->execute([$id]);
    $post = ($r = $st->fetch()) ? post_row($r) : null;
    if (!$post) { flash('המאמר לא נמצא.', 'error'); redirect('/admin/posts.php'); }
}
$cats = terms('category');
$tagNames = terms('tag');

/** Build a post array from the submitted form. */
function post_from_form(?array $post, array $tagNames): array
{
    $p = $post ?? ['id' => 0, 'path' => '', 'status' => 'draft', 'is_video' => 0, 'duplicate_of' => null, 'wp_id' => null];
    $p['title'] = trim(preg_replace('/\s+/u', ' ', (string)($_POST['title'] ?? '')));
    $p['body'] = sanitize_html((string)($_POST['body'] ?? ''));
    $p['format'] = 'rich';
    $p['excerpt'] = trim(preg_replace('/\s+/u', ' ', (string)($_POST['excerpt'] ?? '')));
    $p['seo_title'] = trim((string)($_POST['seo_title'] ?? ''));
    $p['categories'] = array_values(array_filter((array)($_POST['categories'] ?? []), 'is_string'));
    $tags = [];
    foreach (preg_split('/[,،]/u', (string)($_POST['tags'] ?? '')) as $t) {
        $t = trim($t);
        if ($t === '') continue;
        $slug = array_search($t, $tagNames, true) ?: make_slug($t);
        $tags[$slug] = $t;
    }
    $p['tag_names'] = $tags;
    $p['tags'] = array_keys($tags);
    $d = (string)($_POST['date'] ?? '');
    $p['date'] = $d && strtotime($d) ? date('Y-m-d H:i:s', strtotime($d)) : ($post['date'] ?? now());
    $p['is_video'] = youtube_id($p['body']) && mb_strlen(plain($p['body'])) < 200 ? 1 : 0;
    return $p;
}

$errors = [];
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_csrf();
    $action = $_POST['action'] ?? 'publish';

    if ($action === 'delete' && $post) {
        db()->prepare('DELETE FROM posts WHERE id = ?')->execute([$post['id']]);
        if (is_file(public_file($post['path']))) {
            write_page($post['path'], (string)file_get_contents(public_file($post['path'])), 'לפני מחיקה');   // keeps a revision
            unlink(public_file($post['path']));
            @rmdir(dirname(public_file($post['path'])));
        }
        refresh_listings();
        log_activity('מחק מאמר', $post['title']);
        flash('המאמר נמחק.');
        redirect('/admin/posts.php');
    }

    $p = post_from_form($post, $tagNames);
    if ($p['title'] === '') $errors[] = 'חסרה כותרת.';
    if (plain($p['body']) === '' && !str_contains($p['body'], '<img') && !str_contains($p['body'], 'data-yt')) $errors[] = 'המאמר ריק.';
    foreach ($p['categories'] as $c) if (!isset($cats[$c])) $errors[] = 'נושא לא מוכר.';

    if (!$errors) {
        $wasPublished = $post && $post['status'] === 'published';
        $p['status'] = $action === 'draft' ? 'draft' : 'published';
        // The address is fixed once a post has been published (changing it would lose rankings).
        if (!$wasPublished && !($post['wp_id'] ?? null)) {
            $slug = trim((string)($_POST['slug'] ?? '')) ?: $p['title'];
            $p['path'] = unique_path(make_slug($slug), $post['id'] ?? null);
        }
        $p['modified'] = now();
        foreach ($p['tag_names'] as $slug => $name) {
            db()->prepare('INSERT OR IGNORE INTO terms(slug, kind, name) VALUES(?, ?, ?)')->execute([$slug, 'tag', $name]);
        }
        $vals = [$p['path'], $p['title'], $p['body'], $p['excerpt'], $p['seo_title'], json_encode($p['categories'], JSON_UNESCAPED_UNICODE),
                 json_encode($p['tags'], JSON_UNESCAPED_UNICODE), $p['status'], $p['is_video'], 'rich', $p['date'], $p['modified']];
        if ($post) {
            db()->prepare('UPDATE posts SET path=?, title=?, body=?, excerpt=?, seo_title=?, categories=?, tags=?, status=?, is_video=?, format=?, date=?, modified=? WHERE id=?')
                ->execute([...$vals, $post['id']]);
            $id = (int)$post['id'];
        } else {
            db()->prepare('INSERT INTO posts(path, title, body, excerpt, seo_title, categories, tags, status, is_video, format, date, modified) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
                ->execute($vals);
            $id = (int)db()->lastInsertId();
        }
        $st = db()->prepare('SELECT * FROM posts WHERE id = ?');
        $st->execute([$id]);
        $saved = post_row($st->fetch());

        if ($saved['status'] === 'published') {
            write_page($saved['path'], render_post_page($saved), $post ? 'עריכת מאמר' : 'פרסום מאמר');
        } elseif ($wasPublished && is_file(public_file($saved['path']))) {
            write_page($saved['path'], (string)file_get_contents(public_file($saved['path'])), 'לפני הורדה מפרסום');
            unlink(public_file($saved['path']));
        }
        refresh_listings();
        log_activity($saved['status'] === 'published' ? ($post ? 'עדכן מאמר' : 'פרסם מאמר חדש') : 'שמר טיוטה', $saved['title'], '/admin/post-edit.php?id=' . $id);
        flash($saved['status'] === 'published' ? 'המאמר פורסם באתר.' : 'הטיוטה נשמרה. היא לא מופיעה באתר עד שתפרסמו אותה.');
        redirect('/admin/post-edit.php?id=' . $id);
    }
    $post = array_merge($post ?? [], $p);
}

$isNew = !$post || !$post['id'];
$v = $post ?? ['title' => '', 'body' => '', 'excerpt' => '', 'seo_title' => '', 'categories' => [], 'tags' => [], 'status' => 'draft', 'date' => now(), 'path' => '', 'wp_id' => null];
$bodyForEditor = !empty($v['body']) ? (($v['format'] ?? 'legacy') === 'rich' && !$errors ? html_for_editor($v['body']) : html_for_editor($v['body'])) : '';
$tagText = implode(', ', array_map(fn($s) => $tagNames[$s] ?? ($v['tag_names'][$s] ?? $s), $v['tags']));
$published = ($v['status'] ?? '') === 'published' && !$isNew;
$slugLocked = $published || !empty($v['wp_id']);

$actions = $published ? '<a class="btn btn--quiet" href="' . e($v['path']) . '" target="_blank" rel="noopener">צפייה באתר</a>' : '';
admin_header($isNew ? 'מאמר חדש' : 'עריכת מאמר', 'posts', $user, $actions);
?>
<p class="back"><a href="/admin/posts.php">חזרה לכל המאמרים</a></p>
<?php foreach ($errors as $er): ?><p class="notice notice--error" role="alert"><?= e($er) ?></p><?php endforeach; ?>

<form method="post" class="editor-layout" data-track-changes id="post-form">
  <?= csrf_field() ?>
  <input type="hidden" name="id" value="<?= (int)($v['id'] ?? 0) ?>">
  <div class="editor-main">
    <input class="title-input" name="title" value="<?= e($v['title']) ?>" placeholder="כותרת המאמר" required aria-label="כותרת" data-slug-source>
    <p class="slug-line muted small">
      כתובת:
      <?php if ($slugLocked): ?>
        <span dir="ltr"><?= e(rawurldecode(site_url() . $v['path'])) ?></span> <span class="hint">(קבועה, כדי לשמור על הקידום)</span>
      <?php else: ?>
        <span dir="ltr"><?= e(site_url()) ?>/</span><input name="slug" value="<?= e(trim((string)$v['path'], '/')) ?>" placeholder="נוצרת אוטומטית מהכותרת" data-slug class="slug-input">/
      <?php endif; ?>
    </p>
    <div class="rte" data-rte data-name="body" data-label="תוכן המאמר"></div>
    <textarea name="body" hidden><?= e($bodyForEditor) ?></textarea>
    <p class="muted small">טיפ: כדי להוסיף סרטון, הדביקו קישור יוטיוב בשורה נפרדת. טקסט שמודבק מוורד או מאתר אחר מגיע נקי.</p>
  </div>

  <aside class="editor-side">
    <section class="panel stack">
      <h2>פרסום</h2>
      <p class="muted small">סטטוס: <b><?= $published ? 'מפורסם באתר' : ($isNew ? 'חדש' : 'טיוטה') ?></b></p>
      <label>תאריך
        <input type="datetime-local" name="date" value="<?= e(date('Y-m-d\TH:i', strtotime((string)$v['date']))) ?>">
      </label>
      <div class="btn-stack">
        <button class="btn" type="submit" name="action" value="publish"><?= $published ? 'עדכון באתר' : 'פרסום באתר' ?></button>
        <button class="btn btn--quiet" type="submit" name="action" value="draft"><?= $published ? 'הורדה מהאתר (לטיוטה)' : 'שמירה כטיוטה' ?></button>
        <button class="btn btn--quiet" type="submit" formaction="/admin/preview.php" formtarget="_blank" name="action" value="preview">תצוגה מקדימה</button>
      </div>
    </section>

    <section class="panel stack">
      <h2>נושאים</h2>
      <div class="checks">
        <?php foreach ($cats as $slug => $name): ?>
          <label class="check"><input type="checkbox" name="categories[]" value="<?= e($slug) ?>"<?= in_array($slug, $v['categories'], true) ? ' checked' : '' ?>> <?= e($name) ?></label>
        <?php endforeach; ?>
      </div>
      <label>תגיות
        <input name="tags" value="<?= e($tagText) ?>" list="tag-list" placeholder="מופרדות בפסיקים">
        <datalist id="tag-list"><?php foreach ($tagNames as $n): ?><option value="<?= e($n) ?>"><?php endforeach; ?></datalist>
      </label>
    </section>

    <section class="panel stack">
      <h2>גוגל</h2>
      <label>תיאור קצר
        <textarea name="excerpt" rows="3" data-count="160" data-min="70" placeholder="משפט או שניים שיופיעו בגוגל וברשימות"><?= e($v['excerpt']) ?></textarea>
        <small data-counter></small>
      </label>
      <label>כותרת לגוגל (לא חובה)
        <input name="seo_title" value="<?= e($v['seo_title']) ?>" placeholder="<?= e(($v['title'] ?: 'כותרת המאמר') . SITE_TITLE_SUFFIX) ?>">
      </label>
    </section>

    <?php if (!$isNew): ?>
      <section class="panel">
        <h2>גרסאות קודמות</h2>
        <p class="small"><a href="/admin/revisions.php?path=<?= e(rawurlencode($v['path'])) ?>">היסטוריית שינויים ושחזור</a></p>
        <button type="submit" form="delete-form" class="linklike linklike--danger small">מחיקת המאמר</button>
      </section>
    <?php endif; ?>
  </aside>
</form>
<?php if (!$isNew): ?>
<form method="post" id="delete-form" data-confirm="<?= !empty($v['wp_id']) ? 'המאמר הזה היה באתר הקודם וייתכן שמדורג בגוגל. מחיקה תגרום לקישורים אליו להפסיק לעבוד. למחוק בכל זאת?' : 'למחוק את המאמר לצמיתות?' ?>">
  <?= csrf_field() ?><input type="hidden" name="id" value="<?= (int)$v['id'] ?>"><input type="hidden" name="action" value="delete">
</form>
<?php endif; ?>
<?php admin_footer(['editor']);
