import { describe, expect, it, vi } from 'vitest';
import { icsTexts, mailLocale } from '../src/lib/email/render';
import { sanitizeDisplayName, createMailer, dateLabels, planInvitations, planReminders, renderInvitation, renderReminder, pollEmailData, assertPublicOnly, type PollForEmail } from '../src/lib/email';

const poll: PollForEmail = {
  slug: 'Gsrire3V9kntecH6ffjlqA', title: 'Teammøde <script>alert(1)</script> & kage', description: 'Lokale 3', isClosed: false,
  organizerName: 'Mette Hansen', locale: 'da',
  options: [{ date: '2026-10-16' }, { date: '2026-10-14' }, { date: '2026-11-03' }],
};
const ctx = { appUrl: 'https://grabaday.com/' };
const ADMIN_TOKEN = 'A'.repeat(43);

describe('email templates (the design spec (doodle-ui))', () => {
  it('date polls: one plain date label per option, sorted, no times / time zone', () => {
    expect(dateLabels(poll.options, 'da')).toEqual([
      { dateLabel: 'ons. 14. okt. 2026' }, { dateLabel: 'fre. 16. okt. 2026' }, { dateLabel: 'tirs. 3. nov. 2026' }]);
    const r = renderInvitation(pollEmailData(poll, { email: 'a@b.dk', linkToken: 'T'.repeat(43) }, ctx));
    expect(r.text).toContain('  - fre. 16. okt. 2026');
    expect(r.text + r.html).not.toMatch(/tidszone|Europe\/Copenhagen|\d\d:\d\d/);
  });

  it('reminder footer follows tracking: all non-unsubscribed vs. only those who have not answered', () => {
    const inv = { email: 'a@b.dk', linkToken: 'T'.repeat(43) };
    const off = renderReminder(pollEmailData(poll, inv, ctx));
    expect(off.text).toContain('Påmindelser sendes til alle inviterede, der ikke har afmeldt sig.');
    const on = renderReminder(pollEmailData({ ...poll, trackingEnabled: true }, inv, ctx));
    for (const t of [on.text, on.html]) { expect(t).toContain('endnu ikke har svaret'); expect(t).not.toContain('alle inviterede, der ikke har afmeldt'); }
  });

  it('invitation: subject, escaped HTML, absolute asset + public poll links, text part, Outlook VML button', () => {
    const r = renderInvitation(pollEmailData(poll, { email: 'jan@example.com', name: 'Jan', linkToken: 'T'.repeat(43) }, ctx));
    expect(r.subject).toBe('Mette Hansen inviterer dig: Teammøde <script>alert(1)</script> & kage');
    expect(r.html).not.toContain('<script>alert');
    expect(r.html).toContain('&lt;script&gt;');
    expect(r.html).toContain('https://grabaday.com/email-assets/logo-light@2x.png');
    expect(r.html).toContain('href="https://grabaday.com/da/p/Gsrire3V9kntecH6ffjlqA"');
    expect(r.html).toMatch(/v:roundrect/);
    expect(r.html).toContain('Hej Jan!');
    expect(r.text).toContain('https://grabaday.com/da/p/Gsrire3V9kntecH6ffjlqA');
    expect(r.text).toContain('ons. 14. okt. 2026');
    expect(r.text).toContain('Teammøde <script>alert(1)</script> & kage'); // plain text is not HTML-escaped
  });

  it('reminder: subject with deadline, responded count', () => {
    const r = renderReminder(pollEmailData({ ...poll, deadline: new Date('2026-10-16T10:00:00Z'), respondedCount: 4 }, { email: 'a@b.dk', linkToken: 'T'.repeat(43) }, ctx));
    expect(r.subject).toBe('Påmindelse: Teammøde <script>alert(1)</script> & kage – lukker fredag 16. oktober kl. 12.00');
    expect(r.text).toContain('4 har svaret indtil nu');
    expect(r.text).toContain('Har du svaret?');
  });

  it('long titles are clipped to 60 graphemes in the subject; newlines never reach the subject', () => {
    const r = renderInvitation(pollEmailData({ ...poll, title: '👨‍👩‍👧'.repeat(70) + '\nBcc: x@y.z' }, { email: 'a@b.dk', linkToken: 'T'.repeat(43) }, ctx));
    expect(r.subject).not.toMatch(/[\r\n]/);
    expect([...new Intl.Segmenter('da', { granularity: 'grapheme' }).segment(r.subject.split(': ')[1])].length).toBe(60);
  });

  it('rule: only the public /p/<id> link – admin/edit links are rejected', () => {
    const d = pollEmailData(poll, { email: 'a@b.dk', linkToken: 'T'.repeat(43) }, ctx);
    expect(() => renderInvitation({ ...d, pollUrl: `https://grabaday.com/da/p/x/admin#${ADMIN_TOKEN}` })).toThrow(/public/);
    expect(() => renderInvitation({ ...d, pollUrl: `https://grabaday.com/da/p/x#edit=${ADMIN_TOKEN}` })).toThrow(/public/);
    expect(() => renderInvitation({ ...d, description: `se https://grabaday.com/da/p/x/admin#${ADMIN_TOKEN}` })).toThrow(/admin\/edit/);
    expect(() => assertPublicOnly(d)).not.toThrow();
  });
});

