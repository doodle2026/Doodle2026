# Deployment – GrabAday scheduler (Next.js + Prisma) on free tiers

Personal, non-commercial app. Stack: **GitHub Free (private repo) + Vercel Hobby (fra1) + Supabase Free (2 projects, eu-central-1 Frankfurt)**.

## Architecture
- Vercel functions pinned to `fra1` (`vercel.json`), DB in Supabase Frankfurt → low latency, data stays in the EU.
- Prisma: `DATABASE_URL` = Supavisor *transaction* pooler (:6543, `?pgbouncer=true&connection_limit=1`) for serverless runtime;
  `DIRECT_URL` = *session* pooler (:5432) for `prisma migrate`, keep-alive and backups. See `prisma-datasource.snippet.prisma`.
- Supabase projects: `doodle-prod` and `doodle-staging` (Free allows exactly 2 active projects).
- **Preview DBs:** each PR gets its own Postgres schema `pr_<n>` in the staging project (`?schema=pr_<n>`), migrated with
  `prisma migrate deploy`, dropped (`DROP SCHEMA … CASCADE`) on PR close. Supabase Branching is Pro-only and uses
  `supabase/migrations`, so it's not an option here. Limits: only Prisma tables are isolated (not Supabase Auth/Storage);
  raw SQL must not hard-code `public.`.

## Free-tier limits to know
| Service | Limit | Mitigation |
|---|---|---|
| Supabase Free | Project **paused after ~7 days of inactivity** | `keep-alive.yml` runs `select 1` on both projects every 3 days (nightly backup also touches prod). Paused projects can be restored from the dashboard. |
| Supabase Free | **500 MB database** per project, 5 GB egress, shared CPU | Plenty for polls; check usage in dashboard. Drop stale `pr_*` schemas if a cleanup job ever fails. |
| Supabase Free | **No automatic backups / PITR** | `backup.yml` nightly `pg_dump` → Actions artifact (14 days). Download important ones off-site occasionally. |
| Supabase Free | Max ~60 direct connections, pooler limits | Transaction pooler + `connection_limit=1`. |
| Vercel Hobby | **Single user, non-commercial only**; 100 GB bandwidth, function time limits | Fine for a personal app. If it becomes commercial or you add collaborators → Vercel Pro. Hobby can't add team members to the project. |
| GitHub Free (private) | **2,000 Actions minutes/month**, 500 MB artifact/package storage; no environment secrets/required reviewers on private repos | Budget below; repository secrets only. |

## Actions minutes estimate (per month)
Linux jobs bill per job, rounded up to the next minute. Assumes ~10 PRs/month with ~4 pushes each, ~10 merges.
| Workflow | Per run | Runs/month | Minutes |
|---|---|---|---|
| ci.yml (PR pushes + main) | ~4 | 40 + 10 | ~200 |
| deploy-preview.yml (deploy) | ~4 | 40 | ~160 |
| deploy-preview.yml (cleanup) | 1 | 10 | ~10 |
| deploy-production.yml | ~4 | 10 | ~40 |
| keep-alive.yml | 1 | ~10 | ~10 |
| backup.yml | ~1–2 | 30 | ~45 |
| **Total** | | | **≈ 465 / 2,000** |
Even a busy month (3× PR activity) stays around ~1,300. Check *Settings → Billing → Usage*.

**Artifact storage:** dump of a small poll DB is typically < 1 MB gzipped → 14 × ~1 MB ≪ 500 MB. If the DB grows, lower `retention-days`.
Note that artifact storage is shared with other artifacts/caches (npm cache uses the separate 10 GB Actions cache).

