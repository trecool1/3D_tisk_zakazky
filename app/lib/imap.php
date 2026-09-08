<?php
declare(strict_types=1);

// Příchozí pošta. Jedna schránka, cron každých 5 minut — žádný trvale běžící proces.
// Přiřazení sestupně podle spolehlivosti; co se nepodaří, jde do Nezařazeno.

function imapDostupny(): bool { return function_exists('imap_open'); }

function imapPripoj() {
  $c = (array)cfg('imap', []);
  if (($c['host'] ?? '') === '' || ($c['host'] ?? '') === 'imap.example.cz') return null;
  $mbox = sprintf('{%s:%d/imap%s}%s',
    $c['host'], (int)($c['port'] ?? 993),
    !empty($c['ssl']) ? '/ssl' : '/notls',
    $c['slozka'] ?? 'INBOX');
  return @imap_open($mbox, (string)($c['user'] ?? ''), (string)($c['pass'] ?? ''), 0, 1);
}

/* ---------- rozpoznání automatických odpovědí ---------- */

// Automatické odpovědi nesmí založit kartu ani zvednout příznak nepřečtené zprávy.
function jeAutomat(array $h): bool {
  $x = fn(string $k) => strtolower(trim((string)($h[$k] ?? '')));
  if ($x('auto-submitted') !== '' && $x('auto-submitted') !== 'no') return true;
  if ($x('x-autoreply') !== '' || $x('x-autorespond') !== '')       return true;
  if (in_array($x('precedence'), ['bulk', 'auto_reply', 'junk', 'list'], true)) return true;
  if ($x('x-auto-response-suppress') !== '')                        return true;
  if ($x('return-path') === '<>')                                   return true;   // doručenky
  if (str_contains($x('from'), 'mailer-daemon') || str_contains($x('from'), 'postmaster')) return true;
  return false;
}

function jeBounce(array $h): bool {
  $ct = strtolower((string)($h['content-type'] ?? ''));
  return str_contains($ct, 'report-type=delivery-status')
      || strtolower(trim((string)($h['return-path'] ?? ''))) === '<>';
}

/* ---------- párování ---------- */

/**
 * Vrátí [zakazka|null, popisParovani, duvodNezarazeni].
 * 1) klíč v adrese příjemce  2) In-Reply-To / References
 * 3) číslo zakázky v předmětu  4) adresa odesílatele s jedinou otevřenou zakázkou
 */
