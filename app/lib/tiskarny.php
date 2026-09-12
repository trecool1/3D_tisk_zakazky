<?php
declare(strict_types=1);

// Registr tiskáren (typ) a strojů (fyzický kus). Typy se seedují z pricing.json
// (viz instaluj.php), stroje spravuje obsluha ručně v Nastavení.

function tiskarnySeznam(): array {
  return array_map(function ($t) {
    $klice = jsonDek($t['materialy'], []);
    return [
      'id'              => (int)$t['id'],
      'klic'            => $t['klic'],
      'nazev'           => $t['nazev'],
      'tech'            => $t['tech'],
      'materialy'       => $klice,
      // hezké názvy materiálů (z pricing.json kalkulátoru) pro výběr v UI —
      // "materialy" jsou jen interní klíče ("pa12"), obsluha chce vidět "PA12"
      'materialyLabels' => array_map(fn($k) => (string)(pricingNajdi('materials', $k)['label'] ?? $k), $klice),
      'build'           => [(float)$t['build_x'], (float)$t['build_y'], (float)$t['build_z']],
      'spacing'         => (float)$t['spacing'],
      'rate'            => (float)$t['rate'],
      'throughput'      => (float)$t['throughput'],
      'inHouse'         => (int)$t['in_house'] === 1,
      'aktivni'         => (int)$t['aktivni'] === 1,
    ];
  }, db()->query('SELECT * FROM tiskarny ORDER BY nazev')->fetchAll());
}

function strojeSeznam(): array {
  return array_map(fn($s) => [
    'id'         => (int)$s['id'],
    'tiskarnaId' => (int)$s['tiskarna_id'],
    'oznaceni'   => $s['oznaceni'],
    'aktivni'    => (int)$s['aktivni'] === 1,
    'poznamka'   => $s['poznamka'],
  ], db()->query('SELECT * FROM stroje ORDER BY oznaceni')->fetchAll());
}

function tiskarnaUloz(array $v): void {
  $klic = (string)($v['klic'] ?? '');
  if ($klic === '') return;
  $existuje = db()->prepare('SELECT id FROM tiskarny WHERE klic = ?');
  $existuje->execute([$klic]);
  if ($existuje->fetchColumn() === false) {
    db()->prepare('INSERT INTO tiskarny (klic, nazev, tech, materialy, build_x, build_y, build_z,
                                          spacing, rate, throughput, in_house, aktivni)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,1)')
        ->execute([$klic, (string)($v['nazev'] ?? $klic), (string)($v['tech'] ?? ''),
                   jsonEnk((array)($v['materialy'] ?? [])),
                   (float)($v['build'][0] ?? 0), (float)($v['build'][1] ?? 0), (float)($v['build'][2] ?? 0),
                   (float)($v['spacing'] ?? 0), (float)($v['rate'] ?? 0), (float)($v['throughput'] ?? 0),
                   !empty($v['inHouse']) ? 1 : 0]);
    return;
  }
  db()->prepare('UPDATE tiskarny SET nazev = ?, aktivni = ? WHERE klic = ?')
      ->execute([(string)($v['nazev'] ?? $klic), !empty($v['aktivni']) ? 1 : 0, $klic]);
}

function strojUloz(array $v): void {
  $id = (int)($v['id'] ?? 0);
  if ($id > 0) {
    db()->prepare('UPDATE stroje SET oznaceni = ?, aktivni = ?, poznamka = ? WHERE id = ?')
        ->execute([(string)($v['oznaceni'] ?? ''), !empty($v['aktivni']) ? 1 : 0,
                   (string)($v['poznamka'] ?? ''), $id]);
    return;
  }
  $tiskarnaId = (int)($v['tiskarnaId'] ?? 0);
  if ($tiskarnaId <= 0) return;
  db()->prepare('INSERT INTO stroje (tiskarna_id, oznaceni, aktivni, poznamka) VALUES (?,?,1,?)')
      ->execute([$tiskarnaId, (string)($v['oznaceni'] ?? ''), (string)($v['poznamka'] ?? '')]);
}

function strojSmaz(int $id): void {
  db()->prepare('UPDATE stroje SET aktivni = 0 WHERE id = ?')->execute([$id]);
}

/**
 * "Smazání" tiskárny je vždy jen deaktivace (typ se dá znovu seedovat z ceníku
 * kalkulátoru přes instaluj.php, hard delete by se tedy stejně příště vrátil) —
 * navíc deaktivuje i její stroje, ať s ní hned přestane počítat plánování výroby.
 */
function tiskarnaSmaz(string $klic): void {
  $q = db()->prepare('SELECT id FROM tiskarny WHERE klic = ?');
  $q->execute([$klic]);
  $id = $q->fetchColumn();
  if (!$id) return;
  db()->prepare('UPDATE tiskarny SET aktivni = 0 WHERE id = ?')->execute([$id]);
  db()->prepare('UPDATE stroje SET aktivni = 0 WHERE tiskarna_id = ?')->execute([$id]);
}

/** Case-insensitive hledání podle názvu — pro spárování starého textového pole zakazky.tiskarna. */
function tiskarnaPodleNazvu(string $nazev): ?array {
  $nazev = trim($nazev);
  if ($nazev === '') return null;
  foreach (tiskarnySeznam() as $t) {
    if (strcasecmp($t['nazev'], $nazev) === 0) return $t;
  }
  return null;
}
