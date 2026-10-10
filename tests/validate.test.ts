import { describe, test, expect } from 'vitest';
import { parseIsoWithOffset, validateEvent } from '../src/lib/validate';

describe('validate (unit)', () => {
  test('parseIsoWithOffset requires an offset and a real calendar date', () => {
    expect(parseIsoWithOffset('2030-01-01T10:00:00+02:00')?.toISOString()).toBe('2030-01-01T08:00:00.000Z');
    expect(parseIsoWithOffset('2030-01-01T10:00')).toBeNull();
    expect(parseIsoWithOffset('2030-02-29T10:00Z')).toBeNull();
    expect(parseIsoWithOffset(123)).toBeNull();
  });
  test('uses injected clock for "past"', () => {
    const now = new Date('2030-01-01T12:00:00Z');
    expect(validateEvent({ title: 'x', time_options: [{ start: '2030-01-01T11:59:00Z' }] }, now).errors).toHaveLength(1);
    expect(validateEvent({ title: 'x', time_options: [{ start: '2030-01-01T14:01:00+02:00' }] }, now).errors).toHaveLength(0);
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
