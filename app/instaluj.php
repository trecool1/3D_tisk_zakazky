<?php
declare(strict_types=1);

// První rozjezd: vytvoří schéma, výchozí sloupce, šablony, nastavení a účty.
// Spouští se z příkazové řádky: php instaluj.php [heslo-admina]

require __DIR__ . '/bootstrap.php';
require KANBAN_APP . '/lib/auth.php';
require KANBAN_APP . '/lib/zakazky.php';

if (PHP_SAPI !== 'cli') { http_response_code(403); exit('Jen z příkazové řádky.'); }

schemaAktualizuj();
echo "schéma připraveno\n";

$sloupce = [
  ['nova',        'Nová poptávka',      0],
  ['nabidka',     'Nabídka poslána',    0],
  ['schvaleno',   'Schváleno',          0],
  ['fronta',      'Ve frontě na tisk',  0],
  ['tisk',        'Tiskne se',          0],
  ['postprocess', 'Postprocess',        0],
  ['expedice',    'Expedice',           0],
  ['hotovo',      'Hotovo',             0],
  ['odlozeno',    'Odloženo / Zrušeno', 1],
];
foreach ($sloupce as $i => [$klic, $nazev, $skryt]) {
  db()->prepare('INSERT OR IGNORE INTO sloupce (klic, nazev, poradi, skryt) VALUES (?,?,?,?)')
      ->execute([$klic, $nazev, $i, $skryt]);
}
echo "sloupce připraveny\n";

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

foreach (['prahVysoka' => '24', 'prahNormalni' => '72', 'dnyBezOdpovedi' => '5',
          'koopPartner' => '', 'koopLhutaDnu' => '5', 'koopDopravaDnu' => '2'] as $k => $v) {
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

foreach ([cfg('modely'), cfg('zalohy')] as $d) {
  if (!is_dir($d)) { @mkdir($d, 0770, true); echo "vytvořen adresář $d\n"; }
}
echo "\nhotovo\n";
