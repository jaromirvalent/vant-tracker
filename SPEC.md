# SPEC – VANT, tracker CS2 turnajov o peniaze

Verzia 1.0 · Špecifikácia požiadaviek (čo má aplikácia robiť, nie ako)

## 1. Problém

Hráč CS2, ktorý hrá 1v1 a 2v2 turnaje o peniaze, musí každý deň ručne prechádzať viacero stránok (FastCup, Vieforit, Challengermode), aby našiel vhodný turnaj. Nemá jedno miesto, kde vidí všetky nadchádzajúce turnaje, kde je prihlásený a koľko celkovo vyhral alebo minul.

## 2. Používatelia a roly

| Rola | Čo robí |
|---|---|
| **Hráč** (jediná rola vo verzii 1) | Prezerá načítané turnaje, sleduje vybrané, mení ich stav, zapisuje výsledky, pridáva turnaje ručne, mení nastavenia. |

Aplikácia beží lokálne na počítači hráča, bez prihlasovania. Kto má prístup k počítaču, má prístup k aplikácii.

## 3. Funkcie

Každá funkcia je jedna veta z pohľadu používateľa.

### 1. Prehľad turnajov
- **1.1** Ako hráč vidím v jednom zozname všetky nadchádzajúce turnaje z podporovaných stránok na najbližších 14 dní, zoradené podľa času začiatku.
- **1.2** Ako hráč vidím pri každom turnaji: čas, názov, stránku, mód (1v1/2v2), výhru v €, počet prihlásených / max. a odkaz na stránku turnaja.
- **1.3** Ako hráč môžem zoznam filtrovať podľa módu (všetko / 1v1 / 2v2) a obdobia (dnes / zajtra / týždeň / 2 týždne) a hľadať podľa názvu.
- **1.4** Ako hráč môžem zoznam zoradiť podľa najvyššej výhry.
- **1.5** Ako hráč sa nemusím o nič starať – zoznam sa sám obnoví pri otvorení a potom každých 30 minút; môžem ho obnoviť aj ručne.

### 2. Moje turnaje
- **2.1** Ako hráč si môžem turnaj zo zoznamu označiť (hviezdička) a tým ho pridať do „Moje turnaje“.
- **2.2** Ako hráč môžem meniť stav sledovaného turnaja: plánujem → prihlásený → odohrané / nehrám.
- **2.3** Ako hráč môžem pri odohranom turnaji zapísať umiestnenie a sumu, ktorú som vyhral.
- **2.4** Ako hráč vidím súhrn: počet prihlásených a odohraných turnajov, súčet výhier a bilanciu (výhry mínus vstupné).
- **2.5** Ako hráč vidím svoje turnaje v mesačnom kalendári.

### 3. Pridanie turnaja
- **3.1** Ako hráč môžem pridať turnaj ručne cez formulár (názov, stránka, mód, dátum, čas, výhra, vstupné, odkaz).
- **3.2** Ako hráč môžem vložiť screenshot turnaja (Ctrl+V alebo pretiahnutím) a údaje sa do formulára vyplnia samé.

### 4. Nastavenia a dáta
- **4.1** Ako hráč si môžem vybrať, ktoré módy chcem vidieť, a zapnúť/vypnúť jednotlivé stránky.
- **4.2** Ako hráč sa môžem spoľahnúť, že všetky moje dáta sú uložené v súbore na disku a každý deň sa zálohujú.
- **4.3** Ako hráč si môžem stiahnuť zálohu a nahrať ju späť.

## 4. Obmedzenia

- Aplikácia beží **lokálne na Windows** (spúšťa sa súborom `Spustit_VANT.bat`), v bežnom prehliadači (Chrome, Edge, Firefox).
- Technológie: **HTML/CSS/JavaScript** na frontende, **Node.js 18+** na serveri, dáta v **JSON súbore**.
- Jazyk rozhrania **slovenčina**, mena **EUR** (ceny v USD/RUB sa orientačne prepočítajú).
- Funguje aj na **úzkej obrazovke** (mobil / malé okno).
- Dáta o turnajoch sú len také, aké zverejňujú zdrojové stránky – väčšina ich zverejňuje približne týždeň dopredu.
- API kľúče (Claude, Toornament) sa nikdy neposielajú inam než na príslušné API.

## 5. Mimo rozsahu (verzia 1 úmyselne nie)

- Registrácia do turnaja priamo z aplikácie (rieši sa na stránke turnaja).
- Používateľské účty, viac používateľov, synchronizácia medzi zariadeniami.
- Notifikácie (e-mail, push).
- Pro scéna (Majory, ESL, BLAST) a turnaje na FACEIT.
- Stávky / zápasy o vlastný vklad.
- Automatické načítanie stránok, ktoré blokujú prístup (Gamers Club).

## 6. Otvorené otázky (rozhodnuté)

| Otázka | Rozhodnutie |
|---|---|
| Čo je „výhra“ pri turnaji s cenami za viac miest? | Hlavne sa ukazuje výhra za 1. miesto; ak nie je známa, celkový prize pool. |
| Ako počítať výhry v rubľoch / freebety? | Orientačný prepočet na EUR, pôvodná suma ostáva v popise. |
| Čo s turnajom, ktorý už začal? | V zozname ostáva ešte 2 hodiny od začiatku (označený „prebieha“), potom zmizne. Sledované turnaje ostávajú navždy. |
| Ako dlho dopredu načítavať? | 14 dní (viac stránky aj tak nezverejňujú). |
| Čo keď zdrojová stránka nefunguje? | Ostatné stránky sa načítajú normálne, pri chybnej sa v Nastaveniach ukáže chyba; staré dáta z nej ostanú. |

## 7. Kritériá prijatia (testovací plán)

| # | Funkcia | Ako overiť | Očakávaný výsledok |
|---|---|---|---|
| K1 | 1.1, 1.5 | Spustiť `Spustit_VANT.bat`, počkať 10 s | Na karte Turnaje sú turnaje z FastCupu aj Vieforitu, najbližší je hore. |
| K2 | 1.2 | Pozrieť ľubovoľný riadok | Má čas, názov, stránku, mód, výhru v € a počet hráčov; šípka otvorí stránku turnaja. |
| K3 | 1.3 | Kliknúť „1v1“ a „Zajtra“ | Zostanú len 1v1 turnaje so zajtrajším dátumom. |
| K4 | 1.4 | Zvoliť „Najvyššia výhra“ | Prvý riadok má najvyššiu sumu. |
| K5 | 2.1 | Kliknúť hviezdičku pri turnaji | Turnaj sa objaví v „Moje turnaje“. |
| K6 | 2.2–2.4 | Zmeniť stav na „Odohrané“, zapísať 2. miesto a 5 € | Súhrn ukáže 1 odohraný a vyhrané 5 €. |
| K7 | 2.5 | Otvoriť Kalendár | Sledovaný turnaj je v správny deň. |
| K8 | 3.1 | Vyplniť formulár a uložiť | Turnaj je v „Moje turnaje“. |
| K9 | 3.2 | Vložiť screenshot turnaja | Aspoň názov, mód a čas sa vyplnia samé. |
| K10 | 4.2 | Zavrieť prehliadač, vymazať jeho dáta, znova spustiť | Sledované turnaje a výsledky sú stále tam. |
| K11 | 4.1 | Vypnúť mód 2v2 v Nastaveniach | V zozname nie sú 2v2 turnaje. |
| K12 | Obmedzenia | Zúžiť okno na šírku mobilu | Všetko je čitateľné, nič nepretŕča do strany. |
