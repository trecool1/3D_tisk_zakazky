/* Kanban zakázek Cadmia3D — jednostránková aplikace, žádný build krok.
   Výpočty priorit a cen dělá server; tady se jen kreslí a posílají změny. */
'use strict';

/* ---------- drobné pomůcky ---------- */

// Malý DOM helper místo innerHTML — text se nikdy neinterpretuje jako HTML.
function h(tag, attrs, ...deti) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.setAttribute('style', v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const d of deti.flat(9)) {
    if (d === null || d === undefined || d === false || d === '') continue;
    el.append(d instanceof Node ? d : document.createTextNode(String(d)));
  }
  return el;
}
const $ = sel => document.querySelector(sel);

/* ---------- české formátování ---------- */

const num = n => String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const kc  = n => num(n) + ' Kč';
const kcd = n => {
  const r = Math.round((n || 0) * 100) / 100;
  const cela = num(Math.floor(r));
  const zbytek = Math.round((r - Math.floor(r)) * 100);
  return (zbytek ? cela + ',' + String(zbytek).padStart(2, '0') : cela) + ' Kč';
};
const D  = s => new Date(String(s).slice(0, 10) + 'T12:00:00');
const dm = s => { const d = D(s); return d.getDate() + '. ' + (d.getMonth() + 1) + '.'; };
const dt = s => {
  const d = new Date(String(s).replace(' ', 'T'));
  return d.getDate() + '. ' + (d.getMonth() + 1) + '. ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
};
const dny      = n => n === 1 ? '1 den' : n < 5 ? n + ' dny' : n + ' dnů';
const karty    = n => n === 1 ? '1 karta' : n < 5 ? n + ' karty' : n + ' karet';
const uloh     = n => n === 1 ? '1 úloha' : n < 5 ? n + ' úlohy' : n + ' úloh';
const neprect  = n => n === 1 ? '1 nepřečtená' : n < 5 ? n + ' nepřečtené' : n + ' nepřečtených';
const zakazek  = n => n === 1 ? '1 zakázka' : n < 5 ? n + ' zakázky' : n + ' zakázek';
const kontakty = n => n === 1 ? '1 kontakt' : n < 5 ? n + ' kontakty' : n + ' kontaktů';
const hod      = n => String(Math.round((n || 0) * 10) / 10).replace('.', ',');
const mb       = b => b >= 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB'
                    : b >= 1024 ? Math.round(b / 1024) + ' kB' : b + ' B';
const ini      = jmeno => jmeno ? jmeno.split(' ').filter(Boolean).map(s => s[0]).join('').slice(0, 2) : '—';

const ROLE = { admin: 'Admin', dilna: 'Dílna', cteni: 'Pouze čtení' };
const ROLE_POPIS = {
  admin: 'vše včetně nastavení a uživatelů',
  dilna: 'tabule, karty, odpovědi zákazníkům, ceny — bez nastavení',
  cteni: 'vidí tabuli a seznam, nic nemění (pro účetní)',
};
const PRIO = {
  zadna:    { label: '—',        bg: 'var(--line)',    fg: 'var(--muted)',   rank: 9 },
  kriticka: { label: 'kritická', bg: 'var(--red)',     fg: 'var(--red)',     rank: 0 },
  vysoka:   { label: 'vysoká',   bg: 'var(--red-mid)', fg: 'var(--red)',     rank: 1 },
  normalni: { label: 'normální', bg: 'var(--teal)',    fg: 'var(--muted-2)', rank: 2 },
  nizka:    { label: 'nízká',    bg: 'var(--line)',    fg: 'var(--muted)',   rank: 3 },
};
const UZAVRENO = ['hotovo', 'odlozeno'];
// Každá technologie má vlastní odstín, ať jde na tabuli poznat na první pohled
// (FDM je nejčastější, proto teplá amber; SLA/RESIN stejná rodina — fotopolymer;
// SLS teal jako zbytek appky; MJF zelená; SLM tmavá — vždy externí kooperace).
const TECH_BARVY = {
  FDM:   'background:#f6e3c5;color:#8a5a06',
  SLA:   'background:#ece3fb;color:#5b3aa0',
  RESIN: 'background:#ece3fb;color:#5b3aa0',
  SLS:   'background:var(--teal-100);color:var(--teal-700)',
  MJF:   'background:#dcf1e1;color:#1c7a3c',
  SLM:   'background:var(--ink);color:#fff',
};
// Data z kalkulátoru nemají sjednocené velikosti písmen (např. položky "Resin",
// ale registr tiskáren "RESIN") — porovnávat bez ohledu na velikost písmen.
function techZnackaStyl(tech) {
  return TECH_BARVY[(tech || '').toUpperCase()] || 'background:var(--panel);color:var(--muted-2)';
}

// Sdílené řazení pro tabuli i plánování — obojí má cislo/zakaznik/dnuDoTerminu.
// cmp je vždy ve vzestupném (asc) směru; smer (1/-1) se násobí zvlášť, ať
// popisek u šipky vždycky sedí se skutečným pořadím.
const RAZENI_ZAKAZKY = {
  cislo:    { nazev: 'Číslo',            cmp: (a, b) => a.cislo.localeCompare(b.cislo, 'cs', { numeric: true }) },
  zakaznik: { nazev: 'Zákazník / firma', cmp: (a, b) => a.zakaznik.localeCompare(b.zakaznik, 'cs') },
  dny:      { nazev: 'Zbývá dní',        cmp: (a, b) => a.dnuDoTerminu - b.dnuDoTerminu },
};

/* ---------- stav ---------- */

const S = {
  user: null, csrf: null, view: 'board', dnesRozbalene: {},
  zakazky: [], sloupce: [], uzivatele: [], nastaveni: {}, nezarazenoPocet: 0,
  open: null, detail: null, sel: null, drag: null, dragOver: null,
  hledani: '', fKdo: '', fTech: '', fPrio: '', fNeprectene: false, fPoTerminu: false, fExterni: false, rychlyFiltr: null,
  fStav: '', razeni: 'termin', boardRazeni: 'cislo', boardRazeniSmer: -1, planRazeni: '', planRazeniSmer: 1,
  rezim: 'odpoved', draft: '', prebitCena: '', prebitDuvod: '', histOpen: false,
  smazPriloha: null, dropAktivni: false, citaceZpravy: {}, histZakOpen: false,
  firmy: [], firmaKlic: null, hledaniFirmy: '', posta: [], postaFiltr: 'vse', nezarazeno: null,
  nastaveniData: null, tiskarny: [], stroje: [], vyroba: [], dragUloha: null, pubCislo: null, kopirovano: false,
  vyrobaStrojId: null, vyrobaObrazovka: 'prehled', planPool: [], planJobs: [], dragItem: null, planSeq: 0,
  planHledani: '', planFTech: '', planZakazka: null,
  chyba: '', nacitam: false, potvrzeni: null, dotaz: null, novyUzivatel: null,
};

/* ---------- API ---------- */

async function api(akce, data, metoda) {
  const jeZapis = (metoda || (data ? 'POST' : 'GET')) === 'POST';
  const headers = data ? { 'Content-Type': 'application/json' } : {};
  if (jeZapis && S.csrf) headers['X-CSRF-Token'] = S.csrf;
  const r = await fetch('api.php?a=' + akce, {
    method: metoda || (data ? 'POST' : 'GET'),
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: 'same-origin',
  });
  let v = null;
  try { v = await r.json(); } catch { /* nechá null */ }
  if (!r.ok || !v || v.ok === false) {
    const zprava = (v && v.chyba) || ('Chyba ' + r.status);
    if (r.status === 401 && S.user) { S.user = null; vykresli(); }
    throw new Error(zprava);
  }
  return v;
}

function hlas(chyba) {
  S.chyba = chyba ? String(chyba.message || chyba) : '';
  vykresli();
  if (S.chyba) setTimeout(() => { S.chyba = ''; vykresli(); }, 6000);
}

// Jedno sdílené vyskakovací okno pro potvrzení, textový dotaz i krátký formulář —
// stejná hlavička (kicker + nadpis), patička s tlačítky a zavírání (Escape, klik mimo,
// křížek) pro všechny tři případy, ať appka nepůsobí na každém místě jinak.
// Nahrazuje nativní prompt()/confirm(), které jsou na dotyku neohrabané a v někte-
// rých prohlížečích (i automatizovaných) zamrazí stránku, dokud je uživatel ručně
// nezavře.
function dialogOkno({ kicker, nadpis, telo, tlacitka, zavri }) {
  return [
    h('div', { class: 'zakryt', onclick: zavri }),
    h('div', { class: 'dialog', onkeydown: e => { if (e.key === 'Escape') { e.preventDefault(); zavri(); } } },
      h('div', { style: 'display:flex;align-items:flex-start;gap:var(--space-2)' },
        h('div', { style: 'flex:1;min-width:0' },
          kicker && h('div', { class: 'kicker', style: 'margin-bottom:6px' }, kicker),
          h('h3', {}, nadpis)),
        h('button', { class: 'btn btn-ghost', style: 'padding:2px 8px', onclick: zavri }, '✕')),
      telo,
      h('div', { class: 'dialog-tlacitka' }, tlacitka)),
  ];
}

// Potvrzovací okno místo nativního confirm() — vrací Promise<boolean>.
function potvrdit(nadpis, telo, textOk) {
  return new Promise(resolve => {
    S.potvrzeni = { nadpis, telo, textOk: textOk || 'Potvrdit', resolve };
    vykresli();
  });
}

function potvrzeniOkno() {
  const p = S.potvrzeni;
  if (!p) return null;
  const zavri = ok => { S.potvrzeni = null; vykresli(); p.resolve(!!ok); };
  return dialogOkno({
    kicker: 'Potvrzení', nadpis: p.nadpis, telo: p.telo, zavri: () => zavri(false),
    tlacitka: [
      h('button', { class: 'btn btn-ghost', onclick: () => zavri(false) }, 'Zrušit'),
      h('button', { class: 'btn btn-primary', onclick: () => zavri(true) }, p.textOk),
    ],
  });
}

// Textový dotaz místo nativního prompt() — vrací Promise<string|null> (null = zrušeno).
// { nadpis, popisek, hodnota, textOk, typ } — popisek je štítek nad polem (jako
// u ostatních formulářů appky), typ 'password' schová zadávané heslo.
function zeptat(nadpis, { popisek, hodnota, textOk, typ } = {}) {
  return new Promise(resolve => {
    S.dotaz = { nadpis, popisek, hodnota: hodnota || '', textOk: textOk || 'Uložit', typ, resolve };
    vykresli();
    setTimeout(() => { const el = $('#dotazVstup'); if (el) { el.focus(); el.select(); } }, 0);
  });
}

function dotazOkno() {
  const p = S.dotaz;
  if (!p) return null;
  const zavri = v => { S.dotaz = null; vykresli(); p.resolve(v === undefined ? null : v); };
  const odesli = () => zavri($('#dotazVstup').value.trim());
  return dialogOkno({
    kicker: 'Zadání', nadpis: p.nadpis, zavri: () => zavri(null),
    telo: [
      p.popisek && h('label', { class: 'popisek' }, p.popisek),
      h('input', {
        id: 'dotazVstup', class: 'input', type: p.typ || 'text', value: p.hodnota, style: 'width:100%;padding:8px 10px',
        onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); odesli(); } },
      }),
    ],
    tlacitka: [
      h('button', { class: 'btn btn-ghost', onclick: () => zavri(null) }, 'Zrušit'),
      h('button', { class: 'btn btn-primary', onclick: odesli }, p.textOk),
    ],
  });
}

// Formulář pro nového uživatele — jedno okno místo tří nativních promptů za sebou.
function novyUzivatelOkno() {
  if (!S.novyUzivatel) return null;
  const zavri = () => { S.novyUzivatel = null; vykresli(); };
  const odesli = () => {
    const jmeno = $('#nuJmeno').value.trim();
    if (!jmeno) return;
    const email = $('#nuEmail').value.trim();
    const heslo = $('#nuHeslo').value || 'cadmia';
    zavri();
    ulozUzivatele({ jmeno, email, heslo, role: 'dilna' });
  };
  const pole = (id, label, typ) => [
    h('label', { class: 'popisek' }, label),
    h('input', { id, class: 'input', type: typ || 'text', style: 'width:100%;padding:8px 10px;margin-bottom:var(--space-3)',
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); odesli(); } } }),
  ];
  return dialogOkno({
    kicker: 'Nastavení', nadpis: 'Přidat uživatele', zavri,
    telo: [
      pole('nuJmeno', 'Jméno'),
      pole('nuEmail', 'E-mail'),
      pole('nuHeslo', 'Heslo (nepovinné, výchozí „cadmia")', 'password'),
    ],
    tlacitka: [
      h('button', { class: 'btn btn-ghost', onclick: zavri }, 'Zrušit'),
      h('button', { class: 'btn btn-primary', onclick: odesli }, 'Přidat'),
    ],
  });
}

async function nactiStav() {
  const v = await api('stav');
  S.zakazky = v.zakazky; S.sloupce = v.sloupce; S.uzivatele = v.uzivatele;
  S.nastaveni = v.nastaveni; S.nezarazenoPocet = v.nezarazenoPocet;
}

async function obnov(taky) {
  try {
    await nactiStav();
    if (taky !== false && S.open) S.detail = (await api('detail', { cislo: S.open })).zakazka;
    vykresli();
  } catch (e) { hlas(e); }
}

/* ---------- role ---------- */

const role      = () => S.user ? S.user.role : null;
const muzeMenit = () => role() === 'admin' || role() === 'dilna';
const jeAdmin   = () => role() === 'admin';
const jmenoKlice = k => (S.uzivatele.find(u => u.klic === k) || {}).jmeno || '';

/* ---------- odvozené hodnoty ---------- */

function viditelneSloupce() { return S.sloupce.filter(s => !s.skryt); }
function nazevSloupce(k) { const s = S.sloupce.find(x => x.klic === k); return s ? s.nazev : k; }

// Stejné skupiny jako v přehledu „Dnes" — sdílené, ať „Zobrazit na tabuli"
// z jedné skupiny ukáže přesně to, co bylo v jejím seznamu.
const RYCHLE_FILTRY = {
  hori:   z => !UZAVRENO.includes(z.stav) && z.dnuDoTerminu <= 0,
  ceka:   z => !UZAVRENO.includes(z.stav) && (z.neprectene || z.schvalilZakaznik || z.modelyChybi),
  vyroba: z => !UZAVRENO.includes(z.stav) && ['fronta', 'tiskne', 'postprocess', 'expedice'].includes(z.stav),
};
const RYCHLY_FILTR_POPIS = { hori: 'hoří', ceka: 'čeká na reakci', vyroba: 've výrobě' };

function projde(z) {
  const q = S.hledani.trim().toLowerCase();
  if (q) {
    const hay = [z.cislo, z.zakaznik, z.zakJmeno, z.zakEmail, z.material, z.tech, z.souboryText || '']
      .join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (S.fKdo && (z.prirazeno || '') !== (S.fKdo === 'nikdo' ? '' : S.fKdo)) return false;
  if (S.fTech && (z.tech || '').indexOf(S.fTech) !== 0) return false;
  if (S.fPrio && z.priorita !== S.fPrio) return false;
  if (S.fNeprectene && !z.neprectene) return false;
  if (S.fPoTerminu && (z.dnuDoTerminu >= 0 || UZAVRENO.includes(z.stav))) return false;
  if (S.fExterni && !(z.koop && z.koop.length)) return false;
  if (S.rychlyFiltr && !RYCHLE_FILTRY[S.rychlyFiltr](z)) return false;
  return true;
}

// Ruční pořadí (přetažení) má přednost; jinak nejnovější zakázka nahoře
// (nejvyšší číslo P-RRRR-NNNN). Priorita se pozná z barvy, ne z pořadí.
function poradiKaret(list) {
  const razeni = RAZENI_ZAKAZKY[S.boardRazeni] || RAZENI_ZAKAZKY.cislo;
  return list.slice().sort((a, b) => {
    if (a.prioritaRucne !== b.prioritaRucne) return a.prioritaRucne ? -1 : 1;
    if (a.prioritaRucne) return a.poradi - b.poradi;
    return razeni.cmp(a, b) * S.boardRazeniSmer;
  });
}

function maFiltry() {
  return !!(S.hledani || S.fKdo || S.fTech || S.fPrio || S.fNeprectene || S.fPoTerminu || S.fExterni || S.rychlyFiltr);
}

/* ---------- přihlášení ---------- */

function obrazovkaPrihlaseni() {
  const kdo   = S.loginKdo || (S.uzivatele[0] && S.uzivatele[0].klic) || '';
  const vybr  = S.uzivatele.find(u => u.klic === kdo);
  const posli = async () => {
    try {
      const v = await api('login', { kdo: $('#loginKdo').value, heslo: $('#loginHeslo').value });
      S.user = v.uzivatel;
      S.csrf = v.csrf;
      S.view = v.uzivatel.role === 'cteni' ? 'list' : 'today';
      S.loginChyba = '';
      await obnov();
    } catch (e) { S.loginChyba = e.message; vykresli(); }
  };

  return h('div', { class: 'app' },
    h('div', { style: 'flex:1;display:flex;align-items:center;justify-content:center;padding:var(--space-8)' },
      h('div', { style: 'width:min(420px,100%)' },
        h('div', { class: 'wordmark', style: 'margin-bottom:var(--space-6)' },
          h('img', { class: 'logo', src: 'logo.svg', alt: 'Cadmia3D', style: 'height:36px' })),
        h('h3', { style: 'margin:0 0 var(--space-1)' }, 'Zakázky — přihlášení'),
        h('p', { style: 'font-size:15px;color:var(--muted-2);margin:0 0 var(--space-5)' },
          'Interní nástroj dílny. Veřejně dostupná je jen stavová stránka s tokenem a endpoint kalkulátoru.'),

        h('label', { class: 'popisek' }, 'Uživatel'),
        h('select', {
            id: 'loginKdo', class: 'input', value: kdo,
            style: 'width:100%;padding:8px 10px;margin-bottom:var(--space-3)',
            onchange: e => { S.loginKdo = e.target.value; S.loginChyba = ''; vykresli(); },
          },
          S.uzivatele.length
            ? S.uzivatele.map(u => h('option', { value: u.klic, selected: u.klic === kdo },
                u.jmeno + ' — ' + ROLE[u.role] + (u.aktivni ? '' : ' (deaktivováno)')))
            : h('option', { value: '' }, 'načítám…')),

        h('label', { class: 'popisek' }, 'Heslo'),
        h('input', {
          id: 'loginHeslo', class: 'input', type: 'password', placeholder: 'heslo',
          style: 'width:100%;padding:8px 10px;margin-bottom:var(--space-3)',
          // Enter přihlašuje; stopPropagation, aby stisk nespadl do obsluhy tabule
          onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); posli(); } },
        }),

        S.loginChyba && h('div', {
          style: 'background:var(--red-100);color:var(--red);padding:var(--space-2) var(--space-3);font-size:15px;margin-bottom:var(--space-3)',
        }, S.loginChyba),

        h('button', { class: 'btn btn-primary', style: 'width:100%;padding:10px', onclick: posli }, 'Přihlásit se'),
        h('div', { style: 'font-size:14px;color:var(--muted);margin-top:var(--space-3)' },
          'Role vybraného uživatele: ' + (vybr ? ROLE_POPIS[vybr.role] : '—') + '. Sezení drží cookie.'))));
}

/* ---------- hlavička ---------- */

