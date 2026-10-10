/**
 * Email adapter (Resend). Notification features come later; this only sends/logs one message.
 *
 * Env: EMAIL_MODE = 'log' (default) | 'send'; EMAIL_FROM (required for send); EMAIL_REPLY_TO (optional);
 * RESEND_API_KEY (send mode only, production secret).
 * - log mode never calls Resend and logs only a REDACTED summary (masked recipients, no links/tokens, no body).
 * - send mode with missing key/from is a config error: logged once (no secrets), send() returns
 *   { ok: false, error: 'config' } – it never throws, so a request using it never crashes.
 * Uses the Resend REST API via fetch (no SDK dependency); 10 s timeout.
 */
export type EmailMode = 'log' | 'send';
export interface EmailMessage { to: string | string[]; subject: string; text: string; html?: string; idempotencyKey?: string }
export type SendResult =
  | { ok: true; mode: EmailMode; id?: string }
  | { ok: false; mode: EmailMode; error: 'config' | 'invalid' | 'provider' | 'network' };
export interface EmailConfig { mode: EmailMode; from: string; replyTo?: string; apiKey?: string; problems: string[] }
type Env = Record<string, string | undefined>;
type Log = (level: 'info' | 'error', msg: string) => void;

const RESEND_URL = 'https://api.resend.com/emails';
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
/** Plain address or `Name <address>`. */
const addr = (s: string) => { const m = /<([^>]+)>\s*$/.exec(s); return (m ? m[1] : s).trim(); };
export const isEmail = (s: string) => EMAIL_RE.test(addr(s)) && s.length <= 320;

export function emailConfig(env: Env = process.env): EmailConfig {
  const problems: string[] = [];
  const raw = (env.EMAIL_MODE ?? '').trim().toLowerCase();
  let mode: EmailMode = 'log';
  if (raw === 'send') mode = 'send';
  else if (raw && raw !== 'log') problems.push(`EMAIL_MODE must be "send" or "log" (got an unknown value); using "log".`);
  const from = (env.EMAIL_FROM ?? '').trim();
  const replyTo = (env.EMAIL_REPLY_TO ?? '').trim() || undefined;
  const apiKey = (env.RESEND_API_KEY ?? '').trim() || undefined;
  if (mode === 'send') {
    if (!apiKey) problems.push('EMAIL_MODE=send but RESEND_API_KEY is missing.');
    if (!from) problems.push('EMAIL_MODE=send but EMAIL_FROM is missing.');
  }
  if (from && !isEmail(from)) problems.push('EMAIL_FROM is not a valid address.');
  if (replyTo && !isEmail(replyTo)) problems.push('EMAIL_REPLY_TO is not a valid address.');
  return { mode, from, replyTo, apiKey, problems };
}

/** "anna@example.com" → "a***@example.com". */
export function maskEmail(s: string): string {
  const a = addr(s), at = a.lastIndexOf('@');
  return at > 0 ? `${a[0]}***${a.slice(at)}` : '***';
}
/** Remove links and anything token-like (≥ 20 url-safe chars) from free text. */
export function redact(s: string): string {
  return s.replace(/\b(?:https?:\/\/|www\.)\S+/gi, '[link]').replace(/[A-Za-z0-9_-]{20,}/g, '[redacted]');
}

const defaultLog: Log = (level, msg) => (level === 'error' ? console.error(msg) : console.info(msg));

export function createMailer(opts: { env?: Env; fetch?: typeof fetch; log?: Log; timeoutMs?: number } = {}) {
  const cfg = emailConfig(opts.env ?? process.env);
  const log = opts.log ?? defaultLog;
  const doFetch = opts.fetch ?? fetch;
  let warned = false;
  const warnConfig = () => {
    if (warned || !cfg.problems.length) return;
    warned = true;
    for (const p of cfg.problems) log('error', `[email] config: ${p}`);
  };
  warnConfig(); // at startup/first construction

  async function send(m: EmailMessage): Promise<SendResult> {
    const mode = cfg.mode;
    const to = (Array.isArray(m.to) ? m.to : [m.to]).map((x) => x.trim()).filter(Boolean);
    if (!to.length || to.length > 50 || !to.every(isEmail) || !m.subject?.trim() || !m.text?.trim()) {
      log('error', `[email] invalid message (${to.length} recipient(s)); not sent`);
      return { ok: false, mode, error: 'invalid' };
    }
    const summary = `to=${to.map(maskEmail).join(',')} subject="${redact(m.subject).slice(0, 120)}" text=${m.text.length} chars${m.html ? ' +html' : ''}`;
    if (mode === 'log') { log('info', `[email:log] ${summary}`); return { ok: true, mode }; }
    if (!cfg.apiKey || !cfg.from) { warnConfig(); log('error', `[email] not sent (config error): ${summary}`); return { ok: false, mode, error: 'config' }; }

    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 10_000);
    try {
      const res = await doFetch(RESEND_URL, {
        method: 'POST', signal: ctl.signal,
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json',
          ...(m.idempotencyKey ? { 'Idempotency-Key': m.idempotencyKey } : {}),
        },
        body: JSON.stringify({ from: cfg.from, to, subject: m.subject, text: m.text, ...(m.html ? { html: m.html } : {}), ...(cfg.replyTo ? { reply_to: cfg.replyTo } : {}) }),
      });
      const data = await res.json().catch(() => ({})) as { id?: string; name?: string };
      if (!res.ok) {
        // Only status + Resend's error name (e.g. "validation_error"); never the key, body or links.
        log('error', `[email] provider error ${res.status}${typeof data.name === 'string' ? ` ${data.name.replace(/[^\w.-]/g, '').slice(0, 40)}` : ''}: ${summary}`);
        return { ok: false, mode, error: 'provider' };
      }
      log('info', `[email:sent] ${summary}`);
      return { ok: true, mode, id: typeof data.id === 'string' ? data.id : undefined };
    } catch (e) {
      log('error', `[email] network error (${e instanceof Error ? e.name : 'unknown'}): ${summary}`);
      return { ok: false, mode, error: 'network' };
    } finally { clearTimeout(t); }
  }
  return { mode: cfg.mode, problems: cfg.problems, send };
}

let shared: ReturnType<typeof createMailer> | null = null;
/** Lazily created process-wide mailer (reads process.env once). */
export const mailer = () => (shared ??= createMailer());
