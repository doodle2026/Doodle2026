const LIMITS = { title: 200, description: 2000, timeOptions: 100 };
// ISO 8601 with mandatory offset: 2026-11-03T09:00[:00[.sss]](Z|±HH:MM)
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d{1,3})?)?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const SLUG_RE = /^[A-Za-z0-9_-]{22}$/;
const IDEMPOTENCY_RE = /^[A-Za-z0-9_-]{8,100}$/;

/** Parse ISO datetime with offset → Date, or null if invalid (incl. impossible calendar dates). */
function parseIsoWithOffset(s) {
  if (typeof s !== 'string') return null;
  const m = ISO_RE.exec(s);
  if (!m) return null;
  const [, y, mo, d] = m;
  const cal = new Date(Date.UTC(+y, +mo - 1, +d));
  if (cal.getUTCFullYear() !== +y || cal.getUTCMonth() !== +mo - 1 || cal.getUTCDate() !== +d) return null;
  const t = new Date(s);
  return isNaN(t) ? null : t;
}

function validateEvent(body, now = new Date()) {
  const errors = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { errors: ['Forespørgslen skal være et JSON-objekt.'], value: null };
  }
  let title = '';
  if (body.title !== undefined && body.title !== null && typeof body.title !== 'string') errors.push('Titel skal være tekst.');
  else title = (body.title || '').trim();
  let description = '';
  if (body.description !== undefined && body.description !== null && typeof body.description !== 'string') errors.push('Beskrivelse skal være tekst.');
  else description = (body.description || '').trim();

  if (typeof body.title === 'string' || body.title == null) {
    if (!title) errors.push('Titel er påkrævet.');
    else if (title.length > LIMITS.title) errors.push(`Titel må højst være ${LIMITS.title} tegn.`);
  }
  if (description.length > LIMITS.description) errors.push(`Beskrivelse må højst være ${LIMITS.description} tegn.`);

  const clean = [];
  const raw = body.time_options;
  if (raw !== undefined && raw !== null && !Array.isArray(raw)) {
    errors.push('Tidsforslag skal være en liste.');
  } else if (!raw || raw.length === 0) {
    errors.push('Mindst ét tidsforslag er påkrævet.');
  } else if (raw.length > LIMITS.timeOptions) {
    errors.push(`Højst ${LIMITS.timeOptions} tidsforslag.`);
  } else {
    const seen = new Set();
    raw.forEach((o, i) => {
      const n = i + 1;
      if (!o || typeof o !== 'object' || Array.isArray(o)) { errors.push(`Tidsforslag ${n}: skal være et objekt.`); return; }
      const start = parseIsoWithOffset(o.start);
      if (!start) { errors.push(`Tidsforslag ${n}: ugyldigt starttidspunkt (ISO 8601 med tidszone, fx 2026-11-03T09:00:00+01:00).`); return; }
      let end = null;
      if (o.end !== undefined && o.end !== null && o.end !== '') {
        end = parseIsoWithOffset(o.end);
        if (!end) { errors.push(`Tidsforslag ${n}: ugyldigt sluttidspunkt (ISO 8601 med tidszone).`); return; }
        if (end <= start) { errors.push(`Tidsforslag ${n}: sluttidspunkt skal være efter starttidspunkt.`); return; }
      }
      if (start < now) { errors.push(`Tidsforslag ${n}: tidspunktet ligger i fortiden.`); return; }
      const v = { start_at: start.toISOString(), end_at: end ? end.toISOString() : null };
      const key = v.start_at + '|' + v.end_at;
      if (seen.has(key)) return; // dedupe identical instants (even if given in different offsets)
      seen.add(key);
      clean.push(v);
    });
  }
  return { errors, value: { title, description, time_options: clean } };
}

module.exports = { validateEvent, parseIsoWithOffset, LIMITS, SLUG_RE, IDEMPOTENCY_RE };
