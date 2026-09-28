<?php
/**
 * Media library: files live in /wp-content/uploads/YYYY/MM/, the same place
 * WordPress kept them, so old image links keep working.
 */
declare(strict_types=1);

const MEDIA_IMAGE_TYPES = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'image/gif' => 'gif'];
const MEDIA_OTHER_TYPES = ['application/pdf' => 'pdf', 'video/mp4' => 'mp4'];
const MEDIA_MAX_SIDE = 2400;

function uploads_dir(): string
{
    $dir = site_root() . '/wp-content/uploads';
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    // Never execute anything uploaded.
    $ht = $dir . '/.htaccess';
    if (!is_file($ht)) {
        @file_put_contents($ht, "Options -Indexes -ExecCGI\nRemoveHandler .php .phtml .php5 .phar\nRemoveType .php .phtml .php5 .phar\n"
            . "<FilesMatch \"\\.(php|phtml|php5|phar|pl|py|cgi|sh|shtml|html?|svg)$\">\nRequire all denied\n</FilesMatch>\n"
            . "php_flag engine off\n");
    }
    return $dir;
}

function media_url(string $file): string
{
    return '/wp-content/uploads/' . ltrim(substr($file, strlen(uploads_dir())), '/');
}

/** All files, newest first. */
function media_list(string $q = ''): array
{
    $root = uploads_dir();
    $out = [];
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS));
    foreach ($it as $f) {
        if (!$f->isFile()) continue;
        $ext = strtolower($f->getExtension());
        if (!in_array($ext, ['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf', 'mp4'], true)) continue;
        $name = $f->getFilename();
        // Skip the thumbnail sizes WordPress generated (name-300x200.jpg).
        if (preg_match('/-\d{2,4}x\d{2,4}\.\w+$/', $name)) continue;
        if ($q !== '' && mb_stripos($name, $q) === false) continue;
        $out[] = [
            'url' => media_url($f->getPathname()),
            'name' => $name,
            'size' => $f->getSize(),
            'time' => $f->getMTime(),
            'image' => in_array($ext, ['jpg', 'jpeg', 'png', 'webp', 'gif'], true),
        ];
    }
    usort($out, fn($a, $b) => $b['time'] <=> $a['time']);
    return $out;
}

function media_safe_name(string $original, string $ext): string
{
    $base = pathinfo($original, PATHINFO_FILENAME);
    $base = preg_replace('/[^\p{L}\p{N}_-]+/u', '-', $base);
    $base = trim(mb_substr((string)$base, 0, 60), '-') ?: 'file';
    return $base . '.' . $ext;
}

function media_target(string $name): string
{
    $dir = uploads_dir() . '/' . date('Y') . '/' . date('m');
    if (!is_dir($dir)) mkdir($dir, 0755, true);
    $target = $dir . '/' . $name;
    $i = 1;
    while (file_exists($target)) {
        $target = $dir . '/' . pathinfo($name, PATHINFO_FILENAME) . '-' . (++$i) . '.' . pathinfo($name, PATHINFO_EXTENSION);
    }
    return $target;
}

/**
 * Store one uploaded file. Images are checked, turned the right way up,
 * shrunk to a sensible size and re-saved (which also drops location data
 * from phone photos). Returns the public URL.
 */
