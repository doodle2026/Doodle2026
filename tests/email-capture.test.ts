import { describe, test, expect, beforeEach, afterAll } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMailer, emailConfig } from '../src/lib/email';
import { captureActive, captureRefusal, capturedMails, clearCaptured, recordMail } from '../src/lib/email/capture';

const dir = mkdtempSync(join(tmpdir(), 'cap-'));
const file = join(dir, 'mails.jsonl');
afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => clearCaptured());
const base = { EMAIL_MODE: 'capture', EMAIL_FROM: 'grabAday <t@grabaday.invalid>', EMAIL_CAPTURE_FILE: file, NODE_ENV: 'test' };
const msg = { to: 'anna@example.com', subject: 'Hej', text: 'Link https://x/p/abc#inv=' + 'T'.repeat(43), html: '<p>x</p>', headers: { 'List-Unsubscribe': '<https://x/u/p/tok>' } };

describe('EMAIL_MODE=capture', () => {
  test('test env: stores the FULL mail (to, subject, html, text, headers) in memory + JSONL, never fetches', async () => {
    const calls: unknown[] = [];
    const m = createMailer({ env: base, fetch: (async (...a: unknown[]) => { calls.push(a); throw new Error('no'); }) as typeof fetch, log: () => {} });
    expect(m.mode).toBe('capture');
    const r = await m.send(msg);
    expect(r).toMatchObject({ ok: true, mode: 'capture' });
    const b = await m.sendBatch([{ ...msg, to: 'bo@example.com' }]);
    expect(b[0].ok).toBe(true);
    expect(calls).toHaveLength(0);
    const all = capturedMails();
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ to: ['anna@example.com'], subject: 'Hej', html: '<p>x</p>', headers: { 'List-Unsubscribe': '<https://x/u/p/tok>' }, from: base.EMAIL_FROM });
    expect(all[0].text).toContain('#inv=' + 'T'.repeat(43)); // token kept – that's the point
    const lines = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.slice(-2).map((l) => l.to[0])).toEqual(['anna@example.com', 'bo@example.com']);
  });

  const refused: [string, Record<string, string>][] = [
    ['NODE_ENV=production', { NODE_ENV: 'production' }],
    ['NODE_ENV=development', { NODE_ENV: 'development' }],
    ['NODE_ENV unset', { NODE_ENV: '' }],
    ['VERCEL=1', { VERCEL: '1' }],
    ['VERCEL_ENV=preview', { VERCEL_ENV: 'preview' }],
    ['VERCEL_ENV=production', { VERCEL_ENV: 'Production' }],
  ];
  test.each(refused)('%s → refused: logged error, falls back to log mode, nothing captured, nothing sent', async (_n, over) => {
    const env = { ...base, ...over, RESEND_API_KEY: 're_live_key' };
    const logs: [string, string][] = [];
    let fetched = 0;
    const before = existsSync(file) ? readFileSync(file, 'utf8') : '';
    const m = createMailer({ env, fetch: (async () => { fetched++; return new Response('{}'); }) as typeof fetch, log: (l, s) => logs.push([l, s]) });
    expect(m.mode).toBe('log');
    expect(emailConfig(env).problems.join(' ')).toMatch(/capture refused/);
    expect(logs.some(([l, s]) => l === 'error' && /capture refused/.test(s))).toBe(true);
    const r = await m.send(msg);
    expect(r).toMatchObject({ ok: true, mode: 'log' });
    await m.sendBatch([msg]);
    expect(fetched).toBe(0);
    expect(capturedMails()).toHaveLength(0);
    expect(existsSync(file) ? readFileSync(file, 'utf8') : '').toBe(before);
    expect(logs.map(([, s]) => s).join('\n')).not.toContain('T'.repeat(43)); // log mode stays redacted
    expect(captureActive(env)).toBe(false);
    expect(() => recordMail({ from: 'a', to: ['b'], subject: 's', text: 't' }, env)).toThrow(/not allowed/);
  });

  test('gate reads NODE_ENV at runtime; EMAIL_MODE must also be capture for the endpoint', () => {
    expect(captureRefusal({ NODE_ENV: 'test' })).toBeNull();
    expect(captureActive({ NODE_ENV: 'test', EMAIL_MODE: 'log' })).toBe(false);
    expect(captureActive({ NODE_ENV: 'test', EMAIL_MODE: 'capture' })).toBe(true);
    // a production build is refused even when started with NODE_ENV=test
    expect(captureRefusal({ NODE_ENV: 'test' }, 'production')).toMatch(/production build/);
  });
});

describe('production build (test server runs next start with EMAIL_MODE=capture)', () => {
  test('GET/DELETE /api/test/mails → 404; invitations still work in (redacted) log mode', async () => {
    const { inject } = await import('vitest');
    const BASE = inject('baseUrl');
    expect((await fetch(`${BASE}/api/test/mails`)).status).toBe(404);
    expect((await fetch(`${BASE}/api/test/mails`, { method: 'DELETE' })).status).toBe(404);
    const ip = { 'X-Forwarded-For': `10.3.${(Math.random() * 255) | 0}.9`, 'Content-Type': 'application/json' };
    const Y = new Date().getUTCFullYear() + 1;
    const e = await (await fetch(`${BASE}/api/events`, { method: 'POST', headers: ip, body: JSON.stringify({ title: 'Cap', options: [{ date: `${Y}-11-03` }] }) })).json();
    const r = await fetch(`${BASE}/api/events/${e.id}/invitations`, { method: 'POST', headers: { ...ip, Authorization: `Bearer ${e.admin_token}` }, body: JSON.stringify({ recipients: ['x@example.com'], track: true }) });
    expect(r.status).toBeLessThan(300);
    expect((await fetch(`${BASE}/api/test/mails`)).status).toBe(404);
  });
});
