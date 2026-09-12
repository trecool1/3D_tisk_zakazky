<?php
declare(strict_types=1);

// Doména: priorita, přepočty ceny, snímky pro vrácení změn, párování firem.
// Pravidla jsou stejná jako v návrhu — hlavně: zadaná cena s DPH platí přesně
// a součet řádků na ni musí sedět na korunu.

const UZAVRENO = ['hotovo', 'odlozeno'];

const PRIO = [
  'zadna'    => ['label' => '—',        'rank' => 9],
  'kriticka' => ['label' => 'kritická', 'rank' => 0],
  'vysoka'   => ['label' => 'vysoká',   'rank' => 1],
  'normalni' => ['label' => 'normální', 'rank' => 2],
  'nizka'    => ['label' => 'nízká',    'rank' => 3],
];

/* ---------- nastavení ---------- */

function nastaveni(string $klic, string $vychozi = ''): string {
  static $vse = null;
  if ($vse === null) {
    $vse = [];
    foreach (db()->query('SELECT klic, hodnota FROM nastaveni') as $r) $vse[$r['klic']] = $r['hodnota'];
  }
  return $vse[$klic] ?? $vychozi;
}

function nastavenoUloz(string $klic, string $hodnota): void {
  db()->prepare('INSERT INTO nastaveni (klic, hodnota) VALUES (?,?)
                 ON CONFLICT(klic) DO UPDATE SET hodnota = excluded.hodnota')
      ->execute([$klic, $hodnota]);
}

/* ---------- načítání ---------- */

function zakazkaPodleCisla(string $cislo): ?array {
  $q = db()->prepare('SELECT * FROM zakazky WHERE cislo = ?');
  $q->execute([$cislo]);
  return $q->fetch() ?: null;
}

function zakazkaPodleId(int $id): ?array {
  $q = db()->prepare('SELECT * FROM zakazky WHERE id = ?');
  $q->execute([$id]);
  return $q->fetch() ?: null;
}

function polozky(int $zakazkaId): array {
  $q = db()->prepare('SELECT * FROM polozky WHERE zakazka_id = ? ORDER BY poradi, id');
  $q->execute([$zakazkaId]);
  return $q->fetchAll();
}

function zpravy(int $zakazkaId): array {
  $q = db()->prepare('SELECT * FROM zpravy WHERE zakazka_id = ? ORDER BY kdy, id');
  $q->execute([$zakazkaId]);
  return $q->fetchAll();
}

function souboryZakazky(int $zakazkaId): array {
  $q = db()->prepare('SELECT * FROM soubory WHERE zakazka_id = ? ORDER BY id');
  $q->execute([$zakazkaId]);
  return $q->fetchAll();
}

/* ---------- priorita ---------- */

function potrebaHodin(array $z): float {
  $h = (float)$z['hodiny_tisku'] + (float)$z['hodiny_schnuti'] + (float)$z['hodiny_manipulace'];
  foreach (koopOperace($z) as $o) $h += $o['hodiny'];
  return $h;
}

function rezervaHodin(array $z): float {
  $termin = new DateTimeImmutable(substr($z['termin'], 0, 10) . ' 12:00:00');
  $doTerminu = ($termin->getTimestamp() - time()) / 3600;
  return $doTerminu - potrebaHodin($z);
}

function prioritaZakazky(array $z): string {
  if (in_array($z['stav'], UZAVRENO, true)) return 'zadna';
  if ((int)$z['priorita_rucne'] === 1)      return (string)$z['priorita'];
  $r = rezervaHodin($z);
  if ($r < 0)                                        return 'kriticka';
  if ($r < (float)nastaveni('prahVysoka', '24'))     return 'vysoka';
  if ($r < (float)nastaveni('prahNormalni', '72'))   return 'normalni';
  return 'nizka';
}

// kalendářní dny, ne 24hodinové úseky
function dnyDoTerminu(array $z): int {
  $a = new DateTimeImmutable(substr($z['termin'], 0, 10) . ' 00:00:00');
  $b = new DateTimeImmutable('today 00:00:00');
  return (int)round(($a->getTimestamp() - $b->getTimestamp()) / 86400);
}

function maNeprectenou(int $zakazkaId): bool {
  $q = db()->prepare('SELECT 1 FROM zpravy WHERE zakazka_id = ? AND typ = "prichozi" AND precteno = 0 LIMIT 1');
  $q->execute([$zakazkaId]);
  return (bool)$q->fetchColumn();
}

/* ---------- firmy ---------- */

const VOLNE_DOMENY = ['gmail.com','seznam.cz','email.cz','outlook.com','hotmail.com','icloud.com'];

// Zákazník je firma, ne e-mail: IČO → název firmy → doména → jinak osoba zvlášť.
function firmaKlic(array $zak): string {
  $ico   = trim((string)($zak['ico']   ?? ''));
  $firma = trim((string)($zak['firma'] ?? ''));
  $email = trim((string)($zak['email'] ?? ''));
  if ($ico   !== '') return 'ico:' . $ico;
  if ($firma !== '') return 'firma:' . mb_strtolower($firma);
  $dom = strtolower((string)(explode('@', $email)[1] ?? ''));
  if ($dom !== '' && !in_array($dom, VOLNE_DOMENY, true)) return 'domena:' . $dom;
  return 'osoba:' . mb_strtolower($email !== '' ? $email : (string)($zak['jmeno'] ?? ''));
}

function firmaZajisti(array $zak): int {
  $klic  = firmaKlic($zak);
  $nazev = trim((string)($zak['firma'] ?? '')) !== '' ? (string)$zak['firma'] : (string)($zak['jmeno'] ?? 'Neznámý');

  $q = db()->prepare('SELECT id FROM firmy WHERE klic = ?');
  $q->execute([$klic]);
  $id = $q->fetchColumn();
  if (!$id) {
    db()->prepare('INSERT INTO firmy (klic, nazev, ico) VALUES (?,?,?)')
        ->execute([$klic, $nazev, (string)($zak['ico'] ?? '')]);
    $id = (int)db()->lastInsertId();
  }
  $id = (int)$id;

  $email = trim((string)($zak['email'] ?? ''));
  if ($email !== '') {
    db()->prepare('INSERT INTO kontakty (firma_id, jmeno, email, telefon) VALUES (?,?,?,?)
                   ON CONFLICT(firma_id, email) DO UPDATE SET
                     jmeno   = CASE WHEN excluded.jmeno   <> "" THEN excluded.jmeno   ELSE kontakty.jmeno   END,
                     telefon = CASE WHEN excluded.telefon <> "" THEN excluded.telefon ELSE kontakty.telefon END')
        ->execute([$id, (string)($zak['jmeno'] ?? ''), $email, (string)($zak['telefon'] ?? '')]);
  }
  return $id;
}

function slevaFirmy(?int $firmaId): float {
  if (!$firmaId) return 0;
  $q = db()->prepare('SELECT sleva FROM firmy WHERE id = ?');
  $q->execute([$firmaId]);
  return (float)($q->fetchColumn() ?: 0);
}

/* ---------- snímky a historie ---------- */

// Pole, která se snímkují před změnou, aby šlo změnu vrátit.
function snimek(array $z): array {
  return [
    'stav'             => $z['stav'],
    'termin'           => $z['termin'],
    'prirazeno'        => $z['prirazeno'],
    'priorita'         => $z['priorita'],
    'priorita_rucne'   => (int)$z['priorita_rucne'],
    'poradi'           => (int)$z['poradi'],
    'kalkulace'        => $z['kalkulace'],
    'hodiny_tisku'     => (float)$z['hodiny_tisku'],
    'cena_puvodni'     => $z['cena_puvodni'],
    'cena_duvod'       => $z['cena_duvod'],
    'mnozstvi_zmeneno' => (int)$z['mnozstvi_zmeneno'],
    'koop_stav'        => $z['koop_stav'],
    'koop_partner'     => $z['koop_partner'],
    'zasilka'          => $z['zasilka'],
    'polozky'          => array_map(fn($p) => [
      'id' => (int)$p['id'], 'pocet' => (int)$p['pocet'],
      'cena_kus' => (float)$p['cena_kus'], 'cena_radek' => $p['cena_radek'],
    ], polozky((int)$z['id'])),
  ];
}

function historieZapis(int $zakazkaId, string $co, ?array $pred = null, ?string $kdo = null): void {
  db()->prepare('INSERT INTO historie (zakazka_id, kdo, kdy, co, pred) VALUES (?,?,?,?,?)')
      ->execute([$zakazkaId, $kdo ?? mojeJmeno(), ted(), $co, $pred === null ? null : jsonEnk($pred)]);
}

function systemovyZaznam(int $zakazkaId, string $telo): void {
  db()->prepare('INSERT INTO zpravy (zakazka_id, typ, telo, precteno, kdy) VALUES (?,"system",?,1,?)')
      ->execute([$zakazkaId, $telo, ted()]);
}

/** Změna zakázky se zápisem do historie i konverzace. */
function zmen(array $z, callable $fn, ?string $zapis = null): array {
  $pred = snimek($z);
  $fn($z);
  db()->prepare('UPDATE zakazky SET zmeneno = ? WHERE id = ?')->execute([ted(), (int)$z['id']]);
  if ($zapis !== null && $zapis !== '') {
    systemovyZaznam((int)$z['id'], $zapis);
    historieZapis((int)$z['id'], $zapis, $pred);
  }
  return zakazkaPodleId((int)$z['id']);
}

/** Vrácení do stavu před daným záznamem historie. Novější změny se zahodí. */
function vratitSem(array $z, int $historieId): bool {
  $q = db()->prepare('SELECT * FROM historie WHERE id = ? AND zakazka_id = ?');
  $q->execute([$historieId, (int)$z['id']]);
  $h = $q->fetch();
  if (!$h || $h['pred'] === null) return false;

  $pred = jsonDek($h['pred'], []);
  db()->prepare(
    'UPDATE zakazky SET stav=?, termin=?, prirazeno=?, priorita=?, priorita_rucne=?, poradi=?,
       kalkulace=?, hodiny_tisku=?, cena_puvodni=?, cena_duvod=?, mnozstvi_zmeneno=?,
       koop_stav=?, koop_partner=?, zasilka=?, zmeneno=? WHERE id=?')
    ->execute([
      $pred['stav'], $pred['termin'], $pred['prirazeno'], $pred['priorita'], $pred['priorita_rucne'],
      $pred['poradi'], $pred['kalkulace'], $pred['hodiny_tisku'], $pred['cena_puvodni'], $pred['cena_duvod'],
      $pred['mnozstvi_zmeneno'], $pred['koop_stav'], $pred['koop_partner'], $pred['zasilka'], ted(), (int)$z['id'],
    ]);

  foreach ($pred['polozky'] ?? [] as $p) {
    db()->prepare('UPDATE polozky SET pocet=?, cena_kus=?, cena_radek=? WHERE id=? AND zakazka_id=?')
        ->execute([$p['pocet'], $p['cena_kus'], $p['cena_radek'], $p['id'], (int)$z['id']]);
  }

  // novější změny se zahodí
  db()->prepare('DELETE FROM historie WHERE zakazka_id = ? AND id > ?')->execute([(int)$z['id'], $historieId]);
  db()->prepare('DELETE FROM historie WHERE id = ?')->execute([$historieId]);

  systemovyZaznam((int)$z['id'], 'Vráceno do stavu před: ' . $h['co'] . ' (vrátil ' . mojeJmeno() . ')');
  return true;
}

/* ---------- ceny ---------- */

/**
 * Ruční přebití ceny s DPH. Zadaná částka platí přesně:
 * net = round(v / 1.21), dph = v − net, celkem = v.
 * Net se rozdělí do řádků poměrně; zaokrouhlení padne do posledního řádku,
 * takže součet vždy sedí na korunu (i za cenu haléřů u ceny za kus).
 */
function prebitCenu(array $z, float $castka, string $duvod): array {
  $pol = polozky((int)$z['id']);
  if (!$pol || $castka <= 0) return $z;

  $puvodni = $z['cena_puvodni'] !== null
    ? (float)$z['cena_puvodni']
    : (float)(jsonDek($z['kalkulace'], [])['celkem'] ?? 0);

  $net = (int)round($castka / 1.21);
  $dph = (int)round($castka) - $net;

  $puvRadky = array_map(fn($p) => (float)$p['cena_kus'] * (int)$p['pocet'], $pol);
  $puvNet   = array_sum($puvRadky) ?: 1.0;

  $rozdano = 0;
  $posledni = count($pol) - 1;
  foreach ($pol as $i => $p) {
    $radek = ($i === $posledni) ? $net - $rozdano : (int)round($net * ($puvRadky[$i] / $puvNet));
    $rozdano += $radek;
    db()->prepare('UPDATE polozky SET cena_radek = ?, cena_kus = ? WHERE id = ?')
        ->execute([$radek, (int)$p['pocet'] > 0 ? $radek / (int)$p['pocet'] : 0, (int)$p['id']]);
  }

  $kal = jsonDek($z['kalkulace'], []);
  $kal['net'] = $net; $kal['dph'] = $dph; $kal['celkem'] = (int)round($castka); $kal['sleva'] = 0;

  db()->prepare('UPDATE zakazky SET kalkulace = ?, cena_puvodni = ?, cena_duvod = ?, zmeneno = ? WHERE id = ?')
      ->execute([jsonEnk($kal), $puvodni, $duvod !== '' ? $duvod : 'neuveden', ted(), (int)$z['id']]);

  // původní cena z kalkulátoru se neztrácí a změna jde do konverzace
  db()->prepare('INSERT INTO zpravy (zakazka_id, typ, od, telo, precteno, kdy) VALUES (?,"interni",?,?,1,?)')
      ->execute([(int)$z['id'], mojeJmeno(),
        'Cena ručně upravena: ' . fKc($puvodni) . ' → ' . fKc($castka) . ' s DPH (bez DPH ' . fKc((float)$net)
        . ', DPH ' . fKc((float)$dph) . ").\nDůvod: " . ($duvod !== '' ? $duvod : 'neuveden'), ted()]);

  return zakazkaPodleId((int)$z['id']);
}

/**
 * Změna počtu kusů. Cena za kus zůstává, přepočítá se řádek, net, DPH a celkem.
 * Hodiny tisku se prodlouží poměrně, takže se změní rezerva i priorita.
 */
function zmenPocet(array $z, int $polozkaId, int $novy): array {
  $pol = polozky((int)$z['id']);
  $cil = null;
  foreach ($pol as $p) if ((int)$p['id'] === $polozkaId) $cil = $p;
  if (!$cil) return $z;

  $novy  = max(1, $novy);
  $stary = (int)$cil['pocet'];
  if ($novy === $stary) return $z;

  $kal       = jsonDek($z['kalkulace'], []);
  $puvCelkem = (float)($kal['celkem'] ?? 0);
  $puvKs     = array_sum(array_map(fn($p) => (int)$p['pocet'], $pol)) ?: 1;

  db()->prepare('UPDATE polozky SET pocet = ?, cena_radek = ? WHERE id = ?')
      ->execute([$novy, round((float)$cil['cena_kus'] * $novy), $polozkaId]);

  $pol = polozky((int)$z['id']);
  $net = 0;
  foreach ($pol as $p) $net += (int)round((float)$p['cena_kus'] * (int)$p['pocet']);
  $dph = (int)round($net * 0.21);

  $kal['net'] = $net; $kal['dph'] = $dph; $kal['celkem'] = $net + $dph;

  $novKs  = array_sum(array_map(fn($p) => (int)$p['pocet'], $pol)) ?: 1;
  $hodiny = round((float)$z['hodiny_tisku'] * ($novKs / $puvKs), 1);

  db()->prepare('UPDATE zakazky SET kalkulace = ?, hodiny_tisku = ?, mnozstvi_zmeneno = 1, zmeneno = ? WHERE id = ?')
      ->execute([jsonEnk($kal), $hodiny, ted(), (int)$z['id']]);

  systemovyZaznam((int)$z['id'],
    'Počet ks u ' . $cil['nazev'] . ': ' . $stary . ' → ' . $novy . ' · cena ' . fKc($puvCelkem)
    . ' → ' . fKc((float)($net + $dph)) . ' s DPH (přepočteno z ceny za kus) — ' . mojeJmeno());

  return zakazkaPodleId((int)$z['id']);
}

/**
 * Změna tiskárny (a tím i technologie) a materiálu u položky — třeba když se
 * po odeslání nabídky domluvíme se zákazníkem na jiné technologii/materiálu.
 * Cena se needit (ta jde přebít zvlášť přes "Přebít cenu"), mění se jen to,
 * na co je díl naceněný a kam patří v plánování výroby.
 */
function zmenTechMaterial(array $z, int $polozkaId, string $tiskarnaNazev, string $material): array {
  $pol = polozky((int)$z['id']);
  $cil = null;
  foreach ($pol as $p) if ((int)$p['id'] === $polozkaId) $cil = $p;
  if (!$cil) return $z;

  $tiskarnaNazev = trim($tiskarnaNazev);
  $material      = trim($material);
  if ($tiskarnaNazev === (string)$cil['tiskarna_nazev'] && $material === (string)$cil['material']) return $z;

  $t    = $tiskarnaNazev !== '' ? tiskarnaPodleNazvu($tiskarnaNazev) : null;
  $tech = $t ? $t['tech'] : '';

  db()->prepare('UPDATE polozky SET tech = ?, material = ?, tiskarna_nazev = ? WHERE id = ?')
      ->execute([$tech, $material, $tiskarnaNazev, $polozkaId]);
  db()->prepare('UPDATE zakazky SET zmeneno = ? WHERE id = ?')->execute([ted(), (int)$z['id']]);

  systemovyZaznam((int)$z['id'],
    'Tiskárna/materiál u ' . $cil['nazev'] . ': ' . ($cil['tiskarna_nazev'] ?: '—') . ' / ' . ($cil['material'] ?: '—')
    . ' → ' . ($tiskarnaNazev ?: '—') . ' / ' . ($material ?: '—') . ' — ' . mojeJmeno());

  return zakazkaPodleId((int)$z['id']);
}

/* ---------- čísla zakázek ---------- */

function dalsiCislo(): string {
  $rok = (int)date('Y');
  $q = db()->prepare('SELECT cislo FROM zakazky WHERE cislo LIKE ? ORDER BY cislo DESC LIMIT 1');
  $q->execute(['P-' . $rok . '-%']);
  $posledni = (string)($q->fetchColumn() ?: '');
  $n = $posledni !== '' ? ((int)substr($posledni, -4)) + 1 : 1;
  return sprintf('P-%d-%04d', $rok, $n);
}

/* ---------- sloupce ---------- */

function sloupce(): array {
  return db()->query('SELECT * FROM sloupce ORDER BY poradi, id')->fetchAll();
}

function nazevSloupce(string $klic): string {
  foreach (sloupce() as $s) if ($s['klic'] === $klic) return $s['nazev'];
  return $klic;
}
