// Minimal RFC 5545 VCALENDAR/VEVENT writer (no deps).
const CRLF = '\r\n';

/** TEXT escaping (RFC 5545 §3.3.11): backslash, semicolon, comma, newlines. Control chars dropped. */
export function icsEscape(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

/** Fold to ≤ 75 octets per line (§3.1), never splitting a UTF-8 character; continuation lines start with a space. */
export function icsFold(line: string): string {
  const out: string[] = [];
  let cur = '', bytes = 0, limit = 75;
  for (const ch of line) {
    const b = Buffer.byteLength(ch, 'utf8');
    if (bytes + b > limit) { out.push(cur); cur = ' '; bytes = 1; limit = 75; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join(CRLF);
}

/** 20261103T090000Z */
export const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export interface IcsEvent { uid: string; stamp: Date; start: Date; end: Date | null; summary: string; description?: string; url?: string }
export const DEFAULT_DURATION_MS = 60 * 60 * 1000;

export function buildIcs(e: IcsEvent): string {
  const end = e.end ?? new Date(e.start.getTime() + DEFAULT_DURATION_MS);
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Moedetid//Moedetid 1.0//DA', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${e.uid}`, `DTSTAMP:${icsDate(e.stamp)}`, `DTSTART:${icsDate(e.start)}`, `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsEscape(e.summary)}`,
    ...(e.description ? [`DESCRIPTION:${icsEscape(e.description)}`] : []),
    ...(e.url ? [`URL:${e.url}`] : []),
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return lines.map(icsFold).join(CRLF) + CRLF;
}

/** ASCII-safe filename + RFC 5987 UTF-8 variant for Content-Disposition. */
export function icsDisposition(title: string): string {
  const base = title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/æ/gi, 'ae').replace(/ø/gi, 'oe').replace(/å/gi, 'aa')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).toLowerCase() || 'moede';
  const utf8 = encodeURIComponent((title.replace(/[\\/:*?"<>|\u0000-\u001F]+/g, ' ').trim().slice(0, 80) || 'moede') + '.ics');
  return `attachment; filename="${base}.ics"; filename*=UTF-8''${utf8}`;
}
