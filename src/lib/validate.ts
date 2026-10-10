import { isRealDate, MAX_DATE_OPTIONS, minAllowedDate } from './dates';
export const LIMITS = { title: 200, description: 2000, timeOptions: 100, bodyBytes: 32 * 1024 } as const;
export const SLUG_RE = /^[A-Za-z0-9_-]{22}$/;
// ≥ 16 chars: the key also protects the replayable admin token (the frontend sends a UUID).
export const IDEMPOTENCY_RE = /^[A-Za-z0-9_-]{16,100}$/;

/**
 * Length in user-perceived characters (grapheme clusters): 👨‍👩‍👧‍👦 = 1, 👍🏽 = 1, é (e + U+0301) = 1.
 * The frontend counter uses the same function, so UI and server always agree.
 */
const segmenter = new Intl.Segmenter('da', { granularity: 'grapheme' });
export function textLength(s: string): number {
  let n = 0;
  for (const _ of segmenter.segment(s)) n++; // eslint-disable-line @typescript-eslint/no-unused-vars
  return n;
}
// Zero-width / invisible chars (U+200B–U+200D, U+2060, U+FEFF per design §11, plus other invisibles) are stripped before the emptiness check.
/** Whitespace + every invisible/format char we treat as "nothing": soft hyphen U+00AD, CGJ U+034F, Arabic letter
 * mark U+061C, Mongolian VS U+180E, ZWSP/ZWNJ/ZWJ/LRM/RLM U+200B-200F, line/para sep + bidi embeddings/overrides
 * U+2028-202E, NNBSP U+202F, word joiner/invisible operators U+2060-2064, bidi isolates U+2066-2069, BOM U+FEFF. */
export const INVISIBLE_RE = /[\s\u00AD\u034F\u061C\u180E\u200B-\u200F\u2028-\u202F\u2060-\u2064\u2066-\u2069\uFEFF]/gu;
export const isBlank = (s: string) => s.replace(INVISIBLE_RE, '') === '';

// Invisible format chars (no whitespace): soft hyphen, Mongolian VS, ZW space/ZWNJ/ZWJ, LRM/RLM, bidi
// embeddings/isolates (U+202A-202E), word joiner & invisible operators, BOM.
/** INVISIBLE_RE minus ordinary whitespace (spaces/newlines are handled separately). */
export const INVISIBLE_FORMAT_RE = /[\u00AD\u034F\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/gu;
// A ZWJ is only meaningful between two pictographs (👨‍👩‍👧). Keep exactly those, drop every other invisible char.
const EMOJI_ZWJ_RE = /(\p{Extended_Pictographic}[\u{FE0F}\u{1F3FB}-\u{1F3FF}]?)\u200D(?=\p{Extended_Pictographic})/gu;
const ZWJ_MARK = '\u{F0000}'; // private-use placeholder while stripping

/**
 * Shared person-name normalizer (votes): removes invisible/format characters (except emoji ZWJ),
 * collapses whitespace, trims. Used for display AND (with NFKC + lower-case) for uniqueness.
 */
export function stripInvisible(s: string): string {
  return s.replace(EMOJI_ZWJ_RE, `$1${ZWJ_MARK}`).replace(INVISIBLE_FORMAT_RE, '').replaceAll(ZWJ_MARK, '\u200D');
}
export function normalizeName(s: string): string {
  return stripInvisible(s).replace(/\s+/g, ' ').trim();
}
/** Uniqueness key: normalized, NFKC, Danish lower-case, and with no invisible chars at all. */
export const nameKey = (s: string) => normalizeName(s).normalize('NFKC').replace(INVISIBLE_RE, (c) => (c === ' ' ? ' ' : '')).toLocaleLowerCase('da');

/** A date option: 'YYYY-MM-DD' (whole day). */
export interface CleanOption { id?: number; date: string }
export interface CleanEvent { title: string; description: string; timeOptions: CleanOption[] }

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export interface ValidateOptions {
  /** PATCH: options may carry an existing `id` (positive int). */
  allowIds?: boolean;
  /** PATCH: unchanged existing options may stay even if they now lie in the past. */
  pastAllowed?: (o: CleanOption) => boolean;
}

/** Date options: 1–100 real dates ≥ UTC today − 1 day, duplicates → 400 (not deduped), returned sorted ascending. */
function validateDates(raw: unknown, now: Date, opts: ValidateOptions, errors: string[]): CleanOption[] {
  const clean: CleanOption[] = [];
  if (raw != null && !Array.isArray(raw)) { errors.push('Datoer skal være en liste.'); return clean; }
  if (!raw || raw.length === 0) { errors.push('Mindst én dato er påkrævet.'); return clean; }
  if (raw.length > MAX_DATE_OPTIONS) { errors.push(`Højst ${MAX_DATE_OPTIONS} datoer.`); return clean; }
  const min = minAllowedDate(now);
  const seen = new Set<string>(), seenIds = new Set<number>();
  raw.forEach((o: unknown, i: number) => {
    const n = i + 1;
    if (!isPlainObject(o)) { errors.push(`Dato ${n}: skal være et objekt.`); return; }
    let id: number | undefined;
    if (o.id !== undefined && o.id !== null) {
      if (!opts.allowIds || typeof o.id !== 'number' || !Number.isSafeInteger(o.id) || o.id <= 0) { errors.push(`Dato ${n}: ugyldigt id.`); return; }
      if (seenIds.has(o.id)) { errors.push(`Dato ${n}: id findes to gange.`); return; }
      seenIds.add(o.id); id = o.id;
    }
    if (!isRealDate(o.date)) { errors.push(`Dato ${n}: ugyldig dato (format ÅÅÅÅ-MM-DD, fx 2026-10-16).`); return; }
    const c: CleanOption = { ...(id !== undefined ? { id } : {}), date: o.date };
    if (o.date < min && !opts.pastAllowed?.(c)) { errors.push(`Dato ${n}: datoen ligger i fortiden.`); return; }
    if (seen.has(o.date)) { errors.push(`Dato ${n}: ${o.date} er valgt flere gange.`); return; }
    seen.add(o.date);
    clean.push(c);
  });
  return clean.sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function validateEvent(body: unknown, now: Date = new Date(), opts: ValidateOptions = {}):
  { errors: string[]; value: CleanEvent | null } {
  const errors: string[] = [];
  if (!isPlainObject(body)) return { errors: ['Forespørgslen skal være et JSON-objekt.'], value: null };

  let title = '';
  if (body.title != null && typeof body.title !== 'string') errors.push('Titel skal være tekst.');
  else {
    title = stripInvisible((body.title as string | undefined) ?? '').trim();
    if (isBlank(title)) errors.push('Titel er påkrævet.');
    else if (textLength(title) > LIMITS.title) errors.push(`Titel må højst være ${LIMITS.title} tegn.`);
  }
  let description = '';
  if (body.description != null && typeof body.description !== 'string') errors.push('Beskrivelse skal være tekst.');
  else description = stripInvisible((body.description as string | undefined) ?? '').trim();
  if (textLength(description) > LIMITS.description) errors.push(`Beskrivelse må højst være ${LIMITS.description} tegn.`);

  if (body.options === undefined && body.time_options !== undefined) errors.push('Afstemninger bruger datoer: send options: [{ "date": "ÅÅÅÅ-MM-DD" }].');
  const dates = errors.length && body.options === undefined ? [] : validateDates(body.options, now, opts, errors);
  return { errors, value: errors.length ? null : { title, description, timeOptions: dates } };
}
