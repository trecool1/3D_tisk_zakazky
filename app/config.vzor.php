<?php
// Kanban zakázek Cadmia3D — konfigurace.
// Zkopíruj na config.php a doplň hodnoty. Soubor je mimo webroot.
return [
  // --- úložiště ---
  'db'       => '/var/www/kanban-data/kanban.sqlite',
  'modely'   => '/var/www/kanban-data/modely',   // modely mimo webroot
  'zalohy'   => '/var/www/kanban-data/zalohy',
  'log'      => '/var/www/kanban-data/kanban.log',

  // --- napojení na kalkulátor ---
  'pricing'        => '/var/www/kalkulator/pricing.json',   // jen ke čtení
  'orderSecret'    => 'ZMEN_ME',                            // shared secret pro order.php
  'kalkulatorDir'  => '/var/www/kalkulator/poptavky',       // pro import už přijatých poptávek
  'cisloFormat'    => 'P-%Y-%04d',

  // --- e-mail ---
  'mailFrom'     => 'zakazky@cadmia3d.cz',
  'mailFromName' => 'Cadmia3D',
  'replyToKlic'  => 'zakazky+%s@cadmia3d.cz',   // %s = číslo zakázky
  'mailDomain'   => 'cadmia3d.cz',              // pro Message-ID
  'dilnaMaily'   => ['zakazky@cadmia3d.cz'],    // kam chodí upozornění dílně

  // SMTP; když je 'smtp' => null, použije se PHP mail()
  'smtp' => [
    'host' => 'smtp.example.cz',
    'port' => 587,
    'user' => '',
    'pass' => '',
    'tls'  => true,     // STARTTLS
  ],

  // IMAP pro příchozí poštu (cron každých 5 min)
  'imap' => [
    'host'   => 'imap.example.cz',
    'port'   => 993,
    'ssl'    => true,
    'user'   => '',
    'pass'   => '',
    'slozka' => 'INBOX',
  ],

  // --- veřejná stavová stránka ---
  // ?t= podoba funguje s libovolným nginx; hezká adresa …/stav/<token>
  // vyžaduje location ~ ^/stav/ z nasazeni/kanban.conf.
  'verejnaUrl' => 'https://zakazky.cadmia.net/stav.php?t=',

  // --- provoz ---
  'sezeniDnu'  => 30,
  'zalohDnu'   => 14,   // kolik denních záloh držet
];
