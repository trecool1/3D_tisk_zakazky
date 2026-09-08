<?php
declare(strict_types=1);

// Odchozí pošta. Do každé zprávy patří číslo zakázky v předmětu, Reply-To
// s klíčem zakázky a vlastní Message-ID, které si uložíme kvůli párování odpovědí.

function messageId(string $cislo): string {
  return sprintf('%s.%s@%s', strtolower($cislo), bin2hex(random_bytes(6)), cfg('mailDomain', 'localhost'));
}

function replyTo(string $cislo): string {
  return sprintf((string)cfg('replyToKlic', 'zakazky+%s@localhost'), $cislo);
}

function predmetSCislem(string $predmet, string $cislo): string {
  return str_contains($predmet, '[' . $cislo . ']') ? $predmet : rtrim($predmet) . ' [' . $cislo . ']';
}

/**
 * Odešle e-mail. Vrací [ok, messageId, chyba].
 * Když není nastaven SMTP, použije se mail() — funguje jen když má server MTA.
 */
function posliMail(string $komu, string $predmet, string $telo, array $hlavicky = []): array {
  $from     = (string)cfg('mailFrom', 'zakazky@localhost');
  $fromName = (string)cfg('mailFromName', 'Cadmia3D');
  $mid      = $hlavicky['Message-ID'] ?? ('<' . bin2hex(random_bytes(8)) . '@' . cfg('mailDomain', 'localhost') . '>');

  $h = array_merge([
    'From'         => sprintf('=?UTF-8?B?%s?= <%s>', base64_encode($fromName), $from),
    'MIME-Version' => '1.0',
    'Content-Type' => 'text/plain; charset=UTF-8',
    'Content-Transfer-Encoding' => '8bit',
    'Message-ID'   => $mid,
    'Date'         => date('r'),
  ], $hlavicky);
  $h['Message-ID'] = $mid;

  $predmetEnc = '=?UTF-8?B?' . base64_encode($predmet) . '?=';
  $smtp = cfg('smtp');

  if (!is_array($smtp) || ($smtp['host'] ?? '') === '' || ($smtp['host'] ?? '') === 'smtp.example.cz') {
    // fallback: lokální MTA
    $radky = '';
    foreach ($h as $k => $v) if ($k !== 'Subject') $radky .= "$k: $v\r\n";
    $ok = @mail($komu, $predmetEnc, $telo, rtrim($radky));
    return [$ok, $mid, $ok ? '' : 'mail() selhalo (není nastaven SMTP ani lokální MTA)'];
  }

  return smtpOdesli($smtp, $from, $komu, $predmetEnc, $telo, $h, $mid);
}

