<?php
declare(strict_types=1);
require __DIR__ . '/_lib/bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    redirect('/admin/');
}
require_csrf();
$_SESSION = [];
session_regenerate_id(true);
session_destroy();
start_session();
flash('יצאתם מהמערכת.');
redirect('/admin/login.php');
