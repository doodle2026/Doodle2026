/**
 * "Send til mig selv" (spec 11 Oct). Two layers:
 * - in-process with EMAIL_MODE=capture (NODE_ENV=test → capture gate passes, nothing is ever sent): full mail content in 4 languages,
 *   limits (3/poll, 60 s, 10/IP/day), suppression → neutral 'blocked', quota → 'quota', single recipient, unsubscribe link
 * - HTTP against the production test build (log mode): auth, input rules, response shape; modal keyboard/a11y/mobile in a browser
 */
import { describe, test, expect, inject, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import * as pwc from 'playwright-core';

process.env.EMAIL_MODE = 'capture';
process.env.EMAIL_CAPTURE_FILE = './.email-capture/self-send-test.jsonl';
process.env.APP_URL = 'https://grabaday.test';
process.env.TRUSTED_PROXY_HOPS = '1';
process.env.EMAIL_DAILY_QUOTA = '100000'; process.env.EMAIL_MONTHLY_QUOTA = '1000000'; // in-process: don't depend on what other runs used today
process.env.EMAIL_FROM = 'grabAday <noreply@grabaday.com>';

const BASE = inject('baseUrl');
const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
const Y = new Date().getUTCFullYear() + 1;
const uniq = () => Math.random().toString(36).slice(2, 10);
const ip = () => `10.61.${(Math.random() * 255) | 0}.${(Math.random() * 250 + 1) | 0}`;
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

let lib: typeof import('../src/lib/self-send'), cap: typeof import('../src/lib/email/capture'), inv: typeof import('../src/lib/invitations');
beforeAll(async () => {
  lib = await import('../src/lib/self-send'); cap = await import('../src/lib/email/capture'); inv = await import('../src/lib/invitations');
});

async function call(path: string, init: { method?: string; token?: string; json?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { 'X-Forwarded-For': ip(), ...(init.headers ?? {}) };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.json !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(BASE + path, { method: init.method ?? 'GET', headers, body: init.json !== undefined ? JSON.stringify(init.json) : undefined });
  const text = await r.text(); let body: Json; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body, text, headers: r.headers };
}
async function poll(locale = 'da', title = 'Sommerfest <b>&</b> grill') {
  const r = await call('/api/events', { method: 'POST', json: { locale, title, options: [{ date: `${Y}-11-03` }] } });
  const ev = await prisma.event.findUnique({ where: { slug: r.body.id }, select: { id: true } });
  return { slug: r.body.id as string, token: r.body.admin_token as string, eventId: ev!.id };
}
const reqFrom = (addr: string, h: Record<string, string> = {}) => new Request('http://x/', { method: 'POST', headers: { 'x-forwarded-for': addr, ...h } });
const fail = async (p: Promise<unknown>) => { try { await p; } catch (e) { const x = e as { status: number; extra: Json }; return { status: x.status, ...x.extra }; } throw new Error('expected rejection'); };
const ageRows = (eventId: number, ms = 61_000) => prisma.$executeRaw`UPDATE self_sends SET created_at = created_at - (${ms} * interval '1 millisecond') WHERE event_id = ${eventId}`;

describe('send-to-self (capture mode, in-process)', () => {
  test('mail content in all 4 languages: admin link + public link + keep/ignore texts + unsubscribe; one recipient, no replyTo', async () => {
    const KEEP = { en: 'Save this email', da: 'Gem denne mail', fr: 'Conservez cet e-mail', de: 'Bewahren Sie diese E-Mail auf' } as const;
    const IGNORE = { en: 'create this poll', da: 'Har du ikke oprettet', fr: 'Vous n’avez pas créé', de: 'Sie haben diese Umfrage' } as const;
    for (const L of ['en', 'da', 'fr', 'de'] as const) {
      const p = await poll(L, `${'Lang titel '.repeat(15)}<script>`);
      const to = `Self-${uniq()}@Example.com`;
      cap.clearCaptured();
      const r = await lib.sendToSelf(p.eventId, p.token, reqFrom(ip()), { email: to }, null);
      expect(r).toMatchObject({ ok: true, remaining: 2 });
      expect(r.sent_to).toMatch(/^s\*\*\*@example\.com$/);
      const mails = cap.capturedMails();
      expect(mails).toHaveLength(1);
      const m = mails[0];
      expect(m.to).toEqual([to.toLowerCase()]); // only the typed address
      expect(m.replyTo).toBeUndefined();
      expect(m.from).toMatch(/^"?grabAday"? <noreply@grabaday\.com>$/);
      for (const body of [m.text, m.html!]) {
        expect(body).toContain(`https://grabaday.test/${L}/p/${p.slug}/admin#${p.token}`);
        expect(body).toContain(`https://grabaday.test/${L}/p/${p.slug}`);
        expect(body).toContain(KEEP[L]); expect(body).toContain(IGNORE[L]);
        expect(body).toMatch(new RegExp(`https://grabaday\\.test/${L}/u/all/[A-Za-z0-9_-]{43}`));
      }
      expect(m.html).not.toContain('<script>'); expect(m.html).toContain('Lang titel');
      // no open/click tracking: no pixels (only our logo assets), no rewritten links (every href is ours or mailto)
      for (const [, src] of m.html!.matchAll(/<img[^>]+src="([^"]+)"/g)) expect(src).toMatch(/^https:\/\/grabaday\.test\/email-assets\/[\w@.-]+\.png$/);
      for (const [, href] of m.html!.matchAll(/href="([^"]+)"/g)) expect(href, href).toMatch(/^(https:\/\/grabaday\.test(\/|$)|mailto:)/);
      expect(m.subject.length).toBeLessThan(160); // title clipped to 100
      expect(m.headers?.['List-Unsubscribe']).toMatch(/^<https:\/\/grabaday\.test\/api\/u\/all\/[A-Za-z0-9_-]{43}>$/);
      // address never stored in clear text
      const rows = await prisma.$queryRaw<Json[]>`SELECT * FROM self_sends WHERE event_id = ${p.eventId}`;
      expect(JSON.stringify(rows)).not.toContain(to.toLowerCase().split('@')[0]);
    }
  });

  test('limits: 60 s gap, max 3 per poll (4th refused), attempts can not be reset by refused addresses', async () => {
    const p = await poll(); const a = ip();
    await lib.sendToSelf(p.eventId, p.token, reqFrom(a), { email: `a-${uniq()}@example.com` }, null);
    expect(await fail(lib.sendToSelf(p.eventId, p.token, reqFrom(a), { email: `b-${uniq()}@example.com` }, null))).toMatchObject({ status: 429, reason: 'wait' });
    await ageRows(p.eventId);
    await lib.sendToSelf(p.eventId, p.token, reqFrom(a), { email: `c-${uniq()}@example.com` }, null);
    await ageRows(p.eventId);
    await lib.sendToSelf(p.eventId, p.token, reqFrom(a), { email: `d-${uniq()}@example.com` }, null);
    await ageRows(p.eventId);
    cap.clearCaptured();
    expect(await fail(lib.sendToSelf(p.eventId, p.token, reqFrom(a), { email: `e-${uniq()}@example.com` }, null))).toMatchObject({ status: 429, reason: 'poll_max' });
    expect(cap.capturedMails()).toHaveLength(0);
    expect(await lib.selfStatus(p.eventId)).toEqual({ remaining: 0, next_in: 0 });
  });

  test('10 per IP per UTC day across polls; another IP is unaffected', async () => {
    const a = ip();
    for (let i = 0; i < 10; i++) {
      const p = await poll();
      await lib.sendToSelf(p.eventId, p.token, reqFrom(a), { email: `ip-${uniq()}@example.com` }, null);
    }
    const p = await poll();
    expect(await fail(lib.sendToSelf(p.eventId, p.token, reqFrom(a), { email: `ip-${uniq()}@example.com` }, null))).toMatchObject({ status: 429, reason: 'ip' });
    // forged leftmost XFF can't escape the limit (shared client-IP helper uses the rightmost trusted entry)
    expect(await fail(lib.sendToSelf(p.eventId, p.token, reqFrom(`1.2.3.4, ${a}`), { email: `ip-${uniq()}@example.com` }, null))).toMatchObject({ reason: 'ip' });
    await expect(lib.sendToSelf(p.eventId, p.token, reqFrom(ip()), { email: `ip-${uniq()}@example.com` }, null)).resolves.toMatchObject({ ok: true });
  });

  test('suppressed (unsubscribed) address → neutral "blocked", nothing sent; via the mail\'s own unsubscribe link too', async () => {
    const p = await poll(); const e = `blk-${uniq()}@example.com`;
    await prisma.emailSuppression.create({ data: { emailHash: inv.emailHash(e), scope: 'all' } });
    cap.clearCaptured();
    expect(await fail(lib.sendToSelf(p.eventId, p.token, reqFrom(ip()), { email: e }, null))).toMatchObject({ status: 409, error: 'blocked' });
    expect(cap.capturedMails()).toHaveLength(0);
    // footer link of a self mail → "unsubscribe from all" works without a stored address
    const q = await poll(); const f = `unsub-${uniq()}@example.com`;
    await lib.sendToSelf(q.eventId, q.token, reqFrom(ip()), { email: f }, null);
    const tok = /\/u\/all\/([A-Za-z0-9_-]{43})/.exec(cap.capturedMails().at(-1)!.text)![1];
    expect(await inv.linkInfo(tok)).toMatchObject({ email: '•••', all_unsubscribed: false });
    expect(await inv.setSubscription(tok, 'all', true)).toMatchObject({ all_unsubscribed: true });
    await ageRows(q.eventId);
    expect(await fail(lib.sendToSelf(q.eventId, q.token, reqFrom(ip()), { email: f }, null))).toMatchObject({ status: 409, error: 'blocked' });
  });

  test('daily quota used up → "quota" (attempt not counted), invalid input → 400, client cannot add links/text/cc', async () => {
    const p = await poll();
    process.env.EMAIL_DAILY_QUOTA = '0';
    try { expect(await fail(lib.sendToSelf(p.eventId, p.token, reqFrom(ip()), { email: `q-${uniq()}@example.com` }, null))).toMatchObject({ status: 429, reason: 'quota' }); }
    finally { process.env.EMAIL_DAILY_QUOTA = '100000'; }
    expect(await lib.selfStatus(p.eventId)).toEqual({ remaining: 3, next_in: 0 });
    for (const b of [{ email: 'nope' }, { email: 'a@x.com, b@y.com' }, { email: 'a@x.com;b@y.com' }, {}, { email: 'a@example.com', cc: 'b@example.com' }, { email: 'a@example.com', adminUrl: 'https://evil' }, { email: 'a@example.com', message: 'hi' }]) {
      expect((await fail(lib.sendToSelf(p.eventId, p.token, reqFrom(ip()), b, null))).status, JSON.stringify(b)).toBe(400);
    }
  });
});

describe('send-to-self: Resend failure', () => {
  test('provider error → 503 (the only 503), attempt and quota released', async () => {
    const p = await poll(); process.env.EMAIL_CAPTURE_FAIL = '^fail-';
    try { expect(await fail(lib.sendToSelf(p.eventId, p.token, reqFrom(ip()), { email: `fail-${uniq()}@example.com` }, null))).toMatchObject({ status: 503, error: 'server' }); }
    finally { delete process.env.EMAIL_CAPTURE_FAIL; }
    expect(await lib.selfStatus(p.eventId)).toEqual({ remaining: 3, next_in: 0 });
  });
});

describe('send-to-self HTTP (production build, log mode)', () => {
  test('admin token required; 201 with masked address; GET status; no-store', async () => {
    const p = await poll();
    const path = `/api/polls/${p.slug}/send-to-self`;
    expect((await call(path, { method: 'POST', json: { email: 'a@example.com' } })).status).toBe(401);
    expect((await call(path, { method: 'POST', token: 'A'.repeat(43), json: { email: 'a@example.com' } })).status).toBe(403);
    const ok = await call(path, { method: 'POST', token: p.token, json: { email: `Ok-${uniq()}@example.com` } });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ ok: true, remaining: 2 });
    expect(ok.headers.get('cache-control')).toMatch(/no-store/);
    expect(ok.text).not.toContain(p.token);
    const again = await call(path, { method: 'POST', token: p.token, json: { email: `x-${uniq()}@example.com` } });
    expect(again.status).toBe(429); expect(again.body).toMatchObject({ ok: false, reason: 'wait' }); expect(Number(again.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await call(path, { token: p.token })).body).toMatchObject({ remaining: 2 });
    expect((await call(path, { method: 'POST', token: p.token, json: { email: 'a@example.com', cc: 'b@example.com' } })).status).toBe(400);
  });

  test('blocked and sent take the same minimum time and status shape is neutral', async () => {
    const p = await poll(), q = await poll(); const e = `nt-${uniq()}@example.com`;
    await prisma.emailSuppression.create({ data: { emailHash: inv.emailHash(e), scope: 'all' } });
    const t0 = Date.now(); const b = await call(`/api/polls/${p.slug}/send-to-self`, { method: 'POST', token: p.token, json: { email: e } }); const tb = Date.now() - t0;
    expect(b.status).toBe(409); expect(b.body.error).toBe('blocked'); expect(JSON.stringify(b.body)).not.toMatch(/unsub|suppress/i);
    expect(tb).toBeGreaterThanOrEqual(390);
    const t1 = Date.now(); expect((await call(`/api/polls/${q.slug}/send-to-self`, { method: 'POST', token: q.token, json: { email: `nt2-${uniq()}@example.com` } })).status).toBe(200);
    expect(Date.now() - t1).toBeGreaterThanOrEqual(390);
  });
});

