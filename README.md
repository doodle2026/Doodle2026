# Mødetid – Doodle-lignende mødeplanlægger

Node.js + Express 5 + SQLite (better-sqlite3) + plain HTML/CSS/JS. Design from `/workspace/doodle-ui` (`public/styles.css` is that file plus a few app additions at the bottom).

## Kør
```bash
npm install
npm start      # http://localhost:3000   (env: PORT, DB_FILE; default data/doodle.db)
npm test       # node:test + supertest, in-memory DB, fixed clock
```

## Sider
- `/` – opret afstemning (datogrupper med tidspunkter, design-spec §3)
- `/p/<id>` – visning; `<title>` og og:-tags server-renderes (HTML-escaped). Tider vises i browserens tidszone, dansk, 24-timer.
- `/e/<id>` – 301-redirect til `/p/<id>`
- Ukendte eller ugyldigt formaterede id'er → 404

## API
### `POST /api/events`
Headers: `Content-Type: application/json`, valgfri `Idempotency-Key: <8-100 tegn [A-Za-z0-9_-]>`.
```json
{ "title": "Teammøde", "description": "valgfri",
  "time_options": [ { "start": "2026-11-03T09:00:00+01:00", "end": "2026-11-03T10:00:00+01:00" },
                    { "start": "2026-11-04T08:00:00Z" } ] }
```
- `start`/`end`: ISO 8601 **med offset** (`Z` eller `±HH:MM`), gemmes som UTC. `end` valgfri (null/""/udeladt) og skal være efter `start`.
- title trimmes, påkrævet, ≤ 200 tegn; description trimmes, ≤ 2000; 1–100 tidsforslag; ingen i fortiden; dubletter (samme UTC-start+slut) fjernes.
- 201 (ny) / 200 + `Idempotent-Replayed: true` (samme nøgle igen) → poll-objekt (se nedenfor), `Location: /p/<id>`.
- 400 `{ "errors": [...] }` (dansk) for alle ugyldige input inkl. forkerte typer og null-body; 413 JSON ved body > 32 kB.

### `GET /api/events/:id[?tz=<IANA zone>]`
200:
```json
{ "id": "…22 tegn…", "slug": "…samme…", "title": "…", "description": "", "created_at": "…Z",
  "time_options": [ { "id": 1, "start_at": "2026-11-03T08:00:00.000Z", "end_at": "2026-11-03T09:00:00.000Z", "position": 0 } ],
  "timezone": "UTC",
  "options": [ { "date": "2026-11-03", "start": "08:00", "end": "09:00" } ],
  "url": "/p/<id>" }
```
`time_options` er kanoniske (UTC, sorteret). `options` er designets format, beregnet i `?tz=` (standard UTC; ugyldig zone → UTC); `end_date` tilføjes hvis slut ligger på en anden dato. 404 `{ errors }` hvis ukendt eller ugyldigt id.

## Sikkerhed
128-bit tilfældige id'er (base64url), slug-format valideres, frontend bruger kun `textContent`, CSP `default-src 'self'`, `nosniff`, `no-referrer`.
