'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { AdminEvent } from '@/lib/events';
import { forgetAdminToken, storeAdminToken, takeAdminToken } from '@/lib/admin-client';
import { bestIds, optionLabel } from '@/lib/format';
import { MAX_DATE_OPTIONS } from '@/lib/dates';
import DatePicker from '@/components/DatePicker';
import AdminResults from './AdminResults';
import InviteSection from './InviteSection';
import OptionEditRow, { type EditResult } from './OptionEditRow';
import type { EditErr } from '@/lib/admin-ui';
import { copyText } from '@/lib/share';
import { counterState, counterText, isBlank, liveTitleError, mapServerErrors, textLength } from '@/lib/form';

const TITLE_MAX = 200;
const DESC_MAX = 2000;

type Opt = { key: string; id?: number; date: string | null; start_at: string | null; end_at: string | null; votes: number };
const sortKey = (o: Opt) => o.date ?? o.start_at ?? '';
type Dialog = null | 'close' | 'reopen' | 'rotate' | 'delete-poll';
let seq = 0;

export default function AdminView({ slug, shareUrl }: { slug: string; shareUrl: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [ev, setEv] = useState<AdminEvent | null>(null);
  const dateMode = ev?.mode !== 'datetime';
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [opts, setOpts] = useState<Opt[]>([]);
  const [confirmedRemovals, setConfirmedRemovals] = useState(0);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const [titleErr, setTitleErr] = useState('');
  const [optErr, setOptErr] = useState('');
  const [summary, setSummary] = useState<string[]>([]);
  const [banner, setBanner] = useState('');
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addSel, setAddSel] = useState<string[]>([]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [chosen, setChosen] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [newAdminUrl, setNewAdminUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState<'' | 'url' | 'admin'>('');
  const [live, setLive] = useState('');
  const dlgRef = useRef<HTMLDialogElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const focusAfter = useRef<string | null>(null);

  const api = useCallback(async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`/api/events/${slug}${path}`, {
      ...init,
      headers: { ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }, [slug, token]);

  const load = useCallback((data: AdminEvent) => {
    setEv(data);
    setTitle(data.title); setDesc(data.description);
    setOpts(data.time_options.map((o) => ({ key: `o${o.id}`, id: o.id, date: o.date, start_at: o.start_at, end_at: o.end_at, votes: o.votes.total })));
    setConfirmedRemovals(0); setPendingRemove(null);
  }, []);

  /** Results changed on the server (delete/choose): refresh vote counts without discarding unsaved form edits. */
  const syncVotes = (e: AdminEvent) => setOpts((prev) => prev.map((o) => ({ ...o, votes: e.time_options.find((x) => x.id === o.id)?.votes.total ?? o.votes })));

  useEffect(() => {
    const t = takeAdminToken(slug, location, sessionStorage, (u) => history.replaceState(null, '', u));
    if (!t) { setState('denied'); return; }
    setToken(t);
  }, [slug]);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const { res, data } = await api('/admin');
        if (res.status === 401 || res.status === 403) { setState('denied'); return; }
        if (!res.ok) { setState('error'); return; }
        load(data); setState('ready');
      } catch { setState('error'); }
    })();
  }, [token, api, load]);

  useEffect(() => {
    if (!focusAfter.current) return;
    document.querySelector<HTMLElement>(focusAfter.current)?.focus();
    focusAfter.current = null;
  });

  if (state === 'loading') return <div className="card"><p>Indlæser…</p></div>;
  if (state === 'denied') {
    return (
      <section className="card notfound" aria-labelledby="den-h">
        <h1 id="den-h">Admin-linket virker ikke</h1>
        <p className="lead">Linket mangler en del, er skrevet forkert eller er blevet udskiftet med et nyt.
          Brug det seneste admin-link, du har gemt. Store og små bogstaver har betydning.</p>
        <div className="notfound__actions"><a className="btn btn--primary" href={`/p/${slug}`}>Se afstemningen</a></div>
      </section>
    );
  }
  if (state === 'error' || !ev) return <div className="card"><div className="alert" role="alert">Kunne ikke hente afstemningen. Prøv igen.</div></div>;

  const best = bestIds(ev.time_options);
  const optById = new Map(ev.time_options.map((o) => [o.id, o]));

  function onTitle(v: string) {
    setTitle(v);
    // N2: clear the error as soon as the field is valid again.
    setTitleErr((err) => liveTitleError(err, v, TITLE_MAX));
  }

  function removeOpt(o: Opt, idx: number) {
    if (opts.length === 1) { setOptErr('Der skal være mindst én dato.'); return; }
    if (o.votes > 0 && pendingRemove !== o.key) {
      setPendingRemove(o.key);
      focusAfter.current = '[data-confirm-remove]';
      return;
    }
    if (o.votes > 0) setConfirmedRemovals((n) => n + 1);
    const next = opts.filter((x) => x.key !== o.key);
    setOpts(next); setPendingRemove(null); setOptErr('');
    setLive(`${optionLabel(o)} fjernet`);
    const target = next[idx] ?? next[idx - 1];
    focusAfter.current = target ? `[data-rm="${target.key}"]` : '#nd';
  }

  /** §0.6: "+ Tilføj datoer" calendar popover; already proposed dates are taken. Legacy polls also only get dates (§0.7). */
  function addDates() {
    const fresh = addSel.filter((d) => !opts.some((o) => o.date === d));
    if (!fresh.length) return;
    if (opts.length + fresh.length > MAX_DATE_OPTIONS) { setOptErr(`Du kan højst have ${MAX_DATE_OPTIONS} datoer.`); return; }
    setOptErr('');
    setOpts([...opts, ...fresh.map((d) => ({ key: `n${++seq}`, date: d, start_at: null, end_at: null, votes: 0 }))].sort((a, b) => sortKey(a).localeCompare(sortKey(b))));
    setLive(`${fresh.length} ${fresh.length === 1 ? 'dato' : 'datoer'} tilføjet`);
    setAddSel([]); setAddOpen(false);
    focusAfter.current = '#addopt';
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    const tLen = textLength(title.trim());
    const errs: string[] = [];
    if (isBlank(title)) { setTitleErr('Giv afstemningen en titel.'); errs.push('Titel skal udfyldes.'); }
    else if (tLen > TITLE_MAX) { const m = `Titlen er ${tLen - TITLE_MAX} tegn for lang (højst ${TITLE_MAX}).`; setTitleErr(m); errs.push(m); }
    const dLen = textLength(desc.trim());
    if (dLen > DESC_MAX) errs.push(`Beskrivelsen er ${dLen - DESC_MAX} tegn for lang (højst ${DESC_MAX}).`);
    setSummary(errs);
    if (errs.length) { document.getElementById(isBlank(title) || tLen > TITLE_MAX ? 'title' : 'desc')?.focus(); return; }
    setSaving(true); setBanner('');
    try {
      const { res, data } = await api('', {
        method: 'PATCH',
        body: JSON.stringify({
          title, description: desc, confirm_remove_voted: confirmedRemovals > 0,
          ...(dateMode
            ? { options: opts.map((o) => ({ ...(o.id ? { id: o.id } : {}), date: o.date })) }
            // legacy: timed options keep start/end, new/changed ones are plain dates
            : { time_options: opts.map((o) => ({ ...(o.id ? { id: o.id } : {}), ...(o.date ? { date: o.date } : { start: o.start_at, end: o.end_at }) })) }),
        }),
      });
      if (res.status === 401 || res.status === 403) { setState('denied'); return; }
      if (!res.ok) {
        const { rows, general } = mapServerErrors(Array.isArray(data.errors) ? data.errors : ['Ukendt fejl.']);
        setSummary([...general, ...[...rows].map(([n, m]) => `Dato ${n} (${opts[n - 1] ? optionLabel(opts[n - 1]) : '?'}): ${m}`)]);
        document.getElementById('summary')?.focus();
        return;
      }
      load(data);
      setSummary([]);
      setBanner('✓ Ændringerne er gemt. Deltagerne ser dem med det samme.');
    } catch {
      setSummary(['Kunne ikke kontakte serveren. Prøv igen.']);
    } finally { setSaving(false); }
  }

  /** §31: save one option right away (own endpoint), keep other unsaved form edits. */
  async function saveOption(id: number, v: EditResult): Promise<EditErr> {
    try {
      const { res, data } = await api(`/options/${id}`, { method: 'PATCH', body: JSON.stringify(v) });
      if (res.status === 401 || res.status === 403) { setState('denied'); return null; }
      if (res.status === 409 && data.code === 'duplicate_option') return { msg: 'Den dato findes allerede som et andet forslag.', fields: ['date'] };
      if (!res.ok) return { msg: (Array.isArray(data.errors) && data.errors[0]) || 'Datoen kunne ikke gemmes.', fields: ['date'] };
      setEv(data);
      const fresh = data.time_options.find((x: AdminEvent['time_options'][number]) => x.id === id);
      setOpts((prev) => prev.map((o) => (o.id === id ? { ...o, date: fresh.date, start_at: fresh.start_at, end_at: fresh.end_at, votes: fresh.votes.total } : o))
        .sort((a, b) => sortKey(a).localeCompare(sortKey(b))));
      setEditingId(null);
      const n = data.reset_votes_count as number;
      const chosenNote = n > 0 && data.chosen_option_id === id ? ' Tjek om det stadig er det rigtige valg.' : '';
      setBanner(`✓ Datoen er ændret til ${fresh.date ? optionLabel(fresh) : ''} – ${n > 0 ? `${n} svar er nulstillet.` : 'svarene er bevaret.'}${chosenNote}`);
      focusAfter.current = `[data-oe="${id}"]`;
      return null;
    } catch { return { msg: 'Kunne ikke kontakte serveren. Prøv igen.', fields: [] }; }
  }

  function openDialog(kind: Exclude<Dialog, null>) {
    lastFocus.current = document.activeElement as HTMLElement;
    if (kind === 'close') {
      const firstBest = ev!.time_options.find((o) => best.has(o.id));
      setChosen(firstBest ? String(firstBest.id) : '');
    }
    setDialog(kind);
    setTimeout(() => { dlgRef.current?.showModal(); document.getElementById('dlg-cancel')?.focus(); }, 0);
  }
  function closeDialog() { dlgRef.current?.close(); }

  async function confirmDialog() {
    if (busy) return;
    setBusy(true);
    try {
      const path = dialog === 'close' ? '/close' : dialog === 'reopen' ? '/reopen' : '/rotate-admin';
      const body = dialog === 'close' ? { chosen_option_id: chosen ? Number(chosen) : null } : {};
      if (dialog === 'delete-poll') {
        const { res, data } = await api('', { method: 'DELETE' });
        if (res.status === 401 || res.status === 403) { setState('denied'); return; }
        if (!res.ok && res.status !== 404) { dlgRef.current?.close(); setSummary(Array.isArray(data.errors) ? data.errors : ['Sletning mislykkedes.']); return; }
        forgetAdminToken(slug, sessionStorage);
        location.replace('/?deleted=1');
        return;
      }
      const { res, data } = await api(path, { method: 'POST', body: JSON.stringify(body) });
      if (res.status === 401 || res.status === 403) { closeDialog(); setState('denied'); return; }
      if (!res.ok) { setSummary(Array.isArray(data.errors) ? data.errors : ['Ukendt fejl.']); closeDialog(); return; }
      setEv(data);
      if (dialog === 'close') {
        const c = data.chosen_option_id ? optById.get(data.chosen_option_id) : null;
        setBanner(`✓ Afstemningen er lukket.${c ? ` Valgt ${dateMode ? 'dato' : 'tidspunkt'}: ${optionLabel(c)}.` : ''}`);
      } else if (dialog === 'reopen') {
        setBanner('✓ Afstemningen er åbnet igen.');
      } else {
        storeAdminToken(slug, data.admin_token, sessionStorage);
        setToken(data.admin_token);
        setNewAdminUrl(`${location.origin}${data.admin_url}`);
        setBanner('✓ Nyt admin-link oprettet. Det gamle virker ikke længere.');
      }
      closeDialog();
    } catch {
      setSummary(['Kunne ikke kontakte serveren. Prøv igen.']); closeDialog();
    } finally { setBusy(false); }
  }

  async function copy(which: 'url' | 'admin', text: string, inputId: string) {
    const input = document.getElementById(inputId) as HTMLInputElement | null;
    const r = await copyText(text, { clipboard: navigator.clipboard, legacyCopy: () => { input?.select(); return document.execCommand?.('copy') ?? false; } });
    if (r === 'copied') { setCopied(which); setLive(which === 'url' ? 'Linket til deltagerne er kopieret' : 'Admin-linket er kopieret'); setTimeout(() => setCopied(''), 2000); }
    else { input?.focus(); input?.select(); setLive('Kunne ikke kopiere. Markér og kopiér manuelt.'); }
  }

  const closed = ev.is_closed;
  const dlgText = dialog === 'delete-poll'
    ? { h: `Slet «${ev.title}»?`, p: `Afstemningen, ${ev.time_options.length} datoforslag og ${ev.participants.length} deltageres svar slettes for altid. Både deltager- og admin-linket holder op med at virke. Det kan ikke fortrydes.`, ok: 'Slet for altid', cls: 'btn--danger' }
    : dialog === 'close'
    ? { h: 'Luk afstemningen?', p: 'Ingen kan længere stemme eller ændre svar. Du kan genåbne senere.', ok: 'Luk afstemning', cls: 'btn--danger' }
    : dialog === 'reopen'
      ? { h: 'Genåbn afstemningen?', p: 'Deltagerne kan igen stemme og ændre deres svar. Den valgte dato nulstilles.', ok: 'Genåbn', cls: 'btn--primary' }
      : { h: 'Lav et nyt admin-link?', p: 'Det nuværende admin-link holder op med at virke med det samme. Gem det nye link et sikkert sted.', ok: 'Lav nyt link', cls: 'btn--danger' };

  return (
    <div className="card">
      <div className="admin-head">
        <span className="admin-badge">🔒 Admin – kun for dig</span>
        <span className={`status ${closed ? 'status--closed' : 'status--open'}`}>
          <span aria-hidden="true">●</span> {closed ? 'Lukket' : 'Åben for svar'}
        </span>
      </div>
      <div className="alert" id="summary" role="alert" tabIndex={-1}>
        {summary.length > 0 && (<><strong>Ret venligst følgende:</strong><ul>{summary.map((x) => <li key={x}>{x}</li>)}</ul></>)}
      </div>
      <div id="banner" role="status">{banner && <div className="success">{banner}</div>}</div>

      {newAdminUrl && (
        <div className="linkbox linkbox--secret" role="group" aria-labelledby="na-l" aria-describedby="na-d">
          <p className="linkbox__label" id="na-l"><span className="icon-lock" aria-hidden="true">!</span> Dit nye hemmelige admin-link – gem det nu</p>
          <p className="linkbox__desc" id="na-d"><strong>Del det ikke.</strong> Det gamle link virker ikke længere. Linket vises kun her.</p>
          <div className="linkbox__row">
            <input className="input" id="new-admin-url" readOnly value={newAdminUrl} aria-label="Nyt hemmeligt admin-link" onFocus={(e) => e.currentTarget.select()} />
            <div className="linkbox__actions">
              <button type="button" className={`btn btn--secondary${copied === 'admin' ? ' btn--copied' : ''}`} onClick={() => copy('admin', newAdminUrl, 'new-admin-url')}>
                {copied === 'admin' ? '✓ Kopieret' : 'Kopiér admin-link'}
              </button>
            </div>
          </div>
        </div>
      )}

      <section aria-labelledby="sh-h">
        <h1 id="sh-h" style={{ fontSize: 'var(--fs-lg)' }}>Del med deltagerne</h1>
        <div className="linkbox" style={{ marginTop: 'var(--s-2)' }}>
          <div className="linkbox__row">
            <input className="input" id="url" readOnly value={shareUrl} aria-label="Offentligt link" onFocus={(e) => e.currentTarget.select()} />
            <div className="linkbox__actions">
              <button type="button" className={`btn ${copied === 'url' ? 'btn--copied' : 'btn--primary'}`} onClick={() => copy('url', shareUrl, 'url')}>
                {copied === 'url' ? '✓ Kopieret' : 'Kopiér link'}
              </button>
              <a className="btn btn--ghost" href={`/p/${slug}`} target="_blank" rel="noopener noreferrer">Åbn som deltager ↗</a>
            </div>
          </div>
        </div>
      </section>

      <InviteSection api={api} slug={slug} closed={ev.is_closed} onDenied={() => setState('denied')} onStatus={(m) => { setBanner(m); setLive(m); }} />
      <AdminResults ev={ev} setEv={(e) => { setEv(e); syncVotes(e); }} api={api} appUrl={shareUrl.replace(/\/p\/[^/]+$/, '')}
        onDenied={() => setState('denied')} onStatus={(m) => { setBanner(m); setLive(m); }} onError={(e) => setSummary(e)} />

      <form className="section" id="edit" noValidate aria-labelledby="ed-h" onSubmit={save}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') e.preventDefault(); }}>
        <h2 id="ed-h">Redigér afstemning</h2>
        <div className="field">
          <label className="field__label" htmlFor="title">Titel *</label>
          <input className="input" id="title" value={title} onChange={(e) => onTitle(e.target.value)} autoComplete="off"
            aria-describedby="title-err title-count" aria-invalid={titleErr ? true : undefined} />
          <div className="field__meta">
            <div className="field__error" id="title-err" aria-live="polite">{titleErr}</div>
            <Counter id="title-count" value={title} max={TITLE_MAX} />
          </div>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="desc">Beskrivelse <span className="field__hint">(valgfri)</span></label>
          <textarea className="input" id="desc" value={desc} onChange={(e) => setDesc(e.target.value)} aria-describedby="desc-count" />
          <div className="field__meta"><span /><Counter id="desc-count" value={desc} max={DESC_MAX} /></div>
        </div>
        <h3 style={{ margin: 'var(--s-4) 0 var(--s-2)' }}>Datoforslag{' '}
          {!dateMode && (<><span className="legacy-badge" id="legacy-badge">🕘 Ældre afstemning med klokkeslæt</span>
            <span className="field__hint" style={{ display: 'block', fontWeight: 400, marginTop: 4 }}>Eksisterende forslag beholder deres klokkeslæt. Nye forslag kan kun være datoer.</span></>)}</h3>
        <ul className="opt-list" id="opts">
          {opts.map((o, i) => {
            const label = optionLabel(o);
            const removing = pendingRemove === o.key;
            if (o.id !== undefined && editingId === o.id) {
              return (
                <li key={o.key}>
                  <OptionEditRow opt={{ id: o.id, date: o.date, start_at: o.start_at, end_at: o.end_at, votes: o.votes }}
                    others={opts.filter((x) => x.key !== o.key)}
                    onCancel={() => { setEditingId(null); focusAfter.current = `[data-oe="${o.id}"]`; }}
                    onSave={(v) => saveOption(o.id!, v)} />
                </li>
              );
            }
            return (
              <li key={o.key}>
                <div className={`opt${removing ? ' opt--removing' : ''}`}>
                  <span className="opt__when">{label}</span>
                  <span className="opt__votes">{o.votes ? `${o.votes} svar` : 'Ingen svar'}</span>
                  {o.id !== undefined && (
                    <button type="button" className="btn btn--icon" data-oe={o.id} aria-label={`Redigér ${label}`} onClick={() => { setEditingId(o.id!); setPendingRemove(null); }}>✎</button>
                  )}
                  <button type="button" className="btn btn--icon" data-rm={o.key} aria-label={`Fjern ${label}`} onClick={() => removeOpt(o, i)}>✕</button>
                </div>
                {removing && (
                  <div className="inline-warn" role="alert">
                    <strong>{o.votes} {o.votes === 1 ? 'deltager har' : 'deltagere har'} svaret på denne dato.</strong> Fjerner du den,
                    slettes deres svar på den for altid. Deres øvrige svar bevares.
                    <div className="inline-warn__actions">
                      <button type="button" className="btn btn--danger btn--sm" data-confirm-remove onClick={() => removeOpt(o, i)}>Fjern alligevel</button>
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setPendingRemove(null); focusAfter.current = `[data-rm="${o.key}"]`; }}>Behold</button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <div style={{ marginTop: 'var(--s-3)' }}>
          <button type="button" className="btn btn--secondary" id="addopt" aria-expanded={addOpen} aria-controls="addpop"
            onClick={() => { setAddOpen(!addOpen); setAddSel([]); }}>+ Tilføj datoer</button>
        </div>
        {addOpen && (
          <div className="dp-pop" id="addpop">
            <DatePicker id="addcal" selected={addSel} taken={opts.filter((o) => o.date).map((o) => o.date!)} max={Math.max(0, MAX_DATE_OPTIONS - opts.length)}
              label="Tilføj datoer" onChange={(ds, msg) => { setAddSel(ds); setOptErr(''); if (msg) setLive(msg); }} onError={(m) => setOptErr(m)} />
            <p className="field__hint">Prikkede datoer er allerede foreslået.</p>
            <div className="opt-edit__actions">
              <button type="button" className="btn btn--primary btn--sm" id="addgo" disabled={!addSel.length} onClick={addDates}>
                {addSel.length ? `Tilføj ${addSel.length} ${addSel.length === 1 ? 'dato' : 'datoer'}` : 'Tilføj datoer'}</button>
            </div>
          </div>
        )}
        <div className="field__error" id="opt-err" aria-live="polite">{optErr}</div>
        <div className="form-actions">
          <button type="submit" className="btn btn--primary" id="save" disabled={saving} aria-busy={saving || undefined}>
            {saving ? (<><span className="spinner" aria-hidden="true" /> Gemmer…</>) : 'Gem ændringer'}
          </button>
        </div>
      </form>

      <section className="section" aria-labelledby="dz-h">
        <div className="danger">
          {closed ? (
            <>
              <h2 id="dz-h">Afstemningen er lukket</h2>
              <p>Deltagerne kan se resultatet, men ikke stemme. Du kan åbne den igen når som helst.</p>
              <button type="button" className="btn btn--danger-ghost" id="toggle" onClick={() => openDialog('reopen')}>Genåbn afstemning</button>
            </>
          ) : (
            <>
              <h2 id="dz-h">Farezone</h2>
              <p>Når du lukker afstemningen, kan ingen længere stemme eller ændre svar. Du kan vælge den endelige dato, og du kan genåbne senere.</p>
              <button type="button" className="btn btn--danger" id="toggle" onClick={() => openDialog('close')}>Luk afstemning…</button>
            </>
          )}
          <p>Har du delt admin-linket ved en fejl? Lav et nyt – det gamle holder op med at virke.</p>
          <button type="button" className="btn btn--danger-ghost" id="rotate" onClick={() => openDialog('rotate')}>Lav nyt admin-link…</button>
          <p>Slet hele afstemningen med alle datoforslag og svar. Linkene holder op med at virke. Det kan ikke fortrydes.</p>
          <button type="button" className="btn btn--danger" id="delete-poll" onClick={() => openDialog('delete-poll')}>Slet afstemning…</button>
        </div>
      </section>

      <dialog className="modal" ref={dlgRef} aria-labelledby="dlg-h" aria-describedby="dlg-p"
        onClose={() => { setDialog(null); lastFocus.current?.focus(); }}>
        {dialog && (
          <>
            <h2 id="dlg-h">{dlgText.h}</h2>
            <p id="dlg-p">{dlgText.p}</p>
            {dialog === 'close' && (
              <div>
                <label className="field__label" htmlFor="pick">Endelig dato (valgfri)</label>
                <select className="input" id="pick" value={chosen} onChange={(e) => setChosen(e.target.value)}>
                  <option value="">Vælg ikke nu</option>
                  {ev.time_options.map((o) => (
                    <option key={o.id} value={o.id}>{optionLabel(o)}{best.has(o.id) ? ' – ★ flest ja' : ''}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="modal__actions">
              <button type="button" className="btn btn--ghost" id="dlg-cancel" onClick={closeDialog}>Annullér</button>
              <button type="button" className={`btn ${dlgText.cls}`} id="dlg-ok" onClick={confirmDialog} disabled={busy} aria-busy={busy || undefined}>{dlgText.ok}</button>
            </div>
          </>
        )}
      </dialog>
      <p className="sr-only" aria-live="polite">{live}</p>
    </div>
  );
}

function Counter({ id, value, max }: { id: string; value: string; max: number }) {
  const n = textLength(value.trim());
  const st = counterState(n, max);
  return <span className={`counter${st === 'over' ? ' counter--over' : st === 'warn' ? ' counter--warn' : ''}`} id={id}>{counterText(n, max)}</span>;
}
