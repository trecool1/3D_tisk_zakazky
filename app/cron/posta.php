<?php
declare(strict_types=1);
// Příchozí pošta — spouští cron každých 5 minut.
require dirname(__DIR__) . '/bootstrap.php';
require KANBAN_APP . '/lib/auth.php';
require KANBAN_APP . '/lib/zakazky.php';
require KANBAN_APP . '/lib/pricing.php';
require KANBAN_APP . '/lib/mail.php';
require KANBAN_APP . '/lib/imap.php';

$s = nactiPostu();
zaloguj(sprintf('CRON pošta: načteno %d, přiřazeno %d, nezařazeno %d, nových karet %d, automatů %d%s',
  $s['nactenych'], $s['prirazenych'], $s['nezarazenych'], $s['novych'], $s['automatu'],
  $s['chyba'] !== '' ? ' · CHYBA: ' . $s['chyba'] : ''));

// upozornění dílně na nové zprávy — souhrn, ne zpráva za každou drobnost
if ($s['prirazenych'] + $s['novych'] > 0) {
  upozorniDilnu('Nové zprávy k zakázkám (' . ($s['prirazenych'] + $s['novych']) . ')',
    "Ve schránce přibyly zprávy k zakázkám.\n"
    . "Přiřazeno: {$s['prirazenych']}\nNové karty: {$s['novych']}\nNezařazeno: {$s['nezarazenych']}\n");
}
echo "posta: " . jsonEnk($s) . "\n";
