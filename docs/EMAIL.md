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
- ✅ From = app address (`EMAIL_FROM`) with display name `"<organizer name> via grabAday"`; organizer name is optional and sanitized (quotes, angle brackets, CR/LF/control/invisible chars, `@`, URLs/domains stripped; ≤ 50 graphemes).
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
- ✅ From: `"<organizer> via grabAday" <EMAIL_FROM address>`, sanitized name, **no Reply-To**; open/click tracking off (no pixels); one mail per recipient (batch API), idempotency key `invite:<pollId>:<email>`.
- ✅ Only the public `/p/<id>` link (render guard throws on admin/edit links).
- ✅ Per-recipient delivery status: queued → sent → delivered / failed / bounced / unsub internally. The admin view and API never say why an address can't receive mail: bounced and unsubscribed both show the neutral "⊘ Kan ikke sendes til denne adresse" (`blocked`, filter "Kan ikke sendes"). The text "Modtageren har frabedt sig mails" is not used anywhere.

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

## Rename to grabAday
- From display: `"<name> via grabAday" <EMAIL_FROM address>`; address only from `EMAIL_FROM`. All mail links come from `APP_URL` at render time (templates contain only `{{appUrl}}`, `{{pollUrl}}`, `{{assetBaseUrl}}`, footer URL placeholders).
- `.ics`: `PRODID:-//grabAday//grabAday//DA`, UID `<slug>@grabaday.com` (fixed domain, independent of APP_URL so UIDs stay stable across preview / vercel.app / custom domain; existing UIDs changed once – no real users yet).
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

### PM decisions (Send til e-mails)
- Opted-out addresses are never revealed: per-address result `blocked` (UI: `se.blocked` "Kan ikke sendes til denne adresse"), same HTTP 201 and response shape as a normal send, minimum response time 400 ms + jitter, and the address is **not stored** (so the admin list can't reveal it either). No pre-check endpoint reports opt-outs. Retry of a now-suppressed address answers 409 `blocked`.
- Duplicates in the form are marked with their line number; quota (poll/hour/day) is returned by GET and every POST; one combined response per call.
- Tracking: the box doesn't send `track`; the server uses the poll's `inviteTracking` (changed only in admin).
- Data shape per design §46.8: GET and every POST return `remaining: {poll, hour, day}` and `invitations: [{email, status: sent|delivered|failed|blocked}]` (PM decision 11 Oct: bounced and unsubscribed are both the neutral `blocked` here too, so the box never says 'Afvist'); POST adds `results: [{email, status: sent|failed|blocked}]`; 429s carry `remaining` too. (Legacy `quota.*_remaining` kept for the admin view.)
- Admin never shows 'Afmeldt': the admin API maps unsub and bounced to the neutral `blocked` ('⊘ Kan ikke sendes til denne adresse', filter 'Kan ikke sendes'); the DB keeps the distinction.
- Per-IP mail limit: `RATE_LIMIT_MAIL_PER_HOUR` default **150 calls/hour/IP** (was 10; one call per address in the box). Every 429 carries `Retry-After` (+ `retry_after`, `code`: ip_limit | poll_hourly_limit | quota). UI shows `se.limitIp` with a local minute countdown, no auto-resend (§46.9).

### Send til e-mails – phase 2 ("Indsæt mange", §46.7)
- Toggle "Én ad gangen" / "Indsæt mange" (remembered in localStorage `ga-se-mode`). One field accepts `;`, `,`, newlines and Outlook `Name <x@y>`.
- Overview is computed client-side only (format, duplicates, already invited) – there is **no pre-check endpoint**, so opt-outs only appear as the neutral `blocked` after sending.
- "Send til N" = ONE `POST /invitations` with ≤50 recipients; all chips show "Sender…" until the combined response (`results[]`, `remaining`). >50 and remaining quota are refused before sending.
- "Prøv de fejlede igen" = ONE `POST /invitations/retry {emails[]}` (stored-but-failed); never-stored failures go through `POST /invitations`.
- Switching bulk → lines removes duplicates and shows "N dubletter fjernet"; unsent addresses carry over both ways; drafts survive hiding the share panel but not a reload.

### Follow-ups after tester reports (PR22/23)
- **Addresses are lowercased as a whole** (local part too) when stored and compared – `Anna@Example.COM` and `anna@example.com` are the same invitee. The box shows the domain lowercased while typing; the server lowercases everything.
- **Validation (L1):** ≤254 chars, local part 1–64, no leading/trailing dot in the local part, no consecutive dots, TLD ≥2 letters.
- **Names (H3/L4):** `Name <x@y>` and quoted `"Lund, Jan" <x@y>` (commas/semicolons inside quotes) are parsed the same way on client and server; bulk chips show the name and it is stored on the invitation.
- **Concurrent sends (L2):** each address is stored in its own transaction; an address stored by an overlapping request gets `already_invited` in `results[]`, the rest are sent.
- **Rate limits (L3):** mail endpoints (send, retry, resend, reissue, reminders) are exempt from the general 20-writes IP limit; they use the per-IP mail limit (`RATE_LIMIT_MAIL_PER_HOUR`, 150) plus per-poll/day quotas.
- **Old links (H2):** `/p/<id>/admin/<token>`, `/p/<id>?edit=<t>`, `/e/<id>` → 302 to the locale URL with the token in the `#fragment`; never logged.

### Tester hooks (capture mode only – 404/inert otherwise)
- `EMAIL_CAPTURE_FAIL=<regex>`: sends to matching recipients fail like a provider error (→ "Ikke sendt", retry possible). `EMAIL_CAPTURE_FAIL_ONCE=1`: each matching address fails only once (retry then succeeds).
- `POST /api/test/delivery {email, event: 'delivered'|'bounced'|'failed'|'unsubscribed', poll?}` sets the delivery status like a Resend webhook would ('unsubscribed' only marks the invitation; it does not add the address to the suppression list).

### Spec audit follow-ups (§38/§44.8/§46.2/§46.7/§46.9)
- **Send nyt link (§44.8)** always asks for confirmation (`resend.*` texts) because the old link stops working; the toast says so.
- **Status explanations (§38)**: non-sensitive states (e.g. temporary failure) keep their reason in the admin list; bounced and unsubscribed are both shown only as neutral “Kan ikke sendes” with **no** reason.
- **Box statuses (§46.8)**: `invitations[]` now includes `delivered`; the box polls until every invitation is `delivered`/`failed`/`blocked`. Bounced is reported as `blocked` and shown as neutral '⊘ Kan ikke sendes til denne adresse' (PM: neutral everywhere).
- **Per-IP 429 (§46.9)**: body `{ error: 'rate_ip', code: 'ip_limit' (legacy), retry_after, remaining }` + `Retry-After` header. The UI accepts seconds or an HTTP date, rounds minutes up, and shows the hour message (`se.limitHour`) when the header is missing. No auto-resend.
- **Bulk (§46.7)**: Ctrl/⌘+Enter parses and sends; sent addresses are shown in both views. Drag-and-drop (§44.5) is dropped by PM decision.
