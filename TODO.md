# Co ještě dokončit — Zakázky Cadmia3D

Aktualizováno: 13. 9. 2026

## Priorita 1 — ověřit v běžném provozu

- [x] Projít na notebooku nové pohledy **Dnes** a **Výroba** — vypadají a fungují správně. Na tabletu ještě neověřeno (potřeba fyzické zařízení).
- [x] Ověřit celý tok: otevřít zakázku → **Plánovat výrobu** → vytvořit úlohu → zahájit tisk → dokončit → expedice — projeto na testovací zakázce P-2026-0034 (přesunuto do Odloženo/Zrušeno po ověření), včetně automatického posunu sloupce (Přijato → Fronta → Tiskne se → Postprocess) a ručního přepnutí na Expedice.
  - **Nalezený problém:** „Automatický návrh pro vše“ v plánování ignoruje filtr/hledání a navrhne úlohy pro úplně všechny nepřiřazené kusy ze všech zakázek najednou (ne jen pro otevřenou/filtrovanou zakázku) — snadno se tak omylem naplánuje celá fronta. Než se potvrdí, stojí za kontrolu, co přesně je navrženo.
  - **Nalezený problém:** hláška „Nespárovaná tiskárna (chybí v registru): Bambu Lab“ — v datech je typ tiskárny neodpovídající žádnému záznamu v Nastavení (možná z importu z kalkulátoru, jiný zápis názvu). Stojí za dohledání zdroje.
- [x] U každé používané tiskárny zkontrolovat aktivní fyzický stroj — Bambulab H2D, Bambulab X1C, Sinterit Lisa PRO (2×) a Sinterit Lisa X mají každá aktivní stroj; Italie MJF a Italie RESIN jsou záměrně bez stroje (externí kooperace). V pořádku.
- [ ] Ověřit, že po obnovení stránky fungují všechny změnové akce (nově používají ochranný CSRF token).

## Priorita 2 — zjednodušení práce v dílně

- [x] Sjednotit všechny vyskakovací dialogy a chyby do jednoho stylu appky — nahrazeny nativní `prompt()`/`confirm()` (nová zakázka, sloupec, stroj, heslo, nový uživatel, mazání) jedním sdíleným dialogovým oknem (kicker + teal nadpis, stejné ovládání/zavírání jako zbytek appky). Nativní dialogy navíc na dotyku vadily a v automatizaci/některých prohlížečích uměly zamrazit stránku.
- [ ] Zkrátit běžnou kartu na tabuli: nechat zákazníka, termín, cenu, materiál/technologii a jeden problémový štítek; podrobnosti až v detailu.
- [ ] Doplnit do „Dnes“ přímé filtry/akce pro jednotlivé skupiny (po termínu, čeká na zákazníka, výroba), nejen jejich seznam.
- [ ] Upravovat rozložení pro tablet: větší cíle pro dotek, pohodlnější změna stavu bez drag-and-dropu a otestovat šířky obrazovek.
- [ ] V detailu vyhodnotit další rychlé akce podle skutečné práce dílny — typicky přiřazení člověka, změna stavu a odpověď zákazníkovi.

## Priorita 3 — provoz a bezpečnost

- [ ] Jako root nasadit změny nginx z `nasazeni/kanban.conf` a reloadnout nginx. Přidávají bezpečnostní hlavičky `Referrer-Policy` a `X-Frame-Options`. (Potřebuje `sudo` heslo zadané ručně — spustit `sudo bash ~/kanban-stage/nasazeni/go-live.sh`.)
- [ ] Vyřešit IMAP schránku: ideálně samostatná schránka pro zakázky. Současný cron čte sdílenou schránku a může označovat jiné zprávy jako přečtené.
- [ ] Zavést skutečný rate-limit přihlašování na hraně proxy/Cloudflare. V aplikaci je zatím pouze jednotná chybová odpověď a krátké zpomalení.
- [ ] Zkontrolovat off-site zálohu SQLite a modelů; lokální záloha sama neochrání při ztrátě stroje. **Zjištěno:** žádná off-site kopie zatím neexistuje ani u kalkulátoru (na co NASAZENI.md odkazuje) — jen lokální `zalohy/` adresáře na stejném stroji. Chce to rozhodnutí, kam zálohovat (jiný stroj/cloud) a rsync/skript navíc.
- [x] Sjednotit produkční a zdrojový `config.vzor.php` — zkopírováno z `kanban-stage` do `/var/www/kanban-app/config.vzor.php`.
- [x] Pushnout lokální commity do `origin/main` — hotovo.

## Priorita 4 — kvalita a údržba

- [ ] `kanban-stage/app/config.php` (lokální checkout) míří přímo na produkční `/var/www/kanban-data/kanban.sqlite` — jakýkoli lokální dev server nebo test proti tomuto checkoutu píše rovnou do ostrých dat. Stálo by za to mít samostatnou dev DB (např. kopii `kanban.sqlite`) a config na ni přepnout.
- [ ] Doplnit automatické integrační smoke testy: login/role, import poptávky, přesun karty, plánování úlohy, změna stavu úlohy a záloha.
- [ ] Sepsat krátký provozní návod pro dílnu: co dělat při chybě importu, nefunkční poště, chybějícím modelu a při obnově ze zálohy.
- [ ] Průběžně commitovat a po ověření deployovat změny jako jednotlivé malé releasy.
