/** Locale routing (spec §45.1): always-prefixed pages, 308 safety net for unprefixed paths, detection order, API untouched. */
import { describe, test, expect, inject, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import type { Browser } from 'playwright-core';
import { detectLocale, fromAcceptLanguage, swapLocale, localePath } from '../src/i18n/config';
import { switchHref } from '../src/components/LanguageSwitcher';

const BASE = inject('baseUrl');
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const Y = new Date().getUTCFullYear() + 1;
const ip = () => `10.5.${(Math.random() * 255) | 0}.${(Math.random() * 254 + 1) | 0}`;
const get = (p: string, h: Record<string, string> = {}) => fetch(BASE + p, { redirect: 'manual', headers: { 'X-Forwarded-For': ip(), ...h } });
async function poll() {
  const r = await fetch(`${BASE}/api/events`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip() },
    body: JSON.stringify({ title: 'i18n', options: [{ date: `${Y}-11-03` }] }) });
  return r.json() as Promise<{ id: string; admin_token: string }>;
}

describe('locale helpers (unit)', () => {
  test('cookie → Accept-Language (q-values, region tags) → en', () => {
    expect(detectLocale('fr', 'da')).toBe('fr');
    expect(detectLocale('xx', 'da-DK,en;q=0.5')).toBe('da');
    expect(detectLocale(undefined, 'es, de;q=0.3, fr;q=0.8')).toBe('fr');
    expect(detectLocale(undefined, 'es, pt')).toBe('en');
    expect(detectLocale(null, null)).toBe('en');
    expect(fromAcceptLanguage('de;q=0, da;q=0.1')).toBe('da');
  });
  test('swap only the locale segment; keep query + hash', () => {
    expect(swapLocale('/da/p/x/admin', 'de')).toBe('/de/p/x/admin');
    expect(swapLocale('/en', 'fr')).toBe('/fr');
    expect(localePath('da', '/p/x')).toBe('/da/p/x');
    expect(localePath('da', '/?deleted=1')).toBe('/da?deleted=1');
    expect(switchHref({ pathname: '/de/p/x', search: '?created=1', hash: '#edit=abc' }, 'fr')).toBe('/fr/p/x?created=1#edit=abc');
  });
});

