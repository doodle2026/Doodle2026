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
export interface EmailMessage {
  to: string | string[]; subject: string; text: string; html?: string; idempotencyKey?: string;
  /** Overrides EMAIL_REPLY_TO (e.g. the organizer). Dropped if not a valid address. */
  replyTo?: string;
  /** Display name for From (e.g. "Mette via Mødetid"); the address is always EMAIL_FROM. Sanitized here too. */
  fromName?: string;
  headers?: Record<string, string>;
  tags?: { name: string; value: string }[];
}
export type SendResult =
  | { ok: true; mode: EmailMode; id?: string }
  | { ok: false; mode: EmailMode; error: 'config' | 'invalid' | 'provider' | 'network' };
export interface EmailConfig { mode: EmailMode; from: string; replyTo?: string; apiKey?: string; problems: string[] }
type Env = Record<string, string | undefined>;
type Log = (level: 'info' | 'error', msg: string) => void;

const RESEND_URL = 'https://api.resend.com/emails';
const RESEND_BATCH_URL = 'https://api.resend.com/emails/batch';
export const BATCH_MAX = 100;
/**
 * Organizer name for the From display name: strips quotes, angle brackets, CR/LF/control + invisible chars,
 * "@" and anything URL-like, collapses spaces, max 50 graphemes. Empty → ''.
 */
