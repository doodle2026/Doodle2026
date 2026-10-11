/** Follow-ups after the grabAday rename: one-line header on phones (de), .ics falls back to the poll locale, home OG/twitter/manifest. */
import { describe, test, expect, inject } from 'vitest';
import { existsSync } from 'node:fs';
import * as pwc from 'playwright-core';

const BASE = inject('baseUrl');
const ip = () => `10.8.${(Math.random() * 255) | 0}.${(Math.random() * 250 + 1) | 0}`;
const Y = new Date().getUTCFullYear() + 1;
const post = (path: string, body: unknown, token?: string) => fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip(), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
const strip = (s: string) => s.replace(/^DTSTAMP:.*$/m, '');

describe('grabAday follow-ups', () => {
  test('.ics with empty/absent Accept-Language and no cookie uses the poll locale (de), not en', async () => {
    const ev = await (await post('/api/events', { title: 'Sommerfest', locale: 'de', options: [{ date: `${Y}-07-03` }] })).json();
    expect((await post(`/api/events/${ev.id}/choose`, { chosen_option_id: ev.time_options[0].id }, ev.admin_token)).status).toBe(200);
    const get = async (h: Record<string, string>, q = '') => strip(await (await fetch(`${BASE}/api/events/${ev.id}/ics${q}`, { headers: { 'X-Forwarded-For': ip(), ...h } })).text());
    const de = await get({}, '?locale=de'), en = await get({}, '?locale=en');
    expect(de).not.toBe(en);
    expect(await get({ 'Accept-Language': '' })).toBe(de);
    expect(await get({ 'Accept-Language': '*' })).toBe(de);
    expect(await get({ 'Accept-Language': 'en' })).toBe(en); // an explicit language still wins
  });

  test('home page has OG + twitter tags with the Doodle UI og-image, and a web manifest with the icons', async () => {
    for (const l of ['en', 'da', 'fr', 'de'].slice(0, 2)) {
      const html = await (await fetch(`${BASE}/${l}`)).text();
      expect(html).toMatch(new RegExp(`<meta property="og:image" content="https?://[^"]*/og-home\\.${l}\\.png"`));
      expect(html).toMatch(new RegExp(`<meta name="twitter:image" content="https?://[^"]*/og-home\\.${l}\\.png"`));
      expect(html).toContain('<meta property="og:image:width" content="1200"'); expect(html).toMatch(/<meta property="og:image:alt" content="grabAday/);
      expect(html).toContain(`<meta property="og:locale" content="${({ en: 'en_GB', da: 'da_DK' } as Record<string, string>)[l]}"`);
      expect(html.match(/<meta property="og:locale:alternate"/g)).toHaveLength(3);
      expect(html).toContain('<meta property="og:site_name" content="grabAday"');
      expect(html).toContain('<meta name="twitter:card" content="summary_large_image"');
      expect(html).toMatch(/<meta name="description" content="[^"]+"/);
      expect(html).toMatch(/<link rel="manifest" href="\/manifest\.webmanifest"/);
    }
    const m = await (await fetch(`${BASE}/manifest.webmanifest`)).json();
    expect(m.name).toBe('grabAday');
    expect(m.icons.map((i: { src: string }) => i.src)).toEqual(expect.arrayContaining(['/brand/icon-512.png']));
    for (const i of m.icons) expect((await fetch(BASE + i.src)).status, i.src).toBe(200);
    for (const l of ['en', 'da', 'fr', 'de']) for (const k of ['og-home', 'og-image']) expect((await fetch(`${BASE}/${k}.${l}.png`)).status, `${k}.${l}`).toBe(200);
  });

  test('German header: 📅 and grabAday stay on one line on iPhone 320/375 (WebKit)', async () => {
    if (!existsSync(pwc.webkit.executablePath())) return;
    const ev = await (await post('/api/events', { title: 'Ein ziemlich langer Umfragetitel für das Team', locale: 'de', options: [{ date: `${Y}-07-03` }] })).json();
    const b = await pwc.webkit.launch();
    try {
      for (const width of [320, 375]) {
        const ctx = await b.newContext({ ...pwc.devices['iPhone SE'], viewport: { width, height: 700 } });
        const pg = await ctx.newPage();
        for (const p of [`/de/p/${ev.id}`, '/de']) {
          await pg.goto(BASE + p);
          const r = await pg.locator('.app-header__logo').evaluate((el) => {
            const lh = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.5;
            return { h: el.getBoundingClientRect().height, lh, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
          });
          expect(r.h, `${p}@${width}`).toBeLessThan(r.lh * 1.5);
          expect(r.sw, `${p}@${width} hscroll`).toBeLessThanOrEqual(r.cw);
        }
        await ctx.close();
      }
    } finally { await b.close(); }
  });
});

describe('§49 compact header + §50', () => {
  test('< 400 px: header is one row, icon-only, targets ≥ 44 px, accessible names kept; de "created" line fits next to ▴ at 320', async () => {
    if (!existsSync(pwc.webkit.executablePath())) return;
    const ev = await (await post('/api/events', { title: 'Kopfzeile', locale: 'de', options: [{ date: `${Y}-07-03` }] })).json();
    const b = await pwc.webkit.launch();
    try {
      for (const width of [320, 360, 390]) for (const L of ['de', 'en']) {
        const ctx = await b.newContext({ ...pwc.devices['iPhone SE'], viewport: { width, height: 700 } });
        const pg = await ctx.newPage();
        await pg.goto(`${BASE}/${L}`);
        await pg.evaluate(([id, tok]) => sessionStorage.setItem(`mt-admin-${id}`, `/p/${id}/admin#${tok}`), [ev.id, ev.admin_token]);
        await pg.goto(`${BASE}/${L}/p/${ev.id}?created=1`);
        await pg.waitForSelector('#share-close');
        const r = await pg.evaluate(() => {
          const h = document.querySelector('.app-header')!.getBoundingClientRect();
          const btns = [...document.querySelectorAll<HTMLElement>('.app-header .icon-btn')].map((x) => { const b = x.getBoundingClientRect(); return { w: b.width, h: b.height, top: b.top, name: x.getAttribute('aria-label') || x.textContent }; });
          const conf = document.querySelector('.share__confirm')!, close = document.querySelector('#share-close')!.getBoundingClientRect(), cr = conf.getBoundingClientRect();
          const lh = parseFloat(getComputedStyle(conf).lineHeight) || 24;
          return { hh: h.height, btns, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, confLines: Math.round(cr.height / lh), overlap: !(close.top >= cr.bottom - 1 || close.left >= cr.right - parseFloat(getComputedStyle(conf).paddingRight)), closeName: document.querySelector('#share-close')!.textContent };
        });
        const tag = `${L}@${width}`;
        expect(r.sw, tag).toBeLessThanOrEqual(r.cw);
        if (width < 400) {
          expect(r.hh, tag).toBeLessThan(70);
          expect(new Set(r.btns.map((x) => Math.round(x.top))).size, tag).toBe(1);
          for (const x of r.btns) { expect(x.w, tag).toBeGreaterThanOrEqual(44); expect(x.name, tag).toBeTruthy(); }
          expect(r.confLines, `${tag} created line`).toBe(1);
        }
        expect(r.overlap, tag).toBe(false);
        expect(r.closeName, tag).toMatch(/Ausblenden|Hide/);
        await ctx.close();
      }
    } finally { await b.close(); }
  });
});
