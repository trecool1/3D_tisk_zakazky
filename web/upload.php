<?php
declare(strict_types=1);

// Dělené nahrávání modelů z kalkulátoru. Kalkulátor posílá soubor po částech,
// aby nenarazil na limity PHP; poptávka pak přiloží jen jména nahraných souborů.

require __DIR__ . '/../kanban-app/bootstrap.php';

header('Cache-Control: no-store');
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') chyba('Očekává se POST.', 405);

$secret = (string)cfg('orderSecret', '');
if ($secret === '' || $secret === 'ZMEN_ME') chyba('Endpoint není nakonfigurován.', 503);
if (!hash_equals($secret, (string)($_SERVER['HTTP_X_KANBAN_SECRET'] ?? $_POST['secret'] ?? ''))) {
  chyba('Neplatný podpis požadavku.', 403);
}

$nazev = basename((string)($_POST['name'] ?? ''));
$nazev = preg_replace('/[^\w.\- ()]/u', '_', $nazev);
if ($nazev === '' || $nazev === '.' || $nazev === '..') chyba('Chybí jméno souboru.');

$cast  = max(0, (int)($_POST['chunk'] ?? 0));
$casti = max(1, (int)($_POST['chunks'] ?? 1));

if (($_FILES['file']['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) chyba('Část se nenahrála.');

$dir = rtrim((string)cfg('modely'), '/') . '/_nahravky';
if (!is_dir($dir)) @mkdir($dir, 0770, true);

$cil = $dir . '/' . $nazev;
$rezim = $cast === 0 ? 'wb' : 'ab';
$vstup = fopen((string)$_FILES['file']['tmp_name'], 'rb');
$vystup = fopen($cil, $rezim);
if (!$vstup || !$vystup) chyba('Nelze zapsat na disk.', 500);
stream_copy_to_stream($vstup, $vystup);
fclose($vstup); fclose($vystup);
@chmod($cil, 0640);

$hotovo = ($cast + 1) >= $casti;
odesliJson(['ok' => true, 'name' => $nazev, 'chunk' => $cast, 'done' => $hotovo,
            'size' => $hotovo ? (int)@filesize($cil) : null]);
