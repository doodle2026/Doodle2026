import { describe, test, expect, inject } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = inject('baseUrl');
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
interface Res { status: number; headers: Headers; body: Json; text: string }

async function call(path: string, init: RequestInit = {}): Promise<Res> {
  // Fresh client IP per request so the per-IP rate limiter doesn't interfere (it has its own tests).
  const headers = { 'X-Forwarded-For': `10.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}`, ...(init.headers as Record<string, string> ?? {}) };
  const r = await fetch(BASE + path, { redirect: 'manual', ...init, headers });
  const text = await r.text();
  let body: Json = {};
  try { body = JSON.parse(text); } catch { /* html/text */ }
  return { status: r.status, headers: r.headers, body, text };
}
const postRaw = (body: string, headers: Record<string, string> = {}) =>
  call('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
const post = (body: unknown, headers: Record<string, string> = {}) => postRaw(JSON.stringify(body), headers);

// Real clock: build times relative to "now" (server uses wall clock).
const DAY = 86_400_000;
const base = new Date(Date.UTC(new Date().getUTCFullYear() + 1, 10, 3)); // 3 Nov next year (CET, UTC+1)
const Y = base.getUTCFullYear();
const iso = (s: string) => `${Y}-${s}`;
const d = (date: string) => ({ date });
const valid = () => ({ title: '  Teammøde  ', description: '  Kvartalsmøde \n', options: [d(iso('11-05')), d(iso('11-03')), d(iso('11-04'))] });
const utcToday = () => new Date().toISOString().slice(0, 10);
const addDays = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
let keySeq = 0;
const uniqueKey = (p: string) => `${p}-${Date.now().toString(36)}-${keySeq++}-${Math.random().toString(36).slice(2, 10)}`;

describe('create + fetch', () => {
  test('creates a date poll: plain dates, sorted ascending, no time zone anywhere', async () => {
    const c = await post(valid());
    expect(c.status).toBe(201);
    expect(c.body.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(c.body.url).toBe(`/p/${c.body.id}`);
    expect(c.headers.get('location')).toBe(`/p/${c.body.id}`);
    const g = await call(`/api/events/${c.body.id}`);
    expect(g.status).toBe(200);
    expect(g.body.title).toBe('Teammøde');
    expect(g.body.description).toBe('Kvartalsmøde');
    expect(g.body.time_options.map((o: Json) => o.date)).toEqual([iso('11-03'), iso('11-04'), iso('11-05')]);
    expect(g.body.time_options[0]).not.toHaveProperty('start_at');
    expect(g.body).not.toHaveProperty('mode');
    expect(g.body.options.map((o: Json) => o.date)).toEqual([iso('11-03'), iso('11-04'), iso('11-05')]);
    expect(g.body).not.toHaveProperty('timezone');
  });

  test('ids are unique', async () => {
    const [a, b] = await Promise.all([post(valid()), post(valid())]);
    expect(a.body.id).not.toBe(b.body.id);
  });

  test('duplicate dates → clear 400 (not deduplicated)', async () => {
    const r = await post({ title: 'x', options: [d(iso('11-03')), d(iso('11-04')), d(iso('11-03'))] });
    expect(r.status).toBe(400);
    expect(r.body.errors).toEqual([`Dato 3: ${iso('11-03')} er valgt flere gange.`]);
  });

  test('time_options with times is rejected – polls are date-only', async () => {
    const r = await post({ title: 'x', time_options: [{ start: iso('11-03T09:00:00Z') }] });
    expect(r.status).toBe(400);
    expect(r.body.errors[0]).toMatch(/options/);
  });
});

describe('validation → 400, never 500', () => {
  const o1 = [d(iso('11-03'))];
  const weird: [string, unknown][] = [
    ['null body', 'null'], ['array body', '[]'], ['string body', '"hi"'], ['number body', '42'], ['empty body', ''],
    ['title number', { title: 5, options: o1 }],
    ['title object', { title: { a: 1 }, options: o1 }],
    ['description array', { title: 'x', description: [1], options: o1 }],
    ['options string', { title: 'x', options: 'tomorrow' }],
    ['options object', { title: 'x', options: { 0: o1[0] } }],
    ['option null', { title: 'x', options: [null] }],
    ['option number', { title: 'x', options: [7] }],
    ['date number', { title: 'x', options: [{ date: 1762160400000 }] }],
    ['date object', { title: 'x', options: [{ date: { $gt: '' } }] }],
    ['date with time', { title: 'x', options: [{ date: iso('11-03T09:00:00Z') }] }],
  ];
  test.each(weird)('%s', async (_name, body) => {
    const r = await postRaw(typeof body === 'string' ? body : JSON.stringify(body));
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(Array.isArray(r.body.errors) && r.body.errors.length > 0).toBe(true);
  });

  test('H1: non-application/json content types → 415 (CSRF), even with a valid JSON body', async () => {
    const good = JSON.stringify(valid());
    for (const ct of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/jsonx']) {
      const r = await call('/api/events', { method: 'POST', headers: { 'Content-Type': ct }, body: good });
      expect(r.status, ct).toBe(415);
      expect(r.headers.get('content-type')).toMatch(/json/);
    }
    const none = await call('/api/events', { method: 'POST', body: new Blob([good]) });
    expect(none.status).toBe(415);
    expect((await post(valid(), { 'Content-Type': 'application/json; charset=utf-8' })).status).toBe(201);
  });
  test('malformed JSON', async () => {
    expect((await postRaw('{bad')).status).toBe(400);
  });
  test('missing/blank title and no options', async () => {
    const r = await post({ title: '   ', options: [] });
    expect(r.status).toBe(400);
    expect(r.body.errors).toHaveLength(2);
  });
  test('max lengths: title 200, description 2000 (after trim)', async () => {
    expect((await post({ title: 'a'.repeat(200), description: 'b'.repeat(2000), options: o1 })).status).toBe(201);
    expect((await post({ title: ' ' + 'a'.repeat(200) + ' ', options: o1 })).status).toBe(201);
    expect((await post({ title: 'a'.repeat(201), options: o1 })).status).toBe(400);
    expect((await post({ title: 'x', description: 'b'.repeat(2001), options: o1 })).status).toBe(400);
  });
  test('M1: over-long title/description → 400, never truncated', async () => {
    const t = 'a'.repeat(5000);
    const r = await post({ title: t, description: 'b'.repeat(10000), options: o1 });
    expect(r.status).toBe(400);
    expect(r.body.errors).toEqual(['Titel må højst være 200 tegn.', 'Beskrivelse må højst være 2000 tegn.']);
    const ok = await post({ title: 'a'.repeat(200), description: 'b'.repeat(2000), options: o1 });
    expect(ok.body.title).toHaveLength(200);
    expect(ok.body.description).toHaveLength(2000);
  });
  test('M2: whitespace / zero-width-only titles rejected', async () => {
    for (const t of ['\u200B\u200B', ' \u200C\u200D\uFEFF ', '\u2060', '\u00A0\u3000\t\n', '\u00AD']) {
      const r = await post({ title: t, options: o1 });
      expect(r.status, JSON.stringify(t)).toBe(400);
      expect(r.body.errors).toContain('Titel er påkrævet.');
    }
    expect((await post({ title: 'a\u200Bb', options: o1 })).status).toBe(201);
  });
  test('L1: lengths counted in graphemes (👨‍👩‍👧‍👦 = 1, 👍🏽 = 1)', async () => {
    const fam = '👨‍👩‍👧‍👦';
    const ok = await post({ title: fam.repeat(200), description: '👍🏽'.repeat(2000), options: o1 });
    expect(ok.status).toBe(201);
    expect(ok.body.title).toBe(fam.repeat(200));
    expect((await post({ title: fam.repeat(201), options: o1 })).status).toBe(400);
    expect((await post({ title: 'x', description: '👍🏽'.repeat(2001), options: o1 })).status).toBe(400);
  });
  test('1–100 dates: 100 ok, 101 rejected, 0 rejected', async () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => d(addDays(iso('01-01'), i)));
    expect((await post({ title: 'x', options: mk(100) })).status).toBe(201);
    const r = await post({ title: 'x', options: mk(101) });
    expect(r.status).toBe(400);
    expect(r.body.errors).toEqual(['Højst 100 datoer.']);
    expect((await post({ title: 'x', options: [] })).body.errors).toContain('Mindst én dato er påkrævet.');
  });
  test('real calendar dates only: leap years (2028-02-29 ok, 2027-02-29 not), month/day ranges, strict format', async () => {
    expect((await post({ title: 'x', options: [d('2028-02-29')] })).status).toBe(201);
    const r = await post({ title: 'x', options: [d('2027-02-29'), d(`${Y}-04-31`), d(`${Y}-13-01`), d(`${Y}-1-05`), d(`${Y}-11-03 `), d('')] });
    expect(r.status).toBe(400);
    expect(r.body.errors).toHaveLength(6);
    expect(r.body.errors[0]).toMatch(/^Dato 1: ugyldig dato/);
  });
  test('today boundary: accepts dates ≥ UTC today − 1 day (no valid local today rejected), rejects older', async () => {
    const t = utcToday();
    for (const ok of [addDays(t, -1), t, addDays(t, 1)]) expect((await post({ title: 'x', options: [d(ok)] })).status, ok).toBe(201);
    const r = await post({ title: 'x', options: [d(addDays(t, -2))] });
    expect(r.status).toBe(400);
    expect(r.body.errors[0]).toMatch(/fortiden/);
  });
});

