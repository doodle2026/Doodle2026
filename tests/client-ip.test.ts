/** Security: client IP comes from x-vercel-forwarded-for → x-real-ip → rightmost XFF (never leftmost); a forged leftmost XFF can't bypass or split limits. */
import { describe, test, expect, inject, afterEach } from 'vitest';
import { clientIp } from '../src/lib/client-ip';

const BASE = inject('baseUrl');
const R = (h: Record<string, string>) => new Request('http://x', { headers: h });
const rnd = () => `${(Math.random() * 200 + 20) | 0}.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}.${(Math.random() * 250 + 1) | 0}`;
const Y = new Date().getUTCFullYear() + 1;

describe('clientIp (unit)', () => {
  afterEach(() => { delete process.env.TRUSTED_PROXY_HOPS; });
  test('precedence: x-vercel-forwarded-for > x-real-ip > rightmost XFF', () => {
    expect(clientIp(R({ 'x-vercel-forwarded-for': '9.9.9.9', 'x-real-ip': '8.8.8.8', 'x-forwarded-for': '1.1.1.1, 7.7.7.7' }))).toBe('9.9.9.9');
    expect(clientIp(R({ 'x-real-ip': '8.8.8.8', 'x-forwarded-for': '1.1.1.1, 7.7.7.7' }))).toBe('8.8.8.8');
    expect(clientIp(R({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 7.7.7.7' }))).toBe('7.7.7.7');
    expect(clientIp(R({ 'x-forwarded-for': '2001:db8::1' }))).toBe('2001:db8::1');
  });
  test('forged leftmost entries never change the result', () => {
    const ips = new Set([0, 1, 2, 3, 4].map(() => clientIp(R({ 'x-forwarded-for': `${rnd()}, ${rnd()}, 7.7.7.7` }))));
    expect([...ips]).toEqual(['7.7.7.7']);
    expect(clientIp(R({ 'x-vercel-forwarded-for': '9.9.9.9', 'x-forwarded-for': `${rnd()}` }))).toBe('9.9.9.9');
  });
  test('TRUSTED_PROXY_HOPS skips our own proxies from the right; garbage values are ignored', () => {
    process.env.TRUSTED_PROXY_HOPS = '1';
    expect(clientIp(R({ 'x-forwarded-for': '6.6.6.6, 7.7.7.7, 10.0.0.1' }))).toBe('7.7.7.7');
    expect(clientIp(R({ 'x-forwarded-for': '10.0.0.1' }))).toBe('unknown');
    delete process.env.TRUSTED_PROXY_HOPS;
    expect(clientIp(R({ 'x-real-ip': '<script>' , 'x-forwarded-for': 'evil, 7.7.7.7' }))).toBe('7.7.7.7');
  });
});

describe('limits hold against a forged leftmost XFF (integration)', () => {
  test('poll creation (write limit, 20): rotating leftmost entries share one bucket → 429', async () => {
    const real = rnd(); let last = 0;
    for (let i = 0; i < 24; i++) {
      const r = await fetch(`${BASE}/api/events`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `${rnd()}, ${real}` },
        body: JSON.stringify({ locale: 'da', title: `ip ${i}`, options: [{ date: `${Y}-11-03` }] }) });
      last = r.status; if (r.status === 429) { expect(r.headers.get('retry-after')).toBeTruthy(); break; }
    }
    expect(last).toBe(429);
  });

  test('x-vercel-forwarded-for wins: forged XFF can neither split nor reset the bucket', async () => {
    const v = rnd(); let last = 0;
    for (let i = 0; i < 24; i++) {
      const r = await fetch(`${BASE}/api/events`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-vercel-forwarded-for': v, 'X-Forwarded-For': rnd() },
        body: JSON.stringify({ locale: 'da', title: `v ${i}`, options: [{ date: `${Y}-11-03` }] }) });
      last = r.status; if (r.status === 429) break;
    }
    expect(last).toBe(429);
  });

  test('owner login lock per IP: different usernames + forged leftmost XFF still lock after 5', async () => {
    const real = rnd(); let last = 0;
    for (let i = 0; i < 6; i++) {
      const xff = `${rnd()}, ${real}`;
      const c = await fetch(`${BASE}/api/owner/csrf`, { headers: { 'X-Forwarded-For': xff } });
      const { csrf } = await c.json(); const cookie = (c.headers.get('set-cookie') ?? '').split(';')[0];
      const r = await fetch(`${BASE}/api/owner/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, Cookie: cookie, Origin: BASE, 'X-Forwarded-For': xff },
        body: JSON.stringify({ username: `nobody${i}-${Math.random().toString(36).slice(2, 7)}`, password: 'wrong password!!' }) });
      last = r.status;
    }
    expect(last).toBe(429);
  });
});