describe('admin page', () => {
  test('admin page has the send-to-self button (no mailto) and the modal sends', async () => {
    const b = await pwc.chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome' });
    try {
      const pg = await (await b.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ip() } })).newPage();
      const p = await poll('en');
      await pg.goto(`${BASE}/en/p/${p.slug}/admin#${p.token}`);
      await pg.click('#mailme');
      await pg.fill('#sts-email', `adm-${uniq()}@example.com`); await pg.click('#sts-send');
      await expect.poll(() => pg.locator('.sts__done').textContent(), { timeout: 10_000 }).toContain('a***@example.com');
      expect(await pg.locator('a[href^="mailto:"]', { hasText: /send to myself/i }).count()).toBe(0);
    } finally { await b.close(); }
  });
});

describe('modal (confirmation page)', () => {
  for (const [name, br, opts] of [
    ['desktop-chromium', 'chromium', { viewport: { width: 1280, height: 900 } }],
    ['iphone-14', 'webkit', pwc.devices['iPhone 14']],
    ['webkit-320', 'webkit', { ...pwc.devices['iPhone SE'], viewport: { width: 320, height: 640 } }],
  ] as const) {
    test(`${name}: keyboard + a11y: opens, focus in field, Enter sends, receipt announced, Esc closes, focus back`, async () => {
      if (br === 'webkit' && !existsSync(pwc.webkit.executablePath())) return;
      const b = await (br === 'webkit' ? pwc.webkit : pwc.chromium).launch(br === 'chromium' ? { executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome' } : {});
      try {
        for (const L of ['da', 'de'] as const) {
          const ctx = await b.newContext({ ...opts, locale: L, extraHTTPHeaders: { 'x-forwarded-for': ip() } });
          const pg = await ctx.newPage();
          const p = await poll(L);
          await pg.goto(`${BASE}/${L}`);
          await pg.evaluate(([id, tok]) => sessionStorage.setItem(`mt-admin-${id}`, `/p/${id}/admin#${tok}`), [p.slug, p.token]);
          await pg.goto(`${BASE}/${L}/p/${p.slug}?created=1`);
          await pg.waitForSelector('#mailme');
          expect(await pg.locator('a[href^="mailto:"]#mailme').count()).toBe(0);
          await pg.focus('#mailme'); await pg.keyboard.press('Enter');
          const dlg = pg.locator('dialog.sts');
          await expect.poll(() => dlg.evaluate((d: HTMLDialogElement) => d.open)).toBe(true);
          expect(await dlg.getAttribute('aria-modal')).toBe('true');
          await expect.poll(() => pg.evaluate(() => document.activeElement?.id)).toBe('sts-email');
          expect(await pg.getAttribute('#sts-email', 'type')).toBe('email'); expect(await pg.getAttribute('#sts-email', 'autocomplete')).toBe('email');
          await pg.keyboard.type('bad'); await pg.keyboard.press('Enter');
          await expect.poll(() => pg.locator('#sts-err').textContent()).toBeTruthy();
          expect(await pg.getAttribute('#sts-email', 'aria-invalid')).toBe('true');
          await pg.fill('#sts-email', `modal-${uniq()}@example.com`); await pg.keyboard.press('Enter');
          await expect.poll(() => pg.locator('.sts__done').textContent(), { timeout: 10_000 }).toContain('m***@example.com');
          expect(await pg.locator('.sts__done .sts__receipt .sts__line').count()).toBe(2); // exactly two receipt lines
          expect(await pg.locator('.sts__done p').count()).toBe(2); // receipt paragraph + the conditional 'N more' line (remaining 2 ≤ 2)
          expect(await pg.locator('.sts__left').count()).toBe(1); // remaining 2 ≤ 2 → shown
          await expect.poll(() => pg.evaluate(() => document.activeElement?.id)).toBe('sts-done');
          expect(await pg.locator('#sts-live').getAttribute('aria-live')).toBe('polite');
          expect(await dlg.evaluate((d: HTMLDialogElement) => d.open)).toBe(true); // doesn't close by itself
          // buttons ≥ 44 px, send button visible inside viewport
          for (const sel of ['#sts-done', '#sts-x']) {
            const bb = (await pg.locator(sel).boundingBox())!; expect(bb.height, sel).toBeGreaterThanOrEqual(44);
            expect(bb.y + bb.height, sel).toBeLessThanOrEqual(opts.viewport!.height);
          }
          await pg.keyboard.press('Escape');
          await expect.poll(() => dlg.evaluate((d: HTMLDialogElement) => d.open)).toBe(false);
          await expect.poll(() => pg.evaluate(() => document.activeElement?.id)).toBe('mailme');
          await ctx.close();
        }
      } finally { await b.close(); }
    });
  }
});

describe('no open/click tracking in ANY grabAday mail', () => {
  test('all templates (invitation, reminder, organizer-links × 4 languages): images are only our logos, links are only template data', async () => {
    const { TEMPLATES } = await import('../src/lib/email/templates');
    for (const [L, T] of Object.entries(TEMPLATES)) for (const kind of ['invitation', 'reminder', 'organizerLinks'] as const) {
      const html = T[kind].html;
      for (const [, src] of html.matchAll(/<img[^>]+src="([^"]+)"/g)) expect(src, `${L}/${kind}`).toMatch(/^\{\{assetBaseUrl\}\}\/logo-(light|dark)@2x\.png$/);
      for (const [, href] of html.matchAll(/href="([^"]+)"/g)) expect(href, `${L}/${kind}`).toMatch(/^(\{\{\{?\w+\}?\}\}[^"]*|mailto:[^"]*)$/);
      expect(html).not.toMatch(/background(-image)?\s*[:=]\s*["']?url\(https?:/i);
    }
  });
});

describe('owner dashboard §47.9 + manifest', () => {
  test('selfSent: split line counts today\'s self mails, all-time total row; main number = all mails (quota)', async () => {
    const st = await import('../src/lib/owner/stats');
    st.clearStatsCache(); const before = (await st.ownerStats()).email;
    const p = await poll();
    await lib.sendToSelf(p.eventId, p.token, reqFrom(ip()), { email: `dash-${uniq()}@example.com` }, null);
    st.clearStatsCache(); const after = (await st.ownerStats()).email;
    expect(after.split.self).toBe(before.split.self + 1);
    expect(after.selfTotal).toBe(before.selfTotal + 1);
    expect(after.sentToday).toBe(before.sentToday + 1);
    expect(JSON.stringify(after)).not.toMatch(/@/);
  });
  test('manifest: brand-blue theme_color and a 192×192 icon', async () => {
    const m = await (await fetch(`${BASE}/manifest.webmanifest`)).json();
    expect(m.theme_color).toBe('#2B6CB0');
    const i = m.icons.find((x: { sizes: string }) => x.sizes === '192x192');
    expect(i.src).toBe('/brand/icon-192.png');
    const png = Buffer.from(await (await fetch(BASE + i.src)).arrayBuffer());
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([192, 192]);
  });
});

describe('PR #36 blocker: bare recipient addresses only (all mail paths)', () => {
  const REPRO = ['Evil <evil@example.com>', '"Your account is locked – verify at evil.example" <victim@example.com>'];
  test('sendToSelf rejects display-name forms with 400; nothing hashed, stored or captured', async () => {
    const p = await poll('en');
    const before = await prisma.selfSend.count({ where: { eventId: p.eventId } });
    cap.clearCaptured();
    for (const e of [...REPRO, 'victim@example.com\r\nBcc: x@example.com', ' <a@example.com>', 'a@example.com>', '"a"@example.com']) {
      expect(await fail(lib.sendToSelf(p.eventId, p.token, reqFrom(ip()), { email: e }, null)), e).toMatchObject({ status: 400 });
      const r = await call(`/api/polls/${p.slug}/send-to-self`, { method: 'POST', token: p.token, json: { email: e } });
      expect(r.status, e).toBe(400); expect(r.body.error ?? r.body.reason ?? r.body.code).toBe('invalid');
    }
    expect(cap.capturedMails()).toHaveLength(0);
    expect(await prisma.selfSend.count({ where: { eventId: p.eventId } })).toBe(before);
  });
  test('an unsubscribed address cannot be reached by wrapping it in a display name', async () => {
    const p = await poll('en'); const v = `victim-${uniq()}@example.com`;
    await prisma.emailSuppression.create({ data: { emailHash: (await import('../src/lib/invitations')).emailHash(v), scope: 'all' } });
    expect(await fail(lib.sendToSelf(p.eventId, p.token, reqFrom(ip()), { email: v }, null))).toMatchObject({ status: 409 });
    expect(await fail(lib.sendToSelf(p.eventId, p.token, reqFrom(ip()), { email: `Friend <${v}>` }, null))).toMatchObject({ status: 400 });
  });
  test('normalized bare address is what is hashed and sent (To header = bare address)', async () => {
    const p = await poll('en'); cap.clearCaptured();
    await lib.sendToSelf(p.eventId, p.token, reqFrom(ip()), { email: `  Bare-${'X'}@Example.COM ` }, null);
    const m = cap.capturedMails().at(-1)!;
    expect(m.to).toEqual(['bare-x@example.com']);
  });
  test('adapter + invitation planner refuse non-bare recipients; isBareEmail is strict', async () => {
    const { isBareEmail, mailer } = await import('../src/lib/email/send');
    for (const e of REPRO) expect(isBareEmail(e), e).toBe(false);
    for (const e of ['a..b@example.com', '.a@example.com', 'a@example', 'a b@example.com', 'a@example.com\n']) expect(isBareEmail(e), e).toBe(false);
    expect(isBareEmail('jan.lund+x@example.co.uk')).toBe(true);
    cap.clearCaptured();
    const r = await mailer().send({ to: REPRO[1], subject: 's', text: 't', html: '<p>t</p>' });
    expect(r.ok).toBe(false); expect(cap.capturedMails()).toHaveLength(0);
    const rb = await mailer().sendBatch([{ to: REPRO[0], subject: 's', text: 't', html: '<p>t</p>' }]);
    expect(rb[0].ok).toBe(false); expect(cap.capturedMails()).toHaveLength(0);
    const { planInvitations } = await import('../src/lib/email/policy');
    const p = planInvitations({ id: 'x', title: 'T', organizerName: '', locale: 'en', options: [{ date: `${Y}-11-03` }], remindersSent: 0, lastReminderAt: null, trackingEnabled: false } as Json,
      REPRO.map((email) => ({ email, linkToken: 't' })) as Json, { appUrl: 'https://grabaday.test' } as Json);
    expect(p.messages).toHaveLength(0); expect(p.skipped.map((s: Json) => s.reason)).toEqual(['invalid_email', 'invalid_email']);
  });
  test('invitation API: display names are parsed off, only the bare address is stored and mailed', async () => {
    const p = await poll('en');
    const r = await call(`/api/events/${p.slug}/invitations`, { method: 'POST', token: p.token, json: { recipients: '"Phish: click evil.example" <ok-' + uniq() + '@example.com>' } });
    expect(r.status).toBeLessThan(300);
    const rows = await prisma.invitation.findMany({ where: { eventId: p.eventId }, select: { email: true } });
    for (const x of rows) expect(isBare(x.email), x.email).toBe(true);
  });
  test('test delivery hook rejects display-name forms', async () => {
    const r = await call('/api/test/delivery', { method: 'POST', json: { email: REPRO[0], event: 'delivered' } });
    expect([400, 404]).toContain(r.status); // 404 when the capture gate is closed (prod test build), 400 otherwise
  });
});
const isBare = (e: string) => /^[^\s<>"@]+@[^\s<>"@]+$/.test(e);

describe('modal: live countdown (wait / ip / hour)', () => {
  for (const reason of ['wait', 'ip', 'hour'] as const) test(`${reason}: Send disabled while counting down, re-enabled at 0`, async () => {
    const b = await pwc.chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome' });
    try {
      const pg = await (await b.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ip() } })).newPage();
      const p = await poll('da');
      await pg.route('**/send-to-self', (rt) => rt.request().method() === 'POST'
        ? rt.fulfill({ status: 429, headers: { 'Retry-After': '3', 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: reason === 'wait' ? 'self_too_soon' : 'rate', reason }) })
        : rt.continue());
      await pg.goto(`${BASE}/da/p/${p.slug}/admin#${p.token}`);
      await pg.click('#mailme'); await pg.fill('#sts-email', `cd-${uniq()}@example.com`); await pg.click('#sts-send');
      await expect.poll(() => pg.locator('#sts-alert').textContent()).toBeTruthy();
      expect(await pg.locator('#sts-send').isDisabled()).toBe(true);
      if (reason === 'wait') {
        const t1 = await pg.locator('#sts-alert p').textContent();
        await expect.poll(() => pg.locator('#sts-alert p').textContent(), { timeout: 2500 }).not.toBe(t1); // it ticks
      }
      await expect.poll(() => pg.locator('#sts-send').isDisabled(), { timeout: 6000 }).toBe(false);
      expect(await pg.locator('#sts-alert').count()).toBe(0);
    } finally { await b.close(); }
  });
});

describe('owner limits table uses the configured quota', () => {
  test('lim.day / lim.poll have placeholders (no hardcoded 100/200)', async () => {
    for (const L of ['en', 'da', 'fr', 'de']) {
      const m = JSON.parse((await import('node:fs')).readFileSync(`messages/${L}.json`, 'utf8')).owner.lim;
      expect(m.day).toContain('{n}'); expect(m.poll).toContain('{n}'); expect(m.day).not.toMatch(/100/);
    }
  });
});
