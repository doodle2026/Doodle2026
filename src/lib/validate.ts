import { isRealDate, MAX_DATE_OPTIONS, minAllowedDate } from './dates';
export const LIMITS = { title: 200, description: 2000, timeOptions: 100, bodyBytes: 32 * 1024 } as const;
// ISO 8601 with mandatory offset: 2026-11-03T09:00[:00[.sss]](Z|±HH:MM)
const ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d{1,3})?)?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
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

/** Legacy timed polls: startAt/endAt set, date null. Date polls: date 'YYYY-MM-DD', startAt/endAt null. */
export interface CleanOption { id?: number; startAt: Date | null; endAt: Date | null; date: string | null }
export type PollMode = 'date' | 'datetime';
export interface CleanEvent { title: string; description: string; mode: PollMode; timeOptions: CleanOption[] }

/** Parse ISO datetime with offset → Date, or null if invalid (incl. impossible calendar dates). */
export function parseIsoWithOffset(s: unknown): Date | null {
  if (typeof s !== 'string') return null;
  const m = ISO_RE.exec(s);
  if (!m) return null;
  const [, y, mo, d] = m;
  const cal = new Date(Date.UTC(+y, +mo - 1, +d));
  if (cal.getUTCFullYear() !== +y || cal.getUTCMonth() !== +mo - 1 || cal.getUTCDate() !== +d) return null;
  const t = new Date(s);
  return isNaN(t.getTime()) ? null : t;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export interface ValidateOptions {
  /** PATCH: options may carry an existing `id` (positive int). */
  allowIds?: boolean;
  /** PATCH: unchanged existing options may stay even if they now lie in the past. */
  pastAllowed?: (o: CleanOption) => boolean;
  /** 'date' (default; reads `options: [{date}]`) or legacy 'datetime' (reads `time_options: [{start,end}]`). */
  mode?: PollMode;
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
    const c: CleanOption = { ...(id !== undefined ? { id } : {}), date: o.date, startAt: null, endAt: null };
    if (o.date < min && !opts.pastAllowed?.(c)) { errors.push(`Dato ${n}: datoen ligger i fortiden.`); return; }
    if (seen.has(o.date)) { errors.push(`Dato ${n}: ${o.date} er valgt flere gange.`); return; }
    seen.add(o.date);
    clean.push(c);
  });
  return clean.sort((a, b) => (a.date! < b.date! ? -1 : 1));
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

  const mode: PollMode = opts.mode ?? 'date';
  if (mode === 'date') {
    if (body.options === undefined && body.time_options !== undefined) errors.push('Afstemninger bruger nu datoer: send options: [{ "date": "ÅÅÅÅ-MM-DD" }].');
    const dates = errors.length && body.options === undefined ? [] : validateDates(body.options, now, opts, errors);
    return { errors, value: errors.length ? null : { title, description, mode, timeOptions: dates } };
  }
  // ---- Legacy timed polls (mode 'datetime') – kept as-is until legacy polls are retired. ----
  const clean: CleanOption[] = [];
  const raw = body.time_options;
  if (raw != null && !Array.isArray(raw)) errors.push('Tidsforslag skal være en liste.');
  else if (!raw || raw.length === 0) errors.push('Mindst ét tidsforslag er påkrævet.');
  else if (raw.length > LIMITS.timeOptions) errors.push(`Højst ${LIMITS.timeOptions} tidsforslag.`);
  else {
    const seen = new Set<string>();
    const seenIds = new Set<number>();
    raw.forEach((o: unknown, i: number) => {
      const n = i + 1;
      if (!isPlainObject(o)) { errors.push(`Tidsforslag ${n}: skal være et objekt.`); return; }
      let id: number | undefined;
      if (o.id !== undefined && o.id !== null) {
        if (!opts.allowIds || typeof o.id !== 'number' || !Number.isSafeInteger(o.id) || o.id <= 0) {
          errors.push(`Tidsforslag ${n}: ugyldigt id.`); return;
        }
        if (seenIds.has(o.id)) { errors.push(`Tidsforslag ${n}: id findes to gange.`); return; }
        seenIds.add(o.id);
        id = o.id;
      }
      // §0.7: new proposals in a legacy poll are plain dates ({ date }); existing ones may keep their times.
      if (o.start === undefined && o.date !== undefined) {
        if (!isRealDate(o.date)) { errors.push(`Tidsforslag ${n}: ugyldig dato (format ÅÅÅÅ-MM-DD).`); return; }
        const c: CleanOption = { ...(id !== undefined ? { id } : {}), date: o.date, startAt: null, endAt: null };
        if (o.date < minAllowedDate(now) && !opts.pastAllowed?.(c)) { errors.push(`Tidsforslag ${n}: datoen ligger i fortiden.`); return; }
        if (seen.has(`d|${o.date}`)) { errors.push(`Tidsforslag ${n}: ${o.date} er valgt flere gange.`); return; }
        seen.add(`d|${o.date}`); clean.push(c); return;
      }
      const start = parseIsoWithOffset(o.start);
      if (!start) {
        errors.push(`Tidsforslag ${n}: ugyldigt starttidspunkt (ISO 8601 med tidszone, fx 2026-11-03T09:00:00+01:00).`);
        return;
      }
      let end: Date | null = null;
      if (o.end !== undefined && o.end !== null && o.end !== '') {
        end = parseIsoWithOffset(o.end);
        if (!end) { errors.push(`Tidsforslag ${n}: ugyldigt sluttidspunkt (ISO 8601 med tidszone).`); return; }
        if (end <= start) { errors.push(`Tidsforslag ${n}: sluttidspunkt skal være efter starttidspunkt.`); return; }
      }
      if (start < now && !opts.pastAllowed?.({ id, startAt: start, endAt: end, date: null })) { errors.push(`Tidsforslag ${n}: tidspunktet ligger i fortiden.`); return; }
      const key = `${start.getTime()}|${end?.getTime() ?? ''}`;
      if (seen.has(key)) return; // dedupe identical instants, even if written with different offsets
      seen.add(key);
      clean.push({ ...(id !== undefined ? { id } : {}), startAt: start, endAt: end, date: null });
    });
  }
  const k = (o: CleanOption) => (o.date ? `${o.date}T00:00:00.000Z` : o.startAt!.toISOString());
  clean.sort((a, b) => k(a).localeCompare(k(b)));
  return { errors, value: errors.length ? null : { title, description, mode, timeOptions: clean } };
}
