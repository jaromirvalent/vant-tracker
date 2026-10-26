# VANT – tracker CS2 turnajov o peniaze

## Aký problém riešim (jednou vetou)

Hráč CS2, ktorý chce hrať 1v1 a 2v2 turnaje o peniaze, musí každý deň prechádzať viacero stránok (FastCup, Vieforit, Challengermode…) a nemá jedno miesto, kde vidí všetky nadchádzajúce turnaje, kde je prihlásený a koľko vyhral.

## Kto sú moji používatelia

- **Hlavný používateľ – súťažný hráč CS2** (amatér až semi-pro), ktorý hrá online cupy 1v1 (aim, pistol, sniper) a 2v2 (wingman) a chce si nimi privyrobiť alebo sa zlepšovať.
- **Spoluhráč pre 2v2** – nepracuje s aplikáciou priamo, ale hlavný používateľ si podľa nej plánuje, kedy spolu hrajú.

Vo verzii 1 je to aplikácia pre jedného človeka na jeho vlastnom počítači (bez účtov a prihlasovania).

## Ako chcem problém vyriešiť (MVP)

Webová aplikácia bežiaca lokálne na počítači, ktorá:

1. **Automaticky načíta** nadchádzajúce CS2 turnaje na najbližšie 2 týždne z viacerých stránok (FastCup, Vieforit, Challengermode) a obnovuje ich každých 30 minút.
2. **Zobrazí ich v jednom zozname** zoradenom podľa času, s výhrou, počtom prihlásených a odkazom na registráciu; dá sa filtrovať podľa módu (1v1/2v2) a dňa.
3. Umožní turnaj **označiť na sledovanie** a viesť si jeho stav: *plánujem → prihlásený → odohrané / nehrám*.
4. Po odohraní umožní **zapísať umiestnenie a výhru** a ukazuje štatistiky (počet odohraných, vyhrané €, bilancia).
5. Turnaj sa dá **pridať aj ručne alebo zo screenshotu** (pre stránky, ktoré nemajú verejné dáta).
6. Všetko sa **ukladá do jedného súboru na disku** s dennou zálohou, takže dáta neprídu nazmar pri vymazaní prehliadača.

## Čo v MVP nebude (non-goals) a prečo

| Nebude | Prečo |
|---|---|
| Registrácia do turnaja priamo z aplikácie | Každá stránka má vlastné prihlásenie cez Steam a anti-cheat; aplikácia iba otvorí stránku turnaja. |
| Používateľské účty, viac používateľov, cloud | MVP je pre jedného hráča na jeho počítači; účty by pridali server, databázu a bezpečnosť navyše bez prínosu pre prvú verziu. |
| Notifikácie (e-mail, push) | Vyžadujú bežiaci server na internete a súhlasy; hráč si turnaje pozrie v aplikácii. |
| Pro scéna (Majory, ESL, BLAST) a FACEIT | Používateľ chce hrať a zarábať, nie sledovať profesionálov; FACEIT si výslovne neželá. |
| Stávky a „wager“ zápasy o vlastné peniaze | Je to hazard s rizikom podvodov a v niektorých krajinách nelegálny. |
| Mobilná aplikácia v obchode | Stačí responzívna webová stránka v prehliadači. |
| Stránky bez verejných dát (Gamers Club) automaticky | Blokujú automatický prístup; pokryje ich ručné pridanie / screenshot. |

## Aké technológie potrebujem

- **Frontend:** HTML, CSS, JavaScript (bez frameworku, jeden súbor `vant_tracker.html`)
- **Backend:** Node.js 18+ (vlastný malý HTTP server `server.mjs`, bez Express)
- **Úložisko:** JSON súbor na disku (`data/vant-data.json`) + denné zálohy
- **Externé zdroje dát:** FastCup (GraphQL), Vieforit (tRPC API), Challengermode (Atom/XML feed), voliteľne Toornament API
- **Voliteľne AI:** Claude API (`@anthropic-ai/sdk`) na čítanie screenshotov turnajov, inak Tesseract.js (OCR v prehliadači)
- **Nástroje:** Git + GitHub, Windows (spúšťanie cez `Spustit_VANT.bat`)

## Iniciatíva, epicy a user stories

**Iniciatíva:** Hrať viac turnajov o peniaze s menej námahy – nájsť vhodný turnaj do 1 minúty namiesto ~15 minút prechádzania stránok a mať prehľad o vlastných výhrach.

| Epic | User story |
|---|---|
| **E1 – Prehľad turnajov z viacerých stránok** | Ako hráč chcem vidieť všetky 1v1 a 2v2 turnaje na najbližšie 2 týždne v jednom zozname, aby som nemusel otvárať každú stránku zvlášť. |
| | Ako hráč chcem filtrovať podľa módu a dňa, aby som rýchlo našiel turnaj, na ktorý mám čas. |
| | Ako hráč chcem vidieť výhru a počet voľných miest, aby som sa rozhodol, či sa oplatí hrať. |
| **E2 – Moje turnaje a výsledky** | Ako hráč chcem si turnaj označiť hviezdičkou, aby som ho nezabudol. |
| | Ako hráč chcem zapísať umiestnenie a výhru, aby som videl, koľko som celkovo zarobil. |
| **E3 – Ručné pridanie** | Ako hráč chcem vložiť screenshot turnaja, aby sa údaje vyplnili samé aj zo stránky, ktorú aplikácia nevie načítať. |
| **E4 – Spoľahlivé uloženie** | Ako hráč chcem, aby sa moje dáta ukladali na disk, aby som o ne neprišiel pri vymazaní prehliadača. |
