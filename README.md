# Kanban zakázek — Cadmia3D

Interní nástroj dílny pro vedení tiskových zakázek. Jedna tabule ukazuje aktuální
stav dílny: co přišlo, co čeká na odpověď zákazníka, co se tiskne, co se má dnes
expedovat. Poptávky přijímá automaticky z [kalkulátoru 3D tisku](#napojení-na-kalkulátor)
— poptávka se stane kartou včetně modelů, rozměrů, spočítané ceny a termínu.

Uživatelé: 1–3 lidé z dílny. Není to zákaznický portál (jen okrajově — stavová
stránka s tokenem).

## Stack

- **PHP 8.3**, **SQLite** (jeden soubor, WAL), **žádný Node** na serveru
- frontend jako jednostránková aplikace bez build kroku (`web/app.js`, vanilla)
- příchozí e-maily bere **cron** přes IMAP, není potřeba trvale běžící proces
- modely mimo webroot, ke stažení jen přes autorizovaný skript
- výpočty (priorita, ceny, rezerva) dělá server, aby tabule ukazovala všem totéž

## Struktura

```
app/            mimo webroot — kód, který se nesmí stáhnout přes web
  bootstrap.php   config + otevření SQLite (PDO) + pomocné funkce
  schema.sql      schéma (CREATE TABLE IF NOT EXISTS …)
  instaluj.php    první rozjezd: schéma, sloupce, šablony, nastavení, účet admin
  config.vzor.php šablona konfigurace (ostrý config.php je mimo git)
  lib/            auth · zakazky · pricing · pohled · prijem · mail · imap
  cron/           posta.php (5 min) · import-kalkulator.php · denni.php · zaloha.php
web/            webroot (nginx root)
  index.html app.js app.css fonts/
  api.php         jediné aplikační API (api.php?a=<akce>), JSON, sezení v cookie
  order.php       endpoint pro kalkulátor (POST poptávky, shared secret)
  upload.php      dělené nahrávání modelů
  soubor.php      stažení modelu (jen přihlášený)
  stav.php        veřejná stavová stránka zákazníka (dlouhý token, bez loginu)
nasazeni/       go-live.sh, PHP-FPM pool, nginx, crontab
NASAZENI.md     architektura + go-live checklist krok za krokem
```

Běhová data (`kanban.sqlite`, `modely/`, `zalohy/`) leží mimo repo v `kanban-data/`.

## Rozjezd (lokálně / dev)

```sh
cp app/config.vzor.php app/config.php     # a doplnit cesty, orderSecret, e-mail
php app/instaluj.php                       # vytvoří DB + účet admin (heslo vypíše)
php -S localhost:8091 -t web               # dev server; ostře nginx + PHP-FPM, viz NASAZENI.md
```

Přihlášení: `admin` / heslo z výpisu instalátoru. Změnit v Nastavení → Uživatelé.

Import už existujících poptávek z kalkulátoru (bez rozeslání starých e-mailů):

```sh
php app/cron/import-kalkulator.php --bez-mailu
```

## Nasazení

Viz **[NASAZENI.md](NASAZENI.md)**. Ve zkratce:

```sh
sudo bash nasazeni/go-live.sh     # PHP-FPM pool + nginx + práva + smoke test
```

pak ručně: hesla ke schránce a veřejná adresa v `config.php`, cron
(`nasazeni/crontab.txt`), a nakonec přepnutí `orderEndpoint` v kalkulátoru.

## Napojení na kalkulátor

`pricing.json` zůstává vlastnictvím kalkulátoru — kanban ho jen čte (dopočet ceny
při ruční úpravě, příznak interní/externí výroba). Poptávky chodí dvěma cestami,
obě fungují a podle čísla zakázky se nic nezdvojí:

1. **push** — kalkulátor POSTuje na `web/order.php` (hlavička `X-Kanban-Secret`)
2. **pull** — `cron/import-kalkulator.php` přenese, co kalkulátor uložil do
   `poptavky/objednavky.json` (přechodné, než se přepne `orderEndpoint`)

E-mail (IMAP) slouží k párování **odpovědí** zákazníků na nabídky: podle čísla
zakázky v předmětu `[P-2026-0001]` a hlavičky `In-Reply-To`. Automatické odpovědi
a doručenky kartu nezakládají.

## Konfigurace

Vše v `app/config.php` (mimo git — obsahuje `orderSecret` a hesla ke schránce).
Vzor a komentáře jsou v `app/config.vzor.php`. Prahy priority, sloupce tabule,
e-mailové šablony a role uživatelů se spravují v aplikaci (Nastavení, jen Admin).

## Zálohy

`cron/zaloha.php` dělá denně `kanban-RRRR-MM-DD.sqlite` (`VACUUM INTO`, ne `cp`,
kvůli WAL) + `modely-*.tar.gz`, drží 14 dní. Off-site kopii řešit zvlášť.
