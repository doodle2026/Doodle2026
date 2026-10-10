import { textLength } from './validate';

/** "14. oktober 2026" / "14.–16. oktober 2026" / "30. oktober – 2. november 2026" style, from plain 'YYYY-MM-DD' dates (UTC = no shift). */
export function dateRangeDa(dates: string[]): string {
  if (!dates.length) return '';
  const p = (iso: string) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('da-DK', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' })
      .formatToParts(new Date(`${iso}T00:00:00Z`)).map((x) => [x.type, x.value]));
    return { d: parts.day, m: parts.month, y: parts.year };
  };
  const sorted = [...dates].sort();
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

export function pollDescription(n: number, dates: string[]): string {
  return `Vælg de datoer, der passer dig. ${n} datoforslag, ${dateRangeDa(dates)}.`;
}