function media_store(string $tmp, string $original): string
{
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($tmp) ?: '';
    if (isset(MEDIA_OTHER_TYPES[$mime])) {
        $target = media_target(media_safe_name($original, MEDIA_OTHER_TYPES[$mime]));
        if (!move_uploaded_file($tmp, $target) && !rename($tmp, $target)) throw new RuntimeException('השמירה נכשלה');
        @chmod($target, 0644);
        return media_url($target);
    }
    if (!isset(MEDIA_IMAGE_TYPES[$mime]) || !($info = @getimagesize($tmp))) {
        throw new RuntimeException('סוג הקובץ לא נתמך. אפשר להעלות תמונות (JPG, PNG, WEBP, GIF), PDF או MP4.');
    }
    $ext = MEDIA_IMAGE_TYPES[$mime];
    $target = media_target(media_safe_name($original, $ext));

    if ($ext === 'gif' || !function_exists('imagecreatefromstring')) {
        if (!move_uploaded_file($tmp, $target) && !rename($tmp, $target)) throw new RuntimeException('השמירה נכשלה');
        @chmod($target, 0644);
        return media_url($target);
    }
    $img = @imagecreatefromstring((string)file_get_contents($tmp));
    if (!$img) throw new RuntimeException('לא הצלחנו לקרוא את התמונה.');
    if ($ext === 'jpg' && function_exists('exif_read_data')) {
        $o = (int)(@exif_read_data($tmp)['Orientation'] ?? 1);
        $img = match ($o) { 3 => imagerotate($img, 180, 0), 6 => imagerotate($img, -90, 0), 8 => imagerotate($img, 90, 0), default => $img };
    }
    [$w, $h] = [imagesx($img), imagesy($img)];
    if (max($w, $h) > MEDIA_MAX_SIDE) {
        $ratio = MEDIA_MAX_SIDE / max($w, $h);
        $img = imagescale($img, (int)round($w * $ratio), (int)round($h * $ratio), IMG_BICUBIC);
    }
    if ($ext === 'png' || $ext === 'webp') {
        imagealphablending($img, false);
        imagesavealpha($img, true);
    }
    $ok = match ($ext) {
        'jpg' => imagejpeg($img, $target, 85),
        'png' => imagepng($img, $target, 8),
        'webp' => imagewebp($img, $target, 82),
    };
    imagedestroy($img);
    if (!$ok) throw new RuntimeException('השמירה נכשלה');
    @chmod($target, 0644);
    return media_url($target);
}

/**
 * Restore a ZIP of the old wp-content/uploads folder, keeping every path
 * as it was so the old image links work again.
 */
function media_import_zip(string $zipFile, bool $overwrite): array
{
    if (!class_exists('ZipArchive')) throw new RuntimeException('השרת לא תומך בקבצי ZIP.');
    $zip = new ZipArchive();
    if ($zip->open($zipFile) !== true) throw new RuntimeException('לא הצלחנו לפתוח את קובץ ה־ZIP.');
    $root = uploads_dir();
    $added = $skipped = 0;
    for ($i = 0; $i < $zip->numFiles; $i++) {
        $name = str_replace('\\', '/', (string)$zip->getNameIndex($i));
        if (str_ends_with($name, '/')) continue;
        // Accept "wp-content/uploads/2018/07/x.jpg", "uploads/2018/07/x.jpg" or "2018/07/x.jpg".
        $rel = preg_replace('#^.*?(?:wp-content/)?uploads/#', '', $name);
        $ext = strtolower(pathinfo($rel, PATHINFO_EXTENSION));
        if (!in_array($ext, ['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf', 'mp4'], true)
            || str_contains($rel, '..') || str_starts_with($rel, '/') || preg_match('#(^|/)\.#', $rel)) {
            $skipped++;
            continue;
        }
        $target = $root . '/' . $rel;
        if (file_exists($target) && !$overwrite) { $skipped++; continue; }
        if (!is_dir(dirname($target))) mkdir(dirname($target), 0755, true);
        $in = $zip->getStream($zip->getNameIndex($i));
        if (!$in) { $skipped++; continue; }
        $out = fopen($target, 'wb');
        stream_copy_to_stream($in, $out);
        fclose($out);
        fclose($in);
        @chmod($target, 0644);
        $added++;
    }
    $zip->close();
    return [$added, $skipped];
}

function human_size(int $b): string
{
    return $b > 1048576 ? round($b / 1048576, 1) . ' MB' : max(1, (int)round($b / 1024)) . ' KB';
}
