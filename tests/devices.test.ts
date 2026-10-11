/** "Send til e-mails" (confirmation page, device matrix – iOS button fix, design-spec §0.1 / tools/devices.js. Mail runs in log mode – nothing is sent. */
import { describe, test, expect, inject, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import type { Browser } from 'playwright-core';
import { emailHash } from '../src/lib/invitations';

const BASE = inject('baseUrl');
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
const Y = new Date().getUTCFullYear() + 1;
const ip = () => `10.51.${(Math.random() * 255) | 0}.${(Math.random() * 250 + 1) | 0}`;
const uniq = () => Math.random().toString(36).slice(2, 10);
async function call(path: string, init: RequestInit & { token?: string; json?: unknown } = {}) {
  const headers: Record<string, string> = { 'X-Forwarded-For': ip() };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.json !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(BASE + path, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : undefined });
  const text = await r.text(); let body: any; try { body = JSON.parse(text); } catch { body = text; } // eslint-disable-line @typescript-eslint/no-explicit-any
  return { status: r.status, body, text };
}
async function poll(locale = 'da') {
  const r = await call('/api/events', { method: 'POST', json: { locale, title: 'Send til e-mails', options: [{ date: `${Y}-11-03` }] } });
  return { id: r.body.id as string, token: r.body.admin_token as string };
}
const send = (p: { id: string; token: string }, json: unknown) => call(`/api/events/${p.id}/invitations`, { method: 'POST', token: p.token, json });


import { mkdirSync } from 'node:fs';
import * as pwc from 'playwright-core';

/** Doodle UI's standard matrix (tools/devices.js) + narrow phones from the tester report (320/375 px). */
const DEVICES: { id: string; browser: 'chromium' | 'firefox' | 'webkit'; device?: string; viewport?: { width: number; height: number } }[] = [
  { id: 'iphone-14', browser: 'webkit', device: 'iPhone 14' },
  { id: 'pixel-7', browser: 'chromium', device: 'Pixel 7' },
  { id: 'ipad-gen7', browser: 'webkit', device: 'iPad (gen 7)' },
  { id: 'desktop-chromium', browser: 'chromium', viewport: { width: 1280, height: 900 } },
  { id: 'desktop-firefox', browser: 'firefox', viewport: { width: 1280, height: 900 } },
  { id: 'desktop-webkit', browser: 'webkit', viewport: { width: 1280, height: 900 } },
  { id: 'webkit-320', browser: 'webkit', device: 'iPhone SE', viewport: { width: 320, height: 640 } },
  { id: 'webkit-375', browser: 'webkit', device: 'iPhone SE', viewport: { width: 375, height: 667 } },
];
const OUT = process.env.DEVICE_SHOTS || '/workspace/doodle-test/ios-fix/';
const avail = (b: string) => { try { return existsSync((pwc as unknown as Record<string, { executablePath(): string }>)[b].executablePath()); } catch { return false; } };

/** Same checks as tools/devices.js: button overflow, flex buttons not centred, container overflow, page h-scroll. */
const AUDIT = () => {
  const r: string[] = [];
  document.querySelectorAll('button,.btn').forEach((e) => {
    const el = e as HTMLElement; if (!el.offsetParent) return; const s = getComputedStyle(el);
    if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) r.push('overflow:' + el.textContent!.trim().slice(0, 20));
    const kids = [...el.childNodes].filter((k) => k.nodeType === 1 || k.textContent!.trim());
    if (kids.length && s.display.includes('flex') && s.alignItems !== 'center') r.push('notcentered:' + el.textContent!.trim().slice(0, 20));
  });
  document.querySelectorAll('.se-row__line,.seg,.card').forEach((e) => { if (e.scrollWidth > e.clientWidth + 1) r.push('container-overflow:' + e.className + ((e.parentElement as HTMLElement).dataset.status ? '@' + (e.parentElement as HTMLElement).dataset.status + ':' + e.textContent!.slice(0, 40) : '')); });
  if (document.documentElement.scrollWidth > innerWidth + 1) r.push('page-hscroll');
  // vote buttons: the icon+label block is vertically centred within the button (±3 px) – the iPhone bug put it at the top
  document.querySelectorAll('.seg button').forEach((btn) => {
    const spans = [...btn.querySelectorAll('span')]; if (!spans.length) return;
    const bb = btn.getBoundingClientRect(), rs = spans.map((x) => x.getBoundingClientRect());
    const top = Math.min(...rs.map((x) => x.top)), bottom = Math.max(...rs.map((x) => x.bottom));
    if (Math.abs((bb.top + bb.bottom) / 2 - (top + bottom) / 2) > 3) r.push('seg-text-offcentre:' + btn.textContent);
  });
  return [...new Set(r)].slice(0, 8);
};