function hlavicka() {
  const neprectenych = S.zakazky.filter(z => z.neprectene).length;
  const poTerminu    = S.zakazky.filter(z => !UZAVRENO.includes(z.stav) && z.dnuDoTerminu < 0).length;

  const pohledy = [
    ['today', 'Dnes'], ['board', 'Tabule'], ['production', 'Výroba'], ['list', 'Seznam'], ['customers', 'Zákazníci'],
    ['mail', 'Pošta'], ['inbox', 'Nezařazeno'], ['settings', 'Nastavení'], ['public', 'Náhled pro zákazníka'],
  ].filter(([k]) => jeAdmin() || (k !== 'settings'
    && (muzeMenit() || (k !== 'inbox' && k !== 'mail' && k !== 'production'))));

  // Počty jsou při nule zšedlé a nekliknutelné — jinak by klik vyprázdnil tabuli.
  const pocitadlo = (pocet, text, aktivni, klik) => h('button', {
    class: 'pocitadlo' + (aktivni ? ' aktivni' : pocet ? ' ma' : ''),
    title: pocet ? 'Zobrazit na tabuli jen tyto zakázky' : 'Nic k zobrazení',
    onclick: () => { if (pocet) klik(); },
  }, text);

  return h('header', { class: 'hlavicka' },
    h('div', { class: 'wordmark' },
      h('img', { class: 'logo', src: 'logo.svg', alt: 'Cadmia3D' }),
      h('span', { class: 'sekce' }, 'Zakázky')),

    h('nav', { class: 'navigace' }, pohledy.map(([k, label]) => h('button', {
      class: S.view === k ? 'aktivni' : '',
      onclick: () => prepniPohled(k),
    }, k === 'inbox' && S.nezarazenoPocet ? label + ' (' + S.nezarazenoPocet + ')' : label))),

    h('div', { class: 'hlavicka-vpravo' },
      pocitadlo(neprectenych, neprect(neprectenych), S.fNeprectene, () => {
        S.view = 'board'; S.fNeprectene = !S.fNeprectene; S.fPoTerminu = false; vykresli();
      }),
      pocitadlo(poTerminu, poTerminu + ' po termínu', S.fPoTerminu, () => {
        S.view = 'board'; S.fPoTerminu = !S.fPoTerminu; S.fNeprectene = false; vykresli();
      }),
      h('span', { style: 'color:var(--muted);white-space:nowrap' }, 'Obnovuje se každých 30 s'),
      !muzeMenit() && h('span', { class: 'stitek-cteni' }, 'pouze čtení'),
      h('span', { class: 'avatar' }, ini(S.user.jmeno)),
      h('span', { style: 'white-space:nowrap' }, S.user.jmeno + ' · ' + ROLE[S.user.role]),
      h('button', { class: 'btn btn-ghost', style: 'padding:3px 8px', onclick: async () => {
        await api('logout', {}); S.user = null; S.open = null; vykresli();
      } }, 'Odhlásit')));
}

async function prepniPohled(k) {
  S.view = k;
  try {
    if (k === 'customers') { S.firmy = (await api('firmy')).firmy; if (!S.firmaKlic && S.firmy[0]) S.firmaKlic = S.firmy[0].klic; }
    if (k === 'mail')      S.posta = (await api('posta&filtr=' + S.postaFiltr)).posta;
    if (k === 'inbox')     S.nezarazeno = await api('nezarazeno');
    if (k === 'production') {
      // znovunačtení fronty strojů je vždy bezpečné; nepřiřazené díly se taky vždy
      // dotáhnou znovu (jinak by po přesunu zakázky do "Ve frontě na tisk" jinde
      // zůstal starý, už jednou načtený pool) — jen rozpracovaný návrh (S.planJobs)
      // se nesahá, ať druhý klik na Plánování nesmaže rozpracovanou práci
      S.vyroba = (await api('vyroba')).stroje;
      const t = await api('tiskarny'); S.tiskarny = t.tiskarny; S.stroje = t.stroje;
    }
    if (k === 'settings')  {
      S.nastaveniData = await api('nastaveni');
      const t = await api('tiskarny'); S.tiskarny = t.tiskarny; S.stroje = t.stroje;
    }
    if (k === 'public' && !S.pubCislo && S.zakazky[0]) S.pubCislo = S.zakazky[0].cislo;
  } catch (e) { hlas(e); }
  vykresli();
}

async function otevriVyrobu(obrazovka, cisloZakazky = null) {
  S.vyrobaObrazovka = obrazovka;
  if (cisloZakazky) {
    // Z detailu vede plánování rovnou na konkrétní zakázku — nejen do obecné fronty.
    S.planZakazka = cisloZakazky;
    S.planHledani = cisloZakazky;
    S.planFTech = '';
  }
  await prepniPohled('production');
  if (obrazovka === 'planovani' && S.planJobs.length === 0) {
    try { await nactiPlanovani(); } catch (e) { hlas(e); }
  }
  vykresli();
}

/* ---------- dnešní práce ---------- */

function pracovniRadek(z) {
  const poTerminu = !UZAVRENO.includes(z.stav) && z.dnuDoTerminu < 0;
  const termin = UZAVRENO.includes(z.stav) ? 'uzavřeno'
    : poTerminu ? 'po termínu ' + dny(-z.dnuDoTerminu)
    : z.dnuDoTerminu === 0 ? 'dnes' : 'za ' + dny(z.dnuDoTerminu);
  const barva = poTerminu ? 'var(--red)' : (z.dnuDoTerminu <= 2 ? 'var(--red-mid)' : 'var(--teal)');
  return h('article', { class: 'card', style: 'cursor:pointer;border-left-color:' + barva + ';padding:12px',
      onclick: () => otevri(z.cislo), tabindex: '0',
      onkeydown: e => { if (e.key === 'Enter') otevri(z.cislo); } },
    h('div', { style: 'display:flex;gap:8px;align-items:baseline' },
      h('span', { class: 'cislo' }, z.cislo),
      z.neprectene && h('span', { class: 'tecka', title: 'Nepřečtená zpráva' }),
      h('span', { style: 'margin-left:auto;color:' + barva + ';font-weight:600;font-size:13px;white-space:nowrap' }, termin)),
    h('div', { class: 'zakaznik', style: 'font-size:18px;margin-top:3px' }, z.zakaznik),
    h('div', { style: 'display:flex;justify-content:space-between;gap:8px;color:var(--muted-2);font-size:14px;margin-top:4px' },
      h('span', {}, [z.tech, z.material].filter(Boolean).join(' · ') || nazevSloupce(z.stav)),
      h('span', { style: 'white-space:nowrap' }, kc(z.celkem))));
}

// Otevře tabuli přefiltrovanou přesně na skupinu, ze které se kliklo — stejná
// množina karet jako v seznamu, jen na tabuli (drag-and-drop, hromadné akce).
function otevriNaTabuli(klic) {
  S.rychlyFiltr = klic;
  prepniPohled('board');
}

function sekceDnes(klic, nadpis, popis, zakazky, prazdno) {
  const rozbaleno = !!S.dnesRozbalene[klic];
  const viditelne = rozbaleno ? zakazky : zakazky.slice(0, 5);
  return h('section', { style: 'min-width:0;background:var(--panel);border-left:3px solid var(--teal);padding:var(--space-4)' },
    h('div', { style: 'display:flex;justify-content:space-between;align-items:baseline;gap:var(--space-2);margin-bottom:4px' },
      h('h3', { style: 'margin:0' }, nadpis),
      h('span', { style: 'font-size:13px;color:var(--muted)' },
        zakazky.length > 5 && !rozbaleno ? 'zobrazeno 5 z ' + zakazky.length : karty(zakazky.length))),
    h('p', { style: 'margin:0 0 var(--space-3);font-size:14px;color:var(--muted-2)' }, popis),
    zakazky.length > 0 && h('button', { class: 'btn btn-secondary', style: 'padding:4px 10px;margin-bottom:var(--space-3)',
      title: 'Zobrazit jen tuhle skupinu na tabuli — jde na ní přetahovat karty a dělat hromadné akce.',
      onclick: () => otevriNaTabuli(klic) }, 'Zobrazit na tabuli'),
    zakazky.length > 0 ? [viditelne.map(pracovniRadek),
      zakazky.length > 5 && h('button', { class: 'btn btn-ghost', style: 'margin-top:var(--space-2);padding:4px 8px',
        onclick: () => { S.dnesRozbalene[klic] = !rozbaleno; vykresli(); } },
      rozbaleno ? 'Zobrazit jen prvních 5' : 'Zobrazit všech ' + zakazky.length)]
      : h('div', { style: 'background:#fff;border:1px solid var(--line);padding:var(--space-3);color:var(--muted)' }, prazdno));
}

function obrazovkaDnes() {
  const aktivni = S.zakazky.filter(z => !UZAVRENO.includes(z.stav));
  const horici = aktivni.filter(RYCHLE_FILTRY.hori).sort((a, b) => a.dnuDoTerminu - b.dnuDoTerminu);
  const cekaji = aktivni.filter(RYCHLE_FILTRY.ceka).sort((a, b) => a.dnuDoTerminu - b.dnuDoTerminu);
  const vyroba = aktivni.filter(RYCHLE_FILTRY.vyroba).sort((a, b) => a.dnuDoTerminu - b.dnuDoTerminu);
  const dnes = aktivni.filter(z => z.dnuDoTerminu === 0).length;

  return h('main', { style: 'padding:var(--space-5);max-width:1500px;width:100%;margin:0 auto' },
    h('div', { style: 'display:flex;flex-wrap:wrap;gap:var(--space-3);justify-content:space-between;align-items:flex-end;margin-bottom:var(--space-5)' },
      h('div', {}, h('div', { class: 'kicker' }, 'Pracovní přehled'), h('h2', { style: 'margin:8px 0 4px' }, 'Dnes v dílně'),
        h('p', { style: 'margin:0;color:var(--muted-2)' }, dnes ? 'Dnes mají termín ' + zakazek(dnes) + '.' : 'Přehled toho, co potřebuje pozornost jako první.')),
      h('div', { style: 'display:flex;flex-wrap:wrap;gap:var(--space-2)' },
        muzeMenit() && h('button', { class: 'btn btn-primary', onclick: () => otevriVyrobu('planovani') }, 'Plánovat výrobu'),
        h('button', { class: 'btn btn-secondary', onclick: () => prepniPohled('board') }, 'Otevřít tabuli'))),
    h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:var(--space-4);align-items:start' },
      sekceDnes('hori', 'Hoří', 'Zakázky s termínem dnes nebo po termínu.', horici, 'Nic není po termínu ani na dnešek.'),
      sekceDnes('ceka', 'Čeká na reakci', 'Nepřečtená odpověď, schválení nebo chybějící model.', cekaji, 'Žádný blokátor nečeká na vyřízení.'),
      sekceDnes('vyroba', 'Ve výrobě', 'Fronta tisku, tisk, dokončení a expedice.', vyroba, 'Ve výrobě teď není žádná otevřená zakázka.')));
}

/* ---------- tabule ---------- */

function obrazovkaTabule() {
  const filtrovane = S.zakazky.filter(projde);
  const naTabuli   = viditelneSloupce().map(c => c.klic);
  const skryto     = S.zakazky.filter(z => naTabuli.includes(z.stav) && z.stav !== 'hotovo' && !projde(z)).length;

  const popisFiltru = () => {
    const a = [];
    if (S.hledani)     a.push('hledání „' + S.hledani + '"');
    if (S.fKdo)        a.push('přiřazeno: ' + (S.fKdo === 'nikdo' ? 'nepřiřazeno' : jmenoKlice(S.fKdo)));
    if (S.fTech)       a.push('technologie ' + S.fTech);
    if (S.fPrio)       a.push('priorita ' + PRIO[S.fPrio].label);
    if (S.fNeprectene) a.push('nepřečtená zpráva');
    if (S.fPoTerminu)  a.push('po termínu');
    if (S.fExterni)    a.push('externí kooperace');
    if (S.rychlyFiltr) a.push(RYCHLY_FILTR_POPIS[S.rychlyFiltr]);
    return 'Filtry: ' + a.join(' + ') + ' · skryto ' + karty(skryto);
  };

  const vyber = (hodnota, onchange, moznosti) => h('select', {
    class: 'input', style: 'width:auto;padding:6px 8px', onchange,
  }, moznosti.map(([v, l]) => h('option', { value: v, selected: v === hodnota }, l)));

  return h('div', { style: 'display:flex;flex-direction:column;flex:1;min-height:0' },
    h('div', { class: 'filtry' },
      h('input', {
        id: 'hledani', class: 'input', value: S.hledani,
        placeholder: 'Hledat číslo, zákazníka, e-mail, soubor…',
        style: 'width:290px;max-width:100%;padding:6px 10px',
        oninput: e => { S.hledani = e.target.value; prekresliTabuli(); },
      }),
      vyber(S.fKdo, e => { S.fKdo = e.target.value; vykresli(); },
        [['', 'Kdokoli'], ['nikdo', 'Nepřiřazeno'], ...S.uzivatele.map(u => [u.klic, u.jmeno])]),
      vyber(S.fTech, e => { S.fTech = e.target.value; vykresli(); },
        [['', 'Všechny technologie'], ['FDM', 'FDM'], ['SLA', 'SLA'], ['SLS', 'SLS'], ['MJF', 'MJF'], ['SLM', 'SLM (externě)']]),
      vyber(S.fPrio, e => { S.fPrio = e.target.value; vykresli(); },
        [['', 'Každá priorita'], ...Object.keys(PRIO).filter(k => k !== 'zadna').map(k => [k, PRIO[k].label])]),
      h('select', { class: 'input', style: 'width:auto;padding:6px 8px',
          onchange: e => { S.boardRazeni = e.target.value; S.boardRazeniSmer = 1; vykresli(); } },
        Object.entries(RAZENI_ZAKAZKY).map(([k, r]) => h('option', { value: k, selected: k === S.boardRazeni },
          r.nazev))),
      h('button', { class: 'btn btn-ghost', style: 'padding:6px 10px', title: 'Obrátit pořadí řazení',
        onclick: () => { S.boardRazeniSmer *= -1; vykresli(); } }, S.boardRazeniSmer === 1 ? '↓' : '↑'),

      h('button', { class: 'prepinac' + (S.fNeprectene ? ' zap' : ''),
        onclick: () => { S.fNeprectene = !S.fNeprectene; vykresli(); } }, 'Nepřečtená zpráva'),
      h('button', { class: 'prepinac' + (S.fPoTerminu ? ' zap' : ''),
        onclick: () => { S.fPoTerminu = !S.fPoTerminu; vykresli(); } }, 'Po termínu'),
      h('button', { class: 'prepinac' + (S.fExterni ? ' zap teal' : ''),
        onclick: () => { S.fExterni = !S.fExterni; vykresli(); } }, 'Externí kooperace'),

      muzeMenit() && h('button', { class: 'btn btn-primary', style: 'margin-left:auto',
        onclick: novaZakazka }, 'Přidat zakázku')),

    maFiltry() && h('div', { class: 'pruh-filtru' },
      h('span', { style: 'font-size:15px;color:var(--muted-2)' }, popisFiltru()),
      h('button', { class: 'btn btn-secondary', style: 'padding:3px 10px', onclick: () => {
        Object.assign(S, { hledani: '', fKdo: '', fTech: '', fPrio: '',
          fNeprectene: false, fPoTerminu: false, fExterni: false, rychlyFiltr: null });
        vykresli();
      } }, 'Zrušit filtry')),

    tabuleEl(filtrovane));
}

// autoscroll tabule při přetahování karty — řízený časovačem, ať funguje plynule
// i když se dragover přestane hlásit (kurzor u kraje okna)
let _autoScrollTimer = null;
let _dragX = 0;
function zastavAutoScroll() {
  if (_autoScrollTimer) { clearInterval(_autoScrollTimer); _autoScrollTimer = null; }
  _dragX = 0;
}
function spustAutoScroll() {
  if (_autoScrollTimer) return;
  _autoScrollTimer = setInterval(() => {
    const t = document.getElementById('tabule');
    if (!t || !S.drag) { zastavAutoScroll(); return; }
    const r = t.getBoundingClientRect();
    const zona = 130;                 // aktivační pruh dovnitř od kraje tabule
    if (_dragX && _dragX < r.left + zona)       t.scrollLeft -= 14;
    else if (_dragX && _dragX > r.right - zona) t.scrollLeft += 14;
  }, 16);
}
document.addEventListener('dragend', zastavAutoScroll);
document.addEventListener('drop', zastavAutoScroll);

// autoscroll celé stránky svisle při přetahování mimo tabuli (např. plánování
// výroby — přetažení dílu na zařízení dole, fronta úloh u tiskárny) — tam se
// totiž roluje okno, ne vnitřní kontejner, a bez tohohle kurzor u kraje nic nedělal.
let _pageScrollTimer = null;
let _dragY = 0;
function zastavPageAutoScroll() {
  if (_pageScrollTimer) { clearInterval(_pageScrollTimer); _pageScrollTimer = null; }
  _dragY = 0;
}
function spustPageAutoScroll() {
  if (_pageScrollTimer) return;
  _pageScrollTimer = setInterval(() => {
    if (!S.drag && !S.dragItem && !S.dragUloha) { zastavPageAutoScroll(); return; }
    const zona = 80;                  // aktivační pruh od kraje okna
    if (_dragY && _dragY < zona) window.scrollBy(0, -14);
    else if (_dragY && _dragY > window.innerHeight - zona) window.scrollBy(0, 14);
  }, 16);
}
document.addEventListener('dragover', e => {
  if (!S.drag && !S.dragItem && !S.dragUloha) return;
  _dragY = e.clientY;
  spustPageAutoScroll();
});
document.addEventListener('dragend', zastavPageAutoScroll);
document.addEventListener('drop', zastavPageAutoScroll);

/* ---------- přetažení karty (myš i dotyk, vlastní logika) ---------- */
// Nativní HTML5 drag-and-drop se s myší chová hůř (poloprůhledný "duch" karty
// nesleduje kurzor přesně) a na dotyku ho spousta mobilních prohlížečů vůbec
// nespouští z prstu — proto obojí jede přes pointer events na jednom místě,
// stejně pro myš i dotyk: krátký stisk a pohyb posouvá (sloupec svisle nebo
// tabuli vodorovně, podle převažujícího směru), dlouhý stisk (~350 ms) beze
// pohybu kartu "chytí" za kurzor/prst přesně jako na tabletu.
const DLOUHY_STISK_MS = 350;
let _pretDrag = null;
// preventDefault() na pointerdown nespolehlivě potlačuje navazující click ve
// všech prohlížečích (u myši to umí "prokouknout") — po posunu/tažení proto
// klik na kartu sami na jeden příští pokus zablokujeme, ať se po scrollu
// needotevře detail (a s ním celé překreslení, které by scroll shodilo zpět).
let _blokovatKlik = false;

function pretazeniZahaj(e, cislo) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  e.preventDefault();
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  const sloupecKarty = el.closest('.sloupec-karty');
  const tabule = el.closest('.tabule');
  _pretDrag = {
    cislo, el, nad: null, aktivni: false, ghost: null, timer: null, scrollLocked: false,
    pointerType: e.pointerType,
    startX: e.clientX, startY: e.clientY,
    offsetX: e.clientX - r.left, offsetY: e.clientY - r.top, sirka: r.width,
    sloupecKarty, sloupecScrollStart: sloupecKarty ? sloupecKarty.scrollTop : 0,
    tabule, tabuleScrollStart: tabule ? tabule.scrollLeft : 0,
  };
  // setPointerCapture umí selhat (typicky jen automatizované testy, ne živý
  // dotyk/myš) — poslech na document místo na kartě proto funguje spolehlivě
  // i bez něj, když se ukazatel při rychlém tahu na okamžik dostane mimo kartu.
  try { el.setPointerCapture(e.pointerId); } catch { /* nevadí, viz výše */ }
  document.addEventListener('pointermove', pretazeniPohyb);
  document.addEventListener('pointerup', pretazeniKonec);
  document.addEventListener('pointercancel', pretazeniKonec);
  _pretDrag.timer = setTimeout(pretazeniAktivuj, DLOUHY_STISK_MS);
}

function pretazeniAktivuj() {
  const d = _pretDrag;
  if (!d || d.aktivni) return;
  d.aktivni = true;
  if (d.timer) { clearTimeout(d.timer); d.timer = null; }
  S.drag = d.cislo;
  d.el.classList.add('tazena');
  document.body.style.cursor = 'grabbing';
  const ghost = d.el.cloneNode(true);
  ghost.className = 'card karta karta-duch';
  ghost.style.width = d.sirka + 'px';
  ghost.style.transform = 'translate(' + Math.round(d.startX - d.offsetX) + 'px,' + Math.round(d.startY - d.offsetY) + 'px)';
  document.body.appendChild(ghost);
  d.ghost = ghost;
}

