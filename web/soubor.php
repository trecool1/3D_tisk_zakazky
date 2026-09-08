<?php
declare(strict_types=1);

// Stahování modelů. Soubory leží mimo webroot, takže jediná cesta k nim
// vede přes tenhle skript — a ten vyžaduje přihlášení.

require __DIR__ . '/../kanban-app/bootstrap.php';
require KANBAN_APP . '/lib/auth.php';

vyzadujPrihlaseni();

$id = (int)($_GET['id'] ?? 0);
$q  = db()->prepare('SELECT s.*, z.cislo FROM soubory s JOIN zakazky z ON z.id = s.zakazka_id WHERE s.id = ?');
$q->execute([$id]);
$f = $q->fetch();
if (!$f) { http_response_code(404); exit('Soubor nenalezen.'); }

$zaklad = realpath((string)cfg('modely'));
$cesta  = realpath($zaklad . '/' . $f['cesta']);
// pojistka proti vyskočení z adresáře s modely
if ($zaklad === false || $cesta === false || !str_starts_with($cesta, $zaklad . DIRECTORY_SEPARATOR)) {
  http_response_code(404); exit('Soubor nenalezen.');
}

zaloguj('STAŽENÍ ' . $f['cislo'] . '/' . $f['nazev'] . ' — ' . mojeJmeno());

header('Content-Type: application/octet-stream');
header('Content-Length: ' . filesize($cesta));
header('Content-Disposition: attachment; filename="' . rawurlencode((string)$f['nazev']) . '"');
header('X-Content-Type-Options: nosniff');
readfile($cesta);
