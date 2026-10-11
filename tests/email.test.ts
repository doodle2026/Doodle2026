import { describe, expect, it, vi } from 'vitest';
import { createMailer, emailConfig, maskEmail, redact } from '../src/lib/email';

const KEY = 're_SECRETKEY_abcdefghijklmnop';
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd';
const msg = { to: 'anna@example.com', subject: `Ny stemme ${TOKEN}`, text: `Se https://grabaday.com/p/abc/admin#${TOKEN}` };
const capture = () => { const lines: string[] = []; return { lines, log: (_l: 'info' | 'error', m: string) => { lines.push(m); } }; };

describe('email adapter', () => {
  it('defaults to log mode; invalid EMAIL_MODE falls back to log with a problem', () => {
    expect(emailConfig({}).mode).toBe('log');
    const c = emailConfig({ EMAIL_MODE: 'smtp' });
    expect(c.mode).toBe('log');
    expect(c.problems.join()).toMatch(/EMAIL_MODE/);
  });

  it('log mode: never calls Resend and logs only a redacted summary (no links, tokens, body)', async () => {
    const f = vi.fn(); const { lines, log } = capture();
    const m = createMailer({ env: { EMAIL_MODE: 'log', RESEND_API_KEY: KEY }, fetch: f as never, log });
    expect(await m.send(msg)).toMatchObject({ ok: true, mode: 'log', id: expect.stringMatching(/^log_/) });
    expect(f).not.toHaveBeenCalled();
    const all = lines.join('\n');
    expect(all).toContain('a***@example.com');
    expect(all).not.toContain('anna@');
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain('https://');
    expect(all).not.toContain(KEY);
  });

  it('send mode without RESEND_API_KEY: config error logged once at startup, send returns error, never throws', async () => {
    const f = vi.fn(); const { lines, log } = capture();
    const m = createMailer({ env: { EMAIL_MODE: 'send', EMAIL_FROM: 'noreply@grabaday.com' }, fetch: f as never, log });
    expect(lines.filter((l) => l.includes('RESEND_API_KEY is missing'))).toHaveLength(1);
    await expect(m.send(msg)).resolves.toEqual({ ok: false, mode: 'send', error: 'config' });
    await m.send(msg);
    expect(lines.filter((l) => l.includes('RESEND_API_KEY is missing'))).toHaveLength(1);
    expect(f).not.toHaveBeenCalled();
    expect(lines.join('\n')).not.toContain(TOKEN);
  });

  it('send mode: posts to Resend with bearer key, from, reply_to, idempotency key', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ id: 'em_1' }), { status: 200 }));
    const { lines, log } = capture();
    const m = createMailer({ env: { EMAIL_MODE: 'send', RESEND_API_KEY: KEY, EMAIL_FROM: 'grabAday <noreply@grabaday.com>', EMAIL_REPLY_TO: 'hej@grabaday.com' }, fetch: f as never, log });
    expect(await m.send({ ...msg, idempotencyKey: 'k1' })).toEqual({ ok: true, mode: 'send', id: 'em_1' });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('k1');
    expect(JSON.parse(String(init.body))).toMatchObject({ from: 'grabAday <noreply@grabaday.com>', to: ['anna@example.com'], reply_to: 'hej@grabaday.com', text: msg.text });
    expect(lines.join('\n')).not.toContain(KEY);
    expect(lines.join('\n')).not.toContain(TOKEN);
  });

  it('provider error / network error / timeout → ok:false, no secrets in logs, no throw', async () => {
    const { lines, log } = capture();
    const env = { EMAIL_MODE: 'send', RESEND_API_KEY: KEY, EMAIL_FROM: 'noreply@grabaday.com' };
    const bad = createMailer({ env, log, fetch: (async () => new Response(JSON.stringify({ name: 'validation_error', message: `bad ${KEY}` }), { status: 422 })) as never });
    expect(await bad.send(msg)).toMatchObject({ ok: false, error: 'provider' });
    const down = createMailer({ env, log, fetch: (async () => { throw new TypeError('fetch failed'); }) as never });
    expect(await down.send(msg)).toMatchObject({ ok: false, error: 'network' });
    const slow = createMailer({ env, log, timeoutMs: 20, fetch: ((_u: string, i: RequestInit) => new Promise((_, rej) => i.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))))) as never });
    expect(await slow.send(msg)).toMatchObject({ ok: false, error: 'network' });
    const all = lines.join('\n');
    expect(all).toContain('validation_error');
    expect(all).not.toContain(KEY);
    expect(all).not.toContain(TOKEN);
  });

  it('rejects invalid messages without calling the provider', async () => {
    const f = vi.fn(); const { log } = capture();
    const m = createMailer({ env: { EMAIL_MODE: 'send', RESEND_API_KEY: KEY, EMAIL_FROM: 'noreply@grabaday.com' }, fetch: f as never, log });
    for (const bad of [{ ...msg, to: 'nope' }, { ...msg, to: [] }, { ...msg, subject: ' ' }, { ...msg, text: '' }]) {
      expect(await m.send(bad)).toMatchObject({ ok: false, error: 'invalid' });
    }
    expect(f).not.toHaveBeenCalled();
  });

  it('helpers: maskEmail, redact', () => {
    expect(maskEmail('Anna <anna@example.com>')).toBe('a***@example.com');
    expect(redact(`x https://a.dk/p/1#${TOKEN} y ${TOKEN}`)).toBe('x [link] y [redacted]');
  });
});
