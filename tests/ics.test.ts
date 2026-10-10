import { describe, test, expect } from 'vitest';
import { buildIcs, icsDate, icsDisposition, icsEscape, icsFold } from '../src/lib/ics';

describe('ics', () => {
  test('escape TEXT: \\ ; , newline; drop control chars', () => {
    expect(icsEscape('a\\b;c,d\r\ne\nf\u0007')).toBe('a\\\\b\\;c\\,d\\ne\\nf');
  });
  test('fold at 75 octets with CRLF + space, never splitting UTF-8', () => {
    const line = 'SUMMARY:' + 'æ'.repeat(100);
    const folded = icsFold(line);
    for (const l of folded.split('\r\n')) expect(Buffer.byteLength(l, 'utf8')).toBeLessThanOrEqual(75);
    expect(folded.split('\r\n').slice(1).every((l) => l.startsWith(' '))).toBe(true);
    expect(folded.replace(/\r\n /g, '')).toBe(line);
    expect(icsFold('short')).toBe('short');
  });
  test('VEVENT: all-day date, CRLF everywhere, stable UID', () => {
    const s = buildIcs({ uid: 'abc-1@x', stamp: new Date('2026-10-10T10:00:00Z'), date: '2027-11-03',
      summary: 'Møde; nr, 1', description: 'Linje 1\nLinje 2', url: 'https://x/p/abc' });
    expect(s).toContain('\r\nUID:abc-1@x\r\n');
    expect(buildIcs({ uid: 'u', stamp: new Date(0), date: '1970-01-01', summary: 's', sequence: 3, lastModified: new Date('2026-01-02T03:04:05Z') }))
      .toContain('DTSTAMP:19700101T000000Z\r\nSEQUENCE:3\r\nLAST-MODIFIED:20260102T030405Z\r\n');
    expect(s).toContain('DTSTAMP:20261010T100000Z');
    expect(s).toContain('DTSTART;VALUE=DATE:20271103\r\nDTEND;VALUE=DATE:20271104');
    expect(s).toContain('SUMMARY:Møde\\; nr\\, 1');
    expect(s).toContain('DESCRIPTION:Linje 1\\nLinje 2');
    expect(s.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(s.endsWith('END:VEVENT\r\nEND:VCALENDAR\r\n')).toBe(true);
    expect(s.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(icsDate(new Date('2027-01-02T03:04:05.678Z'))).toBe('20270102T030405Z');
  });
  test('safe filename (ASCII + RFC 5987 UTF-8)', () => {
    expect(icsDisposition('Teammøde "Q4" / <script>')).toBe(
      `attachment; filename="teammoede-q4-script.ics"; filename*=UTF-8''${encodeURIComponent('Teammøde Q4 script.ics')}`);
    const bidi = icsDisposition('a\u202Egnp\u2066\u2069\u202A.exe');
    expect(bidi).toBe(`attachment; filename="agnp-exe.ics"; filename*=UTF-8''${encodeURIComponent('agnp.exe.ics')}`);
    expect(icsDisposition('🎉🎉')).toMatch(/^attachment; filename="moede\.ics"/);
    // K5: plain filename= is pure ASCII (æøå → ae/oe/aa, emoji dropped); filename*= keeps the UTF-8 title.
    const k5 = icsDisposition('Sommerfest på Ærø 🎉 Café');
    expect(k5).toBe(`attachment; filename="sommerfest-paa-aeroe-cafe.ics"; filename*=UTF-8''${encodeURIComponent('Sommerfest på Ærø 🎉 Café.ics')}`);
    expect(/^[\x20-\x7E]*$/.test(k5)).toBe(true);
    expect(icsDisposition('Gåtur 🥾').split(';')[1]).toBe(' filename="gaatur.ics"');
  });
});