describe('email policy', () => {
  const invitees = [
    { email: 'Jan@Example.com', name: 'Jan', linkToken: 'J'.repeat(43) },
    { email: 'jan@example.com', linkToken: 'X'.repeat(43) }, // duplicate (case-insensitive)
    { email: 'nope', linkToken: 'X'.repeat(43) },
    { email: 'gone@example.com', linkToken: 'X'.repeat(43), unsubscribedAt: new Date() },
    { email: 'done@example.com', linkToken: 'D'.repeat(43) },
    { email: 'bounce@example.com', linkToken: 'B'.repeat(43), bounced: true },
  ];

  it('invitations: one message per recipient, no replyTo, idempotency invite:<poll>:<email>, List-Unsubscribe', () => {
    const p = planInvitations(poll, invitees, ctx);
    expect(p.messages.map((m) => m.to)).toEqual(['Jan@Example.com', 'done@example.com']);
    const m = p.messages[0];
    expect(m.replyTo).toBeUndefined();
    expect(m.idempotencyKey).toBe(`invite:${poll.slug}:jan@example.com`);
    expect(m.headers).toEqual({ 'List-Unsubscribe': `<https://grabaday.com/api/u/p/${'J'.repeat(43)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
    for (const u of [`/u/p/${'J'.repeat(43)}`, `/u/all/${'J'.repeat(43)}`, `/abuse/${'J'.repeat(43)}`]) { expect(m.html).toContain(`https://grabaday.com/da${u}`); expect(m.text).toContain(`https://grabaday.com/da${u}`); }
    expect(p.skipped.map((s) => s.reason)).toEqual(['duplicate', 'invalid_email', 'unsubscribed', 'bounced']);
  });

  it('reminders: all non-unsubscribed invitees; per poll max one per 24 h, max 3 total, none after close', () => {
    const now = new Date('2026-10-12T12:00:00Z');
    const p = planReminders(poll, invitees, ctx, now);
    expect(p.blocked).toBeNull();
    expect(p.messages.map((m) => m.to)).toEqual(['Jan@Example.com', 'done@example.com']);
    expect(p.messages[0].idempotencyKey).toBe(`reminder:${poll.slug}:jan@example.com`);
    expect(p.skipped.map((s) => s.reason)).toEqual(['duplicate', 'invalid_email', 'unsubscribed', 'bounced']);
    const h = (n: number) => new Date(now.getTime() - n * 3600_000);
    expect(planReminders({ ...poll, isClosed: true }, invitees, ctx, now)).toMatchObject({ blocked: 'closed', messages: [] });
    expect(planReminders({ ...poll, remindersSent: 1, lastReminderAt: h(23) }, invitees, ctx, now)).toMatchObject({ blocked: 'too_soon', messages: [] });
    expect(planReminders({ ...poll, remindersSent: 2, lastReminderAt: h(25) }, invitees, ctx, now).blocked).toBeNull();
    expect(planReminders({ ...poll, remindersSent: 3, lastReminderAt: h(100) }, invitees, ctx, now)).toMatchObject({ blocked: 'limit_reached', messages: [] });
    expect(planInvitations({ ...poll, isClosed: true }, invitees, ctx).messages).toEqual([]);
  });

  it('no planned message ever contains an admin/edit link', () => {
    for (const m of [...planInvitations(poll, invitees, ctx).messages, ...planReminders(poll, invitees, ctx).messages]) {
      expect(`${m.html}${m.text}`).not.toMatch(/\/admin|edit=/);
    }
  });
});

describe('adapter: headers, replyTo override, batch', () => {
  const env = { EMAIL_MODE: 'send', RESEND_API_KEY: 're_x_secret_key_123456', EMAIL_FROM: 'grabAday <noreply@grabaday.com>', EMAIL_REPLY_TO: 'hej@grabaday.com' };
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
    expect(r).toMatchObject([{ ok: true, mode: 'log' }]);
    expect(f).not.toHaveBeenCalled();
  });
});

