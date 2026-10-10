import { describe, expect, it, vi } from 'vitest';
import { createMailer, groupDates, planInvitations, planReminders, renderInvitation, renderReminder, pollEmailData, assertPublicOnly, type PollForEmail } from '../src/lib/email';

const poll: PollForEmail = {
  slug: 'Gsrire3V9kntecH6ffjlqA', title: 'Teammøde <script>alert(1)</script> & kage', description: 'Lokale 3', isClosed: false,
  organizerName: 'Mette Hansen', organizerEmail: 'mette@example.com',
  options: [
    { startAt: new Date('2026-10-16T13:00:00Z'), endAt: new Date('2026-10-16T14:00:00Z') },
    { startAt: new Date('2026-10-14T07:00:00Z'), endAt: new Date('2026-10-14T08:00:00Z') },
    { startAt: new Date('2026-10-14T21:30:00Z'), endAt: new Date('2026-10-14T22:30:00Z') },
    { startAt: new Date('2026-10-15T08:30:00Z'), endAt: null },
  ],
};
const ctx = { appUrl: 'https://moedetid.dk/' };
const ADMIN_TOKEN = 'A'.repeat(43);

describe('email templates (Doodle UI)', () => {
  it('Danish 24 h grouping in Europe/Copenhagen, sorted, +1 dag across midnight', () => {
    expect(groupDates(poll.options)).toEqual([
      { dateLabel: 'Onsdag 14. oktober 2026', slots: [{ timeLabel: '09:00–10:00' }, { timeLabel: '23:30–00:30 (+1 dag)' }] },
      { dateLabel: 'Torsdag 15. oktober 2026', slots: [{ timeLabel: '10:30' }] },
      { dateLabel: 'Fredag 16. oktober 2026', slots: [{ timeLabel: '15:00–16:00' }] },
    ]);
  });

  it('invitation: subject, escaped HTML, absolute asset + public poll links, text part, Outlook VML button', () => {
    const r = renderInvitation(pollEmailData(poll, { email: 'jan@example.com', name: 'Jan' }, ctx));
    expect(r.subject).toBe('Mette Hansen inviterer dig: Teammøde <script>alert(1)</script> & kage');
    expect(r.html).not.toContain('<script>alert');
    expect(r.html).toContain('&lt;script&gt;');
    expect(r.html).toContain('https://moedetid.dk/email-assets/logo-light@2x.png');
    expect(r.html).toContain('href="https://moedetid.dk/p/Gsrire3V9kntecH6ffjlqA"');
    expect(r.html).toMatch(/v:roundrect/);
    expect(r.html).toContain('Hej Jan!');
    expect(r.text).toContain('https://moedetid.dk/p/Gsrire3V9kntecH6ffjlqA');
    expect(r.text).toContain('23:30–00:30 (+1 dag)');
    expect(r.text).toContain('Teammøde <script>alert(1)</script> & kage'); // plain text is not HTML-escaped
  });

  it('reminder: subject with deadline, responded count', () => {
    const r = renderReminder(pollEmailData({ ...poll, deadline: new Date('2026-10-16T10:00:00Z'), respondedCount: 4 }, { email: 'a@b.dk' }, ctx));
    expect(r.subject).toBe('Påmindelse: Teammøde <script>alert(1)</script> & kage – lukker fredag 16. oktober kl. 12:00');
    expect(r.text).toContain('4 har allerede svaret');
  });

  it('long titles are clipped to 60 graphemes in the subject; newlines never reach the subject', () => {
    const r = renderInvitation(pollEmailData({ ...poll, title: '👨‍👩‍👧'.repeat(70) + '\nBcc: x@y.z' }, { email: 'a@b.dk' }, ctx));
    expect(r.subject).not.toMatch(/[\r\n]/);
    expect([...new Intl.Segmenter('da', { granularity: 'grapheme' }).segment(r.subject.split(': ')[1])].length).toBe(60);
  });

  it('rule: only the public /p/<id> link – admin/edit links are rejected', () => {
    const d = pollEmailData(poll, { email: 'a@b.dk' }, ctx);
    expect(() => renderInvitation({ ...d, pollUrl: `https://moedetid.dk/p/x/admin#${ADMIN_TOKEN}` })).toThrow(/public/);
    expect(() => renderInvitation({ ...d, pollUrl: `https://moedetid.dk/p/x#edit=${ADMIN_TOKEN}` })).toThrow(/public/);
    expect(() => renderInvitation({ ...d, description: `se https://moedetid.dk/p/x/admin#${ADMIN_TOKEN}` })).toThrow(/admin\/edit/);
    expect(() => assertPublicOnly(d)).not.toThrow();
  });
});

