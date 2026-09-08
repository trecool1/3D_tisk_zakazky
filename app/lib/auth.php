<?php
declare(strict_types=1);

// Přihlášení, sezení v cookie, role. Omezení se kontroluje na serveru;
// rozhraní je jen skrývá, aby uživatel nekoukal na tlačítka, která nemá.

const COOKIE_SEZENI = 'kanban_sid';

function prihlas(string $klic, string $heslo): ?array {
  $u = db()->prepare('SELECT * FROM uzivatele WHERE klic = ?');
  $u->execute([$klic]);
  $uziv = $u->fetch();
  if (!$uziv)                      return null;
  if ((int)$uziv['aktivni'] !== 1) return ['chyba' => 'Účet je deaktivovaný.'];
  if (!password_verify($heslo, $uziv['heslo_hash'])) return ['chyba' => 'Nesprávné heslo.'];

  $token    = nahodnyToken(32);
  $platnost = (new DateTimeImmutable('+' . (int)cfg('sezeniDnu', 30) . ' days'))->format('Y-m-d H:i:s');
  db()->prepare('INSERT INTO sezeni (token, uzivatel_id, platnost) VALUES (?,?,?)')
      ->execute([$token, $uziv['id'], $platnost]);

  setcookie(COOKIE_SEZENI, $token, [
    'expires'  => time() + 86400 * (int)cfg('sezeniDnu', 30),
    'path'     => '/',
    'httponly' => true,
    'samesite' => 'Lax',
    'secure'   => !empty($_SERVER['HTTPS']),
  ]);
  return ['uzivatel' => verejnyUzivatel($uziv)];
}

function odhlas(): void {
  $t = $_COOKIE[COOKIE_SEZENI] ?? '';
  if ($t !== '') db()->prepare('DELETE FROM sezeni WHERE token = ?')->execute([$t]);
  setcookie(COOKIE_SEZENI, '', ['expires' => time() - 3600, 'path' => '/']);
}

function ja(): ?array {
  static $u = false;
  if ($u !== false) return $u;
  $u = null;
  $t = $_COOKIE[COOKIE_SEZENI] ?? '';
  if ($t !== '') {
    $q = db()->prepare(
      'SELECT u.* FROM sezeni s JOIN uzivatele u ON u.id = s.uzivatel_id
        WHERE s.token = ? AND s.platnost > datetime("now") AND u.aktivni = 1');
    $q->execute([$t]);
    $r = $q->fetch();
    if ($r) $u = $r;
  }
  return $u;
}

function verejnyUzivatel(array $u): array {
  return [
    'klic'    => $u['klic'],
    'jmeno'   => $u['jmeno'],
    'email'   => $u['email'],
    'role'    => $u['role'],
    'aktivni' => (int)$u['aktivni'] === 1,
  ];
}

function mojeJmeno(): string { $u = ja(); return $u ? $u['jmeno'] : 'systém'; }
function mojeRole(): ?string { $u = ja(); return $u ? $u['role'] : null; }
function muzeMenit(): bool   { $r = mojeRole(); return $r === 'admin' || $r === 'dilna'; }
function jeAdmin(): bool     { return mojeRole() === 'admin'; }

function vyzadujPrihlaseni(): array {
  $u = ja();
  if (!$u) chyba('Nepřihlášen.', 401);
  return $u;
}
function vyzadujZapis(): array {
  $u = vyzadujPrihlaseni();
  if (!muzeMenit()) chyba('Účet má jen právo ke čtení.', 403);
  return $u;
}
function vyzadujAdmina(): array {
  $u = vyzadujPrihlaseni();
  if (!jeAdmin()) chyba('Vyžaduje roli Admin.', 403);
  return $u;
}

function uklidSezeni(): void {
  db()->exec('DELETE FROM sezeni WHERE platnost <= datetime("now")');
}