## Files
- `.github/workflows/ci.yml` – PR + main: `npm ci`, lint, typecheck, `prisma migrate deploy` against a Postgres 16 service, tests, build
- `.github/workflows/deploy-preview.yml` – per PR: schema `pr_<n>` in staging → migrate → Vercel preview → PR comment; drop schema on close
- `.github/workflows/deploy-production.yml` – push to main: `prisma migrate deploy` (PROD_DIRECT_URL) → `vercel deploy --prod`
- `.github/workflows/keep-alive.yml` – every 3 days 06:23 UTC + manual: `select 1` on prod + staging
- `.github/workflows/backup.yml` – nightly 03:17 UTC + manual: `pg_dump -Fc` (postgres:17 client in Docker) → gzip → optional gpg → artifact, 14 days
- `vercel.json` (region fra1, Vercel git auto-deploy off), `.env.example` (DATABASE_URL, DIRECT_URL, APP_URL), `docs/github-secrets.md`

Scheduled workflows only run from the default branch, and GitHub disables them after 60 days without repo activity – push something or re-enable in the Actions tab.

## package.json scripts (present in this repo)
`dev`, `build`, `start`, `lint` (`next lint`), `typecheck` (`tsc --noEmit`), `test` (`vitest run`), `postinstall` (`prisma generate`),
`db:migrate` (`prisma migrate dev`), `db:deploy` (`prisma migrate deploy`). Node 20 (`engines.node >=20.9`).

CI runs `npm ci → lint → typecheck → db:deploy → test`. The vitest global setup itself runs `prisma migrate deploy`,
`next build` (into `.next-test`, production mode) and `next start`, so the test step is also the build check; there is
no separate `npm run build` in CI. On failure the test server log is uploaded as an artifact (3 days).
Locally, `TEST_SERVER=dev npm test` is faster (skips the build).

## Layout
```
prisma/schema.prisma, prisma/migrations/   # provider postgresql, url + directUrl
src/app/…, src/middleware.ts, src/lib/…     # Next.js App Router, API route handlers
tests/                                      # vitest black-box HTTP tests (need Postgres via DATABASE_URL)
.github/workflows/, vercel.json, docs/
```

## Secret URLs and logging (admin links, participant edit links)
Admin links (`/p/<id>/admin/<token>`) and participant edit links (`?edit=<token>`) carry bearer tokens in the URL.
- App: no request logging; the only server log line (`POST /api/events failed`) logs error name/code only. The test
  suite asserts no tokens reach the server log. `src/middleware.ts` already sends `Referrer-Policy: no-referrer` on all
  pages, plus `Cache-Control: no-store, private` and `X-Robots-Tag: noindex, nofollow` on secret URLs, so no extra header
  in `vercel.json` is needed.
- **Vercel request logs record the full path (and query) of every request; this can't be disabled.** On Hobby, runtime logs
  are kept for ~1 hour and are visible only to the account owner. Treat that as accepted risk, or move tokens out of the path (below).
- Don't add analytics/monitoring that captures full URLs (Vercel Web Analytics, GA, Sentry breadcrumbs) unless it strips
  `/admin/*` paths and `edit` query params. Vercel Speed Insights records route paths; avoid it or filter.
- Recommended app changes (for the developer, not done here):
  1. Put the admin token in the URL **fragment** (`/p/<id>/admin#<token>`) and send it to the API in a header/body. Fragments are never sent to servers, so they never reach logs. This is the strongest fix.
  2. Alternatively, on first visit exchange the path token for an HttpOnly, SameSite=Strict cookie and redirect to a token-free `/p/<id>/admin`. Then only the first request is logged.
  3. Same for `?edit=` participant links.
  4. Hash-compare tokens in constant time (already hashing with SHA-256) and allow rotating/revoking an admin link.

## Setup steps
1. Supabase (Free): create `doodle-prod` and `doodle-staging` in **Central EU (Frankfurt)**. Note the Postgres version (`select version();`) – backup uses a PG 17 client, which can dump 15 and 17.
2. In each project's SQL editor create a dedicated role (Supabase Prisma guide):
   `create user "prisma" with password '<strong>' bypassrls createdb; grant "prisma" to "postgres";` plus grants on schema `public`.
   On staging also: `grant create on database postgres to prisma;` (to create `pr_<n>` schemas).
