import { describe, test, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { addDays, addMonths, basicDate, columnHead, dateRange, formatDateLong, formatDateShort, isRealDate, minAllowedDate, weekdayMon } from '../src/lib/dates';
import { validateEvent } from '../src/lib/validate';
import { buildIcs } from '../src/lib/ics';
import { googleCalendarUrlFor, optionLong } from '../src/lib/format';

describe('date helpers (UTC strings only)', () => {
  test('real calendar dates incl. leap years', () => {
    expect(isRealDate('2028-02-29')).toBe(true);
    expect(isRealDate('2027-02-29')).toBe(false);
    expect(isRealDate('2100-02-29')).toBe(false);
    expect(isRealDate('2000-02-29')).toBe(true);
    for (const bad of ['2026-04-31', '2026-13-01', '2026-00-10', '2026-1-05', '26-01-05', '2026-01-05T00:00', ' 2026-01-05', 5, null]) expect(isRealDate(bad), String(bad)).toBe(false);
  });
  test('Danish formats', () => {
    expect(formatDateShort('2026-10-16')).toBe('fre. 16. okt. 2026');
    expect(formatDateLong('2026-11-03')).toBe('tirsdag 3. november 2026');
    expect(columnHead('2026-10-16')).toEqual(['Fre.', '16. okt.']);
    expect(optionLong({ date: '2026-10-16' })).toBe('fre. 16. okt. 2026 (hele dagen)');
  });
  test('calendar math', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-03-15', -12)).toBe('2025-03-15');
    expect(dateRange('2026-10-03', '2026-09-30')).toEqual(['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']);
    expect(weekdayMon('2026-10-12')).toBe(0); // Monday
    expect(basicDate('2026-10-16')).toBe('20261016');
  });
  test('today boundary: min = UTC today − 1 day (UTC−12 … UTC+14 local todays all allowed)', () => {
    expect(minAllowedDate(new Date('2026-10-11T00:30:00Z'))).toBe('2026-10-10');
    expect(minAllowedDate(new Date('2026-10-11T23:59:00Z'))).toBe('2026-10-10');
    const now = new Date('2026-10-11T11:00:00Z'); // UTC−12: 10 Oct 23:00, UTC+14: 12 Oct 01:00
    const v = (d: string) => validateEvent({ title: 'x', options: [{ date: d }] }, now).errors;
    expect(v('2026-10-10')).toEqual([]);
    expect(v('2026-10-12')).toEqual([]);
    expect(v('2026-10-09')[0]).toMatch(/fortiden/);
  });
  test('validation: duplicates rejected (not deduped), 1–100, sorted ascending', () => {
    const now = new Date('2026-10-11T11:00:00Z');
    expect(validateEvent({ title: 'x', options: [{ date: '2026-11-02' }, { date: '2026-11-02' }] }, now).errors).toEqual(['Dato 2: 2026-11-02 er valgt flere gange.']);
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ date: addDays('2026-11-01', i) }));
    expect(validateEvent({ title: 'x', options: mk(100) }, now).errors).toEqual([]);
    expect(validateEvent({ title: 'x', options: mk(101) }, now).errors).toEqual(['Højst 100 datoer.']);
    const v = validateEvent({ title: 'x', options: [{ date: '2026-12-01' }, { date: '2026-11-05' }] }, now).value!;
    expect(v.timeOptions.map((o) => o.date)).toEqual(['2026-11-05', '2026-12-01']);
  });
  test('.ics all-day: VALUE=DATE, exclusive next-day DTEND, no TZID; Google dates=YYYYMMDD/YYYYMMDD', () => {
    const t = buildIcs({ uid: 'u@grabaday.com', stamp: new Date(0), sequence: 2, lastModified: new Date(0), date: '2026-10-16', summary: 'S' });
    expect(t).toContain('DTSTART;VALUE=DATE:20261016\r\nDTEND;VALUE=DATE:20261017\r\n');
    expect(t).toContain('SEQUENCE:2');
    expect(t).not.toMatch(/TZID|DTSTART:/);
    expect(googleCalendarUrlFor({ date: '2026-12-31' }, { title: 'T', url: 'https://x' })).toContain('dates=20261231%2F20270101');
  });
});

describe('same date renders identically in every process time zone', () => {
  const zones = ['Pacific/Kiritimati' /* UTC+14 */, 'UTC', 'America/Adak' /* UTC−10/−9 */, 'Pacific/Pago_Pago' /* UTC−11 */, 'Etc/GMT+12'];
  test.each(zones)('TZ=%s', (tz) => {
    const out = execFileSync('node_modules/.bin/vite-node', ['tests/fixtures/tz-render.ts'], { env: { ...process.env, TZ: tz } }).toString().trim().split('\n').pop()!;
    const res = JSON.parse(out);
    expect(res.pop()).toBe(tz); // the child really ran in that zone
    expect(res).toEqual(['fre. 16. okt. 2026', 'torsdag 1. januar 2026', ['Søn.', '29. mar.'], '2026-03-30', 4, 'fre. 16. okt. 2026',
      'DTSTART;VALUE=DATE:20261016\r\nDTEND;VALUE=DATE:20261017', [{ dateLabel: 'tors. 1. jan. 2026' }, { dateLabel: 'fre. 16. okt. 2026' }]]);
  });
});
