'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { graphemes, MAX_PER_POLL, MAX_PER_SEND, MESSAGE_MAX, parseRecipients } from '@/lib/recipients';

type Api = (path: string, init?: RequestInit) => Promise<{ res: Response; data: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Delivery = 'queued' | 'sent' | 'delivered' | 'failed' | 'bounced' | 'unsub';
interface Row { email: string; name: string | null; delivery: Delivery; reason: string | null; updated_at: string }
interface State {
  invitees: Row[]; organizer_name: string; mail_blocked: boolean;
  limits: { per_send: number; per_poll: number; used: number; message_max: number };
  reminder: { used: number; max: number; next_allowed_at: string | null; recipient_count: number; closed: boolean };
}
/** Delivery badges (design §30.3 "Levering"; §38 colours). sent and delivered both read "Leveret"/"Sendt". */
const DLV: Record<Delivery, [string, string, string]> = {
  queued: ['Sendes …', '…', 'queued'], sent: ['Sendt', '✉', 'sent'], delivered: ['Leveret', '✉', 'sent'],
  failed: ['Fejlet', '!', 'failed'], bounced: ['Afvist', '⊘', 'bounced'], unsub: ['Afmeldt', '–', 'unsub'],
};
type Filter = 'all' | 'queued' | 'sent' | 'failed' | 'bounced' | 'unsub';
const inFilter = (r: Row, f: Filter) => f === 'all' || (f === 'sent' ? r.delivery === 'sent' || r.delivery === 'delivered' : r.delivery === f);
const when = (iso: string) => new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)).replace(/\.(?=\d)/, ':');
export function waitText(ms: number) { const m = Math.max(1, Math.ceil(ms / 60_000)); const h = Math.floor(m / 60); return h ? `${h} t ${m % 60} min` : `${m} min`; }

