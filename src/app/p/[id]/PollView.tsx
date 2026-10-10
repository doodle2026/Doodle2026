'use client';
import { whenLabel } from '@/lib/format';
import { useEffect, useRef, useState } from 'react';
import Header from '@/components/Header';
import VoteSection from './VoteSection';
import { bestMask, totals } from '@/lib/vote-client';
import type { ApiEvent } from '@/lib/events';
import { adminMailto, canNativeShare, copyText, participantMailto, shareLink, shareText } from '@/lib/share';


type CopyState = 'idle' | 'copied' | 'error';
type Which = 'url' | 'admin';
const MANUAL_COPY = 'Markér og kopiér manuelt (Ctrl+C / ⌘C – eller hold fingeren på linket).';

function CopyButton({ state, label, className, onClick }: { state: CopyState; label: string; className: string; onClick: () => void }) {
  const cls = state === 'copied' ? `${className} btn--copied` : state === 'error' ? 'btn--copy-error' : className;
  return (
    <button type="button" className={`btn ${cls}`} onClick={onClick}>
      {state === 'copied' ? '✓ Kopieret' : state === 'error' ? '! Kunne ikke kopiere' : label}
    </button>
  );
}

export const adminStoreKey = (slug: string) => `mt-admin-${slug}`;

export default function PollView({ event, shareUrl, justCreated }:
  { event: ApiEvent; shareUrl: string; justCreated: boolean }) {
  // Times depend on the browser's timezone → formatted only after mount (no SSR/hydration mismatch).
  const [tz, setTz] = useState<string | null>(null);
  const [open, setOpen] = useState(justCreated); // organizer (?created=1) sees it open; visitors closed
  const [copy, setCopy] = useState<Record<Which, CopyState>>({ url: 'idle', admin: 'idle' });
  const [status, setStatus] = useState('');
  const [savedOk, setSavedOk] = useState(false);
  const adminRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [canShare, setCanShare] = useState(false);
  const [adminUrl, setAdminUrl] = useState<string | null>(null); // shown once, right after creation
  const urlRef = useRef<HTMLInputElement>(null);
  const shareOpenRef = useRef<HTMLButtonElement>(null);
  const storeKey = `mt-share-${event.slug}`;

  useEffect(() => {
    setTz(Intl.DateTimeFormat().resolvedOptions().timeZone);
    setCanShare(typeof navigator !== 'undefined' && canNativeShare(navigator)); // after hydration only (not in SSR HTML)
    if (justCreated) {
      try {
        if (sessionStorage.getItem(storeKey) === 'closed') setOpen(false);
        // The admin link is handed over via sessionStorage (never the URL) and removed after first display.
        const a = sessionStorage.getItem(adminStoreKey(event.slug));
        if (a && a.startsWith(`/p/${event.slug}/admin#`)) { setAdminUrl(location.origin + a); setOpen(true); }
        sessionStorage.removeItem(adminStoreKey(event.slug));
      } catch { /* ignore */ }
      // Drop ?created=1 so a reload/shared copy of the address bar doesn't claim "just created".
      history.replaceState(null, '', `/p/${event.slug}`);
    }
  }, [justCreated, storeKey, event.slug]);


  async function doCopy(which: Which, text: string, input: HTMLInputElement | null) {
    const what = which === 'url' ? 'Linket til deltagerne' : 'Admin-linket';
    const set = (st: CopyState) => setCopy((c) => ({ ...c, [which]: st }));
    const res = await copyText(text, {
      clipboard: navigator.clipboard,
      legacyCopy: () => { if (!input) return false; input.focus(); input.select(); return document.execCommand?.('copy') ?? false; },
    });
    if (res === 'copied') {
      set('copied'); setStatus(`${what} er kopieret`);
      setTimeout(() => set('idle'), 2000);
    } else {
      set('error'); setStatus(`${what} kunne ikke kopieres. Markér og kopiér manuelt.`);
      input?.focus(); input?.select();
      setTimeout(() => set('idle'), 4000);
    }
  }
  async function nativeShare() {
    const res = await shareLink({ title: event.title, text: shareText(event.title), url: shareUrl }, navigator);
    if (res === 'fallback') doCopy('url', shareUrl, urlRef.current);
  }
  const closeBtnFocus = () => setTimeout(() => shareOpenRef.current?.focus(), 0);
  function close() {
    setOpen(false);
    setAdminUrl(null); // the admin link is shown once; it is gone after closing
    try { sessionStorage.setItem(storeKey, 'closed'); } catch { /* ignore */ }
    closeBtnFocus();
  }
  /** Closing with an unconfirmed admin link asks first (native modal <dialog>, design §19/§20.3). */
  function requestClose() {
    if (adminUrl && !savedOk && dialogRef.current?.showModal) dialogRef.current.showModal();
    else close();
  }
  function toggle() {
    if (open) { requestClose(); return; }
    const n = !open; setOpen(n);
    try { sessionStorage.setItem(storeKey, n ? 'open' : 'closed'); } catch { /* ignore */ }
  }
  const mailMe = adminUrl ? adminMailto(event.title, adminUrl, shareUrl) : '';
  const mailto = participantMailto(event.title, shareUrl);

  return (
    <>
      <Header>
        <button type="button" className="icon-btn" id="share-open" ref={shareOpenRef} aria-controls="share"
          aria-expanded={open} aria-label="Del afstemningen" onClick={toggle}>↗ Del</button>
      </Header>
      <main className="container">
        <article className="card poll-view">
          <section className="share" id="share" aria-labelledby="share-h" hidden={!open}>
            {justCreated
              ? <p className="share__confirm" id="share-h"><span aria-hidden="true">✓</span> Din afstemning er oprettet</p>
              : <p className="share__confirm" id="share-h">Del afstemningen</p>}
            <button type="button" className="icon-btn share__close" aria-label="Luk delingsboksen" onClick={requestClose}>✕</button>
            <div className="linkbox" id="pub">
              <p className="linkbox__label"><span aria-hidden="true">🔗</span> Link til deltagerne</p>
              <p className="linkbox__desc">Send dette link til alle, der skal stemme. Ingen login.</p>
              <div className="linkbox__row">
                <input className="input share__url" id="url" ref={urlRef} readOnly value={shareUrl} aria-label="Offentligt link til afstemningen"
                  onFocus={(e) => e.currentTarget.select()} onClick={(e) => e.currentTarget.select()} />
                <div className="share__actions">
                  <CopyButton state={copy.url} label="Kopiér link" className="btn--primary" onClick={() => doCopy('url', shareUrl, urlRef.current)} />
                  {canShare && (
                    <button type="button" className="btn btn--secondary" id="native" onClick={nativeShare}>
                      <span aria-hidden="true">↗</span> Del
                    </button>
                  )}
                  <a className="btn btn--ghost" id="mail" href={mailto}><span aria-hidden="true">✉</span> E-mail</a>
                </div>
              </div>
              {copy.url === 'error' && <p className="share__hint share__hint--error">{MANUAL_COPY}</p>}
            </div>
            {adminUrl && (
              <div className="linkbox linkbox--secret" id="admin" role="group" aria-labelledby="admin-l" aria-describedby="admin-d">
                <p className="linkbox__label" id="admin-l"><span className="icon-lock" aria-hidden="true">!</span> Dit hemmelige admin-link – gem det nu</p>
                <p className="linkbox__desc" id="admin-d"><strong>Del det ikke.</strong> Med dette link kan du redigere og lukke afstemningen.
                  Vi har ingen konti, så hvis du mister linket, kan vi ikke sende det igen.</p>
                <div className="linkbox__row">
                  <input className="input" id="adminurl" ref={adminRef} readOnly value={adminUrl} aria-label="Hemmeligt admin-link"
                    onFocus={(e) => e.currentTarget.select()} onClick={(e) => e.currentTarget.select()} />
                  <div className="linkbox__actions">
                    <CopyButton state={copy.admin} label="Kopiér admin-link" className="btn--secondary" onClick={() => doCopy('admin', adminUrl, adminRef.current)} />
                    <a className="btn btn--secondary" id="mailme" href={mailMe}><span aria-hidden="true">✉</span> Send til mig selv</a>
                  </div>
                </div>
                {copy.admin === 'error' && <p className="share__hint share__hint--error">{MANUAL_COPY}</p>}
                <label className="check">
                  <input type="checkbox" id="saved-ok" checked={savedOk} onChange={(e) => setSavedOk(e.target.checked)} />
                  {' '}Jeg har gemt admin-linket et sikkert sted
                </label>
              </div>
            )}
            <span className="sr-only" role="status" aria-live="polite">{status}</span>
          </section>
          <dialog className="modal" ref={dialogRef} aria-labelledby="dlg-h" aria-describedby="dlg-p">
            <h2 id="dlg-h">Har du gemt dit admin-link?</h2>
            <p id="dlg-p">Det vises ikke igen. Uden linket kan du ikke redigere eller lukke afstemningen.</p>
            <div className="modal__actions">
              {/* Cancel ("go back") gets default focus so Enter doesn't discard the link by accident. */}
              <button type="button" className="btn btn--ghost" autoFocus onClick={() => dialogRef.current?.close()}>Tilbage</button>
              <button type="button" className="btn btn--danger" onClick={() => { dialogRef.current?.close(); close(); }}>Luk alligevel</button>
            </div>
          </dialog>
          <ResultBanner event={event} />
          <h1>{event.title}</h1>
          {event.description && <p className="lead">{event.description}</p>}
          <p className="tz-note">{tz ? `Tider vist i ${tz}.` : ''}</p>
          <VoteSection initial={event} />
        </article>
      </main>
    </>
  );
}

