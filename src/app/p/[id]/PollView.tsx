'use client';
import { useEffect, useRef, useState } from 'react';
import Header from '@/components/Header';
import VoteSection from './VoteSection';
import ResultBanner from '@/components/ResultBanner';
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
  const [acked, setAcked] = useState(false); // V7: "✓ Jeg har gemt det"
  const adminRef = useRef<HTMLInputElement>(null);
  const ackShowRef = useRef<HTMLButtonElement>(null);
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
  /** V7 (design §32): "↗ Del" only opens; "Skjul ▴" always closes, never asks. The admin link stays in memory for this page. */
  function setPanel(n: boolean) {
    setOpen(n);
    try { sessionStorage.setItem(storeKey, n ? 'open' : 'closed'); } catch { /* ignore */ }
  }
  function openPanel(focusAdmin = false) {
    setPanel(true);
    setTimeout(() => (focusAdmin ? adminRef.current : document.getElementById('share-h'))?.focus(), 0);
  }
  function hidePanel() { setPanel(false); setTimeout(() => shareOpenRef.current?.focus(), 0); }
  const mailMe = adminUrl ? adminMailto(event.title, adminUrl, shareUrl) : '';
  const mailto = participantMailto(event.title, shareUrl);

  return (
    <>
      <Header>
        <button type="button" className="icon-btn" id="share-open" ref={shareOpenRef} aria-controls="share"
          aria-expanded={open} aria-label="Del afstemningen" onClick={() => openPanel()}>↗ Del</button>
      </Header>
      <main className="container">
        <article className="card poll-view">
          {adminUrl && !acked && !open && (
            <div className="share-reminder" role="status" id="share-reminder">
              <span className="icon-lock" aria-hidden="true">!</span>
              <span style={{ flex: 1, minWidth: 200 }}><strong>Har du gemt dit admin-link?</strong> Det er eneste vej til at redigere eller lukke afstemningen.</span>
              <button type="button" className="link-btn" id="rem-show" onClick={() => openPanel(true)}>Vis admin-link</button>
            </div>
          )}
          <section className="share" id="share" aria-labelledby="share-h" hidden={!open}>
            {justCreated
              ? <p className="share__confirm" id="share-h" tabIndex={-1}><span aria-hidden="true">✓</span> Din afstemning er oprettet</p>
              : <p className="share__confirm" id="share-h" tabIndex={-1}>Del afstemningen</p>}
            <button type="button" className="btn btn--ghost btn--sm share__close" id="share-close" aria-controls="share" onClick={hidePanel}>Skjul <span aria-hidden="true">▴</span></button>
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
            {adminUrl && !acked && (
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
                <div className="linkbox__ack">
                  <button type="button" className="btn btn--secondary" id="ack" onClick={() => {
                    setAcked(true); setStatus('Admin-link markeret som gemt. Boksen er foldet sammen.');
                    setTimeout(() => ackShowRef.current?.focus(), 0);
                  }}><span aria-hidden="true">✓</span> Jeg har gemt det</button>
                  <span className="field__hint">Så folder vi boksen sammen. Du kan altid vise linket igen her.</span>
                </div>
              </div>
            )}
            {adminUrl && acked && (
              <div className="linkbox linkbox--done" id="admin-done">
                <span aria-hidden="true">✓</span> <strong>Admin-link gemt.</strong> <span className="meta">Vises kun på denne side, indtil du lukker den.</span>{' '}
                <button type="button" className="link-btn" id="admin-show" aria-controls="admin" ref={ackShowRef}
                  onClick={() => { setAcked(false); setTimeout(() => adminRef.current?.focus(), 0); }}>Vis admin-link igen</button>
              </div>
            )}
            <span className="sr-only" role="status" aria-live="polite">{status}</span>
          </section>
          <ResultBanner event={event} appUrl={shareUrl.replace(/\/p\/[^/]+$/, '')} />
          <h1>{event.title}</h1>
          {event.description && <p className="lead">{event.description}</p>}
          {event.mode === 'datetime'
            ? <p className="tz-note"><span className="legacy-badge" id="legacy-badge">🕘 Ældre afstemning med klokkeslæt</span> {tz ? `Tider vist i ${tz}.` : ''}</p>
            : <p className="tz-note">Vælg de datoer, der passer dig.</p>}
          <VoteSection initial={event} />
        </article>
      </main>
    </>
  );
}
