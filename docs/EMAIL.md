# E-mail (Resend) – rules and status

Code: `src/lib/email/` (`send.ts` adapter, `render.ts` templates, `policy.ts` who-gets-what). Templates come from
Doodle UI `email/` (`node scripts/sync-email-templates.mjs ../doodle-ui/email` regenerates `templates.ts` + `public/email-assets/`).
Env and Resend/DNS setup: see `docs/README-DEPLOY.md` "E-mail (Resend)".

Status legend: ✅ enforced in code + tested (this PR) · ⏳ step 4 "Invitations" (needs DB/endpoints/UI)

## Sending
- ✅ `EMAIL_MODE=log` (default) never calls Resend; logs a redacted summary only (masked address, no links/tokens/body).
- ✅ `EMAIL_MODE=send` without `RESEND_API_KEY`/`EMAIL_FROM` → config error logged once at startup, `send()` returns `{ok:false}`; never throws, never logs secrets.
- ✅ One message per recipient (never a shared `To`); many recipients via Resend batch (≤ 100 per call).
- ✅ Idempotency keys `invite:<poll>:<email>` / `reminder:<poll>:<email>`.
- ✅ From = app address (`EMAIL_FROM`) with display name `"<organizer name> via Mødetid"`; organizer name is optional and sanitized (quotes, angle brackets, CR/LF/control/invisible chars, `@`, URLs/domains stripped; ≤ 50 graphemes).
- ✅ No per-message Reply-To (organizer e-mail is unverified); only the optional global `EMAIL_REPLY_TO`.
- ✅ Header values are single-line (no header injection); `List-Unsubscribe` + `List-Unsubscribe-Post: One-Click` when an unsubscribe URL is given.
- ✅ Only the public `/p/<id>` link in mails – render throws on any admin/edit link (also in description/personal text).
- ✅ Subject: plain text, one line, title clipped to 60 graphemes. HTML escapes all user values; plain text is not HTML-escaped.
- ⏳ No tracking: turn **off open and click tracking** for the sending domain in Resend (domain setting, not per API call). Templates contain no tracking pixels.

## Invitations (step 4)
- ⏳ Organizer only (admin token). Addresses validated + deduped (✅ in `planInvitations`).
- ⏳ Max 50 recipients per send, 200 per poll; rate limits per hour and per IP; global daily/monthly quota under Resend Free (100/day, 3 000/month), reserved atomically before sending.
- ⏳ Optional personal message: max 1 000 graphemes, escaped, rejected if it contains admin/edit links (needs a template slot from Doodle UI).
- ⏳ Optional organizer name field in the invite request (sanitizer ✅).

## Reminders
- ✅ Manual; per poll max one per 24 h and 3 in total; none to closed polls (`reminderBlock`).
- ✅ Go to all non-unsubscribed invitees.
- ⏳ Counter/timestamp persisted atomically (row lock) before sending; UI button with countdown.

## Unsubscribe, abuse, privacy
- ⏳ Every mail carries two unsubscribe links (this poll / all mail from the app) + a report-abuse link, with landing pages (GET shows confirmation, POST one-click per RFC 8058).
- ⏳ Suppression list stored as hashes (HMAC-SHA256 of the normalized address with a server secret), checked before every send (✅ `unsubscribedAt` skip in policy).
- ⏳ Invitee addresses deleted immediately with the poll (FK cascade) or 90 days after close (scheduled cleanup – Vercel cron or GitHub Action; coordinate with Doodle Deployment).
- ⏳ Per-recipient status sent / failed / bounced in the admin view, fed by **signature-verified** Resend webhooks (Svix headers).

## Business tasks (Jan)
- Resend DPA, sending region Ireland (eu-west-1) and note that Resend stores account data/logs in the US.
- Privacy policy text covering invitee addresses, retention (90 days after close) and unsubscribe.
