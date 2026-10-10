import { describe, expect, it } from 'vitest';
import { focusAfterDelete, undoMessage } from '../src/lib/admin-ui';
import { googleCalendarUrlFor } from '../src/lib/format';

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
  it('Google Calendar link: all-day dates, includes poll url', () => {
    const u = new URL(googleCalendarUrlFor({ date: '2026-11-01' }, { title: 'Møde & kage', url: 'https://x/p/abc' }));
    expect(u.hostname).toBe('calendar.google.com');
    expect(u.searchParams.get('dates')).toBe('20261101/20261102');
    expect(u.searchParams.get('text')).toBe('Møde & kage');
    expect(u.searchParams.get('details')).toContain('https://x/p/abc');
  });
});
