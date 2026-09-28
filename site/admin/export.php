<?php
/** Download leads as CSV (opens in Excel with Hebrew intact thanks to the BOM). */
declare(strict_types=1);
require __DIR__ . '/_lib/bootstrap.php';

require_login();
$status = array_key_exists($_GET['status'] ?? '', LEAD_STATUSES) ? $_GET['status'] : '';
$source = array_key_exists($_GET['source'] ?? '', LEAD_SOURCES) ? $_GET['source'] : '';
$where = [];
$args = [];
if ($status) { $where[] = 'status = ?'; $args[] = $status; }
if ($source) { $where[] = '(product = ? OR (product IS NULL AND kind = ?))'; $args[] = $source; $args[] = $source; }
$st = db()->prepare('SELECT * FROM leads' . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY created_at DESC');
$st->execute($args);

header('Content-Type: text/csv; charset=utf-8');
header('Content-Disposition: attachment; filename="leads-' . date('Y-m-d') . '.csv"');
header('Cache-Control: no-store');
$out = fopen('php://output', 'w');
fwrite($out, "\xEF\xBB\xBF");
fputcsv($out, ['תאריך', 'שם', 'טלפון', 'מייל', 'מקור', 'סטטוס', 'הודעה', 'הערות', 'עמוד'], ',', '"', '');
// Cells that start with = + - @ would run as formulas in Excel; prefix them.
$safe = fn($v) => preg_match('/^[=+\-@\t\r]/', (string)$v) ? "'" . $v : (string)$v;
while ($l = $st->fetch()) {
    fputcsv($out, array_map($safe, [
        $l['created_at'], $l['name'], $l['phone'], $l['email'],
        LEAD_SOURCES[$l['product'] ?? $l['kind']] ?? '', LEAD_STATUSES[$l['status']] ?? $l['status'],
        $l['message'], $l['notes'], urldecode((string)$l['page']),
    ]), ',', '"', '');
}
fclose($out);
