<?php
declare(strict_types=1);

// Převod řádků z databáze do tvaru, který čeká frontend. Výpočty (priorita,
// rezerva, zbývající dny) dělá server, aby tabule ukazovala všem totéž.

function zakazkaProSeznam(array $z): array {
  $kal   = jsonDek($z['kalkulace'], []);
  $koop  = koopOperace($z);
  $prio  = prioritaZakazky($z);
  $dnu   = dnyDoTerminu($z);
  $ceka  = cekaDnu($z);
  $pol   = polozky((int)$z['id']);
  $konf  = jsonDek($z['konfigurace'], []);
  $ks    = array_sum(array_map(fn($p) => (int)$p['pocet'], $pol));

  return [
    'cislo'        => $z['cislo'],
    'stav'         => $z['stav'],
    'priorita'     => $prio,
    'prioritaRucne'=> (int)$z['priorita_rucne'] === 1,
    'poradi'       => (int)$z['poradi'],
    'rezerva'      => round(rezervaHodin($z), 2),
    'termin'       => substr((string)$z['termin'], 0, 10),
    'dnuDoTerminu' => $dnu,
    'prirazeno'    => $z['prirazeno'],
    'zakaznik'     => $z['zak_firma'] !== '' ? $z['zak_firma'] : $z['zak_jmeno'],
    'zakJmeno'     => $z['zak_jmeno'],
    'zakEmail'     => $z['zak_email'],
    'tech'         => (string)($konf['tech'] ?? ''),
    'material'     => (string)($konf['material'] ?? ''),
    'dilu'         => count($pol),
    'ks'           => $ks,
    'celkem'       => (float)($kal['celkem'] ?? 0),
    'neprectene'   => maNeprectenou((int)$z['id']),
    'modelyChybi'  => (int)$z['modely_chybi'] === 1,
    'nedorucitelny'=> (int)$z['nedorucitelny'] === 1,
    'cekaDnu'      => $ceka,
    'zdroj'        => $z['zdroj'],
    'nahledMm'     => $pol ? max(jsonDek($pol[0]['bbox'], [0,0,0])) : 0,
    'maSoubory'    => count(souboryZakazky((int)$z['id'])) > 0,
    'koop'         => array_map(fn($o) => [
                        'co' => $o['co'], 'partner' => $o['partner'], 'stav' => $o['stav'],
                        'stavLabel' => KOOP_KROKY[koopKrokIndex($o['stav'])]['label'],
                      ], $koop),
    'stalyZakaznik'=> stalyZakaznik($z),
  ];
}

/** Předchozí zakázky téže firmy — „stálý zákazník" na kartě, historie v detailu. */
function historieFirmy(array $z, bool $bezSebe = true): array {
  if (empty($z['firma_id'])) return [];
  $q = db()->prepare('SELECT * FROM zakazky WHERE firma_id = ? ' . ($bezSebe ? 'AND id <> ?' : '') . ' ORDER BY termin DESC');
  $q->execute($bezSebe ? [(int)$z['firma_id'], (int)$z['id']] : [(int)$z['firma_id']]);
  return $q->fetchAll();
}

function stalyZakaznik(array $z): ?array {
  if ($z['stav'] !== 'nova') return null;
  $h = historieFirmy($z);
  if (!$h) return null;
  return ['pocet' => count($h), 'naposledy' => substr((string)$h[0]['termin'], 0, 10)];
}