function pretazeniPohyb(e) {
  const d = _pretDrag;
  if (!d) return;
  const dx = e.clientX - d.startX, dy = e.clientY - d.startY;

  if (!d.aktivni) {
    // před "chycením" (myš i dotyk stejně): buď ještě čekáme na dlouhý stisk
    // (malé chvění nevadí), nebo se pohyb už vyhodnotil jako posun a jen ho
    // vedeme — ručně, protože touch-action:none na kartě jinak scroll úplně
    // zablokuje a myš nemá k posunu žádné vlastní gesto.
    if (!d.scrollLocked && Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    if (!d.scrollLocked) { d.scrollLocked = true; if (d.timer) { clearTimeout(d.timer); d.timer = null; } }
    if (Math.abs(dy) >= Math.abs(dx)) { if (d.sloupecKarty) d.sloupecKarty.scrollTop = d.sloupecScrollStart - dy; }
    else if (d.tabule) d.tabule.scrollLeft = d.tabuleScrollStart - dx;
    return;
  }

  e.preventDefault();
  d.ghost.style.transform = 'translate(' + Math.round(e.clientX - d.offsetX) + 'px,' + Math.round(e.clientY - d.offsetY) + 'px)';
  _dragX = e.clientX; _dragY = e.clientY;
  spustAutoScroll(); spustPageAutoScroll();

  const pod = document.elementFromPoint(e.clientX, e.clientY);
  const sloupecEl = pod && pod.closest('.sloupec');
  const klic = sloupecEl ? sloupecEl.dataset.klic : null;
  if (klic !== S.dragOver) { S.dragOver = klic; oznacSloupce(); }
  const kartaPod = pod && pod.closest('.karta');
  d.nad = (kartaPod && kartaPod.dataset.cislo !== d.cislo) ? kartaPod.dataset.cislo : null;
}

function pretazeniKonec(e) {
  const d = _pretDrag;
  if (!d) return;
  if (d.timer) clearTimeout(d.timer);
  document.removeEventListener('pointermove', pretazeniPohyb);
  document.removeEventListener('pointerup', pretazeniKonec);
  document.removeEventListener('pointercancel', pretazeniKonec);
  zastavAutoScroll(); zastavPageAutoScroll();
  document.body.style.cursor = '';
  _pretDrag = null;
  d.el.classList.remove('tazena');
  if (d.ghost) d.ghost.remove();
  const cislo = d.cislo, cilKarta = d.nad, cilKlic = S.dragOver, bylAktivni = d.aktivni;
  S.drag = null; S.dragOver = null;
  // preventDefault() na pointerdown nespolehlivě potlačí navazující click ve
  // všech prohlížečích (u myši to umí "prokouknout") — o to, co klik znamená,
  // se stará výhradně tenhle kód; kdyby click přesto přišel, zablokujeme ho
  // (jednorázově, s pojistkou timeoutem, kdyby náhodou nepřišel vůbec).
  _blokovatKlik = true;
  setTimeout(() => { _blokovatKlik = false; }, 300);
  // čistý klik/ťuknutí bez pohybu otevřeme sami; když šlo o posun (scrollLocked),
  // otevírat nic nemá, to už jen doscrolloval
  if (!bylAktivni) { if (!d.scrollLocked) { d.el.focus(); otevri(cislo); } return; }
  const zdroj = S.zakazky.find(x => x.cislo === cislo);
  const cil = cilKarta ? S.zakazky.find(x => x.cislo === cilKarta) : null;
  // pustit na kartu ve stejném sloupci = ruční pořadí, jinak přesun do sloupce cíle
  if (cil && zdroj && zdroj.stav === cil.stav) zmenPoradi(cislo, cilKarta);
  else if (cil) presun(cislo, cil.stav);
  else if (cilKlic) presun(cislo, cilKlic);
  else prekresliTabuli();
}

/* ---------- posun tabule i sloupce myší po prázdné ploše ---------- */
// Na dotyku se tabule i dlouhý sloupec přirozeně posouvají tažením prstu
// (nativní scroll, beze změny). S myší k tomu není žádné gesto, jen kolečko —
// jde to ale i s myší "chytit" za prázdné místo (mimo kartu a ovládací prvky)
// a přetáhnout: vodorovně tabuli mezi sloupci, svisle sloupec pod kurzorem
// (typicky prázdný pruh pod poslední kartou) — stejně jako swipe na tabletu.
let _panDrag = null;

function panZahaj(e) {
  if (e.pointerType !== 'mouse' || e.button !== 0) return;
  if (e.target.closest('.karta, button, select, input, a')) return;
  e.preventDefault();
  const el = e.currentTarget;
  const sloupecKarty = e.target.closest('.sloupec-karty');
  _panDrag = {
    el, startX: e.clientX, startY: e.clientY, scrollStart: el.scrollLeft,
    sloupecKarty, sloupecScrollStart: sloupecKarty ? sloupecKarty.scrollTop : 0,
  };
  try { el.setPointerCapture(e.pointerId); } catch { /* viz pretazeniZahaj výše */ }
  document.addEventListener('pointermove', panPohyb);
  document.addEventListener('pointerup', panKonec);
  document.addEventListener('pointercancel', panKonec);
}

function panPohyb(e) {
  const p = _panDrag;
  if (!p) return;
  p.el.classList.add('tabule-tazena');
  p.el.scrollLeft = p.scrollStart - (e.clientX - p.startX);
  if (p.sloupecKarty) p.sloupecKarty.scrollTop = p.sloupecScrollStart - (e.clientY - p.startY);
}

function panKonec(e) {
  const p = _panDrag;
  if (!p) return;
  document.removeEventListener('pointermove', panPohyb);
  document.removeEventListener('pointerup', panKonec);
  document.removeEventListener('pointercancel', panKonec);
  p.el.classList.remove('tabule-tazena');
  _panDrag = null;
}

// Kontejner tabule i s vodorovným rolováním: kolečkem myši, tažením za prázdnou
// plochu a u kraje při přetahování karty.
function tabuleEl(filtrovane) {
  const el = h('div', { class: 'tabule', id: 'tabule', onpointerdown: panZahaj },
    h('div', { class: 'sloupce' }, viditelneSloupce().map(c => sloupec(c, filtrovane))));

  // Kolečko: když je kurzor nad dlouhým sloupcem, roluje se sloupec svisle;
  // jinak (nebo když sloupec dojel na kraj) se roluje tabule vodorovně.
  el.addEventListener('wheel', e => {
    if (!e.deltaY) return;
    const karty = e.target.closest && e.target.closest('.sloupec-karty');
    const dlouhy = karty && karty.scrollHeight - karty.clientHeight > 1;
    if (dlouhy) {
      const naDno   = karty.scrollTop + karty.clientHeight >= karty.scrollHeight - 1;
      const naVrchu = karty.scrollTop <= 0;
      if (!(e.deltaY > 0 && naDno) && !(e.deltaY < 0 && naVrchu)) {
        karty.scrollTop += e.deltaY;
        e.preventDefault();
        return;
      }
    }
    el.scrollLeft += e.deltaY;
    e.preventDefault();
  }, { passive: false });

  // sleduj kurzor při přetahování; vlastní posun dělá časovač
  el.addEventListener('dragover', e => {
    if (!S.drag) return;
    _dragX = e.clientX;
    spustAutoScroll();
  });

  return el;
}

function prekresliTabuli() {
  // překreslení jen tabule, aby hledání nepřišlo o kurzor v poli
  const stary = $('#tabule');
  if (!stary) { vykresli(); return; }
  const posun = stary.scrollLeft;
  const novy = tabuleEl(S.zakazky.filter(projde));
  stary.replaceWith(novy);
  novy.scrollLeft = posun;            // až po vložení do DOM, jinak se ořízne na 0
  const pruh = document.querySelector('.pruh-filtru');
  if (maFiltry() !== !!pruh) vykresli();
}

// Zvýraznění cílového sloupce při přetahování — jen přehození CSS třídy,
// bez překreslení tabule (to by při autoscrollu způsobovalo cukání).
function oznacSloupce() {
  document.querySelectorAll('#tabule .sloupec').forEach(el => {
    el.classList.toggle('nad', el.dataset.klic === S.dragOver);
  });
}

function sloupec(c, filtrovane) {
  const list  = poradiKaret(filtrovane.filter(z => z.stav === c.klic));
  const suma  = list.reduce((a, z) => a + z.celkem, 0);
  const jeHotovo = c.klic === 'hotovo';
  const sirka = jeHotovo ? '210px' : '300px';

  return h('section', {
      class: 'sloupec' + (S.dragOver === c.klic ? ' nad' : ''),
      'data-klic': c.klic,
      style: 'width:' + sirka,
    },
    h('div', { class: 'sloupec-hlavicka' },
      h('h4', {}, c.nazev),
      h('span', { style: 'font-size:13px;color:var(--muted)' }, String(list.length)),
      h('span', { style: 'margin-left:auto;font-size:12px;color:var(--muted)' }, list.length ? kc(suma) : '')),

    h('div', { class: 'sloupec-karty' },
      jeHotovo
        ? [h('div', { style: 'font-size:15px;color:var(--muted-2);padding:var(--space-2) var(--space-2) var(--space-1)' },
              list.length + ' za posledních 30 dnů'),
           h('button', { class: 'btn btn-secondary', style: 'margin:0 var(--space-2)',
             onclick: () => { S.view = 'list'; S.fStav = 'hotovo'; vykresli(); } }, 'Zobrazit dodané')]
        : [list.map(karta),
           list.length === 0 && h('div', { style: 'font-size:15px;color:var(--muted);padding:var(--space-2)' },
             muzeMenit() ? 'Přetáhni sem kartu' : '—')]));
}

function karta(z) {
  const p = PRIO[z.priorita];
  const d = z.dnuDoTerminu;
  const uzavrena = UZAVRENO.includes(z.stav);
  const poTerminu = d < 0 && !uzavrena;
  // místo slovní priority rovnou počet dní do termínu; pod 3 dny (i po termínu)
  // se vždy zvýrazní červeně, jinak zůstává barva podle priority
  const dnyZnacka = uzavrena ? p.label : d < 0 ? '−' + dny(-d) : d === 0 ? 'dnes' : dny(d);
  const dnyBarva  = uzavrena ? p.fg : (d < 3 ? 'var(--red)' : p.fg);

  // jeden štítek stavu, v pevném pořadí důležitosti
  let znacka = null;
  if (z.schvalilZakaznik)   znacka = ['✓ zákazník schválil nabídku', 'var(--teal)', '#fff'];
  else if (z.modelyChybi)   znacka = ['modely chybí', 'var(--red-100)', 'var(--red)'];
  else if (z.nedorucitelny) znacka = ['e-mail se nedoručil', 'var(--red-100)', 'var(--red)'];
  else if (z.stalyZakaznik)
    znacka = ['stálý zákazník · ' + z.stalyZakaznik.pocet + '× tištěno, naposledy '
              + dm(z.stalyZakaznik.naposledy), 'var(--teal-100)', 'var(--teal-700)'];
  else if (z.koop && z.koop.length) {
    const a = z.koop.find(o => o.stav !== 'vraceno') || z.koop[z.koop.length - 1];
    znacka = ['externě · ' + (a.partner || 'partner nenastaven') + ' — ' + a.stavLabel, 'var(--line)', 'var(--ink)'];
  }

  const terminText = dm(z.termin) + (uzavrena ? ''
    : poTerminu ? ' (po termínu ' + dny(-d) + ')' : d === 0 ? ' (dnes)' : ' (za ' + dny(d) + ')');

  return h('article', {
      class: 'card karta' + (S.drag === z.cislo ? ' tazena' : '') + (S.sel === z.cislo ? ' vybrana' : ''),
      style: 'cursor:' + (muzeMenit() ? 'grab' : 'pointer') + ';border-left-color:' + p.bg
        + (muzeMenit() ? ';touch-action:none' : ''),
      tabindex: '0',
      'data-cislo': z.cislo,
      onpointerdown: muzeMenit() ? (e => pretazeniZahaj(e, z.cislo)) : null,
      onclick: () => { if (_blokovatKlik) { _blokovatKlik = false; return; } otevri(z.cislo); },
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); otevri(z.cislo); } },
    },
    h('div', { class: 'telo' },
      h('div', { class: 'radek1' },
        h('span', { class: 'cislo' }, z.cislo),
        z.neprectene && h('span', { class: 'tecka' }),
        z.prioritaRucne && h('span', { class: 'rucne',
          title: 'Pořadí / priorita nastavené ručně — přetažením karty nebo v detailu. Zrušíš tak, že v detailu vrátíš Prioritu na „automaticky".' },
          '✱ ručně'),
        h('span', { class: 'prio', style: 'color:' + dnyBarva, title: 'priorita: ' + p.label }, dnyZnacka)),

      // Karta na tabuli ukazuje jen zákazníka, termín, cenu, materiál/technologii
      // a jeden problémový štítek — počet dílů/kusů, rozpracované soubory
      // a průběh tisku jsou vidět až v detailu a v přehledu Výroby.
      h('div', { class: 'radek2' },
        z.tech && h('div', { class: 'nahled', style: techZnackaStyl(z.tech),
          title: 'Technologie tisku: ' + z.tech }, z.tech),
        h('div', { style: 'min-width:0' },
          h('div', { class: 'zakaznik' }, z.zakaznik),
          h('div', { class: 'souhrn' }, [z.tech, z.material].filter(Boolean).join(' · ')))),

      h('div', { class: 'radek3' },
        h('span', { style: 'font-weight:600' }, kc(z.celkem)),
        h('span', { style: 'color:' + (poTerminu ? 'var(--red)' : 'var(--muted-2)') }, terminText),
        h('span', { class: 'ini', style: 'background:' + (z.prirazeno ? 'var(--teal-100)' : 'transparent')
          + ';color:' + (z.prirazeno ? 'var(--teal-700)' : 'var(--muted)') }, ini(jmenoKlice(z.prirazeno)))),

      znacka && h('div', { class: 'znacka', style: 'background:' + znacka[1] + ';color:' + znacka[2] }, znacka[0])));
}

/* ---------- akce nad kartou ---------- */

// Přesun i změna pořadí se nejdřív promítnou lokálně (ať karta zůstane, kam ji
// pustíš), pak se pošlou na server a obnov() si vyžádá směrodatný stav.
async function presun(cislo, stav) {
  const z = S.zakazky.find(x => x.cislo === cislo);
  if (z && z.stav !== stav) { z.stav = stav; prekresliTabuli(); }
  try { await api('presun', { cislo, stav }); } catch (e) { hlas(e); }
  await obnov();
}
async function zmenPoradi(cislo, nad) {
  const z   = S.zakazky.find(x => x.cislo === cislo);
  const cil = S.zakazky.find(x => x.cislo === nad);
  if (z && cil) {
    z.prioritaRucne = true;
    z.priorita = cil.priorita;
    z.poradi = (cil.poradi || 0) - 1;
    prekresliTabuli();
  }
  try { await api('poradi', { cislo, nad }); } catch (e) { hlas(e); }
  await obnov();
}
async function otevri(cislo) {
  try {
    S.open = cislo; S.sel = cislo;
    Object.assign(S, { draft: '', prebitCena: '', prebitDuvod: '', rezim: 'odpoved', histOpen: false,
      smazPriloha: null, dropAktivni: false, citaceZpravy: {}, histZakOpen: false });
    S.detail = (await api('detail', { cislo })).zakazka;
    if (!S.tiskarny || !S.tiskarny.length) { const t = await api('tiskarny'); S.tiskarny = t.tiskarny; }
    await nactiStav();
    vykresli();
  } catch (e) { S.open = null; hlas(e); }
}
async function novaZakazka() {
  const jmeno = await zeptat('Nová zakázka', { popisek: 'Jméno zákazníka nebo firmy', textOk: 'Založit' });
  if (jmeno === null) return;
  try {
    const v = await api('nova-zakazka', { jmeno: jmeno || 'Nový zákazník' });
    await obnov(false);
    otevri(v.cislo);
  } catch (e) { hlas(e); }
}
async function poleZakazky(data) {
  try { await api('pole', Object.assign({ cislo: S.open }, data)); await obnov(); } catch (e) { hlas(e); }
}
async function konfiguraceUloz(data) {
  try { await api('konfigurace-uloz', Object.assign({ cislo: S.open }, data)); await obnov(); } catch (e) { hlas(e); }
}

/* ---------- detail karty ---------- */

