<?php
declare(strict_types=1);

// Jediný vstupní bod aplikačního API. Volá se jako api.php?a=<akce>,
// tělo je JSON, sezení drží cookie. Role se kontroluje u každé akce.

require __DIR__ . '/../kanban-app/bootstrap.php';
require KANBAN_APP . '/lib/auth.php';
require KANBAN_APP . '/lib/zakazky.php';
require KANBAN_APP . '/lib/pricing.php';
require KANBAN_APP . '/lib/tiskarny.php';
require KANBAN_APP . '/lib/vyroba.php';
require KANBAN_APP . '/lib/mail.php';
require KANBAN_APP . '/lib/pohled.php';

header('Cache-Control: no-store');

$akce = (string)($_GET['a'] ?? '');
$v    = vstupJson();
// Multipart požadavky (nahrání přílohy) nemají JSON tělo — parametry jsou v $_POST.
if (!$v && !empty($_POST)) $v = $_POST;

// pomůcka: načti zakázku z parametru a ověř, že existuje
$zakazka = function () use ($v): array {
  $z = zakazkaPodleCisla((string)($v['cislo'] ?? ''));
  if (!$z) chyba('Zakázka nenalezena.', 404);
  return $z;
};

try {
  switch ($akce) {

    /* ---------- přihlášení ---------- */

    case 'me': {
      $u = ja();
      odesliJson(['ok' => true, 'uzivatel' => $u ? verejnyUzivatel($u) : null]);
    }

    case 'uzivatele-login': {
      // Jen jména aktivních účtů pro rozbalovátko na přihlašovací obrazovce.
      $q = db()->query('SELECT klic, jmeno, role FROM uzivatele WHERE aktivni = 1 ORDER BY jmeno');
      odesliJson(['ok' => true, 'uzivatele' => array_map(
        fn($u) => ['klic' => $u['klic'], 'jmeno' => $u['jmeno'], 'role' => $u['role'], 'aktivni' => true],
        $q->fetchAll())]);
    }

    case 'login': {
      uklidSezeni();
      $r = prihlas((string)($v['kdo'] ?? ''), (string)($v['heslo'] ?? ''));
      if ($r === null)             chyba('Uživatel neexistuje.', 401);
      if (isset($r['chyba']))      chyba($r['chyba'], 401);
      odesliJson(['ok' => true, 'uzivatel' => $r['uzivatel']]);
    }

    case 'logout': {
      odhlas();
      odesliJson(['ok' => true]);
    }

    /* ---------- stav aplikace ---------- */

    case 'stav': {
      vyzadujPrihlaseni();
      $zakazky = [];
      foreach (db()->query('SELECT * FROM zakazky') as $z) $zakazky[] = zakazkaProSeznam($z);

      $uziv = array_map('verejnyUzivatel', db()->query('SELECT * FROM uzivatele ORDER BY jmeno')->fetchAll());

      odesliJson([
        'ok'        => true,
        'zakazky'   => $zakazky,
        'sloupce'   => array_map(fn($s) => [
                         'klic' => $s['klic'], 'nazev' => $s['nazev'],
                         'poradi' => (int)$s['poradi'], 'skryt' => (int)$s['skryt'] === 1,
                       ], sloupce()),
        'uzivatele' => $uziv,
        'nastaveni' => [
          'prahVysoka'     => (float)nastaveni('prahVysoka', '24'),
          'prahNormalni'   => (float)nastaveni('prahNormalni', '72'),
        ],
        'nezarazenoPocet' => (int)db()->query('SELECT COUNT(*) FROM nezarazeno')->fetchColumn(),
        'cas' => ted(),
      ]);
    }

    case 'detail': {
      vyzadujPrihlaseni();
      $z = $zakazka();
      // otevřením se příchozí zprávy označí jako přečtené a „zákazník schválil" jako viděné
      if (muzeMenit()) {
        db()->prepare('UPDATE zpravy SET precteno = 1 WHERE zakazka_id = ? AND typ = "prichozi"')
            ->execute([(int)$z['id']]);
        db()->prepare('UPDATE zakazky SET schvaleno_videno = 1 WHERE id = ?')->execute([(int)$z['id']]);
      }
      odesliJson(['ok' => true, 'zakazka' => zakazkaDetail($z)]);
    }

    /* ---------- změny na kartě ---------- */

    case 'presun': {
      vyzadujZapis();
      $z    = $zakazka();
      $novy = (string)($v['stav'] ?? '');
      if ($novy === '' || $novy === $z['stav']) odesliJson(['ok' => true]);
      zmen($z, function (array $z) use ($novy) {
        // ruční přesun vypíná automatické sledování podle stavu výroby (viz vyroba.php)
        db()->prepare('UPDATE zakazky SET stav = ?, stav_auto = 0 WHERE id = ?')->execute([$novy, (int)$z['id']]);
      }, 'Přesunuto do ' . nazevSloupce($novy) . ' — ' . mojeJmeno());
      odesliJson(['ok' => true]);
    }

    case 'poradi': {
      // Ruční přetažení v rámci sloupce prioritu přebije a zafixuje.
      vyzadujZapis();
      $z    = $zakazka();
      $cil  = zakazkaPodleCisla((string)($v['nad'] ?? ''));
      if (!$cil) chyba('Cílová karta nenalezena.', 404);
      $prio = prioritaZakazky($cil);
      db()->prepare('UPDATE zakazky SET priorita_rucne = 1, priorita = ?, poradi = ?, zmeneno = ? WHERE id = ?')
          ->execute([$prio, (int)$cil['poradi'] - 1, ted(), (int)$z['id']]);
      odesliJson(['ok' => true]);
    }

    case 'pole': {
      vyzadujZapis();
      $z = $zakazka();
      $zmeneno = [];
      zmen($z, function (array $z) use ($v, &$zmeneno) {
        if (array_key_exists('prirazeno', $v)) {
          $kdo = (string)$v['prirazeno'];
          db()->prepare('UPDATE zakazky SET prirazeno = ? WHERE id = ?')
              ->execute([$kdo !== '' ? $kdo : null, (int)$z['id']]);
          $zmeneno[] = 'přiřazení';
        }
        if (array_key_exists('termin', $v) && (string)$v['termin'] !== '') {
          db()->prepare('UPDATE zakazky SET termin = ? WHERE id = ?')
              ->execute([substr((string)$v['termin'], 0, 10), (int)$z['id']]);
          $zmeneno[] = 'termín';
        }
        if (array_key_exists('priorita', $v)) {
          $p = (string)$v['priorita'];
          if ($p === 'auto') {
            db()->prepare('UPDATE zakazky SET priorita_rucne = 0 WHERE id = ?')->execute([(int)$z['id']]);
          } elseif (isset(PRIO[$p])) {
            db()->prepare('UPDATE zakazky SET priorita_rucne = 1, priorita = ? WHERE id = ?')
                ->execute([$p, (int)$z['id']]);
          }
          $zmeneno[] = 'priorita';
        }
        if (array_key_exists('zasilka', $v)) {
          db()->prepare('UPDATE zakazky SET zasilka = ? WHERE id = ?')
              ->execute([(string)$v['zasilka'], (int)$z['id']]);
          $zmeneno[] = 'číslo zásilky';
        }
      }, $zmeneno ? ('Změna: ' . implode(', ', $zmeneno) . ' — ' . mojeJmeno()) : null);
      odesliJson(['ok' => true]);
    }

    case 'pocet': {
      vyzadujZapis();
      $z = $zakazka();
      zmenPocet($z, (int)($v['polozka'] ?? 0), (int)($v['pocet'] ?? 1));
      historieZapis((int)$z['id'], 'Změna počtu kusů — ' . mojeJmeno(), snimek($z));
      odesliJson(['ok' => true]);
    }

    case 'prebit-cenu': {
      vyzadujZapis();
      $z      = $zakazka();
      $castka = (float)preg_replace('/[^\d.,]/', '', str_replace(',', '.', (string)($v['castka'] ?? '')));
      if ($castka <= 0) chyba('Zadej cenu s DPH.');
      $pred = snimek($z);
      prebitCenu($z, $castka, trim((string)($v['duvod'] ?? '')));
      historieZapis((int)$z['id'], 'Ruční úprava ceny na ' . fKc($castka) . ' s DPH — ' . mojeJmeno(), $pred);
      odesliJson(['ok' => true]);
    }

    case 'koop-krok': {
      vyzadujZapis();
      $z    = $zakazka();
      $klic = (string)($v['operace'] ?? '');
      $op   = null;
      foreach (koopOperace($z) as $o) if ($o['key'] === $klic) $op = $o;
      if (!$op) chyba('Operace nenalezena.', 404);

      $dalsi = KOOP_KROKY[koopKrokIndex($op['stav']) + 1] ?? null;
      if (!$dalsi) odesliJson(['ok' => true]);

      zmen($z, function (array $z) use ($klic, $dalsi) {
        $stavy = jsonDek($z['koop_stav'], []);
        $stavy[$klic] = $dalsi['key'];
        db()->prepare('UPDATE zakazky SET koop_stav = ? WHERE id = ?')->execute([jsonEnk($stavy), (int)$z['id']]);
      }, $op['co'] . ' — ' . $dalsi['label'] . ' (' . $op['partner'] . ') — ' . mojeJmeno());
      odesliJson(['ok' => true]);
    }

    case 'koop-partner': {
      vyzadujZapis();
      $z = $zakazka();
      $partneri = jsonDek($z['koop_partner'], []);
      $partneri[(string)($v['operace'] ?? '')] = (string)($v['partner'] ?? '');
      db()->prepare('UPDATE zakazky SET koop_partner = ?, zmeneno = ? WHERE id = ?')
          ->execute([jsonEnk($partneri), ted(), (int)$z['id']]);
      odesliJson(['ok' => true]);
    }

    case 'vratit': {
      vyzadujZapis();
      $z = $zakazka();
      if (!vratitSem($z, (int)($v['historie'] ?? 0))) chyba('Tento záznam nejde vrátit.');
      odesliJson(['ok' => true]);
    }

    /* ---------- přílohy (ruční nahrání / odebrání v detailu) ---------- */

    case 'priloha-nahraj': {
      // multipart POST: pole 'cislo' + jeden nebo víc souborů v 'soubory[]'
      vyzadujZapis();
      $z = $zakazka();

      $vstup = $_FILES['soubory'] ?? null;
      if ($vstup === null) chyba('Nepřišel žádný soubor.');

      // sjednocení tvaru na seznam { name, tmp_name, error, size }
      $seznam = is_array($vstup['name'])
        ? array_map(fn($i) => [
            'name' => $vstup['name'][$i], 'tmp_name' => $vstup['tmp_name'][$i],
            'error' => $vstup['error'][$i], 'size' => $vstup['size'][$i],
          ], array_keys($vstup['name']))
        : [$vstup];

      $limit = 200 * 1024 * 1024;
      $dir   = rtrim((string)cfg('modely'), '/') . '/' . $z['cislo'];
      if (!is_dir($dir)) @mkdir($dir, 0770, true);

      $pridane = [];
      foreach ($seznam as $f) {
        if (($f['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) continue;
        if (($f['error'] ?? 1) !== UPLOAD_ERR_OK) chyba('Nahrání souboru „' . $f['name'] . '" selhalo.');
        if ((int)$f['size'] > $limit) chyba('Soubor „' . $f['name'] . '" je větší než 200 MB.');

        $nazev = preg_replace('/[^\w.\- ()]/u', '_', basename((string)$f['name']));
        if ($nazev === '' || $nazev === '.' || $nazev === '..') continue;

        // kolize jmen: přípona _2, _3…
        $zaklad  = pathinfo($nazev, PATHINFO_FILENAME);
        $pripona = pathinfo($nazev, PATHINFO_EXTENSION);
        $cil = $dir . '/' . $nazev;
        for ($k = 2; is_file($cil); $k++) {
          $nazev = $zaklad . '_' . $k . ($pripona !== '' ? '.' . $pripona : '');
          $cil   = $dir . '/' . $nazev;
        }

        if (!@move_uploaded_file($f['tmp_name'], $cil)) {
          zaloguj('Přílohu nelze uložit: ' . $z['cislo'] . '/' . $nazev);
          continue;
        }
        @chmod($cil, 0640);
        db()->prepare('INSERT INTO soubory (zakazka_id, nazev, cesta, velikost, typ, pridal) VALUES (?,?,?,?,?,?)')
            ->execute([(int)$z['id'], $nazev, $z['cislo'] . '/' . $nazev, (int)@filesize($cil),
                       strtoupper(pathinfo($nazev, PATHINFO_EXTENSION)), mojeJmeno()]);
        $pridane[] = $nazev;
      }

      if (!$pridane) chyba('Soubor se nepodařilo uložit.');

      db()->prepare('UPDATE zakazky SET modely_chybi = 0, zmeneno = ? WHERE id = ?')
          ->execute([ted(), (int)$z['id']]);
      $popis = 'Přiloženo: ' . implode(', ', $pridane) . ' — ' . mojeJmeno();
      systemovyZaznam((int)$z['id'], $popis);
      historieZapis((int)$z['id'], $popis, null);
      odesliJson(['ok' => true, 'pridano' => $pridane]);
    }

    case 'priloha-smaz': {
      vyzadujZapis();
      $z = $zakazka();
      $q = db()->prepare('SELECT * FROM soubory WHERE id = ? AND zakazka_id = ?');
      $q->execute([(int)($v['soubor'] ?? 0), (int)$z['id']]);
      $f = $q->fetch();
      if (!$f) chyba('Příloha nenalezena.', 404);

      // smazat z disku jen když cesta opravdu leží pod adresářem s modely
      $zaklad = realpath((string)cfg('modely'));
      $cesta  = realpath($zaklad . '/' . $f['cesta']);
      if ($zaklad !== false && $cesta !== false && str_starts_with($cesta, $zaklad . DIRECTORY_SEPARATOR)) {
        @unlink($cesta);
      }
      db()->prepare('DELETE FROM soubory WHERE id = ?')->execute([(int)$f['id']]);

      $popis = 'Odebrána příloha ' . $f['nazev'] . ' — ' . mojeJmeno();
      systemovyZaznam((int)$z['id'], $popis);
      historieZapis((int)$z['id'], $popis, null);
      odesliJson(['ok' => true]);
    }

    /* ---------- konverzace ---------- */

    case 'zprava': {
      vyzadujZapis();
      $z    = $zakazka();
      $telo = trim((string)($v['telo'] ?? ''));
      if ($telo === '') chyba('Prázdná zpráva.');

      if (($v['rezim'] ?? 'odpoved') === 'interni') {
        db()->prepare('INSERT INTO zpravy (zakazka_id, typ, od, telo, precteno, kdy) VALUES (?,"interni",?,?,1,?)')
            ->execute([(int)$z['id'], mojeJmeno(), $telo, ted()]);
        odesliJson(['ok' => true]);
      }

      $predmet = (string)($v['predmet'] ?? ('Re: Nabídka na tisk'));
      [$ok, $chyba] = odesliZakaznikovi($z, $predmet, $telo);
      odesliJson(['ok' => true, 'odeslano' => $ok, 'poznamka' => $ok ? '' :
        'Zpráva je uložená v konverzaci, ale odeslání selhalo: ' . $chyba]);
    }

    case 'zprava-odpoj': {
      // Zpráva byla ke kartě přiřazena jen automaticky podle adresy odesílatele.
      // Jedním klikem ji odsud sundáme zpět do Nezařazeno k ručnímu zařazení.
      vyzadujZapis();
      $z = $zakazka();
      $q = db()->prepare('SELECT * FROM zpravy WHERE id = ? AND zakazka_id = ? AND typ = "prichozi"');
      $q->execute([(int)($v['zprava'] ?? 0), (int)$z['id']]);
      $m = $q->fetch();
      if (!$m) chyba('Zpráva nenalezena.', 404);

      db()->prepare('INSERT INTO nezarazeno (od, predmet, telo, kdy, duvod, message_id, in_reply_to, refs)
                     VALUES (?,?,?,?,?,?,?,?)')
          ->execute([$m['od'], $m['predmet'], $m['telo'], $m['kdy'],
                     'ručně odpojeno od ' . $z['cislo'], $m['message_id'], $m['in_reply_to'], $m['refs']]);
      db()->prepare('DELETE FROM zpravy WHERE id = ?')->execute([(int)$m['id']]);
      systemovyZaznam((int)$z['id'], 'Zpráva „' . ($m['predmet'] !== '' ? $m['predmet'] : 'bez předmětu')
        . '" odpojena zpět do Nezařazeno — ' . mojeJmeno());
      historieZapis((int)$z['id'], 'Odpojena automaticky spárovaná zpráva — ' . mojeJmeno(), null);
      odesliJson(['ok' => true]);
    }

    /* ---------- nová zakázka ---------- */

    case 'nova-zakazka': {
      vyzadujZapis();
      $zak = [
        'jmeno'   => trim((string)($v['jmeno']   ?? 'Nový zákazník')),
        'firma'   => trim((string)($v['firma']   ?? '')),
        'email'   => trim((string)($v['email']   ?? '')),
        'telefon' => trim((string)($v['telefon'] ?? '')),
        'ico'     => trim((string)($v['ico']     ?? '')),
      ];
      $cislo = dalsiCislo();
      db()->prepare(
        'INSERT INTO zakazky (cislo, stav, termin, firma_id, zak_jmeno, zak_firma, zak_email, zak_telefon, zak_ico,
                              poznamka_zak, konfigurace, kalkulace, hodiny_manipulace, modely_chybi, zdroj, token,
                              vytvoreno, zmeneno)
         VALUES (?,"prijato",?,?,?,?,?,?,?,?,?,?,?,1,"rucne",?,?,?)')
        ->execute([$cislo, (string)($v['termin'] ?? date('Y-m-d', strtotime('+14 days'))),
                   firmaZajisti($zak), $zak['jmeno'], $zak['firma'], $zak['email'], $zak['telefon'], $zak['ico'],
                   trim((string)($v['poznamka'] ?? '')),
                   jsonEnk(['tech' => 'FDM', 'material' => 'PLA', 'barva' => '', 'uprava' => 'Bez úpravy',
                            'rychlost' => 'Standard', 'vypln' => '20 %', 'dokonceni' => []]),
                   jsonEnk(['material' => 0, 'stroj' => 0, 'dokonceni' => 0, 'cenaUlohy' => 0,
                            'sleva' => 0, 'net' => 0, 'dph' => 0, 'celkem' => 0]),
                   (float)(pricing()['handlingHours'] ?? 2), nahodnyToken(24), ted(), ted()]);

      $z = zakazkaPodleCisla($cislo);
      db()->prepare('INSERT INTO polozky (zakazka_id, poradi, nazev, pocet) VALUES (?,0,"—",1)')
          ->execute([(int)$z['id']]);
      historieZapis((int)$z['id'], 'Karta založena ručně — ' . mojeJmeno(), null);
      odesliJson(['ok' => true, 'cislo' => $cislo]);
    }

    /* ---------- zákazníci ---------- */

    case 'firmy': {
      vyzadujPrihlaseni();
      odesliJson(['ok' => true, 'firmy' => firmySeznam()]);
    }

    case 'firma-sleva': {
      vyzadujZapis();
      $sleva = max(0.0, min(50.0, (float)($v['sleva'] ?? 0)));
      db()->prepare('UPDATE firmy SET sleva = ? WHERE klic = ?')->execute([$sleva, (string)($v['klic'] ?? '')]);
      odesliJson(['ok' => true]);
    }

    /* ---------- pošta a nezařazené ---------- */

    case 'posta': {
      vyzadujZapis();
      odesliJson(['ok' => true, 'posta' => postaVypis((string)($_GET['filtr'] ?? 'vse'))]);
    }

    case 'nezarazeno': {
      vyzadujZapis();
      $otevrene = db()->query('SELECT cislo, zak_jmeno, zak_firma FROM zakazky
                                WHERE stav <> "hotovo" ORDER BY cislo DESC')->fetchAll();
      odesliJson([
        'ok'       => true,
        'zpravy'   => db()->query('SELECT * FROM nezarazeno ORDER BY kdy DESC')->fetchAll(),
        'otevrene' => array_map(fn($z) => [
            'cislo' => $z['cislo'],
            'popis' => $z['cislo'] . ' · ' . ($z['zak_firma'] !== '' ? $z['zak_firma'] : $z['zak_jmeno']),
          ], $otevrene),
      ]);
    }

    case 'nezarazeno-priradit': {
      vyzadujZapis();
      $q = db()->prepare('SELECT * FROM nezarazeno WHERE id = ?');
      $q->execute([(int)($v['id'] ?? 0)]);
      $m = $q->fetch();
      if (!$m) chyba('Zpráva nenalezena.', 404);

      $cil = (string)($v['cil'] ?? '');
      if ($cil === 'nova') {
        $zak = ['jmeno' => $m['od'], 'firma' => '', 'email' => emailZAdresy($m['od']), 'telefon' => '', 'ico' => ''];
        $cislo = dalsiCislo();
        db()->prepare(
          'INSERT INTO zakazky (cislo, stav, termin, firma_id, zak_jmeno, zak_email, poznamka_zak,
                                konfigurace, kalkulace, modely_chybi, zdroj, token, vytvoreno, zmeneno)
           VALUES (?,"prijato",?,?,?,?,?,"{}","{}",1,"email",?,?,?)')
          ->execute([$cislo, date('Y-m-d', strtotime('+14 days')), firmaZajisti($zak),
                     $zak['jmeno'], $zak['email'], mb_substr((string)$m['telo'], 0, 2000),
                     nahodnyToken(24), ted(), ted()]);
        $z = zakazkaPodleCisla($cislo);
      } else {
        $z = zakazkaPodleCisla($cil);
        if (!$z) chyba('Cílová zakázka nenalezena.', 404);
      }

      db()->prepare('INSERT INTO zpravy (zakazka_id, typ, od, predmet, telo, message_id, in_reply_to, refs,
                                         parovani, precteno, kdy)
                     VALUES (?,"prichozi",?,?,?,?,?,?,?,1,?)')
          ->execute([(int)$z['id'], $m['od'], $m['predmet'], $m['telo'], $m['message_id'],
                     $m['in_reply_to'], $m['refs'], 'ručně z Nezařazeno', $m['kdy']]);
      systemovyZaznam((int)$z['id'], 'Zpráva přiřazena z Nezařazeno — ' . mojeJmeno());
      historieZapis((int)$z['id'], 'Zpráva přiřazena z Nezařazeno — ' . mojeJmeno(), null);
      db()->prepare('DELETE FROM nezarazeno WHERE id = ?')->execute([(int)$m['id']]);
      odesliJson(['ok' => true, 'cislo' => $z['cislo']]);
    }

    case 'nezarazeno-zahodit': {
      vyzadujZapis();
      db()->prepare('DELETE FROM nezarazeno WHERE id = ?')->execute([(int)($v['id'] ?? 0)]);
      odesliJson(['ok' => true]);
    }

    /* ---------- tiskárny a stroje ---------- */

    case 'tiskarny': {
      vyzadujPrihlaseni();
      odesliJson(['ok' => true, 'tiskarny' => tiskarnySeznam(), 'stroje' => strojeSeznam()]);
    }

    case 'tiskarna-uloz': {
      vyzadujAdmina();
      if (!empty($v['smazat'])) {
        tiskarnaSmaz((string)($v['klic'] ?? ''));
      } else {
        tiskarnaUloz($v);
      }
      odesliJson(['ok' => true]);
    }

    case 'stroj-uloz': {
      vyzadujAdmina();
      if (!empty($v['smazat'])) {
        strojSmaz((int)($v['id'] ?? 0));
      } else {
        strojUloz($v);
      }
      odesliJson(['ok' => true]);
    }

    /* ---------- výroba (fronta tiskových úloh) ---------- */

    case 'vyroba': {
      vyzadujPrihlaseni();
      odesliJson(['ok' => true, 'stroje' => vsechnyFronty()]);
    }

    case 'uloha-detail': {
      vyzadujPrihlaseni();
      $u = ulohaDetail((int)($v['id'] ?? 0));
      if (!$u) chyba('Úloha nenalezena.', 404);
      odesliJson(['ok' => true, 'uloha' => $u]);
    }

    case 'uloha-poradi': {
      vyzadujZapis();
      ulohaPoradiZmen((int)($v['id'] ?? 0), (int)($v['nad'] ?? 0));
      odesliJson(['ok' => true]);
    }

    case 'uloha-stav': {
      vyzadujZapis();
      ulohaStavZmen((int)($v['id'] ?? 0), (string)($v['stav'] ?? ''));
      odesliJson(['ok' => true]);
    }

    case 'navrh': {
      vyzadujPrihlaseni();
      odesliJson(array_merge(['ok' => true], navrhDavek()));
    }

    case 'navrh-potvrdit': {
      vyzadujZapis();
      $id = navrhPotvrdit(
        (int)($v['tiskarnaId'] ?? 0), (string)($v['material'] ?? ''), (int)($v['strojId'] ?? 0),
        array_map('intval', (array)($v['polozkaIds'] ?? [])));
      if (!$id) chyba('Úlohu se nepodařilo založit (mezitím už byly díly naplánované jinam?).', 400);
      odesliJson(['ok' => true, 'ulohaId' => $id]);
    }

    /* ---------- nastavení (jen Admin) ---------- */

    case 'nastaveni': {
      vyzadujAdmina();
      odesliJson([
        'ok'      => true,
        'prahy'   => [
          'prahVysoka'     => (float)nastaveni('prahVysoka', '24'),
          'prahNormalni'   => (float)nastaveni('prahNormalni', '72'),
        ],
        'infoMaily'    => nastaveni('infoMaily', '0') === '1',
        'infoMailyKam' => nastaveni('infoMailyKam', ''),
        'sablony' => sablony(),
        'napojeni'=> [
          'endpoint'   => '/order.php',
          'secret'     => cfg('orderSecret') && cfg('orderSecret') !== 'ZMEN_ME' ? '•••••••• nastaveno' : 'NENASTAVENO',
          'imap'       => (string)((array)cfg('imap', []))['user'] ?: 'nenastaveno',
          'imapModul'  => function_exists('imap_open') ? 'php-imap k dispozici' : 'php-imap CHYBÍ',
          'replyTo'    => sprintf((string)cfg('replyToKlic', ''), '{cislo}'),
          'cisloFormat'=> 'P-RRRR-NNNN',
          'cenik'      => cfg('pricing') . ' — jen čtení',
          'verejnaUrl' => cfg('verejnaUrl'),
        ],
      ]);
    }

    case 'nastaveni-uloz': {
      vyzadujAdmina();
      foreach (['prahVysoka','prahNormalni'] as $k) {
        if (array_key_exists($k, $v)) nastavenoUloz($k, (string)$v[$k]);
      }
      if (array_key_exists('infoMaily', $v))    nastavenoUloz('infoMaily', $v['infoMaily'] ? '1' : '0');
      if (array_key_exists('infoMailyKam', $v)) nastavenoUloz('infoMailyKam', trim((string)$v['infoMailyKam']));
      odesliJson(['ok' => true]);
    }

    case 'sloupce-uloz': {
      vyzadujAdmina();
      foreach ((array)($v['sloupce'] ?? []) as $i => $s) {
        if (!empty($s['novy'])) {
          db()->prepare('INSERT OR IGNORE INTO sloupce (klic, nazev, poradi, skryt) VALUES (?,?,?,0)')
              ->execute([(string)$s['klic'], (string)$s['nazev'], $i]);
          continue;
        }
        db()->prepare('UPDATE sloupce SET nazev = ?, poradi = ?, skryt = ? WHERE klic = ?')
            ->execute([(string)$s['nazev'], $i, !empty($s['skryt']) ? 1 : 0, (string)$s['klic']]);
      }
      odesliJson(['ok' => true]);
    }

    case 'sablona-uloz': {
      vyzadujAdmina();
      db()->prepare('UPDATE sablony SET predmet = ?, telo = ? WHERE klic = ?')
          ->execute([(string)($v['predmet'] ?? ''), (string)($v['telo'] ?? ''), (string)($v['klic'] ?? '')]);
      odesliJson(['ok' => true]);
    }

    case 'uzivatel-uloz': {
      vyzadujAdmina();
      $klic = (string)($v['klic'] ?? '');
      if ($klic === '') {
        $klic = preg_replace('/[^a-z0-9]+/', '', mb_strtolower((string)($v['jmeno'] ?? 'novy'))) ?: 'novy';
        $klic .= (string)db()->query('SELECT COUNT(*) FROM uzivatele')->fetchColumn();
        db()->prepare('INSERT INTO uzivatele (klic, jmeno, email, role, heslo_hash, aktivni) VALUES (?,?,?,?,?,1)')
            ->execute([$klic, (string)($v['jmeno'] ?? 'Nový uživatel'), (string)($v['email'] ?? ''),
                       (string)($v['role'] ?? 'dilna'),
                       password_hash((string)($v['heslo'] ?? 'cadmia'), PASSWORD_DEFAULT)]);
        odesliJson(['ok' => true, 'klic' => $klic]);
      }
      if (array_key_exists('role', $v)) {
        db()->prepare('UPDATE uzivatele SET role = ? WHERE klic = ?')->execute([(string)$v['role'], $klic]);
      }
      if (array_key_exists('aktivni', $v)) {
        db()->prepare('UPDATE uzivatele SET aktivni = ? WHERE klic = ?')->execute([$v['aktivni'] ? 1 : 0, $klic]);
      }
      if (!empty($v['heslo'])) {
        db()->prepare('UPDATE uzivatele SET heslo_hash = ? WHERE klic = ?')
            ->execute([password_hash((string)$v['heslo'], PASSWORD_DEFAULT), $klic]);
      }
      odesliJson(['ok' => true, 'klic' => $klic]);
    }

    /* ---------- export ---------- */

    case 'export': {
      vyzadujPrihlaseni();
      $stav = (string)($_GET['stav'] ?? '');
      $sql  = 'SELECT * FROM zakazky' . ($stav !== '' ? ' WHERE stav = ' . db()->quote($stav) : '') . ' ORDER BY termin';
      header('Content-Type: text/csv; charset=utf-8');
      header('Content-Disposition: attachment; filename="zakazky-' . date('Y-m-d') . '.csv"');
      $out = fopen('php://output', 'w');
      fwrite($out, "\xEF\xBB\xBF");   // BOM, ať to Excel otevře správně
      fputcsv($out, ['Číslo','Zákazník','Firma','E-mail','Stav','Priorita','Termín',
                     'Bez DPH','DPH','Celkem s DPH','Přiřazeno','Zdroj','Vytvořeno'], ';');
      foreach (db()->query($sql) as $z) {
        $k = jsonDek($z['kalkulace'], []);
        fputcsv($out, [
          $z['cislo'], $z['zak_jmeno'], $z['zak_firma'], $z['zak_email'],
          nazevSloupce($z['stav']), PRIO[prioritaZakazky($z)]['label'], substr((string)$z['termin'], 0, 10),
          (float)($k['net'] ?? 0), (float)($k['dph'] ?? 0), (float)($k['celkem'] ?? 0),
          (string)$z['prirazeno'], $z['zdroj'], $z['vytvoreno'],
        ], ';');
      }
      fclose($out);
      exit;
    }

    default:
      chyba('Neznámá akce „' . $akce . '".', 404);
  }
} catch (Throwable $e) {
  zaloguj('API ' . $akce . ': ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
  chyba('Chyba serveru. Podrobnosti jsou v logu.', 500);
}

function emailZAdresy(string $s): string {
  return preg_match('/[\w.+-]+@[\w.-]+/', $s, $m) ? strtolower($m[0]) : '';
}