function zakazkaDetail(array $z): array {
  $kal  = jsonDek($z['kalkulace'], []);
  $konf = jsonDek($z['konfigurace'], []);
  $koop = koopOperace($z);
  $hist = historieFirmy($z);

  $zmeny = db()->prepare('SELECT id, kdo, kdy, co, (pred IS NOT NULL) AS maSnimek
                            FROM historie WHERE zakazka_id = ? ORDER BY kdy DESC, id DESC');
  $zmeny->execute([(int)$z['id']]);

  return array_merge(zakazkaProSeznam($z), [
    'zakFirma'    => $z['zak_firma'],
    'zakTelefon'  => $z['zak_telefon'],
    'zakIco'      => $z['zak_ico'],
    'poznamkaZak' => $z['poznamka_zak'],
    'tiskarna'    => $z['tiskarna'],
    'jobs'        => (int)$z['jobs'],
    'hodinyTisku' => (float)$z['hodiny_tisku'],
    'hodinySchnuti'    => (float)$z['hodiny_schnuti'],
    'hodinyManipulace' => (float)$z['hodiny_manipulace'],
    'potreba'     => round(potrebaHodin($z), 2),
    'cenaPuvodni' => $z['cena_puvodni'] === null ? null : (float)$z['cena_puvodni'],
    'cenaDuvod'   => $z['cena_duvod'],
    'mnozstviZmeneno' => (int)$z['mnozstvi_zmeneno'] === 1,
    'zasilka'     => $z['zasilka'],
    'token'       => $z['token'],
    'stavovaUrl'  => stavovaUrl($z),
    'konfigurace' => $konf,
    'kalkulace'   => $kal,
    'firma'       => firmaInfo($z),
    'polozky'     => array_map(fn($p) => [
        'id'       => (int)$p['id'],
        'nazev'    => $p['nazev'],
        'bbox'     => jsonDek($p['bbox'], [0,0,0]),
        'objem'    => (float)$p['objem'],
        'pocet'    => (int)$p['pocet'],
        'cenaKus'  => (float)$p['cena_kus'],
        'cenaRadek'=> $p['cena_radek'] === null ? null : (float)$p['cena_radek'],
      ], polozky((int)$z['id'])),
    'soubory'     => array_map(fn($f) => [
        'id' => (int)$f['id'], 'nazev' => $f['nazev'],
        'velikost' => (int)$f['velikost'], 'typ' => $f['typ'],
      ], souboryZakazky((int)$z['id'])),
    'zpravy'      => array_map(fn($m) => [
        'id' => (int)$m['id'], 'typ' => $m['typ'], 'od' => $m['od'], 'komu' => $m['komu'],
        'predmet' => $m['predmet'], 'telo' => $m['telo'], 'parovani' => $m['parovani'],
        'kdy' => $m['kdy'], 'precteno' => (int)$m['precteno'] === 1,
      ], zpravy((int)$z['id'])),
    'historieZmen'=> array_map(fn($h) => [
        'id' => (int)$h['id'], 'kdo' => $h['kdo'], 'kdy' => $h['kdy'],
        'co' => $h['co'], 'lzeVratit' => (int)$h['maSnimek'] === 1,
      ], $zmeny->fetchAll()),
    'historieZakaznika' => array_map(fn($x) => [
        'cislo' => $x['cislo'], 'termin' => substr((string)$x['termin'], 0, 10),
        'celkem' => (float)(jsonDek($x['kalkulace'], [])['celkem'] ?? 0),
        'stav' => $x['stav'], 'kdo' => $x['zak_jmeno'],
        'co' => popisZakazky($x),
      ], $hist),
    'koopDetail'  => array_map(fn($o) => array_merge($o, [
        'stavLabel' => KOOP_KROKY[koopKrokIndex($o['stav'])]['label'],
        'dalsi'     => KOOP_KROKY[koopKrokIndex($o['stav'])]['dalsi'],
      ]), $koop),
  ]);
}

function popisZakazky(array $z): string {
  $konf = jsonDek($z['konfigurace'], []);
  $pol  = array_map(fn($p) => $p['nazev'] . ' ' . (int)$p['pocet'] . '×', polozky((int)$z['id']));
  return trim(($konf['tech'] ?? '') . ' · ' . ($konf['material'] ?? '') . ' · ' . implode(', ', $pol), ' ·');
}

function firmaInfo(array $z): ?array {
  if (empty($z['firma_id'])) return null;
  $q = db()->prepare('SELECT * FROM firmy WHERE id = ?');
  $q->execute([(int)$z['firma_id']]);
  $f = $q->fetch();
  if (!$f) return null;

  $k = db()->prepare('SELECT jmeno, email FROM kontakty WHERE firma_id = ? ORDER BY id');
  $k->execute([(int)$f['id']]);
  $kontakty = $k->fetchAll();

  $vse = historieFirmy($z, false);
  return [
    'id'       => (int)$f['id'],
    'klic'     => $f['klic'],
    'nazev'    => $f['nazev'],
    'ico'      => $f['ico'],
    'sleva'    => (float)$f['sleva'],
    'kontakty' => $kontakty,
    'zakazek'  => count($vse),
    'obrat'    => array_sum(array_map(fn($x) => (float)(jsonDek($x['kalkulace'], [])['celkem'] ?? 0), $vse)),
  ];
}

function firmySeznam(): array {
  $out = [];
  foreach (db()->query('SELECT * FROM firmy ORDER BY nazev') as $f) {
    $q = db()->prepare('SELECT * FROM zakazky WHERE firma_id = ? ORDER BY termin DESC');
    $q->execute([(int)$f['id']]);
    $zak = $q->fetchAll();
    if (!$zak) continue;

    $k = db()->prepare('SELECT jmeno, email FROM kontakty WHERE firma_id = ? ORDER BY id');
    $k->execute([(int)$f['id']]);

    $out[] = [
      'klic'    => $f['klic'],
      'nazev'   => $f['nazev'],
      'ico'     => $f['ico'] !== '' ? $f['ico'] : '—',
      'parovanoPodle' => explode(':', (string)$f['klic'])[0],
      'sleva'   => (float)$f['sleva'],
      'kontakty'=> $k->fetchAll(),
      'zakazek' => count($zak),
      'otevrenych' => count(array_filter($zak, fn($x) => !in_array($x['stav'], UZAVRENO, true))),
      'obrat'   => array_sum(array_map(fn($x) => (float)(jsonDek($x['kalkulace'], [])['celkem'] ?? 0), $zak)),
      'posledni'=> substr((string)$zak[0]['termin'], 0, 10),
      'zakazky' => array_map(fn($x) => [
          'cislo' => $x['cislo'], 'kdo' => $x['zak_jmeno'],
          'termin' => substr((string)$x['termin'], 0, 10),
          'co' => popisZakazky($x),
          'celkem' => (float)(jsonDek($x['kalkulace'], [])['celkem'] ?? 0),
          'stav' => $x['stav'],
        ], $zak),
    ];
  }
  usort($out, fn($a, $b) => $b['zakazek'] <=> $a['zakazek']);
  return $out;
}

/** Kontrolní výpis pošty — co odešlo, co přišlo a podle čeho se to spárovalo. */
function postaVypis(string $filtr = 'vse'): array {
  $sql = 'SELECT z.cislo, m.* FROM zpravy m JOIN zakazky z ON z.id = m.zakazka_id
           WHERE m.typ IN ("prichozi","odchozi")';
  if ($filtr === 'prichozi' || $filtr === 'odchozi') $sql .= ' AND m.typ = ' . db()->quote($filtr);
  $sql .= ' ORDER BY m.kdy DESC, m.id DESC LIMIT 500';

  $out = [];
  foreach (db()->query($sql) as $m) {
    $out[] = [
      'kdy'      => $m['kdy'],
      'typ'      => $m['typ'],
      'kdoText'  => $m['typ'] === 'prichozi' ? $m['od'] : $m['komu'],
      'predmet'  => $m['predmet'] !== '' ? $m['predmet'] : '(bez předmětu)',
      'zakazka'  => $m['cislo'],
      'parovani' => $m['parovani'] !== '' ? $m['parovani'] : '—',
      'stav'     => $m['typ'] === 'prichozi' ? ((int)$m['precteno'] === 1 ? 'přečteno' : 'nepřečteno') : 'odesláno',
    ];
  }
  return $out;
}
