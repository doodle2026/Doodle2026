import { describe, test, expect, inject } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = inject('baseUrl');
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
interface Res { status: number; headers: Headers; body: Json; text: string }

async function call(path: string, init: RequestInit = {}): Promise<Res> {
  const r = await fetch(BASE + path, { redirect: 'manual', ...init });
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
const opt = (start: string, end?: string | null) => (end === undefined ? { start } : { start, end });
const valid = () => ({
  title: '  Teammøde  ', description: '  Kvartalsmøde \n',
  time_options: [
    opt(iso('11-05T14:00:00+01:00'), iso('11-05T15:00:00+01:00')),
    opt(iso('11-03T09:00:00+01:00')),
    opt(iso('11-03T08:30:00Z'), ''),
  ],
});
let keySeq = 0;
const uniqueKey = (p: string) => `${p}-${Date.now().toString(36)}-${keySeq++}-${Math.random().toString(36).slice(2, 10)}`;

describe('create + fetch', () => {
  test('creates, stores UTC, sorts, returns design shape', async () => {
    const c = await post(valid());
    expect(c.status).toBe(201);
    expect(c.body.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(c.body.url).toBe(`/p/${c.body.id}`);
    expect(c.headers.get('location')).toBe(`/p/${c.body.id}`);
    const g = await call(`/api/events/${c.body.id}`);
    expect(g.status).toBe(200);
    expect(g.body.title).toBe('Teammøde');
    expect(g.body.description).toBe('Kvartalsmøde');
    expect(g.body.time_options.map((o: Json) => [o.start_at, o.end_at])).toEqual([
      [iso('11-03T08:00:00.000Z'), null],
      [iso('11-03T08:30:00.000Z'), null],
      [iso('11-05T13:00:00.000Z'), iso('11-05T14:00:00.000Z')],
    ]);
    expect(g.body.timezone).toBe('UTC');
    expect(g.body.options[0]).toEqual({ date: iso('11-03'), start: '08:00', end: null });
  });

  test('?tz= renders design options in that zone; invalid tz falls back to UTC', async () => {
    const { body: { id } } = await post(valid());
    const cph = await call(`/api/events/${id}?tz=Europe/Copenhagen`);
    expect(cph.body.timezone).toBe('Europe/Copenhagen');
    expect(cph.body.options[2]).toEqual({ date: iso('11-05'), start: '14:00', end: '15:00' });
    const bad = await call(`/api/events/${id}?tz=Not/AZone`);
    expect(bad.status).toBe(200);
    expect(bad.body.timezone).toBe('UTC');
  });

  test('ids are unique', async () => {
    const [a, b] = await Promise.all([post(valid()), post(valid())]);
    expect(a.body.id).not.toBe(b.body.id);
  });

  test('duplicates (same instant, different offsets) are deduplicated', async () => {
    const r = await post({ title: 'x', time_options: [
      opt(iso('11-03T09:00:00+01:00'), iso('11-03T10:00:00+01:00')),
      opt(iso('11-03T08:00:00Z'), iso('11-03T09:00:00Z')),
      opt(iso('11-03T09:00:00+01:00')),
      opt(iso('11-03T09:00:00+01:00'), null),
    ] });
    expect(r.status).toBe(201);
    expect(r.body.time_options).toHaveLength(2);
  });
});

describe('validation → 400, never 500', () => {
  const o1 = [opt(iso('11-03T09:00:00Z'))];
  const weird: [string, unknown][] = [
    ['null body', 'null'], ['array body', '[]'], ['string body', '"hi"'], ['number body', '42'], ['empty body', ''],
    ['title number', { title: 5, time_options: o1 }],
    ['title object', { title: { a: 1 }, time_options: o1 }],
    ['description array', { title: 'x', description: [1], time_options: o1 }],
    ['options string', { title: 'x', time_options: 'tomorrow' }],
    ['options object', { title: 'x', time_options: { 0: o1[0] } }],
    ['option null', { title: 'x', time_options: [null] }],
    ['option number', { title: 'x', time_options: [7] }],
    ['start number', { title: 'x', time_options: [{ start: 1762160400000 }] }],
    ['start object', { title: 'x', time_options: [{ start: { $gt: '' } }] }],
    ['end bool', { title: 'x', time_options: [{ start: iso('11-03T09:00:00Z'), end: true }] }],
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
    const r = await post({ title: '   ', time_options: [] });
    expect(r.status).toBe(400);
    expect(r.body.errors).toHaveLength(2);
  });
  test('max lengths: title 200, description 2000 (after trim)', async () => {
    expect((await post({ title: 'a'.repeat(200), description: 'b'.repeat(2000), time_options: o1 })).status).toBe(201);
    expect((await post({ title: ' ' + 'a'.repeat(200) + ' ', time_options: o1 })).status).toBe(201);
    expect((await post({ title: 'a'.repeat(201), time_options: o1 })).status).toBe(400);
    expect((await post({ title: 'x', description: 'b'.repeat(2001), time_options: o1 })).status).toBe(400);
  });
  test('M1: over-long title/description → 400, never truncated', async () => {
    const t = 'a'.repeat(5000);
    const r = await post({ title: t, description: 'b'.repeat(10000), time_options: o1 });
    expect(r.status).toBe(400);
    expect(r.body.errors).toEqual(['Titel må højst være 200 tegn.', 'Beskrivelse må højst være 2000 tegn.']);
    const ok = await post({ title: 'a'.repeat(200), description: 'b'.repeat(2000), time_options: o1 });
    expect(ok.body.title).toHaveLength(200);
    expect(ok.body.description).toHaveLength(2000);
  });
  test('M2: whitespace / zero-width-only titles rejected', async () => {
    for (const t of ['\u200B\u200B', ' \u200C\u200D\uFEFF ', '\u2060', '\u00A0\u3000\t\n', '\u00AD']) {
      const r = await post({ title: t, time_options: o1 });
      expect(r.status, JSON.stringify(t)).toBe(400);
      expect(r.body.errors).toContain('Titel er påkrævet.');
    }
    expect((await post({ title: 'a\u200Bb', time_options: o1 })).status).toBe(201);
  });
  test('L1: lengths counted in graphemes (👨‍👩‍👧‍👦 = 1, 👍🏽 = 1)', async () => {
    const fam = '👨‍👩‍👧‍👦';
    const ok = await post({ title: fam.repeat(200), description: '👍🏽'.repeat(2000), time_options: o1 });
    expect(ok.status).toBe(201);
    expect(ok.body.title).toBe(fam.repeat(200));
    expect((await post({ title: fam.repeat(201), time_options: o1 })).status).toBe(400);
    expect((await post({ title: 'x', description: '👍🏽'.repeat(2001), time_options: o1 })).status).toBe(400);
  });
  test('max 100 time options', async () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => opt(new Date(base.getTime() + i * 60_000).toISOString()));
    expect((await post({ title: 'x', time_options: mk(100) })).status).toBe(201);
    expect((await post({ title: 'x', time_options: mk(101) })).status).toBe(400);
  });
  test('invalid datetimes: no offset, impossible date, bad hour, end before start', async () => {
    const r = await post({ title: 'x', time_options: [
      opt(iso('11-03T09:00:00')), opt(`${Y + 1}-02-30T10:00:00Z`), opt(iso('11-03T25:00:00Z')),
      opt(iso('11-03T10:00:00Z'), iso('11-03T09:00:00Z')), opt(iso('11-03T10:00:00Z'), iso('11-03T10:00:00Z')),
      opt(iso('11-03')),
    ] });
    expect(r.status).toBe(400);
    expect(r.body.errors).toHaveLength(6);
  });
  test('past time options rejected', async () => {
    const r = await post({ title: 'x', time_options: [opt(new Date(Date.now() - 60_000).toISOString())] });
    expect(r.status).toBe(400);
    expect(r.body.errors[0]).toMatch(/fortiden/);
    expect((await post({ title: 'x', time_options: [opt(new Date(Date.now() + DAY).toISOString())] })).status).toBe(201);
  });
});

