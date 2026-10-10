'use client';
import { localTodayIso } from '@/lib/dates';
import { useEffect, useRef, useState } from 'react';
import type { AdminEvent } from '@/lib/events';
import ResultBanner from '@/components/ResultBanner';
import { useI18n } from '@/i18n/use';
import { bestMask, ICON, voteKey, totals, totalText, type Vote } from '@/lib/vote-client';
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
  const { tr } = useI18n();
  return <span className={`vote vote--${v ?? 'none'}`}><span aria-hidden="true">{ICON[String(v)]}</span> {v ? tr(voteKey(v)) : <span className="sr-only">{tr('vote.none')}</span>}</span>;
}

/** Design §26-29: results grid with "Endeligt" choose row + undo toast, participant delete, result banner. */
export default function AdminResults({ ev, setEv, api, appUrl, onDenied, onStatus, onError }: {
  ev: AdminEvent; setEv: (e: AdminEvent) => void; api: Api; appUrl: string;
  onDenied: () => void; onStatus: (msg: string) => void; onError: (errs: string[]) => void;
}) {
  const { t, tr, fd } = useI18n();
  const [choosing, setChoosing] = useState(false);
  const [toast, setToast] = useState<{ msg: string; prev: number | null; target: number | null } | null>(null);
  const [toastHold, setToastHold] = useState(false);
  const [del, setDel] = useState<{ id: number; name: string; answers: number; list: 'grid' | 'list' } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const dlg = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const focusSel = useRef<string | null>(null);
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
    const h = setTimeout(() => setToast(null), UNDO_MS);
    return () => clearTimeout(h);
  }, [toast, toastHold]);

  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(localTodayIso()), []);
  const opts = ev.time_options;
  const label = (o: { date: string }) => fd(o.date);
  const T = totals(ev.participants.map((p) => p.votes), opts.length);
  const best = bestMask(T);
  const past = (i: number) => today !== null && opts[i].date < today; // K2: viewer's local date
  const cls = (i: number) => `${ev.chosen_option_id === opts[i].id ? 'is-chosen' : best[i] ? 'is-best' : ''}${past(i) ? ' is-past' : ''}`.trim();
  const closed = ev.is_closed;

  async function choose(id: number | null, opts2: { undo?: boolean; focus?: string } = {}) {
    if (choosing) return;
    const prev = ev.chosen_option_id;
    setChoosing(true);
    setEv({ ...ev, chosen_option_id: id }); // optimistic
    try {
      const { res, data } = await api('/choose', { method: 'POST', body: JSON.stringify({ chosen_option_id: id }) });
      if (res.status === 401 || res.status === 403) { onDenied(); return; }
      if (!res.ok) { setEv({ ...ev, chosen_option_id: prev }); onError(Array.isArray(data.errors) ? data.errors : [t('app.chooseFailed')]); return; }
      setEv(data);
      const o = id !== null ? data.time_options.find((x: { id: number }) => x.id === id) : null;
      if (opts2.undo) { setToast(null); onStatus(t('admin.undone')); }
      else setToast({ msg: undoMessage(prev, id, o ? label(o) : '', tr), prev, target: id });
      if (opts2.focus) focusSel.current = opts2.focus;
    } catch {
      setEv({ ...ev, chosen_option_id: prev }); onError([t('app.network')]);
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
      if (!res.ok) { dlg.current?.close(); onError(Array.isArray(data.errors) ? data.errors : [t('app.deleteFailed')]); return; }
      const ids = ev.participants.map((p) => p.id);
      const next = focusAfterDelete(ids, del.id);
      trigger.current = null; // don't return focus to a removed button
      dlg.current?.close();
      setEv(data);
      onStatus(t('admin.deleted', { name: del.name }));
      focusSel.current = next !== null ? `[data-del="${next}"][data-list="${del.list}"]` : '#ppl-h';
    } catch { dlg.current?.close(); onError([t('app.network')]); } finally { setDeleting(false); }
  }

  const chooseBtn = (i: number, full = false) => {
    const o = opts[i], on = ev.chosen_option_id === o.id, l = label(o);
    return (
      <button type="button" className="choose-btn" data-choose={o.id} aria-pressed={on} disabled={closed || choosing} aria-busy={choosing || undefined}
        style={full ? { width: '100%' } : undefined}
        aria-label={on ? t('admin.chosenAria', { date: l }) : t('admin.chooseAria', { date: l })}
        onClick={() => choose(on ? null : o.id, { focus: `[data-choose="${o.id}"]` })}>
        {on ? t('admin.chosen') : ev.chosen_option_id !== null ? t('admin.switchHere') : t('admin.choose')}
      </button>
    );
  };
  const delBtn = (p: { id: number; name: string; votes: Vote[] }, list: 'grid' | 'list') => (
    <button type="button" className="del-btn" data-del={p.id} data-list={list} aria-label={t('admin.delAria', { name: p.name })}
      style={list === 'list' ? { marginLeft: 0 } : undefined} onClick={(e) => askDelete(p, list, e.currentTarget)}><Trash /></button>
  );

  return (
    <section className="section" aria-labelledby="res-h">
      <ResultBanner event={ev} isAdmin appUrl={appUrl} busy={choosing}
        onClear={() => choose(null, { focus: ev.chosen_option_id ? `[data-choose="${ev.chosen_option_id}"]` : undefined })} />
      <h2 id="res-h">{t('admin.resultsH')} <span className="meta">{t('admin.pcount', { n: ev.participants.length })}</span></h2>
      {!closed && <p className="tz-note" id="choose-hint">{t('admin.chooseHint')}</p>}
      <div className="vgrid-wrap" tabIndex={0} role="region" aria-labelledby="res-h">
        <table className="vgrid" id="admin-grid">
          <caption className="sr-only">{t('admin.caption')}</caption>
          <thead><tr>
            <th className="vgrid__name" scope="col">{t('vote.participantsCol', { n: ev.participants.length })}</th>
            {opts.map((o, i) => (
              <th scope="col" className={cls(i)} key={o.id}>
                <span className="vgrid__time" suppressHydrationWarning>{label(o)}</span>
                {ev.chosen_option_id === o.id ? <span className="chosen-badge">{t('vote.chosen')}</span> : best[i] ? <span className="best-badge">{t('vote.best')}</span> : null}
                {past(i) && <span className="past-badge">{t('app.past')}</span>}
              </th>
            ))}
          </tr></thead>
          <tbody>
            {ev.participants.length ? ev.participants.map((p) => (
              <tr key={p.id}>
                <th scope="row" className="vgrid__name"><span className="name-cell">{p.name}{delBtn(p, 'grid')}</span></th>
                {p.votes.map((v, i) => <td className={cls(i)} key={i}><Badge v={v} /></td>)}
              </tr>
            )) : <tr><td colSpan={opts.length + 1} className="meta" style={{ textAlign: 'left' }}>{t('admin.nobody')}</td></tr>}
          </tbody>
          <tfoot>
            <tr><th scope="row" className="vgrid__name">{t('vote.total')}</th>{T.map((x, i) => <td className={cls(i)} key={i}>{totalText(x, tr)}</td>)}</tr>
            <tr className="choose-row"><th scope="row" className="vgrid__name">{t('admin.finalRow')}</th>{opts.map((o, i) => <td className={cls(i)} key={o.id}>{chooseBtn(i)}</td>)}</tr>
          </tfoot>
        </table>
      </div>
      <ul className="vcards" id="admin-cards">
        {opts.map((o, i) => (
          <li key={o.id} className={`vcard${ev.chosen_option_id === o.id ? ' is-best is-chosen' : best[i] ? ' is-best' : ''}${past(i) ? ' is-past' : ''}`}>
            <div className="vcard__head"><span className="vcard__when" suppressHydrationWarning>{label(o)}</span>
              {ev.chosen_option_id === o.id ? <span className="chosen-badge">{t('vote.chosen')}</span> : best[i] ? <span className="best-badge">{t('vote.best')}</span> : null}
              {past(i) && <span className="past-badge">{t('app.past')}</span>}</div>
            <div className="vcard__totals">{t('vote.totalFull', { yes: T[i].yes, maybe: T[i].maybe, no: T[i].no })}</div>
            {chooseBtn(i, true)}
            {ev.participants.length > 0 && (
              <details><summary>{t('app.seeAnswers', { n: ev.participants.length })}</summary>
                <ul className="vcard__people">{ev.participants.map((p) => <li key={p.id}><span>{p.name}</span><Badge v={p.votes[i]} /></li>)}</ul></details>
            )}
          </li>
        ))}
      </ul>
      <h3 id="ppl-h" tabIndex={-1} style={{ margin: 'var(--s-5) 0 var(--s-2)' }}>{t('admin.participantsH')}</h3>
      <ul className="people" id="people">
        {ev.participants.length ? ev.participants.map((p) => (
          <li key={p.id}><span>{p.name}</span><span className="meta">{t('admin.nAnswers', { n: p.votes.filter(Boolean).length })}</span>{delBtn(p, 'list')}</li>
        )) : <li className="meta">{t('admin.noPeople')}</li>}
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
            }}>{t('common.undo')}</button>
          </div>
        )}
      </div>

      <dialog className="modal" ref={dlg} aria-labelledby="del-h" aria-describedby="del-p"
        onClose={() => { trigger.current?.focus(); setDel(null); }}>
        {del && (
          <>
            <h2 id="del-h">{t('admin.delH', { name: del.name })}</h2>
            <p id="del-p">{t('admin.delP', { name: del.name, n: del.answers })}</p>
            <div className="modal__actions">
              <button type="button" className="btn btn--ghost" id="del-cancel" onClick={() => dlg.current?.close()}>{t('common.cancel')}</button>
              <button type="button" className="btn btn--danger" id="del-ok" onClick={confirmDelete} disabled={deleting} aria-busy={deleting || undefined}>{t('admin.delBtn', { name: del.name })}</button>
            </div>
          </>
        )}
      </dialog>
    </section>
  );
}
