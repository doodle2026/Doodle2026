# E-mail (Resend) – rules and status

Code: `src/lib/email/` (`send.ts` adapter, `render.ts` templates, `policy.ts` who-gets-what). Templates come from
the design spec (doodle-ui) `email/` (`node scripts/sync-email-templates.mjs ../doodle-ui/email` regenerates `templates.ts` + `public/email-assets/`).
Env and Resend/DNS setup: see `docs/README-DEPLOY.md` "E-mail (Resend)".

Status legend: ✅ enforced in code + tested (this PR) · ⏳ step 4 "Invitations" (needs DB/endpoints/UI)

## Sending
- ✅ `EMAIL_MODE=log` (default) never calls Resend; logs a redacted summary only (masked address, no links/tokens/body).
- ✅ `EMAIL_MODE=send` without `RESEND_API_KEY`/`EMAIL_FROM` → config error logged once at startup, `send()` returns `{ok:false}`; never throws, never logs secrets.
- ✅ One message per recipient (never a shared `To`); many recipients via Resend batch (≤ 100 per call).
- ✅ Idempotency keys `invite:<poll>:<email>` / `reminder:<poll>:<email>`.
- ✅ From = app address (`EMAIL_FROM`) with display name `"<organizer name> via GrabAday"`; organizer name is optional and sanitized (quotes, angle brackets, CR/LF/control/invisible chars, `@`, URLs/domains stripped; ≤ 50 graphemes).
- ✅ No per-message Reply-To (organizer e-mail is unverified); only the optional global `EMAIL_REPLY_TO`.
- ✅ Header values are single-line (no header injection); `List-Unsubscribe` + `List-Unsubscribe-Post: One-Click` when an unsubscribe URL is given.
- ✅ Only the public `/p/<id>` link in mails – render throws on any admin/edit link (also in description/personal text).
- ✅ Subject: plain text, one line, title clipped to 60 graphemes. HTML escapes all user values; plain text is not HTML-escaped.
- ⏳ No tracking: turn **off open and click tracking** for the sending domain in Resend (domain setting, not per API call). Templates contain no tracking pixels.

## Invitations (step 4) – implemented
API (all admin-token, JSON): `GET /api/events/:id/invitations` (status list, limits, reminder state),
`POST /api/events/:id/invitations` `{ recipients: string | string[], message?, organizer_name? }`,
`POST /api/events/:id/invitations/preview` (renders the real mail, sends nothing), `POST /api/events/:id/reminders`.
- ✅ Organizer only (admin token, constant-time). Addresses parsed (`Name <email>`, comma/semicolon/space/newline), validated, deduped, already-invited skipped (`src/lib/recipients.ts`).
- ✅ ≤ 50 recipients per send, ≤ 200 per poll, ≤ 100 new recipients per poll per hour (DB), ≤ 10 sends per IP per hour (in-memory, best effort on serverless), global quota 100/day and 3 000/month reserved atomically (Postgres advisory lock, `email_quota`); failed sends give the quota back.
- ✅ Personal message: plain text, ≤ 1 000 graphemes ("Beskeden er N tegn for lang."), control/bidi chars stripped, escaped by the template, rejected if it contains admin/edit/invite links.
- ✅ From: `"<organizer> via GrabAday" <EMAIL_FROM address>`, sanitized name, **no Reply-To**; open/click tracking off (no pixels); one mail per recipient (batch API), idempotency key `invite:<pollId>:<email>`.
- ✅ Only the public `/p/<id>` link (render guard throws on admin/edit links).
- ✅ Per-recipient delivery status: queued → sent → delivered / failed / bounced / unsub, shown in the admin view with filters.

## Reminders – implemented
- ✅ Manual; per poll max one per 24 h and 3 in total; none to closed polls; counter bumped under a row lock (`SELECT … FOR UPDATE`) so parallel clicks can't exceed the limits.
- ✅ Go to all non-unsubscribed, non-bounced invitees (design §39; §43 resolved, see below). Button and dialog say so.

### §43 decision
§43 asked whether reminders go to *all non-unsubscribed* (spec) or *only those who haven't answered* (project lead). §30 (personal links) resolves it:
without tracking we cannot know who answered, so step 4 sends to **all non-unsubscribed, non-bounced** invitees with the neutral
"Har du svaret?" mail (safest: nobody who still has to answer is missed, nothing claims "du mangler at svare" wrongly). With tracking
(step 5) reminders go only to invitees who haven't answered.

