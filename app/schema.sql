-- Kanban zakázek Cadmia3D — schéma (SQLite)
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS uzivatele (
  id          INTEGER PRIMARY KEY,
  klic        TEXT    NOT NULL UNIQUE,
  jmeno       TEXT    NOT NULL,
  email       TEXT    NOT NULL DEFAULT '',
  role        TEXT    NOT NULL DEFAULT 'dilna',   -- admin | dilna | cteni
  heslo_hash  TEXT    NOT NULL,
  aktivni     INTEGER NOT NULL DEFAULT 1,
  vytvoreno   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sezeni (
  token       TEXT    PRIMARY KEY,
  uzivatel_id INTEGER NOT NULL REFERENCES uzivatele(id) ON DELETE CASCADE,
  vytvoreno   TEXT    NOT NULL DEFAULT (datetime('now')),
  platnost    TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS firmy (
  id        INTEGER PRIMARY KEY,
  klic      TEXT    NOT NULL UNIQUE,   -- ico:… | firma:… | domena:… | osoba:…
  nazev     TEXT    NOT NULL,
  ico       TEXT    NOT NULL DEFAULT '',
  sleva     REAL    NOT NULL DEFAULT 0,
  vytvoreno TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kontakty (
  id       INTEGER PRIMARY KEY,
  firma_id INTEGER NOT NULL REFERENCES firmy(id) ON DELETE CASCADE,
  jmeno    TEXT    NOT NULL DEFAULT '',
  email    TEXT    NOT NULL DEFAULT '',
  telefon  TEXT    NOT NULL DEFAULT '',
  UNIQUE (firma_id, email)
);

CREATE TABLE IF NOT EXISTS zakazky (
  id                INTEGER PRIMARY KEY,
  cislo             TEXT    NOT NULL UNIQUE,
  stav              TEXT    NOT NULL DEFAULT 'nova',
  priorita          TEXT    NOT NULL DEFAULT 'normalni',
  priorita_rucne    INTEGER NOT NULL DEFAULT 0,
  poradi            INTEGER NOT NULL DEFAULT 0,
  termin            TEXT    NOT NULL,
  prirazeno         TEXT,                              -- klic uzivatele
  firma_id          INTEGER REFERENCES firmy(id),
  zak_jmeno         TEXT    NOT NULL DEFAULT '',
  zak_firma         TEXT    NOT NULL DEFAULT '',
  zak_email         TEXT    NOT NULL DEFAULT '',
  zak_telefon       TEXT    NOT NULL DEFAULT '',
  zak_ico           TEXT    NOT NULL DEFAULT '',
  poznamka_zak      TEXT    NOT NULL DEFAULT '',
  konfigurace       TEXT    NOT NULL DEFAULT '{}',     -- json
  kalkulace         TEXT    NOT NULL DEFAULT '{}',     -- json
  tiskarna          TEXT    NOT NULL DEFAULT '',
  jobs              INTEGER NOT NULL DEFAULT 1,
  hodiny_tisku      REAL    NOT NULL DEFAULT 0,
  hodiny_schnuti    REAL    NOT NULL DEFAULT 0,
  hodiny_manipulace REAL    NOT NULL DEFAULT 0,
  cena_puvodni      REAL,
  cena_duvod        TEXT    NOT NULL DEFAULT '',
  mnozstvi_zmeneno  INTEGER NOT NULL DEFAULT 0,
  koop_stav         TEXT    NOT NULL DEFAULT '{}',     -- json
  koop_partner      TEXT    NOT NULL DEFAULT '{}',     -- json
  modely_chybi      INTEGER NOT NULL DEFAULT 0,
  zasilka           TEXT    NOT NULL DEFAULT '',
  zdroj             TEXT    NOT NULL DEFAULT 'rucne',  -- kalkulator | email | rucne
  token             TEXT    NOT NULL DEFAULT '',       -- stavová stránka
  nedorucitelny     INTEGER NOT NULL DEFAULT 0,
  vytvoreno         TEXT    NOT NULL DEFAULT (datetime('now')),
  zmeneno           TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_zakazky_stav  ON zakazky(stav);
CREATE INDEX IF NOT EXISTS ix_zakazky_email ON zakazky(zak_email);
CREATE INDEX IF NOT EXISTS ix_zakazky_token ON zakazky(token);

CREATE TABLE IF NOT EXISTS polozky (
  id         INTEGER PRIMARY KEY,
  zakazka_id INTEGER NOT NULL REFERENCES zakazky(id) ON DELETE CASCADE,
  poradi     INTEGER NOT NULL DEFAULT 0,
  nazev      TEXT    NOT NULL DEFAULT '',
  bbox       TEXT    NOT NULL DEFAULT '[0,0,0]',
  objem      REAL    NOT NULL DEFAULT 0,
  pocet      INTEGER NOT NULL DEFAULT 1,
  cena_kus   REAL    NOT NULL DEFAULT 0,
  cena_radek REAL
);
CREATE INDEX IF NOT EXISTS ix_polozky_zak ON polozky(zakazka_id);

CREATE TABLE IF NOT EXISTS soubory (
  id         INTEGER PRIMARY KEY,
  zakazka_id INTEGER NOT NULL REFERENCES zakazky(id) ON DELETE CASCADE,
  nazev      TEXT    NOT NULL,
  cesta      TEXT    NOT NULL,          -- relativně ke KANBAN_MODELY
  velikost   INTEGER NOT NULL DEFAULT 0,
  typ        TEXT    NOT NULL DEFAULT '',
  vytvoreno  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_soubory_zak ON soubory(zakazka_id);

CREATE TABLE IF NOT EXISTS zpravy (
  id          INTEGER PRIMARY KEY,
  zakazka_id  INTEGER NOT NULL REFERENCES zakazky(id) ON DELETE CASCADE,
  typ         TEXT    NOT NULL,            -- prichozi | odchozi | interni | system
  od          TEXT    NOT NULL DEFAULT '',
  komu        TEXT    NOT NULL DEFAULT '',
  predmet     TEXT    NOT NULL DEFAULT '',
  telo        TEXT    NOT NULL DEFAULT '',
  telo_html   TEXT    NOT NULL DEFAULT '',
  message_id  TEXT    NOT NULL DEFAULT '',
  in_reply_to TEXT    NOT NULL DEFAULT '',
  refs        TEXT    NOT NULL DEFAULT '',
  parovani    TEXT    NOT NULL DEFAULT '',
  precteno    INTEGER NOT NULL DEFAULT 0,
  kdy         TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_zpravy_zak ON zpravy(zakazka_id);
CREATE INDEX IF NOT EXISTS ix_zpravy_mid ON zpravy(message_id);

CREATE TABLE IF NOT EXISTS prilohy (
  id       INTEGER PRIMARY KEY,
  zprava_id INTEGER NOT NULL REFERENCES zpravy(id) ON DELETE CASCADE,
  nazev    TEXT    NOT NULL,
  cesta    TEXT    NOT NULL,
  velikost INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS historie (
  id         INTEGER PRIMARY KEY,
  zakazka_id INTEGER NOT NULL REFERENCES zakazky(id) ON DELETE CASCADE,
  kdo        TEXT    NOT NULL DEFAULT 'systém',
  kdy        TEXT    NOT NULL,
  co         TEXT    NOT NULL,
  pred       TEXT                            -- json snímek; NULL = nelze vrátit
);
CREATE INDEX IF NOT EXISTS ix_historie_zak ON historie(zakazka_id);

CREATE TABLE IF NOT EXISTS nezarazeno (
  id         INTEGER PRIMARY KEY,
  od         TEXT    NOT NULL DEFAULT '',
  predmet    TEXT    NOT NULL DEFAULT '',
  telo       TEXT    NOT NULL DEFAULT '',
  kdy        TEXT    NOT NULL,
  duvod      TEXT    NOT NULL DEFAULT '',
  message_id TEXT    NOT NULL DEFAULT '',
  in_reply_to TEXT   NOT NULL DEFAULT '',
  refs       TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS sloupce (
  id     INTEGER PRIMARY KEY,
  klic   TEXT    NOT NULL UNIQUE,
  nazev  TEXT    NOT NULL,
  poradi INTEGER NOT NULL DEFAULT 0,
  skryt  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sablony (
  id      INTEGER PRIMARY KEY,
  klic    TEXT    NOT NULL UNIQUE,
  nazev   TEXT    NOT NULL,
  predmet TEXT    NOT NULL DEFAULT '',
  telo    TEXT    NOT NULL DEFAULT '',
  poradi  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS nastaveni (
  klic    TEXT PRIMARY KEY,
  hodnota TEXT NOT NULL
);

-- co už bylo notifikováno, aby denní přehled a upozornění nechodily dvakrát
CREATE TABLE IF NOT EXISTS notifikace (
  id   INTEGER PRIMARY KEY,
  klic TEXT NOT NULL UNIQUE,
  kdy  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- už zpracované e-maily (UID/Message-ID), aby se cron neopakoval
CREATE TABLE IF NOT EXISTS videne_maily (
  message_id TEXT PRIMARY KEY,
  kdy        TEXT NOT NULL DEFAULT (datetime('now'))
);
