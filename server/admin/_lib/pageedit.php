<?php
/**
 * Inline editing of the static pages. Editable blocks are found in the page
 * HTML by their opening tags (text blocks, headings, card texts) inside
 * <main>, skipping forms, videos and regions that are rebuilt automatically
 * (<!--yk:...--> lists). The same scan runs when the page is opened and when
 * it is saved, so block numbers always match the same file version.
 */
declare(strict_types=1);

/** Opening-tag patterns, in priority order: rich blocks first, then single lines. */
const EDIT_PATTERNS = [
    ['rich', '#<div class="(?:prose|card__body prose|body|vision)"[^>]*>#'],
    ['rich', '#<dl\b[^>]*>#'],
    ['inline', '#<h[1-4]\b[^>]*>#'],
    ['inline', '#<p class="(?:lead|page-hero__sub|hero__place|way__kind|motto|crumb)"[^>]*>#'],
    ['inline', '#<span class="methods__(?:name|desc)"[^>]*>#'],
    ['inline', '#<figcaption\b[^>]*>#'],
];

/** Find the end of the element that opens at $pos (handles nesting of the same tag). */
function element_end(string $html, int $pos, string $tag): ?array
{
    $openLen = strpos($html, '>', $pos) - $pos + 1;
    $depth = 0;
    $re = '#<(/?)' . $tag . '\b[^>]*>#i';
    $offset = $pos;
    while (preg_match($re, $html, $m, PREG_OFFSET_CAPTURE, $offset)) {
        $at = $m[0][1];
        if ($m[1][0] === '') $depth++; else $depth--;
        $offset = $at + strlen($m[0][0]);
        if ($depth === 0) return [$pos + $openLen, $at, $offset];   // inner start, inner end, element end
    }
    return null;
}

/** Scan a page and list its editable blocks: [kind, tag, innerStart, innerEnd]. */
function editable_blocks(string $html): array
{
    $mainStart = strpos($html, '<main');
    $mainEnd = strrpos($html, '</main>');
    if ($mainStart === false || $mainEnd === false) return [];

    // Ranges that must not be edited.
    $blocked = [];
    foreach (['#<!--yk:(\w+)-->.*?<!--/yk:\1-->#s', '#<section class="[^"]*block--contact[^"]*".*?</section>#s', '#<form\b.*?</form>#s', '#<div class="video".*?</button></div>#s', '#<nav\b.*?</nav>#s', '#<script\b.*?</script>#s'] as $re) {
        if (preg_match_all($re, $html, $mm, PREG_OFFSET_CAPTURE)) {
            foreach ($mm[0] as $m) $blocked[] = [$m[1], $m[1] + strlen($m[0])];
        }
    }
    $inside = function (int $pos, array $ranges): bool {
        foreach ($ranges as [$a, $b]) if ($pos >= $a && $pos < $b) return true;
        return false;
    };

    $found = [];
    foreach (EDIT_PATTERNS as [$kind, $re]) {
        if (!preg_match_all($re, $html, $mm, PREG_OFFSET_CAPTURE, $mainStart)) continue;
        foreach ($mm[0] as $m) {
            $pos = $m[1];
            if ($pos > $mainEnd || $inside($pos, $blocked)) continue;
            preg_match('#^<(\w+)#', $m[0], $t);
            $tag = strtolower($t[1]);
            $end = element_end($html, $pos, $tag);
            if (!$end) continue;
            $found[] = [$kind, $tag, $end[0], $end[1], $pos];
            $blocked[] = [$pos, $end[2]];        // nothing inside a chosen block is picked again
        }
    }
    usort($found, fn($a, $b) => $a[4] <=> $b[4]);
    return $found;
}

/** Page HTML with data-yk-edit markers, for the editing view. */
function page_with_markers(string $html): string
{
    $blocks = editable_blocks($html);
    // Insert from the end so earlier offsets stay valid.
    foreach (array_reverse($blocks, true) as $i => [$kind, $tag, $inner, , $pos]) {
        $tagEnd = $inner - 1;   // position of '>' of the opening tag
        $html = substr($html, 0, $tagEnd) . ' data-yk-edit="' . $i . '" data-yk-kind="' . $kind . '"' . substr($html, $tagEnd);
    }
    return $html;
}

/** Apply edited blocks ({index: html}) to the page HTML. */
function apply_block_edits(string $html, array $edits): string
{
    $blocks = editable_blocks($html);
    krsort($edits, SORT_NUMERIC);
    foreach ($edits as $i => $content) {
        $i = (int)$i;
        if (!isset($blocks[$i]) || !is_string($content)) continue;
        [$kind, $tag, $inner, $innerEnd] = $blocks[$i];
        $clean = $kind === 'rich' && $tag !== 'dl' ? sanitize_html($content) : sanitize_html($content, true);
        if ($tag === 'dl') $clean = sanitize_dl($content);
        $html = substr($html, 0, $inner) . $clean . substr($html, $innerEnd);
    }
    return $html;
}

/** Definition lists keep their dt/dd structure; only the text inside is edited. */
function sanitize_dl(string $html): string
{
    if (!preg_match_all('#<(dt|dd)\b[^>]*>(.*?)</\1>#s', $html, $mm, PREG_SET_ORDER)) return '';
    $out = '';
    foreach ($mm as $m) $out .= '<' . $m[1] . '>' . sanitize_html($m[2], true) . '</' . $m[1] . '>';
    return $out;
}
