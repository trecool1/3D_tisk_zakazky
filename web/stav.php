<?php
declare(strict_types=1);

// Veřejná stavová stránka. Odkaz s dlouhým náhodným tokenem chodí v potvrzovacím
// e-mailu; žádné přihlášení není potřeba. Nikdy nezobrazuje interní poznámky,
// tiskárnu, externího partnera, dopravu ani rozpad nákladů.

require __DIR__ . '/../kanban-app/bootstrap.php';
require KANBAN_APP . '/lib/auth.php';
require KANBAN_APP . '/lib/zakazky.php';
require KANBAN_APP . '/lib/pricing.php';
require KANBAN_APP . '/lib/mail.php';

$token = (string)($_GET['t'] ?? '');
if ($token === '' && preg_match('#/stav/([\w-]+)#', (string)($_SERVER['REQUEST_URI'] ?? ''), $m)) $token = $m[1];

$q = db()->prepare('SELECT * FROM zakazky WHERE token = ? AND token <> ""');
$q->execute([$token]);
$z = $q->fetch();

if (!$z) {
  http_response_code(404);
  $z = null;
} elseif (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST' && ($_POST['akce'] ?? '') === 'schvalit'
          && $z['stav'] === 'nabidka') {
  // klik zákazníka posune kartu do Schváleno. Příznak schvaleno_videno = 0 →
  // karta na tabuli dostane štítek „zákazník schválil", dokud ji dílna neotevře.
  // Nepočítá se to jako nepřečtená zpráva, ať se to neplete s dotazem zákazníka.
  db()->prepare('UPDATE zakazky SET stav = "schvaleno", schvaleno_videno = 0, zmeneno = ? WHERE id = ?')
      ->execute([ted(), (int)$z['id']]);
  systemovyZaznam((int)$z['id'], 'Zákazník schválil nabídku na stavové stránce');
  historieZapis((int)$z['id'], 'Zákazník schválil nabídku na stavové stránce', null, 'zákazník');
  upozorniDilnu('Nabídka schválena ' . $z['cislo'],
    'Zákazník schválil nabídku na zakázce ' . $z['cislo'] . '. Karta je ve stavu Schváleno.');
  header('Location: ?t=' . urlencode($token));
  exit;
}

$h = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');

if ($z) {
  $kal   = jsonDek($z['kalkulace'], []);
  $pol   = polozky((int)$z['id']);
  // staré nova/nabidka/schvaleno se po migraci na produkční tok už nevyskytují,
  // klíče zůstávají jen pro velmi staré odkazy vydané před přechodem
  $faze  = ['nova' => 0, 'prijato' => 0, 'nabidka' => 1, 'schvaleno' => 1, 'fronta' => 1, 'tisk' => 1,
            'postprocess' => 2, 'expedice' => 3, 'hotovo' => 3, 'odlozeno' => 0];
  $stage = $faze[$z['stav']] ?? 0;
}
?><!DOCTYPE html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title><?= $z ? $h($z['cislo']) . ' — stav zakázky' : 'Zakázka nenalezena' ?> · Cadmia3D</title>
<link rel="stylesheet" href="/app.css">
<style>
  body { background: var(--panel); padding: var(--space-6) var(--space-4); }
  .stranka { max-width: 760px; margin: 0 auto; background: var(--bg);
             border: 1px solid var(--line); border-left: 3px solid var(--teal); padding: var(--space-8); }
  @media (max-width: 560px) { .stranka { padding: var(--space-4); } }
</style>
</head>
<body>
<?php if (!$z): ?>
  <div class="stranka">
    <h3 style="margin:0 0 var(--space-2)">Zakázka nenalezena</h3>
    <p style="color:var(--muted-2)">Odkaz je neplatný nebo už nefunguje. Napište nám na
      <a href="mailto:<?= $h(cfg('mailFrom')) ?>"><?= $h(cfg('mailFrom')) ?></a>.</p>
  </div>
