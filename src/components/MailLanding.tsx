'use client';
import { useEffect, useRef, useState } from 'react';

type Info = { email: string; title: string; slug: string; poll_unsubscribed: boolean; all_unsubscribed: boolean };
type Kind = 'poll' | 'all' | 'abuse';

async function post(url: string, json: unknown) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json), cache: 'no-store' });
  return { ok: r.ok, data: await r.json().catch(() => ({})) };
}

/** Design §40 landing pages: unsubscribe this poll (auto via JS POST), unsubscribe all (one confirm click), report abuse. */
export default function MailLanding({ kind, token }: { kind: Kind; token: string }) {
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
  const poll = info ? `/p/${info.slug}` : '/';
  const H = ({ children }: { children: React.ReactNode }) => <h1 tabIndex={-1} ref={h1}>{children}</h1>;
  const icon = (c: string) => <span className="landing__icon" aria-hidden="true">{c}</span>;

  let body: React.ReactNode = <p className="lead">Et øjeblik …</p>;
  if (state === 'invalid') body = <>{icon('🔗')}<H>Linket er ugyldigt eller udløbet</H><p className="lead">Adresser slettes 90 dage efter, at en afstemning er lukket – så får du heller ingen mails om den.</p></>;
  else if (state === 'error') body = <>{icon('⚠️')}<H>Noget gik galt</H><p className="lead">Prøv igen om lidt.</p></>;
  else if (kind === 'poll' && state === 'done') body = <>{icon('👋')}<H>Du er afmeldt</H>
    <p className="lead">Du får ikke flere mails om <strong>{T}</strong> på <strong>{E}</strong>. Andre afstemninger påvirkes ikke.</p>
    <p className="field__hint">Du kan stadig stemme via linket fra invitationen.</p>
    <div className="landing__actions"><button type="button" className="btn btn--secondary" id="undo" disabled={busy} onClick={() => act('p', 'resubscribe', 'undone')}>Fortryd – tilmeld mig igen</button><a className="btn btn--ghost" href={poll}>Gå til afstemningen</a></div>
    <p className="privacy" style={{ marginTop: 'var(--s-5)' }}>Vil du slet ikke have mails fra Mødetid? <a href={`/u/all/${token}`}>Afmeld alle mails</a>.</p></>;
  else if (kind === 'poll' && state === 'undone') body = <>{icon('✅')}<H>Du er tilmeldt igen</H>
    <p className="lead">Du får igen mails om <strong>{T}</strong>, fx påmindelser fra arrangøren.</p>
    <div className="landing__actions"><a className="btn btn--primary" href={poll}>Gå til afstemningen</a><button type="button" className="btn btn--ghost" id="re" disabled={busy} onClick={() => act('p', 'unsubscribe', 'done')}>Afmeld igen</button></div></>;
  else if (kind === 'all' && state === 'confirm') body = <>{icon('✉️')}<H>Afmeld alle mails fra Mødetid?</H>
    <p className="lead">Vi sender ikke flere invitationer eller påmindelser til <strong>{E}</strong> – fra nogen arrangør, om nogen afstemning.</p>
    <div className="landing__actions"><button type="button" className="btn btn--primary" id="go" disabled={busy} onClick={() => act('all', 'unsubscribe', 'done')}>{busy ? <><span className="spinner" aria-hidden="true" /> Afmelder …</> : 'Ja, afmeld alle mails'}</button><a className="btn btn--ghost" href={`/u/p/${token}`}>Kun denne afstemning</a></div>
    <p className="privacy" style={{ marginTop: 'var(--s-4)' }}>Vi beder dig bekræfte, så et automatisk link-tjek i dit mailprogram ikke afmelder dig ved en fejl.</p></>;
  else if (kind === 'all' && state === 'done') body = <>{icon('🔕')}<H>Du er afmeldt alle mails</H>
    <p className="lead">Mødetid sender ikke flere mails til <strong>{E}</strong>. Arrangører kan se, at du er afmeldt, men ikke hvorfor.</p>
    <div className="landing__box"><p className="field__hint">Fortrudt? Hvis du senere vil have invitationer igen, så klik på &quot;Tilmeld igen&quot; herunder, eller bed en arrangør om at sende dig linket direkte.</p></div>
    <div className="landing__actions"><button type="button" className="btn btn--ghost" id="re" disabled={busy} onClick={() => act('all', 'resubscribe', 'resub')}>Tilmeld igen</button></div></>;
  else if (kind === 'all' && state === 'resub') body = <>{icon('✅')}<H>Du er tilmeldt igen</H><p className="lead">Du kan igen modtage invitationer via Mødetid.</p></>;
  else if (kind === 'abuse' && state === 'form') body = <>{icon('🚩')}<H>Rapportér misbrug</H>
    <p className="lead">Fik du en mail fra Mødetid, du ikke forventede eller som virker som spam? Fortæl os det – vi kigger på det.</p>
    <form className="landing__box" id="f" noValidate onSubmit={async (e) => {
      e.preventDefault(); setBusy(true);
      const r = await post(`/api/abuse/${token}`, { reason, details, unsubscribe: alsoUnsub });
      setBusy(false); setState(r.ok ? 'reported' : 'error');
    }}>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend className="field__label">Hvad er problemet?</legend>
        {([['spam', 'Spam eller uønsket reklame'], ['unknown_sender', 'Jeg kender ikke afsenderen'], ['phishing', 'Svindel eller phishing'], ['other', 'Andet']] as const).map(([v, l]) => (
          <label className="radio" key={v}><input type="radio" name="r" value={v} checked={reason === v} onChange={() => setReason(v)} /> {l}</label>))}
      </fieldset>
      <div className="field" style={{ marginTop: 'var(--s-3)' }}><label className="field__label" htmlFor="c">Uddyb <span className="field__hint">(valgfri)</span></label>
        <textarea className="input" id="c" rows={3} maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} /></div>
      <label className="check"><input type="checkbox" id="u" checked={alsoUnsub} onChange={(e) => setAlsoUnsub(e.target.checked)} /> Afmeld også mails om denne afstemning</label>
      <div className="landing__actions" style={{ justifyContent: 'flex-start' }}><button className="btn btn--danger" disabled={busy}>Send rapport</button></div>
    </form>
    <p className="privacy" style={{ marginTop: 'var(--s-4)' }}>Rapporten er anonym over for arrangøren. Vi gemmer kun afstemningen og din vurdering.</p></>;
  else if (kind === 'abuse' && state === 'reported') body = <>{icon('🙏')}<H>Tak – vi har modtaget din rapport</H>
    <p className="lead">Vi gennemgår den hurtigst muligt. Ved gentagne rapporter stopper vi arrangørens mulighed for at sende mails.</p>
    {alsoUnsub && <p className="field__hint">Du er afmeldt mails om denne afstemning.</p>}
    <div className="landing__actions"><a className="btn btn--ghost" href={`/u/all/${token}`}>Afmeld alle mails fra Mødetid</a></div></>;

  return <section className="card landing" aria-live="polite" id="main">{body}</section>;
}
