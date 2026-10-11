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
`src/lib/client-ip.ts` is the only place the IP is read: `x-vercel-forwarded-for` → `x-real-ip` → the **rightmost** `x-forwarded-for` entry (after skipping `TRUSTED_PROXY_HOPS` own proxies, default 0). The leftmost XFF entry is client-controlled and is never used.
