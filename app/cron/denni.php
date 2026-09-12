<?php
declare(strict_types=1);
// Denní přehled ráno: co se má dnes tisknout, co expedovat, co je po termínu.
// Plus hlídání karet, které spadly do kritické priority.
require dirname(__DIR__) . '/bootstrap.php';
require KANBAN_APP . '/lib/auth.php';
require KANBAN_APP . '/lib/zakazky.php';
require KANBAN_APP . '/lib/pricing.php';
require KANBAN_APP . '/lib/mail.php';

$dnes  = date('Y-m-d');

$tisk = []; $expedice = []; $poTerminu = []; $kriticke = [];

foreach (db()->query('SELECT * FROM zakazky WHERE stav NOT IN ("hotovo","odlozeno")') as $z) {
  $radek = $z['cislo'] . ' · ' . ($z['zak_firma'] !== '' ? $z['zak_firma'] : $z['zak_jmeno'])
         . ' · termín ' . fDatum((string)$z['termin']);

  if (in_array($z['stav'], ['fronta', 'tisk'], true))   $tisk[] = $radek;
  if ($z['stav'] === 'expedice')                        $expedice[] = $radek;
  if (dnyDoTerminu($z) < 0)                             $poTerminu[] = $radek . ' (' . fDny(-dnyDoTerminu($z)) . ' po termínu)';

  // karta právě přešla do kritické priority — upozorníme jednou
  if (prioritaZakazky($z) === 'kriticka') {
    $klic = 'kriticka:' . $z['cislo'];
    $q = db()->prepare('SELECT 1 FROM notifikace WHERE klic = ?');
    $q->execute([$klic]);
    if (!$q->fetchColumn()) {
      db()->prepare('INSERT OR IGNORE INTO notifikace (klic) VALUES (?)')->execute([$klic]);
      $kriticke[] = $radek;
    }
  }
}

$sekce = function (string $nadpis, array $radky): string {
  return $radky ? "\n$nadpis\n  " . implode("\n  ", $radky) . "\n" : '';
};

$telo = "Přehled dílny na " . fDatum($dnes) . "\n"
  . $sekce('VE VÝROBĚ / K TISKU',   $tisk)
  . $sekce('K EXPEDICI DNES',       $expedice)
  . $sekce('PO TERMÍNU',            $poTerminu)
  . $sekce('NOVĚ KRITICKÉ',         $kriticke);

if (trim($telo) !== '' && ($tisk || $expedice || $poTerminu || $kriticke)) {
  upozorniDilnu('Přehled dílny — ' . fDatum($dnes), $telo);
}
zaloguj('CRON denní přehled odeslán');
echo $telo . "\n";
