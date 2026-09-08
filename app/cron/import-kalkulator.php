<?php
declare(strict_types=1);

// Přenese poptávky, které kalkulátor už uložil do svého adresáře, do kanbanu.
// Díky tomu je kanban použitelný ještě dřív, než se v pricing.json přepne
// orderEndpoint — a při přepnutí se nic neztratí (podle čísla se nic nezdvojí).

require dirname(__DIR__) . '/bootstrap.php';
require KANBAN_APP . '/lib/auth.php';
require KANBAN_APP . '/lib/zakazky.php';
require KANBAN_APP . '/lib/pricing.php';
require KANBAN_APP . '/lib/mail.php';
require KANBAN_APP . '/lib/prijem.php';

// při prvním importu historie nechceme rozeslat staré potvrzovací e-maily;
// funkce odesílání to poznají podle konstanty (nelze je předefinovat, jsou už načtené)
if (in_array('--bez-mailu', $argv ?? [], true)) define('KANBAN_TICHA_POSTA', true);

$dir  = rtrim((string)cfg('kalkulatorDir'), '/');
$json = $dir . '/objednavky.json';
if (!is_file($json)) { fwrite(STDERR, "Soubor $json neexistuje.\n"); exit(1); }

$objednavky = jsonDek(file_get_contents($json), []);
$novych = 0; $preskocenych = 0;

foreach ($objednavky as $d) {
  $cislo = (string)($d['orderNo'] ?? '');
  if ($cislo === '' || zakazkaPodleCisla($cislo)) { $preskocenych++; continue; }

  // modely, které u poptávky leží v adresáři kalkulátoru — kopírujeme, nepřesouváme
  $soubory = [];
  $zdroj = $dir . '/' . $cislo;
  if (is_dir($zdroj)) {
    foreach (scandir($zdroj) ?: [] as $f) {
      if ($f === '.' || $f === '..' || $f[0] === '.') continue;
      $tmp = sys_get_temp_dir() . '/kanban-import-' . bin2hex(random_bytes(6));
      if (@copy($zdroj . '/' . $f, $tmp)) $soubory[] = ['nazev' => $f, 'tmp' => $tmp, 'presun' => false];
    }
  }

  try {
    $z = prijmiPoptavku($d, $soubory);
    // stav z kalkulátoru, pokud ho poslal
    if (!empty($d['status']) && $d['status'] !== 'prijata') {
      $mapa = ['nabidka' => 'nabidka', 'schvalena' => 'schvaleno', 'vyroba' => 'fronta',
               'expedovana' => 'expedice', 'hotova' => 'hotovo', 'zrusena' => 'odlozeno'];
      if (isset($mapa[$d['status']])) {
        db()->prepare('UPDATE zakazky SET stav = ? WHERE id = ?')->execute([$mapa[$d['status']], (int)$z['id']]);
      }
    }
    if (!empty($d['assignee'])) {
      db()->prepare('UPDATE zakazky SET prirazeno = ? WHERE id = ?')->execute([(string)$d['assignee'], (int)$z['id']]);
    }
    $novych++;
    echo "importováno $cislo\n";
  } catch (Throwable $e) {
    fwrite(STDERR, "chyba u $cislo: " . $e->getMessage() . "\n");
  }
}

zaloguj("CRON import z kalkulátoru: nových $novych, přeskočeno $preskocenych");
echo "hotovo: nových $novych, přeskočeno $preskocenych\n";
