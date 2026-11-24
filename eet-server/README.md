# Účtenky – EET 2.0 brána

Malý server pro aplikaci **Účtenky**. Přijme tržbu z telefonu, podepíše ji pokladním
certifikátem a odešle do EET 2.0 finanční správy (SOAP v4, WS-Security, RSA-SHA256).
Certifikát zůstává jen na serveru, telefon ho nikdy nevidí.

## Co je potřeba

1. **Registrace v EET 2.0** na portálu MOJE daně (DIS+): evidenční jednotka (provozovna) a její **ID**.
2. **Pokladní certifikát** (.p12) a heslo k němu, vygenerovaný v DIS+.
3. Server s Node.js 18+ nebo Dockerem, dostupný přes **HTTPS** (např. Render, Railway, Fly.io, VPS).

## Spuštění

```bash
npm ci
EET_P12_PATH=/cesta/pokladni.p12 \
EET_P12_PASS=heslo \
EET_EIC=CZ12345678 \
EET_ENV=playground \
API_TOKEN=dlouhy-nahodny-token \
ALLOW_ORIGIN=https://zsiska.github.io \
node server.js
```

| Proměnná | Význam |
|---|---|
| `EET_P12_PATH` / `EET_P12_PASS` | pokladní certifikát a heslo |
| `EET_EIC` | EIČ poplatníka (`CZ` + 8–10 číslic) |
| `EET_ENV` | `playground` (test, výchozí) nebo `produkce` |
| `API_TOKEN` | tajný token, stejný zadáš v aplikaci (Nastavení → EET) |
| `ALLOW_ORIGIN` | adresa, odkud běží aplikace (CORS) |

**Vždy nejdřív testuj na `playground`.** Do produkce přepni až po úspěšných testech.

## API

- `GET /eet/health` – kontrola certifikátu (hlavička `Authorization: Bearer <API_TOKEN>`)
- `POST /eet/send` – JSON `{uuid, first, overeni?, id_jednotky, id_pokl, porad_cis, dat_trzby, celk_trzba}`
  → `{ok, pok, test, warnings[], error{kod,text}, retry}`

Při výpadku aplikace tržbu drží ve frontě a posílá znovu se stejnými daty
(`first=false`, nové `uuid`), podle zákona do 48 hodin.

## Test bez finanční správy

`node mock-fs.js` spustí náhradu, která ověří podpis a vrátí POK. Pak server s `EET_ENDPOINT=http://localhost:9999`.