describe('limits & idempotency', () => {
  test('payload > 32kb → 413 JSON', async () => {
    const r = await post({ title: 'x', description: 'a'.repeat(40 * 1024), time_options: [] });
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
    const { body: { id } } = await post({ title: evil, description: '"><img src=x onerror=alert(1)>', time_options: [opt(iso('11-03T09:00:00Z'))] });
    const r = await call(`/p/${id}`, { headers: { Host: 'evil.example' } });
    expect(r.status).toBe(200);
    expect(r.text).not.toContain('<script>alert');
    expect(r.text).not.toContain('<img src=x');
    expect(r.text).toContain('<title>&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;&quot;&#x27;&amp; – Mødetid</title>');
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
    expect(g.text).toMatch(/<link rel="icon" href="\/icon\.svg/);
    const trav = await call('/p/..%2F..%2Fetc%2Fpasswd');
    expect(trav.status).toBe(404);
    expect(trav.text).toContain('Hov, den afstemning kan vi ikke finde');
    const icon = await call('/icon.svg');
    expect(icon.status).toBe(200);
    expect(icon.headers.get('content-type')).toMatch(/svg/);
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
    const { body: { id } } = await post({ title: 'Frokost & "kage"', description: '', time_options: [
      opt(iso('10-14T07:00:00Z')), opt(iso('10-16T07:00:00Z')) ] });
    const r = await call(`/p/${id}`);
    expect(r.text).toContain(`<link rel="canonical" href="${BASE}/p/${id}"`);
    expect(r.text).toContain('<meta property="og:locale" content="da_DK"');
    expect(r.text).toContain('<meta property="og:site_name" content="Mødetid"');
    expect(r.text).toContain('<meta property="og:title" content="Frokost &amp; &quot;kage&quot;"');
    expect(r.text).toContain(`<meta name="description" content="Stem på det tidspunkt, der passer dig. 2 tidsforslag, 14.–16. oktober ${Y}."`);
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

describe('admin token (no accounts)', () => {
  const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
  const leaks = (text: string, token: string) => text.includes(token);
  const hasSecretField = (o: unknown): boolean =>
    JSON.stringify(o).match(/"[^"]*(token|hash|secret)[^"]*"\s*:/i) !== null;

  test('201 returns a 256-bit admin token + admin_url exactly once; GET never does', async () => {
    const c = await post(valid());
    expect(c.status).toBe(201);
    expect(c.body.admin_token).toMatch(TOKEN_RE);
    expect(c.body.admin_url).toBe(`/p/${c.body.id}/admin/${c.body.admin_token}`);
    expect(c.headers.get('cache-control')).toMatch(/no-store/);
    const g = await call(`/api/events/${c.body.id}?tz=Europe/Copenhagen`);
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
      await call(`/p/${id}`), await call(`/p/${id}?created=1`), await call(`/e/${id}`),
      await call(`/p/${id}/admin/${token.slice(0, -1)}x`), await call(`/api/events/${id}`),
      await postRaw('{"title": 1}'), await call(`/api/events/${id}/admin/${token}`),
    ];
    for (const r of pages) expect(leaks(r.text + JSON.stringify([...r.headers]), token)).toBe(false);
    // Admin page itself: works, but no canonical/og:url (would leak the token into previews).
    const adm = await call(`/p/${id}/admin/${token}`);
    expect(adm.status).toBe(200);
    expect(adm.text).toContain('Du ser afstemningen som arrangør');
    expect(adm.text).not.toMatch(/rel="canonical"|property="og:/);
    expect(adm.text).toMatch(/<meta name="robots" content="noindex/);
    expect(adm.headers.get('cache-control')).toMatch(/no-store/);
    expect(adm.headers.get('referrer-policy')).toBe('no-referrer');
    expect(adm.headers.get('x-robots-tag')).toMatch(/noindex/);
    const log = inject('serverLog');
    if (log) {
      await new Promise((r) => setTimeout(r, 300));
      expect(readFileSync(log, 'utf8')).not.toContain(token);
    }
  });

  test('admin/edit routes always send noindex + Referrer-Policy: no-referrer (incl. 404 and ?edit=)', async () => {
    const c = await post(valid());
    for (const path of [`/p/${c.body.id}/admin/${c.body.admin_token}`, `/p/${c.body.id}/admin/${'B'.repeat(43)}`,
      `/p/${c.body.id}?edit=${'C'.repeat(43)}`]) {
      const r = await call(path);
      expect(r.headers.get('referrer-policy'), path).toBe('no-referrer');
      expect(r.headers.get('x-robots-tag'), path).toMatch(/noindex, nofollow/);
      expect(r.text, path).toMatch(/<meta name="robots" content="noindex/);
      expect(r.text, path).not.toMatch(/property="og:|rel="canonical"/);
    }
  });
  test('wrong, malformed or other poll\'s admin token → friendly 404', async () => {
    const a = await post(valid()); const b = await post(valid());
    for (const path of [
      `/p/${a.body.id}/admin/${b.body.admin_token}`,
      `/p/${a.body.id}/admin/${'A'.repeat(43)}`,
      `/p/${a.body.id}/admin/short`,
      `/p/${a.body.id}/admin/${a.body.admin_token.toLowerCase() === a.body.admin_token ? 'x' : a.body.admin_token.toLowerCase()}`,
    ]) {
      const r = await call(path);
      expect(r.status, path).toBe(404);
      expect(r.text).toContain('Hov, den afstemning kan vi ikke finde');
    }
  });
});

describe('OG image route + link preview', () => {
  const pngSize = (buf: Buffer) => ({ sig: buf.subarray(1, 4).toString(), w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });

  test('GET /p/<id>/opengraph-image → 1200×630 PNG, cacheable', async () => {
    const { body: { id } } = await post({ title: '👨‍👩‍👧‍👦 Familiemiddag </title><script>x</script> ' + 'lang '.repeat(30), time_options: [opt(iso('11-03T09:00:00Z'))] });
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
    const c = await post({ title: 'Møde "A" & <b>B</b>', time_options: [opt(iso('11-03T09:00:00Z'))] });
    const { id, admin_token: token } = c.body;
    const r = await call(`/p/${id}`);
    const img = `${BASE}/p/${id}/opengraph-image`;
    expect(r.text).toContain(`<meta property="og:image" content="${img}"/>`);
    expect(r.text).toContain('<meta property="og:image:width" content="1200"/>');
    expect(r.text).toContain('<meta property="og:image:height" content="630"/>');
    expect(r.text).toContain('<meta property="og:image:alt" content="Mødetid-afstemning: Møde &quot;A&quot; &amp; &lt;b&gt;B&lt;/b&gt;"/>');
    expect(r.text).toContain('<meta name="twitter:card" content="summary_large_image"/>');
    expect(r.text).toContain(`<meta name="twitter:image" content="${img}"/>`);
    expect(r.text).not.toContain(token);
    // Admin page: still no OG image / preview tags
    const adm = await call(`/p/${id}/admin/${token}`);
    expect(adm.text).not.toMatch(/og:image|twitter:/);
  });
});
