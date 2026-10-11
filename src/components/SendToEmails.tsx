'use client';
/**
 * "Send til e-mails" on the confirmation page – design-spec §46.1–46.6 (phase 1: one address per line, Send per line).
 * Uses the existing invitations API (admin Bearer, Invitation model, limits, suppression list): one recipient per click.
 * PM: opted-out addresses are never revealed – the server answers "rejected" (neutral text), no pre-check.
 * Phase 2 (§46.7): toggle "Indsæt mange" – one field (semicolon/comma/newline/Outlook "Name <x>"), overview chips,
 * "Send til N" as ONE combined call (≤50) with per-address results, "Prøv de fejlede igen" via /retry {emails}.
 * Classification is client-side (format, duplicates, already invited) – no pre-check endpoint, opt-outs only show up as "blocked" after sending.
 * Quota (poll/hour/day) comes with GET on load and with every send; status re-polled every 20 s while the tab is visible.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n/use';
import { useLp } from '@/i18n/link';
import { graphemes, MESSAGE_MAX, NAME_ADDR_RE, unquote, validEmail } from '@/lib/recipients';

type Invitee = { email: string; status: string }; // §46.8 invitations[] (sent|failed|bounced; opt-outs never shown as such)
type Quota = { poll: number; hour: number; day: number }; // §46.8 QuotaRemaining
type St = 'idle' | 'sending' | 'sent' | 'failed' | 'bounced' | 'rejected';
type Row = { id: number; value: string; status: St; touched: boolean; earlier?: boolean };
const POLL_MS = 20_000;
let uid = 0;
/** Unsent drafts survive remounts (share panel hidden/shown) but not a reload (§46.2: drafts are lost on reload). */
type BSt = '' | 'sending' | 'sent' | 'failed' | 'blocked' | 'bounced';
type BItem = { id: number; raw: string; email: string; name?: string; status: BSt };
type Kind = 'valid' | 'invalid' | 'dup' | 'already';
const drafts = new Map<string, { rows: Row[]; message: string; bulk?: BItem[] }>();
const MODE_KEY = 'ga-se-mode';
/** Split pasted text: ; , newline/whitespace, and Outlook "Name <x@y>" (keeps only the address). */
/** Split pasted text into addresses, keeping display names from `Name <x@y>` / `"Lund, Jan" <x@y>` (L4, H3). */
export function splitBulkNamed(text: string): { raw: string; email: string; name?: string }[] {
  const out: { raw: string; email: string; name?: string; at: number }[] = [];
  const rest = text.replace(NAME_ADDR_RE, (m: string, n: string, e: string, at: number) => {
    const name = unquote(n);
    out.push({ raw: m.trim(), email: e.trim(), ...(name ? { name } : {}), at }); return ' '.repeat(m.length);
  });
  let pos = 0;
  for (const part of rest.split(/([\s,;]+)/)) { if (part && !/^[\s,;]+$/.test(part)) out.push({ raw: part, email: part.replace(/^<|>$/g, ''), at: pos }); pos += part.length; }
  return out.sort((a, b) => a.at - b.at).map(({ at: _at, ...x }) => x); // eslint-disable-line @typescript-eslint/no-unused-vars
}
export const splitBulk = (text: string): string[] => splitBulkNamed(text).map((x) => x.email);
const newRow = (value = '', status: St = 'idle', earlier = false): Row => ({ id: ++uid, value, status, touched: !!value, earlier });
/** trim, drop mailto:, lower-case the domain (§46.3). */
export const normSe = (v: string) => { v = v.trim().replace(/^mailto:/i, ''); const i = v.lastIndexOf('@'); return i < 0 ? v : v.slice(0, i) + '@' + v.slice(i + 1).toLowerCase(); };
const key = (v: string) => normSe(v).toLowerCase();
const fromDelivery = (d: string): St => (d === 'bounced' ? 'bounced' : d === 'failed' ? 'failed' : 'sent'); // 'delivered' shows as Sendt ✓
const FINAL = new Set(['delivered', 'bounced', 'failed', 'blocked']);
/** §46.9: Retry-After as delta-seconds or HTTP date → seconds; null when missing/unparseable. */
export function parseRetryAfter(h: string | null, now = Date.now()): number | null {
  if (!h) return null; const v = h.trim();
  if (/^\d+$/.test(v)) return Number(v);
  const t = Date.parse(v); return Number.isNaN(t) ? null : Math.max(0, Math.round((t - now) / 1000));
}
/** §46.9: minutes shown = ceil(sec/60); under 60 s → 0 ("under 1 min"). */
export const waitMinutes = (sec: number) => (sec < 60 ? 0 : Math.ceil(sec / 60));
const isIpLimit = (status: number | undefined, d: Record<string, unknown>) => status === 429 && (d.error === 'rate_ip' || d.code === 'ip_limit');

