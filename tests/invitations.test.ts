import { describe, test, expect, inject, afterAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { TEST_CRON_SECRET, TEST_WEBHOOK_SECRET } from './global-setup';
import { reserveQuota, emailHash } from '../src/lib/invitations';

const BASE = inject('baseUrl');
const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
const Y = new Date().getUTCFullYear() + 1;
const ip = () => `10.20.${(Math.random() * 255) | 0}.${(Math.random() * 250 + 1) | 0}`;
const uniq = () => Math.random().toString(36).slice(2, 10);
/** Same derivation as the server in log mode (no EMAIL_LINK_SECRET in tests). */
const linkToken = (id: number) => createHmac('sha256', 'dev-only-email-link-secret-not-for-production').update(`moedetid-inv-link-v1:${id}`).digest('base64url');

async function call(path: string, init: RequestInit & { token?: string; json?: unknown } = {}) {
  const headers: Record<string, string> = { 'X-Forwarded-For': ip(), ...(init.headers as Record<string, string>) };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.json !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(BASE + path, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
  const text = await r.text();
  let body: any; try { body = JSON.parse(text); } catch { body = text; } // eslint-disable-line @typescript-eslint/no-explicit-any
  return { status: r.status, body, text, headers: r.headers };
}
async function poll() {
  const r = await call('/api/events', { method: 'POST', json: { title: 'Invitér', options: [{ date: `${Y}-11-03` }] } });
  return { id: r.body.id as string, token: r.body.admin_token as string };
}
const invite = (p: { id: string; token: string }, json: unknown) => call(`/api/events/${p.id}/invitations`, { method: 'POST', token: p.token, json });
const invRow = async (slug: string, email: string) => prisma.invitation.findFirstOrThrow({ where: { email, event: { slug } } });

describe('invitations API (step 4)', () => {
  test('organizer only: 401 without, 403 wrong token; GET has no tokens', async () => {
    const p = await poll();
    expect((await call(`/api/events/${p.id}/invitations`, { method: 'POST', json: { recipients: 'a@b.dk' } })).status).toBe(401);
    expect((await invite({ ...p, token: 'x'.repeat(43) }, { recipients: 'a@b.dk' })).status).toBe(403);
    const r = await invite(p, { recipients: `Anna <anna-${uniq()}@example.com>` });
    expect(r.status).toBe(201);
    expect(r.text).not.toMatch(/link_token|linkTokenHash|provider/i);
    expect(r.text).not.toContain(p.token);
  });

  test('validate + dedupe: invalid → 400, duplicates/already-invited reported, statuses queued→sent', async () => {
    const p = await poll(); const a = `a-${uniq()}@example.com`;
    const bad = await invite(p, { recipients: `${a}\nnot-an-email` });
    expect(bad.status).toBe(400); expect(bad.body.code).toBe('invalid_recipients'); expect(bad.body.invalid).toEqual(['not-an-email']);
    const ok = await invite(p, { recipients: `${a}, ${a.toUpperCase()}; Bo <bo-${uniq()}@example.com>` });
    expect(ok.status).toBe(201);
    expect(ok.body.sent).toBe(2);
    expect(ok.body.duplicates).toEqual([a]);
    expect(ok.body.invitees.map((i: { delivery: string }) => i.delivery)).toEqual(['sent', 'sent']);
    const again = await invite(p, { recipients: a });
    expect(again.status).toBe(400); expect(again.body.code).toBe('no_new_recipients'); expect(again.body.alreadyInvited).toEqual([a]);
  });

  test('limits: ≤ 50 per send, ≤ 200 per poll', async () => {
    const p = await poll(); const u = uniq();
    const list = (n: number, k: string) => Array.from({ length: n }, (_, i) => `${k}${i}-${u}@example.com`);
    expect((await invite(p, { recipients: list(51, 'x') })).body.code).toBe('too_many_per_send');
    for (const k of ['a', 'b', 'c', 'd']) {
      expect((await invite(p, { recipients: list(50, k) })).status).toBe(201);
      await prisma.invitation.updateMany({ where: { event: { slug: p.id } }, data: { createdAt: new Date(Date.now() - 2 * 3600_000) } }); // outside the hourly cap
    }
    const over = await invite(p, { recipients: list(1, 'e') });
    expect(over.status).toBe(400); expect(over.body.code).toBe('too_many_per_poll');
  });

  test('per-poll hourly cap (100 recipients per hour)', async () => {
    const p = await poll(); const u = uniq();
    for (const k of ['a', 'b']) expect((await invite(p, { recipients: Array.from({ length: 50 }, (_, i) => `${k}${i}-${u}@example.com`) })).status).toBe(201);
    const r = await invite(p, { recipients: `c-${u}@example.com` });
    expect(r.status).toBe(429); expect(r.body.code).toBe('poll_hourly_limit');
  });

  test('personal message: ≤ 1000 graphemes, no admin/edit links; organizer name sanitized', async () => {
    const p = await poll();
    const long = await invite(p, { recipients: `m-${uniq()}@example.com`, message: '😀'.repeat(1012) });
    expect(long.status).toBe(400); expect(long.body.errors[0]).toBe('Beskeden er 12 tegn for lang.');
    const secret = await invite(p, { recipients: `m-${uniq()}@example.com`, message: `se ${BASE}/da/p/${p.id}/admin#${p.token}` });
    expect(secret.body.code).toBe('secret_link');
    const ok = await invite(p, { recipients: `m-${uniq()}@example.com`, message: '😀'.repeat(1000), organizer_name: 'Mette "x" <a@b.dk>\r\nBcc: e' });
    expect(ok.status).toBe(201);
    expect(ok.body.organizer_name).toBe('Mette x Bcc e');
  });

  test('closed poll: no invitations, no reminders', async () => {
    const p = await poll();
    await invite(p, { recipients: `c-${uniq()}@example.com` });
    await call(`/api/events/${p.id}/close`, { method: 'POST', token: p.token, json: {} });
    expect((await invite(p, { recipients: `d-${uniq()}@example.com` })).body.code).toBe('closed');
    expect((await call(`/api/events/${p.id}/reminders`, { method: 'POST', token: p.token })).body.code).toBe('closed');
  });

  test('reminders: manual, max one per 24 h, 3 in total; skips unsubscribed and bounced', async () => {
    const p = await poll(); const a = `r1-${uniq()}@example.com`, b = `r2-${uniq()}@example.com`, c = `r3-${uniq()}@example.com`;
    await invite(p, { recipients: [a, b, c] });
    await prisma.invitation.update({ where: { id: (await invRow(p.id, b)).id }, data: { delivery: 'bounced' } });
    await call(`/api/u/p/${linkToken((await invRow(p.id, c)).id)}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' });
    const r1 = await call(`/api/events/${p.id}/reminders`, { method: 'POST', token: p.token });
    expect(r1.status).toBe(201); expect(r1.body.recipients).toBe(1);
    const r2 = await call(`/api/events/${p.id}/reminders`, { method: 'POST', token: p.token });
    expect(r2.status).toBe(429); expect(r2.body.code).toBe('reminder_too_soon'); expect(r2.body.next_allowed_at).toBeTruthy();
    for (let i = 2; i <= 3; i++) {
      await prisma.event.update({ where: { slug: p.id }, data: { lastReminderAt: new Date(Date.now() - 25 * 3600_000) } });
      expect((await call(`/api/events/${p.id}/reminders`, { method: 'POST', token: p.token })).status).toBe(201);
    }
    await prisma.event.update({ where: { slug: p.id }, data: { lastReminderAt: new Date(Date.now() - 25 * 3600_000) } });
    const r4 = await call(`/api/events/${p.id}/reminders`, { method: 'POST', token: p.token });
    expect(r4.status).toBe(409); expect(r4.body.code).toBe('reminder_limit');
    expect((await call(`/api/events/${p.id}/invitations`, { token: p.token })).body.reminder).toMatchObject({ used: 3, max: 3 });
  });

  test('unsubscribe: one-click POST (this poll), landing JSON + undo, "all" suppresses other polls; stored as hash only', async () => {
    const p = await poll(), q = await poll(); const a = `u-${uniq()}@example.com`;
    await invite(p, { recipients: a });
    const t = linkToken((await invRow(p.id, a)).id);
    expect((await call(`/api/u/p/${t}`)).body).toMatchObject({ email: `${a[0]}•••@example.com`, poll_unsubscribed: false });
    expect((await call(`/api/u/p/${t}`, { method: 'POST', body: 'x' })).status).toBe(400); // no one-click marker, no JSON
    expect((await call(`/api/u/p/${t}`, { method: 'POST', json: { action: 'unsubscribe' } })).body.poll_unsubscribed).toBe(true);
    expect((await invRow(p.id, a)).delivery).toBe('unsub');
    expect((await call(`/api/u/p/${t}`, { method: 'POST', json: { action: 'resubscribe' } })).body.poll_unsubscribed).toBe(false);
    expect((await invRow(p.id, a)).delivery).toBe('sent');
    await call(`/api/u/all/${t}`, { method: 'POST', json: { action: 'unsubscribe' } });
    const sup = await prisma.emailSuppression.findMany({ where: { emailHash: emailHash(a) } });
    expect(sup.map((s) => s.scope)).toEqual(['all']);
    expect(JSON.stringify(await prisma.emailSuppression.findMany({ take: 1000 }))).not.toContain(a);
    const r = await invite(q, { recipients: a });
    expect(r.body).toMatchObject({ sent: 0, rejected: 1, results: [{ email: a, status: 'rejected' }] }); // PM: never revealed as unsubscribed
    expect(r.body.invitees).toEqual([]); // not stored
    expect((await call(`/api/u/p/${'A'.repeat(43)}`)).status).toBe(404);
    const h = (await call(`/da/u/p/${t}`)).headers;
    expect(h.get('referrer-policy')).toBe('no-referrer');
  });

  test('report abuse: stored, unsubscribes by default, repeated reports stop mail for the poll', async () => {
    const p = await poll(); const a = `x-${uniq()}@example.com`, b = `y-${uniq()}@example.com`;
    await invite(p, { recipients: [a, b] });
    const ta = linkToken((await invRow(p.id, a)).id), tb = linkToken((await invRow(p.id, b)).id);
    expect((await call(`/api/abuse/${ta}`, { method: 'POST', json: { reason: 'nope' } })).status).toBe(400);
    expect((await call(`/api/abuse/${ta}`, { method: 'POST', json: { reason: 'spam', details: 'x' } })).status).toBe(201);
    expect((await invRow(p.id, a)).delivery).toBe('unsub');
    await call(`/api/abuse/${tb}`, { method: 'POST', json: { reason: 'phishing', unsubscribe: false } });
    expect((await invRow(p.id, b)).delivery).toBe('sent');
    expect((await invite(p, { recipients: `z-${uniq()}@example.com` })).body.code).toBe('mail_blocked');
  });

  test('webhooks: signature required; delivered/bounced/complained update status, no downgrade, bounce suppresses', async () => {
    const p = await poll(); const a = `w-${uniq()}@example.com`;
    await invite(p, { recipients: a });
    const id = (await invRow(p.id, a)).providerId!;
    const sign = (body: string, ts = Math.floor(Date.now() / 1000)) => {
      const key = Buffer.from(TEST_WEBHOOK_SECRET.slice(6), 'base64');
      const sid = `msg_${uniq()}`;
      const sig = createHmac('sha256', key).update(`${sid}.${ts}.${body}`).digest('base64');
      return { 'svix-id': sid, 'svix-timestamp': String(ts), 'svix-signature': `v1,${sig}`, 'Content-Type': 'application/json' };
    };
    const hook = (type: string, extra = {}, h?: Record<string, string>) => {
      const body = JSON.stringify({ type, data: { email_id: id, ...extra } });
      return call('/api/webhooks/resend', { method: 'POST', headers: h ?? sign(body), body });
    };
    expect((await hook('email.delivered', {}, { 'svix-id': 'x', 'svix-timestamp': String(Math.floor(Date.now() / 1000)), 'svix-signature': 'v1,AAAA' })).status).toBe(401);
    const old = JSON.stringify({ type: 'email.delivered', data: { email_id: id } });
    expect((await call('/api/webhooks/resend', { method: 'POST', headers: sign(old, Math.floor(Date.now() / 1000) - 600), body: old })).status).toBe(401);
    await hook('email.delivered'); expect((await invRow(p.id, a)).delivery).toBe('delivered');
    await hook('email.bounced', { bounce: { type: 'Permanent' } });
    expect(await invRow(p.id, a)).toMatchObject({ delivery: 'bounced', reason: 'Adressen findes ikke (hard bounce)' });
    await hook('email.delivered'); expect((await invRow(p.id, a)).delivery).toBe('bounced');
    expect(await prisma.emailSuppression.count({ where: { emailHash: emailHash(a), scope: 'all' } })).toBe(1);
  });

  test('cron cleanup: CRON_SECRET (Bearer) required; deletes addresses 90 days after close; idempotent', async () => {
    const p = await poll(), q = await poll();
    await invite(p, { recipients: `old-${uniq()}@example.com` }); await invite(q, { recipients: `new-${uniq()}@example.com` });
    await prisma.event.update({ where: { slug: p.id }, data: { closedAt: new Date(Date.now() - 91 * 86400_000) } });
    await prisma.event.update({ where: { slug: q.id }, data: { closedAt: new Date(Date.now() - 89 * 86400_000) } });
    expect((await call('/api/cron/cleanup')).status).toBe(401);
    expect((await call('/api/cron/cleanup', { headers: { Authorization: 'Bearer wrong-secret-0123456789' } })).status).toBe(401);
    const r = await call('/api/cron/cleanup', { headers: { Authorization: `Bearer ${TEST_CRON_SECRET}` } });
    expect(r.status).toBe(200); expect(r.body.invitations_deleted).toBeGreaterThanOrEqual(1);
    expect(await prisma.invitation.count({ where: { event: { slug: p.id } } })).toBe(0);
    expect(await prisma.invitation.count({ where: { event: { slug: q.id } } })).toBe(1);
    expect((await call('/api/cron/cleanup', { method: 'POST', headers: { Authorization: `Bearer ${TEST_CRON_SECRET}` } })).status).toBe(200);
  });

  test('deleting the poll deletes the addresses immediately', async () => {
    const p = await poll();
    await invite(p, { recipients: `del-${uniq()}@example.com` });
    const eid = (await prisma.event.findUniqueOrThrow({ where: { slug: p.id } })).id;
    await call(`/api/events/${p.id}`, { method: 'DELETE', token: p.token });
    expect(await prisma.invitation.count({ where: { eventId: eid } })).toBe(0);
  });

  test('global quota is reserved atomically (day and month)', async () => {
    const day = new Date(Date.UTC(1999, 0, 15)); // isolated past day
    await prisma.emailQuota.deleteMany({ where: { day: { startsWith: '1999-01' } } });
    const lim = { day: 10, month: 15 };
    const res = await Promise.all(Array.from({ length: 6 }, () => reserveQuota(3, day, lim)));
    expect(res.filter(Boolean)).toHaveLength(3); // 9 of 10
    expect(await reserveQuota(2, day, lim)).toBe(false);
    expect(await reserveQuota(6, new Date(Date.UTC(1999, 0, 16)), lim)).toBe(true); // 15 in month
    expect(await reserveQuota(1, new Date(Date.UTC(1999, 0, 17)), lim)).toBe(false);
  });
});
