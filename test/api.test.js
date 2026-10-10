const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { openDb } = require('../src/db');
const { createApp } = require('../src/app');

const NOW = new Date('2026-10-10T12:00:00Z');
const app = createApp(openDb(':memory:'), { now: () => NOW });
const post = (body) => request(app).post('/api/events').send(body);
const opt = (start, end) => (end === undefined ? { start } : { start, end });
const valid = () => ({
  title: '  Teammøde  ', description: '  Kvartalsmøde \n',
  time_options: [
    opt('2026-11-05T14:00:00+01:00', '2026-11-05T15:00:00+01:00'),
    opt('2026-11-03T09:00:00+01:00'),
    opt('2026-11-03T08:30:00Z', ''),
  ],
});

describe('create + fetch', () => {
  test('creates, stores UTC, sorts, returns design shape', async () => {
    const c = await post(valid()).expect(201);
    assert.match(c.body.id, /^[A-Za-z0-9_-]{22}$/);
    assert.equal(c.body.url, `/p/${c.body.id}`);
    assert.equal(c.headers.location, `/p/${c.body.id}`);
    const g = await request(app).get(`/api/events/${c.body.id}`).expect(200);
    assert.equal(g.body.title, 'Teammøde');
    assert.equal(g.body.description, 'Kvartalsmøde');
    assert.deepEqual(g.body.time_options.map((o) => [o.start_at, o.end_at]), [
      ['2026-11-03T08:00:00.000Z', null],
      ['2026-11-03T08:30:00.000Z', null],
      ['2026-11-05T13:00:00.000Z', '2026-11-05T14:00:00.000Z'],
    ]);
    assert.equal(g.body.timezone, 'UTC');
    assert.deepEqual(g.body.options[0], { date: '2026-11-03', start: '08:00', end: null });
  });

  test('?tz= renders design options in that zone; invalid tz falls back to UTC', async () => {
    const { body: { id } } = await post(valid());
    const cph = await request(app).get(`/api/events/${id}?tz=Europe/Copenhagen`).expect(200);
    assert.equal(cph.body.timezone, 'Europe/Copenhagen');
    assert.deepEqual(cph.body.options[2], { date: '2026-11-05', start: '14:00', end: '15:00' });
    const bad = await request(app).get(`/api/events/${id}?tz=Not/AZone`).expect(200);
    assert.equal(bad.body.timezone, 'UTC');
  });

  test('ids are unique', async () => {
    const a = await post(valid()); const b = await post(valid());
    assert.notEqual(a.body.id, b.body.id);
  });

  test('duplicates (same instant, different offsets) are deduplicated', async () => {
    const r = await post({ title: 'x', time_options: [
      opt('2026-11-03T09:00:00+01:00', '2026-11-03T10:00:00+01:00'),
      opt('2026-11-03T08:00:00Z', '2026-11-03T09:00:00Z'),
      opt('2026-11-03T09:00:00+01:00'),
      opt('2026-11-03T09:00:00+01:00', null),
    ] }).expect(201);
    assert.equal(r.body.time_options.length, 2);
  });
});

describe('validation → 400, never 500', () => {
  const weird = [
    ['null body', 'null'], ['array body', '[]'], ['string body', '"hi"'], ['number body', '42'],
    ['empty body', ''], ['title number', { title: 5, time_options: [opt('2026-11-03T09:00:00Z')] }],
    ['title object', { title: { a: 1 }, time_options: [opt('2026-11-03T09:00:00Z')] }],
    ['description array', { title: 'x', description: [1], time_options: [opt('2026-11-03T09:00:00Z')] }],
    ['options string', { title: 'x', time_options: 'tomorrow' }],
    ['options object', { title: 'x', time_options: { 0: opt('2026-11-03T09:00:00Z') } }],
    ['option null', { title: 'x', time_options: [null] }],
    ['option number', { title: 'x', time_options: [7] }],
    ['start number', { title: 'x', time_options: [{ start: 1762160400000 }] }],
    ['start object', { title: 'x', time_options: [{ start: { $gt: '' } }] }],
    ['end bool', { title: 'x', time_options: [{ start: '2026-11-03T09:00:00Z', end: true }] }],
  ];
  for (const [name, body] of weird) {
    test(name, async () => {
      const req = request(app).post('/api/events').set('Content-Type', 'application/json');
      const r = await req.send(typeof body === 'string' ? body : JSON.stringify(body));
      assert.equal(r.status, 400, JSON.stringify(r.body));
      assert.ok(Array.isArray(r.body.errors) && r.body.errors.length);
    });
  }

  test('non-JSON content-type still 400', async () => {
    await request(app).post('/api/events').set('Content-Type', 'text/plain').send('title=x').expect(400);
  });
  test('malformed JSON', async () => {
    await request(app).post('/api/events').set('Content-Type', 'application/json').send('{bad').expect(400);
  });
  test('missing/blank title and no options', async () => {
    const r = await post({ title: '   ', time_options: [] }).expect(400);
    assert.equal(r.body.errors.length, 2);
  });
  test('max lengths: title 200, description 2000 (after trim)', async () => {
    const o = [opt('2026-11-03T09:00:00Z')];
    await post({ title: 'a'.repeat(200), description: 'b'.repeat(2000), time_options: o }).expect(201);
    await post({ title: ' ' + 'a'.repeat(200) + ' ', time_options: o }).expect(201);
    await post({ title: 'a'.repeat(201), time_options: o }).expect(400);
    await post({ title: 'x', description: 'b'.repeat(2001), time_options: o }).expect(400);
  });
  test('max 100 time options', async () => {
    const mk = (n) => Array.from({ length: n }, (_, i) => opt(new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString()));
    await post({ title: 'x', time_options: mk(100) }).expect(201);
    await post({ title: 'x', time_options: mk(101) }).expect(400);
  });
  test('invalid datetimes: no offset, impossible date, bad hour, end before start', async () => {
    const r = await post({ title: 'x', time_options: [
      opt('2026-11-03T09:00:00'), opt('2026-02-30T10:00:00Z'), opt('2026-11-03T25:00:00Z'),
      opt('2026-11-03T10:00:00Z', '2026-11-03T09:00:00Z'), opt('2026-11-03T10:00:00Z', '2026-11-03T10:00:00Z'),
      opt('2026-11-03'),
    ] }).expect(400);
    assert.equal(r.body.errors.length, 6);
  });
  test('past time options rejected', async () => {
    const r = await post({ title: 'x', time_options: [opt('2026-10-10T11:59:00Z')] }).expect(400);
    assert.match(r.body.errors[0], /fortiden/);
    await post({ title: 'x', time_options: [opt('2026-10-10T14:01:00+02:00')] }).expect(201);
  });
});

