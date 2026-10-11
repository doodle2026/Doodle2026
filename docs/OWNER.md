# Owner dashboard – access (PR A)

The owner dashboard (`/{locale}/owner`) is for the owner and ops only. Poll users never have accounts and there is no public sign-up.

## Create the first owner (also on prod)

```bash
# local / test DB
npm run owner:create -- --username jan
# prompts for the password twice, without echo (min. 12 characters)

# production (Doodle Deployment): run from a checkout of main with the prod DB URL in the environment only
DATABASE_URL='<prod connection string>' npm run owner:create -- --username jan
```

- Without a TTY (CI), the password is read from the **first line of stdin**, for example `printf '%s\n' "$PW" | npm run owner:create -- --username jan` from a secret store. Never pass it as an argument or in an env var. The script never prints or logs it.
- `--reset` sets a new password for an existing user and logs that user out everywhere.
- Migration `20261011180000_owner_auth` (additive: `owner_users`, `owner_sessions`, `owner_login_log`) must be deployed first (`prisma migrate deploy`, as usual).

## Required env (production / preview)

| Var | |
|---|---|
| `OWNER_SESSION_SECRET` | ≥ 32 random characters (`openssl rand -base64 48`). It signs the session cookie and derives CSRF tokens. If it is missing on https deployments, owner login answers 503 and nothing else is affected. Rotating it logs everyone out. |

## Security model

- **Passwords:** argon2id (`@node-rs/argon2`), m = 19456 KiB, t = 2, p = 1 (OWASP minimum), min. 12 characters.
- **Sessions:** 256-bit random id in the DB as SHA-256 only. The cookie is `__Host-ga_owner=<id>.<HMAC>` (HttpOnly, Secure, SameSite=Strict, Path=/). Sessions expire 12 h after creation (absolute) or after 2 h without activity (idle). Each login issues a new id and destroys the old one; logout deletes the session.
- **CSRF:** SameSite=Strict, plus a same-origin check (Origin / Sec-Fetch-Site), plus a token in `X-CSRF-Token`:
  - Login uses a double-submit token from `GET /api/owner/csrf`.
  - After login, the token is HMAC(secret, session) from `GET /api/owner/me`.
  - All state-changing `/api/owner/*` routes require it, and the APIs are JSON-only (415).
- **Login protection:**
  - Unknown user and wrong password give the same message ("Forkert brugernavn eller password"), with the same timing (argon2 verify against a dummy hash).
  - 5 failed logins in 15 minutes per IP **or** per username lock the login for that IP (truncated, see below) or username until the window frees up (429 + Retry-After). The count comes from the audit table, so it works on serverless.
  - Note: the per-username lock means someone who knows the username can keep it locked out. This is accepted (spec), and the owner can wait 15 minutes or use another account.
- **Audit:** `owner_login_log` records every success, failure, lockout, CSRF rejection and logout with **truncated** IP (PM: IPv4 /24 → `a.b.c.xxx`, IPv6 /48; truncated before storage, so the full IP is never stored), user agent and time. It never records the password.
- **Headers:** `/{locale}/owner*` and `/api/owner/*` send `Cache-Control: no-store, private`, `X-Robots-Tag: noindex, nofollow` and `Referrer-Policy: no-referrer`. No admin, edit or invite tokens and no session ids are ever shown or returned.
- **Later (spec, phase 2):** TOTP 2FA.

## Client IP (all rate limits, login lock, audit log)
`src/lib/client-ip.ts` is the only place the IP is read.

- **On Vercel** (`VERCEL` is set by the platform): `x-vercel-forwarded-for` → `x-real-ip` → rightmost `x-forwarded-for`. Vercel's edge overwrites these, so clients cannot forge them.
- **Anywhere else** those headers are client-controlled and are **ignored**:
  - `TRUSTED_PROXY_HOPS=N` is the number of reverse proxies *you* run in front of the app, each appending to `X-Forwarded-For`. The client IP is the N-th entry from the right, i.e. the one your outermost proxy appended. Example: nginx → app is `1`; Cloudflare → nginx → app is `2`.
  - With `TRUSTED_PROXY_HOPS` unset or `0`, no header is trusted: the socket address is used if the runtime exposes it, else `unknown`. That means one shared bucket, which fails closed.
  - Tests and `.env.test` use `1` (the test client plays the proxy).
- The leftmost `X-Forwarded-For` entry is never used.

## Login throttling (M3) and `owner:unlock`
Everything is derived from `owner_login_log`, so it works on serverless. Values are in `src/lib/owner/auth.ts`.

| Limit | Rule | Purpose |
|---|---|---|
| username + IP (IP truncated /24 or /48) | 5 free failures, then exponential backoff from the last failure: 60 s, 2 min, 4 min … capped at **60 min**. Counted over 24 h since that pair's last successful login or the username's last unlock. | Guessing from one network. Someone else's IP can't lock the owner out. |
| IP (any usernames) | **20** failures in **15 min** → wait until the window frees | Password spraying |
| username from all IPs | **100** failures in **1 h** → wait until the window frees | Distributed attacks (high ceiling) |

Lift a lock (e.g. the ceiling was hit):

```bash
DATABASE_URL='<prod direct URL>' npm run owner:unlock -- jan
```

- The command writes an `unlock` row to the audit log (activity log type "Unlocked (CLI)", with the OS user in the user-agent field). After that, the username's earlier failures stop counting for the pair backoff and the ceiling.
- Nothing is deleted.
- The per-IP spraying limit is not affected.
- Exit codes: 0 = unlocked, 1 = unknown user, 2 = usage.

## Time zones in the dashboard
- Timestamps (log, lists, detail, "Updated", "resets at") are shown client-side in the **viewer's local time** with a zone label. The server render shows UTC until the page hydrates.
- "Today", the per-day counts and charts, and the email quota all use the **UTC day**, as stated on each page.
- Calendar dates (date options, final date, purge date) are plain dates with no time zone.
