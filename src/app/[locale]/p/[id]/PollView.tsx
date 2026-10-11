'use client';
import SendToEmails from '@/components/SendToEmails';
import { storeAdminToken, TOKEN_RE } from '@/lib/admin-client';
import { useLp } from '@/i18n/link';
import { useEffect, useRef, useState } from 'react';
import Header from '@/components/Header';
import VoteSection from './VoteSection';
import ResultBanner from '@/components/ResultBanner';
import type { ApiEvent } from '@/lib/events';
import { canNativeShare, copyText, mailtoLink, shareLink } from '@/lib/share';
import { useI18n } from '@/i18n/use';


type CopyState = 'idle' | 'copied' | 'error';
type Which = 'url' | 'admin';

function CopyButton({ state, label, className, onClick }: { state: CopyState; label: string; className: string; onClick: () => void }) {
  const { t } = useI18n();
  const cls = state === 'copied' ? `${className} btn--copied` : state === 'error' ? 'btn--copy-error' : className;
  return (
    <button type="button" className={`btn ${cls}`} onClick={onClick}>
      {state === 'copied' ? `✓ ${t('common.copied')}` : state === 'error' ? `! ${t('share.copyFailed')}` : label}
    </button>
  );
}

export const adminStoreKey = (slug: string) => `mt-admin-${slug}`;

