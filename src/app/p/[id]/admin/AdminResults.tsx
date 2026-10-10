'use client';
import { useEffect, useRef, useState } from 'react';
import type { AdminEvent } from '@/lib/events';
import ResultBanner from '@/components/ResultBanner';
import { whenLabel } from '@/lib/format';
import { bestMask, LABEL, totals, totalText, type Vote } from '@/lib/vote-client';
import { focusAfterDelete, undoMessage } from '@/lib/admin-ui';

type Api = (path: string, init?: RequestInit) => Promise<{ res: Response; data: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any
const UNDO_MS = 8000;

function Trash() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 4h10M6 4V2.5h4V4M4.5 4l.7 9.5h5.6l.7-9.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function Badge({ v }: { v: Vote }) {
  return <span className={`vote vote--${v ?? 'none'}`}><span aria-hidden="true">{LABEL[String(v)][0]}</span> {v ? LABEL[v][1] : <span className="sr-only">Ikke svaret</span>}</span>;
}

/** Design §26-29: results grid with "Endeligt" choose row + undo toast, participant delete, result banner. */
export default function AdminResults({ ev, setEv, api, appUrl, onDenied, onStatus, onError }: {
  ev: AdminEvent; setEv: (e: AdminEvent) => void; api: Api; appUrl: string;
  onDenied: () => void; onStatus: (msg: string) => void; onError: (errs: string[]) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [toast, setToast] = useState<{ msg: string; prev: number | null; target: number | null } | null>(null);
  const [toastHold, setToastHold] = useState(false);
  const [del, setDel] = useState<{ id: number; name: string; answers: number; list: 'grid' | 'list' } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const dlg = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const focusSel = useRef<string | null>(null);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!focusSel.current) return;
    // Grid and cards both exist (one hidden by CSS) → focus the visible match.
    const els = [...document.querySelectorAll<HTMLElement>(focusSel.current)];
    (els.find((e) => e.offsetParent !== null) ?? els[0])?.focus();
    focusSel.current = null;
  });
  // Toast: 8 s, but never disappears while hovered/focused (§27).
  useEffect(() => {
    if (!toast || toastHold) return;
    const t = setTimeout(() => setToast(null), UNDO_MS);
    return () => clearTimeout(t);
  }, [toast, toastHold]);

  const opts = ev.time_options;
  const label = (o: { start_at: string; end_at: string | null }) => (mounted ? whenLabel(o.start_at, o.end_at) : '');
  const T = totals(ev.participants.map((p) => p.votes), opts.length);
  const best = bestMask(T);
  const cls = (i: number) => (ev.chosen_option_id === opts[i].id ? 'is-chosen' : best[i] ? 'is-best' : '');
  const closed = ev.is_closed;

  async function choose(id: number | null, opts2: { undo?: boolean; focus?: string } = {}) {
    if (choosing) return;
    const prev = ev.chosen_option_id;
    setChoosing(true);
    setEv({ ...ev, chosen_option_id: id }); // optimistic
    try {
      const { res, data } = await api('/choose', { method: 'POST', body: JSON.stringify({ chosen_option_id: id }) });
      if (res.status === 401 || res.status === 403) { onDenied(); return; }
      if (!res.ok) { setEv({ ...ev, chosen_option_id: prev }); onError(Array.isArray(data.errors) ? data.errors : ['Valget kunne ikke gemmes.']); return; }
      setEv(data);
      const o = id !== null ? data.time_options.find((x: { id: number }) => x.id === id) : null;
      if (opts2.undo) { setToast(null); onStatus('Fortrudt.'); }
      else setToast({ msg: undoMessage(prev, id, o ? label(o) : ''), prev, target: id });
      if (opts2.focus) focusSel.current = opts2.focus;
    } catch {
      setEv({ ...ev, chosen_option_id: prev }); onError(['Kunne ikke kontakte serveren. Prøv igen.']);
    } finally { setChoosing(false); }
  }

  function askDelete(p: { id: number; name: string; votes: Vote[] }, list: 'grid' | 'list', el: HTMLElement) {
    trigger.current = el;
    setDel({ id: p.id, name: p.name, answers: p.votes.filter(Boolean).length, list });
    setTimeout(() => { dlg.current?.showModal(); document.getElementById('del-cancel')?.focus(); }, 0);
  }
  async function confirmDelete() {
    if (!del || deleting) return;
    setDeleting(true);
    try {
      const { res, data } = await api(`/participants/${del.id}`, { method: 'DELETE' });
      if (res.status === 401 || res.status === 403) { dlg.current?.close(); onDenied(); return; }
      if (!res.ok) { dlg.current?.close(); onError(Array.isArray(data.errors) ? data.errors : ['Sletning mislykkedes.']); return; }
      const ids = ev.participants.map((p) => p.id);
      const next = focusAfterDelete(ids, del.id);
      trigger.current = null; // don't return focus to a removed button
      dlg.current?.close();
      setEv(data);
      onStatus(`✓ ${del.name} er slettet.`);
      focusSel.current = next !== null ? `[data-del="${next}"][data-list="${del.list}"]` : '#ppl-h';
    } catch { dlg.current?.close(); onError(['Kunne ikke kontakte serveren. Prøv igen.']); } finally { setDeleting(false); }
  }

  const chooseBtn = (i: number, full = false) => {
    const o = opts[i], on = ev.chosen_option_id === o.id, l = label(o);
    return (
      <button type="button" className="choose-btn" data-choose={o.id} aria-pressed={on} disabled={closed || choosing} aria-busy={choosing || undefined}
        style={full ? { width: '100%' } : undefined}
        aria-label={on ? `Valgt som endeligt tidspunkt: ${l}. Tryk for at fjerne valget` : `Vælg ${l} som endeligt tidspunkt`}
        onClick={() => choose(on ? null : o.id, { focus: `[data-choose="${o.id}"]` })}>
        {on ? <><span aria-hidden="true">✓</span> Valgt</> : ev.chosen_option_id !== null ? 'Skift hertil' : 'Vælg'}
      </button>
    );
  };
  const delBtn = (p: { id: number; name: string; votes: Vote[] }, list: 'grid' | 'list') => (
    <button type="button" className="del-btn" data-del={p.id} data-list={list} aria-label={`Slet ${p.name} og deres svar`}
      style={list === 'list' ? { marginLeft: 0 } : undefined} onClick={(e) => askDelete(p, list, e.currentTarget)}><Trash /></button>
  );

  return (
    <section className="section" aria-labelledby="res-h">
      <ResultBanner event={ev} isAdmin appUrl={appUrl} busy={choosing}
        onClear={() => choose(null, { focus: ev.chosen_option_id ? `[data-choose="${ev.chosen_option_id}"]` : undefined })} />
      <h2 id="res-h">Resultat <span className="meta">({ev.participants.length} deltagere)</span></h2>
      {!closed && <p className="tz-note" id="choose-hint">Tryk «Vælg» ved det tidspunkt, I ender med. Deltagerne ser det straks, og du kan skifte eller fortryde når som helst.</p>}
      <div className="vgrid-wrap" tabIndex={0} role="region" aria-labelledby="res-h">
        <table className="vgrid" id="admin-grid">
          <caption className="sr-only">Resultat. Kolonner er tidsforslag, rækker er deltagere. Nederst totaler og valg af endeligt tidspunkt.</caption>
          <thead><tr>
            <th className="vgrid__name" scope="col">Deltager ({ev.participants.length})</th>
            {opts.map((o, i) => (
              <th scope="col" className={cls(i)} key={o.id}>
                <span className="vgrid__time" suppressHydrationWarning>{label(o)}</span>
                {ev.chosen_option_id === o.id ? <span className="chosen-badge">✓ Valgt</span> : best[i] ? <span className="best-badge">★ Bedst</span> : null}
              </th>
            ))}
          </tr></thead>
          <tbody>
            {ev.participants.length ? ev.participants.map((p) => (
              <tr key={p.id}>
                <th scope="row" className="vgrid__name"><span className="name-cell">{p.name}{delBtn(p, 'grid')}</span></th>
                {p.votes.map((v, i) => <td className={cls(i)} key={i}><Badge v={v} /></td>)}
              </tr>
            )) : <tr><td colSpan={opts.length + 1} className="meta" style={{ textAlign: 'left' }}>Ingen har svaret endnu.</td></tr>}
          </tbody>
          <tfoot>
            <tr><th scope="row" className="vgrid__name">I alt</th>{T.map((t, i) => <td className={cls(i)} key={i}>{totalText(t)}</td>)}</tr>
            <tr className="choose-row"><th scope="row" className="vgrid__name">Endeligt</th>{opts.map((o, i) => <td className={cls(i)} key={o.id}>{chooseBtn(i)}</td>)}</tr>
          </tfoot>
        </table>
      </div>
      <ul className="vcards" id="admin-cards">
        {opts.map((o, i) => (
          <li key={o.id} className={`vcard${ev.chosen_option_id === o.id ? ' is-best is-chosen' : best[i] ? ' is-best' : ''}`}>
            <div className="vcard__head"><span className="vcard__when" suppressHydrationWarning>{label(o)}</span>
              {ev.chosen_option_id === o.id ? <span className="chosen-badge">✓ Valgt</span> : best[i] ? <span className="best-badge">★ Bedst</span> : null}</div>
            <div className="vcard__totals">{T[i].yes} ja, {T[i].maybe} måske, {T[i].no} nej</div>
            {chooseBtn(i, true)}
            {ev.participants.length > 0 && (
              <details><summary>Se svar ({ev.participants.length})</summary>
                <ul className="vcard__people">{ev.participants.map((p) => <li key={p.id}><span>{p.name}</span><Badge v={p.votes[i]} /></li>)}</ul></details>
            )}
          </li>
        ))}
      </ul>
      <h3 id="ppl-h" tabIndex={-1} style={{ margin: 'var(--s-5) 0 var(--s-2)' }}>Deltagere</h3>
      <ul className="people" id="people">
        {ev.participants.length ? ev.participants.map((p) => (
          <li key={p.id}><span>{p.name}</span><span className="meta">{p.votes.filter(Boolean).length} svar</span>{delBtn(p, 'list')}</li>
        )) : <li className="meta">Ingen deltagere.</li>}
      </ul>

      <div aria-live="polite">
        {toast && (
          <div className="toast-undo" role="status" onMouseEnter={() => setToastHold(true)} onMouseLeave={() => setToastHold(false)}
            onFocus={() => setToastHold(true)} onBlur={() => setToastHold(false)}>
            <span>{toast.msg}</span>
            <button type="button" id="undo" onClick={() => {
              const back = toast.prev;
              setToastHold(false);
              choose(back, { undo: true, focus: `[data-choose="${back ?? toast.target}"]` });
            }}>Fortryd</button>
          </div>
        )}
      </div>

      <dialog className="modal" ref={dlg} aria-labelledby="del-h" aria-describedby="del-p"
        onClose={() => { trigger.current?.focus(); setDel(null); }}>
        {del && (
          <>
            <h2 id="del-h">Slet {del.name}?</h2>
            <p id="del-p">{del.name} og alle {del.answers} svar slettes for altid. Totalerne og &quot;Bedst&quot; opdateres. Det kan ikke fortrydes.</p>
            <div className="modal__actions">
              <button type="button" className="btn btn--ghost" id="del-cancel" onClick={() => dlg.current?.close()}>Annullér</button>
              <button type="button" className="btn btn--danger" id="del-ok" onClick={confirmDelete} disabled={deleting} aria-busy={deleting || undefined}>Slet {del.name}</button>
            </div>
          </>
        )}
      </dialog>
    </section>
  );
}
