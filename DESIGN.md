# DESIGN – VANT, tracker CS2 turnajov o peniaze

Verzia 1.0 · Technický návrh (ako je aplikácia postavená). Požiadavky sú v [SPEC.md](SPEC.md).

## 1. Architektúra

```
┌───────────────────────────────┐        ┌──────────────────────────────────┐        ┌─────────────────────┐
│ Prehliadač                    │  HTTP  │ Lokálny server (Node.js)         │ HTTPS  │ Zdrojové stránky    │
│ vant_tracker.html             │ ─────► │ server.mjs  · 127.0.0.1:8787     │ ─────► │ FastCup (GraphQL)   │
│  • UI (5 obrazoviek)          │        │  • servíruje HTML                │        │ Vieforit (tRPC)     │
│  • adaptéry zdrojov           │ ◄───── │  • proxy na API (obchádza CORS)  │ ◄───── │ Challengermode (XML)│
│  • stav S v pamäti            │  JSON  │  • ukladanie data/vant-data.json │        │ Toornament (REST)   │
└───────────────────────────────┘        │  • Claude API (screenshoty)      │        │ Claude API          │
                                         └──────────────┬───────────────────┘        └─────────────────────┘
                                                        │ zápis
                                                        ▼
                                         data/vant-data.json + data/zalohy/
```

**Prečo lokálny server:** prehliadač z bezpečnostných dôvodov (CORS) nedovolí stránke volať cudzie API. Server beží len na `127.0.0.1`, takže nie je dostupný z internetu ani z lokálnej siete.

**Prečo bez frameworku:** aplikácia je malá (5 obrazoviek), jeden HTML súbor sa dá otvoriť a upraviť bez buildovania. Server používa len vstavané moduly Node.js (`http`, `fs`), jediná závislosť je `@anthropic-ai/sdk`.

## 2. Štruktúra repozitára

```
VANT Tracker/
├── project.md            zámer projektu (problém, MVP, non-goals)
├── SPEC.md               požiadavky a kritériá prijatia
├── DESIGN.md             tento dokument
├── README.md             ako spustiť
├── vant_tracker.html     celá aplikácia v prehliadači (HTML + CSS + JS)
├── VANT_turnaje.html     offline kópia s vloženými turnajmi (funguje aj bez servera)
├── server.mjs            lokálny server
├── package.json          závislosti (Node.js 18+)
├── Spustit_VANT.bat      spustenie na Windows (nainštaluje závislosti, otvorí prehliadač)
├── vant.ico              ikona pre zástupcu na ploche
└── data/                 (nie je v gite) dáta používateľa
    ├── vant-data.json
    └── zalohy/vant-RRRR-MM-DD.json
```

## 3. Dátový model

Celý stav aplikácie je jeden objekt `S`, ktorý sa ukladá ako `data/vant-data.json`.

```js
S = {
  tournaments: Tournament[],      // moje sledované / ručne pridané turnaje
  feed: {
    items: FeedItem[],            // načítané turnaje zo stránok (najbližších 14 dní)
    sources: { [sourceId]: { at: number, count: number, error: string } },
    hidden: string[]              // feedId turnajov, ktoré som skryl
  },
  settings: {
    modes: ('1v1'|'2v2'|'3v3'|'5v5')[],          // predvolene ['1v1','2v2']
    sources: { [sourceId]: { on: boolean, key?: string } },
    claude: { key: string, model: string }
  },
  lastSync: number                // čas poslednej obnovy (ms)
}
```

### FeedItem – turnaj načítaný zo stránky

| Pole | Typ | Popis |
|---|---|---|
| `feedId` | string | jedinečné ID: `fc:<id>` FastCup, `vf:<id>` Vieforit, `cm:<id>` Challengermode, `tt:<id>` Toornament |
| `source` | string | `fastcup` / `vieforit` / `challengermode` / `toornament` |
| `platform` | string | názov stránky na zobrazenie |
| `name` | string | názov turnaja |
| `startTs` | number | začiatok (ms od 1970, UTC) |
| `date`, `time` | string | lokálny dátum `RRRR-MM-DD` a čas `HH:MM` (Europe/Bratislava) |
| `mode` | string | `1v1`, `2v2`, `3v3`, `5v5` (wingman = 2v2) |
| `currentPlayers`, `maxPlayers` | string | prihlásení / kapacita |
| `buyin` | number | vstupné v € (0 = zadarmo) |
| `prize` | number | celkový prize pool v € |
| `p1` | number | výhra za 1. miesto v € (ak je známa) |
| `prizeText` | string | pôvodný popis cien (napr. `$500`, `6000₽ freebety`) |
| `url` | string | odkaz na stránku turnaja |
| `note` | string | podmienky (Premium, anti-cheat…) |
| `live` | boolean | turnaj práve prebieha |

