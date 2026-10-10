'use client';
import { useLp } from '@/i18n/link';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n/use';

type Info = { email: string; title: string; slug: string; poll_unsubscribed: boolean; all_unsubscribed: boolean };
type Kind = 'poll' | 'all' | 'abuse';

async function post(url: string, json: unknown) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json), cache: 'no-store' });
  return { ok: r.ok, data: await r.json().catch(() => ({})) };
}

/** Design §40 landing pages: unsubscribe this poll (auto via JS POST), unsubscribe all (one confirm click), report abuse. */
export default function MailLanding({ kind, token }: { kind: Kind; token: string }) {
  const lp = useLp();
  const { t, rich } = useI18n();
  const [state, setState] = useState<string>('loading');
  const [info, setInfo] = useState<Info | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('spam');
  const [details, setDetails] = useState('');
  const [alsoUnsub, setAlsoUnsub] = useState(true);
  const h1 = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (state !== 'loading') h1.current?.focus(); }, [state]);

  useEffect(() => {
    (async () => {
      const r = await fetch(`/api/u/p/${token}`, { cache: 'no-store' });
      if (!r.ok) { setState('invalid'); return; }
      const i: Info = await r.json(); setInfo(i);
      if (kind === 'poll') {
        // JS-only POST: link scanners that merely GET the page don't unsubscribe anyone.
        const u = await post(`/api/u/p/${token}`, { action: 'unsubscribe' });
        setState(u.ok ? 'done' : 'error');
      } else setState(kind === 'all' ? (i.all_unsubscribed ? 'done' : 'confirm') : 'form');
    })().catch(() => setState('error'));
  }, [kind, token]);

  const act = async (scope: 'p' | 'all', action: 'unsubscribe' | 'resubscribe', next: string) => {
    setBusy(true);
    const r = await post(`/api/u/${scope}/${token}`, { action });
    setBusy(false); setState(r.ok ? next : 'error');
  };
  const T = info?.title ?? '', E = info?.email ?? '';
  const unsubAll = lp(`/u/all/${token}`);
  const poll = lp(info ? `/p/${info.slug}` : '/');
  const H = ({ children }: { children: React.ReactNode }) => <h1 tabIndex={-1} ref={h1}>{children}</h1>;
  const icon = (c: string) => <span className="landing__icon" aria-hidden="true">{c}</span>;

  let body: React.ReactNode = <p className="lead">{t('app.moment')}</p>;
  if (state === 'invalid') body = <>{icon('🔗')}<H>{t('app.linkInvalidH')}</H><p className="lead">{t('app.linkInvalidP')}</p></>;
  else if (state === 'error') body = <>{icon('⚠️')}<H>{t('app.wrongH')}</H><p className="lead">{t('app.wrongP')}</p></>;
  else if (kind === 'poll' && state === 'done') body = <>{icon('👋')}<H>{t('unsub.doneH')}</H>
    <p className="lead">{rich('unsub.doneLead', { title: T, email: E })}</p>
    <p className="field__hint">{t('unsub.stillVote')}</p>
    <div className="landing__actions"><button type="button" className="btn btn--secondary" id="undo" disabled={busy} onClick={() => act('p', 'resubscribe', 'undone')}>{t('unsub.undo')}</button><a className="btn btn--ghost" href={poll}>{t('unsub.goPoll')}</a></div>
    <p className="privacy" style={{ marginTop: 'var(--s-5)' }}>{rich('unsub.allHint', { href: unsubAll })}</p></>;
  else if (kind === 'poll' && state === 'undone') body = <>{icon('✅')}<H>{t('unsub.reH')}</H>
    <p className="lead">{rich('unsub.reLead', { title: T })}</p>
    <div className="landing__actions"><a className="btn btn--primary" href={poll}>{t('unsub.goPoll')}</a><button type="button" className="btn btn--ghost" id="re" disabled={busy} onClick={() => act('p', 'unsubscribe', 'done')}>{t('unsub.again')}</button></div></>;
  else if (kind === 'all' && state === 'confirm') body = <>{icon('✉️')}<H>{t('unsub.allH')}</H>
    <p className="lead">{rich('unsub.allLead', { email: E })}</p>
    <div className="landing__actions"><button type="button" className="btn btn--primary" id="go" disabled={busy} onClick={() => act('all', 'unsubscribe', 'done')}>{busy ? <><span className="spinner" aria-hidden="true" /> {t('unsub.working')}</> : t('unsub.allYes')}</button><a className="btn btn--ghost" href={lp(`/u/p/${token}`)}>{t('unsub.onlyThis')}</a></div>
    <p className="privacy" style={{ marginTop: 'var(--s-4)' }}>{t('unsub.whyConfirm')}</p></>;
  else if (kind === 'all' && state === 'done') body = <>{icon('🔕')}<H>{t('unsub.allDoneH')}</H>
    <p className="lead">{rich('unsub.allDoneLead', { email: E })}</p>
    <div className="landing__box"><p className="field__hint">{t('unsub.allRegret')}</p></div>
    <div className="landing__actions"><button type="button" className="btn btn--ghost" id="re" disabled={busy} onClick={() => act('all', 'resubscribe', 'resub')}>{t('unsub.resub')}</button></div></>;
  else if (kind === 'all' && state === 'resub') body = <>{icon('✅')}<H>{t('unsub.reH')}</H><p className="lead">{t('unsub.resubLead')}</p></>;
  else if (kind === 'abuse' && state === 'form') body = <>{icon('🚩')}<H>{t('abuse.title')}</H>
    <p className="lead">{t('abuse.lead')}</p>
    <form className="landing__box" id="f" noValidate onSubmit={async (e) => {
      e.preventDefault(); setBusy(true);
      const r = await post(`/api/abuse/${token}`, { reason, details, unsubscribe: alsoUnsub });
      setBusy(false); setState(r.ok ? 'reported' : 'error');
    }}>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend className="field__label">{t('abuse.q')}</legend>
        {([['spam', t('abuse.spam')], ['unknown_sender', t('abuse.unknown')], ['phishing', t('abuse.phishing')], ['other', t('abuse.other')]] as const).map(([v, l]) => (
          <label className="radio" key={v}><input type="radio" name="r" value={v} checked={reason === v} onChange={() => setReason(v)} /> {l}</label>))}
      </fieldset>
      <div className="field" style={{ marginTop: 'var(--s-3)' }}><label className="field__label" htmlFor="c">{t('abuse.details')} <span className="field__hint">{t('common.optional')}</span></label>
        <textarea className="input" id="c" rows={3} maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} /></div>
      <label className="check"><input type="checkbox" id="u" checked={alsoUnsub} onChange={(e) => setAlsoUnsub(e.target.checked)} /> {t('abuse.alsoUnsub')}</label>
      <div className="landing__actions" style={{ justifyContent: 'flex-start' }}><button className="btn btn--danger" disabled={busy}>{t('abuse.send')}</button></div>
    </form>
    <p className="privacy" style={{ marginTop: 'var(--s-4)' }}>{t('app.abusePrivacy')}</p></>;
  else if (kind === 'abuse' && state === 'reported') body = <>{icon('🙏')}<H>{t('abuse.doneH')}</H>
    <p className="lead">{t('abuse.doneLead')}</p>
    {alsoUnsub && <p className="field__hint">{t('abuse.doneUnsub')}</p>}
    <div className="landing__actions"><a className="btn btn--ghost" href={unsubAll}>{t('abuse.allLink')}</a></div></>;

  return <section className="card landing" aria-live="polite" id="main">{body}</section>;
}
