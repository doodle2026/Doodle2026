import { describe, test, expect } from 'vitest';
import { liveTitleError } from '../src/lib/form';
import { takeAdminToken } from '../src/lib/admin-client';
import { bestIds, score } from '../src/lib/format';

describe('N2 liveTitleError', () => {
  test('clears as soon as the title is valid, keeps it while blank/too long, never adds one', () => {
    expect(liveTitleError('Giv afstemningen en titel.', 'M')).toBe('');
    expect(liveTitleError('Giv afstemningen en titel.', ' \u200B ')).toBe('Giv afstemningen en titel.');
    expect(liveTitleError('For lang', 'x'.repeat(201))).toBe('For lang');
    expect(liveTitleError('For lang', 'x'.repeat(200))).toBe('');
    expect(liveTitleError('', '')).toBe('');
  });
});

describe('admin token from fragment', () => {
  const T = 'a'.repeat(43);
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };
  test('reads #token, stores it per poll, strips the fragment', () => {
    const s = mem(); const urls: string[] = [];
    expect(takeAdminToken('abc', { hash: `#${T}`, pathname: '/p/abc/admin', search: '' }, s, (u) => urls.push(u))).toBe(T);
    expect(urls).toEqual(['/p/abc/admin']);
    expect(s.m.get('mt-admintok-abc')).toBe(T);
    // reload without fragment → stored token
    expect(takeAdminToken('abc', { hash: '', pathname: '/p/abc/admin', search: '' }, s, () => {})).toBe(T);
    expect(takeAdminToken('other', { hash: '', pathname: '/p/other/admin', search: '' }, s, () => {})).toBeNull();
  });
  test('malformed fragment → null, still stripped, not stored', () => {
    const s = mem(); const urls: string[] = [];
    expect(takeAdminToken('abc', { hash: '#short', pathname: '/p/abc/admin', search: '' }, s, (u) => urls.push(u))).toBeNull();
    expect(urls).toEqual(['/p/abc/admin']);
    expect(s.m.size).toBe(0);
  });
});

describe('best option', () => {
  test('yes=2, maybe=1; ties all best; none when no yes/maybe', () => {
    expect(score({ yes: 2, maybe: 1 })).toBe(5);
    const v = (yes: number, maybe: number) => ({ yes, maybe });
    expect([...bestIds([{ id: 1, votes: v(1, 1) }, { id: 2, votes: v(1, 1) }, { id: 3, votes: v(0, 2) }])]).toEqual([1, 2]);
    expect(bestIds([{ id: 1, votes: v(0, 0) }]).size).toBe(0);
  });
});
