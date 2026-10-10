import { describe, expect, it } from 'vitest';
import { defaultVoteAction, focusAfterDelete, undoMessage, validateOptionEdit } from '../src/lib/admin-ui';
import { googleCalendarUrl } from '../src/lib/format';

describe('admin UI helpers (round 4)', () => {
  it('undo toast text for pick / change / clear', () => {
    expect(undoMessage(null, 3, 'Ons 14. okt 09.00')).toBe('Ons 14. okt 09.00 er valgt.');
    expect(undoMessage(2, 3, 'X')).toBe('Skiftet til X.');
    expect(undoMessage(2, null, '')).toBe('Valget er fjernet.');
  });
  it('focus after delete: next, else previous, else heading', () => {
    expect(focusAfterDelete([1, 2, 3], 2)).toBe(3);
    expect(focusAfterDelete([1, 2, 3], 3)).toBe(2);
    expect(focusAfterDelete([1], 1)).toBeNull();
  });
  it('option edit validation', () => {
    const now = new Date('2026-10-10T12:00');
    const ok = { date: '2026-11-01', start: '09:00', end: '' };
    expect(validateOptionEdit(ok, [], now)).toBeNull();
    expect(validateOptionEdit({ ...ok, start: '' }, [], now)?.fields).toEqual(['start']);
    expect(validateOptionEdit({ ...ok, end: '08:00' }, [], now)?.fields).toEqual(['end']);
    expect(validateOptionEdit(ok, [{ ...ok }], now)?.msg).toMatch(/findes allerede/);
    expect(validateOptionEdit({ ...ok, date: '2026-10-01' }, [], now)?.msg).toMatch(/fortiden/);
  });
  it('vote action default: only end changed → keep, otherwise reset', () => {
    expect(defaultVoteAction({ date: 'a', start: '09:00' }, { date: 'a', start: '09:00' })).toBe('keep');
    expect(defaultVoteAction({ date: 'a', start: '09:00' }, { date: 'a', start: '10:00' })).toBe('reset');
  });
  it('Google Calendar link: UTC dates, 1 h default, includes poll url', () => {
    const u = new URL(googleCalendarUrl({ title: 'Møde & kage', start: '2026-11-01T08:00:00.000Z', end: null, url: 'https://x/p/abc' }));
    expect(u.hostname).toBe('calendar.google.com');
    expect(u.searchParams.get('dates')).toBe('20261101T080000Z/20261101T090000Z');
    expect(u.searchParams.get('text')).toBe('Møde & kage');
    expect(u.searchParams.get('details')).toContain('https://x/p/abc');
  });
});