### Tournament – môj turnaj

Všetky polia ako `FeedItem` (pri ručne pridanom je `feedId` prázdne a `source = 'manual'`) a navyše:

| Pole | Typ | Popis |
|---|---|---|
| `id` | string | UUID |
| `status` | string | `planned` (plánujem) · `registered` (prihlásený) · `played` (odohrané) · `skipped` (nehrám) |
| `resultPlace` | number | moje umiestnenie |
| `resultWin` | number | moja výhra v € |

**Prepojenie:** pri každej obnove sa sledovanému turnaju (podľa `feedId`) aktualizuje počet hráčov a čas; stav a výsledok sa nemenia.

## 4. API lokálneho servera

| Metóda | Cesta | Telo / parametre | Odpoveď | Účel |
|---|---|---|---|---|
| GET | `/` | – | HTML | aplikácia |
| GET | `/api/health` | – | `{ ok, version }` | kontrola, či server beží |
| GET | `/api/store` | – | objekt `S` (alebo `{}`) | načítanie dát |
| PUT | `/api/store` | objekt `S` | `{ ok, savedAt }` | uloženie dát (atomicky cez dočasný súbor) + denná záloha, drží posledných 30 |
| POST | `/api/fetch` | `{ url, headers?, ttl? }` | `{ ok, status, body }` | proxy na verejné API; blokuje lokálne adresy, drží odstupy medzi požiadavkami a krátku cache |
| GET | `/api/fastcup` | `?days=14` | `{ tournaments: [...] }` | turnaje z FastCupu (ich GraphQL prijíma len presný dotaz, ktorý používa ich stránka; stránkuje po 100) |
| POST | `/api/page` | `{ url }` | `{ ok, text }` | stiahne stránku a vytiahne čitateľný text |
| POST | `/api/claude` | `{ task: 'image'\|'page', image?, url?, apiKey, model }` | `{ tournaments: [...] }` | Claude prečíta screenshot/stránku a vráti turnaje v pevnej JSON schéme |

Zápis (`PUT /api/store`) je povolený len zo stránky na tom istom serveri (kontrola hlavičky `Origin`).

## 5. Zdroje turnajov (adaptéry)

Každý zdroj je funkcia, ktorá vráti pole `FeedItem`. Nový zdroj = nová funkcia + riadok v zozname `SOURCES`.

| Zdroj | Odkiaľ | Kľúč | Poznámka |
|---|---|---|---|
| FastCup | `hasura.fastcup.net/v1/graphql`, dotaz `GetTournaments` | nie | max. 100 na dotaz → stránkovanie podľa času; ceny v $, ₽ alebo Winline freebetoch |
| Vieforit | `vieforit.com/api/trpc/tournament.getUpcoming` | nie | peňažné ceny + vouchery po miestach |
| Challengermode | `challengermode.com/xml/feed/tournaments` | nie | Atom feed všetkých hier, filtruje sa CS2 |
| Toornament | `api.toornament.com/viewer/v2/...` | áno | bez kľúča sa preskočí |

**Obnova:** pri otvorení a potom každú minútu kontrola, či od poslednej obnovy ubehlo 30 minút. Zdroje sa načítajú paralelne; chyba jedného nezastaví ostatné. Turnaje mimo zvolených módov a staršie ako 2 hodiny od začiatku sa zahodia.

## 6. Obrazovky

| Obrazovka | Obsah | Funkcie zo SPEC |
|---|---|---|
| **Turnaje** | zoznam po dňoch, filtre módu/obdobia, hľadanie, zoradenie, hviezdička | 1.1–1.5, 2.1 |
| **Moje turnaje** | súhrn (prihlásený, odohrané, vyhrané, bilancia), zoznam so stavom, zápis výsledku | 2.2–2.4 |
| **Kalendár** | mesačná mriežka s mojimi turnajmi | 2.5 |
| **Pridať turnaj** | formulár + vloženie screenshotu (Claude / Tesseract) | 3.1–3.2 |
| **Nastavenia** | módy, zdroje a kľúče, záloha a obnova | 4.1–4.3 |

## 7. Bezpečnosť a súkromie

- Server počúva len na `127.0.0.1`; proxy odmieta lokálne a privátne adresy.
- Všetky texty z cudzích stránok sa pred vložením do HTML escapujú (ochrana proti XSS); odkazy sa povoľujú len `http(s)`.
- API kľúče sú len v `data/vant-data.json` (mimo gitu) a do zálohy na stiahnutie sa Claude kľúč nedáva.
- `data/` a `node_modules/` sú v `.gitignore`.
