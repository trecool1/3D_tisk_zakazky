<?php
declare(strict_types=1);
// Expresní zakázky nikdy nečekají na obsluhu — díly se hned zařadí na začátek
// fronty vhodného stroje. Standardní zakázky obsluha spouští ručně v pohledu
// Výroba (vidí tam, co je potřeba vytisknout, a sama rozhodne kolik a na čem).
require dirname(__DIR__) . '/bootstrap.php';
require KANBAN_APP . '/lib/zakazky.php';
require KANBAN_APP . '/lib/pricing.php';
require KANBAN_APP . '/lib/tiskarny.php';
require KANBAN_APP . '/lib/vyroba.php';

$zalozeno = 0;
$zakazkyId = db()->query("SELECT id FROM zakazky WHERE stav NOT IN ('hotovo','odlozeno')")
  ->fetchAll(PDO::FETCH_COLUMN);
foreach ($zakazkyId as $zid) {
  $zalozeno += count(ulohaExpresProZakazku((int)$zid));
}

zaloguj("CRON dávkování (expres): založeno úloh $zalozeno");
echo "hotovo: založeno úloh $zalozeno\n";
