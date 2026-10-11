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
    finally { delete process.env.EMAIL_DAILY_QUOTA; }
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
      await expect.poll(() => pg.locator('.sts__done').textContent(), { timeout: 10_000 }).toContain('a***@e***.com');
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
          await expect.poll(() => pg.locator('.sts__done').textContent(), { timeout: 10_000 }).toContain('m***@e***.com');
          expect(await pg.locator('.sts__done .sts__lead').count()).toBe(1); expect(await pg.locator('.sts__spam').count()).toBe(1); // two-line receipt
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