export function sanitizeDisplayName(raw: string, max = 50): string {
  const s = raw
    .replace(/[\u0000-\u001F\u007F-\u009F\u00AD\u034F\u061C\u180E\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g, ' ')
    .replace(/\b(?:https?:\/\/|www\.)\S*/gi, ' ')
    .replace(/\S*@\S*/g, ' ')
    .replace(/[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.[a-z]{2,24}\b\S*/giu, ' ')
    .replace(/["'`<>@\\,;:()[\]]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  const g = [...new Intl.Segmenter('da', { granularity: 'grapheme' }).segment(s)].map((x) => x.segment);
  return g.slice(0, max).join('').trim();
}
const fromWithName = (from: string, name?: string) => {
  const n = name ? sanitizeDisplayName(name, 70) : '';
  return n ? `"${n}" <${addr(from)}>` : from;
};

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

/** Log mode returns a fake provider id so status/webhook flows work locally. */
const logId = () => `log_${globalThis.crypto.randomUUID()}`;

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

  const recipients = (m: EmailMessage) => (Array.isArray(m.to) ? m.to : [m.to]).map((x) => x.trim()).filter(Boolean);
  const valid = (m: EmailMessage) => { const to = recipients(m); return to.length > 0 && to.length <= 50 && to.every(isEmail) && !!m.subject?.trim() && !!m.text?.trim(); };
  const summarize = (m: EmailMessage) => `to=${recipients(m).map(maskEmail).join(',')} subject="${redact(m.subject).slice(0, 120)}" text=${m.text.length} chars${m.html ? ' +html' : ''}`;
  const payload = (m: EmailMessage) => {
    const replyTo = m.replyTo && isEmail(m.replyTo) ? m.replyTo : cfg.replyTo;
    // Header values must be single-line (no header injection).
    const headers = m.headers ? Object.fromEntries(Object.entries(m.headers).filter(([k, v]) => /^[A-Za-z0-9-]+$/.test(k) && !/[\r\n]/.test(v))) : undefined;
    const tags = m.tags?.map((t) => ({ name: t.name.replace(/[^\w-]/g, '_').slice(0, 256), value: t.value.replace(/[^\w-]/g, '_').slice(0, 256) }));
    return { from: fromWithName(cfg.from, m.fromName), to: recipients(m), subject: m.subject, text: m.text, ...(m.html ? { html: m.html } : {}),
      ...(replyTo ? { reply_to: replyTo } : {}), ...(headers && Object.keys(headers).length ? { headers } : {}), ...(tags?.length ? { tags } : {}) };
  };

  async function post(url: string, body: unknown, idem: string | undefined, summary: string): Promise<{ ok: true; data: unknown } | { ok: false; error: 'provider' | 'network' }> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 10_000);
    try {
      const res = await doFetch(url, {
        method: 'POST', signal: ctl.signal,
        headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json', ...(idem ? { 'Idempotency-Key': idem } : {}) },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({})) as { name?: unknown };
      if (!res.ok) {
        // Only status + Resend's error name (e.g. "validation_error"); never the key, body or links.
        log('error', `[email] provider error ${res.status}${typeof data.name === 'string' ? ` ${data.name.replace(/[^\w.-]/g, '').slice(0, 40)}` : ''}: ${summary}`);
        return { ok: false, error: 'provider' };
      }
      return { ok: true, data };
    } catch (e) {
      log('error', `[email] network error (${e instanceof Error ? e.name : 'unknown'}): ${summary}`);
      return { ok: false, error: 'network' };
    } finally { clearTimeout(t); }
  }

  async function send(m: EmailMessage): Promise<SendResult> {
    const mode = cfg.mode;
    if (!valid(m)) {
      log('error', `[email] invalid message (${recipients(m).length} recipient(s)); not sent`);
      return { ok: false, mode, error: 'invalid' };
    }
    const summary = summarize(m);
    if (mode === 'log') { log('info', `[email:log] ${summary}`); return { ok: true, mode, id: logId() }; }
    if (!cfg.apiKey || !cfg.from) { warnConfig(); log('error', `[email] not sent (config error): ${summary}`); return { ok: false, mode, error: 'config' }; }

    const r = await post(RESEND_URL, payload(m), m.idempotencyKey, summary);
    if (!r.ok) return { ok: false, mode, error: r.error };
    log('info', `[email:sent] ${summary}`);
    const id = (r.data as { id?: unknown }).id;
    return { ok: true, mode, id: typeof id === 'string' ? id : undefined };
  }

  /**
   * Many recipients: Resend batch API, ≤ 100 messages per call (each message = one recipient; never a shared `to`).
   * `idempotencyKey` (optional) is suffixed per chunk. Returns one result per input message, in order.
   */
  async function sendBatch(ms: EmailMessage[], idempotencyKey?: string): Promise<SendResult[]> {
    const mode = cfg.mode;
    const out: SendResult[] = ms.map(() => ({ ok: false, mode, error: 'invalid' }));
    const good = ms.map((m, i) => [m, i] as const).filter(([m]) => valid(m) && recipients(m).length === 1);
    if (good.length < ms.length) log('error', `[email] batch: ${ms.length - good.length} invalid message(s) skipped`);
    for (let c = 0; c < good.length; c += BATCH_MAX) {
      const chunk = good.slice(c, c + BATCH_MAX);
      const summary = `batch ${chunk.length} msg(s), first ${summarize(chunk[0][0])}`;
      if (mode === 'log') { log('info', `[email:log] ${summary}`); chunk.forEach(([, i]) => { out[i] = { ok: true, mode, id: logId() }; }); continue; }
      if (!cfg.apiKey || !cfg.from) { warnConfig(); log('error', `[email] not sent (config error): ${summary}`); chunk.forEach(([, i]) => { out[i] = { ok: false, mode, error: 'config' }; }); continue; }
      const r = await post(RESEND_BATCH_URL, chunk.map(([m]) => payload(m)), idempotencyKey ? `${idempotencyKey}:${c / BATCH_MAX}` : undefined, summary);
      if (!r.ok) { chunk.forEach(([, i]) => { out[i] = { ok: false, mode, error: r.error }; }); continue; }
      const ids = ((r.data as { data?: { id?: unknown }[] }).data ?? []);
      chunk.forEach(([, i], k) => { const id = ids[k]?.id; out[i] = { ok: true, mode, id: typeof id === 'string' ? id : undefined }; });
      log('info', `[email:sent] ${summary}`);
    }
    return out;
  }
  return { mode: cfg.mode, problems: cfg.problems, send, sendBatch };
}

let shared: ReturnType<typeof createMailer> | null = null;
/** Lazily created process-wide mailer (reads process.env once). */
export const mailer = () => (shared ??= createMailer());
