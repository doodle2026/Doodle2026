import { describe, test, expect } from 'vitest';
import { bestMask, editTokenFromHash, nameError, nextVote, readStored, totals, totalText, writeStored } from '../src/lib/vote-client';
import { cleanName, participantNameKey, validateVote } from '../src/lib/votes';
import { isBlank, textLength } from '../src/lib/validate';

describe('vote UI helpers', () => {
  test('tri-state cycle: none → yes → maybe → no → none', () => {
    expect([null, 'yes', 'maybe', 'no'].map((v) => nextVote(v as never))).toEqual(['yes', 'maybe', 'no', null]);
  });
  test('totals, best (yes 2 / maybe 1, ties, none at 0), total text', () => {
    const t = totals([['yes', 'maybe', null], ['maybe', 'yes', 'no']], 3);
    expect(t).toEqual([{ yes: 1, maybe: 1, no: 0 }, { yes: 1, maybe: 1, no: 0 }, { yes: 0, maybe: 0, no: 1 }]);
    expect(bestMask(t)).toEqual([true, true, false]);
    expect(bestMask(totals([[null, 'no']], 2))).toEqual([false, false]);
    expect(totalText({ yes: 4, maybe: 1, no: 0 })).toBe('4 ja, 1 måske');
    expect(totalText({ yes: 0, maybe: 0, no: 2 })).toBe('0 ja');
  });
  test('#edit= fragment parsing + per-poll storage', () => {
    const T = 'b'.repeat(43);
    expect(editTokenFromHash(`#edit=${T}`)).toBe(T);
    expect(editTokenFromHash('#edit=short')).toBe('invalid');
    expect(editTokenFromHash('')).toBeNull();
    const m = new Map<string, string>();
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    writeStored('p1', { token: T, pid: 7 }, s);
    expect(readStored('p1', s)).toEqual({ token: T, pid: 7 });
    expect(readStored('p2', s)).toBeNull();
    m.set('mt-edit-p1', '{"token":"bad","pid":1}');
    expect(readStored('p1', s)).toBeNull();
    writeStored('p1', null, s);
    expect(m.size).toBe(0);
  });
  test('client name check mirrors server (blank, length, case-insensitive dup, own row skipped)', () => {
    const h = { isBlank, textLength };
    const ps = [{ id: 1, name: 'Jan' }];
    expect(nameError(' \u200B', ps, null, h)).toMatch(/Skriv dit navn/);
    expect(nameError('x'.repeat(102), ps, null, h)).toBe('Navnet er 2 tegn for langt (højst 100).');
    expect(nameError('JAN', ps, null, h)).toBe('"JAN" har allerede svaret. Tilføj f.eks. et efternavn.');
    expect(nameError('jan', ps, 1, h)).toBe('');
  });
});

describe('server vote validation', () => {
  test('name cleaning + key', () => {
    expect(cleanName('  Anne\u200B  Marie ')).toBe('Anne Marie');
    expect(participantNameKey('ＪＡＮ ')).toBe('jan');
  });
  test('validateVote', () => {
    const ids = new Set([1, 2]);
    expect(validateVote({ name: 'A', votes: [{ option_id: 1, value: 'yes' }, { option_id: 2, value: null }] }, ids).value?.votes)
      .toEqual(new Map([[1, 'yes']]));
    expect(validateVote({ name: 'A', votes: [{ option_id: 3, value: 'yes' }] }, ids).errors.length).toBe(1);
    expect(validateVote({ name: '👍🏽'.repeat(100), votes: [{ option_id: 1, value: 'no' }] }, ids).errors).toEqual([]);
  });
});

describe('V1: shared name normalizer (no impersonation with invisible chars)', () => {
  test('invisible variants of "Jan" all map to the same key and display as "Jan"', async () => {
    const { normalizeName, nameKey } = await import('../src/lib/validate');
    const variants = ['\u200DJan', '\u00ADJan', '\u200BJan\u200D', 'J\u200Can', 'Jan\u2060', '\u202EJan', '\u200EJan\u200F', 'Ja\uFEFFn', ' JAN ', 'Ｊａｎ'];
    for (const v of variants) expect(nameKey(v), JSON.stringify(v)).toBe('jan');
    for (const v of variants.slice(0, 8)) expect(normalizeName(v), JSON.stringify(v)).toBe('Jan');
  });
  test('emoji ZWJ sequences survive (family emoji stays one grapheme)', async () => {
    const { normalizeName, textLength } = await import('../src/lib/validate');
    expect(normalizeName('Familie 👨‍👩‍👧‍👦')).toBe('Familie 👨‍👩‍👧‍👦');
    expect(textLength(normalizeName('👨‍👩‍👧‍👦'))).toBe(1);
    expect(normalizeName('🏳️‍🌈 Pia')).toBe('🏳️‍🌈 Pia');
  });
  test('validateVote stores the normalized name', () => {
    expect(validateVote({ name: '\u200DJan\u00AD', votes: [{ option_id: 1, value: 'yes' }] }, new Set([1])).value)
      .toMatchObject({ name: 'Jan', nameKey: 'jan' });
  });
});

describe('V3/V5/V8 helpers', async () => {
  const { savedMessage, HINT_CARDS, HINT_GRID } = await import('../src/lib/vote-client');
  test('V5 saved message: fresh / returning / closed', () => {
    expect(savedMessage('Jan', true, false)).toBe('✓ Tak, Jan! Dine svar er gemt.');
    expect(savedMessage('Jan', false, false)).toMatch(/^✓ Du har svaret som Jan\./);
    expect(savedMessage('Jan', true, true)).toBe('Du har svaret som Jan. Afstemningen er lukket, så svarene kan ikke længere ændres.');
  });
  test('V3 hints differ for grid and cards; card hint mentions no keyboard/cell cycling', () => {
    expect(HINT_GRID).toMatch(/celle/);
    expect(HINT_CARDS).not.toMatch(/celle|←|Delete/);
  });
});
