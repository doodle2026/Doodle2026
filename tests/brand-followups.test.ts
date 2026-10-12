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
        if (width < 480) {
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

describe('§49 regression (PR #37 review): header never wraps, 320–480 px, all languages', () => {
  test('poll/confirmation + home: one header row at every width (2–3 px steps), icon-only below 480, created line never beside ▴', async () => {
    if (!existsSync(pwc.webkit.executablePath())) return;
    const widths = [...new Set([...Array.from({ length: 55 }, (_, i) => 320 + i * 3), 500, 560, 600, 639, 640, 700, 398, 399, 400, 401, 402, 410, 412, 414, 428, 430, 440, 478, 479, 480])].sort((a, b) => a - b);
    const b = await pwc.webkit.launch();
    const bad: string[] = [];
    try {
      for (const L of ['da', 'de', 'en', 'fr']) {
        const ev = await (await post('/api/events', { title: 'Kopfzeile', locale: L, options: [{ date: `${Y}-07-03` }] })).json();
        const ctx = await b.newContext({ ...pwc.devices['iPhone SE'], viewport: { width: 480, height: 800 } });
        const pg = await ctx.newPage();
        await pg.goto(`${BASE}/${L}`);
        await pg.evaluate(([id, tok]) => sessionStorage.setItem(`mt-admin-${id}`, `/p/${id}/admin#${tok}`), [ev.id, ev.admin_token]);
        for (const page of [`/${L}/p/${ev.id}?created=1`, `/${L}`]) {
          await pg.goto(BASE + page); await pg.waitForSelector('#theme-toggle');
          for (const w of widths) {
            await pg.setViewportSize({ width: w, height: 800 });
            const r = await pg.evaluate(() => {
              const h = document.querySelector('.app-header')!, hb = h.getBoundingClientRect();
              const items = [h.querySelector('.app-header__logo')!, ...h.querySelectorAll('.icon-btn')].map((x) => x.getBoundingClientRect());
              const lbl = document.querySelector('.app-header .hdr-lbl'); const lblHidden = lbl ? lbl.getBoundingClientRect().width <= 1 : true;
              const conf = document.querySelector('.share__confirm'), close = document.querySelector('#share-close');
              let beside = false, confLines = 1;
              if (conf && close && (conf as HTMLElement).offsetParent) {
                const cr = conf.getBoundingClientRect(), cl = close.getBoundingClientRect();
                beside = cl.top < cr.bottom - 1 && cl.left < cr.right; confLines = Math.round(cr.height / (parseFloat(getComputedStyle(conf).lineHeight) || 24));
              }
              return { hh: hb.height, rows: new Set(items.map((x) => Math.round(x.top + x.height / 2) >> 3)).size, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, lblHidden, beside, confLines, wrapped: confLines > 1 && beside };
            });
            const tag = `${page}@${w}`;
            if (r.rows !== 1 || r.hh > 70) bad.push(`${tag} header rows=${r.rows} h=${r.hh}`);
            if (r.sw > r.cw) bad.push(`${tag} h-scroll`);
            if (w < 480 && !r.lblHidden) bad.push(`${tag} labels visible`);
            if (r.wrapped) bad.push(`${tag} confirmation wraps beside Ausblenden`);
            if (w < 480 && page.includes('created') && r.confLines > 1) bad.push(`${tag} created line ${r.confLines} lines`);
          }
        }
        await ctx.close();
      }
    } finally { await b.close(); }
    expect(bad).toEqual([]);
  }, 300_000);
  test('language button: accessible name + title; French uses "Langue : Français"', async () => {
    for (const [L, name] of [['fr', 'Langue : Français'], ['de', 'Sprache: Deutsch'], ['en', 'Language: English'], ['da', 'Sprog: Dansk']]) {
      const html = await (await fetch(`${BASE}/${L}`)).text();
      const btn = /<button[^>]*id="lang-btn"[^>]*>/.exec(html)![0];
      expect(btn, L).toContain(`aria-label="${name}"`); expect(btn, L).toContain(`title="${name}"`);
    }
  });
});
