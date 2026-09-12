<?php
declare(strict_types=1);
// Dávkování tiskových úloh: expresní díly jdou do fronty hned, standardní se
// spustí, jakmile jejich dávka (tiskárna + materiál) přeleze práh naplnění.
require dirname(__DIR__) . '/bootstrap.php';
require KANBAN_APP . '/lib/zakazky.php';
require KANBAN_APP . '/lib/pricing.php';
require KANBAN_APP . '/lib/tiskarny.php';
require KANBAN_APP . '/lib/vyroba.php';

$zalozeno = 0;

// expres nikdy nečeká na dávku — projet všechny otevřené zakázky s nenaplánovanými díly
$zakazkyId = db()->query(
  "SELECT DISTINCT p.zakazka_id FROM polozky p
     JOIN zakazky z ON z.id = p.zakazka_id
    WHERE z.stav NOT IN ('hotovo','odlozeno')
      AND NOT EXISTS (SELECT 1 FROM uloha_polozky up WHERE up.polozka_id = p.id)")
  ->fetchAll(PDO::FETCH_COLUMN);
foreach ($zakazkyId as $zid) {
  $zalozeno += count(ulohaExpresProZakazku((int)$zid));
}

// standardní dávky nad prahem
foreach (poolyPrehled()['davky'] as $d) {
  if (!$d['pripraveno']) continue;
  if (poolPromuj($d['tiskarnaId'], $d['material'], false)) $zalozeno++;
}

zaloguj("CRON dávkování: založeno úloh $zalozeno");
echo "hotovo: založeno úloh $zalozeno\n";