export default function InviteSection({ api, slug, closed, onDenied, onStatus }: {
  api: Api; slug: string; closed: boolean; onDenied: () => void; onStatus: (m: string) => void;
}) {
  const [st, setSt] = useState<State | null>(null);
  const [addr, setAddr] = useState('');
  const [msg, setMsg] = useState('');
  const [orgName, setOrgName] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [showAll, setShowAll] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const dlg = useRef<HTMLDialogElement>(null);
  const remBtn = useRef<HTMLButtonElement>(null);

  const denied = useRef(onDenied); denied.current = onDenied;
  const load = useCallback(async () => {
    const { res, data } = await api('/invitations');
    if (res.status === 401 || res.status === 403) { denied.current(); return; }
    if (res.ok) { setSt(data); setOrgName((o) => o || data.organizer_name); }
  }, [api]);
  useEffect(() => { load(); }, [load, closed]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);

  const parsed = useMemo(() => parseRecipients(addr, st?.invitees.map((r) => r.email) ?? []), [addr, st]);
  const used = st?.limits.used ?? 0, left = MAX_PER_POLL - used, b = parsed.valid.length;
  const n = graphemes(msg);
  const batchErr = b > MAX_PER_SEND ? `Du kan højst sende ${MAX_PER_SEND} ad gangen. Fjern ${b - MAX_PER_SEND} adresser, eller send resten bagefter.`
    : b > left ? `Afstemningen kan højst have ${MAX_PER_POLL} inviterede. Der er plads til ${left} mere – fjern ${b - left}.` : '';
  const msgErr = n > MESSAGE_MAX ? `Beskeden er ${n - MESSAGE_MAX} tegn for lang.` : '';
  const canSend = b > 0 && !batchErr && !msgErr && !parsed.invalid.length && !sending && !closed && !st?.mail_blocked;
  const shownName = orgName.trim() || 'Arrangøren';

  // Live preview of the real template (debounced; only while <details> is open).
  useEffect(() => {
    if (!previewOpen || msgErr) return;
    const t = setTimeout(async () => {
      const { res, data } = await api('/invitations/preview', { method: 'POST', body: JSON.stringify({ message: msg, organizer_name: orgName }) });
      if (res.ok) setPreview(data);
    }, 400);
    return () => clearTimeout(t);
  }, [previewOpen, msg, orgName, msgErr, api]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    setSending(true); setErr([]);
    try {
      const { res, data } = await api('/invitations', { method: 'POST', body: JSON.stringify({ recipients: addr, message: msg, organizer_name: orgName }) });
      if (res.status === 401 || (res.status === 403 && data.code !== 'mail_blocked')) { onDenied(); return; }
      if (!res.ok) { setErr(Array.isArray(data.errors) ? data.errors : ['Invitationerne kunne ikke sendes.']); return; }
      setSt(data); setAddr(''); setMsg('');
      onStatus(`✓ ${data.sent} invitation${data.sent === 1 ? '' : 'er'} sendt.${data.failed ? ` ${data.failed} fejlede.` : ''}${data.suppressed ? ` ${data.suppressed} er afmeldt og fik ingen mail.` : ''}`);
    } catch { setErr(['Kunne ikke kontakte serveren. Prøv igen.']); } finally { setSending(false); }
  }

  async function sendReminder() {
    dlg.current?.close();
    const { res, data } = await api('/reminders', { method: 'POST' });
    if (res.status === 401) { onDenied(); return; }
    if (!res.ok) { setErr(Array.isArray(data.errors) ? data.errors : ['Påmindelsen kunne ikke sendes.']); return; }
    setSt(data);
    onStatus(`✓ Påmindelsen er sendt til ${data.recipients} ${data.recipients === 1 ? 'person' : 'personer'}.`);
    setTimeout(() => remBtn.current?.focus(), 0);
  }

  if (!st) return null;
  const R = st.invitees;
  const counts: Record<Filter, number> = { all: R.length, queued: 0, sent: 0, failed: 0, bounced: 0, unsub: 0 };
  for (const r of R) for (const f of ['queued', 'sent', 'failed', 'bounced', 'unsub'] as const) if (inFilter(r, f)) counts[f]++;
  const F: [Filter, string][] = [['all', 'Alle'], ...(counts.queued ? [['queued', 'Sendes'] as [Filter, string]] : []), ['sent', 'Leveret'], ['failed', 'Fejlet'], ['bounced', 'Afvist'], ['unsub', 'Afmeldt']];
  const list = R.filter((r) => inFilter(r, filter));
  const show = showAll ? list : list.slice(0, 8);
  const rem = st.reminder, recips = rem.recipient_count;
  const waitMs = rem.next_allowed_at ? new Date(rem.next_allowed_at).getTime() - now : 0;
  const maxed = rem.used >= rem.max, cooling = !maxed && waitMs > 0;
  const badge = (r: Row) => <span className={`st st--${DLV[r.delivery][2]}`}><span aria-hidden="true">{DLV[r.delivery][1]}</span> {DLV[r.delivery][0]}</span>;
  const chipGroup = (cls: string, h: string, items: string[], kind: string, why: string) => items.length > 0 && (
    <div className={`chip-group chip-group--${cls}`}><p className="chip-group__h">{h} ({items.length})</p>
      <ul>{items.map((e, i) => <li key={i} className={`echip echip--${kind}`}><span className="echip__addr">{e}</span><span className="echip__why">{why}</span></li>)}</ul></div>
  );

  return (
    <section className="section" id="invite" aria-labelledby="inv-h">
      <h2 id="inv-h">Invitér via e-mail</h2>
      <p className="tz-note" style={{ marginTop: -8 }}>Vi sender en mail med linket til deltagerne – aldrig dit admin-link.</p>
      {closed ? (
        <div className="closed-banner" role="status" style={{ marginBottom: 'var(--s-3)' }}><span className="closed-banner__icon" aria-hidden="true">🔒</span>
          <div><h2>Afstemningen er lukket</h2><p>Du kan ikke sende flere invitationer eller påmindelser. Genåbn den i farezonen for at invitere flere.</p></div></div>
      ) : st.mail_blocked ? (
        <div className="alert" role="status">Mails er stoppet for denne afstemning efter gentagne rapporter om misbrug.</div>
      ) : (
        <form id="inv-form" noValidate onSubmit={send}>
          <div className="alert" role="alert" hidden={!err.length}>{err.map((x, i) => <div key={i}>{x}</div>)}</div>
          <div className="invite-usage" id="usage">
            <span><strong>{used}/{MAX_PER_POLL}</strong> brugt{b ? <>, <strong>{b}</strong> i denne afsendelse</> : null}</span>
            <span className="meter" role="img" aria-label={`${used + b} af ${MAX_PER_POLL} invitationer`}><span className="meter-row">
              <span className="meter__used" style={{ width: `${(used / MAX_PER_POLL) * 100}%` }} />
              <span className="meter__batch" style={{ width: `${(Math.min(b, Math.max(left, 0)) / MAX_PER_POLL) * 100}%` }} /></span></span>
            <span>Højst {MAX_PER_SEND} pr. afsendelse</span>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="addr">Modtagere</label>
            <textarea className="input" id="addr" rows={3} value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Indsæt eller skriv e-mailadresser …"
              autoComplete="off" spellCheck={false} aria-describedby="addr-hint addr-err" aria-invalid={!!batchErr || parsed.invalid.length > 0 || undefined} />
            <p className="field__hint" id="addr-hint">Adskil med komma, mellemrum eller linjeskift. Du kan indsætte en hel liste, fx fra Outlook (&quot;Navn &lt;navn@firma.dk&gt;&quot;).</p>
            <div className="field__error" id="addr-err" aria-live="polite">{batchErr}</div>
            <div className="chip-groups" id="groups" aria-live="polite">
              {chipGroup('err', 'Ugyldige – rettes eller fjernes', parsed.invalid, 'invalid', 'ugyldig')}
              {chipGroup('warn', 'Dubletter – fjernet automatisk', parsed.duplicates, 'dup', 'dublet')}
              {chipGroup('warn', 'Allerede inviteret – springes over', parsed.alreadyInvited, 'already', 'inviteret')}
            </div>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="orgname">Dit navn <span className="field__hint">(valgfrit – vises som afsender)</span></label>
            <input className="input" id="orgname" maxLength={50} value={orgName} onChange={(e) => setOrgName(e.target.value)} autoComplete="name" placeholder="Fx Mette Hansen" />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="pmsg">Personlig besked <span className="field__hint">(valgfri)</span></label>
            <textarea className="input" id="pmsg" rows={3} value={msg} onChange={(e) => setMsg(e.target.value)} aria-describedby="pmsg-count pmsg-err"
              placeholder="Fx: Hej alle – vi skal finde en dag til Q4-mødet. Svar gerne inden fredag." aria-invalid={!!msgErr || undefined} />
            <div className="field__meta"><div className="field__error" id="pmsg-err" aria-live="polite">{msgErr}</div>
              <span className={`counter${n > MESSAGE_MAX ? ' counter--over' : n >= 900 ? ' counter--warn' : ''}`} id="pmsg-count">{n} / {MESSAGE_MAX}</span></div>
          </div>
          <div className="mail-preview" id="mailprev"><dl>
            <dt>Fra</dt><dd><strong>{shownName} via Mødetid</strong> &lt;noreply@…&gt;</dd>
            <dt>Svar til</dt><dd><strong>Ingen</strong> – svar på mailen når ikke frem. Skriv evt. din kontaktinfo i beskeden.</dd>
            <dt>Til</dt><dd>Hver modtager får sin egen mail (ingen kan se de andre adresser).</dd>
            <dt>Emne</dt><dd>{shownName} inviterer dig: {preview?.subject.split(': ').slice(1).join(': ') || '…'}</dd>
            <dt>Link</dt><dd>Kun deltagerlinket <code>/p/{slug}</code> – <strong>aldrig admin-linket</strong>.</dd></dl>
            <details onToggle={(e) => setPreviewOpen((e.target as HTMLDetailsElement).open)}>
              <summary className="btn btn--ghost btn--sm" style={{ margin: 'var(--s-2) var(--s-4)' }}>Vis forhåndsvisning af mailen</summary>
              {preview && <iframe title="Forhåndsvisning af invitationsmail" sandbox="" srcDoc={preview.html} style={{ width: '100%', minHeight: 520, border: 0 }} />}
            </details>
          </div>
          <p className="privacy">🔒 Adresserne bruges kun til denne afstemning og slettes automatisk 90 dage efter, at afstemningen er lukket. Modtagere kan altid afmelde sig via linket i mailen.</p>
          <div className="form-actions"><button className="btn btn--primary" id="inv-send" type="submit" disabled={!canSend} aria-busy={sending || undefined}>
            {b ? `Send ${b} invitation${b === 1 ? '' : 'er'}` : 'Send invitationer'}</button></div>
        </form>
      )}

      {!closed && R.length > 0 && (
        <div className="reminder" aria-labelledby="rem-h" id="reminder">
          <div className="reminder__row"><h3 id="rem-h" style={{ margin: 0, fontSize: 'var(--fs-md)' }}>Påmindelse</h3>
            <span className="reminder__count"><span className="dots" aria-hidden="true">{[0, 1, 2].map((i) => <i key={i} className={i < rem.used ? 'on' : ''} />)}</span> {rem.used} af {rem.max} brugt</span></div>
          <p style={{ margin: 0, fontSize: 'var(--fs-sm)' }}>Sendes til <strong>alle inviterede, der ikke har afmeldt sig ({recips})</strong> – også dem, der allerede har svaret. Mailen siger derfor &quot;Har du svaret?&quot;. Afviste adresser springes over.</p>
          <div className="reminder__row">
            <button type="button" className="btn btn--secondary" id="rem-btn" ref={remBtn} disabled={maxed || cooling || !recips || st.mail_blocked}
              aria-describedby="rem-wait" onClick={() => { dlg.current?.showModal(); document.getElementById('rem-cancel')?.focus(); }}>🔔 Send påmindelse til {recips}</button>
            {maxed ? <span className="reminder__wait" id="rem-wait">Du har brugt alle {rem.max} påmindelser til denne afstemning.</span>
              : cooling ? <span className="reminder__wait" id="rem-wait" role="timer" aria-live="off">Næste påmindelse kan sendes om <strong>{waitText(waitMs)}</strong> (højst én pr. døgn).</span>
              : <span className="reminder__wait" id="rem-wait">Højst én pr. døgn og {rem.max} i alt.</span>}
          </div>
        </div>
      )}

      {R.length > 0 && (
        <>
          <h3 id="st-h" style={{ margin: 'var(--s-5) 0 var(--s-2)' }}>Status for invitationer</h3>
          <div className="filters" role="group" aria-label="Filtrér modtagere" id="filters">
            {F.map(([k, l]) => <button key={k} type="button" data-f={k} aria-pressed={filter === k} onClick={() => { setFilter(k); setShowAll(false); }}>{l}<span className="n">{counts[k]}</span></button>)}
          </div>
          <table className="rtable" id="rtable"><caption className="sr-only">Modtagere og status</caption>
            <thead><tr><th scope="col">Modtager</th><th scope="col">Levering</th><th scope="col">Senest</th></tr></thead>
            <tbody>{show.length ? show.map((r) => (
              <tr key={r.email}><td className="addr">{r.email}</td><td>{badge(r)}{r.reason && r.delivery !== 'unsub' && <div className="meta">{r.reason}</div>}</td><td className="meta">{when(r.updated_at)}</td></tr>
            )) : <tr><td colSpan={3} className="meta">Ingen modtagere med denne status.</td></tr>}</tbody>
          </table>
          <ul className="rlist" id="rlist">{show.length ? show.map((r) => (
            <li key={r.email}><span className="addr">{r.email}</span>{badge(r)}<span className="meta">{when(r.updated_at)}{r.reason && r.delivery !== 'unsub' ? ` · ${r.reason}` : ''}</span></li>
          )) : <li className="meta">Ingen modtagere med denne status.</li>}</ul>
          {list.length > show.length && <p className="field__hint">Viser {show.length} af {list.length}. <button type="button" className="link-btn" onClick={() => setShowAll(true)}>Vis alle</button></p>}
        </>
      )}

      <dialog className="modal" ref={dlg} aria-labelledby="rem-dh" aria-describedby="rem-dp" onClose={() => remBtn.current?.focus()}>
        <h2 id="rem-dh">Send påmindelse til {recips} {recips === 1 ? 'person' : 'personer'}?</h2>
        <p id="rem-dp">Påmindelsen går til <strong>alle inviterede, der ikke har afmeldt sig ({recips})</strong> – også dem, der allerede har svaret. Du har {rem.max - rem.used} påmindelse{rem.max - rem.used === 1 ? '' : 'r'} tilbage, og den næste kan tidligst sendes om 24 timer.</p>
        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" id="rem-cancel" onClick={() => dlg.current?.close()}>Annullér</button>
          <button type="button" className="btn btn--primary" id="rem-ok" onClick={sendReminder}>Send til {recips}</button>
        </div>
      </dialog>
    </section>
  );
}
