<?php
declare(strict_types=1);

// Endpoint pro kalkulátor. Přijme poptávku, přidělí definitivní číslo zakázky
// a vrátí ho — kalkulátor ho zobrazí zákazníkovi. Umí obě varianty, které
// kalkulátor posílá: JSON i multipart/form-data s poli payload a file0…fileN.

require __DIR__ . '/../kanban-app/bootstrap.php';
require KANBAN_APP . '/lib/auth.php';
require KANBAN_APP . '/lib/zakazky.php';
require KANBAN_APP . '/lib/pricing.php';
require KANBAN_APP . '/lib/mail.php';
require KANBAN_APP . '/lib/prijem.php';

header('Cache-Control: no-store');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') chyba('Očekává se POST.', 405);

// shared secret nastavený na obou stranách
$secret = (string)cfg('orderSecret', '');
$poslany = $_SERVER['HTTP_X_KANBAN_SECRET'] ?? ($_POST['secret'] ?? '');
if ($secret === '' || $secret === 'ZMEN_ME') {
  zaloguj('ORDER odmítnut: shared secret není nastaven');
  chyba('Endpoint není nakonfigurován.', 503);
}
if (!hash_equals($secret, (string)$poslany)) {
  zaloguj('ORDER odmítnut: špatný secret z ' . ($_SERVER['REMOTE_ADDR'] ?? '?'));
  chyba('Neplatný podpis požadavku.', 403);
}

// tělo: JSON nebo multipart s polem payload
$data = vstupJson();
if (!$data && isset($_POST['payload'])) $data = jsonDek((string)$_POST['payload'], []);
if (!$data) chyba('Prázdná poptávka.');

try {
  $z = prijmiPoptavku($data, prilozeneSoubory());
  odesliJson(['ok' => true, 'orderNo' => $z['cislo'], 'status' => 'prijata',
              'stav' => stavovaUrl($z)]);
} catch (Throwable $e) {
  zaloguj('ORDER chyba: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
  chyba('Poptávku se nepodařilo uložit.', 500);
}

/** Soubory poslané přímo v requestu (fallback, když dělené nahrávání selže). */
function prilozeneSoubory(): array {
  $out = [];
  foreach ($_FILES as $pole => $f) {
    if (!str_starts_with($pole, 'file')) continue;
    if (($f['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) continue;
    $out[] = ['nazev' => basename((string)$f['name']), 'tmp' => (string)$f['tmp_name'], 'presun' => true];
  }
  return $out;
}
