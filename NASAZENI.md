# Kanban zakázek Cadmia3D — nasazení

Interní tabule dílny pro tiskové zakázky. Poptávky přijímá z kalkulátoru 3D tisku,
zpracování a komunikaci vede na jedné tabuli. PHP 8.3 + SQLite, bez Node na serveru.
Plné zadání a chování je v `../kanban-deploy/HANDOFF.md`, prototyp v `../kanban-deploy/index.html`.

## Jak je to poskládané

```
/var/www/kanban/         webroot (nginx root) — jen frontend a veřejné vstupní body
  index.html  app.js  app.css  fonts/
  api.php        jediné aplikační API (api.php?a=<akce>), JSON, sezení v cookie
  order.php      endpoint pro kalkulátor (POST poptávky, shared secret)
  upload.php     dělené nahrávání modelů z kalkulátoru
  soubor.php     stažení modelu (jen přihlášený; soubory leží mimo webroot)
  stav.php       veřejná stavová stránka pro zákazníka (dlouhý token, bez loginu)

/var/www/kanban-app/     mimo webroot — kód, který se nesmí stáhnout přes web
  config.php    ostrá konfigurace (NENÍ v gitu — secret a hesla)
  config.vzor.php  šablona
  bootstrap.php    načte config, otevře SQLite (PDO, WAL), pomocné funkce
  schema.sql       schéma (CREATE TABLE IF NOT EXISTS …)
  instaluj.php     první rozjezd: schéma + sloupce + šablony + nastavení + účet admin
  lib/  auth  zakazky  pricing  pohled  prijem  mail  imap
  cron/ posta.php (5 min)  import-kalkulator.php  denni.php (ráno)  zaloha.php (noc)

/var/www/kanban-data/    běhová data, mimo webroot
  kanban.sqlite    databáze (jediný soubor + -wal/-shm)
  modely/<cislo>/  nahrané modely zákazníků
  zalohy/          denní VACUUM INTO + tar modelů, drží se 14 dní
  kanban.log       provozní log
```

**Databáze:** SQLite, jeden soubor, `PRAGMA journal_mode=WAL` kvůli souběhu 1–3 lidí.
Časy jako TEXT (`datetime('now')`), větší struktury (konfigurace, kalkulace, snímky
historie) jako JSON v TEXT sloupcích. Schéma se aktualizuje spuštěním `instaluj.php`
(idempotentní). Záloha přes `VACUUM INTO`, ne `cp` (WAL).

**Napojení na kalkulátor:** `pricing.json` je vlastnictví kalkulátoru, kanban ho jen
čte (dopočet ceny při ruční úpravě, příznak interní/externí výroba). Poptávky chodí
dvěma cestami — obě fungují:
1. **push:** kalkulátor POSTuje na `order.php` (až se v `order.php` kalkulátoru vyplní
   `$WEBHOOK` + `$WEBHOOK_TOKEN`), hlavička `X-Kanban-Secret`.
2. **pull:** `cron/import-kalkulator.php` přenese poptávky, které kalkulátor uložil
   do `poptavky/objednavky.json`. Podle čísla se nic nezdvojí, takže obě cesty
   můžou běžet souběžně během přechodu.

### Režim provozu — e-mail vs. kanban

**E-mail je vždycky primární a nezávislý na kanbanu.** Kalkulátor (`order.php`)
posílá KAŽDOU poptávku na `pokusss74@seznam.cz` (text + PDF nabídka + JSON příloha
+ modely). Když kanban vypneš nebo spadne, o žádnou poptávku nepřijdeš — chodí na
mail jako doteď.

Kanban k tomu jede navíc v režimu **pull**: cron `import-kalkulator.php --bez-mailu`
každou minutu čte `objednavky.json` a zakládá karty. `--bez-mailu` je tam schválně,
aby kanban neposílal svoje vlastní potvrzení a upozornění dílně (jinak by chodila
dvakrát — jednou z kalkulátoru, podruhé z kanbanu).

- **Vypnout kanban** (zpět na čistě e-mailový provoz): `crontab -e` a zakomentovat
  řádek `import-kalkulator.php`. Hotové karty zůstanou, nové poptávky přestanou
  přibývat, e-maily chodí dál.
- **Zapnout zpět:** řádek odkomentovat. `objednavky.json` drží posledních 5000
  poptávek, takže se doimportuje i to, co mezitím přišlo.
- **Nepřepínat na push** ($WEBHOOK v `order.php` kalkulátoru nechat prázdný) — jen
  tak zůstává e-mail plnohodnotnou zálohou.

## Stav (k dokončení projektu)

