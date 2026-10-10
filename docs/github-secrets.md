# GitHub secrets / environments (GitHub Free, private repo)
Secrets:
- VERCEL_TOKEN – Vercel token (Account → Tokens)
- VERCEL_ORG_ID, VERCEL_PROJECT_ID – from `.vercel/project.json` after `vercel link` (on Hobby the "org" is your personal account id)
- PROD_DATABASE_URL – prod Supabase, transaction pooler :6543 incl. `?pgbouncer=true&connection_limit=1`
- PROD_DIRECT_URL – prod Supabase, session pooler :5432 (migrations, keep-alive, backup)
- STAGING_DATABASE_URL – staging Supabase, transaction pooler :6543, base URL WITHOUT query string
- STAGING_DIRECT_URL – staging Supabase, session pooler :5432, base URL WITHOUT query string
- BACKUP_PASSPHRASE – optional; if set, nightly dumps are gpg-AES256 encrypted. Store it in your password manager too!

Important on GitHub Free + private repo: **environment secrets and required reviewers are not available**
(environments are only for public repos or paid plans). Put all secrets as *repository* secrets.
The workflows therefore use no `environment:` keys. If you upgrade to GitHub Pro you can move PROD_* into a
`production` environment with required reviewers.

Vercel project env – Production only (set in Vercel, not GitHub; the prod workflow does not pass them):
- DATABASE_URL, DIRECT_URL – type Sensitive
- RESEND_API_KEY – type Sensitive (Resend API key, permission "Sending access", restricted to the mail.<domain> domain)
- EMAIL_MODE=send, EMAIL_FROM="GrabAday <noreply@mail.<domain>>", EMAIL_REPLY_TO (optional) – plain
- APP_URL is passed by the workflow (repo variable APP_URL or default https://doodle2026.vercel.app)
Preview: nothing in Vercel; the preview workflow passes DATABASE_URL/DIRECT_URL (staging pr_<n>) and EMAIL_MODE=log. No RESEND_API_KEY in preview.
No Resend secret is needed in GitHub.
Vercel env – Preview: none required (DATABASE_URL/DIRECT_URL injected per PR; APP_URL falls back – set it to the preview URL if absolute links matter).