function detailPanel() {
  const z = S.detail;
  if (!z) return null;
  const k    = z.kalkulace || {};
  const p    = PRIO[z.priorita];
  const koop = z.koopDetail || [];
  const rezerva = z.rezerva;
  const upravena = z.cenaPuvodni !== null || z.mnozstviZmeneno;

  const zavri = () => { S.open = null; S.detail = null; vykresli(); };
  const sekce = (nadpis) => h('h4', { class: 'kicker' }, nadpis);

  // 03 — rozpad z kalkulátoru přestane platit po ruční úpravě
  const radky = upravena
    ? [['Cena podle položek', kc(z.polozky.reduce((a, x) => a + Math.round(x.cenaKus * x.pocet), 0)), false],
       ...(z.cenaPuvodni !== null ? [['Ruční úprava', z.cenaDuvod, false]] : [])]
    : [['Materiál', kc(k.material || 0), false], ['Strojní čas', kc(k.stroj || 0), false],
       ['Dokončení', kc(k.dokonceni || 0), false], ['Cena úlohy', kc(k.cenaUlohy || 0), false],
       ['Sleva podle množství', k.sleva ? '−' + kc(k.sleva) : '—', false]];
  radky.push(['Bez DPH', kc(k.net || 0), false], ['DPH 21 %', kc(k.dph || 0), false],
             ['Celkem s DPH', kc(k.celkem || 0), true]);

  const cenaPozn = z.mnozstviZmeneno && z.cenaPuvodni === null
    ? 'Počet kusů byl upraven — cena i hodiny tisku se přepočítaly poměrně z ceny za kus. Sleva podle množství a přeskládání tiskových úloh se tím nemění; na to je potřeba přepočet v kalkulátoru.'
    : z.cenaPuvodni !== null
      ? 'Platí ručně zadaná cena ' + kc(k.celkem) + ' s DPH; ceny za kus jsou z ní rozpočítané, takže nabídka sedí na součet. Z kalkulátoru bylo ' + kc(z.cenaPuvodni) + '. Důvod: ' + (z.cenaDuvod || 'neuveden') + '.'
      : 'Zadaná cena s DPH platí přesně tak, jak ji napíšeš. Rozpočítá se poměrně do řádků (ceny za kus mohou vyjít na haléře), takže součet v nabídce i na stavové stránce vždy sedí.';

  return [
    h('div', { class: 'zakryt', onclick: zavri }),
    h('aside', { class: 'detail' },
      h('div', { style: 'display:flex;align-items:baseline;gap:var(--space-3)' },
        h('span', { style: 'font-size:13px;letter-spacing:0.06em;color:var(--muted)' }, z.cislo),
        h('span', { style: 'font-size:12px;color:var(--muted)' }, 'zdroj: ' + z.zdroj),
        h('button', { class: 'btn btn-ghost', style: 'margin-left:auto', onclick: zavri }, 'Zavřít ✕')),
      h('div', { style: 'display:flex;align-items:baseline;gap:var(--space-3);flex-wrap:wrap;margin:var(--space-1) 0 var(--space-4)' },
        h('h2', { style: 'margin:0' }, z.zakaznik),
        muzeMenit() && h('button', { class: 'btn btn-secondary', style: 'padding:4px 9px',
          onclick: async () => { S.open = null; S.detail = null; await otevriVyrobu('planovani', z.cislo); } }, 'Plánovat výrobu'),
        // Rychlá akce: skoč rovnou na odpověď, ať se nemusí scrollovat přes
        // ceník, přílohy a historii až ke konverzaci dole v detailu.
        muzeMenit() && h('button', { class: 'btn btn-secondary', style: 'padding:4px 9px',
          onclick: () => {
            S.rezim = 'odpoved'; vykresli();
            setTimeout(() => { const el = $('#draft'); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus(); } }, 0);
          } }, 'Odpovědět'),
        muzeMenit() && h('div', { style: 'display:inline-flex;border-radius:var(--radius-sm);overflow:hidden;border:1px solid var(--line)',
            title: 'Sledování výroby: „Automat" znamená, že sloupec na tabuli hlídá appka podle stavu tiskových úloh. „Ruční" znamená, že se sloupec sám nemění (typicky po ručním přetažení karty).' },
          h('button', { class: 'prepinac' + (z.stavAuto ? ' zap teal' : ''), style: 'border:0;border-radius:0',
            onclick: () => poleZakazky({ stavAuto: true }) }, 'Automat'),
          h('button', { class: 'prepinac' + (!z.stavAuto ? ' zap' : ''), style: 'border:0;border-radius:0;border-left:1px solid var(--line)',
            onclick: () => poleZakazky({ stavAuto: false }) }, 'Ruční'))),

      h('div', { class: 'detail-pole' },
        h('label', {}, 'Stav',
          h('select', { class: 'input', disabled: !muzeMenit(),
              onchange: e => presun(z.cislo, e.target.value) },
            S.sloupce.map(c => h('option', { value: c.klic, selected: c.klic === z.stav }, c.nazev)))),
        h('label', {}, 'Přiřazeno',
          h('select', { class: 'input', onchange: e => poleZakazky({ prirazeno: e.target.value }) },
            [h('option', { value: '', selected: !z.prirazeno }, 'Nepřiřazeno'),
             ...S.uzivatele.filter(u => u.role !== 'cteni' && u.aktivni)
               .map(u => h('option', { value: u.klic, selected: u.klic === z.prirazeno }, u.jmeno))])),
        h('label', {}, 'Priorita',
          h('select', { class: 'input', onchange: e => poleZakazky({ priorita: e.target.value }) },
            [h('option', { value: 'auto', selected: !z.prioritaRucne }, 'automaticky (' + p.label + ')'),
             ...Object.keys(PRIO).filter(x => x !== 'zadna').map(x =>
               h('option', { value: x, selected: z.prioritaRucne && x === z.priorita }, PRIO[x].label + ' — ručně'))])),
        h('label', {}, 'Termín dodání',
          h('input', { class: 'input', type: 'date', value: z.termin,
            onchange: e => poleZakazky({ termin: e.target.value }) }))),

      h('div', { style: 'font-size:15px;color:var(--muted-2);margin-bottom:var(--space-3)' },
        'Potřeba ' + hod(z.potreba) + ' h (tisk ' + hod(z.hodinyTisku) + ' + schnutí ' + hod(z.hodinySchnuti)
        + ' + manipulace ' + hod(z.hodinyManipulace)
        + (koop.length ? ' + kooperace ' + hod(koop.reduce((a, o) => a + o.hodiny, 0)) : '')
        + ') · rezerva ' + hod(rezerva) + ' h → ' + p.label
        + (z.prioritaRucne ? ' · priorita nastavena ručně' : '')
        + ' · ' + z.jobs + ' tiskové úlohy' + (z.tiskarna ? ' · ' + z.tiskarna : '')),

      (z.modelyChybi || z.nedorucitelny) && h('div', { class: 'varovani' },
        z.modelyChybi ? 'Modely chybí — nahrávání z kalkulátoru se nepovedlo, vyžádej soubory.'
        : 'E-mail se zákazníkovi nedoručil — ověř adresu, odpověď nepřijde.'),

      /* 01 — Zákazník */
      sekce('01 — Zákazník'),
      h('div', { style: 'font-size:16px;margin-bottom:var(--space-4)' },
        h('div', {}, z.zakJmeno + (z.zakIco ? ' · IČO ' + z.zakIco : '')),
        h('div', {},
          z.zakEmail ? h('a', { href: 'mailto:' + z.zakEmail }, z.zakEmail) : '—',
          ' · ',
          z.zakTelefon ? h('a', { href: 'tel:' + z.zakTelefon.replace(/\s/g, '') }, z.zakTelefon) : '—'),
        z.poznamkaZak && h('div', { style: 'margin-top:var(--space-2);color:var(--muted-2);max-width:62ch' },
          '„' + z.poznamkaZak + '"')),
      panelFirmy(z),

      /* 02 — Položky */
      sekce('02 — Položky zakázky'),
      h('div', { class: 'scroll-x' },
        h('table', { class: 'table table-kompakt', style: 'width:100%;min-width:520px;margin-bottom:var(--space-3)' },
          h('thead', {}, h('tr', {},
            h('th', {}, 'Soubor'), h('th', {}, 'Rozměry (mm)'),
            h('th', { style: 'text-align:right' }, 'Objem (cm³)'),
            h('th', { style: 'text-align:right' }, 'Ks'),
            h('th', {}, 'Tiskárna'), h('th', {}, 'Materiál'),
            h('th', { style: 'text-align:right' }, 'Cena/ks'))),
          h('tbody', {}, z.polozky.map(it => h('tr', {},
            h('td', {}, it.nazev),
            h('td', { style: 'color:var(--muted-2)' }, it.bbox.map(x => Math.round(x)).join(' × ')),
            h('td', { style: 'text-align:right' }, String(it.objem).replace('.', ',')),
            h('td', { style: 'text-align:right' },
              muzeMenit()
                ? h('input', { class: 'input', type: 'number', min: '1', value: it.pocet,
                    style: 'width:52px;padding:3px 4px;text-align:right',
                    onchange: async e => {
                      const v = Math.max(1, parseInt(e.target.value, 10) || 1);
                      try { await api('pocet', { cislo: z.cislo, polozka: it.id, pocet: v }); await obnov(); }
                      catch (err) { hlas(err); }
                    } })
                : String(it.pocet)),
            h('td', {},
              muzeMenit()
                ? (() => {
                    const aktivni = (S.tiskarny || []).filter(t => t.aktivni);
                    const shoda = aktivni.some(t => t.nazev === it.tiskarnaNazev);
                    return h('select', { class: 'input', style: 'width:128px;padding:3px 4px;font-size:13px',
                        onchange: async e => {
                          // materiál se přebírá jen když ho nová tiskárna taky umí — jinak
                          // by třeba u SLS zůstalo nesmyslně "PLA" ze staré FDM tiskárny
                          const nova = (S.tiskarny || []).find(t => t.nazev === e.target.value);
                          const moznosti = nova ? (nova.materialyLabels || []) : [];
                          const material = moznosti.includes(it.material) ? it.material : (moznosti[0] || '');
                          try { await api('polozka-tech', { cislo: z.cislo, polozka: it.id,
                            tiskarnaNazev: e.target.value, material }); await obnov(); }
                          catch (err) { hlas(err); }
                        } },
                      (!shoda ? [h('option', { value: it.tiskarnaNazev || '', selected: true },
                          it.tiskarnaNazev ? it.tiskarnaNazev + (it.tech ? ' · ' + it.tech : '') + ' (nespárováno)' : '— nevybráno —')] : [])
                        .concat(aktivni.map(t => h('option', { value: t.nazev, selected: t.nazev === it.tiskarnaNazev }, t.nazev + ' · ' + t.tech))));
                  })()
                : (it.tiskarnaNazev || '—') + (it.tech ? ' · ' + it.tech : '')),
            h('td', {},
              muzeMenit()
                ? (() => {
                    const t = (S.tiskarny || []).find(x => x.nazev === it.tiskarnaNazev);
                    const moznosti = t ? (t.materialyLabels || []) : [];
                    const shoda = moznosti.some(m => m === it.material);
                    return h('select', { class: 'input', style: 'width:76px;padding:3px 4px;font-size:13px',
                        onchange: async e => {
                          try { await api('polozka-tech', { cislo: z.cislo, polozka: it.id,
                            tiskarnaNazev: it.tiskarnaNazev || '', material: e.target.value }); await obnov(); }
                          catch (err) { hlas(err); }
                        } },
                      (!shoda ? [h('option', { value: it.material || '', selected: true },
                          it.material || '— nevybráno —')] : [])
                        .concat(moznosti.map(m => h('option', { value: m, selected: m === it.material }, m))));
                  })()
                : (it.material || '—')),
            h('td', { style: 'text-align:right' }, kcd(it.cenaKus))))))),

      /* 03 — Kalkulace */
      h('div', { class: 'panel', style: 'max-width:460px;margin-bottom:var(--space-3);padding:var(--space-4)' },
        h('h4', { class: 'kicker', style: 'border:0;padding:0' }, '03 — Cenová kalkulace'),
        h('div', { style: 'display:grid;grid-template-columns:1fr auto;gap:4px var(--space-4);font-size:15px' },
          radky.flatMap(([label, value, silne]) => [
            h('div', { style: 'color:' + (silne ? 'var(--ink)' : 'var(--muted-2)') + ';font-weight:' + (silne ? 600 : 400) }, label),
            h('div', { style: 'text-align:right;color:' + (silne ? 'var(--ink)' : 'var(--muted-2)') + ';font-weight:' + (silne ? 600 : 400) }, value)])),
        upravena && h('div', { style: 'font-size:14px;color:var(--muted-2);margin-top:var(--space-2);max-width:48ch' },
          'Rozpad z kalkulátoru (materiál, strojní čas, dokončení, sleva) po ruční úpravě už neplatí — cena se počítá z položek. Plný přepočet udělá kalkulátor.')),

      muzeMenit() && h('div', { style: 'display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2);margin-bottom:var(--space-6)' },
        h('input', { class: 'input', id: 'prebitCena', placeholder: 'Přebít cenu s DPH',
          style: 'width:170px;padding:5px 8px' }),
        h('input', { class: 'input', id: 'prebitDuvod', placeholder: 'Důvod (uloží se jako interní poznámka)',
          style: 'flex:1;min-width:200px;padding:5px 8px' }),
        h('button', { class: 'btn btn-secondary', onclick: async () => {
          const castka = $('#prebitCena').value, duvod = $('#prebitDuvod').value;
          if (!castka.trim()) return;
          try { await api('prebit-cenu', { cislo: z.cislo, castka, duvod }); await obnov(); }
          catch (e) { hlas(e); }
        } }, 'Uložit cenu')),

      h('div', { style: 'font-size:14px;color:var(--muted);max-width:66ch;margin-bottom:var(--space-3)' }, cenaPozn),

      upravena && z.stav !== 'prijato' && h('div', {
          style: 'background:var(--red-100);color:var(--red);padding:var(--space-3);margin-bottom:var(--space-6);display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-3)' },
        h('span', { style: 'font-size:15px;max-width:52ch' },
          'Cena zakázky se změnila po odeslání nabídky'
          + (z.cenaPuvodni !== null ? ' (z kalkulátoru bylo ' + kc(z.cenaPuvodni) + ')' : ' (změna počtu kusů)')
          + '. Pošli opravenou nabídku — stavová stránka ukazuje aktuální cenu, e-mail v zákazníkově schránce ne.'),
        muzeMenit() && h('button', { class: 'btn btn-secondary', onclick: () => {
          S.rezim = 'odpoved';
          S.draft = 'Dobrý den ' + z.zakJmeno + ',\nomlouváme se, posíláme upravenou nabídku na zakázku '
            + z.cislo + ': ' + kc(k.celkem) + ' s DPH, termín ' + dm(z.termin).replace(/\.$/, '')
            + '.\nDůvod úpravy: ' + (z.cenaDuvod || 'neuveden') + '.';
          vykresli();
        } }, 'Napsat opravenou nabídku')),

      /* 04 — Konfigurace */
      sekce('04 — Konfigurace tisku'),
      konfiguraceTisku(z, koop),

      koop.length > 0 && kooperace(z, koop),

      /* 05 — Modely */
      sekce('05 — Modely a přílohy'),
      modelyPrilohy(z),

      /* 06 — Konverzace */
      sekce('06 — Konverzace'),
      konverzace(z),
      muzeMenit() && odpovedni(z),

      /* 07 — Historie */
      sekce('07 — Historie změn'),
      historieZmen(z))];
}

function konfiguraceTisku(z, koop) {
  const k = z.konfigurace || {};
  if (!muzeMenit()) {
    return h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:var(--space-2) var(--space-4);font-size:14px;margin-bottom:var(--space-6)' },
      [['Technologie', k.tech], ['Materiál', k.material],
       ['Barva', k.barva || '—'], ['Povrchová úprava', k.uprava || '—'],
       ['Rychlost', k.rychlost || '—'], ['Výplň', k.vypln || '—'],
       ['Dokončení', (k.dokonceni || []).join(', ') || '—'],
       ['Tiskárna', z.tiskarna || '—'], ['Tiskové úlohy', String(z.jobs)],
       ['Výroba', koop.length ? 'částečně externě (' + koop.length + ' operace)' : 'celá u nás']]
        .map(([label, value]) => h('div', {},
          h('span', { style: 'color:var(--muted)' }, label), h('br'), String(value || '—'))));
  }

  const techy = [...new Set((S.tiskarny || []).filter(t => t.aktivni).map(t => t.tech))];
  if (k.tech && !techy.includes(k.tech)) techy.push(k.tech);

  const tiskarnyAktivni = (S.tiskarny || []).filter(t => t.aktivni);
  const tiskarnaShoda = tiskarnyAktivni.some(t => t.nazev === z.tiskarna);

  const pole = (label, input) => h('label', { style: 'display:flex;flex-direction:column;gap:3px;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted)' },
    label, input);
  const textInput = (klic, hodnota) => h('input', { class: 'input', value: hodnota || '', style: 'font-size:14px;padding:5px 8px;text-transform:none;letter-spacing:0',
    onchange: e => konfiguraceUloz({ [klic]: e.target.value }) });

  return h('div', {},
    h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:var(--space-3) var(--space-4);font-size:14px;margin-bottom:var(--space-3)' },
      pole('Technologie', h('select', { class: 'input', style: 'font-size:14px;padding:5px 8px;text-transform:none;letter-spacing:0',
          onchange: e => konfiguraceUloz({ tech: e.target.value }) },
        techy.map(t => h('option', { value: t, selected: t === k.tech }, t)))),
      pole('Materiál', textInput('material', k.material)),
      pole('Barva', textInput('barva', k.barva)),
      pole('Povrchová úprava', textInput('uprava', k.uprava)),
      pole('Rychlost', textInput('rychlost', k.rychlost)),
      pole('Výplň', textInput('vypln', k.vypln)),
      pole('Dokončení', textInput('dokonceni', (k.dokonceni || []).join(', '))),
      pole('Tiskárna (souhrn)', h('select', { class: 'input', style: 'font-size:14px;padding:5px 8px;text-transform:none;letter-spacing:0',
          onchange: e => konfiguraceUloz({ tiskarna: e.target.value }) },
        (!tiskarnaShoda ? [h('option', { value: z.tiskarna || '', selected: true }, z.tiskarna || '— nevybráno —')] : [])
          .concat(tiskarnyAktivni.map(t => h('option', { value: t.nazev, selected: t.nazev === z.tiskarna }, t.nazev + ' · ' + t.tech))))),
      pole('Tiskové úlohy', h('input', { class: 'input', type: 'number', min: '1', value: String(z.jobs),
        style: 'font-size:14px;padding:5px 8px',
        onchange: e => konfiguraceUloz({ jobs: Math.max(1, parseInt(e.target.value, 10) || 1) }) })),
      pole('Výroba', h('div', { style: 'font-size:14px;padding:5px 0;text-transform:none;letter-spacing:0' },
        koop.length ? 'částečně externě (' + koop.length + ' operace)' : 'celá u nás'))),
    h('div', { style: 'font-size:13px;color:var(--muted);max-width:60ch;margin-bottom:var(--space-6)' },
      'Souhrnná konfigurace ze zakázky — u konkrétních dílů se tiskárna a materiál mění výš v Položkách (řádek dílu).'));
}

function historieZmen(z) {
  const zmeny = z.historieZmen || [];
  if (!zmeny.length) return h('div', { style: 'color:var(--muted);font-style:italic' }, 'Zatím žádné změny.');
  return h('div', { style: 'margin-bottom:var(--space-6)' },
    h('button', {
      style: 'background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--teal);padding:7px 12px;cursor:pointer;font-family:var(--font-heading);font-weight:600;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;color:var(--teal)',
      onclick: () => { S.histOpen = !S.histOpen; vykresli(); },
    }, (S.histOpen ? 'Skrýt' : 'Zobrazit') + ' (' + zmeny.length + ')'),
    S.histOpen && h('div', { style: 'border:1px solid var(--line);border-top:0;padding:var(--space-3) var(--space-4)' },
      h('div', { style: 'display:flex;flex-direction:column' }, zmeny.map(x =>
        h('div', { style: 'display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--space-2);padding:7px 0;border-bottom:1px solid var(--line)' },
          h('span', { style: 'font-size:14px;color:var(--muted);white-space:nowrap' }, dt(x.kdy)),
          h('span', { style: 'font-size:14px;color:var(--muted-2);white-space:nowrap' }, x.kdo),
          h('span', { style: 'font-size:15px;flex:1;min-width:180px' }, x.co.replace(' — ' + x.kdo, '')),
          x.lzeVratit && muzeMenit() && h('button', { class: 'btn btn-ghost', style: 'padding:2px 8px',
            onclick: async () => {
              if (!await potvrdit('Vrátit změnu?', 'Vrátit zakázku do stavu před touto změnou? Novější změny se zahodí.', 'Vrátit')) return;
              try { await api('vratit', { cislo: z.cislo, historie: x.id }); await obnov(); } catch (e) { hlas(e); }
            } }, 'Vrátit sem')))),
      h('div', { style: 'font-size:14px;color:var(--muted);margin-top:var(--space-2);max-width:60ch' },
        '„Vrátit sem" obnoví stav, počet kusů, ceny, termín, přiřazení i kooperaci tak, jak byly před tou změnou; novější změny se zahodí a do konverzace přijde záznam.')));
}

function panelFirmy(z) {
  const f = z.firma;
  const hist = z.historieZakaznika || [];
  const suma = hist.reduce((a, x) => a + x.celkem, 0);
  return h('div', { class: 'panel', style: 'margin-bottom:var(--space-6)' },
    h('div', { style: 'display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--space-2)' },
      h('span', { style: 'font-family:var(--font-heading);font-weight:600;font-size:13px;letter-spacing:0.14em;text-transform:uppercase;color:var(--teal)' },
        f ? f.nazev : z.zakaznik),
      h('span', { style: 'font-size:14px;color:var(--muted-2)' },
        f ? ((f.ico ? 'IČO ' + f.ico + ' · ' : '') + kontakty(f.kontakty.length)
             + (f.sleva ? ' · sleva firmy ' + f.sleva + ' %' : '')) : ''),
      f && h('button', { class: 'btn btn-ghost', style: 'margin-left:auto;padding:2px 8px',
        onclick: async () => { S.firmaKlic = f.klic; S.open = null; S.detail = null; await prepniPohled('customers'); }
      }, 'Karta firmy')),

    hist.length === 0
      ? h('div', { style: 'font-size:15px;color:var(--muted-2);margin-top:var(--space-1)' },
          'Nový zákazník — pod touto firmou u nás dosud nic netiskl.')
      : h('div', { style: 'margin-top:var(--space-2)' },
          h('button', {
            style: 'background:none;border:0;padding:0;cursor:pointer;font-size:15px;color:var(--teal-700);text-align:left',
            onclick: () => { S.histZakOpen = !S.histZakOpen; vykresli(); },
          }, (S.histZakOpen ? '▾ ' : '▸ ') + hist.length + '× u nás tiskl · dohromady ' + kc(suma)
             + ' · naposledy ' + dm(hist[0].termin)),
          S.histZakOpen && h('div', { class: 'scroll-x', style: 'margin-top:var(--space-2)' },
            h('table', { class: 'table', style: 'width:100%;min-width:520px' },
              h('thead', {}, h('tr', {}, h('th', {}, 'Zakázka'), h('th', {}, 'Co jsme tiskli'),
                h('th', {}, 'Termín'), h('th', { style: 'text-align:right' }, 'Cena'), h('th', {}, 'Stav'))),
              h('tbody', {}, hist.map(x => h('tr', { style: 'cursor:pointer', onclick: () => otevri(x.cislo) },
                h('td', { style: 'white-space:nowrap;color:var(--muted)' }, x.cislo),
                h('td', {}, x.co),
                h('td', { style: 'white-space:nowrap' }, dm(x.termin)),
                h('td', { style: 'text-align:right;white-space:nowrap' }, kc(x.celkem)),
                h('td', {}, nazevSloupce(x.stav)))))))));
}

function kooperace(z, koop) {
  return h('div', {},
    h('h4', { class: 'kicker' }, 'Externí kooperace'),
    h('div', { style: 'display:flex;flex-direction:column;gap:var(--space-3);margin-bottom:var(--space-3)' },
      koop.map(o => h('div', { style: 'display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2) var(--space-3)' },
        h('div', { style: 'min-width:190px' },
          h('div', { style: 'font-family:var(--font-heading);font-weight:600;font-size:16px' }, o.co),
          h('div', { style: 'font-size:12px;color:var(--muted)' }, 'z ceníku · ' + o.zdroj)),
        h('input', { class: 'input', value: o.partner, placeholder: 'partner',
          style: 'width:170px;padding:4px 8px', disabled: !muzeMenit(),
          onchange: async e => {
            try { await api('koop-partner', { cislo: z.cislo, operace: o.key, partner: e.target.value }); await obnov(); }
            catch (err) { hlas(err); } } }),
        h('div', { style: 'font-size:13px;color:var(--muted-2)' },
          dny(o.lhutaDnu) + ' u partnera · doprava ' + dny(o.dopravaDnu) + ' tam i zpět'),
        h('span', { style: 'font-size:13px;padding:3px 8px;border-radius:var(--radius-md);background:'
          + (o.stav === 'vraceno' ? 'var(--teal-100)' : 'var(--line)') + ';color:'
          + (o.stav === 'vraceno' ? 'var(--teal-700)' : 'var(--ink)') }, o.stavLabel),
        o.dalsi && muzeMenit() && h('button', { class: 'btn btn-secondary', style: 'padding:3px 10px',
          onclick: async () => {
            try { await api('koop-krok', { cislo: z.cislo, operace: o.key }); await obnov(); } catch (e) { hlas(e); }
          } }, o.dalsi)))),
    h('div', { style: 'font-size:13px;color:var(--muted-2);max-width:66ch;margin-bottom:var(--space-6)' },
      'Příznak interní / externí výroba je u každého materiálu a postprocesu v pricing.json — kanban ho jen čte. Zákazník partnera nikdy neuvidí; doprava a lhůta partnera se počítají do potřeby hodin, a tím do priority.'));
}

