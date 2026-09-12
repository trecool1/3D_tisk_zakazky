<?php
declare(strict_types=1);

// Hromadné stažení modelů pro tiskovou úlohu nebo požadavek na výrobu — jeden
// ZIP se všemi potřebnými soubory, ať je obsluha jen přetáhne do sliceru.
// ?p[]=<polozka id>… a/nebo ?uloha=<id> (podle uloha_polozky té úlohy).

require __DIR__ . '/../kanban-app/bootstrap.php';
require KANBAN_APP . '/lib/auth.php';

vyzadujPrihlaseni();

$idPolozek = array_map('intval', (array)($_GET['p'] ?? []));
$ulohaId   = (int)($_GET['uloha'] ?? 0);
if ($ulohaId > 0) {
  $q = db()->prepare('SELECT polozka_id FROM uloha_polozky WHERE uloha_id = ?');
  $q->execute([$ulohaId]);
  $idPolozek = array_merge($idPolozek, $q->fetchAll(PDO::FETCH_COLUMN));
}
$idPolozek = array_values(array_unique(array_filter($idPolozek)));
if (!$idPolozek) { http_response_code(400); exit('Chybí seznam dílů.'); }

$placeholders = implode(',', array_fill(0, count($idPolozek), '?'));
$q = db()->prepare(
  "SELECT DISTINCT s.nazev, s.cesta FROM soubory s
     JOIN polozky p ON p.zakazka_id = s.zakazka_id AND p.nazev = s.nazev
    WHERE p.id IN ($placeholders)");
$q->execute($idPolozek);
$soubory = $q->fetchAll();
if (!$soubory) { http_response_code(404); exit('K těmto dílům nejsou nahrané žádné soubory.'); }

$zaklad = realpath((string)cfg('modely'));
$tmp    = tempnam(sys_get_temp_dir(), 'kanban-zip-') . '.zip';
$cmd    = 'zip -j -q ' . escapeshellarg($tmp);
$pridano = [];
foreach ($soubory as $f) {
  $cesta = $zaklad !== false ? realpath($zaklad . '/' . $f['cesta']) : false;
  if ($cesta === false || !str_starts_with($cesta, $zaklad . DIRECTORY_SEPARATOR)) continue;
  // stejně pojmenovaný model z různých zakázek je fyzicky tentýž katalogový díl —
  // do ZIPu jde jednou, počet kusů obsluha nastaví přímo ve sliceru
  if (isset($pridano[$f['nazev']])) continue;
  $pridano[$f['nazev']] = true;
  $cmd .= ' ' . escapeshellarg($cesta);
}
if (!$pridano) { http_response_code(404); exit('Soubory se nepodařilo najít na disku.'); }

exec($cmd . ' 2>&1', $vystup, $kod);
if ($kod !== 0 || !is_file($tmp)) {
  zaloguj('ZIP modelů selhal: ' . implode(' ', $vystup));
  http_response_code(500); exit('ZIP se nepodařilo vytvořit.');
}

zaloguj('STAŽENÍ ZIP (' . count($pridano) . ' modelů) — ' . mojeJmeno());

header('Content-Type: application/zip');
header('Content-Length: ' . filesize($tmp));
header('Content-Disposition: attachment; filename="modely.zip"');
header('X-Content-Type-Options: nosniff');
readfile($tmp);
@unlink($tmp);
