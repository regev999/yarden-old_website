<?php
declare(strict_types=1);
require __DIR__ . '/_lib/bootstrap.php';
require __DIR__ . '/_lib/layout.php';

$user = require_login();
content_migrate();

$editId = isset($_GET['edit']) ? (int)$_GET['edit'] : null;   // 0 = new

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_csrf();
    $action = $_POST['action'] ?? '';
    $id = (int)($_POST['id'] ?? 0);

    if ($action === 'save') {
        $name = trim((string)($_POST['name'] ?? ''));
        $role = trim((string)($_POST['role'] ?? ''));
        $body = sanitize_html((string)($_POST['body'] ?? ''));
        $home = !empty($_POST['show_on_home']) ? 1 : 0;
        $pub = !empty($_POST['published']) ? 1 : 0;
        if (plain($body) === '') {
            flash('חסר טקסט להמלצה.', 'error');
            redirect('/admin/testimonials.php?edit=' . $id);
        }
        if ($id) {
            db()->prepare('UPDATE testimonials SET name=?, role=?, body=?, show_on_home=?, published=? WHERE id=?')->execute([$name, $role, $body, $home, $pub, $id]);
        } else {
            $pos = (int)db()->query('SELECT COALESCE(MIN(position), 0) - 1 FROM testimonials')->fetchColumn();   // new ones go first
            db()->prepare('INSERT INTO testimonials(name, role, body, show_on_home, published, position, created_at) VALUES(?,?,?,?,?,?,?)')
                ->execute([$name, $role, $body, $home, $pub, $pos, now()]);
        }
        refresh_testimonials();
        log_activity($id ? 'עדכן המלצה' : 'הוסיף המלצה', $name ?: 'ללא שם', '/admin/testimonials.php');
        flash('ההמלצה נשמרה ומוצגת באתר.');
    } elseif ($action === 'delete' && $id) {
        db()->prepare('DELETE FROM testimonials WHERE id = ?')->execute([$id]);
        refresh_testimonials();
        log_activity('מחק המלצה');
        flash('ההמלצה נמחקה.');
    } elseif (in_array($action, ['up', 'down'], true) && $id) {
        $list = testimonials();
        $ids = array_column($list, 'id');
        $i = array_search($id, $ids);
        $j = $action === 'up' ? $i - 1 : $i + 1;
        if ($i !== false && isset($ids[$j])) {
            [$ids[$i], $ids[$j]] = [$ids[$j], $ids[$i]];
            $st = db()->prepare('UPDATE testimonials SET position = ? WHERE id = ?');
            foreach ($ids as $pos => $tid) $st->execute([$pos, $tid]);
            refresh_testimonials();
        }
    } elseif ($action === 'toggle-home' && $id) {
        db()->prepare('UPDATE testimonials SET show_on_home = 1 - show_on_home WHERE id = ?')->execute([$id]);
        refresh_testimonials();
    }
    redirect('/admin/testimonials.php' . ($action === 'save' ? '' : '#t' . $id));
}

if ($editId !== null) {
    $t = ['id' => 0, 'name' => '', 'role' => '', 'body' => '', 'show_on_home' => 0, 'published' => 1];
    if ($editId) {
        $st = db()->prepare('SELECT * FROM testimonials WHERE id = ?');
        $st->execute([$editId]);
        $t = $st->fetch() ?: $t;
    }
    admin_header($editId ? 'עריכת המלצה' : 'המלצה חדשה', 'testimonials', $user);
    ?>
    <p class="back"><a href="/admin/testimonials.php">חזרה לכל ההמלצות</a></p>
    <form method="post" class="panel stack narrow-form" data-track-changes>
      <?= csrf_field() ?><input type="hidden" name="action" value="save"><input type="hidden" name="id" value="<?= (int)$t['id'] ?>">
      <label>שם <input name="name" value="<?= e($t['name']) ?>" placeholder="למשל: מיכל כהן"></label>
      <label>תיאור קצר (לא חובה) <input name="role" value="<?= e($t['role']) ?>" placeholder="למשל: תלמידת קורס התמקדות, 2025"></label>
      <div>
        <p class="label">הטקסט</p>
        <div class="rte" data-rte data-name="body" data-label="טקסט ההמלצה"></div>
        <textarea name="body" hidden><?= e(html_for_editor($t['body'])) ?></textarea>
      </div>
      <label class="check"><input type="checkbox" name="published" value="1"<?= $t['published'] ? ' checked' : '' ?>> להציג באתר</label>
      <label class="check"><input type="checkbox" name="show_on_home" value="1"<?= $t['show_on_home'] ? ' checked' : '' ?>> להציג גם בדף הבית (עדיף המלצות קצרות)</label>
      <button class="btn" type="submit">שמירה</button>
    </form>
    <?php
    admin_footer(['editor']);
    exit;
}

$list = testimonials();
admin_header('המלצות', 'testimonials', $user, '<a class="btn" href="/admin/testimonials.php?edit=0">המלצה חדשה</a>');
?>
<p class="muted">ההמלצות מוצגות בעמוד <a href="/לקוחות-מספרים/" target="_blank" rel="noopener">לקוחות מספרים</a> לפי הסדר כאן. המסומנות "בדף הבית" מתחלפות בדף הבית.</p>
<ol class="t-list">
  <?php foreach ($list as $i => $t): ?>
    <li id="t<?= (int)$t['id'] ?>" class="t-item<?= $t['published'] ? '' : ' is-hidden' ?>">
      <div class="t-item__text">
        <p><?= e(plain($t['body'], 220)) ?></p>
        <p class="small"><b><?= e($t['name'] ?: 'ללא שם') ?></b><?= $t['role'] ? ' · ' . e($t['role']) : '' ?>
          <?php if (!$t['published']): ?><span class="tag tag--closed">מוסתרת</span><?php endif; ?>
          <?php if ($t['show_on_home']): ?><span class="tag tag--new">בדף הבית</span><?php endif; ?></p>
      </div>
      <div class="t-item__actions">
        <a href="?edit=<?= (int)$t['id'] ?>">עריכה</a>
        <form method="post" class="inline"><?= csrf_field() ?><input type="hidden" name="id" value="<?= (int)$t['id'] ?>">
          <button class="icon-btn" name="action" value="up" title="למעלה" aria-label="להזיז למעלה"<?= $i === 0 ? ' disabled' : '' ?>>↑</button>
          <button class="icon-btn" name="action" value="down" title="למטה" aria-label="להזיז למטה"<?= $i === count($list) - 1 ? ' disabled' : '' ?>>↓</button>
          <button class="linklike small" name="action" value="toggle-home"><?= $t['show_on_home'] ? 'להוריד מדף הבית' : 'להציג בדף הבית' ?></button>
        </form>
        <form method="post" class="inline" data-confirm="למחוק את ההמלצה?"><?= csrf_field() ?><input type="hidden" name="id" value="<?= (int)$t['id'] ?>">
          <button class="linklike linklike--danger small" name="action" value="delete">מחיקה</button>
        </form>
      </div>
    </li>
  <?php endforeach; ?>
</ol>
<?php admin_footer();