function modelyPrilohy(z) {
  const nahraj = async (fileList) => {
    const soubory = Array.from(fileList || []);
    if (!soubory.length) return;
    const fd = new FormData();
    fd.append('cislo', z.cislo);
    soubory.forEach(f => fd.append('soubory[]', f));
    S.dropAktivni = false;
    try {
      const r = await fetch('api.php?a=priloha-nahraj', {
        method: 'POST', body: fd, credentials: 'same-origin',
        headers: S.csrf ? { 'X-CSRF-Token': S.csrf } : {},
      });
      let v = null; try { v = await r.json(); } catch { /* nechá null */ }
      if (!r.ok || !v || v.ok === false) throw new Error((v && v.chyba) || ('Chyba ' + r.status));
      await obnov();
    } catch (e) { hlas(e); }
  };

  return h('div', { style: 'display:flex;flex-direction:column;gap:var(--space-2);font-size:14px;margin-bottom:var(--space-6)' },
    z.soubory.map(f => {
      const potvrzuje = S.smazPriloha === f.id;
      return h('div', { style: 'display:flex;flex-wrap:wrap;align-items:baseline;gap:4px var(--space-2)' },
        h('a', { href: 'soubor.php?id=' + f.id }, f.nazev),
        h('span', { style: 'color:var(--muted);font-size:13px' }, mb(f.velikost) + (f.typ ? ' · ' + f.typ : '')),
        f.pridal && h('span', { style: 'color:var(--muted);font-size:13px' },
          '· ' + f.pridal + (f.kdy ? ' ' + dt(f.kdy) : '')),
        muzeMenit() && !potvrzuje && h('button', { class: 'btn btn-ghost', style: 'padding:1px 6px;font-size:12px',
          onclick: () => { S.smazPriloha = f.id; vykresli(); } }, 'Odebrat'),
        muzeMenit() && potvrzuje && h('span', {
            style: 'display:inline-flex;flex-wrap:wrap;align-items:baseline;gap:var(--space-2);font-size:13px;color:var(--red)' },
          'Odebrat přílohu?',
          h('button', { class: 'btn btn-ghost', style: 'padding:1px 6px;font-size:12px;color:var(--red)',
            onclick: async () => {
              S.smazPriloha = null;
              try { await api('priloha-smaz', { cislo: z.cislo, soubor: f.id }); await obnov(); } catch (e) { hlas(e); }
            } }, 'Ano, odebrat'),
          h('button', { class: 'btn btn-ghost', style: 'padding:1px 6px;font-size:12px',
            onclick: () => { S.smazPriloha = null; vykresli(); } }, 'Zrušit')));
    }),
    z.modelyChybi && h('div', { style: 'color:var(--red)' }, 'Modely chybí — nahrávání z kalkulátoru se nepovedlo.'),
    !z.modelyChybi && z.soubory.length === 0 && h('div', { style: 'color:var(--muted)' }, 'Žádné soubory.'),

    muzeMenit() && h('div', {
        style: 'display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2) var(--space-3);border:1px dashed '
          + (S.dropAktivni ? 'var(--teal)' : 'var(--line)') + ';background:'
          + (S.dropAktivni ? 'var(--teal-100)' : 'var(--panel)') + ';padding:var(--space-3);margin-top:var(--space-1)',
        ondragover: e => { e.preventDefault(); if (!S.dropAktivni) { S.dropAktivni = true; vykresli(); } },
        ondragleave: e => { if (e.currentTarget.contains(e.relatedTarget)) return;
          if (S.dropAktivni) { S.dropAktivni = false; vykresli(); } },
        ondrop: e => { e.preventDefault(); S.dropAktivni = false; nahraj(e.dataTransfer.files); } },
      h('label', { class: 'btn btn-secondary', style: 'cursor:pointer;padding:6px 14px' }, 'Vybrat soubory',
        h('input', { type: 'file', multiple: true, style: 'display:none',
          onchange: e => { nahraj(e.target.files); e.target.value = ''; } })),
      h('span', { style: 'font-size:13px;color:var(--muted-2)' },
        'nebo přetažením sem — tiskové podklady, faktury od partnerů, doklady, fotky (do 200 MB)')));
}