export default function PollView({ event, shareUrl, justCreated }:
  { event: ApiEvent; shareUrl: string; justCreated: boolean }) {
  const lp = useLp();
  const { t, rich } = useI18n();
  const MANUAL_COPY = t('share.copyHint');
  const [open, setOpen] = useState(justCreated); // organizer (?created=1) sees it open; visitors closed
  const [copy, setCopy] = useState<Record<Which, CopyState>>({ url: 'idle', admin: 'idle' });
  const [status, setStatus] = useState('');
  const [acked, setAcked] = useState(false); // V7: "✓ Jeg har gemt det"
  const adminRef = useRef<HTMLInputElement>(null);
  const ackShowRef = useRef<HTMLButtonElement>(null);
  const [canShare, setCanShare] = useState(false);
  const [adminUrl, setAdminUrl] = useState<string | null>(null); // shown once, right after creation
  const [adminTok, setAdminTok] = useState<string | null>(null); // Send til e-mails: organizer's tab only (sessionStorage, like admin)
  const urlRef = useRef<HTMLInputElement>(null);
  const shareOpenRef = useRef<HTMLButtonElement>(null);
  const storeKey = `mt-share-${event.slug}`;

  useEffect(() => {
    setCanShare(typeof navigator !== 'undefined' && canNativeShare(navigator)); // after hydration only (not in SSR HTML)
    if (justCreated) {
      try {
        if (sessionStorage.getItem(storeKey) === 'closed') setOpen(false);
        // The admin link is handed over via sessionStorage (never the URL) and removed after first display.
        const a = sessionStorage.getItem(adminStoreKey(event.slug));
        if (a && a.startsWith(`/p/${event.slug}/admin#`)) { setAdminUrl(location.origin + lp(a)); setOpen(true); storeAdminToken(event.slug, a.split('#')[1], sessionStorage); }
        sessionStorage.removeItem(adminStoreKey(event.slug));
      } catch { /* ignore */ }
      // Drop ?created=1 so a reload/shared copy of the address bar doesn't claim "just created".
      history.replaceState(null, '', lp(`/p/${event.slug}`));
    }
    try { const k = sessionStorage.getItem(`mt-admintok-${event.slug}`); if (k && TOKEN_RE.test(k)) setAdminTok(k); } catch { /* ignore */ }
  }, [justCreated, storeKey, event.slug]);


  async function doCopy(which: Which, text: string, input: HTMLInputElement | null) {
    const set = (st: CopyState) => setCopy((c) => ({ ...c, [which]: st }));
    const res = await copyText(text, {
      clipboard: navigator.clipboard,
      legacyCopy: () => { if (!input) return false; input.focus(); input.select(); return document.execCommand?.('copy') ?? false; },
    });
    if (res === 'copied') {
      set('copied'); setStatus(which === 'url' ? t('share.copiedPub') : t('share.copiedAdmin'));
      setTimeout(() => set('idle'), 2000);
    } else {
      set('error'); setStatus(t('share.copyFailedLive'));
      input?.focus(); input?.select();
      setTimeout(() => set('idle'), 4000);
    }
  }
  async function nativeShare() {
    const res = await shareLink({ title: event.title, text: t('poll.mailSubject', { title: event.title }), url: shareUrl }, navigator);
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
  const mailMe = adminUrl ? mailtoLink(t('share.adminMailSubject', { title: event.title }), t('share.adminMailBody', { admin: adminUrl, url: shareUrl })) : '';
  const mailto = mailtoLink(t('poll.mailSubject', { title: event.title }), `${t('app.mailHello')}\n\n${t('poll.mailBody', { url: shareUrl })}\n`);

  return (
    <>
      <Header>
        <button type="button" className="icon-btn" id="share-open" ref={shareOpenRef} aria-controls="share"
          aria-expanded={open} aria-label={t('share.btnAria')} onClick={() => openPanel()}>{`↗ ${t('share.btn')}`}</button>
      </Header>
      <main className="container">
        <article className="card poll-view">
          {adminUrl && !acked && !open && (
            <div className="share-reminder" role="status" id="share-reminder">
              <span className="icon-lock" aria-hidden="true">!</span>
              <span style={{ flex: 1, minWidth: 200 }}>{rich('share.reminder')}</span>
              <button type="button" className="link-btn" id="rem-show" onClick={() => openPanel(true)}>{t('share.showAdminShort')}</button>
            </div>
          )}
          <section className="share" id="share" aria-labelledby="share-h" hidden={!open}>
            {justCreated
              ? <p className="share__confirm" id="share-h" tabIndex={-1}><span aria-hidden="true">✓</span> {t('share.created')}</p>
              : <p className="share__confirm" id="share-h" tabIndex={-1}>{t('app.shareH')}</p>}
            <button type="button" className="btn btn--ghost btn--sm share__close" id="share-close" aria-controls="share" onClick={hidePanel}>{t('share.hide')} <span aria-hidden="true">▴</span></button>
            <div className="linkbox" id="pub">
              <p className="linkbox__label"><span aria-hidden="true">🔗</span> {t('share.pubLabel')}</p>
              <p className="linkbox__desc">{t('share.pubDesc')}</p>
              <div className="linkbox__row">
                <input className="input share__url" id="url" ref={urlRef} readOnly value={shareUrl} aria-label={t('share.pubAria')}
                  onFocus={(e) => e.currentTarget.select()} onClick={(e) => e.currentTarget.select()} />
                <div className="share__actions">
                  <CopyButton state={copy.url} label={t('common.copyLink')} className="btn--primary" onClick={() => doCopy('url', shareUrl, urlRef.current)} />
                  {canShare && (
                    <button type="button" className="btn btn--secondary" id="native" onClick={nativeShare}>
                      <span aria-hidden="true">↗</span> {t('share.btn')}
                    </button>
                  )}
                  <a className="btn btn--ghost" id="mail" href={mailto}><span aria-hidden="true">✉</span> {t('share.email')}</a>
                </div>
              </div>
              {copy.url === 'error' && <p className="share__hint share__hint--error">{MANUAL_COPY}</p>}
            </div>
            {adminUrl && !acked && (
              <div className="linkbox linkbox--secret" id="admin" role="group" aria-labelledby="admin-l" aria-describedby="admin-d">
                <p className="linkbox__label" id="admin-l"><span className="icon-lock" aria-hidden="true">!</span> {t('share.adminLabel')}</p>
                <p className="linkbox__desc" id="admin-d">{rich('share.adminDesc')}</p>
                <div className="linkbox__row">
                  <input className="input" id="adminurl" ref={adminRef} readOnly value={adminUrl} aria-label={t('share.adminAria')}
                    onFocus={(e) => e.currentTarget.select()} onClick={(e) => e.currentTarget.select()} />
                  <div className="linkbox__actions">
                    <CopyButton state={copy.admin} label={t('share.copyAdmin')} className="btn--secondary" onClick={() => doCopy('admin', adminUrl, adminRef.current)} />
                    <a className="btn btn--secondary" id="mailme" href={mailMe}><span aria-hidden="true">✉</span> {t('common.sendToSelf')}</a>
                  </div>
                </div>
                {copy.admin === 'error' && <p className="share__hint share__hint--error">{MANUAL_COPY}</p>}
                <div className="linkbox__ack">
                  <button type="button" className="btn btn--secondary" id="ack" onClick={() => {
                    setAcked(true); setStatus(t('share.ackLive'));
                    setTimeout(() => ackShowRef.current?.focus(), 0);
                  }}><span aria-hidden="true">✓</span> {t('share.ack')}</button>
                  <span className="field__hint">{t('share.ackHint')}</span>
                </div>
              </div>
            )}
            {adminUrl && acked && (
              <div className="linkbox linkbox--done" id="admin-done">
                <span aria-hidden="true">✓</span> {rich('share.adminDone')} <span className="meta">{t('app.pageOnly')}</span>{' '}
                <button type="button" className="link-btn" id="admin-show" aria-controls="admin" ref={ackShowRef}
                  onClick={() => { setAcked(false); setTimeout(() => adminRef.current?.focus(), 0); }}>{t('share.showAdmin')}</button>
              </div>
            )}
            {adminTok && open && <SendToEmails slug={event.slug} token={adminTok} />}
            <span className="sr-only" role="status" aria-live="polite">{status}</span>
          </section>
          {adminTok && !open && <SendToEmails slug={event.slug} token={adminTok} />}
          <ResultBanner event={event} appUrl={shareUrl.replace(/\/[a-z]{2}\/p\/[^/]+$/, '')} />
          <h1>{event.title}</h1>
          {event.description && <p className="lead">{event.description}</p>}
          <p className="tz-note">{t('app.pickHint')}</p>
          <VoteSection initial={event} />
        </article>
      </main>
    </>
  );
}