export default function SendToEmails({ slug, token }: { slug: string; token: string }) {
  const { t, tr, locale } = useI18n();
  const lp = useLp();
  const [open, setOpen] = useState(true);
  const [rows, setRows] = useState<Row[]>(() => {
    const d = drafts.get(slug)?.rows ?? [];
    return [...d, ...Array.from({ length: Math.max(0, 5 - d.length) }, () => newRow())];
  });
  const [invitees, setInvitees] = useState<Invitee[]>([]);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [pmOpen, setPmOpen] = useState(() => !!drafts.get(slug)?.message);
  const [message, setMessage] = useState(() => drafts.get(slug)?.message ?? '');
  const [live, setLive] = useState('');
  const [mode, setModeS] = useState<'rows' | 'bulk'>('rows');
  const [B, setB] = useState<BItem[]>(() => drafts.get(slug)?.bulk ?? []);
  const [bulkText, setBulkText] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => { try { if (localStorage.getItem(MODE_KEY) === 'bulk') setModeS('bulk'); } catch { /* private mode */ } }, []);
  const [ipWait, setIpWait] = useState<number | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const loaded = useRef(false);
  const sentHere = useRef(0);

  const ipTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const [ipNoHeader, setIpNoHeader] = useState(false);
  /** Local countdown, no auto-resend. `sec === null` (no Retry-After) → se.limitHour for an hour. */
  const startIpWait = (secIn: number | null) => {
    setIpNoHeader(secIn === null);
    const sec = secIn ?? 3600;
    const until = Date.now() + sec * 1000; clearInterval(ipTimer.current);
    const tick = () => { const left = until - Date.now(); if (left <= 0) { clearInterval(ipTimer.current); setIpWait(null); } else setIpWait(waitMinutes(left / 1000)); };
    tick(); ipTimer.current = setInterval(tick, 15_000);
  };
  useEffect(() => () => clearInterval(ipTimer.current), []);
  useEffect(() => {
    drafts.set(slug, { bulk: B.filter((x) => x.status !== 'sent' && x.status !== 'bounced' && x.status !== 'sending'), rows: rows.filter((r) => !r.earlier && r.status !== 'sent' && r.status !== 'sending' && r.status !== 'bounced').map((r) => ({ ...r, status: r.status === 'failed' ? 'failed' : 'idle' })), message });
  }, [slug, rows, message, B]);
  const say = (m: string) => { setLive(''); setTimeout(() => setLive(m), 30); };
  const api = useCallback(async (path: string, init?: RequestInit) => {
    const res = await fetch(`/api/events/${encodeURIComponent(slug)}/invitations${path}`, {
      ...init, cache: 'no-store', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
    return { res, data: await res.json().catch(() => ({})) };
  }, [slug, token]);

  // H1: stable callbacks (no t/invitees deps) → exactly one interval; no side effects inside state updaters.
  const tRef = useRef(t); tRef.current = t;
  const invRef = useRef<Invitee[]>([]);
  const apply = useCallback((d: { invitations?: Invitee[]; remaining?: Quota }) => {
    if (d.remaining) setQuota(d.remaining);
    if (!d.invitations) return;
    const inv = d.invitations;
    const prev = new Map(invRef.current.map((i) => [i.email, i.status]));
    invRef.current = inv;
    setInvitees(inv);
    const by = new Map(inv.map((i) => [i.email, i.status]));
    for (const i of inv) if (i.status === 'bounced' && prev.has(i.email) && prev.get(i.email) !== 'bounced') say(tRef.current('se.liveBounced', { email: i.email }));
    const first = !loaded.current;
    loaded.current = true;
    const earlier = first ? inv.map((i) => newRow(i.email, fromDelivery(i.status), true)) : [];
    setRows((rs) => {
      const next = rs.map((r) => {
        const d2 = by.get(key(r.value));
        if (!d2 || !(r.status === 'sent' || r.status === 'bounced' || r.status === 'failed')) return r;
        const st = fromDelivery(d2);
        return st === r.status ? r : { ...r, status: st };
      });
      // reload: earlier invitations on top, read-only (idempotent – safe if the updater runs twice)
      if (!first) return next;
      const have = new Set(next.filter((r) => r.earlier).map((r) => key(r.value)));
      return [...earlier.filter((r) => !have.has(key(r.value))), ...next];
    });
    setB((bs) => bs.map((x) => (x.status === 'sent' && by.get(key(x.email)) === 'bounced' ? { ...x, status: 'bounced' as BSt } : x)));
  }, []);

  const refresh = useCallback(async () => { const { res, data } = await api(''); if (res.ok) apply(data); }, [api, apply]);
  useEffect(() => {
    void refresh(); // one initial load
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return; // paused while hidden
      const inv = invRef.current;
      if (!inv.length) return; // nothing to watch
      if (inv.every((i) => FINAL.has(i.status))) return; // all final
      void refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const left = quota ? Math.min(quota.poll, quota.day, quota.hour) : Infinity;
  const limitMsg = !quota && ipWait === null ? '' : ipWait !== null ? (ipNoHeader ? t('se.limitHour') : t('se.limitIp', { min: ipWait })) : !quota ? '' : quota.day <= 0 ? t('se.limitDay') : quota.hour <= 0 ? t('se.limitHour') : quota.poll <= 0 ? t('se.limitPoll') : '';
  const invited = new Set(invitees.map((i) => i.email));

  function check(r: Row, i: number, all: Row[]): { kind: 'invalid' | 'already' | 'pending'; msg?: string } | null {
    if (r.earlier || r.status !== 'idle' && r.status !== 'failed' && r.status !== 'rejected') return null;
    const v = normSe(r.value); if (!v) return null;
    if (!validEmail(v)) return r.touched ? { kind: 'invalid', msg: t('se.invalid') } : { kind: 'pending' };
    if (invited.has(key(v))) return { kind: 'already', msg: `${t('se.already')} – ${t('se.alreadyHint')}` };
    const j = all.findIndex((o, k) => k < i && !o.earlier && normSe(o.value) && key(o.value) === key(v));
    if (j > -1) return { kind: 'already', msg: `${t('se.already')} – ${t('se.dupRow', { n: j + 1 - all.filter((o) => o.earlier).length })}` };
    return null;
  }
  const upd = (id: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const focus = (sel: string) => setTimeout(() => rootRef.current?.querySelector<HTMLElement>(sel)?.focus(), 0);

  async function send(r: Row) {
    const i = rows.findIndex((x) => x.id === r.id);
    const value = normSe(r.value);
    if (r.status === 'failed' && invited.has(key(value))) { // stored but failed → retry (no new token), one call
      upd(r.id, { status: 'sending' });
      try {
        const { res, data } = await api('/retry', { method: 'POST', body: JSON.stringify({ emails: [value] }) });
        if (data.remaining) setQuota(data.remaining); if (res.ok) apply(data);
        const st = (data.results as { status: string }[] | undefined)?.[0]?.status;
        if (isIpLimit(res.status, data)) startIpWait(parseRetryAfter(res.headers.get('Retry-After')));
        upd(r.id, { status: st === 'sent' ? 'sent' : st === 'blocked' ? 'rejected' : 'failed' });
        say(st === 'sent' ? t('se.liveSent', { email: value }) : st === 'blocked' ? `${t('se.blocked')}: ${value}` : t('se.liveFailed', { email: value }));
      } catch { upd(r.id, { status: 'failed' }); say(t('se.liveFailed', { email: value })); }
      return;
    }
    const c = check({ ...r, value, touched: true }, i, rows);
    if (r.status === 'sending' || limitMsg || !validEmail(value) || (c && c.kind !== 'pending')) { upd(r.id, { touched: true, value }); return; }
    upd(r.id, { status: 'sending', value, touched: true });
    try {
      const { res, data } = await api('', { method: 'POST', body: JSON.stringify({ recipients: [value], message: message.trim() || undefined, locale }) });
      if (res.ok) {
        apply(data);
        const st = (data.results as { email: string; status: string }[] | undefined)?.find((x) => x.email === key(value))?.status;
        if (st === 'blocked') { upd(r.id, { status: 'rejected' }); say(`${t('se.blocked')}: ${value}`); focus(`#se-i${r.id}`); return; }
        if (st === 'failed') { upd(r.id, { status: 'failed' }); say(t('se.liveFailed', { email: value })); return; }
        sentHere.current++;
        setRows((rs) => {
          const next = rs.map((x) => (x.id === r.id ? { ...x, status: 'sent' as St } : x));
          const nx = next.find((o) => o.status === 'idle' && !o.earlier && !normSe(o.value));
          focus(nx ? `#se-i${nx.id}` : '#se-more');
          return next;
        });
        say(t('se.liveSent', { email: value }));
      } else {
        if (data.remaining) setQuota(data.remaining); else void refresh();
        if (isIpLimit(res.status, data)) startIpWait(parseRetryAfter(res.headers.get('Retry-After'))); // §46.9: local countdown, no auto-resend
        upd(r.id, { status: data.code === 'already_invited' || data.code === 'no_new_recipients' ? 'idle' : 'failed' });
        if (data.code === 'no_new_recipients') void refresh();
        say(t('se.liveFailed', { email: value }));
      }
    } catch { upd(r.id, { status: 'failed' }); say(t('se.liveFailed', { email: value })); }
  }

  function more() {
    const idle = rows.filter((r) => !r.earlier && r.status === 'idle').length;
    const n = Math.min(5, Math.max(0, left - idle));
    if (!n) return;
    const add = Array.from({ length: n }, () => newRow());
    setRows((rs) => [...rs, ...add]); focus(`#se-i${add[0].id}`); say(t('se.liveRows'));
  }

  // ===== Phase 2: "Indsæt mange" =====
  const classify = (list: BItem[]) => {
    // sent chips (also shown in this view) count as "already invited", not as duplicates
    const m = new Map<number, Kind>(); const sentK = new Set(list.filter((x) => x.status).map((x) => key(x.email))); const seen = new Set<string>();
    for (const x of list) if (!x.status) {
      const k = key(x.email);
      m.set(x.id, !validEmail(x.email) ? 'invalid' : seen.has(k) ? 'dup' : (seen.add(k), invited.has(k) || sentK.has(k)) ? 'already' : 'valid');
    }
    return m;
  };
  const kinds = classify(B);
  const kindOf = (x: BItem) => x.status || kinds.get(x.id)!;
  const c = { valid: 0, invalid: 0, dup: 0, already: 0, sent: 0, failed: 0, blocked: 0 };
  for (const x of B) { if (x.status === 'sent' || x.status === 'bounced') c.sent++; else if (x.status === 'failed') c.failed++; else if (x.status === 'blocked') c.blocked++; else if (!x.status) c[kinds.get(x.id)!]++; }
  const bulkLimit = (n: number) => {
    if (limitMsg) return limitMsg;
    const pollL = Math.max(0, quota?.poll ?? Infinity), dayL = Math.max(0, quota?.day ?? Infinity), hourL = Math.max(0, quota?.hour ?? Infinity);
    if (n > 50) return t('se.max50', { n: n - 50 });
    if (n > dayL && dayL <= hourL) return t('se.quotaDay', { n: dayL, m: n - dayL });
    if (n > hourL) return t('app.seQuotaHour', { n: hourL, m: n - hourL }); // L7: hour limit has its own message
    if (n > pollL) return t('se.quotaPoll', { n: pollL, m: n - pollL });
    return '';
  };
  const bulkErr = busy || !c.valid ? '' : bulkLimit(c.valid);
  const toItems = (text: string): BItem[] => splitBulkNamed(text).map((x) => ({ id: ++uid, raw: x.raw, email: normSe(x.email), ...(x.name ? { name: x.name } : {}), status: '' as BSt }));
  const addBulk = (text: string) => { const items = toItems(text); if (items.length) setB((bs) => [...bs, ...items]); };
  const removable = (y: BItem) => !(y.status === 'sent' || y.status === 'sending' || y.status === 'bounced');
  /** L8: after removing a chip, focus stays in the list (next removable chip, else previous, else the field). */
  const removeChip = (id: number) => {
    const i = B.findIndex((y) => y.id === id);
    const nx = B.slice(i + 1).find(removable) ?? B.slice(0, i).reverse().find(removable);
    setB((bs) => bs.filter((y) => y.id !== id));
    requestAnimationFrame(() => requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>(nx ? `[data-brm="${nx.id}"]` : '#se-bulk')?.focus()));
    say(t('se.remove', { email: B[i]?.email ?? '' }));
  };
  const flushBulk = () => { if (bulkText.trim()) { addBulk(bulkText); setBulkText(''); } };
  const summary = (res: { status: string }[]) => {
    const n = (s: string) => res.filter((x) => x.status === s).length;
    say([t('se.sumSent', { n: n('sent') }), n('failed') && t('se.sumFailed', { n: n('failed') }), n('blocked') && t('se.sumBlocked', { n: n('blocked') })].filter(Boolean).join(', '));
  };
  async function bulkCall(list: BItem[], retry: boolean) {
    if (!list.length) return;
    const ids = new Set(list.map((x) => x.id));
    setBusy(true); setB((bs) => bs.map((x) => (ids.has(x.id) ? { ...x, status: 'sending' } : x))); say(t('se.sendingN', { n: list.length }));
    let res: Response | null = null; let data: Record<string, unknown> = {};
    try {
      ({ res, data } = await api(retry ? '/retry' : '', { method: 'POST', body: JSON.stringify(retry ? { emails: list.map((x) => key(x.email)) } : { recipients: list.map((x) => (x.name ? `"${x.name.replace(/[\\"]/g, '\\$&')}" <${x.email}>` : x.email)), message: message.trim() || undefined, locale }) }));
    } catch { /* network → all failed */ }
    const results = (data.results as { email: string; status: string }[] | undefined) ?? [];
    const by = new Map(results.map((r) => [r.email, r.status]));
    if (data.remaining) setQuota(data.remaining as Quota);
    if (isIpLimit(res?.status, data)) startIpWait(parseRetryAfter(res!.headers.get('Retry-After')));
    const final = list.map((x) => { const s = res?.ok ? by.get(key(x.email)) : undefined; return { id: x.id, status: (s === 'sent' || s === 'not_failed' ? 'sent' : s === 'blocked' ? 'blocked' : 'failed') as BSt }; });
    const fm = new Map(final.map((f) => [f.id, f.status]));
    setB((bs) => bs.map((x) => (fm.has(x.id) ? { ...x, status: fm.get(x.id)! } : x)));
    setBusy(false);
    if (res?.ok) apply(data as { invitations?: Invitee[] }); else void refresh();
    summary(final);
    focus(final.some((f) => f.status === 'failed') ? '#se-bretry' : '#se-bulk');
  }
  function setMode(m: 'rows' | 'bulk') {
    if (m === mode || busy) return;
    try { localStorage.setItem(MODE_KEY, m); } catch { /* ignore */ }
    setNotice('');
    if (m === 'bulk') {
      // unsent rows move to chips; sent rows (incl. earlier) stay as rows AND appear as green chips (§46.7 "sendte vises i begge")
      const isSentRow = (r: Row) => r.earlier || r.status === 'sent' || r.status === 'bounced';
      const carry = rows.filter((r) => !isSentRow(r) && normSe(r.value));
      const sentRows = rows.filter((r) => isSentRow(r) && normSe(r.value));
      setB((bs) => {
        const have = new Set(bs.filter((x) => x.status).map((x) => key(x.email)));
        const copies = sentRows.filter((r) => !have.has(key(r.value))).map((r) => ({ id: ++uid, raw: r.value, email: normSe(r.value), status: (r.status === 'bounced' ? 'bounced' : r.status === 'failed' ? 'failed' : 'sent') as BSt }));
        return [...copies, ...bs, ...carry.map((r) => ({ id: ++uid, raw: r.value, email: normSe(r.value), status: (r.status === 'rejected' ? 'blocked' : r.status === 'idle' ? '' : r.status) as BSt }))];
      });
      setRows((rs) => { const e = rs.filter(isSentRow); return [...e, ...Array.from({ length: 5 }, () => newRow())]; });
      if (bulkText.trim()) flushBulk();
      focus('#se-bulk');
    } else {
      const all = bulkText.trim() ? [...B, ...toItems(bulkText)] : B;
      const seen = new Set<string>(); let nd = 0; const keep: BItem[] = [];
      for (const x of all) { const k = key(x.email); if (!x.status && seen.has(k)) { nd++; continue; } seen.add(k); keep.push(x); }
      setBulkText('');
      // sent/bounced chips stay in the bulk view as well (shown in both); only unsent chips move to rows
      setB(keep.filter((x) => x.status === 'sent' || x.status === 'bounced'));
      setRows((rs) => {
        const e = rs.filter((r) => r.earlier || normSe(r.value));
        const rowKeys = new Set(e.map((r) => key(r.value)));
        const moved = keep.filter((x) => !((x.status === 'sent' || x.status === 'bounced') && rowKeys.has(key(x.email)))).map((x) => { const r = newRow(x.email || x.raw, (x.status === 'blocked' ? 'rejected' : x.status === '' || x.status === 'sending' ? 'idle' : x.status) as St); return r; });
        const n = [...e, ...moved];
        const idle = n.filter((r) => !r.earlier && r.status === 'idle').length;
        return [...n, ...Array.from({ length: Math.max(1, 5 - idle) }, () => newRow())];
      });
      if (nd) setNotice(t('se.dupsRemoved', { n: nd }));
      focus('.se-row:not(.is-done) input');
    }
    setModeS(m);
  }

  const idleCount = rows.filter((r) => !r.earlier && r.status === 'idle').length;
  const showMore = !limitMsg && idleCount < left;
  const pmLen = graphemes(message);
  let lineNo = 0;

  return (
    <section className="se" id="se" aria-labelledby="se-h" ref={rootRef}>
      <div className="se-head">
        <button type="button" className="se-toggle" id="se-toggle" aria-controls="se-body" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="se-toggle__icon" aria-hidden="true">✉</span>
          <span><span className="se-title" id="se-h">{t('se.title')}</span><span className="se-sub">{t('se.subtitle')}</span></span>
          <span className="se-caret" aria-hidden="true">▾</span>
        </button>
      </div>
      <div id="se-body" hidden={!open}>
        <p className="se-note"><span aria-hidden="true">🔒</span> {t('se.neverAdmin')} {quota && <span className="meta" id="se-left">{t('se.remaining', { n: quota.poll })}</span>}</p>
        <p className="se-note" id="se-linknote">{t('se.linkNote')}</p>
        {quota && <p className="se-note" id="se-quota" aria-live="polite">{t('se.quotaHint', { poll: quota.poll, day: quota.day, hour: quota.hour })}</p>}
        <div id="se-limit">{limitMsg && <p className="se-limit" role="alert"><span aria-hidden="true">{'⛔'}</span> {limitMsg}</p>}</div>
        <div className="se-mode" role="group" aria-label={t('se.modeLabel')}>
          <button type="button" data-mode="rows" aria-pressed={mode === 'rows'} onClick={() => setMode('rows')}>{t('se.modeOne')}</button>
          <button type="button" data-mode="bulk" aria-pressed={mode === 'bulk'} onClick={() => setMode('bulk')}>{t('se.modeMany')}</button>
        </div>
        <button type="button" className="link-btn se-pm-toggle" id="se-pm-toggle" aria-expanded={pmOpen} aria-controls="se-pm"
          onClick={() => { setPmOpen(!pmOpen); if (!pmOpen) focus('#se-pmsg'); }}>{'+ '}{t('se.pmsgToggle')}</button>
        <div className="field se-pm" id="se-pm" hidden={!pmOpen}>
          <label className="field__label" htmlFor="se-pmsg">{t('inv.pmsg')}</label>
          <textarea className="input" id="se-pmsg" rows={2} placeholder={t('inv.pmsgPh')} aria-describedby="se-pcount" value={message} onChange={(e) => setMessage(e.target.value)} aria-invalid={pmLen > MESSAGE_MAX} />
          <div className="field__meta"><span className="counter" id="se-pcount">{t('common.counter', { n: pmLen, max: MESSAGE_MAX })}</span></div>
        </div>
        <div id="se-rowsview" hidden={mode !== 'rows'}>
          <p className="se-notice" id="se-notice" role="status" hidden={!notice}>{notice}</p>
          <ol className="se-rows" id="se-rows" aria-labelledby="se-h">
            {rows.map((r, i) => {
              if (!r.earlier) lineNo++;
              const n = r.earlier ? i + 1 : lineNo;
              const c = check(r, i, rows);
              const ro = r.earlier || r.status === 'sent' || r.status === 'sending' || r.status === 'bounced';
              const bad = c?.kind === 'invalid' || r.status === 'failed' || r.status === 'bounced' || r.status === 'rejected';
              const warn = c?.kind === 'already';
              const lim = !!limitMsg && r.status !== 'sent';
              const v = normSe(r.value);
              const dis = !v || (!!c && c.kind !== 'pending') || !validEmail(v) || lim || r.status === 'rejected';
              return (
                <li key={r.id} className={`se-row${ro ? ' is-done' : ''}${bad ? ' is-bad' : ''}${warn ? ' is-warn' : ''}`} data-row={r.id} data-status={r.earlier ? 'earlier' : r.status}>
                  <label className="sr-only" htmlFor={`se-i${r.id}`}>{t('se.emailLabel', { n })}</label>
                  <div className="se-row__line">
                    <input className="input se-input" id={`se-i${r.id}`} type="email" inputMode="email" autoComplete="off" spellCheck={false}
                      value={r.value} placeholder={i === 0 ? t('se.emailPh') : ''} aria-describedby={`se-s${r.id}`} readOnly={ro} aria-invalid={bad || undefined}
                      onChange={(e) => upd(r.id, { value: e.target.value, status: r.status === 'rejected' || r.status === 'failed' ? 'idle' : r.status })}
                      onBlur={(e) => { if (!r.touched && r.value.trim() && (e.relatedTarget as HTMLElement | null)?.dataset?.send !== String(r.id)) upd(r.id, { touched: true, value: normSe(r.value) }); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (r.status !== 'sent' && !ro) void send(r); } }} />
                    <span className="se-btnwrap">
                      {r.status === 'sending' ? <button type="button" className="btn btn--secondary btn--sm se-btn" disabled aria-busy="true"><span className="spinner" aria-hidden="true" /> {t('se.sending')}</button>
                        : r.status === 'bounced' ? <button type="button" className="btn btn--sm se-btn se-btn--bounced" disabled>{'⊘ '}{t('se.bouncedBtn')}</button>
                        : r.status === 'failed' ? <button type="button" className="btn btn--secondary btn--sm se-btn" data-send={r.id} disabled={lim} onClick={() => send(r)}>{t('se.retry')}</button>
                        : r.status === 'sent' || r.earlier ? <button type="button" className="btn btn--sm se-btn se-btn--done" disabled>{t('se.sent')}</button>
                        : <button type="button" className="btn btn--secondary btn--sm se-btn" data-send={r.id} disabled={dis} aria-label={t('se.sendAria', { n })} onClick={() => send(r)}>{t('se.send')}</button>}
                    </span>
                  </div>
                  <div className="se-row__st" id={`se-s${r.id}`} aria-live="off">
                    {r.earlier && r.status === 'sent' ? <span className="se-st se-st--sent">✓ {t('se.sentEarlier')}</span>
                      : r.status === 'failed' ? <span className="se-st se-st--err"><strong>{t('se.failed')}</strong> – {t('se.failedWhy')}</span>
                      : r.status === 'bounced' ? <span className="se-st se-st--err">{'⊘ '}{t('se.bounced')}</span>
                      : r.status === 'rejected' ? <span className="se-st se-st--err">– {t('se.blocked')}</span>
                      : c?.msg ? <span className={`se-st ${c.kind === 'invalid' ? 'se-st--err' : 'se-st--warn'}`}>{c.kind === 'invalid' ? '!' : '↺'} {c.msg}</span> : null}
                  </div>
                </li>
              );
            })}
          </ol>
          <button type="button" className="btn btn--ghost btn--sm" id="se-more" aria-label={t('se.moreAria')} hidden={!showMore} onClick={more}>{'+ '}{t('se.more')}</button>
        </div>
        <div id="se-bulkview" hidden={mode !== 'bulk'}>
          <div className="field">
            <label className="field__label" htmlFor="se-bulk">{t('se.bulkLabel')}</label>
            <textarea className="input se-bulk" id="se-bulk" rows={3} spellCheck={false} placeholder={t('se.bulkPh')} aria-describedby="se-bulk-hint se-bulk-err"
              value={bulkText} disabled={busy}
              onPaste={(e) => { e.preventDefault(); addBulk(bulkText + ' ' + e.clipboardData.getData('text')); setBulkText(''); }}
              onChange={(e) => { const v = e.target.value; if (/[;,\n]\s*$/.test(v)) { addBulk(v); setBulkText(''); } else setBulkText(v); }}
              onBlur={flushBulk}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { // §46.7: parse + send
                  e.preventDefault();
                  const all = bulkText.trim() ? [...B, ...toItems(bulkText)] : B;
                  if (all !== B) { setB(all); setBulkText(''); }
                  const k = classify(all); const v = all.filter((x) => !x.status && k.get(x.id) === 'valid');
                  if (v.length && !busy && !bulkLimit(v.length)) void bulkCall(v, false);
                }
                else if (e.key === 'Backspace' && !bulkText) { const last = [...B].reverse().find(removable); if (last) { e.preventDefault(); setB((bs) => bs.filter((y) => y.id !== last.id)); say(t('se.remove', { email: last.email })); } } // L5
              }} />
            <p className="field__hint" id="se-bulk-hint">{t('se.bulkHint').replace(/&lt;/g, '<').replace(/&gt;/g, '>')}</p>
          </div>
          <div id="se-bulk-sum" className="se-sum" aria-live="polite">
            {!B.length ? <span className="meta">{t('se.bulkEmpty')}</span> : [
              c.sent ? <span key="s" className="ok">{'✓ '}{t('se.sumSent', { n: c.sent })}</span> : null,
              c.failed ? <span key="f" className="err">{t('se.sumFailed', { n: c.failed })}</span> : null,
              c.valid || !(c.sent + c.failed + c.blocked) ? <strong key="v">{t('se.sumValid', { n: c.valid })}</strong> : null,
              c.invalid ? <span key="i" className="err">{t('se.sumInvalid', { n: c.invalid })}</span> : null,
              c.dup ? <span key="d" className="warn">{t('se.sumDup', { n: c.dup })}</span> : null,
              c.already ? <span key="a" className="warn">{t('se.sumAlready', { n: c.already })}</span> : null,
              c.blocked ? <span key="b" className="err">{t('se.sumBlocked', { n: c.blocked })}</span> : null,
            ].filter(Boolean).flatMap((el, i) => (i ? [<span key={`sep${i}`} aria-hidden="true">{' · '}</span>, el] : [el]))}
          </div>
          <div className="field__error" id="se-bulk-err" role="alert">{limitMsg ? '' : bulkErr}</div>
          <ul className="se-blist" id="se-blist" aria-label={t('se.bulkLabel')}>
            {B.map((x) => {
              const k = kindOf(x);
              const cls = ({ valid: '', invalid: 'err', dup: 'warn', already: 'warn', blocked: 'err', sent: 'ok', sending: '', failed: 'err', bounced: 'err' } as Record<string, string>)[k];
              return (
                <li key={x.id} className={`se-bitem se-bitem--${k}`} data-kind={k}>
                  <span className="se-bitem__addr">{x.name ? <><span className="se-bitem__name">{x.name}</span>{' '}<span className="meta">{x.email}</span></> : (x.email || x.raw)}</span>
                  {k !== 'valid' && <span className={`se-badge se-badge--${cls}`}>{k === 'sending' && <span className="spinner" aria-hidden="true" />}{k === 'sending' ? ' ' : ''}{t(`se.why.${k}` as 'se.why.invalid')}</span>}
                  {!(x.status === 'sent' || x.status === 'sending' || x.status === 'bounced' || busy) &&
                    <button type="button" className="se-x" data-brm={x.id} aria-label={t('se.remove', { email: x.email || x.raw })}
                      onClick={() => removeChip(x.id)}>{'✕'}</button>}
                </li>
              );
            })}
          </ul>
          <div id="se-progress">{busy && <p className="se-prog"><span className="spinner" aria-hidden="true" />{' '}{t('se.sendingN', { n: B.filter((x) => x.status === 'sending').length })}</p>}</div>
          <div className="se-bulk-actions">
            <button type="button" className="btn btn--primary btn--sm" id="se-bsend" hidden={busy || (!c.valid && c.sent + c.failed + c.blocked > 0)} disabled={busy || !c.valid || !!bulkErr || !!limitMsg}
              onClick={() => { const v = B.filter((x) => !x.status && kinds.get(x.id) === 'valid'); if (!bulkLimit(v.length)) void bulkCall(v, false); }}>{t('se.sendN', { n: c.valid })}</button>
            <button type="button" className="link-btn" id="se-bclean" hidden={busy || !(c.invalid + c.dup + c.already)}
              onClick={() => { setB((bs) => bs.filter((x) => x.status || kinds.get(x.id) === 'valid')); focus('#se-bulk'); }}>{t('se.removeProblems')}</button>
            <button type="button" className="btn btn--secondary btn--sm" id="se-bretry" hidden={busy || !c.failed || !!limitMsg}
              onClick={async () => { const f = B.filter((x) => x.status === 'failed'); const st = f.filter((x) => invited.has(key(x.email))), ns = f.filter((x) => !invited.has(key(x.email))); if (st.length) await bulkCall(st, true); if (ns.length) await bulkCall(ns, false); }}>{t('se.retryFailed')}</button>
          </div>
        </div>
        <p className="privacy se-privacy">{tr('inv.privacy')}</p>
        <p className="se-adminlink"><a href={lp(`/p/${slug}/admin#${token}`)} id="se-admin">{t('se.adminLink')} {'→'}</a></p>
        <p className="sr-only" id="se-live" aria-live="polite">{live}</p>
      </div>
    </section>
  );
}