3. Optionally disable the Data API (PostgREST) if only Prisma is used.
4. Dashboard → Connect: copy transaction pooler (:6543) and session pooler (:5432) URLs (user `prisma.<ref>`).
5. Vercel (Hobby): import the repo, Function Region `fra1`; `vercel link` locally for org/project IDs; set Production env vars.
6. GitHub: create the private repo, add repository secrets (`docs/github-secrets.md`), protect `main` with required status check `CI / verify`
   (branch protection works on private repos only with GitHub Pro – on Free, just self-discipline: merge only green PRs).
7. Commit files, open a PR → CI + preview; merge → prod migration + deploy. Run `keep-alive` and `backup` once manually.

## Restore from backup
```bash
gh run download <run-id> -n doodle-prod-<STAMP>          # or download from the run page
gpg -d doodle.dump.gz.gpg > doodle.dump.gz               # only if BACKUP_PASSPHRASE was used
gunzip doodle.dump.gz
pg_restore --list doodle.dump | head                     # inspect
# Restore into a target DB (use DIRECT/session URL; PG 17 client):
pg_restore --dbname "$TARGET_DIRECT_URL" --no-owner --no-privileges --clean --if-exists --single-transaction doodle.dump
```
Test a restore into the staging project (or local Docker Postgres) now and then.

## E-mail (Resend)
**Plan (Free, checked Oct 2026):** 3,000 e-mails/month, **100/day** (UTC day; each To/CC/BCC recipient counts), up to 3 verified domains,
30-day log retention. Sending region selectable on Free: choose **Ireland (eu-west-1)**. Note: Resend stores account data,
logs and metadata in the US regardless of sending region (US company – fine for this personal app; mention in privacy note).

**A domain is required.** Without a verified domain Resend only lets you send from `onboarding@resend.dev` to the account
owner's own address, i.e. no mails to friends. Options: a cheap `.dk` (~75–100 kr/yr) or a subdomain of a domain you already own.
Use a sending subdomain (`mail.<domain>`) to keep reputation separate from the root domain.

**Setup**
1. resend.com → Domains → Add domain `mail.<domain>`, region **Ireland (eu-west-1)**.
2. Add the DNS records Resend shows at your DNS host (template below; copy exact values from the dashboard), then *Verify*.
3. API Keys → create key, permission **Sending access**, domain `mail.<domain>`.
4. Set Vercel Production env (Jan sets via API/dashboard): `RESEND_API_KEY` (Sensitive), `EMAIL_MODE=send`,
   `EMAIL_FROM="GrabAday <noreply@mail.<domain>>"`, optional `EMAIL_REPLY_TO`. Redeploy production.

**DNS record template** (host names relative to `<domain>`; Resend's dashboard is authoritative):
| Type | Name / host | Value | Priority | Purpose |
|---|---|---|---|---|
| MX | `send.mail` | `feedback-smtp.eu-west-1.amazonses.com` | 10 | Return-Path / bounces |
| TXT | `send.mail` | `v=spf1 include:amazonses.com ~all` | – | SPF |
| TXT | `resend._domainkey.mail` | `p=MIGfMA0GCSqGSIb3…` (DKIM public key from dashboard) | – | DKIM |
| TXT | `_dmarc` | `v=DMARC1; p=none;` | – | DMARC (optional, recommended; tighten to `p=quarantine` later) |

**Modes:** `EMAIL_MODE=log` (default locally and on every preview) never calls Resend; the app logs a redacted summary
(template name, recipient domain/masked address, poll id), never tokens or full admin/edit links. `EMAIL_MODE=send` only
in production. Notification mails contain secret links, so they must not be logged in full there either.

## GDPR
Data is hosted in the EU (Vercel fra1, Supabase Frankfurt). As a personal, non-commercial app a formal DPA isn't required;
if it ever becomes commercial or processes others' data on behalf of an organisation, sign the Supabase DPA
(Dashboard → Organization → Legal Documents) and Vercel's DPA, and move to paid plans.

## Accounts / access needed
- GitHub account with a private repo (Free)
- Vercel Hobby account + access token
- Supabase Free organization with 2 projects + `prisma` role passwords
- Resend (Free) account, API key, and a domain you control DNS for (sending subdomain mail.<domain>)
