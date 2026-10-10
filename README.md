# GrabAday – find en dag, der passer alle

Next.js 15 (App Router, TypeScript) · Prisma 6 · PostgreSQL · design fra `/workspace/doodle-ui` (`public/styles.css` uændret).
Deploy: Vercel `fra1` + Supabase Postgres (Frankfurt) via `.github/workflows` (se `/workspace/doodle-deploy`).

## Kom i gang
`npm test` virker uden ekstra env: mangler `DATABASE_URL`, bruges `.env.test` (lokal `doodle_test`).

```bash
cp .env.example .env              # sæt DATABASE_URL / DIRECT_URL / APP_URL
npm ci                            # postinstall: prisma generate
npx prisma migrate deploy         # eller: npm run db:migrate (dev, opretter nye migrationer)
npm run dev                       # http://localhost:3000
npm run lint && npm run typecheck && npm test && npm run build && npm start
```
Lokal Postgres (uden Docker): `initdb` + `pg_ctl` (PG 16/17) – se nederst. Tests kræver Postgres via `DATABASE_URL`;
ethvert `?schema=` virker (PR-previews bruger `pr_<nr>`), ingen rå SQL med `public.`.

## Env
| Variabel | Brug |
|---|---|
| `DATABASE_URL` | Runtime (Supabase transaction pooler :6543 `?pgbouncer=true&connection_limit=1`; preview: `&schema=pr_<nr>`) |
| `DIRECT_URL` | `prisma migrate` (direkte :5432) |
| `APP_URL` | Absolutte URL'er (canonical, og:url, del-link). Host-headeren bruges aldrig. |
| `TEST_BASE_URL` / `TEST_PORT` / `TEST_SERVER=dev` | Kun tests: brug eksisterende server / port (3100) / `next dev` i stedet for build+start |

## Scripts (matcher deploy-pipelinen)
`dev`, `build`, `start`, `lint` (`next lint`), `typecheck` (`tsc --noEmit`), `test` (`vitest run`), `postinstall` (`prisma generate`), `db:migrate`, `db:deploy`.

## API
### Kun datoer (fra okt. 2026)
GrabAday bruger **kun hele datoer** – ingen klokkeslæt og ingen tidszoner. Datoer er rene strenge `YYYY-MM-DD` (DB: `time_options.date DATE`), formateres altid med `timeZone:'UTC'` (`fre. 16. okt. 2026`), så de vises ens i alle tidszoner.

### `POST /api/events`
Kræver `Content-Type: application/json` (ellers **415**). Valgfri `Idempotency-Key` (16–100 tegn `[A-Za-z0-9_-]`).
```json
{ "title": "Teammøde", "description": "valgfri", "options": [ { "date": "2026-10-16" }, { "date": "2026-10-14" } ] }
```
- `options`: **1–100** rigtige kalenderdatoer (skudår tjekkes: 2028-02-29 ok, 2027-02-29 400). Strengt `YYYY-MM-DD`.
- Fortid: accepterer datoer **≥ UTC i dag − 1 dag** (lempelig regel: ingen gyldig lokal "i dag" fra UTC−12 til UTC+14 afvises).
- **Dubletter afvises med 400** (`Dato 3: 2026-10-16 er valgt flere gange.`) – de fjernes ikke stille. Gemmes sorteret stigende.
- Den gamle body med `time_options:[{start,end}]` afvises med 400 – nye afstemninger er altid datoer.
- `title` trimmes, påkrævet (kun mellemrum/zero-width = tom), ≤ 200 **grafemer**; `description` ≤ 2000 grafemer. Aldrig afkortet – for langt = 400.
- **201**: poll-objekt (som GET) + `admin_token` (256 bit, base64url, 43 tegn) + `admin_url` (`/p/<id>/admin#<token>` – token i fragmentet, sendes aldrig til serveren), `Location: /p/<id>`, `Cache-Control: no-store`.
- **200 + `Idempotent-Replayed: true`**: samme nøgle igen → samme poll **og samme admin_token**. Valg: klienten har bevist at den kender nøglen, og tokenet ligger kun AES-GCM-krypteret under en nøgle afledt af den rå Idempotency-Key (DB gemmer kun `sha256(key)`), så en klient der mistede første svar kan få sit admin-link igen, mens en DB-dump hverken afslører nøgler eller tokens.
- **400** `{ errors: [...] }` (dansk) for alle ugyldige input inkl. forkerte typer/null-body; **413** JSON over 32 kB; **415** forkert content-type.

### `GET /api/events/:id`
```json
{ "id": "…22…", "slug": "…", "title": "…", "description": "", "created_at": "…Z", "closed_at": null, "is_closed": false,
  "chosen_option_id": null,
  "time_options": [ { "id": 1, "date": "2026-10-14", "position": 0 } ],
  "options": [ { "id": 1, "date": "2026-10-14" } ], "url": "/p/<id>", "participants": [] }
```
Ingen `timezone`. Aldrig tokens/hashes. 404 for ukendt eller forkert formateret id.

### Endelig dato og kalender
`.ics` (`GET /api/events/:id/ics`) er en **heldagsbegivenhed**: `DTSTART;VALUE=DATE:20261016`, `DTEND;VALUE=DATE:20261017` (eksklusiv), ingen TZID; UID (`<id>@grabaday.com`), SEQUENCE og LAST-MODIFIED som før (SEQUENCE stiger når den valgte dato ændres – også via PATCH). Google Kalender: `dates=20261016/20261017`. UI: "Den endelige dato er fre. 16. okt. 2026 (hele dagen)".

