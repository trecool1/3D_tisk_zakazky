<?php
declare(strict_types=1);
// Denní záloha databáze a nahraných souborů.
require dirname(__DIR__) . '/bootstrap.php';

$cil = rtrim((string)cfg('zalohy'), '/');
if (!is_dir($cil)) @mkdir($cil, 0770, true);

$znacka = date('Y-m-d');

// databáze — konzistentní kopie přes VACUUM INTO, ne prosté cp (kvůli WAL)
$dbCil = $cil . '/kanban-' . $znacka . '.sqlite';
@unlink($dbCil);
db()->exec('VACUUM INTO ' . db()->quote($dbCil));
@chmod($dbCil, 0640);

// modely
$modely = rtrim((string)cfg('modely'), '/');
$tarCil = $cil . '/modely-' . $znacka . '.tar.gz';
if (is_dir($modely)) {
  $cmd = sprintf('tar -czf %s -C %s . 2>&1', escapeshellarg($tarCil), escapeshellarg($modely));
  exec($cmd, $vystup, $kod);
  if ($kod !== 0) zaloguj('ZÁLOHA modelů selhala: ' . implode(' ', $vystup));
  @chmod($tarCil, 0640);
}

// úklid starých záloh
$drzet = (int)cfg('zalohDnu', 14);
foreach (glob($cil . '/*') ?: [] as $f) {
  if (is_file($f) && filemtime($f) < time() - $drzet * 86400) @unlink($f);
}

zaloguj('CRON záloha: ' . basename($dbCil) . ' + ' . basename($tarCil));
echo "záloha hotova: $dbCil\n";
