<?php
declare(strict_types=1);

// pricing.json zůstává vlastnictvím kalkulátoru — jeden zdroj pravdy pro ceny,
// materiály, úpravy a příznak interní / externí výroba. Kanban ho jen čte.
// Seznam externích kooperací si proto odvodí sám z konfigurace zakázky.

function pricing(): array {
  static $p = null;
  if ($p !== null) return $p;
  $f = cfg('pricing');
  $p = (is_string($f) && is_file($f)) ? jsonDek(file_get_contents($f), []) : [];
  return $p;
}

// Kalkulátor posílá jména („PETG", „Lakování"), ne klíče. Hledáme podle obojího.
function pricingNajdi(string $sekce, string $nazev): ?array {
  $nazev = trim($nazev);
  if ($nazev === '') return null;
  foreach (pricing()[$sekce] ?? [] as $x) {
    if (strcasecmp((string)($x['label'] ?? ''), $nazev) === 0) return $x;
    if (strcasecmp((string)($x['name']  ?? ''), $nazev) === 0) return $x;
    if (strcasecmp((string)($x['key']   ?? ''), $nazev) === 0) return $x;
  }
  return null;
}

// Výchozí hodnoty pro externí kooperaci, když je pricing.json neuvádí.
// Partnera a lhůtu lze u konkrétní zakázky přebít v detailu karty.
function koopVychozi(): array {
  return [
    'partner'   => (string)nastaveni('koopPartner', ''),
    'lhutaDnu'  => (int)nastaveni('koopLhutaDnu', '5'),
    'dopravaDnu'=> (int)nastaveni('koopDopravaDnu', '2'),
  ];
}

function koopZPolozky(?array $x, string $co, string $zdroj, string $klic): ?array {
  if (!$x) return null;
  // inHouse === false znamená externí výrobu; chybějící příznak bereme jako interní
  if (!array_key_exists('inHouse', $x) || $x['inHouse'] !== false) return null;
  $v = koopVychozi();
  return [
    'key'        => $klic,
    'co'         => $co,
    'zdroj'      => $zdroj,
    'partner'    => (string)($x['partner']  ?? $v['partner']),
    'lhutaDnu'   => (int)  ($x['leadDays']  ?? $v['lhutaDnu']),
    'dopravaDnu' => (int)  ($x['shipDays']  ?? $v['dopravaDnu']),
  ];
}

/**
 * Externí operace zakázky odvozené z ceníku + ručních přebití na zakázce.
 * Vrací pole [key, co, zdroj, partner, lhutaDnu, dopravaDnu, stav, hodiny].
 */
function koopOperace(array $z): array {
  $konf = jsonDek($z['konfigurace'], []);
  $out  = [];

  $m = koopZPolozky(pricingNajdi('materials', (string)($konf['material'] ?? '')),
                    'Tisk — ' . ($konf['material'] ?? ''), 'materiál', 'material');
  if ($m) $out[] = $m;

  $operace = array_values(array_filter(array_merge(
    (array)($konf['dokonceni'] ?? []),
    (($konf['uprava'] ?? '') !== '' && ($konf['uprava'] ?? '') !== 'Bez úpravy') ? [$konf['uprava']] : []
  ), fn($n) => is_string($n) && $n !== ''));

  foreach ($operace as $nazev) {
    if (array_filter($out, fn($o) => $o['key'] === $nazev)) continue;
    $x = pricingNajdi('finishes', $nazev) ?? pricingNajdi('surfaces', $nazev);
    $o = koopZPolozky($x, $nazev, 'postprocess', $nazev);
    if ($o) $out[] = $o;
  }

  // zakázka si smí přebít partnera; stav kooperace je na zakázce
  $stavy    = jsonDek($z['koop_stav'], []);
  $partneri = jsonDek($z['koop_partner'], []);
  foreach ($out as &$o) {
    if (!empty($partneri[$o['key']])) $o['partner'] = (string)$partneri[$o['key']];
    $o['stav']   = (string)($stavy[$o['key']] ?? 'ceka');
    // lhůta u partnera + doprava tam i zpět, přepočtená na hodiny
    $o['hodiny'] = ($o['lhutaDnu'] + $o['dopravaDnu'] * 2) * 24;
  }
  unset($o);
  return $out;
}

const KOOP_KROKY = [
  ['key' => 'ceka',      'label' => 'čeká na odeslání',    'dalsi' => 'Označit odesláno'],
  ['key' => 'odeslano',  'label' => 'odesláno partnerovi', 'dalsi' => 'Potvrdit převzetí'],
  ['key' => 'uPartnera', 'label' => 'u partnera',          'dalsi' => 'Přijato zpět'],
  ['key' => 'vraceno',   'label' => 'vráceno k nám',       'dalsi' => ''],
];

function koopKrokIndex(string $stav): int {
  foreach (KOOP_KROKY as $i => $k) if ($k['key'] === $stav) return $i;
  return 0;
}

/** Přehled ceníku pro obrazovku Nastavení — jen ke čtení. */
function pricingKoopPrehled(): array {
  $out = [];
  $v   = koopVychozi();
  foreach ([['materials', 'materiál'], ['surfaces', 'povrch'], ['finishes', 'postprocess']] as [$sekce, $druh]) {
    foreach (pricing()[$sekce] ?? [] as $x) {
      $externi = array_key_exists('inHouse', $x) && $x['inHouse'] === false;
      $out[] = [
        'nazev'   => (string)($x['label'] ?? $x['name'] ?? $x['key'] ?? '?'),
        'druh'    => $druh,
        'externi' => $externi,
        'partner' => $externi
          ? (((string)($x['partner'] ?? $v['partner'] ?: '— partner nenastaven —')) . ' · '
             . fDny((int)($x['leadDays'] ?? $v['lhutaDnu'])) . ' + doprava '
             . fDny((int)($x['shipDays'] ?? $v['dopravaDnu'])))
          : '—',
      ];
    }
  }
  return $out;
}
