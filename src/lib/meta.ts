import { textLength } from './validate';

const ZONE = 'Europe/Copenhagen'; // link previews are rendered server-side for a Danish audience

/** "14. oktober 2026" / "14.–16. oktober 2026" / "30. oktober – 2. november 2026" / "30. dec. 2026 – 2. jan. 2027" style. */
export function dateRangeDa(isoStarts: string[]): string {
  if (!isoStarts.length) return '';
  const p = (iso: string) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('da-DK', { timeZone: ZONE, day: 'numeric', month: 'long', year: 'numeric' })
      .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
    return { d: parts.day, m: parts.month, y: parts.year };
  };
  const sorted = [...isoStarts].sort();
  const a = p(sorted[0]), b = p(sorted[sorted.length - 1]);
  if (a.y !== b.y) return `${a.d}. ${a.m} ${a.y} – ${b.d}. ${b.m} ${b.y}`;
  if (a.m !== b.m) return `${a.d}. ${a.m} – ${b.d}. ${b.m} ${b.y}`;
  if (a.d !== b.d) return `${a.d}.–${b.d}. ${b.m} ${b.y}`;
  return `${a.d}. ${a.m} ${a.y}`;
}

/** Truncate to max graphemes at a word boundary, never inside a grapheme (emoji/ZWJ), adding "…". */
export function truncateGraphemes(s: string, max: number): string {
  if (textLength(s) <= max) return s;
  const segs = [...new Intl.Segmenter('da', { granularity: 'grapheme' }).segment(s)].map((x) => x.segment).slice(0, max - 1);
  let out = segs.join('');
  const sp = out.search(/\s\S*$/);
  if (sp > out.length * 0.6) out = out.slice(0, sp);
  return out.trimEnd() + '…';
}

export function pollDescription(n: number, starts: string[]): string {
  return `Stem på det tidspunkt, der passer dig. ${n} tidsforslag, ${dateRangeDa(starts)}.`;
}
