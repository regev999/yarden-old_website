<?php
declare(strict_types=1);
require __DIR__ . '/_lib/bootstrap.php';
require __DIR__ . '/_lib/layout.php';

$user = require_login();

$status = array_key_exists($_GET['status'] ?? '', LEAD_STATUSES) ? $_GET['status'] : '';
$source = array_key_exists($_GET['source'] ?? '', LEAD_SOURCES) ? $_GET['source'] : '';
$q = trim((string)($_GET['q'] ?? ''));

$where = [];
$args = [];
if ($status) { $where[] = 'status = ?'; $args[] = $status; }
if ($source) { $where[] = '(product = ? OR (product IS NULL AND kind = ?))'; $args[] = $source; $args[] = $source; }
if ($q !== '') {
    $where[] = '(name LIKE ? OR phone LIKE ? OR email LIKE ? OR message LIKE ? OR notes LIKE ?)';
    array_push($args, ...array_fill(0, 5, '%' . $q . '%'));
}
$sql = 'SELECT * FROM leads' . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY created_at DESC LIMIT 500';
$st = db()->prepare($sql);
$st->execute($args);
$leads = $st->fetchAll();

$query = http_build_query(array_filter(['status' => $status, 'source' => $source, 'q' => $q]));
admin_header('לידים', 'leads', $user);
?>
<form class="filters" method="get">
  <label>סטטוס
    <select name="status" data-autosubmit>
      <option value="">הכל</option>
      <?php foreach (LEAD_STATUSES as $k => $label): ?>
        <option value="<?= e($k) ?>"<?= $k === $status ? ' selected' : '' ?>><?= e($label) ?></option>
      <?php endforeach; ?>
    </select>
  </label>
  <label>מקור
    <select name="source" data-autosubmit>
      <option value="">הכל</option>
      <?php foreach (LEAD_SOURCES as $k => $label): ?>
        <option value="<?= e($k) ?>"<?= $k === $source ? ' selected' : '' ?>><?= e($label) ?></option>
      <?php endforeach; ?>
    </select>
  </label>
  <label class="filters__search">חיפוש
    <input type="search" name="q" value="<?= e($q) ?>" placeholder="שם, טלפון, מייל או מילה מההודעה">
  </label>
  <button class="btn btn--quiet" type="submit">סינון</button>
  <a class="filters__export" href="/admin/export.php<?= $query ? '?' . e($query) : '' ?>">הורדה לאקסל (CSV)</a>
</form>

<?php if (!$leads): ?>
  <p class="empty"><?= $where ? 'אין לידים שמתאימים לסינון.' : 'עוד לא הגיעו לידים. כשמישהו ימלא טופס באתר, הוא יופיע כאן.' ?></p>
<?php else: ?>
  <div class="table-wrap">
    <table class="table">
      <thead><tr><th>תאריך</th><th>שם</th><th>טלפון</th><th>מייל</th><th>מקור</th><th>סטטוס</th></tr></thead>
      <tbody>
        <?php foreach ($leads as $l): $href = '/admin/lead.php?id=' . (int)$l['id']; ?>
          <tr data-href="<?= e($href) ?>">
            <td class="nowrap"><?= e(he_date($l['created_at'])) ?></td>
            <td><a href="<?= e($href) ?>"><?= e($l['name'] ?: 'ללא שם') ?></a></td>
            <td dir="ltr" class="nowrap"><?php if ($l['phone']): ?><a href="tel:<?= e(preg_replace('/[^\d+]/', '', $l['phone'])) ?>"><?= e($l['phone']) ?></a><?php endif; ?></td>
            <td dir="ltr"><?php if ($l['email']): ?><a href="mailto:<?= e($l['email']) ?>"><?= e($l['email']) ?></a><?php endif; ?></td>
            <td><?= e(LEAD_SOURCES[$l['product'] ?? $l['kind']] ?? '') ?></td>
            <td><span class="tag tag--<?= e($l['status']) ?>"><?= e(LEAD_STATUSES[$l['status']] ?? $l['status']) ?></span></td>
          </tr>
        <?php endforeach; ?>
      </tbody>
    </table>
  </div>
  <p class="muted"><?= count($leads) ?> לידים<?= count($leads) === 500 ? ' (מוצגים 500 האחרונים)' : '' ?></p>
<?php endif; ?>
<?php admin_footer();