/**
 * Design §21 + results: shown when the poll is closed and/or the organizer picked a final time.
 * Open + chosen ("Tidspunktet er valgt") has no own mockup – it reuses .closed-banner with a calendar icon.
 * Times are formatted after mount only, so they're always in the viewer's time zone.
 */
function ResultBanner({ event }: { event: ApiEvent }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const chosen = event.time_options.find((o) => o.id === event.chosen_option_id);
  if (!event.is_closed && !chosen) return null;
  const T = totals(event.participants.map((p) => p.votes), event.time_options.length);
  const best = bestMask(T);
  const bestOpts = event.time_options.filter((_, i) => best[i]);
  const label = (o: { start_at: string; end_at: string | null }) => (mounted ? whenLabel(o.start_at, o.end_at) : '…');
  return (
    <div className="closed-banner" role="status" id="result-banner">
      <span className="closed-banner__icon" aria-hidden="true">{event.is_closed ? '🔒' : '📅'}</span>
      <div>
        <h2>{event.is_closed ? 'Afstemningen er lukket' : 'Tidspunktet er valgt'}</h2>
        {chosen ? (
          <>
            <p>{event.is_closed ? 'Arrangøren har lukket for svar. Det valgte tidspunkt er:' : 'Arrangøren har valgt tidspunktet. Du kan stadig ændre dine svar.'}</p>
            <span className="chosen">✓ {label(chosen)}</span>
            <p style={{ marginTop: 'var(--s-3)' }}>
              <a className="btn btn--secondary btn--sm" id="ics" href={`/api/events/${event.slug}/ics`} download>📅 Tilføj til kalender (.ics)</a>
            </p>
          </>
        ) : (
          <>
            <p>Arrangøren har lukket for svar.</p>
            {bestOpts.length > 0 && <p>Bedste tidspunkt: <strong>★ {bestOpts.map(label).join(' / ')}</strong></p>}
          </>
        )}
      </div>
    </div>
  );
}
