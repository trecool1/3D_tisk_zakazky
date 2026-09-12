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
}