describe.skipIf(!existsSync(CHROME))('device matrix (§0.1)', () => {
  let p: { id: string; token: string };
  beforeAll(async () => {
    p = await poll();
    // P3: real option ids, and fail loudly
    const ev = await call(`/api/events/${p.id}`);
    const v = await call(`/api/events/${p.id}/votes`, { method: 'POST', json: { name: 'Ana', votes: ev.body.options.map((o: { id: number }) => ({ option_id: o.id, value: 'yes' })) } });
    expect(v.status, JSON.stringify(v.body)).toBeLessThan(300);
    const [a, b, c] = ['sent', 'failed', 'bounced'].map((k) => `${k}-${uniq()}@example.com`);
    for (const e of [a, b, c]) await send(p, { recipients: [e] });
    await prisma.invitation.updateMany({ where: { email: b }, data: { delivery: 'failed' } });
    await prisma.invitation.updateMany({ where: { email: c }, data: { delivery: 'bounced' } });
    mkdirSync(OUT, { recursive: true });
  });

  for (const d of DEVICES) {
    test.skipIf(!avail(d.browser))(`${d.id}: vote buttons + Send til e-mails rows (da, de) – no overflow, centred`, async () => {
      const b = await pwc[d.browser].launch(d.browser === 'chromium' ? { executablePath: CHROME } : {});
      const issues: string[] = [];
      try {
        for (const lang of ['da', 'de']) {
          const dev = d.device ? { ...pwc.devices[d.device] } : {};
          if (d.browser === 'firefox') delete (dev as { isMobile?: boolean }).isMobile;
          const ctx = await b.newContext({ ...dev, ...(d.viewport ? { viewport: d.viewport } : {}), locale: lang === 'da' ? 'da-DK' : 'de-DE' });
          const pg = await ctx.newPage();
          await pg.goto(`${BASE}/${lang}/p/${p.id}`); await pg.waitForLoadState('networkidle');
          issues.push(...(await pg.evaluate(AUDIT)).map((x) => `${lang} vote ${x}`));
          await pg.screenshot({ path: `${OUT}${d.id}-vote-${lang}.png`, fullPage: true });
          await pg.evaluate(([id, tok]) => sessionStorage.setItem(`mt-admin-${id}`, `/p/${id}/admin#${tok}`), [p.id, p.token]);
          await pg.goto(`${BASE}/${lang}/p/${p.id}?created=1`);
          await pg.waitForSelector('#se-rows li[data-status="earlier"]');
          await pg.locator('#se-rows li[data-status="idle"] input').first().fill('ikke-en-mail'); await pg.locator('#se-rows li[data-status="idle"] input').nth(1).focus();
          await pg.waitForTimeout(300);
          issues.push(...(await pg.evaluate(AUDIT)).map((x) => `${lang} se ${x}`));
          // P1: field ≥ 6rem (96 px) wide at every width incl. 320 px
          const fw = await pg.locator('#se-rows li[data-status="idle"] input').first().evaluate((e) => e.getBoundingClientRect().width);
          if (fw < 96) issues.push(`${lang} se field ${Math.round(fw)}px < 96`);
          // P2: mode switch on one line
          const tops = await pg.locator('.se-mode button').evaluateAll((bs) => bs.map((b) => Math.round(b.getBoundingClientRect().top)));
          if (new Set(tops).size > 1 && (d.viewport?.width ?? 999) >= 375) issues.push(`${lang} mode switch wraps`);
          // P4: Send button keeps its width while "Sender…"
          const idle = pg.locator('#se-rows li[data-status="idle"]').nth(1);
          await idle.locator('input').fill(`w-${lang}-${Date.now()}@example.com`);
          const btn = idle.locator('.se-btn'); const w0 = await btn.evaluate((e) => e.getBoundingClientRect().width);
          let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
          await pg.route('**/invitations', async (rt) => { if (rt.request().method() === 'POST') await gate; await rt.continue(); });
          await btn.click();
          const sending = pg.locator('#se-rows li[data-status="sending"] .se-btn'); await sending.waitFor();
          const w1 = await sending.evaluate((e) => e.getBoundingClientRect().width);
          if (Math.abs(w1 - w0) > 1) issues.push(`${lang} send width ${Math.round(w0)}→${Math.round(w1)}`);
          issues.push(...(await pg.evaluate(AUDIT)).map((x) => `${lang} sending ${x}`));
          await pg.screenshot({ path: `${OUT}${d.id}-se-sending-${lang}.png` });
          release(); await pg.unroute('**/invitations');
          await (await pg.$('#se'))!.screenshot({ path: `${OUT}${d.id}-se-${lang}.png` });
          await ctx.close();
        }
      } finally { await b.close(); }
      expect(issues).toEqual([]);
    }, 90_000);
  }
});
