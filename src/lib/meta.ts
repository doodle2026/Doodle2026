import { formatSpan, type DateLocale } from './dates';
import { textLength } from './validate';

/** Truncate to max graphemes at a word boundary, never inside a grapheme (emoji/ZWJ), adding "…". */
export function truncateGraphemes(s: string, max: number): string {
  if (textLength(s) <= max) return s;
  const segs = [...new Intl.Segmenter('da', { granularity: 'grapheme' }).segment(s)].map((x) => x.segment).slice(0, max - 1);
  let out = segs.join('');
  const sp = out.search(/\s\S*$/);
  if (sp > out.length * 0.6) out = out.slice(0, sp);
  return out.trimEnd() + '…';
}

type T = (key: 'poll.metaDesc' | 'date.count', vars: Record<string, string | number>) => string;
/** og:description / meta (§45.3): "Choose the dates that suit you. 5 date proposals, October 14 – 22, 2026." */
export function pollDescription(dates: string[], locale: DateLocale, t: T): string {
  return t('poll.metaDesc', { count: t('date.count', { n: dates.length }), range: formatSpan(dates, locale) });
}