describe('limits & idempotency', () => {
  test('payload > 32kb → 413 JSON', async () => {
    const r = await post({ title: 'x', description: 'a'.repeat(40 * 1024), options: [] });
    expect(r.status).toBe(413);
    expect(r.headers.get('content-type')).toMatch(/json/);
    expect(r.body.errors.length).toBeGreaterThan(0);
  });
  test('same Idempotency-Key returns same poll', async () => {
    const key = uniqueKey('same');
    const a = await post(valid(), { 'Idempotency-Key': key });
    expect(a.status).toBe(201);
    const b = await post(valid(), { 'Idempotency-Key': key });
    expect(b.status).toBe(200);
    expect(b.body.id).toBe(a.body.id);
    expect(b.headers.get('idempotent-replayed')).toBe('true');
    const c = await post(valid(), { 'Idempotency-Key': uniqueKey('other') });
    expect(c.status).toBe(201);
    expect(c.body.id).not.toBe(a.body.id);
  });
  test('concurrent submits with same key create one poll', async () => {
    const key = uniqueKey('concurrent');
    const rs = await Promise.all([1, 2, 3, 4, 5].map(() => post(valid(), { 'Idempotency-Key': key })));
    expect(rs.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(rs.map((r) => r.body.id)).size).toBe(1);
  });
  test('malformed or too short (< 16) Idempotency-Key → 400', async () => {
    expect((await post(valid(), { 'Idempotency-Key': 'bad key! bad key!' })).status).toBe(400);
    expect((await post(valid(), { 'Idempotency-Key': 'short-key-15chr' })).status).toBe(400);
  });
});

