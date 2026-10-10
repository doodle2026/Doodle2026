'use client';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { counterState, counterText, isBlank, mapServerErrors, shouldBlockEnter, textLength, liveTitleError } from '@/lib/form';
import { formatDateShort, MAX_DATE_OPTIONS } from '@/lib/dates';
import DatePicker, { DateChips } from '@/components/DatePicker';

const TITLE_MAX = 200;
const DESC_MAX = 2000;

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
  const [dates, setDates] = useState<string[]>([]);
  const [summary, setSummary] = useState<string[]>([]);
  const [titleErr, setTitleErr] = useState('');
  const [descErr, setDescErr] = useState('');
  const [propErr, setPropErr] = useState('');
  const [live, setLive] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const requestKey = useRef('');

  // Content changed → new request key (an identical resubmit keeps the key → same poll).
  useEffect(() => { if (!submitting) requestKey.current = newKey(); }, [title, description, dates]); // eslint-disable-line react-hooks/exhaustive-deps

  const MAX = MAX_DATE_OPTIONS;
  function reset() {
    setTitle(''); setDescription(''); setDates([]); setSummary([]);
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
    if (!dates.length) { errs.push('Vælg mindst én dato.'); setPropErr('Vælg mindst én dato i kalenderen.'); }
    setSummary(errs);
    if (errs.length) { if (titleBad || descBad) document.getElementById(titleBad ? 'title' : 'desc')?.focus(); else document.querySelector<HTMLElement>('#dp td[tabindex="0"]')?.focus(); return; }

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
        <h2 id="prop-h">Datoforslag</h2>
        <p className="field__hint" style={{ marginTop: 'calc(-1 * var(--s-2))' }}>Vælg de datoer, deltagerne kan stemme på. Kun hele dage.</p>
        <div className="field__error" id="prop-err" aria-live="polite">{propErr}</div>
        <div className="date-picker-layout">
          <DatePicker selected={dates} max={MAX} label="Vælg datoer"
            onChange={(ds, msg) => { setDates(ds); setPropErr(''); if (msg) setLive(msg); }}
            onError={(m) => { setPropErr(m); setLive(m); }} />
          <DateChips dates={dates} max={MAX}
            onRemove={(d) => { setDates((ds) => ds.filter((x) => x !== d)); setLive(`${formatDateShort(d)} fjernet`); }}
            onClear={() => { setDates([]); setLive('Alle datoer fjernet'); setTimeout(() => document.querySelector<HTMLElement>('#dp td[tabindex="0"]')?.focus(), 0); }} />
        </div>
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
