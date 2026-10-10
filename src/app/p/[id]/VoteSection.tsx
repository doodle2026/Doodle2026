'use client';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { ApiEvent } from '@/lib/events';
import { optionLabel } from '@/lib/format';
import { columnHead, formatDateShort } from '@/lib/dates';
import { copyText } from '@/lib/share';
import { counterState, counterText, isBlank, textLength } from '@/lib/form';
import {
  bestMask, editTokenFromHash, HINT_CARDS, HINT_GRID, nextDayMarker, savedMessage, KEY_VOTE, LABEL, nameError, nextVote, readStored, totals, totalText, writeStored, type Vote,
  inviteTokenFromHash,
} from '@/lib/vote-client';

const dayFmt = new Intl.DateTimeFormat('da-DK', { weekday: 'short', day: 'numeric', month: 'short' });
const tFmt = new Intl.DateTimeFormat('da-DK', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const offFmt = new Intl.DateTimeFormat('da-DK', { timeZoneName: 'shortOffset' });
const offsetOf = (d: Date) => (offFmt.formatToParts(d).find((p) => p.type === 'timeZoneName')?.value ?? '').replace('GMT', '') || '+00';
const keyFmt = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const newIdemKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);

function Badge({ v }: { v: Vote }) {
  return (
    <span className={`vote vote--${v ?? 'none'}`}>
      <span aria-hidden="true">{LABEL[String(v)][0]}</span> {v ? LABEL[v][1] : <span className="sr-only">Ikke svaret</span>}
    </span>
  );
}