describe('limits & idempotency', () => {
  test('payload > 32kb → 413 JSON', async () => {
    const r = await post({ title: 'x', description: 'a'.repeat(40 * 1024), time_options: [] }).expect(413);
    assert.match(r.headers['content-type'], /json/);
    assert.ok(r.body.errors.length);
  });
  test('same Idempotency-Key returns same poll', async () => {
    const key = 'abc12345-key';
    const a = await request(app).post('/api/events').set('Idempotency-Key', key).send(valid()).expect(201);
    const b = await request(app).post('/api/events').set('Idempotency-Key', key).send(valid()).expect(200);
    assert.equal(a.body.id, b.body.id);
    assert.equal(b.headers['idempotent-replayed'], 'true');
    const c = await request(app).post('/api/events').set('Idempotency-Key', 'other-key-1').send(valid()).expect(201);
    assert.notEqual(c.body.id, a.body.id);
  });
  test('concurrent submits with same key create one poll', async () => {
    const key = 'concurrent-key-1';
    const rs = await Promise.all([1, 2, 3].map(() => request(app).post('/api/events').set('Idempotency-Key', key).send(valid())));
    assert.equal(new Set(rs.map((r) => r.body.id)).size, 1);
  });
  test('malformed Idempotency-Key → 400', async () => {
    await request(app).post('/api/events').set('Idempotency-Key', 'bad key!').send(valid()).expect(400);
  });
});

describe('slugs, pages, XSS', () => {
  test('404 for unknown and malformed slugs', async () => {
    await request(app).get('/api/events/AAAAAAAAAAAAAAAAAAAAAA').expect(404);
    for (const s of ['short', '%3Cscript%3E', 'a'.repeat(23), "x'%20OR%201=1--aaaaaaaaaa"]) {
      await request(app).get(`/api/events/${s}`).expect(404);
      await request(app).get(`/p/${s}`).expect(404);
    }
  });
  test('/e/:id redirects to /p/:id', async () => {
    const { body: { id } } = await post(valid());
    const r = await request(app).get(`/e/${id}`).expect(301);
    assert.equal(r.headers.location, `/p/${id}`);
    await request(app).get('/e/bad').expect(404);
  });
  test('view page server-renders escaped <title> and og tags', async () => {
    const evil = `</title><script>alert(1)</script>"'&`;
    const { body: { id } } = await post({ title: evil, description: '"><img src=x onerror=alert(1)>', time_options: [opt('2026-11-03T09:00:00Z')] });
    const r = await request(app).get(`/p/${id}`).expect(200);
    assert.ok(!r.text.includes('<script>alert'));
    assert.ok(!r.text.includes('<img src=x'));
    assert.ok(r.text.includes('<title>&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;&quot;&#39;&amp; – Mødetid</title>'));
    assert.match(r.text, /<meta property="og:title" content="&lt;\/title&gt;/);
    assert.match(r.headers['content-security-policy'], /default-src 'self'/);
    const api = await request(app).get(`/api/events/${id}`).expect(200);
    assert.equal(api.body.title, evil); // stored raw; frontend uses textContent only
  });
  test('frontend never uses innerHTML', () => {
    const fs = require('fs');
    for (const f of ['create.js', 'poll.js']) assert.ok(!/innerHTML/.test(fs.readFileSync(`${__dirname}/../public/${f}`, 'utf8')), f);
  });
  test('unknown /api route → 404 JSON', async () => {
    await request(app).get('/api/nope').expect(404).expect('Content-Type', /json/);
  });
});
