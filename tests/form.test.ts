import { describe, test, expect } from 'vitest';
import {
  counterState, counterText, duplicateRowError, findDuplicates, focusAfterDateRemoval, focusAfterRemoval,
  isBlank, mapServerErrors, rowsSummary, shouldBlockEnter, textLength,
} from '../src/lib/form';
import { dateRangeDa, truncateGraphemes } from '../src/lib/meta';

describe('create form helpers', () => {
  test('H2: Enter in title/time inputs is blocked; textarea and buttons are not', () => {
    expect(shouldBlockEnter('Enter', { tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(shouldBlockEnter('Enter', { tagName: 'INPUT', type: 'time' })).toBe(true);
    expect(shouldBlockEnter('Enter', { tagName: 'INPUT', type: 'date' })).toBe(true);
    expect(shouldBlockEnter('Enter', { tagName: 'TEXTAREA' })).toBe(false);
    expect(shouldBlockEnter('Enter', { tagName: 'BUTTON', type: 'submit' })).toBe(false);
    expect(shouldBlockEnter('Tab', { tagName: 'INPUT', type: 'text' })).toBe(false);
  });
  test('L1: grapheme counting (shared by counter and backend), blank detection', () => {
    expect(textLength('😀😀')).toBe(2);
    expect(textLength('👨‍👩‍👧‍👦')).toBe(1);
    expect(textLength('👍🏽🇩🇰')).toBe(2);
    expect(textLength('e\u0301æøå')).toBe(4);
    expect(isBlank('\u200B \uFEFF\u2060\u200C\u200D')).toBe(true);
    expect(isBlank('a\u200B')).toBe(false);
  });
  test('M3: counter text and states (warn ≥ 90 %, over shows excess)', () => {
    expect(counterText(37, 200)).toBe('37 / 200');
    expect(counterText(212, 200)).toBe('212 / 200 – 12 for mange');
    expect(counterState(179, 200)).toBe('ok');
    expect(counterState(180, 200)).toBe('warn');
    expect(counterState(201, 200)).toBe('over');
  });
  test('L3: only the later duplicate gets one error naming the first row', () => {
    const slots = [
      { id: 1, date: '2030-01-02', start: '09:00', end: '10:00' },
      { id: 2, date: '2030-01-02', start: '11:00', end: '' },
      { id: 3, date: '2030-01-02', start: '09:00', end: '10:00' },
      { id: 4, date: '2030-01-03', start: '08:00', end: '' },
      { id: 5, date: '2030-01-02', start: '11:00', end: '' },
      { id: 6, date: '2030-01-02', start: '09:00', end: '10:00' },
      { id: 7, date: '2030-01-03', start: '', end: '' },
    ];
    const d = findDuplicates(slots);
    expect([...d.entries()]).toEqual([[3, 1], [5, 2], [6, 1]]);
    expect(d.has(1)).toBe(false);
    expect(duplicateRowError(1)).toBe('Samme tidspunkt findes allerede ovenfor (tidsforslag 1).');
    expect(rowsSummary(3)).toBe('3 tidsforslag skal rettes.');
    expect(findDuplicates(slots.slice(0, 2)).size).toBe(0);
  });
  test('server "Tidsforslag N: …" errors map to row N', () => {
    const r = mapServerErrors(['Titel er påkrævet.', 'Tidsforslag 2: tidspunktet ligger i fortiden.']);
    expect(r.general).toEqual(['Titel er påkrævet.']);
    expect([...r.rows]).toEqual([[2, 'Tidspunktet ligger i fortiden.']]);
  });
  test('L2: focus moves to next/previous row, then next/previous date, then the date picker', () => {
    const groups = [
      { date: 'a', slots: [{ id: 1 }, { id: 2 }, { id: 3 }] },
      { date: 'b', slots: [{ id: 4 }] },
      { date: 'c', slots: [{ id: 5 }] },
    ];
    expect(focusAfterRemoval(groups, 'a', 2)).toEqual({ kind: 'slot', id: 3 });
    expect(focusAfterRemoval(groups, 'a', 3)).toEqual({ kind: 'slot', id: 2 });
    expect(focusAfterDateRemoval(groups, 'b')).toEqual({ kind: 'slot', id: 5 });
    expect(focusAfterDateRemoval(groups, 'c')).toEqual({ kind: 'slot', id: 4 });
    expect(focusAfterDateRemoval([{ date: 'x', slots: [{ id: 9 }] }], 'x')).toEqual({ kind: 'newdate' });
  });
});

describe('link-preview helpers', () => {
  test('date ranges in Danish', () => {
    expect(dateRangeDa(['2026-10-14T07:00:00Z', '2026-10-16T07:00:00Z'])).toBe('14.–16. oktober 2026');
    expect(dateRangeDa(['2026-10-30T07:00:00Z', '2026-11-02T08:00:00Z'])).toBe('30. oktober – 2. november 2026');
    expect(dateRangeDa(['2026-12-30T08:00:00Z', '2027-01-02T08:00:00Z'])).toBe('30. december 2026 – 2. januar 2027');
    expect(dateRangeDa(['2026-10-14T07:00:00Z'])).toBe('14. oktober 2026');
  });
  test('truncation never splits a grapheme', () => {
    const fam = '👨‍👩‍👧‍👦';
    const t = truncateGraphemes(fam.repeat(200), 160);
    expect(textLength(t)).toBe(160);
    expect(t.endsWith(fam + '…')).toBe(true);
    expect(truncateGraphemes('kort', 160)).toBe('kort');
  });
});
