'use client';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { counterState, counterText, isBlank, mapServerErrors, shouldBlockEnter, textLength, liveTitleError } from '@/lib/form';
import { formatDateLong, formatDateShort, MAX_DATE_OPTIONS, minAllowedDate } from '@/lib/dates';

const TITLE_MAX = 200;
const DESC_MAX = 2000;

const localToday = () => new Intl.DateTimeFormat('en-CA').format(new Date()); // YYYY-MM-DD, browser's calendar
const newKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);

/**
 * Create a date-only poll (minimal UI until the design's month calendar lands): pick dates one by one.
 * Dates are plain 'YYYY-MM-DD' strings – no times, no time zones.
 */
export default function CreateForm() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [newDate, setNewDate] = useState('');
  const [dates, setDates] = useState<string[]>([]);
  const [summary, setSummary] = useState<string[]>([]);
  const [titleErr, setTitleErr] = useState('');
  const [descErr, setDescErr] = useState('');
  const [propErr, setPropErr] = useState('');
  const [live, setLive] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const requestKey = useRef('');
  const focusNext = useRef<string | null>(null);

  // Content changed → new request key (an identical resubmit keeps the key → same poll).
  useEffect(() => { if (!submitting) requestKey.current = newKey(); }, [title, description, dates]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!focusNext.current) return;
    document.querySelector<HTMLElement>(focusNext.current)?.focus();
    focusNext.current = null;
  }, [dates]);

  function addDate() {
    if (!newDate) { setPropErr('Vælg en dato først.'); document.getElementById('newdate')?.focus(); return; }
    if (newDate < minAllowedDate() || newDate < localToday()) { setPropErr('Datoen ligger i fortiden.'); return; }
    if (dates.includes(newDate)) { setPropErr('Datoen er allerede tilføjet.'); return; }
    if (dates.length >= MAX_DATE_OPTIONS) { setPropErr(`Du kan højst have ${MAX_DATE_OPTIONS} datoer.`); return; }
    setPropErr('');
    setDates((ds) => [...ds, newDate].sort());
    setLive('Dato tilføjet: ' + formatDateLong(newDate));
    setNewDate('');
  }
  function removeDate(d: string) {
    const i = dates.indexOf(d);
    const rest = dates.filter((x) => x !== d);
    const target = rest[i] ?? rest[i - 1];
    focusNext.current = target ? `[data-date="${target}"] button` : '#newdate';
    setDates(rest);
    setLive('Dato fjernet');
  }

  function reset() {
    setTitle(''); setDescription(''); setNewDate(''); setDates([]); setSummary([]);
    setTitleErr(''); setDescErr(''); setPropErr('');
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const errs: string[] = [];
    const tLen = textLength(title.trim());
    const titleBad = isBlank(title) || tLen > TITLE_MAX;
    if (isBlank(title)) { errs.push('Titel skal udfyldes.'); setTitleErr('Giv afstemningen en titel.'); }
    else if (tLen > TITLE_MAX) { const m = `Titlen er ${tLen - TITLE_MAX} tegn for lang (højst ${TITLE_MAX}).`; errs.push(m); setTitleErr(m); }
    else setTitleErr('');
    const dLen = textLength(description.trim());
    const descBad = dLen > DESC_MAX;
    if (descBad) { const m = `Beskrivelsen er ${dLen - DESC_MAX} tegn for lang (højst ${DESC_MAX}).`; errs.push(m); setDescErr(m); }
    else setDescErr('');
    if (!dates.length) errs.push('Tilføj mindst én dato.');
    setSummary(errs);
    if (errs.length) { document.getElementById(titleBad ? 'title' : descBad ? 'desc' : 'newdate')?.focus(); return; }

    setSubmitting(true);
    try {
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestKey.current },
        body: JSON.stringify({ title, description, options: dates.map((date) => ({ date })) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const { rows, general } = mapServerErrors(Array.isArray(data.errors) ? data.errors : ['Ukendt fejl.']);
        setSummary([...general, ...[...rows].map(([n, m]) => `${dates[n - 1] ? formatDateShort(dates[n - 1]) : `Dato ${n}`}: ${m}`)]);
        setSubmitting(false);
        document.getElementById('summary')?.focus();
        return;
      }
      // Hand the one-time admin link to the poll page via sessionStorage — never via the URL/history.
      try { if (data.admin_url) sessionStorage.setItem(`mt-admin-${data.id}`, data.admin_url); } catch { /* private mode */ }
      window.location.assign(`${data.url}?created=1`); // keep button locked while navigating
    } catch {
      setSummary(['Kunne ikke kontakte serveren. Prøv igen.']);
      setSubmitting(false);
    }
  }

  return (
    <>
      <form className="card create-form" id="form" noValidate onSubmit={onSubmit} onReset={reset}
        onKeyDown={(e: KeyboardEvent<HTMLFormElement>) => {
          if (shouldBlockEnter(e.key, e.target as HTMLInputElement)) e.preventDefault();
        }}>
        <h1>Opret en afstemning</h1>
        <p className="lead">Foreslå datoer, og del linket med deltagerne.</p>
        <div className="alert" id="summary" role="alert" tabIndex={-1}>
          {summary.length > 0 && (<><strong>Ret venligst følgende:</strong><ul>{summary.map((x) => <li key={x}>{x}</li>)}</ul></>)}
        </div>
        <div className="field">
          <label className="field__label" htmlFor="title">Titel *</label>
          <input className="input" id="title" name="title" placeholder="F.eks. Teammøde om Q4" autoComplete="off"
            aria-describedby="title-err title-count" aria-invalid={titleErr ? true : undefined}
            value={title} onChange={(e) => { setTitle(e.target.value); setTitleErr((err) => liveTitleError(err, e.target.value)); }} />
          <div className="field__meta">
            <div className="field__error" id="title-err" aria-live="polite">{titleErr}</div>
            <Counter id="title-count" value={title} max={TITLE_MAX} />
          </div>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="desc">Beskrivelse <span className="field__hint">(valgfri)</span></label>
          <textarea className="input" id="desc" name="description" placeholder="Hvad handler det om? Sted, link, agenda…"
            aria-describedby="desc-err desc-count" aria-invalid={descErr ? true : undefined}
            value={description} onChange={(e) => setDescription(e.target.value)} />
          <div className="field__meta">
            <div className="field__error" id="desc-err" aria-live="polite">{descErr}</div>
            <Counter id="desc-count" value={description} max={DESC_MAX} />
          </div>
        </div>
        <h2 id="prop-h">Datoer</h2>
        <div className="add-date">
          <div className="field">
            <label className="field__label" htmlFor="newdate">Vælg dato</label>
            <input className="input" type="date" id="newdate" lang="da" value={newDate} onChange={(e) => setNewDate(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDate(); } }} />
          </div>
          <button type="button" className="btn btn--secondary" id="adddate" onClick={addDate}>+ Tilføj dato</button>
        </div>
        <div className="field__error" id="prop-err" aria-live="polite">{propErr}</div>
        <div className="empty" id="empty" hidden={dates.length > 0}>
          <span className="empty__icon" aria-hidden="true">🗓️</span>Ingen datoer endnu.<br />Vælg en dato ovenfor for at komme i gang.
        </div>
        <ul className="proposals" id="proposals" aria-labelledby="prop-h">
          {dates.map((d) => (
            <li className="date-group anim-in" data-date={d} key={d}>
              <div className="date-group__head">
                <span className="date-group__title">{formatDateLong(d)}</span>
                <button type="button" className="btn btn--icon" aria-label={'Fjern dato ' + formatDateLong(d)} onClick={() => removeDate(d)}>🗑</button>
              </div>
            </li>
          ))}
        </ul>
        <div className="form-actions">
          <button type="reset" className="btn btn--ghost">Annullér</button>
          <button type="submit" className="btn btn--primary" id="submit" disabled={submitting} aria-busy={submitting || undefined}>
            {submitting ? 'Opretter…' : 'Opret afstemning'}
          </button>
        </div>
      </form>
      <p className="sr-only" id="live" aria-live="polite">{live}</p>
    </>
  );
}

/** Live grapheme counter (design §11). Never truncates; warn ≥ 90 %, over limit is blocked on submit. */
function Counter({ id, value, max }: { id: string; value: string; max: number }) {
  const n = textLength(value.trim());
  const st = counterState(n, max);
  return (
    <span className={`counter${st === 'over' ? ' counter--over' : st === 'warn' ? ' counter--warn' : ''}`} id={id} data-max={max}>
      {counterText(n, max)}
    </span>
  );
}