describe('redirects + headers (HTTP)', () => {
  test('/ and unprefixed paths → 308 to detected locale, query kept; order cookie > Accept-Language > en', async () => {
    const { id } = await poll();
    let r = await get('/');
    expect(r.status).toBe(308);
    expect(new URL(r.headers.get('location')!, BASE).pathname).toBe('/en');
    r = await get(`/p/${id}?created=1`, { 'Accept-Language': 'da-DK,da;q=0.9,en;q=0.5' });
    expect(r.status).toBe(308);
    const loc = new URL(r.headers.get('location')!, BASE);
    expect(loc.pathname + loc.search).toBe(`/da/p/${id}?created=1`);
    r = await get(`/p/${id}/admin`, { 'Accept-Language': 'da', Cookie: 'NEXT_LOCALE=de' });
    expect(new URL(r.headers.get('location')!, BASE).pathname).toBe(`/de/p/${id}/admin`);
  });
  test('all four locales render with <html lang>, hreflang alternates incl. x-default=/en; poll pages noindex', async () => {
    const { id } = await poll();
    for (const l of ['en', 'da', 'fr', 'de']) {
      for (const p of ['', `/p/${id}`]) {
        const r = await get(`/${l}${p}`);
        expect(r.status, `${l}${p}`).toBe(200);
        const html = await r.text();
        expect(html).toContain(`<html lang="${l}"`);
        expect(html).toMatch(new RegExp(`hrefLang="x-default" href="[^"]*/en${p}"`));
        for (const a of ['en', 'da', 'fr', 'de']) expect(html).toMatch(new RegExp(`hrefLang="${a}" href="[^"]*/${a}${p}"`));
        if (p) expect(html).toMatch(/<meta name="robots" content="noindex/);
      }
    }
  });
  test('admin + mail-token pages: no-store, noindex, no-referrer under every locale', async () => {
    const { id } = await poll();
    for (const l of ['en', 'da', 'fr', 'de']) {
      for (const p of [`/p/${id}/admin`, `/u/p/${'A'.repeat(43)}`, `/abuse/${'A'.repeat(43)}`]) {
        const r = await get(`/${l}${p}`);
        expect(r.headers.get('cache-control'), `${l}${p}`).toMatch(/no-store/);
        expect(r.headers.get('x-robots-tag')).toMatch(/noindex/);
        expect(r.headers.get('referrer-policy')).toBe('no-referrer');
      }
    }
  });
  test('middleware does not touch /api, assets, OG images (no locale redirect)', async () => {
    const { id } = await poll();
    for (const p of [`/api/events/${id}`, '/styles.css', '/brand/favicon.svg', `/en/p/${id}/opengraph-image`]) {
      const r = await get(p);
      expect(r.status, p).toBe(200);
      expect(r.headers.get('location')).toBeNull();
    }
    expect((await get('/api/cron/cleanup')).status).toBe(401); // reached the route, not redirected
    expect((await fetch(`${BASE}/api/webhooks/resend`, { method: 'POST', redirect: 'manual', body: '{}' })).status).not.toBe(308);
    expect((await get('/en/nope')).status).toBe(404);
  });
});

describe.skipIf(!existsSync(CHROME))('browser: fragments + switcher (headless Chrome)', () => {
  let browser: Browser;
  beforeAll(async () => { const { chromium } = await import('playwright-core'); browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] }); });
  afterAll(async () => { await browser?.close(); });

  test('308 keeps #fragment (admin token, #edit, #inv); switcher keeps path + query + hash and sets the cookie', async () => {
    const { id, admin_token } = await poll();
    const ctx = await browser.newContext({ locale: 'da-DK' });
    const p = await ctx.newPage();
    const seen: string[] = [];
    p.on('framenavigated', (f) => { if (f === p.mainFrame()) seen.push(f.url()); });
    await p.goto(`${BASE}/p/${id}/admin#${admin_token}`);
    expect(seen.some((u) => u.endsWith(`/da/p/${id}/admin#${admin_token}`))).toBe(true);
    await p.waitForSelector('#toggle'); // token from the fragment worked → admin UI loaded
    for (const frag of ['#edit=abc', `#inv=${'B'.repeat(43)}`]) {
      seen.length = 0;
      await p.goto(`${BASE}/p/${id}?x=1${frag}`);
      expect(seen.some((u) => u.endsWith(`/da/p/${id}?x=1${frag}`)), seen.join()).toBe(true);
    }
    await ctx.clearCookies();
    const q = await ctx.newPage(); await p.close();
    const pp = q;
    await pp.goto(`${BASE}/da/p/${id}?x=1#keep`);
    await pp.waitForSelector('#lang-btn');
    expect(pp.url()).toContain('#keep');
    await pp.waitForLoadState('networkidle');
    await pp.click('#lang-btn');
    await pp.waitForSelector('#lang-menu:not([hidden])');
    expect(await pp.getAttribute('#lang-menu a[aria-current="true"]', 'lang')).toBe('da');
    expect(await pp.$$eval('#lang-menu a', (as) => as.map((a) => a.textContent))).toEqual(['English', '✓Dansk', 'Français', 'Deutsch']);
    await pp.keyboard.press('ArrowDown'); // focus starts on da → fr
    await Promise.all([pp.waitForURL(`**/fr/p/${id}?x=1#keep`), pp.keyboard.press('Enter')]);
    expect(await pp.getAttribute('html', 'lang')).toBe('fr');
    expect((await ctx.cookies()).find((c) => c.name === 'NEXT_LOCALE')?.value).toBe('fr');
    await ctx.close();
  }, 40_000);
});