Hotové a ověřené lokálně:
- schéma + seed (`instaluj.php`), účet `admin` / heslo `cadmia` — **změnit po prvním loginu**
- import 11 existujících poptávek z kalkulátoru (`--bez-mailu`), včetně modelů;
  `modely_chybi` se u dvou správně nastavilo
- detail, seznam, priorita, ceny — smoke test prošel
- opravena fatální chyba v `import-kalkulator.php`
- doplněno: odpojení automaticky spárované zprávy, jednoklik „Odložit"

Zbývá (vyžaduje root / rozhodnutí — viz go-live):
- PHP-FPM pool + nginx pro `/var/www/kanban` (skript `nasazeni/go-live.sh`)
- hesla ke schránce v `config.php`, veřejná adresa
- cron, přepnutí `orderEndpoint` v kalkulátoru

## Go-live checklist

PHP-FPM pool i cron běží jako `cadmia` (stejně jako kalkulátor) — vlastník dat
tím sedí a žádný `chown` na `www-data` není potřeba.

**Kroky 1–3 udělá `nasazeni/go-live.sh` (idempotentní):**

```
sudo bash ~/kanban-stage/nasazeni/go-live.sh
```

1. **PHP-FPM pool** `nasazeni/kanban-pool.conf` → `/etc/php/8.3/fpm/pool.d/kanban.conf`
   (`[kanban]`, user/group `cadmia`, socket `/run/php/php8.3-fpm-kanban.sock`), restart `php8.3-fpm`.
2. **nginx** `nasazeni/kanban.conf` → `sites-available/` + symlink, `nginx -t && systemctl restart nginx`.
   Přidává PHP handler a hezkou adresu `/stav/<token>`.
3. **Práva** `/var/www/kanban-data` na `cadmia:www-data`, `2770` (setgid), `config.php` `640`.
   Skript nakonec ověří `GET /api.php?a=me` → `HTTP 200 {"ok":true,"uzivatel":null}`.

**Ručně:**

4. **config.php** (`/var/www/kanban-app/config.php`) — doplnit:
   - `smtp.pass` a `imap.pass` = heslo ke schránce `pokusss74@seznam.cz`
   - `verejnaUrl` = veřejná adresa stavové stránky (přes cloudflared, jako kalkulátor),
     např. `https://zakazky.cadmia3d.cz/stav`
   - Pozn.: Seznam freemail plus-adresy neumí, takže `replyToKlic` je prostá adresa
     `pokusss74@seznam.cz`; odpovědi se párují podle `[P-2026-0001]` v předmětu
     a hlavičky `In-Reply-To`. Chce to samostatnou schránku jen pro zakázky —
     ať se nemíchá s ostatní poštou, kterou cron čte a označuje jako přečtené.
   Po úpravě `sudo systemctl reload php8.3-fpm` není nutný (config se čte za běhu),
   ale `cron/posta.php` si vyzkoušej ručně: `php /var/www/kanban-app/cron/posta.php`.

5. **cron** (jako `cadmia`) — `crontab ~/kanban-stage/nasazeni/crontab.txt`
   (nahradí celý crontab; `crontab -l` na kontrolu). Nasazuje: pull import
   každou minutu (`--bez-mailu`), ranní přehled, noční zálohu. `posta.php` (IMAP) je
   **zakomentovaný** — zapnout až bude samostatná schránka jen pro zakázky, jinak
   cron čte a označuje jako přečtené i upozornění z kalkulátoru na téže adrese.

6. **Push (volitelně, NEDOPORUČENO ve výchozím stavu)** — kalkulátor by POSToval
   rovnou na `order.php` kanbanu místo pullu. V `/var/www/kalkulator/order.php`
   nastavit `$WEBHOOK` na URL `order.php` kanbanu a `$WEBHOOK_TOKEN` na **stejnou
   hodnotu jako `orderSecret` v `/var/www/kanban-app/config.php`** (jde v hlavičce
   `X-Kanban-Secret`). Pak vypnout cron import. **Zůstat u pullu** znamená, že
   e-mailová cesta funguje jako záloha — viz „Režim provozu" výše.

7. **Změnit heslo admina** (`admin` / `cadmia`) a založit účty dílny
   (Nastavení → Uživatelé).

## Zálohy

`cron/zaloha.php` dělá `kanban-RRRR-MM-DD.sqlite` (VACUUM INTO) + `modely-*.tar.gz`
do `kanban-data/zalohy/`, drží 14 dní (`zalohDnu` v config). Off-site kopii řešit
zvlášť (rsync do stejného úložiště jako zálohy kalkulátoru).
