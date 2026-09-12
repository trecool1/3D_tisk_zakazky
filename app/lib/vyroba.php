<?php
declare(strict_types=1);

// Fronta tiskových úloh: kumulativní hodiny a datum "hotovo nejdřív" se počítají
// za běhu (ne ukládají), ať se po každé změně pořadí nerozjedou od uložené hodnoty.
// Syrové hodiny bez pracovního kalendáře — stejná konvence jako rezervaHodin().

function ulohaZakazky(int $ulohaId): array {
  $q = db()->prepare(
    'SELECT DISTINCT z.cislo FROM uloha_polozky up
       JOIN polozky p ON p.id = up.polozka_id
       JOIN zakazky z ON z.id = p.zakazka_id
      WHERE up.uloha_id = ? ORDER BY z.cislo');
  $q->execute([$ulohaId]);
  return $q->fetchAll(PDO::FETCH_COLUMN);
}

function frontaStroje(int $strojId): array {
  $q = db()->prepare('SELECT * FROM tiskove_ulohy WHERE stroj_id = ? AND stav IN ("fronta","tiskne")
                       ORDER BY poradi, id');
  $q->execute([$strojId]);

  $kumulativne = 0.0;
  $ted = new DateTimeImmutable();
  $out = [];
  foreach ($q->fetchAll() as $u) {
    $hodin = (float)$u['odhad_hodin_tisk'] + (float)$u['odhad_hodin_chladnuti'];
    $kumulativne += $hodin;
    $out[] = [
      'id'              => (int)$u['id'],
      'material'        => $u['material'],
      'stav'            => $u['stav'],
      'expres'          => (int)$u['expres'] === 1,
      'poznamka'        => $u['poznamka'],
      'poradi'          => (int)$u['poradi'],
      'hodinTisk'       => (float)$u['odhad_hodin_tisk'],
      'hodinChladnuti'  => (float)$u['odhad_hodin_chladnuti'],
      'kumulativneHodin'=> round($kumulativne, 1),
      'hotovoNejdrive'  => $ted->modify('+' . (int)round($kumulativne * 3600) . ' seconds')->format('Y-m-d H:i:s'),
      'zakazky'         => ulohaZakazky((int)$u['id']),
    ];
  }
  return $out;
}

function vsechnyFronty(): array {
  $out = [];
  $q = db()->query(
    'SELECT s.*, t.nazev AS tiskarna_nazev, t.klic AS tiskarna_klic
       FROM stroje s JOIN tiskarny t ON t.id = s.tiskarna_id
      WHERE s.aktivni = 1 ORDER BY t.nazev, s.oznaceni');
  foreach ($q->fetchAll() as $s) {
    $fronta   = frontaStroje((int)$s['id']);
    $posledni = $fronta ? $fronta[count($fronta) - 1] : null;
    $out[] = [
      'strojId'       => (int)$s['id'],
      'oznaceni'      => $s['oznaceni'],
      'tiskarna'      => $s['tiskarna_nazev'],
      'tiskarnaKlic'  => $s['tiskarna_klic'],
      'fronta'        => $fronta,
      'celkemHodin'   => $posledni ? $posledni['kumulativneHodin'] : 0,
      'hotovoNejdrive'=> $posledni ? $posledni['hotovoNejdrive'] : null,
    ];
  }
  return $out;
}

function ulohaDetail(int $id): ?array {
  $q = db()->prepare('SELECT u.*, t.nazev AS tiskarna_nazev, s.oznaceni AS stroj_oznaceni
                        FROM tiskove_ulohy u
                        JOIN tiskarny t ON t.id = u.tiskarna_id
                        LEFT JOIN stroje s ON s.id = u.stroj_id
                       WHERE u.id = ?');
  $q->execute([$id]);
  $u = $q->fetch();
  if (!$u) return null;

  $pol = db()->prepare(
    'SELECT up.pocet, p.nazev, p.id AS polozka_id, z.cislo
       FROM uloha_polozky up
       JOIN polozky p ON p.id = up.polozka_id
       JOIN zakazky z ON z.id = p.zakazka_id
      WHERE up.uloha_id = ? ORDER BY z.cislo, p.poradi');
  $pol->execute([$id]);

  return [
    'id'             => (int)$u['id'],
    'tiskarna'       => $u['tiskarna_nazev'],
    'stroj'          => $u['stroj_oznaceni'],
    'material'       => $u['material'],
    'stav'           => $u['stav'],
    'expres'         => (int)$u['expres'] === 1,
    'poznamka'       => $u['poznamka'],
    'hodinTisk'      => (float)$u['odhad_hodin_tisk'],
    'hodinChladnuti' => (float)$u['odhad_hodin_chladnuti'],
    'vytvoreno'      => $u['vytvoreno'],
    'zahajeno'       => $u['zahajeno'],
    'dokonceno'      => $u['dokonceno'],
    'polozky'        => array_map(fn($p) => [
      'cislo' => $p['cislo'], 'nazev' => $p['nazev'], 'pocet' => (int)$p['pocet'],
    ], $pol->fetchAll()),
  ];
}

/** Ruční přeřazení v rámci fronty téhož stroje — stejný vzor jako poradi() u zakázek. */
function ulohaPoradiZmen(int $ulohaId, int $nadId): void {
  $cil = db()->prepare('SELECT poradi, stroj_id FROM tiskove_ulohy WHERE id = ?');
  $cil->execute([$nadId]);
  $c = $cil->fetch();
  if (!$c) return;
  db()->prepare('UPDATE tiskove_ulohy SET poradi = ?, stroj_id = ? WHERE id = ?')
      ->execute([(int)$c['poradi'] - 1, (int)$c['stroj_id'], $ulohaId]);
}

function ulohaStavZmen(int $id, string $novy): void {
  if (!in_array($novy, ['fronta', 'tiskne', 'hotovo'], true)) return;
  $sloupec = $novy === 'tiskne' ? 'zahajeno' : ($novy === 'hotovo' ? 'dokonceno' : null);
  if ($sloupec) {
    db()->prepare("UPDATE tiskove_ulohy SET stav = ?, $sloupec = ? WHERE id = ?")
        ->execute([$novy, ted(), $id]);
  } else {
    db()->prepare('UPDATE tiskove_ulohy SET stav = ? WHERE id = ?')->execute([$novy, $id]);
  }

  $q = db()->prepare('SELECT DISTINCT p.zakazka_id FROM uloha_polozky up
                        JOIN polozky p ON p.id = up.polozka_id WHERE up.uloha_id = ?');
  $q->execute([$id]);
  synchronizujStavZakazek($q->fetchAll(PDO::FETCH_COLUMN));
}

/**
 * Sloupec karty odvozený ze stavu jejích tiskových úloh — dokud díly nejsou
 * naplánované, karta zůstává v Přijato; jakmile se cokoli tiskne, jde do Tiskne se;
 * jakmile jsou všechny plánované díly hotové, jde do Postprocess (dál už jen ručně).
 */
function stavZakazkyPodleUloh(int $zakazkaId): ?string {
  $qCelkem = db()->prepare('SELECT COUNT(*) FROM polozky WHERE zakazka_id = ?');
  $qCelkem->execute([$zakazkaId]);
  $celkem = (int)$qCelkem->fetchColumn();
  if ($celkem === 0) return null;

  $qNaplan = db()->prepare('SELECT COUNT(DISTINCT p.id) FROM polozky p
                              JOIN uloha_polozky up ON up.polozka_id = p.id WHERE p.zakazka_id = ?');
  $qNaplan->execute([$zakazkaId]);
  $naplanovano = (int)$qNaplan->fetchColumn();
  if ($naplanovano === 0) return 'prijato';

  $qStavy = db()->prepare('SELECT DISTINCT u.stav FROM uloha_polozky up
                             JOIN polozky p ON p.id = up.polozka_id
                             JOIN tiskove_ulohy u ON u.id = up.uloha_id
                            WHERE p.zakazka_id = ?');
  $qStavy->execute([$zakazkaId]);
  $stavy = $qStavy->fetchAll(PDO::FETCH_COLUMN);

  if (in_array('tiskne', $stavy, true)) return 'tisk';
  if ($naplanovano === $celkem && $stavy === ['hotovo']) return 'postprocess';
  return 'fronta';
}

/** Přepočte a uloží automatický stav (jen u karet, které to mají zapnuté). */
function synchronizujStavZakazek(array $zakazkaIds): void {
  foreach (array_unique($zakazkaIds) as $zid) {
    $q = db()->prepare('SELECT id, stav FROM zakazky WHERE id = ? AND stav_auto = 1');
    $q->execute([(int)$zid]);
    $z = $q->fetch();
    // hotovo/odloženo je vždy konečná — i kdyby zbyl stav_auto=1 z doby před touto
    // funkcí, karta se z uzavřeného stavu nikdy sama nevrací zpátky do výroby
    if (!$z || in_array($z['stav'], UZAVRENO, true)) continue;
    $novy = stavZakazkyPodleUloh((int)$zid);
    if ($novy === null || $novy === $z['stav'] || in_array($novy, UZAVRENO, true)) continue;
    db()->prepare('UPDATE zakazky SET stav = ?, zmeneno = ? WHERE id = ?')->execute([$novy, ted(), (int)$zid]);
    systemovyZaznam((int)$zid, 'Automaticky přesunuto do ' . nazevSloupce($novy) . ' (podle stavu výroby)');
  }
}

/* ---------- dávkování a čekárna ---------- */

// Expres (Do 24 h / Expres…) obchází dávkování — poznáme podle ceníku (maxHours
// > 0), ne podle natvrdo napsaného českého názvu.
function jeExpres(string $rychlost): bool {
  $s = pricingNajdi('speeds', $rychlost);
  return $s !== null && (float)($s['maxHours'] ?? 0) > 0;
}

/** Díly, které ještě nejsou přiřazené do žádné tiskové úlohy, u otevřených zakázek. */
function nenaplanovanePolozky(): array {
  return db()->query(
    "SELECT p.* FROM polozky p
       JOIN zakazky z ON z.id = p.zakazka_id
      WHERE z.stav NOT IN ('hotovo','odlozeno')
        AND NOT EXISTS (SELECT 1 FROM uloha_polozky up WHERE up.polozka_id = p.id)
      ORDER BY z.cislo, p.poradi")->fetchAll();
}

/**
 * Přehled čekajících dávek podle (tiskárna, materiál) — jen standardní rychlost,
 * expres se nedávkuje. Naplnění = kolik "jobů" dohromady díly zaberou (perJob
 * z kalkulátoru). Tiskárny, které se nepodařilo spárovat podle názvu (osiřelý
 * text u starší zakázky), se hlásí zvlášť, ať je vidět, že chybí ruční přiřazení.
 */
function poolyPrehled(): array {
  $prah = (float)nastaveni('davkaPraH', '0.8');
  $skupiny = [];
  $nesparovano = [];

  foreach (nenaplanovanePolozky() as $p) {
    if (jeExpres($p['rychlost'])) continue;
    $t = tiskarnaPodleNazvu($p['tiskarna_nazev']);
    if (!$t) { $nesparovano[$p['tiskarna_nazev']] = ($nesparovano[$p['tiskarna_nazev']] ?? 0) + 1; continue; }

    $klic = $t['id'] . '|' . $p['material'];
    if (!isset($skupiny[$klic])) {
      $skupiny[$klic] = ['tiskarnaId' => $t['id'], 'tiskarna' => $t['nazev'], 'material' => $p['material'],
                          'fill' => 0.0, 'dilu' => 0, 'zakazky' => []];
    }
    $skupiny[$klic]['fill'] += (int)$p['pocet'] / max(1, (int)$p['perjob']);
    $skupiny[$klic]['dilu']++;
    $skupiny[$klic]['zakazky'][(int)$p['zakazka_id']] = true;
  }

  $davky = array_map(fn($s) => [
    'tiskarnaId' => $s['tiskarnaId'], 'tiskarna' => $s['tiskarna'], 'material' => $s['material'],
    'fill' => round($s['fill'], 2), 'dilu' => $s['dilu'], 'zakazek' => count($s['zakazky']),
    'pripraveno' => $s['fill'] >= $prah,
  ], array_values($skupiny));
  usort($davky, fn($a, $b) => $b['fill'] <=> $a['fill']);

  return ['davky' => $davky, 'nesparovaneTiskarny' => $nesparovano, 'prah' => $prah];
}

/** Aktivní stroj daného typu s nejmenší zátěží ve frontě (rozložení mezi víc kusů). */
function strojNejmeneVytizeny(int $tiskarnaId): ?int {
  $q = db()->prepare('SELECT id FROM stroje WHERE tiskarna_id = ? AND aktivni = 1');
  $q->execute([$tiskarnaId]);
  $nejlepsiId = null; $nejmensiHodin = null;
  foreach ($q->fetchAll(PDO::FETCH_COLUMN) as $strojId) {
    $fronta   = frontaStroje((int)$strojId);
    $posledni = $fronta ? $fronta[count($fronta) - 1] : null;
    $hodin    = $posledni ? $posledni['kumulativneHodin'] : 0.0;
    if ($nejmensiHodin === null || $hodin < $nejmensiHodin) { $nejmensiHodin = $hodin; $nejlepsiId = (int)$strojId; }
  }
  return $nejlepsiId;
}

/**
 * Založí tiskovou úlohu ze zadaných dílů na nejméně vytíženém stroji daného typu.
 * Odhad hodin: díly stejné zakázky+varianty sdílí jeden job (hodiny se neopakují
 * za každý díl, viz prijmiPoptavku), různé zakázky se v jedné dávce reálně tisknou
 * na jedné desce zároveň — bereme tedy MAX přes skupiny, ne součet (zjednodušený
 * odhad, ne plnohodnotné skládání jako v kalkulátoru).
 */
function ulohaZaloz(int $tiskarnaId, string $material, array $polozky, bool $expres): ?int {
  if (!$polozky) return null;
  $strojId = strojNejmeneVytizeny($tiskarnaId);
  if (!$strojId) return null;

  $skupiny = [];
  foreach ($polozky as $p) {
    $klic = $p['zakazka_id'] . '|' . $p['tiskarna_nazev'] . '|' . $p['rychlost'];
    if (!isset($skupiny[$klic])) {
      $skupiny[$klic] = ['tisk' => (float)$p['hodiny_tisku'], 'chlad' => (float)$p['hodiny_schnuti']];
    }
  }
  $hodinTisk = 0.0; $hodinChlad = 0.0;
  foreach ($skupiny as $s) { $hodinTisk = max($hodinTisk, $s['tisk']); $hodinChlad = max($hodinChlad, $s['chlad']); }

  $poradi = $expres ? prvniPoradiStroje($strojId) : dalsiPoradiStroje($strojId);

  db()->prepare('INSERT INTO tiskove_ulohy (stroj_id, tiskarna_id, material, poradi,
                                             odhad_hodin_tisk, odhad_hodin_chladnuti, stav, expres)
                 VALUES (?,?,?,?,?,?,"fronta",?)')
      ->execute([$strojId, $tiskarnaId, $material, $poradi, round($hodinTisk, 2), round($hodinChlad, 2),
                 $expres ? 1 : 0]);
  $ulohaId = (int)db()->lastInsertId();

  $ins = db()->prepare('INSERT OR IGNORE INTO uloha_polozky (uloha_id, polozka_id, pocet) VALUES (?,?,?)');
  foreach ($polozky as $p) $ins->execute([$ulohaId, (int)$p['id'], (int)$p['pocet']]);

  synchronizujStavZakazek(array_map(fn($p) => (int)$p['zakazka_id'], $polozky));

  return $ulohaId;
}

function dalsiPoradiStroje(int $strojId): int {
  $q = db()->prepare('SELECT MAX(poradi) FROM tiskove_ulohy WHERE stroj_id = ? AND stav IN ("fronta","tiskne")');
  $q->execute([$strojId]);
  $v = $q->fetchColumn();
  return $v === null ? 0 : ((int)$v) + 1;
}

function prvniPoradiStroje(int $strojId): int {
  $q = db()->prepare('SELECT MIN(poradi) FROM tiskove_ulohy WHERE stroj_id = ? AND stav IN ("fronta","tiskne")');
  $q->execute([$strojId]);
  $v = $q->fetchColumn();
  return $v === null ? 0 : ((int)$v) - 1;
}

/** Nad prahem (nebo vynuceně) založí úlohu ze všech čekajících dílů dané (tiskárna, materiál). */
function poolPromuj(int $tiskarnaId, string $material, bool $vynutit = false): ?int {
  $prah = (float)nastaveni('davkaPraH', '0.8');

  $vyhovujici = array_values(array_filter(nenaplanovanePolozky(), function ($p) use ($tiskarnaId, $material) {
    if (jeExpres($p['rychlost']) || $p['material'] !== $material) return false;
    $t = tiskarnaPodleNazvu($p['tiskarna_nazev']);
    return $t && (int)$t['id'] === $tiskarnaId;
  }));
  if (!$vyhovujici) return null;

  $fill = 0.0;
  foreach ($vyhovujici as $p) $fill += (int)$p['pocet'] / max(1, (int)$p['perjob']);
  if (!$vynutit && $fill < $prah) return null;

  return ulohaZaloz($tiskarnaId, $material, $vyhovujici, false);
}

/** Expresní díly zakázky nikdy nečekají — hned na začátek fronty vhodného stroje. */
function ulohaExpresProZakazku(int $zakazkaId): array {
  $q = db()->prepare(
    "SELECT p.* FROM polozky p
      WHERE p.zakazka_id = ? AND NOT EXISTS (SELECT 1 FROM uloha_polozky up WHERE up.polozka_id = p.id)");
  $q->execute([$zakazkaId]);

  $skupiny = [];
  foreach ($q->fetchAll() as $p) {
    if (!jeExpres($p['rychlost'])) continue;
    $t = tiskarnaPodleNazvu($p['tiskarna_nazev']);
    if (!$t) continue;
    $klic = $t['id'] . '|' . $p['material'];
    $skupiny[$klic]['tiskarnaId'] = (int)$t['id'];
    $skupiny[$klic]['material']   = $p['material'];
    $skupiny[$klic]['polozky'][]  = $p;
  }

  $vytvorene = [];
  foreach ($skupiny as $s) {
    $id = ulohaZaloz($s['tiskarnaId'], $s['material'], $s['polozky'], true);
    if ($id) $vytvorene[] = $id;
  }
  return $vytvorene;
}
