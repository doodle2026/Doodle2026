'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { graphemes, MAX_PER_POLL, MAX_PER_SEND, MESSAGE_MAX, parseRecipients } from '@/lib/recipients';

type Api = (path: string, init?: RequestInit) => Promise<{ res: Response; data: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Delivery = 'queued' | 'sent' | 'delivered' | 'failed' | 'bounced' | 'unsub';
interface Row { email: string; name: string | null; delivery: Delivery; reason: string | null; updated_at: string; response: 'invited' | 'answered' | 'revoked' | null; linked_from: string | null }
interface State {
  invitees: Row[]; organizer_name: string; mail_blocked: boolean; tracking: boolean; public_answers: { id: number; name: string }[];
  limits: { per_send: number; per_poll: number; used: number; message_max: number };
  reminder: { used: number; max: number; next_allowed_at: string | null; recipient_count: number; answered_count: number; closed: boolean };
}
/** Delivery badges (design §30.3 "Levering"; §38 colours). sent and delivered both read "Leveret"/"Sendt". */
const DLV: Record<Delivery, [string, string, string]> = {
  queued: ['Sendes …', '…', 'queued'], sent: ['Sendt', '✉', 'sent'], delivered: ['Leveret', '✉', 'sent'],
  failed: ['Fejlet', '!', 'failed'], bounced: ['Afvist', '⊘', 'bounced'], unsub: ['Afmeldt', '–', 'unsub'],
};
type Filter = 'all' | 'queued' | 'sent' | 'failed' | 'bounced' | 'unsub' | 'answered' | 'waiting' | 'public';
const mailable = (r: Row) => r.delivery !== 'bounced' && r.delivery !== 'unsub';
const inFilter = (r: Row, f: Filter) => f === 'all' || (f === 'sent' ? r.delivery === 'sent' || r.delivery === 'delivered'
  : f === 'answered' ? r.response === 'answered' : f === 'waiting' ? r.response === 'invited' && mailable(r) : f === 'public' ? false : r.delivery === f);
const ANS = { invited: ['Inviteret', '○', 'st st--invited'], answered: ['Svaret', '✓', 'st st--answered'], revoked: ['Link tilbagekaldt', '⊗', 'st st--unsub'] } as const;
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
  const [track, setTrack] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: 'revoke'; email: string } | { kind: 'link'; pid: number; name: string } | null>(null);
  const [linkSel, setLinkSel] = useState('');
  const [linkErr, setLinkErr] = useState(false);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const cdlg = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<string | null>(null);
  const dlg = useRef<HTMLDialogElement>(null);
  const remBtn = useRef<HTMLButtonElement>(null);

  const denied = useRef(onDenied); denied.current = onDenied;
  const load = useCallback(async () => {
    const { res, data } = await api('/invitations');
    if (res.status === 401 || res.status === 403) { denied.current(); return; }
    if (res.ok) { setSt(data); setOrgName((o) => o || data.organizer_name); if (data.tracking) setTrack(true); }
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
      const { res, data } = await api('/invitations', { method: 'POST', body: JSON.stringify({ recipients: addr, message: msg, organizer_name: orgName, track }) });
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

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 8000); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { if (confirm) { cdlg.current?.showModal(); setTimeout(() => document.getElementById('c-cancel')?.focus(), 0); } }, [confirm]);
  useEffect(() => { if (returnFocus.current) { document.querySelector<HTMLElement>(returnFocus.current)?.focus(); returnFocus.current = null; } });

  async function action(name: 'resend' | 'revoke' | 'link' | 'unlink', payload: Record<string, unknown>) {
    const { res, data } = await api(`/invitations/${name}`, { method: 'POST', body: JSON.stringify(payload) });
    if (res.status === 401) { onDenied(); return null; }
    if (!res.ok) { setErr(Array.isArray(data.errors) ? data.errors : ['Handlingen mislykkedes.']); return null; }
    setErr([]); setSt(data); return data;
  }
  const esc = (e: string) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(e) : e);
  async function resend(email: string) {
    if (await action('resend', { email })) { setToast({ text: `Linket er sendt igen til ${email}.` }); returnFocus.current = `[data-resend="${esc(email)}"]`; }
  }
  async function confirmOk() {
    if (!confirm) return;
    if (confirm.kind === 'revoke') {
      const email = confirm.email; cdlg.current?.close(); setConfirm(null);
      if (await action('revoke', { email })) { setToast({ text: `Linket til ${email} er tilbagekaldt.` }); returnFocus.current = `[data-resend="${esc(email)}"]`; }
    } else {
      if (!linkSel) { setLinkErr(true); document.getElementById('linksel')?.focus(); return; }
      const { pid, name } = confirm, email = linkSel; cdlg.current?.close(); setConfirm(null);
      if (await action('link', { email, participant_id: pid })) {
        setToast({ text: `"${name}" er knyttet til ${email}.`, undo: async () => { setToast(null); await action('unlink', { email }); } });
      }
    }
  }

  if (!st) return null;
  const R = st.invitees;
  const T = st.tracking;
  const counts: Record<Filter, number> = { all: R.length, queued: 0, sent: 0, failed: 0, bounced: 0, unsub: 0, answered: 0, waiting: 0, public: st.public_answers.length };
  for (const r of R) for (const f of ['queued', 'sent', 'failed', 'bounced', 'unsub', 'answered', 'waiting'] as const) if (inFilter(r, f)) counts[f]++;
  const F: [Filter, string][] = T
    ? [['all', 'Alle'], ['answered', 'Svaret'], ['waiting', 'Ikke svaret'], ['failed', 'Fejlet'], ['bounced', 'Afvist'], ['unsub', 'Afmeldt'], ['public', 'Ikke inviteret']]
    : [['all', 'Alle'], ['sent', 'Leveret'], ['failed', 'Fejlet'], ['bounced', 'Afvist'], ['unsub', 'Afmeldt']];
  if (counts.queued) F.splice(1, 0, ['queued', 'Sendes']);
  const openInvitees = R.filter((r) => r.response === 'invited' && mailable(r));
  const ans = (r: Row) => r.response && (<>
    <span className={ANS[r.response][2]} style={r.response === 'invited' ? { background: 'var(--c-bg)', border: '1px solid var(--c-border-strong)', color: 'var(--c-text)' } : undefined}><span aria-hidden="true">{ANS[r.response][1]}</span> {ANS[r.response][0]}</span>
    {r.linked_from && <div className="meta">Knyttet til svar fra &quot;{r.linked_from}&quot; · <button type="button" className="link-btn" onClick={() => action('unlink', { email: r.email })}>Fortryd</button></div>}
  </>);
  const act = (r: Row) => !r.response || !mailable(r) ? <span className="meta">–</span>
    : r.response === 'revoked' ? <button type="button" className="btn btn--ghost btn--sm" data-resend={r.email} onClick={() => resend(r.email)}>Send nyt link</button>
    : <div className="row-actions"><button type="button" className="btn btn--ghost btn--sm" data-resend={r.email} onClick={() => resend(r.email)}>Gensend link</button>
        <button type="button" className="btn btn--danger-ghost btn--sm" data-revoke={r.email} onClick={() => setConfirm({ kind: 'revoke', email: r.email })}>Tilbagekald</button></div>;
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
          <div className="switch-row"><label className="switch"><input type="checkbox" role="switch" id="track" checked={track} disabled={st.tracking}
            onChange={(e) => setTrack(e.target.checked)} aria-describedby="track-d" /><span className="switch__ui" aria-hidden="true" /><span className="switch__label">Spor hvem der har svaret</span></label>
            <p className="field__hint" id="track-d">Hver modtager får sit <strong>eget link</strong>. Så kan du se, hvem der har svaret, og påmindelser går kun til dem, der mangler. Fra: alle får det samme offentlige link.
              {st.tracking && ' Slået til for denne afstemning (allerede sendte links forbliver gyldige, indtil du tilbagekalder dem).'}</p></div>
          <div className="mail-preview" id="mailprev"><dl>
            <dt>Fra</dt><dd><strong>{shownName} via Mødetid</strong> &lt;noreply@…&gt;</dd>
            <dt>Svar til</dt><dd><strong>Ingen</strong> – svar på mailen når ikke frem. Skriv evt. din kontaktinfo i beskeden.</dd>
            <dt>Til</dt><dd>Hver modtager får sin egen mail (ingen kan se de andre adresser).</dd>
            <dt>Emne</dt><dd>{shownName} inviterer dig: {preview?.subject.split(': ').slice(1).join(': ') || '…'}</dd>
            <dt>Link</dt><dd>{track ? <>Personligt link pr. modtager (<code>/p/{slug}#inv=…</code>)</> : <>Kun deltagerlinket <code>/p/{slug}</code></>} – <strong>aldrig admin-linket</strong>.</dd></dl>
            <details onToggle={(e) => setPreviewOpen((e.target as HTMLDetailsElement).open)}>
              <summary className="btn btn--ghost btn--sm" style={{ margin: 'var(--s-2) var(--s-4)' }}>Vis forhåndsvisning af mailen</summary>
              {preview && <iframe title="Forhåndsvisning af invitationsmail" sandbox="" srcDoc={preview.html} style={{ width: '100%', minHeight: 520, border: 0 }} />}
            </details>
          </div>
          <p className="privacy">🔒 Adresserne bruges kun til denne afstemning og slettes automatisk 90 dage efter, at afstemningen er lukket. Modtagere kan altid afmelde sig via linket i mailen.{track && ' Koblingen mellem modtager og svar slettes også 90 dage efter lukning.'}</p>
          <div className="form-actions"><button className="btn btn--primary" id="inv-send" type="submit" disabled={!canSend} aria-busy={sending || undefined}>
            {b ? `Send ${b} invitation${b === 1 ? '' : 'er'}` : 'Send invitationer'}</button></div>
        </form>
      )}

      {!closed && R.length > 0 && (
        <div className="reminder" aria-labelledby="rem-h" id="reminder">
          <div className="reminder__row"><h3 id="rem-h" style={{ margin: 0, fontSize: 'var(--fs-md)' }}>Påmindelse</h3>
            <span className="reminder__count"><span className="dots" aria-hidden="true">{[0, 1, 2].map((i) => <i key={i} className={i < rem.used ? 'on' : ''} />)}</span> {rem.used} af {rem.max} brugt</span></div>
          <p style={{ margin: 0, fontSize: 'var(--fs-sm)' }}>{T
            ? <>Sendes til <strong>dem, der ikke har svaret ({recips})</strong>. Afmeldte og afviste springes over.</>
            : <>Sendes til <strong>alle inviterede, der ikke har afmeldt sig ({recips})</strong> – også dem, der allerede har svaret. Mailen siger derfor &quot;Har du svaret?&quot;. Afviste adresser springes over. Slå &quot;Spor hvem der har svaret&quot; til, så går den kun til dem, der mangler.</>}</p>
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
            <thead>{T ? <tr><th scope="col">Modtager</th><th scope="col">Levering</th><th scope="col">Svar</th><th scope="col"><span className="sr-only">Handlinger</span></th></tr>
              : <tr><th scope="col">Modtager</th><th scope="col">Levering</th><th scope="col">Senest</th></tr>}</thead>
            <tbody>{filter === 'public' ? null : show.length ? show.map((r) => T ? (
              <tr key={r.email}><td className="addr">{r.email}<div className="meta">{when(r.updated_at)}</div></td><td>{badge(r)}{r.reason && r.delivery !== 'unsub' && <div className="meta">{r.reason}</div>}</td><td>{ans(r)}</td><td>{act(r)}</td></tr>
            ) : (
              <tr key={r.email}><td className="addr">{r.email}</td><td>{badge(r)}{r.reason && r.delivery !== 'unsub' && <div className="meta">{r.reason}</div>}</td><td className="meta">{when(r.updated_at)}</td></tr>
            )) : <tr><td colSpan={T ? 4 : 3} className="meta">Ingen modtagere med denne status.</td></tr>}</tbody>
          </table>
          <ul className="rlist" id="rlist">{filter === 'public' ? null : show.length ? show.map((r) => (
            <li key={r.email}><span className="addr">{r.email}</span><span className="badges">{badge(r)}{T && ans(r)}</span><span className="meta">{when(r.updated_at)}{r.reason && r.delivery !== 'unsub' ? ` · ${r.reason}` : ''}</span>
              {T && <span style={{ gridColumn: '1/-1' }}>{act(r)}</span>}</li>
          )) : <li className="meta">Ingen modtagere med denne status.</li>}</ul>
          {T && (filter === 'all' || filter === 'public') && st.public_answers.length > 0 && (
            <div className="pub" aria-labelledby="pub-h" id="public-answers"><h4 id="pub-h">Svar via offentligt link <span className="meta">(ikke inviteret)</span></h4>
              <p className="field__hint">Nogle har svaret via det fælles link i stedet for deres eget. Knyt svaret til en inviteret, så tælles personen som &quot;svaret&quot; og får ikke påmindelser.</p>
              <ul className="pub__list">{st.public_answers.map((p) => (
                <li key={p.id}><span className="pub__name">{p.name}</span><span className="st st--unsub">Ikke inviteret</span>
                  <button type="button" className="btn btn--secondary btn--sm" data-linkp={p.id} onClick={() => { setLinkSel(''); setLinkErr(false); setConfirm({ kind: 'link', pid: p.id, name: p.name }); }}>Knyt til inviteret …</button></li>
              ))}</ul></div>
          )}
          {list.length > show.length && <p className="field__hint">Viser {show.length} af {list.length}. <button type="button" className="link-btn" onClick={() => setShowAll(true)}>Vis alle</button></p>}
        </>
      )}

      <dialog className="modal" ref={dlg} aria-labelledby="rem-dh" aria-describedby="rem-dp" onClose={() => remBtn.current?.focus()}>
        <h2 id="rem-dh">Send påmindelse til {recips} {recips === 1 ? 'person' : 'personer'}?</h2>
        <p id="rem-dp">{T ? <>Påmindelsen går kun til <strong>dem, der ikke har svaret ({recips})</strong>.</> : <>Påmindelsen går til <strong>alle inviterede, der ikke har afmeldt sig ({recips})</strong> – også dem, der allerede har svaret.</>} Du har {rem.max - rem.used} påmindelse{rem.max - rem.used === 1 ? '' : 'r'} tilbage, og den næste kan tidligst sendes om 24 timer.</p>
        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" id="rem-cancel" onClick={() => dlg.current?.close()}>Annullér</button>
          <button type="button" className="btn btn--primary" id="rem-ok" onClick={sendReminder}>Send til {recips}</button>
        </div>
      </dialog>

      <dialog className="modal" ref={cdlg} aria-labelledby="c-h" onClose={() => setConfirm(null)}>
        {confirm?.kind === 'revoke' && (<>
          <h2 id="c-h">Tilbagekald linket til {confirm.email}?</h2>
          <p>Linket stopper med at virke med det samme. Et svar, der allerede er afgivet, <strong>bevares</strong>, men kan ikke rettes via linket.</p>
          <div className="modal__actions"><button type="button" className="btn btn--ghost" id="c-cancel" onClick={() => cdlg.current?.close()}>Annullér</button>
            <button type="button" className="btn btn--danger" id="c-ok" onClick={confirmOk}>Tilbagekald link</button></div></>)}
        {confirm?.kind === 'link' && (<>
          <h2 id="c-h">Knyt &quot;{confirm.name}&quot; til en inviteret</h2>
          <p>Vælg den modtager, svaret kommer fra. Svaret bliver stående, og modtageren vises som &quot;svaret&quot; og får ikke flere påmindelser. Du kan fortryde bagefter.</p>
          <label className="field__label" htmlFor="linksel">Inviteret modtager</label>
          <select className="input" id="linksel" value={linkSel} aria-invalid={linkErr || undefined} aria-describedby="linksel-h" onChange={(e) => { setLinkSel(e.target.value); setLinkErr(false); }}>
            <option value="">Vælg …</option>{openInvitees.map((r) => <option key={r.email} value={r.email}>{r.email}</option>)}</select>
          <p className="field__hint" id="linksel-h">{linkErr ? 'Vælg en modtager.' : 'Kun modtagere, der endnu ikke har svaret.'}</p>
          <div className="modal__actions"><button type="button" className="btn btn--ghost" id="c-cancel" onClick={() => cdlg.current?.close()}>Annullér</button>
            <button type="button" className="btn btn--primary" id="c-ok" onClick={confirmOk}>Knyt svaret</button></div></>)}
      </dialog>
      <div aria-live="polite">{toast && <div className="toast-undo" role="status" id="inv-toast"><span>{toast.text}</span>{toast.undo && <button type="button" id="inv-undo" onClick={toast.undo}>Fortryd</button>}</div>}</div>
    </section>
  );
}