// Ořízne citaci předchozího mailu (řádky „> …", hlavičky typu „Dne … napsal(a):",
// „-----Původní zpráva-----", outlookový podtržítkový oddělovač). Vrací zkrácený text.
function orizniCitaci(telo) {
  const radky = String(telo).replace(/\r\n/g, '\n').split('\n');
  const marker = r =>
    /^\s*>/.test(r) ||
    /^\s*(Dne|On)\b.*(napsal|napsala|napsal\(a\)|wrote)\s*:?\s*$/i.test(r) ||
    /napsal\(a\):\s*$/i.test(r) ||
    /^\s*-{2,}\s*(Původní zpráva|Original Message|Forwarded message|Přeposlaná zpráva)/i.test(r) ||
    /^_{10,}\s*$/.test(r) ||
    /^\s*(Od|From)\s*:\s*.+<.+@.+>/.test(r);
  let i = radky.findIndex(marker);
  if (i <= 0) return String(telo).replace(/\n{3,}/g, '\n\n').trimEnd();
  return radky.slice(0, i).join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

function konverzace(z) {
  const tag = { prichozi: 'zákazník', odchozi: 'my', interni: 'interní' };
  return h('div', { style: 'display:flex;flex-direction:column;gap:var(--space-2);margin-bottom:var(--space-4)' },
    z.zpravy.length === 0 && h('div', { style: 'font-size:14px;color:var(--muted)' }, 'Zatím žádná zpráva.'),
    z.zpravy.map(m => {
      if (m.typ === 'system') return h('div', {
        style: 'align-self:center;font-size:12px;color:var(--muted);text-align:center;padding:2px var(--space-3)' },
        m.telo + ' — ' + dt(m.kdy));

      const nase = m.typ === 'odchozi';
      const interni = m.typ === 'interni';
      const plny = !!S.citaceZpravy[m.id];
      const orez = interni ? m.telo : orizniCitaci(m.telo);
      const jeCitace = !interni && orez !== String(m.telo).replace(/\n{3,}/g, '\n\n').trimEnd();
      const bg = interni ? 'var(--red-100)' : nase ? 'var(--teal-100)' : 'var(--panel)';
      const fg = interni ? 'var(--red)' : nase ? 'var(--teal-700)' : 'var(--ink)';
      const lzeOdpojit = m.typ === 'prichozi' && muzeMenit();

      return h('div', { style: 'align-self:' + (nase ? 'flex-end' : interni ? 'stretch' : 'flex-start')
          + ';max-width:' + (interni ? '100%' : '80%') + ';min-width:0' },
        h('div', { style: 'background:' + bg + ';border-radius:12px;padding:var(--space-2) var(--space-3)'
            + (nase ? ';border-bottom-right-radius:3px' : interni ? '' : ';border-bottom-left-radius:3px') },
          h('div', { style: 'display:flex;align-items:baseline;gap:var(--space-2);font-size:12px;color:var(--muted-2);margin-bottom:3px' },
            h('span', { style: 'color:' + fg + ';font-weight:600' }, tag[m.typ] || ''),
            m.od && h('span', { style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, m.od),
            h('span', { style: 'margin-left:auto;white-space:nowrap' }, dt(m.kdy))),
          h('div', { style: 'font-size:14px;white-space:pre-wrap;word-break:break-word' },
            plny ? m.telo : orez),
          jeCitace && h('button', { class: 'btn btn-ghost',
            style: 'padding:1px 4px;font-size:12px;margin-top:3px;border:0',
            onclick: () => { S.citaceZpravy = Object.assign({}, S.citaceZpravy, { [m.id]: !plny }); vykresli(); } },
            plny ? '▴ skrýt citovaný e-mail' : '▾ zobrazit celý e-mail'),
          lzeOdpojit && h('div', { style: 'display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--space-2);margin-top:4px;font-size:12px;color:var(--muted)' },
            h('span', {}, 'spárováno: ' + (m.parovani || 'ručně')),
            h('button', { class: 'btn btn-ghost', style: 'padding:1px 4px;font-size:12px;border:0;color:var(--teal-700)',
              onclick: async () => {
                if (!await potvrdit('Odpojit zprávu?', 'Odpojit tuto zprávu od zakázky ' + z.cislo + ' a vrátit ji do Nezařazeno?', 'Odpojit')) return;
                try { await api('zprava-odpoj', { cislo: z.cislo, zprava: m.id }); await obnov(); }
                catch (e) { hlas(e); }
              } }, 'odpojit → Nezařazeno'))));
    }));
}

function odpovedni(z) {
  const interni = S.rezim === 'interni';
  return h('div', {},
    h('div', { style: 'display:flex;flex-wrap:wrap;gap:var(--space-2);margin-bottom:var(--space-2)' },
      h('button', { style: prepinacStyl(!interni, 'teal'),
        onclick: () => { S.rezim = 'odpoved'; vykresli(); } }, 'Odpověď zákazníkovi'),
      h('button', { style: prepinacStyl(interni, 'red'),
        onclick: () => { S.rezim = 'interni'; vykresli(); } }, 'Interní poznámka'),
      h('select', { class: 'input', style: 'padding:5px 8px;margin-left:auto',
        onchange: e => {
          const t = (S.sablonyCache || []).find(x => x.klic === e.target.value);
          if (!t) return;
          const kal = z.kalkulace || {};
          S.rezim = 'odpoved';
          S.draft = t.telo
            .replaceAll('{jmeno}', z.zakJmeno).replaceAll('{cislo}', z.cislo)
            .replaceAll('{cena}', kc(kal.celkem || 0))
            .replaceAll('{termin}', dm(z.termin).replace(/\.$/, ''))
            .replaceAll('{odkaz}', z.stavovaUrl || '');
          S.draftPredmet = t.predmet.replaceAll('{cislo}', z.cislo).replaceAll('{jmeno}', z.zakJmeno);
          vykresli();
        } },
        [h('option', { value: '' }, 'Vložit šablonu…'),
         ...(S.sablonyCache || []).map(t => h('option', { value: t.klic }, t.nazev))])),

    h('textarea', { class: 'input', id: 'draft', rows: '4', value: S.draft,
      placeholder: interni ? 'Interní poznámka — zákazník ji nikdy neuvidí' : 'Odpověď zákazníkovi…',
      style: 'width:100%;padding:var(--space-2);resize:vertical;background:' + (interni ? 'var(--red-100)' : 'var(--bg)'),
      oninput: e => { S.draft = e.target.value; } }),

    h('div', { style: 'display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-3);margin-top:var(--space-2)' },
      h('button', { class: 'btn btn-primary', onclick: async () => {
        const telo = $('#draft').value.trim();
        if (!telo) return;
        try {
          const v = await api('zprava', { cislo: z.cislo, rezim: S.rezim, telo,
            predmet: S.draftPredmet || ('Re: Nabídka na tisk') });
          S.draft = ''; S.draftPredmet = '';
          await obnov();
          if (v.poznamka) hlas(new Error(v.poznamka));
        } catch (e) { hlas(e); }
      } }, interni ? 'Uložit poznámku' : 'Odeslat e-mail'),
      h('span', { style: 'font-size:14px;color:var(--muted)' },
        interni ? 'Zůstane jen v systému, podepsáno ' + S.user.jmeno + '.'
                : 'Předmět „Re: … [' + z.cislo + ']", odpověď se sama připojí k této zakázce.')));
}

function prepinacStyl(aktivni, barva) {
  const bg = aktivni ? (barva === 'red' ? 'var(--red-100)' : 'var(--teal-100)') : 'var(--line)';
  const fg = aktivni ? (barva === 'red' ? 'var(--red)' : 'var(--teal-700)') : 'var(--muted-2)';
  return 'background:' + bg + ';color:' + fg + ';border:0;border-radius:var(--radius-md);padding:5px 10px;cursor:pointer;font-size:13px';
}

/* ---------- Seznam ---------- */

function obrazovkaSeznam() {
  const razeni = {
    cislo:    (a, b) => a.cislo.localeCompare(b.cislo),
    zakaznik: (a, b) => a.zakaznik.localeCompare(b.zakaznik, 'cs'),
    termin:   (a, b) => D(a.termin) - D(b.termin),
    cena:     (a, b) => b.celkem - a.celkem,
    priorita: (a, b) => PRIO[a.priorita].rank - PRIO[b.priorita].rank,
    stav:     (a, b) => a.stav.localeCompare(b.stav),
  };
  const list = S.zakazky.filter(z => projde(z) && (!S.fStav || z.stav === S.fStav))
                        .sort(razeni[S.razeni] || razeni.termin);
  const suma = list.reduce((a, z) => a + z.celkem, 0);

  const hlavicky = [['cislo', 'Číslo', 'left'], ['zakaznik', 'Zákazník', 'left'], ['stav', 'Stav', 'left'],
    ['priorita', 'Priorita', 'left'], ['termin', 'Termín dodání', 'left'],
    ['cena', 'Cena s DPH', 'right'], ['kdo', 'Kdo', 'left']];

  return h('div', { class: 'obrazovka' },
    h('div', { style: 'display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--space-3) var(--space-4);margin-bottom:var(--space-3)' },
      h('h3', { style: 'margin:0' }, 'Seznam zakázek'),
      h('input', { id: 'hledaniSeznam', class: 'input', value: S.hledani,
        placeholder: 'Hledat číslo, zákazníka, e-mail, soubor…',
        style: 'width:290px;max-width:100%;padding:6px 10px',
        oninput: e => { S.hledani = e.target.value; vykresli(); } }),
      h('select', { class: 'input', style: 'width:auto;padding:5px 8px',
          onchange: e => { S.fStav = e.target.value; vykresli(); } },
        [h('option', { value: '', selected: !S.fStav }, 'Všechny stavy'),
         ...S.sloupce.map(c => h('option', { value: c.klic, selected: c.klic === S.fStav }, c.nazev))]),
      S.hledani && h('button', { class: 'btn btn-secondary', style: 'padding:3px 10px',
        onclick: () => { S.hledani = ''; vykresli(); } }, 'Zrušit hledání'),
      h('span', { style: 'font-size:15px;color:var(--muted)' }, zakazek(list.length)),
      h('span', { style: 'margin-left:auto;font-size:13px;color:var(--muted)' }, 'Celkem s DPH ' + kc(suma)),
      h('a', { class: 'btn btn-ghost', style: 'text-decoration:none;border:0',
        href: 'api.php?a=export' + (S.fStav ? '&stav=' + encodeURIComponent(S.fStav) : '') }, 'Export CSV')),

    h('div', { class: 'scroll-x' },
      h('table', { class: 'table', style: 'width:100%;min-width:760px' },
        h('thead', {}, h('tr', {}, hlavicky.map(([k, label, align]) =>
          h('th', { style: 'cursor:pointer;text-align:' + align + ';white-space:nowrap',
            onclick: () => { S.razeni = k; vykresli(); } }, label + (S.razeni === k ? ' ↓' : ''))))),
        h('tbody', {}, list.map(z => h('tr', { style: 'cursor:pointer', onclick: () => otevri(z.cislo) },
          h('td', { style: 'white-space:nowrap;color:var(--muted-2)' }, z.cislo),
          h('td', {}, z.zakaznik),
          h('td', {}, nazevSloupce(z.stav)),
          h('td', { style: 'color:' + PRIO[z.priorita].fg }, PRIO[z.priorita].label),
          h('td', { style: 'white-space:nowrap;color:'
            + (z.dnuDoTerminu < 0 && !UZAVRENO.includes(z.stav) ? 'var(--red)' : 'var(--ink)') }, dm(z.termin)),
          h('td', { style: 'text-align:right;white-space:nowrap' }, kc(z.celkem)),
          h('td', {}, jmenoKlice(z.prirazeno) || '—')))))));
}

/* ---------- Výroba: přehled a plánování pod jednou položkou navigace ---------- */

function obrazovkaVyroba() {
  const plan = S.vyrobaObrazovka === 'planovani';
  return h('div', { class: 'obrazovka' },
    h('div', { style: 'display:flex;align-items:baseline;justify-content:space-between;gap:var(--space-3);flex-wrap:wrap;margin-bottom:var(--space-4)' },
      h('div', {}, h('div', { class: 'kicker' }, 'Výroba'),
        h('h3', { style: 'margin:8px 0 0' }, plan ? 'Plánování tiskových úloh' : 'Přehled tiskáren')),
      h('div', { style: 'display:flex;gap:var(--space-2)' },
        h('button', { class: 'btn ' + (!plan ? 'btn-primary' : 'btn-secondary'), onclick: () => otevriVyrobu('prehled') }, 'Přehled'),
        h('button', { class: 'btn ' + (plan ? 'btn-primary' : 'btn-secondary'), onclick: () => otevriVyrobu('planovani') }, 'Plánování'))),
    plan ? obrazovkaPlanovani() : obrazovkaTiskarny());
}

function obrazovkaPlanovani() {
  const stroje = S.vyroba || [];
  if (!stroje.length) return h('div', { class: 'hlaska' }, 'Žádné aktivní stroje. Přidej je v Nastavení.');
  return planovaniScreen();
}

function obrazovkaTiskarny() {
  return prehledTiskarenScreen();
}

/* --- Přehled tiskáren: stav zařízení + detail vybraného stroje --- */

function prehledTiskarenScreen() {
  const stroje = S.vyroba || [];
  const tiskarny = (S.tiskarny || []).filter(t => t.aktivni);
  if (!stroje.length) {
    return h('div', { style: 'padding:var(--space-4)' },
      h('h3', { class: 'kicker' }, 'Tiskárny'),
      tiskarny.length
        ? h('div', { style: 'display:flex;flex-wrap:wrap;gap:var(--space-2);margin-bottom:var(--space-4)' },
            tiskarny.map(t => h('div', { style: 'background:var(--panel);border-left:3px solid var(--teal);padding:var(--space-3);min-width:180px' },
              h('div', { style: 'font-weight:600' }, t.nazev),
              h('div', { style: 'font-size:13px;color:var(--muted-2)' }, t.tech + (t.inHouse ? ' · vlastní výroba' : ' · kooperace')))))
        : h('div', { class: 'hlaska' }, 'V ceníku zatím nejsou žádné aktivní tiskárny.'),
      h('div', { style: 'font-size:15px;color:var(--muted-2)' }, 'Pro zobrazení fronty a plánování přidej u tiskárny fyzický stroj v Nastavení → Tiskárny a stroje.'));
  }
  if (!S.vyrobaStrojId || !stroje.some(s => s.strojId === S.vyrobaStrojId)) S.vyrobaStrojId = stroje[0].strojId;
  const sel = stroje.find(s => s.strojId === S.vyrobaStrojId);

  return h('div', { style: 'display:flex;gap:var(--space-6);padding:var(--space-4);flex-wrap:wrap;align-items:flex-start' },
    h('div', { style: 'flex:1 1 520px;min-width:0' },
      h('h3', { class: 'kicker' }, 'Stav zařízení'),
      h('div', { style: 'display:flex;flex-direction:column' }, stroje.map(s => strojRadek(s, s.strojId === S.vyrobaStrojId)))),
    h('div', { style: 'flex:0 1 380px;min-width:300px' },
      h('h3', { class: 'kicker' }, sel.tiskarna + ' · ' + sel.oznaceni + ' — úlohy'),
      sel.fronta.length === 0
        ? h('div', { style: 'font-size:15px;color:var(--muted);font-style:italic' }, 'Žádné úlohy — zařízení je volné.')
        : h('div', { style: 'display:flex;flex-direction:column;gap:var(--space-2)' },
            sel.fronta.map(u => ulohaKarta(u, sel.strojId)))));
}

function strojRadek(s, aktivni) {
  const bezici = s.fronta.find(u => u.stav === 'tiskne');
  const cekajici = s.fronta.filter(u => u.stav === 'fronta').length;
  const stavLabel = bezici ? 'Tiskne' : (cekajici ? 'Ve frontě' : 'Volné');
  const stavBarva = bezici ? 'var(--teal-700)' : (cekajici ? 'var(--muted-2)' : 'var(--muted)');
  const jobLabel = bezici
    ? (bezici.dily || []).map(d => d.pocet + '× ' + d.nazev).join(', ') + (cekajici ? ' (+' + uloh(cekajici) + ' ve frontě)' : '')
    : (cekajici ? uloh(cekajici) + ' čeká' : '—');

  return h('button', {
      onclick: () => { S.vyrobaStrojId = s.strojId; vykresli(); },
      style: 'appearance:none;text-align:left;cursor:pointer;background:' + (aktivni ? 'var(--teal-100)' : 'var(--bg)')
        + ';border:0;border-bottom:1px solid var(--line);padding:var(--space-2) var(--space-2);'
        + 'display:grid;grid-template-columns:minmax(0,1.3fr) 90px minmax(0,1.6fr) 100px;gap:var(--space-2);align-items:center' },
    h('span', { style: 'display:flex;flex-direction:column;gap:2px;min-width:0' },
      h('span', { style: 'font-weight:600' }, s.tiskarna),
      h('span', { style: 'font-size:13px;color:var(--muted-2)' }, s.oznaceni)),
    h('span', { style: 'font-size:13px;color:' + stavBarva }, stavLabel),
    h('span', { style: 'display:flex;flex-direction:column;gap:4px;min-width:0' },
      h('span', { style: 'font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, jobLabel),
      bezici && bezici.postup !== null && h('span', { style: 'height:4px;background:var(--line);display:block' },
        h('span', { style: 'display:block;height:4px;background:var(--teal);width:' + bezici.postup + '%' }))),
    h('span', { style: 'font-size:13px;color:var(--muted-2);text-align:right' },
      bezici ? dt(bezici.hotovoNejdrive) : (s.hotovoNejdrive ? dt(s.hotovoNejdrive) : '')));
}

/* --- Zakázky a plánování: nepřiřazené díly (drag) → navržené úlohy (drop) --- */

async function nactiPlanovani() {
  const p = await api('planovani');
  S.planPool = p.zakazky.map(g => ({ cislo: g.cislo, zakaznik: g.zakaznik, termin: g.termin, dnuDoTerminu: g.dnuDoTerminu, polozky: g.polozky.map(x => ({ ...x, move: x.pocet })) }));
  S.planJobs = [];
  vykresli();
}

function planFill(job) { return job.polozky.reduce((t, p) => t + p.pocet / p.perjob, 0); }

function planPridejDoPoolu(zakazkaCislo, zakaznik, polozka) {
  let skupina = S.planPool.find(g => g.cislo === zakazkaCislo);
  if (!skupina) { skupina = { cislo: zakazkaCislo, zakaznik, polozky: [] }; S.planPool.push(skupina); }
  const existujici = skupina.polozky.find(p => p.id === polozka.id);
  if (existujici) existujici.pocet += polozka.pocet;
  else skupina.polozky.push({ ...polozka, move: polozka.pocet });
}

function planOdeberZPoolu(polozkaId, pocet) {
  for (const skupina of S.planPool) {
    const idx = skupina.polozky.findIndex(p => p.id === polozkaId);
    if (idx === -1) continue;
    const p = skupina.polozky[idx];
    p.pocet -= pocet;
    if (p.pocet <= 0) skupina.polozky.splice(idx, 1);
    else p.move = Math.max(1, Math.min(p.move || p.pocet, p.pocet));
    break;
  }
  S.planPool = S.planPool.filter(g => g.polozky.length > 0);
}

function planNajdiNeboZalozJob(tiskarnaId, tiskarnaNazev, material, strojId) {
  let job = S.planJobs.find(j => j.strojId === strojId && j.material === material);
  if (!job) { job = { key: 'k' + (++S.planSeq), tiskarnaId, tiskarnaNazev, material, strojId, polozky: [] }; S.planJobs.push(job); }
  return job;
}

function planPridejDoJobu(job, item, pocet) {
  const existujici = job.polozky.find(p => p.id === item.id);
  if (existujici) existujici.pocet += pocet;
  else job.polozky.push({ id: item.id, nazev: item.nazev, perjob: item.perjob, pocet,
    zakazkaCislo: item.zakazkaCislo, zakaznik: item.zakaznik });
}

function tiskarnaTech(tiskarnaId) {
  const t = (S.tiskarny || []).find(x => x.id === tiskarnaId);
  return t ? t.tech : null;
}

function planDropNaStroj(strojId) {
  const item = S.dragItem; S.dragItem = null;
  if (!item) return;
  const stroj = S.stroje.find(s => s.id === strojId);
  if (!stroj) return;
  const techStroje = tiskarnaTech(stroj.tiskarnaId);
  const techDilu = tiskarnaTech(item.tiskarnaId);
  // díl smí na kterýkoli stroj se stejnou technologií (SLS na kterýkoli SLS stroj apod.),
  // nemusí to být přesně ten model, pro který byla zakázka původně naceněná
  if (!techStroje || techStroje !== techDilu) {
    hlas(new Error('Díl je na ' + (techDilu || '?') + ', tenhle stroj je ' + (techStroje || '?') + '.'));
    return;
  }
  const tiskarnaStroje = (S.tiskarny || []).find(t => t.id === stroj.tiskarnaId);
  const job = planNajdiNeboZalozJob(stroj.tiskarnaId, tiskarnaStroje.nazev, item.material, strojId);
  const vezmi = Math.max(1, Math.min(item.move || item.pocet, item.pocet));
  planPridejDoJobu(job, item, vezmi);
  planOdeberZPoolu(item.id, vezmi);
  vykresli();
}

function planDropNaJob(jobKey) {
  const item = S.dragItem; S.dragItem = null;
  if (!item) return;
  const job = S.planJobs.find(j => j.key === jobKey);
  if (!job) return;
  if (tiskarnaTech(job.tiskarnaId) !== tiskarnaTech(item.tiskarnaId) || job.material !== item.material) {
    hlas(new Error('Úloha už obsahuje jinou technologii nebo materiál — patří do vlastní úlohy.'));
    return;
  }
  const vezmi = Math.max(1, Math.min(item.move || item.pocet, item.pocet));
  planPridejDoJobu(job, item, vezmi);
  planOdeberZPoolu(item.id, vezmi);
  vykresli();
}

function planOdeberZJobu(jobKey, polozkaId) {
  const job = S.planJobs.find(j => j.key === jobKey);
  if (!job) return;
  const idx = job.polozky.findIndex(p => p.id === polozkaId);
  if (idx === -1) return;
  const [p] = job.polozky.splice(idx, 1);
  planPridejDoPoolu(p.zakazkaCislo, p.zakaznik, { id: p.id, nazev: p.nazev, material: job.material,
    tiskarnaId: job.tiskarnaId, tiskarnaNazev: job.tiskarnaNazev, pocet: p.pocet, perjob: p.perjob });
  if (job.polozky.length === 0) S.planJobs = S.planJobs.filter(j => j.key !== jobKey);
  vykresli();
}

function planRozdel(jobKey) {
  const job = S.planJobs.find(j => j.key === jobKey);
  if (!job) return;
  const nove = [];
  let cur = { key: 'k' + (++S.planSeq), tiskarnaId: job.tiskarnaId, tiskarnaNazev: job.tiskarnaNazev, material: job.material, strojId: job.strojId, polozky: [] };
  nove.push(cur);
  job.polozky.forEach(item => {
    let rest = item.pocet;
    while (rest > 0) {
      const volno = 1 - planFill(cur);
      const fit = Math.max(0, Math.floor(volno * item.perjob));
      if (fit < 1 && cur.polozky.length > 0) {
        cur = { key: 'k' + (++S.planSeq), tiskarnaId: job.tiskarnaId, tiskarnaNazev: job.tiskarnaNazev, material: job.material, strojId: job.strojId, polozky: [] };
        nove.push(cur);
        continue;
      }
      const vezmi = Math.max(1, Math.min(rest, fit || rest));
      cur.polozky.push({ ...item, pocet: vezmi });
      rest -= vezmi;
    }
  });
  S.planJobs = S.planJobs.filter(j => j.key !== jobKey).concat(nove);
  vykresli();
}

async function planAutoNavrh() {
  const d = await api('navrh');
  const p = await api('planovani');
  S.planPool = p.zakazky.map(g => ({ cislo: g.cislo, zakaznik: g.zakaznik, termin: g.termin, dnuDoTerminu: g.dnuDoTerminu, polozky: g.polozky.map(x => ({ ...x, move: x.pocet })) }));

  // Server navrhuje ze všech nepřiřazených dílů bez ohledu na to, co je zrovna
  // vidět — když má obsluha aktivní hledání/filtr (typicky plánování jedné
  // konkrétní zakázky z detailu), omezíme návrh jen na to, co skutečně vidí.
  // Jinak by "pro vše" tiše naplánovalo i cizí zakázky mimo aktuální pohled.
  const viditelneId = (S.planHledani || S.planFTech)
    ? new Set(planPoolFiltrovana().flatMap(g => g.polozky.map(x => x.id)))
    : null;

  S.planJobs = d.navrhy.map(n => ({
    key: 'k' + (++S.planSeq), tiskarnaId: n.tiskarnaId, tiskarnaNazev: n.tiskarna, material: n.material, strojId: n.strojId,
    polozky: n.polozky
      .filter(p => !viditelneId || viditelneId.has(p.id))
      .map(p => ({ id: p.id, nazev: p.nazev, pocet: p.pocet, perjob: p.perjob, zakazkaCislo: p.zakazkaCislo })),
  })).filter(j => j.polozky.length > 0);
  // pool je čerstvě načtený (obsahuje i díly z návrhu) — odebereme jen to, co jsme
  // opravdu zařadili do úlohy, ať zůstane v poolu i to vyfiltrované mimo návrh
  S.planJobs.forEach(j => j.polozky.forEach(p => planOdeberZPoolu(p.id, p.pocet)));
  const nesparovano = Object.entries(d.nesparovaneTiskarny || {});
  if (nesparovano.length) hlas(new Error('Nespárovaná tiskárna (chybí v registru): ' + nesparovano.map(([n, c]) => n + ' (' + c + ' ks)').join(', ')));
  vykresli();
}

async function planVyprazdnit() { await nactiPlanovani(); }

async function planPotvrdit() {
  // přeplněné desky se nezakazují — reálně se do sliceru někdy vejde víc, než
  // ukáže odhad podle perjob — jen si to obsluha musí vědomě potvrdit
  const pretazene = S.planJobs.filter(j => planFill(j) > 1);
  if (pretazene.length) {
    const ok = await potvrdit(
      'Nevejde se na jednu desku',
      [
        h('p', {}, 'Podle výpočtu se nevejde na jednu desku:'),
        h('ul', { style: 'margin:var(--space-2) 0;padding-left:1.2em' },
          pretazene.map(j => h('li', {}, j.tiskarnaNazev + ' · ' + planStrojOznaceni(j.strojId) + ' — ' + Math.round(planFill(j) * 100) + ' %'))),
        h('p', { class: 'varovani' }, 'Pokud jsi to ověřil(a) ve sliceru a víš, že se to reálně vejde, potvrď. Jinak zavři a rozděl na víc úloh.'),
      ],
      'Potvrdit i tak');
    if (!ok) return;
  }
  for (const j of S.planJobs) {
    try {
      await api('plan-potvrdit', { tiskarnaId: j.tiskarnaId, material: j.material, strojId: j.strojId,
        polozky: j.polozky.map(p => ({ id: p.id, pocet: p.pocet })) });
    } catch (e) { hlas(e); }
  }
  S.vyroba = (await api('vyroba')).stroje;
  await nactiPlanovani();
  S.view = 'production';
  S.vyrobaObrazovka = 'prehled';
  vykresli();
}

// Filtr nad plánovací frontou — hledání v čísle/zákazníkovi/názvu dílu + volitelně
// jen jedna technologie. Skupina, které po filtru nezůstane žádný díl, se skryje.
function planPoolFiltrovana() {
  const q = (S.planHledani || '').trim().toLowerCase();
  const tech = S.planFTech;
  return S.planPool.map(g => {
    const polozky = g.polozky.filter(it => {
      if (tech && it.tech !== tech) return false;
      if (q && !(g.cislo + ' ' + g.zakaznik + ' ' + it.nazev).toLowerCase().includes(q)) return false;
      return true;
    });
    return polozky.length ? Object.assign({}, g, { polozky }) : null;
  }).filter(Boolean);
}

function planovaniScreen() {
  const techy = [...new Set(S.planPool.flatMap(g => g.polozky.map(p => p.tech)).filter(Boolean))];
  const pool = planPoolFiltrovana();
  if (S.planRazeni && RAZENI_ZAKAZKY[S.planRazeni]) pool.sort((a, b) => RAZENI_ZAKAZKY[S.planRazeni].cmp(a, b) * S.planRazeniSmer);

  return h('div', { style: 'padding:var(--space-4)' },
    S.planZakazka && h('div', { class: 'pruh-filtru', style: 'margin-bottom:var(--space-4)' },
      h('span', {}, 'Plánování pro zakázku ' + S.planZakazka + '.'),
      h('button', { class: 'btn btn-secondary', style: 'padding:3px 10px', onclick: () => {
        S.planZakazka = null; S.planHledani = ''; vykresli();
      } }, 'Zobrazit celou frontu')),
    h('div', { class: 'plan-grid' },
      h('div', { style: 'min-width:0' },
        h('h3', { class: 'kicker' }, 'Nepřiřazené díly'),
        h('div', { style: 'display:flex;gap:var(--space-2);flex-wrap:wrap;margin-bottom:var(--space-3)' },
          h('input', { id: 'planHledani', class: 'input', placeholder: 'Hledat zakázku, zákazníka nebo díl…', value: S.planHledani,
            style: 'flex:1;min-width:160px;padding:5px 8px',
            oninput: e => { S.planHledani = e.target.value; vykresli(); } }),
          techy.length > 1 && h('select', { class: 'input', style: 'padding:5px 8px',
              onchange: e => { S.planFTech = e.target.value; vykresli(); } },
            [h('option', { value: '', selected: !S.planFTech }, 'Všechny technologie'),
             ...techy.map(t => h('option', { value: t, selected: t === S.planFTech }, t))]),
          h('select', { class: 'input', style: 'padding:5px 8px',
              onchange: e => { S.planRazeni = e.target.value; S.planRazeniSmer = 1; vykresli(); } },
            [h('option', { value: '', selected: !S.planRazeni }, 'Výchozí pořadí'),
             ...Object.entries(RAZENI_ZAKAZKY).map(([k, r]) => h('option', { value: k, selected: k === S.planRazeni }, r.nazev))]),
          S.planRazeni && h('button', { class: 'btn btn-ghost', style: 'padding:6px 10px', title: 'Obrátit pořadí řazení',
            onclick: () => { S.planRazeniSmer *= -1; vykresli(); } }, S.planRazeniSmer === 1 ? '↓' : '↑')),
        pool.map(planPoolSkupina),
        pool.length === 0 && S.planPool.length > 0 && h('div', { style: 'font-size:14px;color:var(--muted);font-style:italic;padding-top:var(--space-2);border-top:1px solid var(--line)' },
          'Žádný díl neodpovídá hledání/filtru.'),
        S.planPool.length === 0 && h('div', { style: 'font-size:14px;color:var(--muted);font-style:italic;padding-top:var(--space-2);border-top:1px solid var(--line)' },
          'Všechny díly čekajících zakázek jsou přiřazené.')),

      h('div', { style: 'min-width:0' },
        h('div', { style: 'position:sticky;top:var(--space-4)' },
          h('div', { style: 'display:flex;gap:var(--space-2);flex-wrap:wrap;margin-bottom:var(--space-4)' },
            h('button', { class: 'btn btn-ghost', onclick: planAutoNavrh },
              (S.planHledani || S.planFTech) ? 'Automatický návrh pro vyfiltrované' : 'Automatický návrh pro vše'),
            h('button', { class: 'btn btn-ghost', onclick: planVyprazdnit }, 'Vyprázdnit'),
            h('button', { class: 'btn btn-primary', disabled: S.planJobs.length === 0, onclick: planPotvrdit },
              'Potvrdit a odeslat do tisku')),
          h('h3', { class: 'kicker' }, 'Navržené úlohy — přetáhni díl na zařízení'),
          S.planJobs.map(planJobKarta),
          S.planJobs.length === 0 && h('div', { style: 'font-size:14px;color:var(--muted);font-style:italic;padding:var(--space-2) 0;border-top:1px solid var(--line)' },
            'Zatím žádná úloha — přetáhni díl na zařízení níže nebo dej automatický návrh.'),
          h('div', { style: 'margin-top:var(--space-5)' },
            h('h3', { class: 'kicker' }, 'Zařízení — sem přetáhni díl'),
            h('div', { style: 'display:flex;flex-wrap:wrap;gap:var(--space-2)' },
              (S.stroje || []).filter(s => s.aktivni).map(planStrojDlazdice)))))));
}

function planPoolSkupina(g) {
  const vybrana = g.cislo === S.planZakazka;
  return h('div', { style: 'margin-bottom:var(--space-5);padding:var(--space-3);background:' + (vybrana ? 'var(--teal-100)' : 'var(--panel)') + ';border-left:3px solid ' + (vybrana ? 'var(--teal-700)' : 'var(--teal)') },
    h('div', { style: 'display:flex;justify-content:space-between;align-items:baseline;gap:var(--space-2);padding-bottom:6px;flex-wrap:wrap' },
      h('span', {},
        h('span', { style: 'font-family:var(--font-heading);font-size:18px;font-weight:600' }, g.zakaznik || '—'),
        h('span', { style: 'font-size:13px;color:var(--muted-2);margin-left:8px' }, g.cislo),
        typeof g.dnuDoTerminu === 'number' && h('span', {
            style: 'font-size:13px;margin-left:8px;font-weight:600;color:' + (g.dnuDoTerminu < 3 ? 'var(--red)' : 'var(--muted-2)'),
            title: 'Termín ' + dm(g.termin) },
          g.dnuDoTerminu < 0 ? '−' + dny(-g.dnuDoTerminu) : g.dnuDoTerminu === 0 ? 'termín dnes' : 'zbývá ' + dny(g.dnuDoTerminu))),
      h('span', { style: 'display:flex;align-items:baseline;gap:var(--space-3)' },
        g.polozky.length > 1 && h('button', { class: 'btn btn-ghost', style: 'font-size:12px;padding:2px 8px',
            title: 'Naplánuje rovnou všechny díly téhle zakázky — každý na stroj podle své technologie (víc technologií v jedné zakázce se rozdělí do víc úloh).',
            onclick: () => planNavrhZakazky(g.cislo) }, 'Naplánovat celou zakázku'),
        h('a', { href: '#', style: 'font-size:12px;color:var(--muted-2);text-decoration:underline;white-space:nowrap',
          onclick: e => { e.preventDefault(); S.view = 'board'; vykresli(); otevri(g.cislo); } }, 'otevřít kartu'))),
    g.polozky.map(it => planPoolPolozka(g, it)));
}

// "Naplánovat celou zakázku" — stejný hladový návrh jako auto-návrh pro vše
// (navrhDavek), jen omezený na jednu zakázku; díly různých technologií se tím
// pádem rozpadnou do samostatných úloh na odpovídající stroje, ne na jeden.
async function planNavrhZakazky(cislo) {
  try {
    const d = await api('navrh', { cislo });
    const nove = (d.navrhy || []).map(n => ({
      key: 'k' + (++S.planSeq), tiskarnaId: n.tiskarnaId, tiskarnaNazev: n.tiskarna, material: n.material, strojId: n.strojId,
      polozky: n.polozky.map(p => ({ id: p.id, nazev: p.nazev, pocet: p.pocet, perjob: p.perjob, zakazkaCislo: p.zakazkaCislo })),
    }));
    S.planJobs = S.planJobs.concat(nove);
    nove.forEach(j => j.polozky.forEach(p => planOdeberZPoolu(p.id, p.pocet)));
    const nesparovano = Object.entries(d.nesparovaneTiskarny || {});
    if (nesparovano.length) hlas(new Error('Nespárovaná tiskárna (chybí v registru): ' + nesparovano.map(([n, c]) => n + ' (' + c + ' ks)').join(', ')));
    vykresli();
  } catch (e) { hlas(e); }
}

function planPoolPolozka(g, it) {
  return h('div', {
      draggable: 'true',
      ondragstart: e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(it.id));
        S.dragItem = { ...it, zakazkaCislo: g.cislo, zakaznik: g.zakaznik }; },
      style: 'padding:var(--space-2) 0 var(--space-2) var(--space-2);border-top:1px solid var(--line);cursor:grab;display:flex;flex-direction:column;gap:6px' },
    h('div', { style: 'display:flex;justify-content:space-between;gap:var(--space-2);align-items:baseline' },
      h('span', { style: 'display:flex;flex-direction:column;gap:2px' },
        h('span', { style: 'font-size:15px' }, it.nazev),
        h('span', { style: 'font-size:12px;color:var(--muted-2)' }, it.material + ' · ' + (it.tiskarnaId ? it.tiskarnaNazev : it.tiskarnaNazev + ' (nespárováno)'))),
      h('span', { style: 'font-size:14px;white-space:nowrap' }, it.pocet + ' ks')),
    h('div', { style: 'display:flex;align-items:center;gap:6px;flex-wrap:wrap' },
      h('input', { class: 'input', type: 'number', min: '1', max: String(it.pocet), value: it.move,
        style: 'width:70px;font-size:13px;padding:3px 6px',
        onchange: e => { it.move = Math.max(1, Math.min(it.pocet, Math.round(+e.target.value) || 1)); vykresli(); } }),
      h('button', { class: 'btn btn-ghost', style: 'font-size:12px;padding:2px 8px',
        onclick: () => { it.move = Math.max(1, Math.floor(it.pocet / 2)); vykresli(); } }, '½'),
      h('button', { class: 'btn btn-ghost', style: 'font-size:12px;padding:2px 8px',
        onclick: () => { it.move = it.pocet; vykresli(); } }, 'vše'),
      h('span', { style: 'font-size:12px;color:var(--muted-2)' }, 'přetáhnout ' + it.move + ' z ' + it.pocet + ' ks')));
}

function planJobKarta(j) {
  const fill = planFill(j);
  const pct = Math.round(fill * 100);
  return h('div', {
      ondragover: e => e.preventDefault(),
      ondrop: e => { e.preventDefault(); planDropNaJob(j.key); },
      style: 'padding:var(--space-3) 0;border-top:1px solid var(--line)' },
    h('div', { style: 'display:flex;justify-content:space-between;align-items:baseline;gap:var(--space-3);flex-wrap:wrap' },
      h('span', { style: 'font-family:var(--font-heading);font-size:18px' }, j.tiskarnaNazev + ' · ' + planStrojOznaceni(j.strojId)),
      h('span', { style: 'display:flex;align-items:baseline;gap:var(--space-2)' },
        h('span', { style: 'font-size:13px;color:var(--muted-2)' }, pct + ' % · ' + j.material),
        h('a', { class: 'btn btn-ghost', style: 'padding:2px 8px;font-size:12px',
          href: 'soubory-zip.php?' + j.polozky.map(p => 'p[]=' + p.id).join('&'), target: '_blank' }, 'Modely'))),
    h('div', { style: 'height:8px;background:var(--line);margin-top:8px' },
      h('div', { style: 'height:8px;background:' + (pct > 100 ? 'var(--red)' : 'var(--teal)') + ';width:' + Math.min(100, pct) + '%' })),
    h('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px' },
      j.polozky.map(p => h('span', { style: 'display:inline-flex;align-items:baseline;gap:6px;font-size:13px;padding:3px 8px;background:var(--teal-100)' },
        h('span', {}, p.pocet + '× ' + p.nazev),
        h('button', { onclick: () => planOdeberZJobu(j.key, p.id),
          style: 'appearance:none;border:0;background:none;cursor:pointer;font-size:13px;color:var(--red);padding:0' }, '×')))),
    pct > 100 && h('div', { style: 'margin-top:8px;display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap' },
      h('span', { style: 'font-size:13px;color:var(--red)' }, 'Nevejde se do jedné úlohy.'),
      h('button', { class: 'btn btn-secondary', style: 'font-size:13px;padding:3px 10px', onclick: () => planRozdel(j.key) }, 'Rozdělit na více úloh')));
}

function planStrojOznaceni(strojId) {
  const s = (S.stroje || []).find(x => x.id === strojId);
  return s ? s.oznaceni : '?';
}

function planStrojDlazdice(s) {
  const t = (S.tiskarny || []).find(x => x.id === s.tiskarnaId);
  return h('div', {
      ondragover: e => e.preventDefault(),
      ondrop: e => { e.preventDefault(); planDropNaStroj(s.id); },
      style: 'padding:8px 12px;border:1px dashed var(--muted);font-size:13px;display:flex;flex-direction:column;gap:2px' },
    h('span', { style: 'font-family:var(--font-heading);font-size:15px' }, (t ? t.nazev : '?') + ' · ' + s.oznaceni),
    h('span', { style: 'color:var(--muted-2)' }, t ? t.tech : ''));
}

function ulohaKarta(u, strojId) {
  const dalsi = { fronta: ['tiskne', 'Zahájit tisk'], tiskne: ['hotovo', 'Dokončeno'] }[u.stav];
  return h('article', {
      class: 'card karta' + (S.dragUloha === u.id ? ' tazena' : ''),
      style: 'cursor:grab;border-left-color:' + (u.expres ? 'var(--red)' : 'var(--line)'),
      draggable: 'true',
      ondragstart: e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(u.id));
        S.dragUloha = u.id; },
      ondragend: () => { S.dragUloha = null; vykresli(); },
      ondragover: e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; },
      ondrop: e => {
        e.preventDefault(); e.stopPropagation();
        const src = S.dragUloha; S.dragUloha = null;
        if (!src || src === u.id) { vykresli(); return; }
        zmenUlohaPoradi(src, u.id, strojId);
      },
    },
    h('div', { class: 'telo' },
      h('div', { class: 'radek1' },
        h('span', { class: 'cislo' }, u.material || '—'),
        u.expres && h('span', { class: 'prio', style: 'color:var(--red)' }, 'expres')),
      h('div', { class: 'radek2' },
        h('div', { style: 'min-width:0' },
          h('div', { class: 'zakaznik' }, (u.dily || []).map(d => d.pocet + '× ' + d.nazev).join(', ') || '—'),
          h('div', { class: 'souhrn' },
            hod(u.hodinTisk) + ' h tisk + ' + hod(u.hodinChladnuti) + ' h chladnutí · ' + u.zakazky.join(', ')))),
      h('div', { class: 'radek3' },
        h('span', { style: 'color:var(--muted-2)' }, 'hotovo nejdřív ' + dt(u.hotovoNejdrive)),
        h('a', { class: 'btn btn-ghost', style: 'padding:2px 8px;font-size:12px',
          href: 'soubory-zip.php?uloha=' + u.id, target: '_blank' }, 'Modely'),
        dalsi && h('button', { class: 'btn btn-secondary', style: 'padding:2px 8px;font-size:12px',
          onclick: () => zmenUlohaStav(u.id, dalsi[0]) }, dalsi[1]))));
}