describe('From display name (organizer)', () => {
  it('sanitizes against header injection and spoofing', () => {
    expect(sanitizeDisplayName('Mette "Boss" <ceo@bank.dk>\r\nBcc: x@y.z')).toBe('Mette Boss Bcc');
    expect(sanitizeDisplayName('Jan\u202Eknab www.evil.com https://x.y/z paypal.com')).toBe('Jan knab');
    expect(sanitizeDisplayName('A'.repeat(80))).toHaveLength(50);
    expect(sanitizeDisplayName('Ærø-Søren 😀')).toBe('Ærø-Søren 😀');
  });
  it('From = "<name> via grabAday" <EMAIL_FROM address>; app name only without organizer name', async () => {
    const f = vi.fn(async () => new Response('{"id":"1"}'));
    const m = createMailer({ env: { EMAIL_MODE: 'send', RESEND_API_KEY: 'k', EMAIL_FROM: 'grabAday <noreply@grabaday.com>' }, fetch: f as never, log: () => {} });
    const [withName] = planInvitations({ ...poll, organizerFromName: 'Mette <x@y.z>' }, [{ email: 'a@b.dk', linkToken: 'T'.repeat(43) }], ctx).messages;
    const [noName] = planInvitations(poll, [{ email: 'a@b.dk', linkToken: 'T'.repeat(43) }], ctx).messages;
    await m.send(withName); await m.send(noName);
    const froms = (f.mock.calls as unknown as [string, RequestInit][]).map((c) => JSON.parse(String(c[1].body)).from);
    expect(froms).toEqual(['"Mette via grabAday" <noreply@grabaday.com>', '"grabAday" <noreply@grabaday.com>']);
  });
});

describe('i18n phase 4: mails per language', () => {
  const inv = { email: 'a@b.dk', linkToken: 'T'.repeat(43) };
  it('recipient locale → poll locale → en; links are APP_URL/<locale>/…', () => {
    expect(mailLocale('fr', 'da')).toBe('fr'); expect(mailLocale(undefined, 'de')).toBe('de'); expect(mailLocale('xx', null)).toBe('en');
    const d = pollEmailData({ ...poll, locale: 'da' }, { ...inv, locale: 'de' }, ctx);
    expect(d.pollUrl).toBe('https://grabaday.com/de/p/Gsrire3V9kntecH6ffjlqA');
    expect(d.unsubscribePollUrl).toBe(`https://grabaday.com/de/u/p/${'T'.repeat(43)}`);
    expect(d.unsubscribeAllUrl).toMatch(/^https:\/\/grabaday\.com\/de\/u\/all\//);
    expect(d.reportAbuseUrl).toMatch(/^https:\/\/grabaday\.com\/de\/abuse\//);
    expect(pollEmailData({ ...poll, locale: undefined }, inv, ctx).pollUrl).toMatch(/\/en\/p\//);
  });
  it.each([
    ['en', 'Mette Hansen invites you: ', 'Wed, Oct 14, 2026', 'lang="en"', 'Mette Hansen via grabAday'],
    ['da', 'Mette Hansen inviterer dig: ', 'ons. 14. okt. 2026', 'lang="da"', 'Mette Hansen via grabAday'],
    ['fr', 'Mette Hansen vous invite', 'mer. 14 oct. 2026', 'lang="fr"', 'Mette Hansen via grabAday'],
    ['de', 'Mette Hansen lädt Sie ein', 'Mi., 14. Okt. 2026', 'lang="de"', 'Mette Hansen via grabAday'],
  ])('%s: subject, template, dates, From', (l, subj, date, lang, from) => {
    const plan = planInvitations({ ...poll, locale: l, organizerFromName: 'Mette Hansen' }, [inv], ctx);
    const m = plan.messages[0];
    expect(m.subject.startsWith(subj)).toBe(true);
    expect(m.html).toContain(lang);
    expect(m.html!.replace(/\u00a0/g, ' ')).toContain(date);
    expect(m.text).toContain(`https://grabaday.com/${l}/p/`);
    expect(m.fromName).toBe(from);
  });
  it('reminder subject + organizer fallback per language', () => {
    const r = planReminders({ ...poll, locale: 'en', organizerName: '' }, [inv], ctx).messages[0];
    expect(r.subject).toMatch(/^Reminder: /);
    expect(r.html).toContain('The organizer');
  });
  it('.ics texts per language', () => {
    expect(icsTexts('Møde', 'https://grabaday.com/da/p/x', 'da').description).toBe('Endelig dato valgt i grabAday: https://grabaday.com/da/p/x');
    expect(icsTexts('Meet', 'u', 'de').description).toMatch(/grabAday/);
    expect(icsTexts('Meet', 'u', 'zz').description).toBe('Final date chosen in grabAday: u');
  });
});