export default function VoteSection({ initial }: { initial: ApiEvent }) {
  const [ev, setEv] = useState(initial);
  const [mounted, setMounted] = useState(false);
  const [wide, setWide] = useState(true); // V3: matches the CSS breakpoint (table ≥ 640 px, cards below)
  const [name, setName] = useState('');
  const [me, setMe] = useState<Vote[]>(() => initial.time_options.map(() => null));
  const [token, setToken] = useState<string | null>(null);
  const [myId, setMyId] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState<{ name: string; editUrl: string | null; fresh: boolean } | null>(null);
  const [nameErr, setNameErr] = useState('');
  const [invite, setInvite] = useState<{ token: string; email: string } | null>(null);
  const [inviteInactive, setInviteInactive] = useState(false);
  const [namePrefilled, setNamePrefilled] = useState(false);
  const [summary, setSummary] = useState<{ head: string; items: string[] } | null>(null);
  const [tokenErr, setTokenErr] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState<'' | 'ok' | 'err'>('');
  const [live, setLive] = useState('');
  // Idempotency key is bound to the exact payload: a retry of the SAME answers reuses it, any change gets a new key (V2).
  const idem = useRef<{ key: string; body: string } | null>(null);
  const focusSel = useRef<string | null>(null);

  const closed = ev.is_closed;
  const opts = ev.time_options;
  const others = ev.participants.filter((p) => !(editing && p.id === myId));
  const showInput = !closed && (editing || !saved);
  // V6: totals/best count SAVED answers only (incl. your own saved row while you edit), never unsaved clicks.
  const rows = ev.participants.map((p) => p.votes);
  const T = totals(rows, opts.length);
  const best = bestMask(T);
  const chosen = (i: number) => ev.chosen_option_id === opts[i].id;
  const cls = (i: number) => (chosen(i) ? 'is-chosen' : best[i] ? 'is-best' : '');
  const day = (iso: string) => (mounted ? cap(dayFmt.format(new Date(iso))) : '');
  // DST ambiguity (design Z4): two options with the same local day+time get their UTC offset shown.
  const localKey = (iso: string) => dayFmt.format(new Date(iso)) + tFmt.format(new Date(iso));
  const dupLocal = (iso: string) => opts.filter((x) => x.start_at && localKey(x.start_at) === localKey(iso)).length > 1;
  const dateMode = ev.mode !== 'datetime';
  // Date polls: one label per column, identical in every time zone (no mount wait). Legacy: day + time in the viewer's zone.
  const colDay = (o: typeof opts[number]) => (o.date ? cap(formatDateShort(o.date)) : day(o.start_at!));
  const time = (o: { date?: string | null; start_at: string | null; end_at: string | null }) =>
    o.date || !o.start_at ? '' : mounted ? `${tFmt.format(new Date(o.start_at))}${dupLocal(o.start_at) ? ` (${offsetOf(new Date(o.start_at))})` : ''}${o.end_at ? '–' + tFmt.format(new Date(o.end_at)) + nextDayMarker(keyFmt.format(new Date(o.start_at)), keyFmt.format(new Date(o.end_at))) : ''}` : '';
  const optLabel = (i: number) => (opts[i].date || mounted ? optionLabel(opts[i]) : '');

  // Personal edit link: #edit=<token> → verify via API (Bearer), keep in localStorage, strip the fragment.
  useEffect(() => {
    setMounted(true);
    const mq = window.matchMedia('(min-width: 640px)');
    setWide(mq.matches);
    mq.addEventListener('change', (e) => setWide(e.matches));
    // Step 5: personal invite link → who is it for, prefill the name (editable). Kept for this tab only.
    const invKey = `inv:${initial.slug}`;
    const invHash = inviteTokenFromHash(location.hash);
    if (invHash !== null) history.replaceState(null, '', location.pathname + location.search);
    const invTok = invHash === 'invalid' ? null : invHash ?? sessionStorage.getItem(invKey);
    if (invHash === 'invalid') setInviteInactive(true);
    if (invTok) {
      (async () => {
        try {
          const r = await fetch(`/api/events/${initial.slug}/invite`, { headers: { Authorization: `Bearer ${invTok}` }, cache: 'no-store' });
          if (!r.ok) { sessionStorage.removeItem(invKey); if (r.status === 404) setInviteInactive(true); return; }
          const d = await r.json();
          sessionStorage.setItem(invKey, invTok);
          setInvite({ token: invTok, email: d.email });
          setName((n) => { if (n) return n; setNamePrefilled(true); return d.name_hint ?? ''; });
        } catch { /* offline */ }
      })();
    }
    const fromHash = editTokenFromHash(location.hash);
    if (fromHash !== null) history.replaceState(null, '', location.pathname + location.search);
    const stored = readStored(initial.slug, localStorage);
    const t = fromHash === 'invalid' ? null : fromHash ?? stored?.token ?? null;
    if (fromHash === 'invalid') { setTokenErr(true); return; }
    if (!t) return;
    (async () => {
      try {
        const r = await fetch(`/api/events/${initial.slug}/votes/me`, { headers: { Authorization: `Bearer ${t}` }, cache: 'no-store' });
        if (!r.ok) {
          if (r.status === 401 || r.status === 403) { if (fromHash) setTokenErr(true); writeStored(initial.slug, null, localStorage); }
          return;
        }
        const d = await r.json();
        writeStored(initial.slug, { token: t, pid: d.participant_id }, localStorage);
        setToken(t); setMyId(d.participant_id);
        if (fromHash && !d.is_closed) startEditing(d.participant_id, initial, d.name);
        else setSaved({ name: d.name, editUrl: null, fresh: false });
      } catch { /* offline: just view */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.slug]);

  useEffect(() => {
    if (!focusSel.current) return;
    document.querySelector<HTMLElement>(focusSel.current)?.focus();
    focusSel.current = null;
  });

  function startEditing(pid: number, e: ApiEvent = ev, nm?: string) {
    const mine = e.participants.find((p) => p.id === pid);
    setMe(e.time_options.map((_, i) => mine?.votes[i] ?? null));
    setName(nm ?? mine?.name ?? '');
    setEditing(true); setSaved(null); setSummary(null); setNameErr('');
    focusSel.current = '#name';
  }
  function cancelEditing() {
    setEditing(false); setMe(opts.map(() => null)); setName(''); setSummary(null); setNameErr('');
    setSaved(myId !== null ? { name: ev.participants.find((p) => p.id === myId)?.name ?? '', editUrl: null, fresh: false } : null);
  }

  /** `v` may be a function of the CURRENT value, so rapid clicks never cycle from a stale render (V2). */
  function set(i: number, v: Vote | ((cur: Vote) => Vote), sel: string) {
    setMe((m) => {
      const nv = typeof v === 'function' ? v(m[i]) : v;
      setLive(`${optLabel(i)}: ${LABEL[String(nv)][1]}`);
      return m.map((x, j) => (j === i ? nv : x));
    });
    focusSel.current = sel;
  }
  function triKey(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const k = e.key.toLowerCase();
    if (KEY_VOTE[k] !== undefined) { e.preventDefault(); set(i, KEY_VOTE[k], `.tri[data-i="${i}"]`); }
    else if (k === 'delete' || k === 'backspace') { e.preventDefault(); set(i, null, `.tri[data-i="${i}"]`); }
    else if (k === 'arrowright' || k === 'arrowleft') {
      e.preventDefault();
      document.querySelector<HTMLElement>(`.tri[data-i="${i + (k === 'arrowright' ? 1 : -1)}"]`)?.focus();
    }
  }
  function segKey(e: KeyboardEvent<HTMLButtonElement>, i: number, cur: Exclude<Vote, null>) {
    const vs = ['yes', 'maybe', 'no'] as const, k = e.key.toLowerCase();
    let j = vs.indexOf(cur);
    if (KEY_VOTE[k]) j = vs.indexOf(KEY_VOTE[k] as typeof vs[number]);
    else if (k === 'arrowright' || k === 'arrowdown') j = (j + 1) % 3;
    else if (k === 'arrowleft' || k === 'arrowup') j = (j + 2) % 3;
    else if (k === 'delete') { e.preventDefault(); set(i, null, `.seg button[data-i="${i}"][data-v="yes"]`); return; }
    else return;
    e.preventDefault();
    set(i, vs[j], `.seg button[data-i="${i}"][data-v="${vs[j]}"]`);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    const nErr = nameError(name, ev.participants, editing ? myId : null, { isBlank, textLength });
    const items = [...(nErr ? [nErr] : []), ...(me.some(Boolean) ? [] : [`Svar på mindst ${dateMode ? 'én dato' : 'ét tidspunkt'} (ja, måske eller nej).`])];
    setNameErr(nErr);
    if (items.length) { setSummary({ head: 'Ret venligst følgende:', items }); focusSel.current = nErr ? '#name' : '#summary'; return; }
    setSaving(true); setSummary(null);
    const body = JSON.stringify({ name, votes: opts.map((o, i) => ({ option_id: o.id, value: me[i] })) });
    try {
      const tz = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone);
      let r: Response;
      if (editing && token) {
        r = await fetch(`/api/events/${ev.slug}/votes/me${dateMode ? '' : `?tz=${tz}`}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body });
      } else {
        if (idem.current?.body !== body) idem.current = { key: newIdemKey(), body };
        r = await fetch(`/api/events/${ev.slug}/votes${dateMode ? '' : `?tz=${tz}`}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idem.current.key, ...(invite ? { 'X-Invite-Token': invite.token } : {}) }, body });
      }
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const errs: string[] = Array.isArray(d.errors) ? d.errors : ['Ukendt fejl.'];
        if (d.code === 'name_taken') setNameErr(errs[0]);
        if (d.code === 'idempotency_mismatch') idem.current = null;
        if (r.status === 423) setEv((x) => ({ ...x, is_closed: true }));
        if (r.status === 403) { setTokenErr(true); setEditing(false); writeStored(ev.slug, null, localStorage); setToken(null); setMyId(null); }
        if (r.status >= 500) { serverError(); return; }
        setSummary({ head: 'Dine svar blev ikke gemt.', items: errs });
        focusSel.current = d.code === 'name_taken' ? '#name' : '#summary';
        return;
      }
      idem.current = null;
      setEv(d.event);
      const pid = d.participant_id as number;
      let editUrl: string | null = null;
      if (d.edit_token) {
        writeStored(ev.slug, { token: d.edit_token, pid }, localStorage);
        setToken(d.edit_token);
        editUrl = location.origin + d.edit_url;
      }
      setMyId(pid);
      const shown = d.event.participants.find((p: { id: number }) => p.id === pid)?.name ?? name;
      setSaved({ name: shown, editUrl, fresh: true });
      setEditing(false); setName(''); setMe(opts.map(() => null)); setNameErr('');
      setLive(editUrl ? 'Dine svar er gemt. Dit redigeringslink vises nu.' : 'Dine ændringer er gemt.');
    } catch {
      serverError();
    } finally { setSaving(false); }
  }
  function serverError() {
    setSummary({ head: 'Dine svar blev ikke gemt.', items: ['Der opstod en fejl på serveren eller forbindelsen blev afbrudt. Dine valg er bevaret – prøv igen.'] });
    focusSel.current = '#summary';
  }

  async function copyEdit(url: string) {
    const input = document.getElementById('editurl') as HTMLInputElement | null;
    const r = await copyText(url, { clipboard: navigator.clipboard, legacyCopy: () => { input?.select(); return document.execCommand?.('copy') ?? false; } });
    setCopied(r === 'copied' ? 'ok' : 'err');
    if (r === 'copied') { setLive('Redigeringslinket er kopieret'); setTimeout(() => setCopied(''), 2000); } else input?.select();
  }

  const nameLen = textLength(name.trim());
  const nameSt = counterState(nameLen, 100);
  const meName = name.trim() || 'Dig';
  const canEditOwn = !closed && myId !== null && token !== null && !editing;

  return (
    <form className={`vote-view${others.length >= 20 ? ' vgrid--many' : ''}`} id="vote" noValidate onSubmit={submit} aria-labelledby="grid-h"
      onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') e.preventDefault(); }}>
      {tokenErr && <div className="alert" role="alert">Redigeringslinket er ugyldigt. Du kan stadig se afstemningen, men ikke ændre svarene.</div>}
      {saved && !editing && (
        <div id="banner">
          <div className={closed ? 'meta' : 'success'} role="status" id="saved-msg">{savedMessage(saved.name, saved.fresh, closed)}</div>
          {saved.editUrl && (
            <div className="linkbox linkbox--secret" role="group" aria-labelledby="el-l" aria-describedby="el-d" style={{ margin: '0 0 var(--s-4)' }}>
              <p className="linkbox__label" id="el-l"><span className="icon-lock" aria-hidden="true">!</span> Dit personlige redigeringslink</p>
              <p className="linkbox__desc" id="el-d">Gem linket, hvis du vil ændre dine svar senere. <strong>Del det ikke</strong> – alle med linket kan ændre dine svar. Vi har ingen konti, så vi kan ikke sende det igen.</p>
              <div className="linkbox__row">
                <input className="input" id="editurl" readOnly value={saved.editUrl} aria-label="Personligt redigeringslink" onFocus={(e) => e.currentTarget.select()} />
                <div className="linkbox__actions">
                  <button type="button" className={`btn ${copied === 'ok' ? 'btn--copied' : copied === 'err' ? 'btn--copy-error' : 'btn--secondary'}`} onClick={() => copyEdit(saved.editUrl!)}>
                    {copied === 'ok' ? '✓ Kopieret' : copied === 'err' ? 'Markér og kopiér manuelt' : 'Kopiér link'}
                  </button>
                  <a className="btn btn--secondary" href={`mailto:?subject=${encodeURIComponent(`Mit redigeringslink: ${ev.title}`)}&body=${encodeURIComponent(saved.editUrl)}`}>✉ Send til mig selv</a>
                </div>
              </div>
            </div>
          )}
          {canEditOwn && <p style={{ margin: '0 0 var(--s-4)' }}><button type="button" className="btn btn--ghost" onClick={() => startEditing(myId!)}>✎ Redigér mine svar</button></p>}
        </div>
      )}
      <div className="alert" id="summary" role="alert" tabIndex={-1}>
        {summary && (<><strong>{summary.head}</strong><ul>{summary.items.map((x) => <li key={x}>{x}</li>)}</ul></>)}
      </div>

      {invite && (
        <div className="personal-banner" role="note" id="personal-banner"><span aria-hidden="true">✉</span>
          <span style={{ flex: 1, minWidth: 220 }}>Du er inviteret som <strong>{invite.email}</strong>. Dit svar registreres automatisk hos arrangøren.</span>
          <a className="link-btn" href={`/p/${ev.slug}`} onClick={(e) => {
            e.preventDefault(); sessionStorage.removeItem(`inv:${ev.slug}`); setInvite(null);
            if (namePrefilled) { setName(''); setNamePrefilled(false); }
          }}>Ikke dig? Brug det offentlige link</a></div>
      )}
      {inviteInactive && !invite && <div className="personal-banner" role="status" id="invite-inactive"><span aria-hidden="true">ℹ</span>Dette link er ikke længere aktivt. Du kan stadig svare som alle andre.</div>}
      {showInput && (
        <div className="field vote-name" id="name-field">
          <label className="field__label" htmlFor="name">Dit navn *{invite && namePrefilled && <> <span className="field__hint">(udfyldt fra invitationen – du kan rette det)</span></>}</label>
          <input className="input" id="name" autoComplete="name" placeholder="F.eks. Mette" aria-required="true" value={name}
            aria-describedby="name-err name-count" aria-invalid={nameErr ? true : undefined}
            onChange={(e) => {
              setName(e.target.value);
              // V4: any change clears the name error (and its summary line); it is re-checked on save.
              if (nameErr) { setNameErr(''); setSummary((s) => (s ? { ...s, items: s.items.filter((x) => x !== nameErr) } : s)); }
            }} />
          <div className="field__meta">
            <div className="field__error" id="name-err" aria-live="polite">{nameErr}</div>
            <span className={`counter${nameSt === 'over' ? ' counter--over' : nameSt === 'warn' ? ' counter--warn' : ''}`} id="name-count">{counterText(nameLen, 100)}</span>
          </div>
        </div>
      )}

      <h2 id="grid-h">{closed ? 'Svar' : dateMode ? 'Hvilke datoer passer dig?' : 'Hvornår kan du?'}</h2>
      <div className="legend">
        <span className="vote vote--yes"><span aria-hidden="true">✓</span> Ja</span>
        <span className="vote vote--maybe"><span aria-hidden="true">( )</span> Måske</span>
        <span className="vote vote--no"><span aria-hidden="true">✕</span> Nej</span>
        <span className="vote vote--none">– Ikke svaret</span>
      </div>
      {editing && (
        <p className="editing-note" id="editing">✎ Du redigerer dine svar som {ev.participants.find((p) => p.id === myId)?.name}.{' '}
          <button type="button" onClick={cancelEditing} style={{ background: 'none', border: 0, padding: 0, color: 'var(--c-primary)', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}>Annullér redigering</button></p>
      )}
      {showInput && <p className="tz-note" id="hint">{wide ? HINT_GRID : dateMode ? HINT_CARDS : HINT_CARDS.replace('hver dato', 'hvert tidspunkt')}</p>}
      {ev.participants.length === 0 && <div className="vote-empty">Ingen har stemt endnu – vær den første! 🎉</div>}

      <div className="vgrid-wrap" tabIndex={0} role="region" aria-labelledby="grid-h">
        <table className="vgrid" id="grid">
          <caption className="sr-only">Afstemning. Kolonner er {dateMode ? 'datoforslag' : 'tidsforslag'}, rækker er deltagere. Sidste række er totaler.</caption>
          <thead>
            <tr>
              <th className="vgrid__name" scope="col">Deltager ({others.length})</th>
              {opts.map((o, i) => (
                <th scope="col" className={cls(i)} key={o.id}>
                  {o.date ? (<>
                    <span className="vgrid__day">{columnHead(o.date)[0]}</span>
                    <span className="vgrid__time">{columnHead(o.date)[1]}</span>
                  </>) : (<>
                    <span className="vgrid__day" suppressHydrationWarning>{colDay(o)}</span>
                    <span className="vgrid__time" suppressHydrationWarning>{time(o)}</span>
                  </>)}
                  {chosen(i) ? <span className="chosen-badge">✓ Valgt</span> : best[i] ? <span className="best-badge">★ Bedst</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {others.map((p) => (
              <tr key={p.id}>
                <th scope="row" className="vgrid__name">
                  {p.name}
                  {canEditOwn && p.id === myId && (
                    <button type="button" className="vgrid__edit vgrid__edit--on" aria-label="Redigér dine svar" onClick={() => startEditing(p.id)}>✎ Redigér</button>
                  )}
                </th>
                {p.votes.map((v, i) => <td className={cls(i)} key={i}><Badge v={v} /></td>)}
              </tr>
            ))}
            {showInput && (
              <tr className="is-me">
                <th scope="row" className="vgrid__name" id="me-name">{meName}</th>
                {me.map((v, i) => (
                  <td className={cls(i)} key={i}>
                    <button type="button" className="tri" data-i={i} data-state={String(v)} aria-label={`${optLabel(i)}: ${LABEL[String(v)][1]}. Tryk for at skifte.`}
                      onClick={() => set(i, nextVote, `.tri[data-i="${i}"]`)} onKeyDown={(e) => triKey(e, i)}>
                      <span aria-hidden="true">{LABEL[String(v)][0]}</span>{v ? LABEL[v][1] : 'Vælg'}
                    </button>
                  </td>
                ))}
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr><th scope="row" className="vgrid__name">I alt</th>{T.map((t, i) => <td className={cls(i)} key={i}>{totalText(t)}</td>)}</tr>
          </tfoot>
        </table>
      </div>

      <ul className="vcards" id="cards" aria-labelledby="grid-h">
        {opts.map((o, i) => (
          <li key={o.id} className={`vcard${chosen(i) ? ' is-best is-chosen' : best[i] ? ' is-best' : ''}`}>
            <div className="vcard__head">
              <span className="vcard__when" id={`c${i}`} suppressHydrationWarning>{optLabel(i)}</span>
              {chosen(i) ? <span className="chosen-badge">✓ Valgt</span> : best[i] ? <span className="best-badge">★ Bedst</span> : null}
            </div>
            <div className="vcard__totals">{totalText(T[i])}{T[i].no ? `, ${T[i].no} nej` : ''}{showInput && !me[i] ? <> · <em>Du har ikke svaret</em></> : null}</div>
            {showInput && (
              <div className="seg" role="radiogroup" aria-labelledby={`c${i}`}>
                {(['yes', 'maybe', 'no'] as const).map((v) => (
                  <button type="button" role="radio" key={v} data-i={i} data-v={v} aria-checked={me[i] === v}
                    tabIndex={me[i] === v || (!me[i] && v === 'yes') ? 0 : -1}
                    onClick={() => set(i, (cur) => (cur === v ? null : v), `.seg button[data-i="${i}"][data-v="${v}"]`)} onKeyDown={(e) => segKey(e, i, v)}>
                    <span aria-hidden="true">{LABEL[v][0]}</span> {LABEL[v][1]}
                  </button>
                ))}
              </div>
            )}
            {others.length > 0 && (
              <details open={closed}>
                <summary>Se {closed ? 'alle' : 'de andres'} svar ({others.length})</summary>
                <ul className="vcard__people">{others.map((p) => <li key={p.id}><span>{p.name}</span><Badge v={p.votes[i]} /></li>)}</ul>
              </details>
            )}
          </li>
        ))}
      </ul>

      {showInput && (
        <div className="vote-bar">
          <button type="submit" className="btn btn--primary btn--block" id="save" style={{ maxWidth: 320 }} disabled={saving} aria-busy={saving}>
            {saving ? (<><span className="spinner" aria-hidden="true" /> Gemmer…</>) : editing ? 'Gem ændringer' : 'Gem mine svar'}
          </button>
        </div>
      )}
      <p className="sr-only" aria-live="polite">{live}</p>
    </form>
  );
}