### Admin-API (alle: `Authorization: Bearer <admin_token>`, konstant-tids-tjek, `no-store`/`noindex`/`no-referrer`)
- `GET /api/events/:id/admin` → poll + `votes {yes,maybe,no,total}` pr. tidsforslag + `participants`. 401 uden token, 403 forkert/udskiftet.
- `PATCH /api/events/:id` → samme body og validering som opret (`options:[{id?, date}]`); eksisterende datoer sendes med `id` (beholdes, må flyttes; uændrede må ligge i fortiden), manglende slettes, nye oprettes. Dubletter → 400.
- `PATCH /api/events/:id/options/:oid` `{date, reset_votes}` → skift én dato (409 `duplicate_option`, 400 fortid). Sletning af tidsforslag med svar kræver `"confirm_remove_voted": true`, ellers **409** `{errors, voted_option_ids}`.
- `POST /api/events/:id/close` `{chosen_option_id?: number|null}` · `POST …/reopen` (nulstiller valgt tidspunkt) · `POST …/rotate-admin` → nyt `admin_token`/`admin_url` (det gamle dør straks; idempotent replay af oprettelsen returnerer derefter intet token).
- Alle skrivende kald (inkl. `POST /api/events`): kun `application/json` (415), maks. 32 kB (413), rate limit (token bucket pr. IP, burst 20, derefter 20/min; `RATE_LIMIT_CAPACITY`/`RATE_LIMIT_REFILL_PER_SEC`) → **429** JSON + `Retry-After`. Begrænsning: in-memory pr. serverless-instans (best effort); flyt til Postgres/Redis for et globalt loft.
- Offentlig GET har nu `chosen_option_id`.

### Afstemning (feature 3)
- `POST /api/events/:id/votes` `{name, votes:[{option_id, value:'yes'|'maybe'|'no'|null}]}` → **201** `{participant_id, edit_token, edit_url:"/p/<id>#edit=<token>", event}`. Valgfri `Idempotency-Key` (samme nøgle → samme deltager + token, 200). Navn: zero-width fjernes, trimmes, maks. 100 grafemer, unikt pr. afstemning uden hensyn til store/små bogstaver (NFKC) → **409** `code:"name_taken"`. Mindst ét svar. Lukket afstemning → **423** `code:"closed"` (tjekkes med rækkelås i transaktionen).
- `GET|PUT /api/events/:id/votes/me` med `Authorization: Bearer <edit_token>`: egne svar / erstat navn+svar (401/403/423/409/400).
- Offentlig GET har `participants:[{id,name,votes[]}]` (votes i samme rækkefølge som `time_options`, `null` = ikke svaret). Aldrig tokens/hashes.
- Redigeringstoken: kun SHA-256 i DB (256 bit → opslag på hash). Klienten gemmer `{token, participant_id}` i `localStorage` pr. afstemning, så "✎ Redigér" kun vises på egen række. Gammel `?edit=` → 302 til `#edit=`.

## Sider
- `/` opret · `/p/<id>` visning (SSR `<title>`/description/canonical/og/twitter, escaped) · `?created=1` åbner del-boksen med offentligt link + hemmeligt admin-link (vises én gang; overleveres via `sessionStorage`, aldrig i URL'en; luk uden "Jeg har gemt…" → `<dialog>`).
- `/p/<id>/admin#<token>` admin-UI (design admin.html): siden læser fragmentet, gemmer tokenet i `sessionStorage` (pr. fane), fjerner fragmentet fra adresselinjen og kalder API'et med Bearer. Redigér titel/beskrivelse/tidsforslag (advarsel ved sletning af tidsforslag med svar), luk/genåbn-dialog med valgfrit endeligt tidspunkt, nyt admin-link. Gammel form `/p/<id>/admin/<token>` → 302 til `#`-formen (no-store). Trailing-slash-redirects laves i middleware, så de også får sikkerhedsheaders. Lukkede afstemninger viser `closed-banner` på `/p/<id>`. Admin/`?edit=`-URL'er: `X-Robots-Tag: noindex, nofollow`, `<meta robots noindex>`, ingen OG/canonical, `Cache-Control: no-store`. Alle sider: `Referrer-Policy: no-referrer`, nonce-CSP.
- `/e/<id>` → 301 `/p/<id>` · ukendte stier/polls → venlig dansk 404.

## Datamodel (Prisma)
`Event(slug, title, description, adminTokenHash, createdAt, closedAt)`, `TimeOption(startAt, endAt UTC, position)`, `IdempotencyKey(keyHash, adminTokenEnc)`,
forberedt til afstemning (ingen API/UI endnu): `Participant(eventId, name, editTokenHash, createdAt, updatedAt)`, `Vote(participantId, timeOptionId, value yes|maybe|no)`. Ingen brugere/login.

## Lokal Postgres uden Docker
```bash
sudo apt-get install -y postgresql
/usr/lib/postgresql/17/bin/initdb -D /workspace/.pgdata/17 -U doodle --auth=trust
/usr/lib/postgresql/17/bin/pg_ctl -D /workspace/.pgdata/17 -o "-p 5432 -k /tmp" -l /workspace/.pgdata/pg.log start
createdb -h localhost -U doodle doodle_dev; createdb -h localhost -U doodle doodle_test
```

### Migration til kun datoer
`20261010235500_date_only` tilføjer `time_options.date`; `20261011003000_dates_only_drop_legacy` fjerner klokkeslæt helt (kører med `prisma migrate deploy`, ingen reset): manglende `date` udfyldes fra `(start_at AT TIME ZONE 'Europe/Copenhagen')::date`, rækker uden dato slettes, kolliderende dubletter (samme afstemning + dato) slettes med deres stemmer – laveste id beholdes, og et valgt dublet-forslag peges om til det beholdte. Derefter `date NOT NULL`, unik `(event_id, date)`, og `start_at`/`end_at`/`events.mode` droppes. `?tz` findes ikke længere.