describe('slugs, pages, XSS', () => {
  test('404 for unknown and malformed slugs', async () => {
    expect((await call('/api/events/AAAAAAAAAAAAAAAAAAAAAA')).status).toBe(404);
    expect((await call('/p/AAAAAAAAAAAAAAAAAAAAAA')).status).toBe(404);
    for (const s of ['short', '%3Cscript%3E', 'a'.repeat(23), "x'%20OR%201=1--aaaaaaaaaa"]) {
      expect((await call(`/api/events/${s}`)).status, s).toBe(404);
      expect((await call(`/p/${s}`)).status, s).toBe(404);
    }
  });
  test('/e/:id redirects to /p/:id', async () => {
    const { body: { id } } = await post(valid());
    const r = await call(`/e/${id}`);
    expect(r.status).toBe(301);
    expect(r.headers.get('location')).toMatch(new RegExp(`/p/${id}$`));
    expect((await call('/e/bad')).status).toBe(404);
  });
  test('view page server-renders escaped <title> and og tags, og:url from APP_URL', async () => {
    const evil = `</title><script>alert(1)</script>"'&`;
    const { body: { id } } = await post({ title: evil, description: '"><img src=x onerror=alert(1)>', options: [d(iso('11-03'))] });
    const r = await call(`/p/${id}`, { headers: { Host: 'evil.example' } });
    expect(r.status).toBe(200);
    expect(r.text).not.toContain('<script>alert');
    expect(r.text).not.toContain('<img src=x');
    expect(r.text).toContain('<title>&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;&quot;&#x27;&amp; – GrabAday</title>');
    expect(r.text).toMatch(/<meta property="og:title" content="&lt;\/title&gt;/);
    expect(r.text).toMatch(new RegExp(`<meta property="og:url" content="https?://[^"]+/p/${id}"`));
    expect(r.text).not.toContain('evil.example');
    expect(r.headers.get('content-security-policy')).toMatch(/default-src 'self'/);
    const api = await call(`/api/events/${id}`);
    expect(api.body.title).toBe(evil); // stored raw; React escapes on render
  });
  test('frontend never uses innerHTML / dangerouslySetInnerHTML', () => {
    for (const f of ['src/app/CreateForm.tsx', 'src/app/p/[id]/PollView.tsx', 'src/app/p/[id]/page.tsx']) {
      expect(readFileSync(join(__dirname, '..', f), 'utf8'), f).not.toMatch(/innerHTML/);
    }
    // The only dangerouslySetInnerHTML is the constant theme-init script (no user data).
    for (const f of ['src/app/layout.tsx']) {
      expect(readFileSync(join(__dirname, '..', f), 'utf8')).toMatch(/__html: THEME_INIT_SCRIPT \}/);
    }
  });
  test('L4: friendly 404 pages (poll + generic) and favicon', async () => {
    const p = await call('/p/AAAAAAAAAAAAAAAAAAAAAA');
    expect(p.status).toBe(404);
    expect(p.text).toContain('Hov, den afstemning kan vi ikke finde');
    expect(p.text).toContain('store og små');
    expect(p.text).toContain('class="btn btn--primary" href="/"');
    expect(p.text).toContain('← Gå tilbage');
    expect(p.text).toContain('href="/styles.css"');
    expect(p.text).toMatch(/<meta name="robots" content="noindex/);
    expect(p.text).toContain('<html lang="da"');
    const g = await call('/findes-ikke');
    expect(g.status).toBe(404);
    expect(g.text).toContain('Hov, den side kan vi ikke finde');
    expect(g.text).toContain('<link rel="icon" href="/brand/favicon.svg" type="image/svg+xml"/>');
    expect(g.text).toContain('<link rel="icon" href="/brand/favicon-32.png" type="image/png" sizes="32x32"/>');
    expect(g.text).toContain('<link rel="apple-touch-icon" href="/brand/apple-touch-icon.png" sizes="180x180"/>');
    const trav = await call('/p/..%2F..%2Fetc%2Fpasswd');
    expect(trav.status).toBe(404);
    expect(trav.text).toContain('Hov, den afstemning kan vi ikke finde');
    for (const [path, type] of [['/brand/favicon.svg', /svg/], ['/brand/favicon-32.png', /png/], ['/brand/apple-touch-icon.png', /png/], ['/brand/icon-512.png', /png/]] as const) {
      const icon = await fetch(BASE + path);
      expect(icon.status, path).toBe(200);
      expect(icon.headers.get('content-type'), path).toMatch(type);
    }
  });
  test('M3: create page has counters and no maxlength truncation', async () => {
    const r = await call('/');
    expect(r.status).toBe(200);
    expect(r.text).not.toMatch(/maxlength/i);
    expect(r.text).toContain('id="title-count"');
    expect(r.text).toContain('0 / 200');
    expect(r.text).toContain('0 / 2000');
    expect(r.text).toContain('id="theme-toggle"');
    expect(r.text).toMatch(/<script nonce="[^"]+">\(function\(\)\{try\{var q=/); // theme init before paint, CSP-nonced
  });
  test('link-preview meta per design §14.3 (absolute URLs, locale, canonical, description)', async () => {
    const { body: { id } } = await post({ title: 'Frokost & "kage"', description: '', options: [
      d(iso('10-14')), d(iso('10-16')) ] });
    const r = await call(`/p/${id}`);
    expect(r.text).toContain(`<link rel="canonical" href="${BASE}/p/${id}"`);
    expect(r.text).toContain('<meta property="og:locale" content="da_DK"');
    expect(r.text).toContain('<meta property="og:site_name" content="GrabAday"');
    expect(r.text).toContain('<meta property="og:title" content="Frokost &amp; &quot;kage&quot;"');
    expect(r.text).toContain(`<meta name="description" content="Vælg de datoer, der passer dig. 2 datoforslag, 14.–16. oktober ${Y}."`);
    expect(r.text).toContain('<meta name="twitter:title" content="Frokost &amp; &quot;kage&quot;"');
    expect(r.text).toContain('<meta name="theme-color" content="#2B6CB0"');
  });
  test('?created=1 opens the share box for the organizer; visitors see it closed', async () => {
    const { body: { id } } = await post(valid());
    const org = await call(`/p/${id}?created=1`);
    expect(org.status).toBe(200);
    expect(org.text).toMatch(/<section class="share" id="share" aria-labelledby="share-h">/);
    expect(org.text).toContain('Din afstemning er oprettet');
    expect(org.text).toMatch(/id="share-open"[^>]*aria-expanded="true"/);
    const vis = await call(`/p/${id}`);
    expect(vis.text).toMatch(/<section class="share" id="share" aria-labelledby="share-h" hidden="">/);
    expect(vis.text).not.toContain('Din afstemning er oprettet');
    expect(vis.text).toMatch(/id="share-open"[^>]*aria-expanded="false"/);
  });
  test('unknown /api route → 404 JSON', async () => {
    const r = await call('/api/nope');
    expect(r.status).toBe(404);
    expect(r.headers.get('content-type')).toMatch(/json/);
  });
});

describe('invisible characters in titles (shared INVISIBLE_RE)', () => {
  test('format chars (ZWJ outside emoji, soft hyphen, ZWNJ, bidi, BOM) are stripped; emoji ZWJ kept', async () => {
    const r = await post({ title: '\u202EM\u00ADø\u200Cde\u200D\uFEFF\u2066 👨‍👩‍👧', description: 'a\u200Bb', options: [d(iso('11-03'))] });
    expect(r.status).toBe(201);
    expect(r.body.title).toBe('Møde 👨‍👩‍👧');
    expect(r.body.description).toBe('ab');
    for (const t of ['\u00AD', '\u200C\u200D', '\u2066\u2069', '\u202E', '\u034F\u061C']) expect((await post({ title: t, options: [d(iso('11-03'))] })).status).toBe(400);
  });
});

describe('admin token (no accounts)', () => {
  const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
  const leaks = (text: string, token: string) => text.includes(token);
  const hasSecretField = (o: unknown): boolean =>
    JSON.stringify(o).match(/"[^"]*(token|hash|secret)[^"]*"\s*:/i) !== null;

  test('201 returns a 256-bit admin token + admin_url exactly once; GET never does', async () => {
    const c = await post(valid());
    expect(c.status).toBe(201);
    expect(c.body.admin_token).toMatch(TOKEN_RE);
    expect(c.body.admin_url).toBe(`/p/${c.body.id}/admin#${c.body.admin_token}`); // fragment: never sent to servers
    expect(c.headers.get('cache-control')).toMatch(/no-store/);
    const g = await call(`/api/events/${c.body.id}`);
    expect(g.status).toBe(200);
    expect(hasSecretField(g.body)).toBe(false);
    expect(leaks(g.text, c.body.admin_token)).toBe(false);
    expect(g.body.is_closed).toBe(false);
    expect(g.body.closed_at).toBeNull();
    const other = await post(valid());
    expect(other.body.admin_token).not.toBe(c.body.admin_token);
  });

  test('idempotent replay (same key) returns the same token; a different key does not', async () => {
    const key = uniqueKey('admin-replay-key');
    const a = await post(valid(), { 'Idempotency-Key': key });
    const b = await post(valid(), { 'Idempotency-Key': key });
    expect(b.status).toBe(200);
    expect(b.body.admin_token).toBe(a.body.admin_token);
    const rs = await Promise.all([1, 2, 3].map(() => post(valid(), { 'Idempotency-Key': key + 'c' })));
    expect(new Set(rs.map((r) => r.body.admin_token)).size).toBe(1);
  });

  test('token never appears in public pages, meta, 404s, errors or server logs', async () => {
    const c = await post(valid());
    const { id, admin_token: token } = c.body;
    const pages = [
      await call(`/p/${id}`), await call(`/p/${id}?created=1`), await call(`/e/${id}`), await call(`/p/${id}/admin`),
      await call(`/api/events/${id}`), await postRaw('{"title": 1}'),
      await call(`/api/events/${id}/admin`, { headers: { Authorization: `Bearer ${token.slice(0, -1)}x` } }),
    ];
    for (const r of pages) expect(leaks(r.text + JSON.stringify([...r.headers]), token)).toBe(false);
    // Admin page shell: public data only, no canonical/og:url, noindex/no-store/no-referrer.
    const adm = await call(`/p/${id}/admin`);
    expect(adm.status).toBe(200);
    expect(adm.text).not.toMatch(/rel="canonical"|property="og:/);
    expect(adm.text).toMatch(/<meta name="robots" content="noindex/);
    expect(adm.headers.get('cache-control')).toMatch(/no-store/);
    expect(adm.headers.get('referrer-policy')).toBe('no-referrer');
    expect(adm.headers.get('x-robots-tag')).toMatch(/noindex/);
    // Using the token (Bearer) works and is not logged either.
    const ok = await call(`/api/events/${id}/admin`, { headers: { Authorization: `Bearer ${token}` } });
    expect(ok.status).toBe(200);
    const log = inject('serverLog');
    if (log) {
      await new Promise((r) => setTimeout(r, 300));
      expect(readFileSync(log, 'utf8')).not.toContain(token);
    }
  });

  test('N1: admin/edit routes incl. redirects send no-store + noindex + no-referrer', async () => {
    const c = await post(valid());
    const { id, admin_token: token } = c.body;
    for (const path of [`/p/${id}/admin`, `/p/${id}/admin/`, `/p/${id}/admin/${token}`, `/p/${id}/admin/${'B'.repeat(43)}/`,
      `/p/${id}?edit=${'C'.repeat(43)}`, `/p/AAAAAAAAAAAAAAAAAAAAAA/admin`]) {
      const r = await call(path);
      expect(r.headers.get('referrer-policy'), path).toBe('no-referrer');
      expect(r.headers.get('x-robots-tag'), path).toMatch(/noindex, nofollow/);
      expect(r.headers.get('cache-control'), path).toMatch(/no-store/);
      if (r.status === 200) expect(r.text, path).toMatch(/<meta name="robots" content="noindex/);
      expect(r.text, path).not.toMatch(/property="og:|rel="canonical"/);
    }
  });

  test('legacy /p/<id>/admin/<token> → 302 to /p/<id>/admin#<token> (no DB check, no cache)', async () => {
    const c = await post(valid());
    const { id, admin_token: token } = c.body;
    for (const t of [token, 'A'.repeat(43)]) {
      const r = await call(`/p/${id}/admin/${t}`);
      expect(r.status).toBe(302);
      expect(r.headers.get('location')).toBe(`/p/${id}/admin#${t}`);
      expect(r.headers.get('cache-control')).toMatch(/no-store/);
    }
    const slash = await call(`/p/${id}/admin/`);
    expect(slash.status).toBe(308);
    expect(slash.headers.get('location')).toBe(`/p/${id}/admin`);
  });

  test('admin page for unknown poll → friendly 404', async () => {
    const r = await call('/p/AAAAAAAAAAAAAAAAAAAAAA/admin');
    expect(r.status).toBe(404);
    expect(r.text).toContain('Hov, den afstemning kan vi ikke finde');
  });
});

describe('OG image route + link preview', () => {
  const pngSize = (buf: Buffer) => ({ sig: buf.subarray(1, 4).toString(), w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });

  test('GET /p/<id>/opengraph-image → 1200×630 PNG, cacheable', async () => {
    const { body: { id } } = await post({ title: '👨‍👩‍👧‍👦 Familiemiddag </title><script>x</script> ' + 'lang '.repeat(30), options: [d(iso('11-03'))] });
    const r = await fetch(`${BASE}/p/${id}/opengraph-image`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/png');
    expect(r.headers.get('cache-control')).toMatch(/public, max-age=86400/);
    const buf = Buffer.from(await r.arrayBuffer());
    expect(pngSize(buf)).toEqual({ sig: 'PNG', w: 1200, h: 630 });
    expect(buf.length).toBeGreaterThan(10_000);
  }, 60_000);

  test('unknown or malformed id → 404, no image', async () => {
    for (const s of ['AAAAAAAAAAAAAAAAAAAAAA', 'short', '%3Cscript%3E']) {
      const r = await fetch(`${BASE}/p/${s}/opengraph-image`);
      expect(r.status, s).toBe(404);
      expect(r.headers.get('content-type')).not.toMatch(/image/);
    }
  });

  test('poll page: og:image + twitter summary_large_image with absolute URLs, escaped alt, no token', async () => {
    const c = await post({ title: 'Møde "A" & <b>B</b>', options: [d(iso('11-03'))] });
    const { id, admin_token: token } = c.body;
    const r = await call(`/p/${id}`);
    const img = `${BASE}/p/${id}/opengraph-image`;
    expect(r.text).toContain(`<meta property="og:image" content="${img}"/>`);
    expect(r.text).toContain('<meta property="og:image:width" content="1200"/>');
    expect(r.text).toContain('<meta property="og:image:height" content="630"/>');
    expect(r.text).toContain('<meta property="og:image:alt" content="GrabAday-afstemning: Møde &quot;A&quot; &amp; &lt;b&gt;B&lt;/b&gt;"/>');
    expect(r.text).toContain('<meta name="twitter:card" content="summary_large_image"/>');
    expect(r.text).toContain(`<meta name="twitter:image" content="${img}"/>`);
    expect(r.text).not.toContain(token);
    // Admin page: still no OG image / preview tags
    const adm = await call(`/p/${id}/admin`);
    expect(adm.text).not.toMatch(/og:image|twitter:/);
  });
});