describe('email policy', () => {
  const invitees = [
    { email: 'Jan@Example.com', name: 'Jan', unsubscribeUrl: 'https://moedetid.dk/u/abc' },
    { email: 'jan@example.com' }, // duplicate (case-insensitive)
    { email: 'nope' },
    { email: 'gone@example.com', unsubscribedAt: new Date() },
    { email: 'done@example.com', respondedAt: new Date() },
    { email: 'twice@example.com', remindedAt: new Date() },
  ];

  it('invitations: one message per recipient, replyTo organizer, idempotency invite:<poll>:<email>, List-Unsubscribe', () => {
    const p = planInvitations(poll, invitees, ctx);
    expect(p.messages.map((m) => m.to)).toEqual(['Jan@Example.com', 'done@example.com', 'twice@example.com']);
    const m = p.messages[0];
    expect(m.replyTo).toBe('mette@example.com');
    expect(m.idempotencyKey).toBe(`invite:${poll.slug}:jan@example.com`);
    expect(m.headers).toEqual({ 'List-Unsubscribe': '<https://moedetid.dk/u/abc>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
    expect(p.messages[1].headers).toBeUndefined();
    expect(p.skipped.map((s) => s.reason)).toEqual(['duplicate', 'invalid_email', 'unsubscribed']);
  });

  it('reminders: only non-responders, max one per recipient, none after close', () => {
    const p = planReminders(poll, invitees, ctx);
    expect(p.messages.map((m) => m.to)).toEqual(['Jan@Example.com']);
    expect(p.messages[0].idempotencyKey).toBe(`reminder:${poll.slug}:jan@example.com`);
    expect(p.skipped.map((s) => s.reason)).toEqual(['duplicate', 'invalid_email', 'unsubscribed', 'responded', 'already_reminded']);
    expect(planReminders({ ...poll, isClosed: true }, invitees, ctx).messages).toEqual([]);
    expect(planInvitations({ ...poll, isClosed: true }, invitees, ctx).messages).toEqual([]);
  });

  it('no planned message ever contains an admin/edit link', () => {
    for (const m of [...planInvitations(poll, invitees, ctx).messages, ...planReminders(poll, invitees, ctx).messages]) {
      expect(`${m.html}${m.text}`).not.toMatch(/\/admin|edit=/);
    }
  });
});

describe('adapter: headers, replyTo override, batch', () => {
  const env = { EMAIL_MODE: 'send', RESEND_API_KEY: 're_x_secret_key_123456', EMAIL_FROM: 'Mødetid <noreply@moedetid.dk>', EMAIL_REPLY_TO: 'hej@moedetid.dk' };
  it('single send forwards headers/tags and organizer replyTo; drops header injection', async () => {
    const f = vi.fn(async () => new Response('{"id":"1"}'));
    const m = createMailer({ env, fetch: f as never, log: () => {} });
    await m.send({ to: 'a@b.dk', subject: 's', text: 't', replyTo: 'mette@example.com', headers: { 'List-Unsubscribe': '<https://x/u>', 'X-Bad': 'a\r\nBcc: e@vil.com' }, tags: [{ name: 'poll', value: 'ab.c' }] });
    const body = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.reply_to).toBe('mette@example.com');
    expect(body.headers).toEqual({ 'List-Unsubscribe': '<https://x/u>' });
    expect(body.tags).toEqual([{ name: 'poll', value: 'ab_c' }]);
  });
  it('batch: ≤100 per call, one recipient per message, per-chunk idempotency, results in order', async () => {
    const f = vi.fn(async (_u: string, i: RequestInit) => new Response(JSON.stringify({ data: JSON.parse(String(i.body)).map((_: unknown, k: number) => ({ id: `id${k}` })) })));
    const m = createMailer({ env, fetch: f as never, log: () => {} });
    const msgs = Array.from({ length: 150 }, (_, i) => ({ to: `u${i}@example.com`, subject: 's', text: 't' }));
    const r = await m.sendBatch([...msgs, { to: ['a@b.dk', 'c@d.dk'], subject: 's', text: 't' }], 'invite:poll');
    expect(f).toHaveBeenCalledTimes(2);
    const calls = f.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][0]).toBe('https://api.resend.com/emails/batch');
    expect(JSON.parse(String(calls[0][1].body))).toHaveLength(100);
    expect((calls[1][1].headers as Record<string, string>)['Idempotency-Key']).toBe('invite:poll:1');
    expect(r.slice(0, 150).every((x) => x.ok)).toBe(true);
    expect(r[150]).toMatchObject({ ok: false, error: 'invalid' }); // shared `to` refused
  });
  it('batch in log mode never calls the provider', async () => {
    const f = vi.fn();
    const r = await createMailer({ env: { EMAIL_MODE: 'log' }, fetch: f as never, log: () => {} }).sendBatch([{ to: 'a@b.dk', subject: 's', text: 't' }]);
    expect(r).toEqual([{ ok: true, mode: 'log' }]);
    expect(f).not.toHaveBeenCalled();
  });
});