async function zmenUlohaPoradi(id, nad, strojId) {
  const s = (S.vyroba || []).find(x => x.strojId === strojId);
  const u = s && s.fronta.find(x => x.id === id);
  if (u) vykresli();
  try { await api('uloha-poradi', { id, nad }); } catch (e) { hlas(e); }
  S.vyroba = (await api('vyroba')).stroje; vykresli();
}
async function zmenUlohaStav(id, stav) {
  try { await api('uloha-stav', { id, stav }); } catch (e) { hlas(e); }
  S.vyroba = (await api('vyroba')).stroje; vykresli();
}

/* ---------- Zákazníci ---------- */

function obrazovkaZakaznici() {
  const q = (S.hledaniFirmy || '').trim().toLowerCase();
  const firmy = !q ? S.firmy : S.firmy.filter(x => [
      x.nazev, x.ico,
      ...x.kontakty.map(k => (k.jmeno || '') + ' ' + (k.email || '')),
      ...x.zakazky.map(z => z.cislo),
    ].join(' ').toLowerCase().includes(q));
  const f = firmy.find(x => x.klic === S.firmaKlic) || firmy[0];
  return h('div', { class: 'obrazovka',
      style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,560px),1fr));gap:var(--space-6);align-items:start' },
    h('section', { style: 'min-width:0' },
      h('div', { style: 'display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--space-3);margin-bottom:var(--space-3)' },
        h('h3', { style: 'margin:0' }, 'Zákazníci (firmy)'),
        h('input', { id: 'hledaniFirmy', class: 'input', value: S.hledaniFirmy || '',
          placeholder: 'Hledat firmu, IČO, kontakt, číslo…',
          style: 'flex:1;min-width:200px;max-width:320px;padding:6px 10px',
          oninput: e => { S.hledaniFirmy = e.target.value; vykresli(); } }),
        h('span', { style: 'font-size:14px;color:var(--muted)' }, firmy.length + ' / ' + S.firmy.length)),
      h('div', { class: 'scroll-x' },
        h('table', { class: 'table', style: 'width:100%;min-width:460px' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Firma'), h('th', {}, 'IČO'),
            h('th', { style: 'text-align:right' }, 'Kontakty'), h('th', { style: 'text-align:right' }, 'Zakázky'),
            h('th', { style: 'text-align:right' }, 'Obrat'), h('th', { style: 'text-align:right' }, 'Sleva'))),
          h('tbody', {}, firmy.map(x => h('tr', {
              style: 'cursor:pointer;background:' + (f && x.klic === f.klic ? 'var(--teal-100)' : 'transparent'),
              onclick: () => { S.firmaKlic = x.klic; vykresli(); } },
            h('td', { style: 'font-weight:600;color:var(--teal)' }, x.nazev),
            h('td', { style: 'color:var(--muted)' }, x.ico),
            h('td', { style: 'text-align:right' }, String(x.kontakty.length)),
            h('td', { style: 'text-align:right' }, String(x.zakazek)),
            h('td', { style: 'text-align:right;white-space:nowrap' }, kc(x.obrat)),
            h('td', { style: 'text-align:right' }, x.sleva ? x.sleva + ' %' : '—')))))),
      S.firmy.length === 0 && h('div', { style: 'color:var(--muted)' }, 'Zatím žádní zákazníci.'),
      S.firmy.length > 0 && firmy.length === 0 && h('div', { style: 'color:var(--muted)' }, 'Nic neodpovídá hledání.')),

    f && h('section', { class: 'panel', style: 'min-width:0;padding:var(--space-4)' },
      h('h3', { style: 'margin:0 0 var(--space-1)' }, f.nazev),
      h('div', { style: 'font-size:15px;color:var(--muted-2)' },
        f.ico !== '—' ? 'IČO ' + f.ico : 'bez IČO — párováno podle ' + f.parovanoPodle),
      h('div', { style: 'font-size:16px;margin:var(--space-2) 0 var(--space-4)' },
        zakazek(f.zakazek) + ' · ' + kc(f.obrat) + ' · ' + kontakty(f.kontakty.length)),

      h('h4', { class: 'kicker' }, 'Sleva firmy'),
      h('div', { style: 'display:flex;align-items:center;gap:var(--space-2);margin-bottom:var(--space-2)' },
        h('input', { class: 'input', type: 'number', min: '0', max: '50', value: f.sleva,
          style: 'width:80px;padding:5px 8px;text-align:right', disabled: !muzeMenit(),
          onchange: async e => {
            try { await api('firma-sleva', { klic: f.klic, sleva: e.target.value });
                  S.firmy = (await api('firmy')).firmy; vykresli(); } catch (err) { hlas(err); } } }),
        h('span', { style: 'font-size:16px' }, '%')),
      h('div', { style: 'font-size:14px;color:var(--muted);max-width:52ch;margin-bottom:var(--space-4)' },
        'Sleva platí pro celou firmu bez ohledu na to, který z jejích lidí poptávku pošle. Dopočítá se při ruční úpravě ceny; cena už poslané nabídky se nemění.'),

      h('h4', { class: 'kicker' }, 'Kontakty'),
      h('div', { style: 'display:flex;flex-direction:column;gap:2px;margin-bottom:var(--space-4);font-size:16px' },
        f.kontakty.map(k => h('div', {}, (k.jmeno || '—') + ' · ',
          h('a', { href: 'mailto:' + k.email }, k.email)))),

      h('h4', { class: 'kicker' }, 'Zakázky firmy'),
      h('div', { class: 'scroll-x' },
        h('table', { class: 'table', style: 'width:100%;min-width:520px' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Číslo'), h('th', {}, 'Kdo poptal'), h('th', {}, 'Co jsme tiskli'),
            h('th', {}, 'Termín'), h('th', { style: 'text-align:right' }, 'Cena'), h('th', {}, 'Stav'))),
          h('tbody', {}, f.zakazky.map(x => h('tr', { style: 'cursor:pointer', onclick: () => otevri(x.cislo) },
            h('td', { style: 'white-space:nowrap;color:var(--muted)' }, x.cislo),
            h('td', {}, x.kdo),
            h('td', {}, x.co),
            h('td', { style: 'white-space:nowrap' }, dm(x.termin)),
            h('td', { style: 'text-align:right;white-space:nowrap' }, kc(x.celkem)),
            h('td', {}, nazevSloupce(x.stav))))))))); 
}

/* ---------- Pošta ---------- */

function obrazovkaPosta() {
  return h('div', { class: 'obrazovka' },
    h('h3', { style: 'margin:0 0 var(--space-1)' }, 'Pošta — kontrolní výpis'),
    h('p', { style: 'font-size:15px;color:var(--muted-2);max-width:70ch;margin:0 0 var(--space-3)' },
      'Všechny e-maily, které systém odeslal nebo vybral ze schránky, včetně pravidla, podle kterého je přiřadil k zakázce. Interní poznámky ani automatické odpovědi tu nejsou.'),
    h('div', { style: 'display:flex;flex-wrap:wrap;gap:var(--space-2);margin-bottom:var(--space-3)' },
      [['vse', 'Vše'], ['prichozi', 'Příchozí'], ['odchozi', 'Odchozí']].map(([k, label]) =>
        h('button', { style: 'background:' + (S.postaFiltr === k ? 'var(--teal-100)' : 'var(--line)')
            + ';color:' + (S.postaFiltr === k ? 'var(--teal-700)' : 'var(--ink)')
            + ';border:1px solid var(--line);padding:6px 12px;cursor:pointer;font-family:var(--font-heading);font-weight:600;font-size:13px;letter-spacing:0.06em;text-transform:uppercase',
          onclick: async () => { S.postaFiltr = k; S.posta = (await api('posta&filtr=' + k)).posta; vykresli(); } },
        label))),
    h('div', { class: 'scroll-x' },
      h('table', { class: 'table', style: 'width:100%;min-width:820px' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Kdy'), h('th', {}, 'Směr'), h('th', {}, 'Od / komu'),
          h('th', {}, 'Předmět'), h('th', {}, 'Zakázka'), h('th', {}, 'Spárováno podle'), h('th', {}, 'Stav'))),
        h('tbody', {}, S.posta.map(m => h('tr', { style: 'cursor:pointer', onclick: () => otevri(m.zakazka) },
          h('td', { style: 'white-space:nowrap;color:var(--muted)' }, dt(m.kdy)),
          h('td', { style: 'white-space:nowrap;color:' + (m.typ === 'prichozi' ? 'var(--teal-700)' : 'var(--muted-2)') },
            m.typ === 'prichozi' ? 'příchozí' : 'odchozí'),
          h('td', {}, m.kdoText),
          h('td', {}, m.predmet),
          h('td', { style: 'white-space:nowrap;color:var(--teal)' }, m.zakazka),
          h('td', { style: 'color:var(--muted-2)' }, m.parovani),
          h('td', { style: 'white-space:nowrap;color:' + (m.stav === 'nepřečteno' ? 'var(--red)' : 'var(--muted)') },
            m.stav)))))),
    S.posta.length === 0 && h('div', { style: 'color:var(--muted)' }, 'Zatím žádná pošta.'));
}

/* ---------- Nezařazeno ---------- */

function obrazovkaNezarazeno() {
  const d = S.nezarazeno || { zpravy: [], otevrene: [] };
  return h('div', { class: 'obrazovka', style: 'max-width:900px' },
    h('h3', { style: 'margin:0 0 var(--space-1)' }, 'Nezařazeno'),
    h('p', { style: 'font-size:14px;color:var(--muted-2);max-width:60ch' },
      'Zprávy, které systém nedokázal spolehlivě spárovat se zakázkou. Přiřaď je klikem; automatické odpovědi a doručenky se sem nedostanou.'),
    h('div', { style: 'display:flex;flex-direction:column;gap:var(--space-4);margin-top:var(--space-4)' },
      d.zpravy.map(m => h('article', { style: 'display:flex;flex-direction:column;gap:6px' },
        h('div', { style: 'display:flex;align-items:baseline;gap:var(--space-2);font-size:13px;color:var(--muted)' },
          h('span', {}, dt(m.kdy)), h('span', { style: 'color:var(--red)' }, m.duvod)),
        h('div', { style: 'font-family:var(--font-heading);font-weight:600;font-size:19px' }, m.predmet),
        h('div', { style: 'font-size:14px;color:var(--muted-2)' }, m.od),
        h('div', { style: 'font-size:14px;max-width:70ch;white-space:pre-wrap' }, m.telo),
        h('div', { style: 'display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2);margin-top:2px' },
          h('select', { class: 'input', id: 'cil' + m.id, style: 'padding:6px 8px;max-width:340px' },
            [...d.otevrene.map(o => h('option', { value: o.cislo }, o.popis)),
             h('option', { value: 'nova' }, 'Založit novou kartu')]),
          h('button', { class: 'btn btn-primary', onclick: async () => {
            try { await api('nezarazeno-priradit', { id: m.id, cil: $('#cil' + m.id).value });
                  S.nezarazeno = await api('nezarazeno'); await obnov(false); } catch (e) { hlas(e); }
          } }, 'Přiřadit'),
          h('button', { class: 'btn btn-ghost', onclick: async () => {
            if (!await potvrdit('Zahodit zprávu?', 'Zahodit tuto zprávu?', 'Zahodit')) return;
            try { await api('nezarazeno-zahodit', { id: m.id });
                  S.nezarazeno = await api('nezarazeno'); await obnov(false); } catch (e) { hlas(e); }
          } }, 'Zahodit')))),
      d.zpravy.length === 0 && h('div', { style: 'font-size:14px;color:var(--muted)' }, 'Nic nečeká na zařazení.')));
}

/* ---------- Nastavení ---------- */

