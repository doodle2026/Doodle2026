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
const INVISIBLE_RE = /[\s\u00AD\u180E\u200B-\u200F\u2028-\u202F\u2060-\u2064\uFEFF]/gu;
export const isBlank = (s: string) => s.replace(INVISIBLE_RE, '') === '';

export interface CleanOption { startAt: Date; endAt: Date | null }
export interface CleanEvent { title: string; description: string; timeOptions: CleanOption[] }

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

export function validateEvent(body: unknown, now: Date = new Date()): { errors: string[]; value: CleanEvent | null } {
  const errors: string[] = [];
  if (!isPlainObject(body)) return { errors: ['Forespørgslen skal være et JSON-objekt.'], value: null };

  let title = '';
  if (body.title != null && typeof body.title !== 'string') errors.push('Titel skal være tekst.');
  else {
    title = ((body.title as string | undefined) ?? '').trim();
    if (isBlank(title)) errors.push('Titel er påkrævet.');
    else if (textLength(title) > LIMITS.title) errors.push(`Titel må højst være ${LIMITS.title} tegn.`);
  }
  let description = '';
  if (body.description != null && typeof body.description !== 'string') errors.push('Beskrivelse skal være tekst.');
  else description = ((body.description as string | undefined) ?? '').trim();
  if (textLength(description) > LIMITS.description) errors.push(`Beskrivelse må højst være ${LIMITS.description} tegn.`);

  const clean: CleanOption[] = [];
  const raw = body.time_options;
  if (raw != null && !Array.isArray(raw)) errors.push('Tidsforslag skal være en liste.');
  else if (!raw || raw.length === 0) errors.push('Mindst ét tidsforslag er påkrævet.');
  else if (raw.length > LIMITS.timeOptions) errors.push(`Højst ${LIMITS.timeOptions} tidsforslag.`);
  else {
    const seen = new Set<string>();
    raw.forEach((o: unknown, i: number) => {
      const n = i + 1;
      if (!isPlainObject(o)) { errors.push(`Tidsforslag ${n}: skal være et objekt.`); return; }
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
      if (start < now) { errors.push(`Tidsforslag ${n}: tidspunktet ligger i fortiden.`); return; }
      const key = `${start.getTime()}|${end?.getTime() ?? ''}`;
      if (seen.has(key)) return; // dedupe identical instants, even if written with different offsets
      seen.add(key);
      clean.push({ startAt: start, endAt: end });
    });
  }
  return { errors, value: errors.length ? null : { title, description, timeOptions: clean } };
}