## Unsubscribe, abuse, privacy – implemented
- ✅ Every mail: "Afmeld denne afstemning" (`/u/p/<t>`), "Afmeld alle mails" (`/u/all/<t>`), "Rapportér misbrug" (`/abuse/<t>`) + privacy line.
  `<t>` = HMAC(`EMAIL_LINK_SECRET`, invitation id) – stable across invitation and reminders; DB stores only SHA-256(t).
- ✅ `List-Unsubscribe: <APP_URL/api/u/p/<t>>` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058 POST).
  The landing page unsubscribes via JS POST (link scanners that only GET do nothing); "all" needs one confirm click; both can be undone.
  Landing pages and `GET /api/u/p/<t>` show the address masked (`a•••@example.com`), never in full.
- ✅ Suppression list (`email_suppressions`) stores only SHA-256(pepper + normalized address) with scope `all` or `poll:<id>`; checked before every invitation and reminder. Hard bounces and spam complaints add an `all` entry.
- ✅ Abuse reports stored (reason + optional text, no address); by default also unsubscribes; after 2 reports for a poll, its mail is stopped (`mail_blocked_at`).
- ✅ Addresses deleted with the poll (FK cascade) or 90 days after close by `GET|POST /api/cron/cleanup` (Bearer `CRON_SECRET`, constant-time, idempotent), scheduled daily 03:17 UTC in `vercel.json`. Suppression hashes and abuse reports contain no addresses and are kept.
- ✅ Resend webhooks `POST /api/webhooks/resend`, Svix signature verified (`RESEND_WEBHOOK_SECRET`, ±5 min), status never downgraded.

### Env (Deployment)
| Var | Where | Notes |
|---|---|---|
| `CRON_SECRET` | Vercel (prod) | ≥ 16 chars random; Vercel cron sends it as `Authorization: Bearer …`. GitHub Action alternative: `curl -fsS -H "Authorization: Bearer $CRON_SECRET" $APP_URL/api/cron/cleanup` |
| `EMAIL_LINK_SECRET` | Vercel (prod, preview if sending) | ≥ 32 chars; **never rotate** (old unsubscribe links would break) |
| `RESEND_WEBHOOK_SECRET` | Vercel (prod) | `whsec_…` from Resend → Webhooks; endpoint `https://<domain>/api/webhooks/resend` |
| `EMAIL_HASH_PEPPER` | optional | set once, never change |
| `EMAIL_DAILY_QUOTA` / `EMAIL_MONTHLY_QUOTA` / `EMAIL_POLL_HOURLY_MAX` / `RATE_LIMIT_MAIL_PER_HOUR` | optional | defaults 100 / 3000 / 100 / 10 |

