<?php
declare(strict_types=1);

// Převod poptávky z kalkulátoru na kartu. Když má poptávka víc položek (items[]),
// jsou to varianty jedné zakázky — jedna karta, položky uvnitř.

function prijmiPoptavku(array $d, array $soubory = []): array {
  $kontakt = (array)($d['contact'] ?? []);
  $zak = [
    'jmeno'   => trim((string)($kontakt['name']    ?? '')),
    'firma'   => trim((string)($kontakt['company'] ?? $kontakt['firma'] ?? '')),
    'email'   => strtolower(trim((string)($kontakt['email'] ?? ''))),
    'telefon' => trim((string)($kontakt['phone']   ?? '')),
    'ico'     => trim((string)($kontakt['ico']     ?? '')),
  ];
  if ($zak['jmeno'] === '') $zak['jmeno'] = $zak['email'] !== '' ? $zak['email'] : 'Neznámý zákazník';

  $items = (array)($d['items'] ?? []);
  $prvni = (array)($items[0] ?? []);
  $calc  = (array)($prvni['calc'] ?? []);

  // hodiny z kalkulátoru; když chybí, aspoň manipulace z ceníku
  $hodinyTisku      = (float)($calc['printHours']    ?? 0);
  $hodinySchnuti    = (float)($calc['dryHours']      ?? 0);
  $hodinyManipulace = (float)($calc['handlingHours'] ?? (pricing()['handlingHours'] ?? 2));

  // konfigurace se sbírá napříč položkami, ať se externí operace poznají
  $dokonceni = [];
  foreach ($items as $it) {
    foreach ((array)($it['finishes'] ?? $it['finishing'] ?? []) as $f) {
      $n = is_array($f) ? (string)($f['name'] ?? '') : (string)$f;
      if ($n !== '' && !in_array($n, $dokonceni, true)) $dokonceni[] = $n;
    }
  }
  $konfigurace = [
    'tech'      => (string)($prvni['tech']     ?? ''),
    'material'  => (string)($prvni['material'] ?? ''),
    'barva'     => (string)($prvni['color']    ?? ''),
    'uprava'    => (string)($prvni['surface']  ?? 'Bez úpravy'),
    'rychlost'  => (string)($prvni['speed']    ?? 'Standard'),
    'vypln'     => isset($calc['infill']) ? ((int)$calc['infill'] . ' %') : '',
    'dokonceni' => $dokonceni,
  ];

  $net    = (float)($d['net']   ?? 0);
  $celkem = (float)($d['total'] ?? 0);
  $kalkulace = [
    'material'  => round((float)($calc['material']  ?? 0)),
    'stroj'     => round((float)($calc['machine']   ?? 0)),
    'dokonceni' => round((float)($calc['finishing'] ?? 0)),
    'cenaUlohy' => round((float)($calc['jobCost']   ?? $calc['jobPrice'] ?? 0)),
    'sleva'     => round((float)($calc['discount']  ?? 0)),
    'net'       => round($net),
    'dph'       => round($celkem - $net),
    'celkem'    => round($celkem),
  ];

  // termín: kalkulátor ho neposílá, odvodíme z potřeby hodin + rezerva 3 dny
  $leadHours = (float)($calc['leadHours'] ?? ($hodinyTisku + $hodinySchnuti + $hodinyManipulace));
  $termin    = (string)($d['dueDate'] ?? date('Y-m-d', time() + (int)ceil($leadHours / 8) * 86400 + 3 * 86400));

  $modelyChybi = !empty($d['uploadFailed']) || !empty($d['missingFiles']);

  $cislo = trim((string)($d['orderNo'] ?? ''));
  if ($cislo === '' || zakazkaPodleCisla($cislo)) $cislo = dalsiCislo();

  db()->prepare(
    'INSERT INTO zakazky (cislo, stav, termin, firma_id, zak_jmeno, zak_firma, zak_email, zak_telefon, zak_ico,
                          poznamka_zak, konfigurace, kalkulace, tiskarna, jobs,
                          hodiny_tisku, hodiny_schnuti, hodiny_manipulace,
                          modely_chybi, zdroj, token, vytvoreno, zmeneno)
     VALUES (?,"nova",?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    ->execute([
      $cislo, substr($termin, 0, 10), firmaZajisti($zak),
      $zak['jmeno'], $zak['firma'], $zak['email'], $zak['telefon'], $zak['ico'],
      trim((string)($kontakt['note'] ?? '')),
      jsonEnk($konfigurace), jsonEnk($kalkulace),
      (string)($prvni['printer'] ?? ''), (int)($prvni['jobs'] ?? 1),
      $hodinyTisku, $hodinySchnuti, $hodinyManipulace,
      $modelyChybi ? 1 : 0,
      (string)($d['source'] ?? 'kalkulator'), nahodnyToken(24), ted(), ted(),
    ]);

  $z = zakazkaPodleCisla($cislo);
  $id = (int)$z['id'];

  // položky: parts napříč všemi variantami — každá nese vlastní tech/materiál/tiskárnu,
  // ať se u víceřádkových objednávek (různé varianty = různý materiál/stroj) nic neztratí.
  $poradi = 0;
  foreach ($items as $it) {
    $itNet  = (float)($it['net'] ?? 0);
    $itCalc = (array)($it['calc'] ?? []);
    $caps   = (array)($itCalc['caps'] ?? []);
    $parts  = (array)($it['parts'] ?? []);
    $celkKs = array_sum(array_map(fn($p) => (int)($p['qty'] ?? 1), $parts)) ?: 1;
    foreach ($parts as $p) {
      $ks = max(1, (int)($p['qty'] ?? 1));
      // cena za kus: podíl na netu položky podle počtu kusů
      $cenaKus = $celkKs > 0 ? ($itNet * 1.21) / $celkKs : 0;
      $perJob = 1;
      foreach ($caps as $c) {
        if ((string)($c['name'] ?? '') === (string)($p['name'] ?? '')) { $perJob = max(1, (int)($c['perJob'] ?? 1)); break; }
      }
      db()->prepare('INSERT INTO polozky (zakazka_id, poradi, nazev, bbox, objem, pocet, cena_kus,
                                           tech, material, rychlost, tiskarna_nazev, perjob,
                                           hodiny_tisku, hodiny_schnuti, hodiny_manipulace)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          ->execute([$id, $poradi++, (string)($p['name'] ?? 'model'),
                     jsonEnk(array_map('floatval', (array)($p['bbox'] ?? [0,0,0]))),
                     round((float)($p['volume'] ?? 0), 2), $ks, round($cenaKus, 2),
                     (string)($it['tech'] ?? ''), (string)($it['material'] ?? ''),
                     (string)($it['speed'] ?? 'Standard'), (string)($it['printer'] ?? ''), $perJob,
                     (float)($itCalc['printHours'] ?? 0), (float)($itCalc['dryHours'] ?? 0),
                     (float)($itCalc['handlingHours'] ?? 0)]);
    }
  }
  if ($poradi === 0) {
    db()->prepare('INSERT INTO polozky (zakazka_id, poradi, nazev, pocet, cena_kus) VALUES (?,0,"—",1,?)')
        ->execute([$id, $kalkulace['celkem']]);
  }

  pripojSoubory($z, array_merge($soubory, pripravenéNahravky($d)));

  // Poptávka je vždy první (NEPŘEČTENOU) zprávou v konverzaci — ať je nová karta
  // na tabuli vidět jako nepřečtená, i když zákazník nenapsal poznámku.
  $note = trim((string)($kontakt['note'] ?? ''));
  db()->prepare('INSERT INTO zpravy (zakazka_id, typ, od, predmet, telo, parovani, precteno, kdy)
                 VALUES (?,"prichozi",?,?,?,?,0,?)')
      ->execute([$id, $zak['email'], 'Poptávka z kalkulátoru',
                 $note !== '' ? $note : 'Nová poptávka z kalkulátoru (bez poznámky zákazníka).',
                 'poptávka z kalkulátoru', ted()]);

  historieZapis($id, 'Poptávka přijata z kalkulátoru', null, 'systém');
  systemovyZaznam($id, 'Karta založena z poptávky ' . $cislo
    . ($modelyChybi ? ' · modely se nepodařilo nahrát' : ''));

  potvrzeniZakaznikovi($z);
  upozorniDilnu('Nová poptávka ' . $cislo,
    "Přišla nová poptávka.\n\nČíslo: $cislo\nZákazník: {$zak['jmeno']}"
    . ($zak['firma'] !== '' ? " ({$zak['firma']})" : '')
    . "\nCena: " . fKc($kalkulace['celkem']) . " s DPH\nTermín: " . fDatum($termin)
    . ($modelyChybi ? "\n\nPozor: modely chybí." : ''));

  return zakazkaPodleId($id);
}

/** Soubory, které kalkulátor nahrál předem přes upload.php. */
function pripravenéNahravky(array $d): array {
  $out = [];
  $dir = rtrim((string)cfg('modely'), '/') . '/_nahravky';
  foreach (array_merge((array)($d['uploadedFiles'] ?? []), (array)($d['files'] ?? [])) as $f) {
    $nazev = is_array($f) ? (string)($f['name'] ?? '') : (string)$f;
    if ($nazev === '') continue;
    $cesta = $dir . '/' . basename($nazev);
    if (is_file($cesta)) $out[] = ['nazev' => basename($nazev), 'tmp' => $cesta, 'presun' => false];
  }
  return $out;
}

/** Modely se ukládají mimo webroot; ke stažení jen přes soubor.php. */
function pripojSoubory(array $z, array $soubory): void {
  if (!$soubory) return;
  $dir = rtrim((string)cfg('modely'), '/') . '/' . $z['cislo'];
  if (!is_dir($dir)) @mkdir($dir, 0770, true);

  foreach ($soubory as $f) {
    $nazev = preg_replace('/[^\w.\- ()]/u', '_', (string)$f['nazev']);
    $cil   = $dir . '/' . $nazev;
    $ok    = !empty($f['presun']) ? @move_uploaded_file($f['tmp'], $cil) : @rename($f['tmp'], $cil);
    if (!$ok) { zaloguj('Soubor se nepodařilo uložit: ' . $nazev); continue; }
    @chmod($cil, 0640);
    db()->prepare('INSERT INTO soubory (zakazka_id, nazev, cesta, velikost, typ) VALUES (?,?,?,?,?)')
        ->execute([(int)$z['id'], $nazev, $z['cislo'] . '/' . $nazev,
                   (int)@filesize($cil), strtoupper(pathinfo($nazev, PATHINFO_EXTENSION))]);
  }
  db()->prepare('UPDATE zakazky SET modely_chybi = 0 WHERE id = ?')->execute([(int)$z['id']]);
}

function potvrzeniZakaznikovi(array $z): void {
  if (defined('KANBAN_TICHA_POSTA') && KANBAN_TICHA_POSTA) return;   // tichý dávkový import
  if (trim((string)$z['zak_email']) === '') return;
  $q = db()->prepare('SELECT * FROM sablony WHERE klic = "potvrzeni"');
  $q->execute();
  $t = $q->fetch();
  if (!$t) return;
  $v = sablonaVypln($t, $z);
  odesliZakaznikovi($z, $v['predmet'], $v['telo']);
}
