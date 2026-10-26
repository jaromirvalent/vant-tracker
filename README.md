# VANT – tracker CS2 turnajov o peniaze

Jeden prehľad 1v1 a 2v2 CS2 turnajov o peniaze z FastCupu, Vieforitu a Challengermode na najbližšie 2 týždne, so sledovaním vlastných turnajov a výhier.

- Zámer projektu: [project.md](project.md)
- Špecifikácia a kritériá prijatia: [SPEC.md](SPEC.md)
- Technický návrh: [DESIGN.md](DESIGN.md)

## Spustenie

Potrebuješ [Node.js](https://nodejs.org) 18 alebo novší.

**Windows:** dvojklik na `Spustit_VANT.bat`. Prvýkrát sa nainštalujú závislosti, potom sa otvorí `http://localhost:8787`.

**Ručne (akýkoľvek systém):**

```bash
npm install
npm start
```

a otvor `http://localhost:8787`. Okno so serverom nechaj otvorené.

Bez servera sa dá otvoriť aj `VANT_turnaje.html` – ukáže uložené turnaje, ale neobnovuje ich.

## Dáta

Všetko sa ukladá do `data/vant-data.json` (denné zálohy v `data/zalohy/`). Priečinok `data/` nie je v gite.

## Voliteľné kľúče

V aplikácii v **Nastaveniach**:
- **Claude API kľúč** – presnejšie čítanie screenshotov turnajov (bez neho sa použije OCR v prehliadači).
- **Toornament API kľúč** – pridá komunitné turnaje z Toornamentu.