/** Minimální SMTP klient — stačí na pár zpráv denně, žádná knihovna navíc. */
function smtpOdesli(array $s, string $from, string $komu, string $predmetEnc, string $telo, array $h, string $mid): array {
  $host = (string)$s['host'];
  $port = (int)($s['port'] ?? 587);
  $tls  = (bool)($s['tls'] ?? true);

  $proud = @stream_socket_client(
    ($port === 465 ? 'ssl://' : 'tcp://') . $host . ':' . $port,
    $errno, $errstr, 20, STREAM_CLIENT_CONNECT);
  if (!$proud) return [false, $mid, "SMTP spojení selhalo: $errstr"];
  stream_set_timeout($proud, 20);

  $cti = function () use ($proud): string {
    $out = '';
    while (($r = fgets($proud, 1024)) !== false) {
      $out .= $r;
      if (strlen($r) < 4 || $r[3] !== '-') break;
    }
    return $out;
  };
  $posli = function (string $cmd) use ($proud, $cti): string { fwrite($proud, $cmd . "\r\n"); return $cti(); };
  $kod = fn(string $o): int => (int)substr(trim($o), 0, 3);

  $cti();
  $odpoved = $posli('EHLO ' . cfg('mailDomain', 'localhost'));
  if ($tls && $port !== 465) {
    if ($kod($posli('STARTTLS')) !== 220) { fclose($proud); return [false, $mid, 'STARTTLS odmítnut']; }
    if (!@stream_socket_enable_crypto($proud, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
      fclose($proud); return [false, $mid, 'TLS handshake selhal'];
    }
    $odpoved = $posli('EHLO ' . cfg('mailDomain', 'localhost'));
  }
  if (($s['user'] ?? '') !== '') {
    $posli('AUTH LOGIN');
    $posli(base64_encode((string)$s['user']));
    if ($kod($posli(base64_encode((string)$s['pass']))) !== 235) {
      fclose($proud); return [false, $mid, 'SMTP přihlášení selhalo'];
    }
  }
  if ($kod($posli('MAIL FROM:<' . $from . '>')) !== 250) { fclose($proud); return [false, $mid, 'MAIL FROM odmítnuto']; }
  if ($kod($posli('RCPT TO:<' . $komu . '>'))  !== 250) { fclose($proud); return [false, $mid, 'RCPT TO odmítnuto']; }
  if ($kod($posli('DATA')) !== 354)                     { fclose($proud); return [false, $mid, 'DATA odmítnuto']; }

  $zprava = '';
  foreach ($h as $k => $v) $zprava .= "$k: $v\r\n";
  $zprava .= "To: $komu\r\nSubject: $predmetEnc\r\n\r\n";
  // tečka na začátku řádku se v SMTP zdvojuje
  $zprava .= preg_replace('/^\./m', '..', str_replace("\n", "\r\n", str_replace("\r\n", "\n", $telo)));
  $vysledek = $posli($zprava . "\r\n.");
  $posli('QUIT');
  fclose($proud);

  return [$kod($vysledek) === 250, $mid, $kod($vysledek) === 250 ? '' : trim($vysledek)];
}

/**
 * Odešle odpověď zákazníkovi z karty a uloží ji do konverzace.
 */
function odesliZakaznikovi(array $z, string $predmet, string $telo): array {
  $komu = trim((string)$z['zak_email']);
  if ($komu === '') return [false, 'Zakázka nemá e-mail zákazníka.'];

  $cislo   = (string)$z['cislo'];
  $predmet = predmetSCislem($predmet !== '' ? $predmet : 'Zakázka', $cislo);
  $mid     = '<' . messageId($cislo) . '>';

  // Navázat na POSLEDNÍ příchozí zprávu zákazníka, ať se odpověď v jeho klientovi
  // zařadí pod jeho poslední dotaz, ne pod původní poptávku.
  $qP = db()->prepare('SELECT message_id FROM zpravy
                        WHERE zakazka_id = ? AND typ = "prichozi" AND message_id <> ""
                        ORDER BY kdy DESC, id DESC LIMIT 1');
  $qP->execute([(int)$z['id']]);
  $posledniPrichozi = (string)$qP->fetchColumn();

  $qV = db()->prepare('SELECT message_id FROM zpravy
                        WHERE zakazka_id = ? AND message_id <> "" ORDER BY kdy, id');
  $qV->execute([(int)$z['id']]);
  $references = implode(' ', array_map(
    fn($v) => '<' . trim((string)$v, '<>') . '>', array_column($qV->fetchAll(), 'message_id')));

  $hlavicky = ['Reply-To' => replyTo($cislo), 'Message-ID' => $mid];
  if ($posledniPrichozi !== '') $hlavicky['In-Reply-To'] = '<' . trim($posledniPrichozi, '<>') . '>';
  if ($references !== '')       $hlavicky['References']   = $references;

  [$ok, $mid, $chyba] = posliMail($komu, $predmet, $telo, $hlavicky);

  db()->prepare('INSERT INTO zpravy (zakazka_id, typ, od, komu, predmet, telo, message_id, parovani, precteno, kdy)
                 VALUES (?,"odchozi",?,?,?,?,?,?,1,?)')
      ->execute([(int)$z['id'], (string)cfg('mailFrom'), $komu, $predmet, $telo, trim($mid, '<>'),
                 'odesláno z karty · Reply-To ' . replyTo($cislo), ted()]);

  if (!$ok) zaloguj('MAIL CHYBA ' . $cislo . ': ' . $chyba);
  return [$ok, $chyba];
}

/* ---------- šablony ---------- */

function sablony(): array {
  return db()->query('SELECT * FROM sablony ORDER BY poradi, id')->fetchAll();
}

function sablonaVypln(array $t, array $z): array {
  $kal  = jsonDek($z['kalkulace'], []);
  $mapa = [
    '{cislo}'  => (string)$z['cislo'],
    '{jmeno}'  => (string)$z['zak_jmeno'],
    '{cena}'   => fKc((float)($kal['celkem'] ?? 0)),
    '{termin}' => rtrim(fDatum((string)$z['termin']), '.'),
    '{odkaz}'  => stavovaUrl($z),
  ];
  return [
    'predmet' => strtr((string)$t['predmet'], $mapa),
    'telo'    => strtr((string)$t['telo'], $mapa),
  ];
}

function stavovaUrl(array $z): string {
  $base = (string)cfg('verejnaUrl', '');
  $tok  = (string)$z['token'];
  // dvě podoby: query (…/stav.php?t=) nebo hezká adresa (…/stav/<token>)
  return (str_contains($base, '?') || str_ends_with($base, '=')) ? $base . $tok : rtrim($base, '/') . '/' . $tok;
}

/** Upozornění dílně — souhrn, ne zpráva za každou drobnost. */
function upozorniDilnu(string $predmet, string $telo): void {
  if (defined('KANBAN_TICHA_POSTA') && KANBAN_TICHA_POSTA) return;   // tichý dávkový import
  if (nastaveni('infoMaily', '0') !== '1') return;                   // vypnuto v Nastavení
  // adresy z Nastavení (víc oddělených čárkou), jinak z config.php
  $kam = array_values(array_filter(array_map('trim', explode(',', nastaveni('infoMailyKam', '')))));
  if (!$kam) $kam = array_map('strval', (array)cfg('dilnaMaily', []));
  // strojová zpráva — ať ji čtečka schránky (i cizí systémy) poznají a nepárovaly
  $auto = ['Auto-Submitted' => 'auto-generated', 'Precedence' => 'bulk'];
  foreach ($kam as $adresa) {
    if (trim((string)$adresa) === '') continue;
    posliMail((string)$adresa, $predmet, $telo, $auto);
  }
}
