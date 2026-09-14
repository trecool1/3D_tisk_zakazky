# Co ještě dokončit — Zakázky Cadmia3D

Aktualizováno: 14. 9. 2026

## Priorita 1 — ověřit v běžném provozu

- [x] Projít na notebooku nové pohledy **Dnes** a **Výroba** — vypadají a fungují správně. Tabletová šířka (834×1112) ověřena přes emulaci v prohlížeči; na skutečném fyzickém tabletu ještě neprojeto.
- [x] Ověřit celý tok: otevřít zakázku → **Plánovat výrobu** → vytvořit úlohu → zahájit tisk → dokončit → expedice — projeto na testovací zakázce P-2026-0034 (přesunuto do Odloženo/Zrušeno po ověření), včetně automatického posunu sloupce (Přijato → Fronta → Tiskne se → Postprocess) a ručního přepnutí na Expedice.
  - [x] **Opraveno:** „Automatický návrh pro vše“ ignoroval filtr/hledání a navrhl úlohy pro úplně všechny nepřiřazené kusy ze všech zakázek najednou — při aktivním hledání/filtru teď návrh (i tlačítko samo, popisek „pro vyfiltrované“) zahrne jen to, co je vidět. Ověřeno v produkci.
  - **Zjištěno, neopraveno:** hláška „Nespárovaná tiskárna (chybí v registru): Bambu Lab“ — v datech je typ tiskárny „Bambu Lab“ (s mezerou), který neodpovídá žádnému registrovanému typu (Bambulab H2D/X1C). Je to nejspíš z importu z kalkulátoru s jiným zápisem názvu; nejde bezpečně domapovat automaticky (dvě možné cílové tiskárny), chce to dohledat zdroj v kalkulátoru nebo v datech zakázky.
- [x] U každé používané tiskárny zkontrolovat aktivní fyzický stroj — Bambulab H2D, Bambulab X1C, Sinterit Lisa PRO (2×) a Sinterit Lisa X mají každá aktivní stroj; Italie MJF a Italie RESIN jsou záměrně bez stroje (externí kooperace). V pořádku.
- [ ] Ověřit, že po obnovení stránky fungují všechny změnové akce (nově používají ochranný CSRF token).

## Priorita 2 — zjednodušení práce v dílně

- [x] Sjednotit všechny vyskakovací dialogy a chyby do jednoho stylu appky — nahrazeny nativní `prompt()`/`confirm()` (nová zakázka, sloupec, stroj, heslo, nový uživatel, mazání) jedním sdíleným dialogovým oknem (kicker + teal nadpis, stejné ovládání/zavírání jako zbytek appky). Nativní dialogy navíc na dotyku vadily a v automatizaci/některých prohlížečích uměly zamrazit stránku.
- [x] Zkrátit běžnou kartu na tabuli — zůstal zákazník, termín, cena, materiál/technologie a jeden problémový štítek; seznam rozpracovaných souborů a průběh tisku (%) jsou pryč z karty (zůstávají v detailu a v přehledu Výroby). Nasazeno a ověřeno.
- [x] Doplnit do „Dnes“ přímé filtry/akce pro jednotlivé skupiny — každá skupina (Hoří/Čeká na reakci/Ve výrobě) má tlačítko „Zobrazit na tabuli“, které otevře tabuli přefiltrovanou přesně na tu skupinu (jde na ní přetahovat karty a dělat hromadné akce). Nasazeno a ověřeno. Mimoto opravena barva technologie na kartě pro položky s jinou velikostí písmen (např. „Resin“ z kalkulátoru vs. „RESIN“ v registru tiskáren).
- [x] Upravovat rozložení pro tablet — opraveno, že tlačítka jako „Zahájit tisk“/„Dokončeno“ ve Výrobě měla vlastní malý padding přímo v kódu, který přebil zvětšení pro dotyk (teď mají min-height/min-width 44 px jako podlahu bez ohledu na to). Plánování výroby (dvousloupcová mřížka) se na šířce ≤900 px zlomí pod sebe. Vizuálně ověřeno na 834×1112 (iframe test) — vše sedí (44px tlačítka, plán na plnou šířku, „Odpovědět“ skáče na textarea).
- [x] Přetahování karty myší i dotykem — nativní HTML5 drag-and-drop se s myší choval hůř (poloprůhledný "duch" karty nesledoval kurzor přesně) a na dotyku ho spousta mobilních prohlížečů z prstu vůbec nespouští (proto na tabletu tažení karty nešlo). Karta se teď táhne vlastní logikou (pointer events), sjednocenou pro myš i dotyk: krátký pohyb (do ~350 ms) vždycky jen posune (sloupec svisle / tabuli vodorovně), kartu "chytí" až déle držený stisk beze pohybu — jinak se skoro každý pokus posunout sloupec omylem trefil do karty a přeuspořádal ji. Dropdown pro změnu stavu na kartě byl nechtěný — odstraněn, jediná cesta je tažení.
- [x] Posun tabule i sloupce mezi kartami — na dotyku jde nativním scrollem/tažením beze změny, s myší dřív jen kolečkem. Teď jde tabuli i jednotlivý sloupec "chytit" i myší (za kartu krátkým tahem, nebo za prázdnou plochu) a přetáhnout stejně jako swipe na tabletu; kolečko zůstává funkční vedle toho.
  - **Opraveno:** obě tažení (karta i tabule) se nedala nikdy dokončit, protože `setPointerCapture()` uměl selhat a po něm se tiše přeskočilo přidání pointermove/pointerup listenerů — teď naslouchá `document` (capture je jen bonus v try/catch), spolehlivé bez ohledu na to. Ověřeno myší i simulovaným dotykem (dlouhý stisk) v produkci.
- [ ] **Zjištěno při ladění barev:** filtr technologie na tabuli (`Kdokoli/Všechny technologie/…`) nabízí „SLA“, ale položky z kalkulátoru mají technologii uloženou jako „Resin“ — filtr na SLA/RESIN tak nikdy nic nenajde. Sjednotit název (buď filtr přejmenovat na „Resin“, nebo zjistit u kalkulátoru, proč neposílá „SLA“).
- [x] V detailu vyhodnotit další rychlé akce — přiřazení a změna stavu už byly hned nahoře v detailu; přibylo tlačítko „Odpovědět“ vedle „Plánovat výrobu“, které skočí a zaostří rovnou na odpověď zákazníkovi místo scrollování přes ceník/přílohy/historii. Nasazeno a ověřeno.

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
