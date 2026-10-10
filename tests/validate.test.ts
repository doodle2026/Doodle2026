import { describe, test, expect } from 'vitest';
import { validateEvent } from '../src/lib/validate';

describe('validate (unit)', () => {
  test('uses injected clock for "past" (dates ≥ UTC today − 1 day)', () => {
    const now = new Date('2030-01-02T12:00:00Z');
    expect(validateEvent({ title: 'x', options: [{ date: '2029-12-31' }] }, now).errors).toHaveLength(1);
    expect(validateEvent({ title: 'x', options: [{ date: '2030-01-01' }] }, now).errors).toHaveLength(0);
  });
});

import { newToken, openForKey, sealForKey, sha256Hex, tokenMatches } from '../src/lib/tokens';
describe('tokens (unit)', () => {
  test('256-bit tokens, hash match is exact', () => {
    const t = newToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(t, 'base64url')).toHaveLength(32);
    const h = sha256Hex(t);
    expect(tokenMatches(t, h)).toBe(true);
    expect(tokenMatches(newToken(), h)).toBe(false);
    expect(tokenMatches('short', h)).toBe(false);
  });
  test('sealed token opens only with the same idempotency key', () => {
    const sealed = sealForKey('key-aaaaaaaaaaaaaaaa', 'secret-token');
    expect(sealed).not.toContain('secret-token');
    expect(openForKey('key-aaaaaaaaaaaaaaaa', sealed)).toBe('secret-token');
    expect(openForKey('key-bbbbbbbbbbbbbbbb', sealed)).toBeNull();
  });
});