## Personal invite links (step 5) – implemented
- Opt-in per send ("Spor hvem der har svaret", off by default); once used, `events.invite_tracking` stays on (sent links stay valid until revoked).
- Mail link: `/p/<id>#inv=<token>` (fragment, never sent to servers except as `Authorization: Bearer` to `GET /api/events/:id/invite`; `#invite=` also accepted). The page strips the fragment, keeps the token in sessionStorage for the tab, shows "Du er inviteret som <email>" + "Ikke dig? Brug det offentlige link", and prefills the name (organizer-given name, else the address' local part) – editable.
- Token = HMAC(`EMAIL_LINK_SECRET`, invitation id + generation); DB stores only SHA-256(token).
- **Deviation (documented):** "Gensend link" issues a **new token** (generation + 1) – the old link stops working – because only the hash is stored. Reminders re-derive the *current* token, so they carry a working personal link.
- Revoke: link stops at once, an existing answer is kept (not editable via the link), optional `reissue: true` sends a new link; UI then offers "Send nyt link".
- A vote with `X-Invite-Token` marks that invitee "Svaret" (first answer wins; a link from another poll is ignored). Deleting the participant reverts to "Inviteret".
- Public answers are listed as "Ikke inviteret" when tracking is on; organizer can link one to an unanswered invitee (dialog with select, validation, 8 s "Fortryd" toast); only manual links can be undone.
- Status axes: Levering (queued/sent/delivered/failed/bounced/unsub) and Svar (invited/answered/revoked) – no "opened" status.
- Reminders with tracking: only tracked invitees without an answer and with a live link, plus untracked invitees (unknown), never unsubscribed/bounced.
- Not built: drag-and-drop linking (dropdown is the accessible path; design marks DnD as optional desktop enhancement).
- Admin API: `POST /api/events/:id/invitations/{resend|revoke|link|unlink}` `{ email, reissue?, participant_id? }`.

## Business tasks (Jan)
- Resend DPA, sending region Ireland (eu-west-1) and note that Resend stores account data/logs in the US.
- Privacy policy text covering invitee addresses, retention (90 days after close) and unsubscribe.

## Rename to GrabAday
- From display: `"<name> via GrabAday" <EMAIL_FROM address>`; address only from `EMAIL_FROM`. All mail links come from `APP_URL` at render time (templates contain only `{{appUrl}}`, `{{pollUrl}}`, `{{assetBaseUrl}}`, footer URL placeholders).
- `.ics`: `PRODID:-//GrabAday//GrabAday//DA`, UID `<slug>@grabaday.com` (fixed domain, independent of APP_URL so UIDs stay stable across preview / vercel.app / custom domain; existing UIDs changed once – no real users yet).
- Internal crypto domain-separation labels (`moedetid-email-v1`, `moedetid-inv-link-v1`, `moedetid-invite-v1`, `moedetid-idem-v1`) are intentionally unchanged: renaming them would invalidate stored suppression hashes, sent unsubscribe/invite links and idempotency keys. They are never shown to users.
- `scripts/sync-email-templates.mjs` rewrites any leftover `Mødetid`/`moedetid.dk` on sync as a safety net.

## Kun datoer (okt. 2026)
- Skabelonerne er synket fra doodle-ui (`dates:[{dateLabel}]`; `slots`/`timeZoneLabel` er fjernet). `dateLabel` = `fre. 16. okt. 2026` (UTC-formattering, ens i alle tidszoner). Ældre tidsforslag får `… kl. 09:00–10:00` (Europe/Copenhagen) i samme label.
- `trackingEnabled` sendes med i data. **Kendt skabelonfejl upstream:** reminder-footeren siger altid "Påmindelser sendes til alle inviterede, der ikke har afmeldt sig." – også når sporing er slået til (så går de kun til dem, der ikke har svaret). `scripts/sync-email-templates.mjs` retter det i vores kopi med en `{{#trackingEnabled}}…{{/trackingEnabled}}{{^trackingEnabled}}…{{/trackingEnabled}}`-sektion. **Doodle UI bør** indføre samme sektion i `email/src/build.js`, så omskrivningen kan fjernes.

## EMAIL_MODE=capture (tester only)

Shows the FULL rendered mails (incl. personal invite tokens and unsubscribe links) without sending anything.

- Run `npm run start:capture` → http://localhost:3001 (custom server = `next dev` with `NODE_ENV=test`, test DB from `.env.test`
  unless `DATABASE_URL` is set, separate dist dir `.next-capture`; :3000 is untouched). Local defaults for EMAIL_FROM,
  EMAIL_LINK_SECRET and high quotas are set by the script.
- Every mail is kept in memory (last 1000) and appended as one JSON line to `EMAIL_CAPTURE_FILE`
  (default `./.email-capture/mails.jsonl`, gitignored): `{id, at, from, to[], subject, text, html, replyTo, headers, tags, idempotencyKey}`.
- `GET /api/test/mails[?to=address]` → `{count, mails}`; `DELETE /api/test/mails` clears memory (file kept).
  Both return 404 unless capture is active.
- Hard gate (runtime): capture only when `NODE_ENV=test` AND `VERCEL` unset AND `VERCEL_ENV` not preview/production AND the
  code is not a production build (`next build` output is always refused, even if started with `NODE_ENV=test`).
  Otherwise: config error logged, mailer falls back to `log` mode (redacted), nothing is sent or captured.
  The test suite runs its production test server with `EMAIL_MODE=capture` to prove this.

## "Send til e-mails" on the confirmation page (phase 1)
- Same endpoint/model/limits/suppression: `POST /api/events/:id/invitations` (admin Bearer) with one recipient per click; `locale` = creator's UI language.
- Response adds `results: [{ email, status }]` (`sent` | `failed` | `unsub` | `already_invited` | `duplicate`); `GET` adds `quota: { poll_remaining, hour_remaining, day_remaining }`.
- `POST /api/events/:id/invitations/retry { email }`: re-send a **failed** invitation unchanged (same link, tracking unchanged).
- The box shows only in the organizer's tab: the admin token from the creation hand-over is kept in the tab's sessionStorage (same key the admin page uses). Status re-polls every 20 s while visible. UI is a placeholder until Doodle UI's design.
