import { describe, test, expect } from 'vitest';
import { clientIp, take } from '../src/lib/ratelimit';

describe('token bucket', () => {
  test('burst up to capacity, then 429 with Retry-After, refills over time', () => {
    const lim = { capacity: 3, refillPerSec: 0.5 };
    const t0 = 1_000_000;
    expect([1, 2, 3].map(() => take('k1', lim, t0).ok)).toEqual([true, true, true]);
    const r = take('k1', lim, t0);
    expect(r).toEqual({ ok: false, retryAfterSec: 2 });
    expect(take('k1', lim, t0 + 2000).ok).toBe(true); // 1 token refilled
    expect(take('k1', lim, t0 + 2000).ok).toBe(false);
    expect(take('other', lim, t0).ok).toBe(true); // buckets are per key
  });
  test('client IP: never the (spoofable) leftmost x-forwarded-for entry', () => {
    expect(clientIp(new Request('http://x', { headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' } }))).toBe('10.0.0.1');
    expect(clientIp(new Request('http://x', { headers: { 'x-real-ip': '5.6.7.8' } }))).toBe('5.6.7.8');
    expect(clientIp(new Request('http://x'))).toBe('unknown');
  });
});
