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

/* ---------- stav ---------- */

const S = {
  user: null, view: 'board',
  zakazky: [], sloupce: [], uzivatele: [], nastaveni: {}, nezarazenoPocet: 0,
  open: null, detail: null, sel: null, drag: null, dragOver: null,
  hledani: '', fKdo: '', fTech: '', fPrio: '', fNeprectene: false, fPoTerminu: false, fExterni: false,
  fStav: '', razeni: 'termin',
  rezim: 'odpoved', draft: '', prebitCena: '', prebitDuvod: '', histOpen: false,
  smazPriloha: null, dropAktivni: false, citaceZpravy: {}, histZakOpen: false,
  firmy: [], firmaKlic: null, hledaniFirmy: '', posta: [], postaFiltr: 'vse', nezarazeno: null,
  nastaveniData: null, tiskarny: [], stroje: [], vyroba: [], pozadavky: null, dragUloha: null, pubCislo: null, kopirovano: false,
  chyba: '', nacitam: false,
};

/* ---------- API ---------- */

async function api(akce, data, metoda) {
  const r = await fetch('api.php?a=' + akce, {
    method: metoda || (data ? 'POST' : 'GET'),
    headers: data ? { 'Content-Type': 'application/json' } : {},
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
  return true;
}

// Ruční pořadí (přetažení) má přednost; jinak nejnovější zakázka nahoře
// (nejvyšší číslo P-RRRR-NNNN). Priorita se pozná z barvy, ne z pořadí.
function poradiKaret(list) {
  return list.slice().sort((a, b) => {
    if (a.prioritaRucne !== b.prioritaRucne) return a.prioritaRucne ? -1 : 1;
    if (a.prioritaRucne) return a.poradi - b.poradi;
    return b.cislo.localeCompare(a.cislo, 'cs', { numeric: true });
  });
}

function maFiltry() {
  return !!(S.hledani || S.fKdo || S.fTech || S.fPrio || S.fNeprectene || S.fPoTerminu || S.fExterni);
}

/* ---------- přihlášení ---------- */

function obrazovkaPrihlaseni() {
  const kdo   = S.loginKdo || (S.uzivatele[0] && S.uzivatele[0].klic) || '';
  const vybr  = S.uzivatele.find(u => u.klic === kdo);
  const posli = async () => {
    try {
      const v = await api('login', { kdo: $('#loginKdo').value, heslo: $('#loginHeslo').value });
      S.user = v.uzivatel;
      S.view = v.uzivatel.role === 'cteni' ? 'list' : 'board';
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
    ['board', 'Tabule'], ['list', 'Seznam'], ['production', 'Výroba'], ['customers', 'Zákazníci'],
    ['mail', 'Pošta'], ['inbox', 'Nezařazeno'], ['settings', 'Nastavení'], ['public', 'Náhled pro zákazníka'],
  ].filter(([k]) => jeAdmin() || (k !== 'settings' && (muzeMenit() || (k !== 'inbox' && k !== 'mail' && k !== 'production'))));

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
      S.vyroba = (await api('vyroba')).stroje; S.pozadavky = await api('pozadavky');
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
          fNeprectene: false, fPoTerminu: false, fExterni: false });
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

// Kontejner tabule i s vodorovným rolováním: kolečkem myši a u kraje při přetahování.
function tabuleEl(filtrovane) {
  const el = h('div', { class: 'tabule', id: 'tabule' },
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
      ondragover: e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move';
        if (S.dragOver !== c.klic) { S.dragOver = c.klic; oznacSloupce(); } },
      ondragenter: e => { e.preventDefault();
        if (S.dragOver !== c.klic) { S.dragOver = c.klic; oznacSloupce(); } },
      ondragleave: e => { if (e.currentTarget.contains(e.relatedTarget)) return;
        if (S.dragOver === c.klic) { S.dragOver = null; oznacSloupce(); } },
      ondrop: e => { e.preventDefault(); const src = S.drag;
        S.drag = null; S.dragOver = null;
        if (src) presun(src, c.klic); else prekresliTabuli(); },
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
      style: 'cursor:' + (muzeMenit() ? 'grab' : 'pointer') + ';border-left-color:' + p.bg,
      tabindex: '0',
      draggable: muzeMenit() ? 'true' : 'false',
      ondragstart: e => { if (!muzeMenit()) { e.preventDefault(); return; }
        e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', z.cislo);
        S.drag = z.cislo; },
      ondragend: () => { S.drag = null; S.dragOver = null; prekresliTabuli(); },
      ondragover: e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; },
      ondrop: e => {
        e.preventDefault(); e.stopPropagation();
        const src = S.drag; S.drag = null; S.dragOver = null;
        if (!src || src === z.cislo) { prekresliTabuli(); return; }
        const od = S.zakazky.find(x => x.cislo === src);
        // pustit na kartu ve stejném sloupci = ruční pořadí, jinak přesun
        if (od && od.stav === z.stav) zmenPoradi(src, z.cislo); else presun(src, z.stav);
      },
      onclick: e => { if (e.target.tagName !== 'SELECT') otevri(z.cislo); },
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); otevri(z.cislo); } },
    },
    h('div', { class: 'telo' },
      h('div', { class: 'radek1' },
        h('span', { class: 'cislo' }, z.cislo),
        z.neprectene && h('span', { class: 'tecka' }),
        z.prioritaRucne && h('span', { class: 'rucne',
          title: 'Pořadí / priorita nastavené ručně — přetažením karty nebo v detailu. Zrušíš tak, že v detailu vrátíš Prioritu na „automaticky".' },
          '✱ ručně'),
        h('span', { class: 'prio', style: 'color:' + p.fg }, p.label)),

      h('div', { class: 'radek2' },
        z.maSoubory && z.nahledMm > 0 && h('div', { class: 'nahled' }, z.nahledMm + ' mm'),
        h('div', { style: 'min-width:0' },
          h('div', { class: 'zakaznik' }, z.zakaznik),
          h('div', { class: 'souhrn' },
            [z.tech, z.material].filter(Boolean).join(' · ')
            + (z.dilu ? ' · ' + z.dilu + (z.dilu === 1 ? ' díl' : ' díly') + ' / ' + z.ks + ' ks' : '')))),

      h('div', { class: 'radek3' },
        h('span', { style: 'font-weight:600' }, kc(z.celkem)),
        h('span', { style: 'color:' + (poTerminu ? 'var(--red)' : 'var(--muted-2)') }, terminText),
        h('span', { class: 'ini', style: 'background:' + (z.prirazeno ? 'var(--teal-100)' : 'transparent')
          + ';color:' + (z.prirazeno ? 'var(--teal-700)' : 'var(--muted)') }, ini(jmenoKlice(z.prirazeno)))),

      znacka && h('div', { class: 'znacka', style: 'background:' + znacka[1] + ';color:' + znacka[2] }, znacka[0]),

      // na tabletu a telefonu se stav mění dropdownem, ne přetažením
      muzeMenit() && h('select', { class: 'input karta-stav', onclick: e => e.stopPropagation(),
          onchange: e => presun(z.cislo, e.target.value) },
        S.sloupce.map(c => h('option', { value: c.klic, selected: c.klic === z.stav }, c.nazev)))));
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
    await nactiStav();
    vykresli();
  } catch (e) { S.open = null; hlas(e); }
}
async function novaZakazka() {
  const jmeno = prompt('Jméno zákazníka nebo firmy:', '');
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
      h('h2', {}, z.zakaznik),

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

      historieZmen(z),

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
        h('table', { class: 'table', style: 'width:100%;min-width:520px;margin-bottom:var(--space-3)' },
          h('thead', {}, h('tr', {},
            h('th', {}, 'Soubor'), h('th', {}, 'Rozměry (mm)'),
            h('th', { style: 'text-align:right' }, 'Objem (cm³)'),
            h('th', { style: 'text-align:right' }, 'Ks'),
            h('th', { style: 'text-align:right' }, 'Cena/ks'))),
          h('tbody', {}, z.polozky.map(it => h('tr', {},
            h('td', {}, it.nazev),
            h('td', { style: 'color:var(--muted-2)' }, it.bbox.map(x => Math.round(x)).join(' × ')),
            h('td', { style: 'text-align:right' }, String(it.objem).replace('.', ',')),
            h('td', { style: 'text-align:right' },
              muzeMenit()
                ? h('input', { class: 'input', type: 'number', min: '1', value: it.pocet,
                    style: 'width:72px;padding:3px 6px;text-align:right',
                    onchange: async e => {
                      const v = Math.max(1, parseInt(e.target.value, 10) || 1);
                      try { await api('pocet', { cislo: z.cislo, polozka: it.id, pocet: v }); await obnov(); }
                      catch (err) { hlas(err); }
                    } })
                : String(it.pocet)),
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
      h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:var(--space-2) var(--space-4);font-size:14px;margin-bottom:var(--space-6)' },
        [['Technologie', z.konfigurace.tech], ['Materiál', z.konfigurace.material],
         ['Barva', z.konfigurace.barva || '—'], ['Povrchová úprava', z.konfigurace.uprava || '—'],
         ['Rychlost', z.konfigurace.rychlost || '—'], ['Výplň', z.konfigurace.vypln || '—'],
         ['Dokončení', (z.konfigurace.dokonceni || []).join(', ') || '—'],
         ['Tiskárna', z.tiskarna || '—'], ['Tiskové úlohy', String(z.jobs)],
         ['Výroba', koop.length ? 'částečně externě (' + koop.length + ' operace)' : 'celá u nás']]
          .map(([label, value]) => h('div', {},
            h('span', { style: 'color:var(--muted)' }, label), h('br'), String(value || '—')))),

      koop.length > 0 && kooperace(z, koop),

      /* 05 — Modely */
      sekce('05 — Modely a přílohy'),
      modelyPrilohy(z),

      /* 06 — Konverzace */
      sekce('06 — Konverzace'),
      konverzace(z),
      muzeMenit() && odpovedni(z))];
}

function historieZmen(z) {
  const zmeny = z.historieZmen || [];
  if (!zmeny.length) return null;
  return h('div', { style: 'margin-bottom:var(--space-6)' },
    h('button', {
      style: 'background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--teal);padding:7px 12px;cursor:pointer;font-family:var(--font-heading);font-weight:600;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;color:var(--teal)',
      onclick: () => { S.histOpen = !S.histOpen; vykresli(); },
    }, 'Historie změn (' + zmeny.length + ')'),
    S.histOpen && h('div', { style: 'border:1px solid var(--line);border-top:0;padding:var(--space-3) var(--space-4)' },
      h('div', { style: 'display:flex;flex-direction:column' }, zmeny.map(x =>
        h('div', { style: 'display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--space-2);padding:7px 0;border-bottom:1px solid var(--line)' },
          h('span', { style: 'font-size:14px;color:var(--muted);white-space:nowrap' }, dt(x.kdy)),
          h('span', { style: 'font-size:14px;color:var(--muted-2);white-space:nowrap' }, x.kdo),
          h('span', { style: 'font-size:15px;flex:1;min-width:180px' }, x.co.replace(' — ' + x.kdo, '')),
          x.lzeVratit && muzeMenit() && h('button', { class: 'btn btn-ghost', style: 'padding:2px 8px',
            onclick: async () => {
              if (!confirm('Vrátit zakázku do stavu před touto změnou? Novější změny se zahodí.')) return;
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
      const r = await fetch('api.php?a=priloha-nahraj', { method: 'POST', body: fd, credentials: 'same-origin' });
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
                if (!confirm('Odpojit tuto zprávu od zakázky ' + z.cislo + ' a vrátit ji do Nezařazeno?')) return;
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

/* ---------- Výroba (fronta tiskových úloh) ---------- */

function obrazovkaVyroba() {
  const stroje = S.vyroba || [];
  if (!stroje.length) return h('div', { class: 'hlaska' }, 'Žádné aktivní stroje. Přidej je v Nastavení.');

  return h('div', { style: 'display:flex;flex-direction:column;flex:1;min-height:0' },
    pozadavkyPanel(),
    h('div', { class: 'tabule' },
      h('div', { class: 'sloupce' }, stroje.map(strojSloupec))));
}

function pozadavkyPanel() {
  const d = S.pozadavky;
  if (!d || !d.pozadavky.length) return null;
  const nesparovano = Object.entries(d.nesparovaneTiskarny || {});

  return h('div', { class: 'pruh-filtru', style: 'flex-direction:column;align-items:stretch;gap:var(--space-2)' },
    h('div', { style: 'font-weight:600' }, 'Co je potřeba vytisknout'),
    d.pozadavky.map(pozadavekRadek),
    nesparovano.length > 0 && h('div', { style: 'font-size:13px;color:var(--muted)' },
      'Nespárovaná tiskárna (chybí v registru tiskáren): '
      + nesparovano.map(([nazev, n]) => nazev + ' (' + n + ' ks)').join(', ')));
}

function pozadavekRadek(x) {
  const klic = x.tiskarnaId + '|' + x.material + '|' + x.nazev;
  if (!S.pozTisk) S.pozTisk = {};
  if (S.pozTisk[klic] === undefined) S.pozTisk[klic] = x.zbyva;
  const tisknout = Math.max(1, Math.min(x.zbyva, +S.pozTisk[klic] || 1));

  const stroje = S.stroje.filter(s => s.tiskarnaId === x.tiskarnaId && s.aktivni);
  if (!S.pozStroj) S.pozStroj = {};
  if (S.pozStroj[klic] === undefined) S.pozStroj[klic] = stroje[0] ? stroje[0].id : null;

  const hrefZip = 'soubory-zip.php?' + x.zakazky.map(z => 'p[]=' + z.polozkaId).join('&');

  return h('div', { style: 'display:flex;align-items:center;flex-wrap:wrap;gap:var(--space-2)' },
    h('span', { style: 'min-width:280px' },
      h('strong', {}, x.nazev), ' · ' + x.material + ' · ' + x.tiskarna + ' — ' + zakazek(x.zakazek)),
    h('span', { style: 'color:var(--muted-2)' }, 'zbývá ' + x.zbyva + ' ks (~' + x.odhadUloh + ' úloh)'),
    h('label', { style: 'display:flex;align-items:center;gap:6px;font-size:13px;color:var(--muted-2)' },
      'tisknout',
      h('input', { class: 'input', type: 'number', min: '1', max: String(x.zbyva), value: tisknout,
        style: 'width:70px;padding:4px 6px',
        onchange: e => { S.pozTisk[klic] = Math.max(1, Math.min(x.zbyva, +e.target.value || 1)); vykresli(); } }),
      'ks'),
    stroje.length > 1
      ? h('select', { class: 'input', style: 'width:auto;padding:4px 6px',
          onchange: e => { S.pozStroj[klic] = +e.target.value; } },
          stroje.map(s => h('option', { value: s.id, selected: s.id === S.pozStroj[klic] }, s.oznaceni)))
      : h('span', { style: 'color:var(--muted-2);font-size:13px' }, stroje[0] ? stroje[0].oznaceni : '— chybí aktivní stroj —'),
    h('a', { class: 'btn btn-ghost', style: 'padding:2px 8px;font-size:12px', href: hrefZip, target: '_blank' },
      'Stáhnout modely'),
    h('button', { class: 'btn btn-secondary', style: 'padding:2px 10px;font-size:12px',
      disabled: !S.pozStroj[klic],
      onclick: () => vytisknout(x, klic, tisknout) },
      'Vytisknout'));
}

async function vytisknout(x, klic, pocet) {
  const strojId = S.pozStroj[klic];
  try {
    await api('pozadavek-vytisknout', { tiskarnaId: x.tiskarnaId, material: x.material, nazev: x.nazev, strojId, pocet });
  } catch (e) { hlas(e); }
  S.pozadavky = await api('pozadavky');
  S.vyroba = (await api('vyroba')).stroje;
  vykresli();
}

function strojSloupec(s) {
  return h('section', { class: 'sloupec', style: 'width:300px' },
    h('div', { class: 'sloupec-hlavicka' },
      h('h4', {}, s.tiskarna + ' · ' + s.oznaceni),
      h('span', { style: 'font-size:13px;color:var(--muted)' }, String(s.fronta.length))),
    s.fronta.length > 0 && h('div', { style: 'font-size:13px;color:var(--muted-2);padding:0 var(--space-2) var(--space-2)' },
      'hotovo nejdřív ' + dt(s.hotovoNejdrive) + ' · ' + hod(s.celkemHodin) + ' h'),
    h('div', { class: 'sloupec-karty' },
      s.fronta.length === 0
        ? h('div', { style: 'font-size:15px;color:var(--muted);padding:var(--space-2)' }, 'Fronta je prázdná')
        : s.fronta.map(u => ulohaKarta(u, s.strojId))));
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
            if (!confirm('Zahodit tuto zprávu?')) return;
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
      h('button', { class: 'btn btn-secondary', style: 'margin-top:var(--space-3)', onclick: () => {
        const nazev = prompt('Název nového sloupce:', 'Nový sloupec');
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
              onclick: () => { t.aktivni = !t.aktivni; ulozTiskarnu(t); } }, t.aktivni ? 'aktivní' : 'neaktivní')),
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
            h('button', { class: 'btn btn-ghost', style: 'padding:2px 8px;font-size:13px;align-self:flex-start', onclick: () => {
              const oznaceni = prompt('Označení nového stroje:', t.klic + '-' + (S.stroje.filter(s => s.tiskarnaId === t.id).length + 1));
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
              h('button', { class: 'btn btn-ghost', style: 'padding:2px 8px', onclick: () => {
                const heslo = prompt('Nové heslo pro ' + u.jmeno + ':', '');
                if (heslo) ulozUzivatele({ klic: u.klic, heslo });
              } }, 'Změnit'))))))),
      h('button', { class: 'btn btn-secondary', style: 'margin-top:var(--space-3)', onclick: () => {
        const jmeno = prompt('Jméno nového uživatele:', '');
        if (!jmeno) return;
        const email = prompt('E-mail:', '') || '';
        const heslo = prompt('Heslo:', '') || 'cadmia';
        ulozUzivatele({ jmeno, email, heslo, role: 'dilna' });
      } }, 'Přidat uživatele')),

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
      board: obrazovkaTabule, list: obrazovkaSeznam, production: obrazovkaVyroba, customers: obrazovkaZakaznici,
      mail: obrazovkaPosta, inbox: obrazovkaNezarazeno, settings: obrazovkaNastaveni,
      public: obrazovkaNahled,
    };
    // pohled, na který uživatel nemá právo, se tiše sklopí na tabuli / seznam
    let view = S.view;
    if ((view === 'settings' && !jeAdmin())
        || ((view === 'inbox' || view === 'mail' || view === 'production') && !muzeMenit())) {
      view = muzeMenit() ? 'board' : 'list';
      S.view = view;
    }
    // na tabuli držíme výšku okna, ať se karty rolují uvnitř sloupce (ne celá stránka)
    obsah = h('div', { class: 'app' + (view === 'board' ? ' tabule-rezim' : '') },
      hlavicka(),
      S.chyba && h('div', { class: 'chyba-pruh' }, S.chyba),
      (podle[view] || obrazovkaTabule)(),
      S.open && detailPanel());
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
    if (S.user) { await nactiStav(); try { S.sablonyCache = (await api('nastaveni')).sablony; } catch {} }
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