function obrazovkaNastaveni() {
  const d = S.nastaveniData;
  if (!d) return h('div', { class: 'hlaska' }, 'Načítám…');
  S.sablonyCache = d.sablony;

  const ulozPrahy = async (klic, hodnota) => {
    try { await api('nastaveni-uloz', { [klic]: hodnota }); await nactiStav(); } catch (e) { hlas(e); }
  };
  const ulozInfo = async (data) => {
    try { await api('nastaveni-uloz', data); S.nastaveniData = await api('nastaveni'); vykresli(); }
    catch (e) { hlas(e); }
  };
  const pole = (label, klic, popis) => h('label', { style: 'display:flex;flex-direction:column;gap:4px' }, label,
    h('input', { class: 'input', type: 'number', value: d.prahy[klic], style: 'padding:5px 8px',
      onchange: e => ulozPrahy(klic, e.target.value) }),
    popis && h('span', { style: 'font-size:13px;color:var(--muted)' }, popis));

  return h('div', { class: 'obrazovka mrizka' },
    /* sloupce */
    h('section', {},
      h('h3', { style: 'margin:0 0 var(--space-3)' }, 'Sloupce tabule'),
      h('div', { style: 'display:flex;flex-direction:column;gap:var(--space-2)' },
        S.sloupce.map((c, i) => h('div', { style: 'display:flex;align-items:center;gap:var(--space-2)' },
          h('input', { class: 'input', value: c.nazev, style: 'flex:1;min-width:80px;padding:5px 8px',
            onchange: e => { S.sloupce[i].nazev = e.target.value; ulozSloupce(); } }),
          h('span', { style: 'font-size:12px;color:var(--muted);width:70px' },
            karty(S.zakazky.filter(z => z.stav === c.klic).length)),
          h('button', { class: 'btn btn-ghost', style: 'padding:2px 8px', onclick: () => {
            if (i === 0) return; const a = S.sloupce; a.splice(i - 1, 0, a.splice(i, 1)[0]); ulozSloupce(); } }, '↑'),
          h('button', { class: 'btn btn-ghost', style: 'padding:2px 8px', onclick: () => {
            if (i === S.sloupce.length - 1) return; const a = S.sloupce; a.splice(i + 1, 0, a.splice(i, 1)[0]); ulozSloupce(); } }, '↓'),
          h('button', { style: 'background:' + (c.skryt ? 'var(--line)' : 'var(--teal-100)')
              + ';color:' + (c.skryt ? 'var(--muted-2)' : 'var(--teal-700)')
              + ';border:0;border-radius:var(--radius-md);padding:5px 9px;cursor:pointer;font-size:13px',
            onclick: () => { S.sloupce[i].skryt = !c.skryt; ulozSloupce(); } }, c.skryt ? 'skrytý' : 'na tabuli')))),
      h('button', { class: 'btn btn-secondary', style: 'margin-top:var(--space-3)', onclick: async () => {
        const nazev = await zeptat('Nový sloupec', { popisek: 'Název sloupce', hodnota: 'Nový sloupec', textOk: 'Přidat' });
        if (!nazev) return;
        S.sloupce.push({ klic: 'vlastni' + Date.now(), nazev, skryt: false, novy: true });
        ulozSloupce();
      } }, 'Přidat sloupec')),

    /* tiskárny a stroje */
    h('section', {},
      h('h3', { style: 'margin:0 0 var(--space-1)' }, 'Tiskárny a stroje'),
      h('p', { style: 'font-size:14px;color:var(--muted-2);max-width:56ch;margin:0 0 var(--space-3)' },
        'Typy se přebírají z ceníku kalkulátoru. Zde se spravují jen fyzické kusy pro plánování výroby.'),
      h('div', { style: 'display:flex;flex-direction:column;gap:var(--space-4)' },
        S.tiskarny.map(t => h('div', {},
          h('div', { style: 'display:flex;align-items:center;gap:var(--space-2)' },
            h('input', { class: 'input', value: t.nazev, style: 'flex:1;min-width:80px;padding:5px 8px',
              onchange: e => { t.nazev = e.target.value; ulozTiskarnu(t); } }),
            h('span', { style: 'font-size:12px;color:var(--muted)' }, t.tech + (t.inHouse ? '' : ' · externí')),
            h('button', { style: 'background:' + (t.aktivni ? 'var(--teal-100)' : 'var(--line)')
                + ';color:' + (t.aktivni ? 'var(--teal-700)' : 'var(--muted-2)')
                + ';border:0;border-radius:var(--radius-md);padding:5px 9px;cursor:pointer;font-size:13px',
              onclick: () => { t.aktivni = !t.aktivni; ulozTiskarnu(t); } }, t.aktivni ? 'aktivní' : 'neaktivní'),
            t.aktivni && h('button', { class: 'btn btn-ghost', style: 'padding:2px 8px;font-size:12px',
              onclick: () => smazTiskarnu(t) }, 'smazat')),
          h('div', { style: 'display:flex;flex-direction:column;gap:4px;margin:6px 0 0 var(--space-4)' },
            S.stroje.filter(s => s.tiskarnaId === t.id).map(s => h('div', {
                style: 'display:flex;align-items:center;gap:var(--space-2)' },
              h('input', { class: 'input', value: s.oznaceni, style: 'flex:1;max-width:200px;padding:4px 8px;font-size:13px',
                onchange: e => { s.oznaceni = e.target.value; ulozStroj(s); } }),
              h('button', { style: 'background:' + (s.aktivni ? 'var(--teal-100)' : 'var(--line)')
                  + ';color:' + (s.aktivni ? 'var(--teal-700)' : 'var(--muted-2)')
                  + ';border:0;border-radius:var(--radius-md);padding:3px 8px;cursor:pointer;font-size:12px',
                onclick: () => { s.aktivni = !s.aktivni; ulozStroj(s); } }, s.aktivni ? 'aktivní' : 'neaktivní'),
              h('button', { class: 'btn btn-ghost', style: 'padding:2px 8px;font-size:12px', onclick: () => smazStroj(s) }, 'smazat'))),
            !t.inHouse && S.stroje.filter(s => s.tiskarnaId === t.id).length === 0
              && h('span', { style: 'font-size:13px;color:var(--muted)' }, 'externí kooperace — bez vlastního stroje'),
            h('button', { class: 'btn btn-ghost', style: 'padding:2px 8px;font-size:13px;align-self:flex-start', onclick: async () => {
              const oznaceni = await zeptat('Nový stroj', {
                popisek: 'Označení stroje (' + t.nazev + ')',
                hodnota: t.klic + '-' + (S.stroje.filter(s => s.tiskarnaId === t.id).length + 1),
                textOk: 'Přidat',
              });
              if (!oznaceni) return;
              ulozStroj({ tiskarnaId: t.id, oznaceni });
            } }, '+ přidat stroj')))))),

    /* prahy */
    h('section', {},
      h('h3', { style: 'margin:0 0 var(--space-3)' }, 'Prahy a hlídání'),
      h('div', { style: 'display:flex;flex-direction:column;gap:var(--space-3);max-width:360px' },
        pole('Vysoká priorita, pokud je rezerva pod (h)', 'prahVysoka'),
        pole('Normální priorita, pokud je rezerva pod (h)', 'prahNormalni'),
        h('div', { style: 'font-size:13px;color:var(--muted)' },
          'Rezerva = hodiny do termínu − (tisk + schnutí + manipulace + přeprava u externích). Hodnoty přicházejí z kalkulátoru.'))),

    /* informační e-maily */
    h('section', {},
      h('h3', { style: 'margin:0 0 var(--space-1)' }, 'Informační e-maily'),
      h('p', { style: 'font-size:14px;color:var(--muted-2);max-width:56ch;margin:0 0 var(--space-3)' },
        'Souhrn nové pošty a ranní přehled dílny. Nemá vliv na odpovědi zákazníkům ani na příjem poptávek — ty chodí vždy.'),
      h('label', { style: 'display:flex;align-items:center;gap:var(--space-2);margin-bottom:var(--space-3)' },
        h('input', { type: 'checkbox', checked: !!d.infoMaily,
          onchange: e => ulozInfo({ infoMaily: e.target.checked }) }),
        h('span', {}, 'Posílat informační e-maily')),
      h('label', { style: 'display:flex;flex-direction:column;gap:4px;max-width:360px' + (d.infoMaily ? '' : ';opacity:.5') },
        'Komu (víc adres oddělených čárkou)',
        h('input', { class: 'input', value: d.infoMailyKam || '', placeholder: 'dilna@firma.cz, sef@firma.cz',
          style: 'padding:5px 8px', disabled: !d.infoMaily,
          onchange: e => ulozInfo({ infoMailyKam: e.target.value }) }))),

    /* šablony */
    h('section', {},
      h('h3', { style: 'margin:0 0 var(--space-3)' }, 'E-mailové šablony'),
      h('div', { style: 'display:flex;flex-direction:column;gap:var(--space-4)' },
        d.sablony.map(t => h('div', {},
          h('div', { style: 'display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--space-2)' },
            h('span', { style: 'font-family:var(--font-heading);font-weight:600' }, t.nazev),
            h('input', { class: 'input', value: t.predmet, style: 'flex:1;min-width:160px;padding:3px 6px;font-size:12px',
              onchange: e => ulozSablonu(t.klic, e.target.value, null) })),
          h('textarea', { class: 'input', rows: '4', value: t.telo,
            style: 'width:100%;padding:6px 8px;margin-top:4px;resize:vertical',
            onchange: e => ulozSablonu(t.klic, null, e.target.value) }))),
        h('div', { style: 'font-size:13px;color:var(--muted)' },
          'Zástupné hodnoty: {cislo}, {jmeno}, {cena}, {termin}, {odkaz}'))),

    /* uživatelé — přes celou šířku, ať se tabulka nemačká */
    h('section', { style: 'min-width:0;grid-column:1/-1' },
      h('h3', { style: 'margin:0 0 var(--space-1)' }, 'Uživatelé a role'),
      h('p', { style: 'font-size:14px;color:var(--muted-2);max-width:56ch;margin:0 0 var(--space-3)' },
        'Přihlášení jménem a heslem, sezení v cookie. Deaktivovaný účet se nepřihlásí a nedá se mu nic přiřadit.'),
      h('div', { class: 'scroll-x' },
        h('table', { class: 'table', style: 'width:100%;min-width:520px' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Jméno'), h('th', {}, 'E-mail'), h('th', {}, 'Role'),
            h('th', {}, 'Stav'), h('th', {}, 'Heslo'))),
          h('tbody', {}, S.uzivatele.map(u => h('tr', {},
            h('td', {}, u.jmeno),
            h('td', { style: 'color:var(--muted-2)' }, u.email),
            h('td', {},
              h('select', { class: 'input', style: 'width:auto;padding:3px 6px',
                  onchange: e => ulozUzivatele({ klic: u.klic, role: e.target.value }) },
                Object.keys(ROLE).map(r => h('option', { value: r, selected: r === u.role }, ROLE[r]))),
              h('div', { style: 'font-size:13px;color:var(--muted)' }, ROLE_POPIS[u.role])),
            h('td', {},
              h('button', { style: 'background:' + (u.aktivni ? 'var(--teal-100)' : 'var(--line)')
                  + ';color:' + (u.aktivni ? 'var(--teal-700)' : 'var(--muted)')
                  + ';border:1px solid var(--line);padding:3px 9px;cursor:pointer;font-size:13px',
                onclick: () => ulozUzivatele({ klic: u.klic, aktivni: !u.aktivni }) },
                u.aktivni ? 'aktivní' : 'deaktivovaný')),
            h('td', {},
              h('button', { class: 'btn btn-ghost', style: 'padding:2px 8px', onclick: async () => {
                const heslo = await zeptat('Nové heslo', { popisek: 'Heslo pro ' + u.jmeno, typ: 'password', textOk: 'Uložit' });
                if (heslo) ulozUzivatele({ klic: u.klic, heslo });
              } }, 'Změnit'))))))),
      h('button', { class: 'btn btn-secondary', style: 'margin-top:var(--space-3)',
        onclick: () => { S.novyUzivatel = true; vykresli(); } }, 'Přidat uživatele')),

    /* napojení */
    h('section', {},
      h('h3', { style: 'margin:0 0 var(--space-3)' }, 'Napojení'),
      h('div', { style: 'display:flex;flex-direction:column;gap:var(--space-2);font-size:14px;max-width:520px' },
        [['Endpoint kalkulátoru', d.napojeni.endpoint], ['Shared secret', d.napojeni.secret],
         ['IMAP', d.napojeni.imap], ['Modul php-imap', d.napojeni.imapModul],
         ['Reply-To klíč', d.napojeni.replyTo], ['Formát čísla', d.napojeni.cisloFormat],
         ['Ceník', d.napojeni.cenik], ['Veřejná stavová stránka', d.napojeni.verejnaUrl]]
          .map(([label, value]) => h('div', { style: 'display:flex;justify-content:space-between;gap:var(--space-3)' },
            h('span', { style: 'color:var(--muted);flex:0 0 auto' }, label),
            h('span', { style: 'text-align:right;word-break:break-all' }, String(value)))))));
}

async function ulozSloupce() {
  try { await api('sloupce-uloz', { sloupce: S.sloupce }); await nactiStav(); vykresli(); } catch (e) { hlas(e); }
}
async function nactiTiskarny() {
  const t = await api('tiskarny'); S.tiskarny = t.tiskarny; S.stroje = t.stroje; vykresli();
}
async function ulozTiskarnu(t) {
  try { await api('tiskarna-uloz', { klic: t.klic, nazev: t.nazev, aktivni: t.aktivni }); await nactiTiskarny(); }
  catch (e) { hlas(e); }
}
async function ulozStroj(s) {
  try { await api('stroj-uloz', s); await nactiTiskarny(); } catch (e) { hlas(e); }
}
async function smazTiskarnu(t) {
  if (!await potvrdit('Smazat tiskárnu?', 'Smazat tiskárnu ' + t.nazev + '? Deaktivují se i její stroje — nepůjde dál navrhovat na výrobu.', 'Smazat')) return;
  try { await api('tiskarna-uloz', { klic: t.klic, smazat: true }); await nactiTiskarny(); } catch (e) { hlas(e); }
}
async function smazStroj(s) {
  try { await api('stroj-uloz', { id: s.id, smazat: true }); await nactiTiskarny(); } catch (e) { hlas(e); }
}
async function ulozSablonu(klic, predmet, telo) {
  const t = (S.nastaveniData.sablony || []).find(x => x.klic === klic);
  if (!t) return;
  if (predmet !== null) t.predmet = predmet;
  if (telo !== null) t.telo = telo;
  try { await api('sablona-uloz', { klic, predmet: t.predmet, telo: t.telo }); } catch (e) { hlas(e); }
}
async function ulozUzivatele(data) {
  try { await api('uzivatel-uloz', data); await nactiStav(); vykresli(); } catch (e) { hlas(e); }
}

/* ---------- Náhled pro zákazníka ---------- */

function obrazovkaNahled() {
  const cislo = S.pubCislo || (S.zakazky[0] && S.zakazky[0].cislo);
  const z = S.detailPub;
  if (cislo && (!z || z.cislo !== cislo)) {
    api('detail', { cislo }).then(v => { S.detailPub = v.zakazka; vykresli(); }).catch(hlas);
    return h('div', { class: 'hlaska' }, 'Načítám…');
  }
  if (!z) return h('div', { class: 'hlaska' }, 'Zatím žádná zakázka.');

  return h('div', { class: 'obrazovka' },
    h('div', { style: 'max-width:760px;margin-bottom:var(--space-4);font-size:15px;color:var(--muted-2)' },
      'Takhle vidí zakázku zákazník. Stránka se nikam neposílá — odkaz na ni je v potvrzovacím e-mailu (a v každé nabídce), token je dlouhý a náhodný, takže bez něj se na stránku nikdo nedostane a žádné přihlášení není potřeba.'),
    h('div', { style: 'display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2);margin-bottom:var(--space-4);font-size:14px;color:var(--muted)' },
      h('span', {}, 'Zakázka'),
      h('select', { class: 'input', style: 'width:auto;padding:5px 8px',
          onchange: e => { S.pubCislo = e.target.value; S.detailPub = null; vykresli(); } },
        S.zakazky.map(x => h('option', { value: x.cislo, selected: x.cislo === cislo },
          x.cislo + ' · ' + x.zakaznik))),
      h('span', { style: 'font-family:var(--font-heading);color:var(--ink);word-break:break-all' }, z.stavovaUrl),
      h('button', { class: 'btn btn-ghost', style: 'padding:3px 10px', onclick: () => {
        if (navigator.clipboard) navigator.clipboard.writeText(z.stavovaUrl);
        S.kopirovano = true; vykresli();
        setTimeout(() => { S.kopirovano = false; vykresli(); }, 2000);
      } }, S.kopirovano ? 'Odkaz zkopírován' : 'Kopírovat odkaz'),
      h('a', { class: 'btn btn-secondary', style: 'text-decoration:none;border-bottom:0',
        href: 'stav.php?t=' + encodeURIComponent(z.token), target: '_blank' }, 'Otevřít stránku')),
    h('iframe', { src: 'stav.php?t=' + encodeURIComponent(z.token), title: 'Náhled stavové stránky',
      style: 'width:100%;max-width:820px;height:820px;border:1px solid var(--line);background:var(--panel)' }));
}

/* ---------- vykreslení ---------- */

function vykresli() {
  const korenPuvodni = $('#app');
  const posunTabule = korenPuvodni ? (korenPuvodni.querySelector('#tabule') || {}).scrollLeft : 0;
  // detail se překresluje celý — udrž jeho svislé odrolování (jinak po každé změně skočí nahoru)
  const posunDetail = korenPuvodni ? (korenPuvodni.querySelector('.detail') || {}).scrollTop : 0;
  // udrž fokus (a kurzor) v poli, když překreslení přijde uprostřed psaní — např. hledání
  const aktivni = document.activeElement;
  const fokus = aktivni && aktivni.id && korenPuvodni && korenPuvodni.contains(aktivni)
    ? { id: aktivni.id,
        s: 'selectionStart' in aktivni ? aktivni.selectionStart : null,
        e: 'selectionEnd'   in aktivni ? aktivni.selectionEnd   : null }
    : null;

  let obsah;
  if (!S.user) {
    obsah = obrazovkaPrihlaseni();
  } else {
    const podle = {
      today: obrazovkaDnes, board: obrazovkaTabule, list: obrazovkaSeznam, production: obrazovkaVyroba,
      customers: obrazovkaZakaznici,
      mail: obrazovkaPosta, inbox: obrazovkaNezarazeno, settings: obrazovkaNastaveni,
      public: obrazovkaNahled,
    };
    // pohled, na který uživatel nemá právo, se tiše sklopí na tabuli / seznam
    let view = S.view;
    if ((view === 'settings' && !jeAdmin())
        || ((view === 'inbox' || view === 'mail' || view === 'production') && !muzeMenit())) {
      view = muzeMenit() ? 'today' : 'list';
      S.view = view;
    }
    // na tabuli držíme výšku okna, ať se karty rolují uvnitř sloupce (ne celá stránka)
    obsah = h('div', { class: 'app' + (view === 'board' ? ' tabule-rezim' : '') },
      hlavicka(),
      S.chyba && h('div', { class: 'chyba-pruh' }, S.chyba),
      (podle[view] || obrazovkaTabule)(),
      S.open && detailPanel(),
      S.potvrzeni && potvrzeniOkno(),
      S.dotaz && dotazOkno(),
      S.novyUzivatel && novyUzivatelOkno());
  }

  const novy = h('div', { id: 'app' }, obsah);
  if (korenPuvodni) korenPuvodni.replaceWith(novy); else document.body.append(novy);
  const tab = novy.querySelector('#tabule');
  if (tab && posunTabule) tab.scrollLeft = posunTabule;
  const det = novy.querySelector('.detail');
  if (det && posunDetail) det.scrollTop = posunDetail;
  if (fokus) {
    const znovu = document.getElementById(fokus.id);
    if (znovu) {
      znovu.focus();
      if (fokus.s !== null) { try { znovu.setSelectionRange(fokus.s, fokus.e); } catch { /* nevadí */ } }
    }
  }
}

/* ---------- klávesnice ---------- */
// Obsluha běží jen po přihlášení a jen na tabuli; stisky v polích se ignorují,
// jinak by Enter v hledání otevíral kartu.

document.addEventListener('keydown', e => {
  if (!S.user || S.view !== 'board') return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

  if (e.key === 'Escape') { if (S.open) { e.preventDefault(); S.open = null; S.detail = null; vykresli(); } return; }
  if (S.open) return;

  const filtrovane = S.zakazky.filter(projde);
  const mrizka = viditelneSloupce().map(c => poradiKaret(filtrovane.filter(z => z.stav === c.klic)).map(z => z.cislo));
  let ci = mrizka.findIndex(g => g.includes(S.sel));
  if (ci < 0) ci = 0;
  let ri = Math.max(0, mrizka[ci] ? mrizka[ci].indexOf(S.sel) : 0);

  if (e.key === 'Enter') { const c = mrizka[ci] && mrizka[ci][ri]; if (c) { e.preventDefault(); otevri(c); } return; }
  const posun = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (!posun) return;
  e.preventDefault();
  ci = Math.min(mrizka.length - 1, Math.max(0, ci + posun[0]));
  ri = Math.min(Math.max(0, (mrizka[ci] || []).length - 1), Math.max(0, ri + posun[1]));
  const c = (mrizka[ci] || [])[ri];
  if (c) { S.sel = c; vykresli(); }
});

/* ---------- start ---------- */

(async function start() {
  try {
    const v = await api('me');
    S.user = v.uzivatel;
    S.csrf = v.csrf || null;
    if (S.user) {
      S.view = S.user.role === 'cteni' ? 'list' : 'today';
      await nactiStav(); try { S.sablonyCache = (await api('nastaveni')).sablony; } catch {}
    }
    else {
      // seznam uživatelů pro přihlašovací obrazovku
      try { S.uzivatele = (await api('uzivatele-login')).uzivatele; } catch { S.uzivatele = []; }
    }
  } catch { /* nepřihlášen */ }
  vykresli();

  // tabule se sama obnovuje, aby dva lidé v dílně viděli totéž
  setInterval(() => {
    if (!S.user || document.hidden) return;
    if (S.drag) return;                     // neobnovovat uprostřed přetahování
    obnov().catch(() => {});
  }, 30000);
})();
