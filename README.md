# Účtenky – čárky

Webová aplikace (PWA) pro hospodské účtenky s čárkami. Běží v telefonu i bez internetu.

**Aplikace:** https://zsiska.github.io/Uctenky/
Na iPhonu otevři v Safari → Sdílet → **Přidat na plochu**.

## Co umí
- vyfotit účtenku a přečíst čárky přes AI (Google Gemini, vlastní klíč v Nastavení), přeškrtnuté 4 = 5
- kontrola sporných míst: výřez řádku, zoom, počítání ťukáním na čárky
- ukládání pod jménem, částečné platby, hlídání dluhů s limity a připomínkami
- doklad o zaplacení (PDF/obrázek), odeslání e-mailem / přes Sdílet
- EET 2.0 (volitelně): MOJE EET nebo vlastní brána v `eet-server/`
- režim pro obsluhu (velká tlačítka, „Vrátit“), log běhu pro hledání chyb, záloha do souboru

Data jsou uložená jen v telefonu (IndexedDB). API klíče nejsou v kódu.

## Struktura
- `index.html`, `app.js` – aplikace
- `sw.js`, `manifest.webmanifest`, `icon-*.png` – offline a instalace
- `eet-server/` – volitelná EET 2.0 brána (Node.js, viz vlastní README)
