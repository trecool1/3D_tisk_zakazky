<?php
declare(strict_types=1);

// První rozjezd: vytvoří schéma, výchozí sloupce, šablony, nastavení a účty.
// Spouští se z příkazové řádky: php instaluj.php [heslo-admina]

require __DIR__ . '/bootstrap.php';
require KANBAN_APP . '/lib/auth.php';
require KANBAN_APP . '/lib/zakazky.php';
require KANBAN_APP . '/lib/pricing.php';
require KANBAN_APP . '/lib/tiskarny.php';
require KANBAN_APP . '/lib/vyroba.php';

if (PHP_SAPI !== 'cli') { http_response_code(403); exit('Jen z příkazové řádky.'); }

schemaAktualizuj();
echo "schéma připraveno\n";

$sloupce = [
  ['prijato',     'Přijato',            0],
  ['fronta',      'Ve frontě na tisk',  0],
  ['tisk',        'Tiskne se',          0],
  ['postprocess', 'Postprocess',        0],
  ['expedice',    'Expedice',           0],
  ['hotovo',      'Hotovo',             0],
  ['odlozeno',    'Odloženo / Zrušeno', 1],
];
// Migrace ze starého poptávkového trychtýře (nova/nabidka/schváleno): kalkulátor
// dnes posílá rovnou závazné objednávky, takže se všechny tři slévají do Přijato.
if ((int)db()->query("SELECT COUNT(*) FROM sloupce WHERE klic = 'nova'")->fetchColumn() > 0) {
  db()->exec("UPDATE zakazky SET stav = 'prijato' WHERE stav IN ('nova','nabidka','schvaleno')");
  db()->exec("DELETE FROM sloupce WHERE klic IN ('nabidka','schvaleno')");
  db()->exec("UPDATE sloupce SET klic = 'prijato', nazev = 'Přijato' WHERE klic = 'nova'");
  echo "sloupce zmigrovány (nova/nabidka/schvaleno -> prijato)\n";
}
foreach ($sloupce as $i => [$klic, $nazev, $skryt]) {
  db()->prepare('INSERT OR IGNORE INTO sloupce (klic, nazev, poradi, skryt) VALUES (?,?,?,?)')
      ->execute([$klic, $nazev, $i, $skryt]);
  db()->prepare('UPDATE sloupce SET poradi = ? WHERE klic = ?')->execute([$i, $klic]);
}
echo "sloupce připraveny\n";

// dožene sloupec karty podle už existujících tiskových úloh (např. po téhle migraci)
synchronizujStavZakazek(db()->query('SELECT id FROM zakazky')->fetchAll(PDO::FETCH_COLUMN));
echo "stav karet dosynchronizován s výrobou\n";

$sablony = [
  ['potvrzeni', 'Potvrzení poptávky', 'Přijali jsme vaši poptávku [{cislo}]',
   "Dobrý den {jmeno},\npřijali jsme vaši poptávku {cislo}. Ozveme se s nabídkou do 24 hodin.\n\nStav zakázky můžete sledovat zde:\n{odkaz}\n\nS pozdravem\nCadmia3D"],
  ['nabidka', 'Nabídka', 'Nabídka na tisk [{cislo}]',
   "Dobrý den {jmeno},\nposíláme nabídku: {cena} s DPH, termín {termin}.\n\nNabídku můžete potvrdit zde:\n{odkaz}\n\nS pozdravem\nCadmia3D"],
  ['vyzva', 'Výzva k odpovědi', 'Nabídka [{cislo}] — stále platí',
   "Dobrý den {jmeno},\nnabídka {cislo} stále platí. Můžeme ji potvrdit?\n\n{odkaz}\n\nS pozdravem\nCadmia3D"],
  ['tisk', 'Zakázka jde do tisku', 'Zakázka jde do tisku [{cislo}]',
   "Dobrý den {jmeno},\nzakázku {cislo} jsme zařadili do tisku. Termín dodání {termin}.\n\nS pozdravem\nCadmia3D"],
  ['expedovano', 'Expedováno', 'Expedováno [{cislo}]',
   "Dobrý den {jmeno},\nzásilka odešla.\n\nS pozdravem\nCadmia3D"],
];
foreach ($sablony as $i => [$klic, $nazev, $predmet, $telo]) {
  db()->prepare('INSERT OR IGNORE INTO sablony (klic, nazev, predmet, telo, poradi) VALUES (?,?,?,?,?)')
      ->execute([$klic, $nazev, $predmet, $telo, $i]);
}
echo "šablony připraveny\n";

foreach (['prahVysoka' => '24', 'prahNormalni' => '72',
          'infoMaily' => '0', 'infoMailyKam' => '',
          'koopPartner' => '', 'koopLhutaDnu' => '5', 'koopDopravaDnu' => '2', 'davkaPraH' => '0.8'] as $k => $v) {
  db()->prepare('INSERT OR IGNORE INTO nastaveni (klic, hodnota) VALUES (?,?)')->execute([$k, $v]);
}
echo "nastavení připraveno\n";

if ((int)db()->query('SELECT COUNT(*) FROM uzivatele')->fetchColumn() === 0) {
  $heslo = $argv[1] ?? bin2hex(random_bytes(6));
  db()->prepare('INSERT INTO uzivatele (klic, jmeno, email, role, heslo_hash, aktivni) VALUES (?,?,?,?,?,1)')
      ->execute(['admin', 'Správce', (string)cfg('mailFrom'), 'admin', password_hash($heslo, PASSWORD_DEFAULT)]);
  echo "\n===========================================\n";
  echo "  účet:  admin\n  heslo: $heslo\n";
  echo "  Změň heslo v Nastavení → Uživatelé.\n";
  echo "===========================================\n";
} else {
  echo "uživatelé už existují, nechávám beze změny\n";
}

foreach (pricing()['printers'] ?? [] as $p) {
  $klic   = (string)($p['klic'] ?? $p['key'] ?? '');
  if ($klic === '') continue;
  $inHouse = !array_key_exists('inHouse', $p) || $p['inHouse'] !== false;
  db()->prepare('INSERT OR IGNORE INTO tiskarny (klic, nazev, tech, materialy, build_x, build_y, build_z,
                                                  spacing, rate, throughput, in_house, aktivni)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,1)')
      ->execute([$klic, (string)($p['name'] ?? $klic), (string)($p['tech'] ?? ''),
                 jsonEnk((array)($p['materials'] ?? [])),
                 (float)($p['build'][0] ?? 0), (float)($p['build'][1] ?? 0), (float)($p['build'][2] ?? 0),
                 (float)($p['spacing'] ?? 0), (float)($p['rate'] ?? 0), (float)($p['throughput'] ?? 0),
                 $inHouse ? 1 : 0]);
  if (!$inHouse) continue;
  $tiskarnaId = (int)db()->query('SELECT id FROM tiskarny WHERE klic = ' . db()->quote($klic))->fetchColumn();
  db()->prepare('INSERT OR IGNORE INTO stroje (tiskarna_id, oznaceni, aktivni) VALUES (?,?,1)')
      ->execute([$tiskarnaId, $klic . '-1']);
}
echo "tiskárny a stroje připraveny\n";

foreach ([cfg('modely'), cfg('zalohy')] as $d) {
  if (!is_dir($d)) { @mkdir($d, 0770, true); echo "vytvořen adresář $d\n"; }
}
echo "\nhotovo\n";