function sparujZpravu(array $m): array {
  // 1) zakazky+P-2026-0431@…
  $prijemci = ($m['to'] ?? '') . ' ' . ($m['cc'] ?? '') . ' ' . ($m['delivered_to'] ?? '');
  if (preg_match('/\+(P-\d{4}-\d{4})@/i', $prijemci, $mm)) {
    $z = zakazkaPodleCisla(strtoupper($mm[1]));
    if ($z) return [$z, 'klíč v adrese příjemce', ''];
  }

  // 2) In-Reply-To / References proti našim odchozím Message-ID
  $odkazy = trim(($m['in_reply_to'] ?? '') . ' ' . ($m['references'] ?? ''));
  if ($odkazy !== '' && preg_match_all('/<?([^<>\s]+@[^<>\s]+)>?/', $odkazy, $mm)) {
    foreach ($mm[1] as $mid) {
      $q = db()->prepare('SELECT zakazka_id FROM zpravy WHERE message_id = ? AND typ = "odchozi" LIMIT 1');
      $q->execute([$mid]);
      $id = $q->fetchColumn();
      if ($id) return [zakazkaPodleId((int)$id), 'In-Reply-To odchozí zprávy', ''];
    }
  }

  // 3) číslo zakázky v předmětu
  if (preg_match('/(P-\d{4}-\d{4})/i', (string)($m['subject'] ?? ''), $mm)) {
    $z = zakazkaPodleCisla(strtoupper($mm[1]));
    if ($z) return [$z, 'číslo zakázky v předmětu', ''];
  }

  // 4) adresa odesílatele, pokud má právě jednu otevřenou zakázku mladší 30 dnů
  $od = strtolower(trim((string)($m['from_email'] ?? '')));
  if ($od !== '') {
    $q = db()->prepare(
      'SELECT * FROM zakazky
        WHERE lower(zak_email) = ? AND stav NOT IN ("hotovo","odlozeno")
          AND vytvoreno > datetime("now", "-30 days")');
    $q->execute([$od]);
    $nalezene = $q->fetchAll();
    if (count($nalezene) === 1) {
      return [$nalezene[0], 'přiřazeno automaticky podle adresy', ''];
    }
    if (count($nalezene) > 1) {
      return [null, '', 'adresa má víc otevřených zakázek'];
    }
  }

  return [null, '', 'neznámý odesílatel'];
}

/* ---------- zpracování schránky ---------- */

function nactiPostu(): array {
  $stat = ['nactenych' => 0, 'prirazenych' => 0, 'nezarazenych' => 0, 'automatu' => 0, 'chyba' => ''];

  if (!imapDostupny()) { $stat['chyba'] = 'Rozšíření php-imap není nainstalováno.'; return $stat; }
  $mbox = imapPripoj();
  if (!$mbox) { $stat['chyba'] = 'IMAP: ' . (imap_last_error() ?: 'nenastaveno'); return $stat; }

  $uid = imap_search($mbox, 'UNSEEN', SE_UID) ?: [];
  foreach ($uid as $u) {
    $m = imapZprava($mbox, (int)$u);
    $stat['nactenych']++;

    $q = db()->prepare('SELECT 1 FROM videne_maily WHERE message_id = ?');
    $q->execute([$m['message_id']]);
    if ($q->fetchColumn()) { imap_setflag_full($mbox, (string)$u, '\\Seen', ST_UID); continue; }
    db()->prepare('INSERT OR IGNORE INTO videne_maily (message_id) VALUES (?)')->execute([$m['message_id']]);

    [$z, $parovani, $duvod] = sparujZpravu($m);

    // Vlastní strojové upozornění z kalkulátoru (hlavička X-Poptavka-Cislo nebo
    // odesílatel kalkulator@…). Poptávku řeší pull import z objednavky.json, kde
    // jsou kompletní data — tenhle e-mail je jen kopie, do kanbanu ho netaháme.
    if (($m['hlavicky']['x-poptavka-cislo'] ?? '') !== ''
        || str_starts_with($m['from_email'], 'kalkulator@')) {
      imap_setflag_full($mbox, (string)$u, '\\Seen', ST_UID);
      continue;
    }

    // automatické odpovědi kartu nezakládají ani nezvedají nepřečtenou zprávu
    if (jeAutomat($m['hlavicky'])) {
      $stat['automatu']++;
      if ($z) {
        systemovyZaznam((int)$z['id'], jeBounce($m['hlavicky'])
          ? 'E-mail se nedoručil: ' . $m['subject']
          : 'Automatická odpověď: ' . $m['subject']);
        if (jeBounce($m['hlavicky'])) {
          db()->prepare('UPDATE zakazky SET nedorucitelny = 1 WHERE id = ?')->execute([(int)$z['id']]);
        }
      }
      imap_setflag_full($mbox, (string)$u, '\\Seen', ST_UID);
      continue;
    }

    if ($z) {
      ulozPrichozi($z, $m, $parovani);
      $stat['prirazenych']++;
    } else {
      // Co se nepodařilo spolehlivě spárovat (včetně neznámého odesílatele) jde
      // do Nezařazeno — kartu založí až člověk, aby spam nezaplevelil tabuli.
      db()->prepare('INSERT INTO nezarazeno (od, predmet, telo, kdy, duvod, message_id, in_reply_to, refs)
                     VALUES (?,?,?,?,?,?,?,?)')
          ->execute([$m['from'], $m['subject'], $m['telo'], $m['kdy'], $duvod ?: 'neznámý odesílatel',
                     $m['message_id'], $m['in_reply_to'], $m['references']]);
      $stat['nezarazenych']++;
    }

    imap_setflag_full($mbox, (string)$u, '\\Seen', ST_UID);
  }

  imap_close($mbox);
  return $stat;
}

function ulozPrichozi(array $z, array $m, string $parovani): void {
  db()->prepare('INSERT INTO zpravy (zakazka_id, typ, od, komu, predmet, telo, telo_html, message_id,
                                     in_reply_to, refs, parovani, precteno, kdy)
                 VALUES (?,"prichozi",?,?,?,?,?,?,?,?,?,0,?)')
      ->execute([(int)$z['id'], $m['from'], $m['to'], $m['subject'], $m['telo'], $m['telo_html'],
                 $m['message_id'], $m['in_reply_to'], $m['references'], $parovani, $m['kdy']]);
  db()->prepare('UPDATE zakazky SET zmeneno = ? WHERE id = ?')->execute([ted(), (int)$z['id']]);
}

/* ---------- čtení jedné zprávy ---------- */

function imapZprava($mbox, int $uid): array {
  $hlavickyRaw = imap_fetchheader($mbox, $uid, FT_UID);
  $h = [];
  foreach (preg_split('/\r?\n(?![ \t])/', $hlavickyRaw) as $r) {
    if (!str_contains($r, ':')) continue;
    [$k, $v] = explode(':', $r, 2);
    $h[strtolower(trim($k))] = trim(preg_replace('/\s+/', ' ', $v));
  }
  $o = imap_headerinfo($mbox, imap_msgno($mbox, $uid));

  $fromEmail = '';
  $fromName  = '';
  if (!empty($o->from[0])) {
    $fromEmail = strtolower(($o->from[0]->mailbox ?? '') . '@' . ($o->from[0]->host ?? ''));
    $fromName  = imapDekoduj((string)($o->from[0]->personal ?? ''));
  }

  return [
    'hlavicky'    => $h,
    'from'        => trim($fromName . ' <' . $fromEmail . '>'),
    'from_email'  => $fromEmail,
    'from_name'   => $fromName,
    'to'          => imapDekoduj((string)($h['to'] ?? '')),
    'cc'          => (string)($h['cc'] ?? ''),
    'delivered_to'=> (string)($h['delivered-to'] ?? ''),
    'subject'     => imapDekoduj((string)($h['subject'] ?? '(bez předmětu)')),
    'message_id'  => trim((string)($h['message-id'] ?? bin2hex(random_bytes(8))), '<>'),
    'in_reply_to' => (string)($h['in-reply-to'] ?? ''),
    'references'  => (string)($h['references'] ?? ''),
    'kdy'         => date('Y-m-d H:i:s', isset($o->udate) ? (int)$o->udate : time()),
    'telo'        => imapTelo($mbox, $uid, 'TEXT/PLAIN'),
    'telo_html'   => imapTelo($mbox, $uid, 'TEXT/HTML'),
  ];
}

function imapDekoduj(string $s): string {
  $out = '';
  foreach (imap_mime_header_decode($s) ?: [] as $c) {
    $charset = strtoupper($c->charset ?? 'default');
    $out .= ($charset === 'DEFAULT' || $charset === 'UTF-8')
      ? $c->text
      : (@mb_convert_encoding($c->text, 'UTF-8', $charset) ?: $c->text);
  }
  return trim($out);
}

function imapTelo($mbox, int $uid, string $chtenyTyp): string {
  $struktura = imap_fetchstructure($mbox, $uid, FT_UID);
  if (!$struktura) return '';

  $najdi = function ($cast, string $cesta) use (&$najdi, $chtenyTyp): ?string {
    $typy = ['TEXT','MULTIPART','MESSAGE','APPLICATION','AUDIO','IMAGE','VIDEO','OTHER'];
    $typ  = ($typy[$cast->type] ?? 'OTHER') . '/' . strtoupper((string)($cast->subtype ?? ''));
    if (!empty($cast->parts)) {
      foreach ($cast->parts as $i => $p) {
        $r = $najdi($p, $cesta === '' ? (string)($i + 1) : $cesta . '.' . ($i + 1));
        if ($r !== null) return $r;
      }
      return null;
    }
    return $typ === $chtenyTyp ? ($cesta === '' ? '1' : $cesta) : null;
  };

  $cesta = $najdi($struktura, '');
  if ($cesta === null) return '';

  $data = imap_fetchbody($mbox, $uid, $cesta, FT_UID);
  $cast = $struktura;
  foreach (explode('.', $cesta) as $i) {
    if (!empty($cast->parts)) $cast = $cast->parts[(int)$i - 1] ?? $cast;
  }
  $enc = (int)($cast->encoding ?? 0);
  if ($enc === 3) $data = base64_decode($data);
  if ($enc === 4) $data = quoted_printable_decode($data);

  $charset = 'UTF-8';
  foreach ((array)($cast->parameters ?? []) as $p) {
    if (strtolower((string)$p->attribute) === 'charset') $charset = strtoupper((string)$p->value);
  }
  if ($charset !== 'UTF-8') $data = @mb_convert_encoding($data, 'UTF-8', $charset) ?: $data;

  return trim((string)$data);
}
