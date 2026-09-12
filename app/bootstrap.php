<?php
declare(strict_types=1);

// Společný start pro všechny vstupní body. Načte konfiguraci, otevře databázi
// a vystaví drobné pomůcky. Nic z tohoto adresáře není přístupné přes web.

define('KANBAN_APP', __DIR__);

function cfg(?string $klic = null, $vychozi = null) {
  static $c = null;
  if ($c === null) {
    $soubor = KANBAN_APP . '/config.php';
    if (!is_file($soubor)) { $soubor = KANBAN_APP . '/config.vzor.php'; }
    $c = require $soubor;
  }
  if ($klic === null) return $c;
  return array_key_exists($klic, $c) ? $c[$klic] : $vychozi;
}

function db(): PDO {
  static $pdo = null;
  if ($pdo !== null) return $pdo;

  $cesta = cfg('db');
  $novy  = !is_file($cesta);
  if (!is_dir(dirname($cesta))) @mkdir(dirname($cesta), 0770, true);

  $pdo = new PDO('sqlite:' . $cesta, null, null, [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
  ]);
  $pdo->exec('PRAGMA journal_mode = WAL');
  $pdo->exec('PRAGMA foreign_keys = ON');
  $pdo->exec('PRAGMA busy_timeout = 5000');
  if ($novy) { @chmod($cesta, 0660); }
  return $pdo;
}

function schemaAktualizuj(): void {
  db()->exec(file_get_contents(KANBAN_APP . '/schema.sql'));
  // Sloupce doplněné do už existujících tabulek (CREATE IF NOT EXISTS je nepřidá).
  sloupecZajisti('soubory', 'pridal', "TEXT NOT NULL DEFAULT ''");
  sloupecZajisti('zakazky', 'schvaleno_videno', 'INTEGER NOT NULL DEFAULT 1');
  // položka nese vlastní tech/materiál/tiskárnu — u víceřádkových objednávek se
  // dřív bralo jen z první varianty (viz prijmiPoptavku).
  sloupecZajisti('polozky', 'tech', "TEXT NOT NULL DEFAULT ''");
  sloupecZajisti('polozky', 'material', "TEXT NOT NULL DEFAULT ''");
  sloupecZajisti('polozky', 'rychlost', "TEXT NOT NULL DEFAULT ''");
  sloupecZajisti('polozky', 'tiskarna_nazev', "TEXT NOT NULL DEFAULT ''");
  sloupecZajisti('polozky', 'perjob', 'INTEGER NOT NULL DEFAULT 1');
  sloupecZajisti('polozky', 'hodiny_tisku', 'REAL NOT NULL DEFAULT 0');
  sloupecZajisti('polozky', 'hodiny_schnuti', 'REAL NOT NULL DEFAULT 0');
  sloupecZajisti('polozky', 'hodiny_manipulace', 'REAL NOT NULL DEFAULT 0');
  // dokud je 1, sloupec karty se řídí automaticky stavem navázaných tiskových úloh;
  // ruční přesun karty (akce presun) to vypne, ať se karta nevrátí sama zpátky.
  sloupecZajisti('zakazky', 'stav_auto', 'INTEGER NOT NULL DEFAULT 1');
}

/** Idempotentně přidá sloupec do tabulky, pokud v ní ještě není. */
function sloupecZajisti(string $tabulka, string $sloupec, string $definice): void {
  foreach (db()->query('PRAGMA table_info(' . $tabulka . ')') as $r) {
    if ($r['name'] === $sloupec) return;
  }
  db()->exec('ALTER TABLE ' . $tabulka . ' ADD COLUMN ' . $sloupec . ' ' . $definice);
}

/* ---------- drobnosti ---------- */

function jsonDek(?string $s, $vychozi = []) {
  if ($s === null || $s === '') return $vychozi;
  $v = json_decode($s, true);
  return $v === null ? $vychozi : $v;
}

function jsonEnk($v): string {
  return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

function ted(): string { return (new DateTimeImmutable('now'))->format('Y-m-d H:i:s'); }

function zaloguj(string $co): void {
  $f = cfg('log');
  if (!$f) return;
  @file_put_contents($f, ted() . '  ' . $co . "\n", FILE_APPEND);
}

function nahodnyToken(int $bajtu = 24): string {
  return rtrim(strtr(base64_encode(random_bytes($bajtu)), '+/', '-_'), '=');
}

/* ---------- české formátování (pro e-maily a exporty) ---------- */

function fNum(float $n): string {
  return str_replace(',', ' ', number_format(round($n), 0, ',', ','));
}
function fKc(float $n): string { return fNum($n) . ' Kč'; }

function fDatum(string $isoDen): string {
  $d = DateTimeImmutable::createFromFormat('Y-m-d', substr($isoDen, 0, 10));
  return $d ? ((int)$d->format('j')) . '. ' . ((int)$d->format('n')) . '.' : $isoDen;
}

function fDny(int $n): string {
  return $n === 1 ? '1 den' : ($n < 5 ? $n . ' dny' : $n . ' dnů');
}

/* ---------- odpovědi API ---------- */

function odesliJson($data, int $kod = 200): void {
  http_response_code($kod);
  header('Content-Type: application/json; charset=utf-8');
  header('X-Content-Type-Options: nosniff');
  echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

function chyba(string $zprava, int $kod = 400): void {
  odesliJson(['ok' => false, 'chyba' => $zprava], $kod);
}

function vstupJson(): array {
  $raw = file_get_contents('php://input');
  if ($raw === '' || $raw === false) return [];
  $v = json_decode($raw, true);
  return is_array($v) ? $v : [];
}