<?php else: ?>
  <div class="stranka">
    <div style="font-family:var(--font-heading);font-weight:600;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:var(--teal)">Cadmia3D · stav zakázky</div>
    <h1 style="margin:var(--space-2) 0 var(--space-1);font-size:40px;text-transform:uppercase;color:var(--teal)"><?= $h($z['cislo']) ?></h1>
    <div style="font-size:16px;color:var(--muted-2);margin-bottom:var(--space-6)">
      <?= $h($z['zak_firma'] !== '' ? $z['zak_firma'] : $z['zak_jmeno']) ?> · přijato <?= $h(fDatum((string)$z['vytvoreno'])) ?>
    </div>

    <div style="display:flex;gap:var(--space-1);margin-bottom:var(--space-6);flex-wrap:wrap">
      <?php foreach (['Přijato','Ve výrobě','Dokončujeme','Expedováno'] as $i => $label): ?>
        <div style="flex:1;min-width:120px">
          <div style="height:4px;background:<?= $i <= $stage ? 'var(--teal)' : 'var(--line)' ?>"></div>
          <div style="font-size:14px;margin-top:6px;color:<?= $i <= $stage ? 'var(--ink)' : 'var(--muted)' ?>"><?= $label ?></div>
        </div>
      <?php endforeach; ?>
    </div>

    <div style="overflow-x:auto">
    <table class="table" style="width:100%;margin-bottom:var(--space-4)">
      <thead><tr>
        <th>Položka</th>
        <th style="text-align:right">Ks</th>
        <th style="text-align:right">Cena/ks</th>
        <th style="text-align:right">Celkem</th>
      </tr></thead>
      <tbody>
      <?php foreach ($pol as $p):
        $radek = $p['cena_radek'] !== null ? (float)$p['cena_radek'] : (float)$p['cena_kus'] * (int)$p['pocet']; ?>
        <tr>
          <td><?= $h($p['nazev']) ?></td>
          <td style="text-align:right"><?= (int)$p['pocet'] ?></td>
          <td style="text-align:right"><?= $h(number_format((float)$p['cena_kus'], 2, ',', ' ')) ?> Kč</td>
          <td style="text-align:right"><?= $h(fKc($radek)) ?></td>
        </tr>
      <?php endforeach; ?>
      </tbody>
    </table>
    </div>

    <div style="display:flex;justify-content:space-between;font-size:16px;color:var(--muted-2)"><span>Bez DPH</span><span><?= $h(fKc((float)($kal['net'] ?? 0))) ?></span></div>
    <div style="display:flex;justify-content:space-between;font-size:16px;color:var(--muted-2)"><span>DPH 21 %</span><span><?= $h(fKc((float)($kal['dph'] ?? 0))) ?></span></div>
    <div style="display:flex;justify-content:space-between;font-size:20px;font-family:var(--font-heading);font-weight:700;color:var(--teal);border-top:1px solid var(--line);margin-top:var(--space-2);padding-top:var(--space-2)">
      <span>Celkem s DPH</span><span><?= $h(fKc((float)($kal['celkem'] ?? 0))) ?></span>
    </div>
    <div style="font-size:16px;color:var(--muted-2);margin-top:var(--space-2)">
      Termín dodání <?= $h(fDatum((string)$z['termin'])) ?><?= $z['zasilka'] !== '' ? ' · zásilka ' . $h($z['zasilka']) : '' ?>
    </div>

    <?php if ($z['stav'] === 'nabidka'): ?>
      <form method="post" style="margin-top:var(--space-6)">
        <input type="hidden" name="akce" value="schvalit">
        <button class="btn btn-primary" type="submit">Schvaluji nabídku</button>
        <div style="font-size:14px;color:var(--muted);margin-top:var(--space-2);max-width:52ch">
          Kliknutím nabídku potvrzujete a zakázku zařadíme do výroby.
        </div>
      </form>
    <?php endif; ?>

    <div style="font-size:12px;color:var(--muted);margin-top:var(--space-6)">
      Dotazy pište na
      <a href="mailto:<?= $h(cfg('mailFrom')) ?>?subject=<?= $h(rawurlencode('[' . $z['cislo'] . '] ')) ?>"><?= $h(cfg('mailFrom')) ?></a>
      a do předmětu uveďte <strong><?= $h('[' . $z['cislo'] . ']') ?></strong> — odpověď se nám pak
      sama připojí k této zakázce.
    </div>
  </div>
<?php endif; ?>
</body>
</html>
