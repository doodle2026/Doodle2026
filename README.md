# Mødetid – Doodle-lignende mødeplanlægger (feature 1: opret afstemning)

Next.js 15 (App Router, TypeScript) · Prisma 6 · PostgreSQL · design fra `/workspace/doodle-ui` (`public/styles.css` uændret).
Deploy: Vercel `fra1` + Supabase Postgres (Frankfurt) via `.github/workflows` (se `/workspace/doodle-deploy`).

## Kom i gang
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
### `POST /api/events`
Kræver `Content-Type: application/json` (ellers **415**). Valgfri `Idempotency-Key` (16–100 tegn `[A-Za-z0-9_-]`).
```json
{ "title": "Teammøde", "description": "valgfri",
  "time_options": [ { "start": "2026-11-03T09:00:00+01:00", "end": "2026-11-03T10:00:00+01:00" }, { "start": "2026-11-04T08:00:00Z" } ] }
```
- `start`/`end`: ISO 8601 **med offset**; gemmes i UTC. `end` valgfri, skal være efter `start`. Ingen tider i fortiden.
- `title` trimmes, påkrævet (kun mellemrum/zero-width = tom), ≤ 200 **grafemer**; `description` ≤ 2000 grafemer. Aldrig afkortet – for langt = 400.
- 1–100 tidsforslag; dubletter (samme UTC-start+slut) fjernes.
- **201**: poll-objekt (som GET) + `admin_token` (256 bit, base64url, 43 tegn) + `admin_url` (`/p/<id>/admin/<token>`), `Location: /p/<id>`, `Cache-Control: no-store`.
- **200 + `Idempotent-Replayed: true`**: samme nøgle igen → samme poll **og samme admin_token**. Valg: klienten har bevist at den kender nøglen, og tokenet ligger kun AES-GCM-krypteret under en nøgle afledt af den rå Idempotency-Key (DB gemmer kun `sha256(key)`), så en klient der mistede første svar kan få sit admin-link igen, mens en DB-dump hverken afslører nøgler eller tokens.
- **400** `{ errors: [...] }` (dansk) for alle ugyldige input inkl. forkerte typer/null-body; **413** JSON over 32 kB; **415** forkert content-type.

### `GET /api/events/:id[?tz=<IANA>]`
```json
{ "id": "…22…", "slug": "…", "title": "…", "description": "", "created_at": "…Z", "closed_at": null, "is_closed": false,
  "time_options": [ { "id": 1, "start_at": "…Z", "end_at": "…Z", "position": 0 } ],
  "timezone": "UTC", "options": [ { "date": "2026-11-03", "start": "08:00", "end": "09:00" } ], "url": "/p/<id>" }
```
Aldrig tokens/hashes. 404 for ukendt eller forkert formateret id.

## Sider
- `/` opret · `/p/<id>` visning (SSR `<title>`/description/canonical/og/twitter, escaped) · `?created=1` åbner del-boksen med offentligt link + hemmeligt admin-link (vises én gang; overleveres via `sessionStorage`, aldrig i URL'en; luk uden "Jeg har gemt…" → `<dialog>`).
- `/p/<id>/admin/<token>` minimal verifikationsside (admin-UI kommer senere). Admin/`?edit=`-URL'er: `X-Robots-Tag: noindex, nofollow`, `<meta robots noindex>`, ingen OG/canonical, `Cache-Control: no-store`. Alle sider: `Referrer-Policy: no-referrer`, nonce-CSP.
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
