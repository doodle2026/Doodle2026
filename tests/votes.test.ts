import { describe, test, expect, inject } from 'vitest';
import { readFileSync } from 'node:fs';

const BASE = inject('baseUrl');
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const rndIp = () => `10.8.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}`;
async function call(path: string, init: RequestInit & { token?: string; ip?: string } = {}) {
  const { token, ip, ...rest } = init;
  const headers: Record<string, string> = { 'X-Forwarded-For': ip ?? rndIp(), ...(rest.headers as Record<string, string> ?? {}) };
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(BASE + path, { redirect: 'manual', ...rest, headers });
  const text = await r.text();
  let body: Json = {};
  try { body = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, headers: r.headers, body, text };
}
const json = (method: string, body: unknown, token?: string, extra: Record<string, string> = {}) =>
  ({ method, token, headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) });
const Y = new Date().getUTCFullYear() + 1;
async function create() {
  const r = await call('/api/events', json('POST', { title: 'Afstemning', options: [
    { date: `${Y}-11-03` }, { date: `${Y}-11-04` }, { date: `${Y}-11-05` }] }));
  return { id: r.body.id as string, admin: r.body.admin_token as string, o: (r.body.time_options as Json[]).map((x) => x.id as number) };
}
const vote = (o: number[], vals: (string | null)[], name = `Navn ${Math.random().toString(36).slice(2, 8)}`) =>
  ({ name, votes: o.map((id, i) => ({ option_id: id, value: vals[i] ?? null })) });
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

describe('POST /api/events/:id/votes', () => {
  test('201 with edit token + fragment edit_url; public GET shows name/votes (aligned, null = unanswered) but no token', async () => {
    const e = await create();
    const r = await call(`/api/events/${e.id}/votes`, json('POST', vote(e.o, ['yes', null, 'maybe'], '  Anders\u200B  ')));
    expect(r.status).toBe(201);
    expect(r.body.edit_token).toMatch(TOKEN_RE);
    expect(r.body.edit_url).toBe(`/p/${e.id}#edit=${r.body.edit_token}`);
    expect(r.headers.get('cache-control')).toMatch(/no-store/);
    expect(r.body.event.participants).toEqual([{ id: r.body.participant_id, name: 'Anders', votes: ['yes', null, 'maybe'] }]);
    const g = await call(`/api/events/${e.id}`);
    expect(g.body.participants[0].name).toBe('Anders');
    expect(g.text).not.toContain(r.body.edit_token);
    expect(JSON.stringify(g.body)).not.toMatch(/"[^"]*(token|hash)[^"]*"\s*:/i);
    const page = await call(`/da/p/${e.id}`);
    expect(page.text).toContain('Anders');
    expect(page.text).not.toContain(r.body.edit_token);
    const log = inject('serverLog');
    if (log) { await new Promise((res) => setTimeout(res, 300)); expect(readFileSync(log, 'utf8')).not.toContain(r.body.edit_token); }
  });

  test('validation: name blank/zero-width/too long (graphemes), no answers, bad values/ids, bad types → 400', async () => {
    const e = await create(); const other = await create();
    const cases: unknown[] = [
      vote(e.o, ['yes'], ''), vote(e.o, ['yes'], ' \u200B\u2060 '), vote(e.o, ['yes'], 'x'.repeat(101)),
      vote(e.o, [null, null, null]), vote(e.o, ['ja']), { name: 'A', votes: [{ option_id: other.o[0], value: 'yes' }] },
      { name: 'A', votes: [{ option_id: e.o[0], value: 'yes' }, { option_id: e.o[0], value: 'no' }] },
      { name: 'A', votes: 'yes' }, { name: 5, votes: [] }, null, [], 'x',
    ];
    for (const c of cases) {
      const r = await call(`/api/events/${e.id}/votes`, json('POST', c));
      expect(r.status, JSON.stringify(c)?.slice(0, 60)).toBe(400);
      expect(r.body.errors.length).toBeGreaterThan(0);
    }
    expect((await call(`/api/events/${e.id}/votes`, json('POST', vote(e.o, ['yes'], '👨‍👩‍👧‍👦'.repeat(100))))).status).toBe(201);
    expect((await call(`/api/events/${e.id}/votes`, { ...json('POST', vote(e.o, ['yes'])), headers: { 'Content-Type': 'text/plain' } })).status).toBe(415);
    const big = await call(`/api/events/${e.id}/votes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x'.repeat(40_000) }) });
    expect(big.status).toBe(413);
    expect((await call('/api/events/AAAAAAAAAAAAAAAAAAAAAA/votes', json('POST', vote(e.o, ['yes'])))).status).toBe(404);
  });

  test('names are unique per poll, case-insensitively (409); same name in another poll is fine', async () => {
    const e = await create(); const f = await create();
    expect((await call(`/api/events/${e.id}/votes`, json('POST', vote(e.o, ['yes'], 'Jan')))).status).toBe(201);
    for (const n of ['jan', ' JAN ', 'Ｊａｎ', '\u200DJan', '\u00ADJan', '\u200BJan\u200D', 'J\u200Can', '\u202EJan']) {
      const r = await call(`/api/events/${e.id}/votes`, json('POST', vote(e.o, ['no'], n)));
      expect(r.status, n).toBe(409);
      expect(r.body.code).toBe('name_taken');
      expect(r.body.errors[0]).toContain('har allerede svaret');
    }
    expect((await call(`/api/events/${f.id}/votes`, json('POST', vote(f.o, ['yes'], 'Jan')))).status).toBe(201);
  });

  test('Idempotency-Key: retry returns the same participant + token, no duplicate row', async () => {
    const e = await create();
    const key = `vote-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const body = vote(e.o, ['yes']);
    const rs = await Promise.all([1, 2, 3].map(() => call(`/api/events/${e.id}/votes`, json('POST', body, undefined, { 'Idempotency-Key': key }))));
    expect(rs.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    expect(new Set(rs.map((r) => r.body.edit_token)).size).toBe(1);
    expect((await call(`/api/events/${e.id}`)).body.participants.length).toBe(1);
  });

  test('V2: same Idempotency-Key with DIFFERENT answers → 422, never a silent replay of the old answers', async () => {
    const e = await create();
    const key = `v2-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const first = await call(`/api/events/${e.id}/votes`, json('POST', vote(e.o, ['no'], 'Mette'), undefined, { 'Idempotency-Key': key }));
    expect(first.status).toBe(201);
    const changed = await call(`/api/events/${e.id}/votes`, json('POST', vote(e.o, ['maybe'], 'Mette'), undefined, { 'Idempotency-Key': key }));
    expect(changed.status).toBe(422);
    expect(changed.body.code).toBe('idempotency_mismatch');
    expect(changed.text).not.toContain(first.body.edit_token);
    const same = await call(`/api/events/${e.id}/votes`, json('POST', vote(e.o, ['no'], 'Mette'), undefined, { 'Idempotency-Key': key }));
    expect(same.status).toBe(200);
    expect(same.body.event.participants[0].votes[0]).toBe('no');
    // all three values round-trip exactly
    const r = await call(`/api/events/${e.id}/votes`, json('POST', vote(e.o, ['maybe', 'no', 'yes'], 'Rundtur')));
    expect(r.body.event.participants.find((p: Json) => p.name === 'Rundtur').votes).toEqual(['maybe', 'no', 'yes']);
  });

  test('closed poll rejects new votes and edits with 423; reopen allows again', async () => {
    const e = await create();
    const v = await call(`/api/events/${e.id}/votes`, json('POST', vote(e.o, ['yes'])));
    await call(`/api/events/${e.id}/close`, json('POST', {}, e.admin));
    const r = await call(`/api/events/${e.id}/votes`, json('POST', vote(e.o, ['yes'])));
    expect(r.status).toBe(423);
    expect(r.body.code).toBe('closed');
    const u = await call(`/api/events/${e.id}/votes/me`, json('PUT', vote(e.o, ['no']), v.body.edit_token));
    expect(u.status).toBe(423);
    await call(`/api/events/${e.id}/reopen`, json('POST', {}, e.admin));
    expect((await call(`/api/events/${e.id}/votes`, json('POST', vote(e.o, ['yes'])))).status).toBe(201);
  });

  test('rate limited (429 + Retry-After)', async () => {
    const e = await create();
    const ip = `10.252.${(Math.random() * 255) | 0}.1`;
    const st: number[] = [];
    for (let i = 0; i < 22; i++) st.push((await call(`/api/events/${e.id}/votes`, { ...json('POST', { name: '' }), ip })).status);
    expect(st.slice(0, 20).every((s) => s === 400)).toBe(true);
    expect(st[21]).toBe(429);
  });
});

describe('edit own answers (Bearer edit token)', () => {
  test('GET/PUT votes/me: 401 without, 403 wrong/other poll, edits replace name + answers', async () => {
    const e = await create(); const f = await create();
    const a = await call(`/api/events/${e.id}/votes`, json('POST', vote(e.o, ['yes', 'no', null], 'Birgitte')));
    const b = await call(`/api/events/${f.id}/votes`, json('POST', vote(f.o, ['yes'])));
    const t = a.body.edit_token;
    expect((await call(`/api/events/${e.id}/votes/me`)).status).toBe(401);
    expect((await call(`/api/events/${e.id}/votes/me`, { token: b.body.edit_token })).status).toBe(403);
    expect((await call(`/api/events/${e.id}/votes/me`, { token: 'A'.repeat(43) })).status).toBe(403);
    expect((await call(`/api/events/${e.id}/votes/me`, { token: e.admin })).status).toBe(403);
    const me = await call(`/api/events/${e.id}/votes/me`, { token: t });
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ participant_id: a.body.participant_id, name: 'Birgitte' });
    expect(me.headers.get('cache-control')).toMatch(/no-store/);

    const u = await call(`/api/events/${e.id}/votes/me`, json('PUT', vote(e.o, [null, 'maybe', 'yes'], 'birgitte K')));
    expect(u.status).toBe(401);
    const ok = await call(`/api/events/${e.id}/votes/me`, json('PUT', vote(e.o, [null, 'maybe', 'yes'], 'Birgitte K'), t));
    expect(ok.status).toBe(200);
    expect(ok.body.event.participants).toEqual([{ id: a.body.participant_id, name: 'Birgitte K', votes: [null, 'maybe', 'yes'] }]);
    expect(ok.body.edit_token).toBeUndefined();
    // Own name with different case is fine; someone else's is not
    expect((await call(`/api/events/${e.id}/votes/me`, json('PUT', vote(e.o, ['yes'], 'BIRGITTE K'), t))).status).toBe(200);
    await call(`/api/events/${e.id}/votes`, json('POST', vote(e.o, ['yes'], 'Kasper')));
    expect((await call(`/api/events/${e.id}/votes/me`, json('PUT', vote(e.o, ['yes'], 'kasper'), t))).status).toBe(409);
    expect((await call(`/api/events/${e.id}/votes/me`, { method: 'PUT', token: t, headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status).toBe(415);
    expect((await call(`/api/events/${e.id}/votes/me`, json('PUT', vote(e.o, [null, null, null], 'X'), t))).status).toBe(400);
  });

  test('admin view sees participants and vote counts', async () => {
    const e = await create();
    await call(`/api/events/${e.id}/votes`, json('POST', vote(e.o, ['yes', 'maybe'], 'A1')));
    await call(`/api/events/${e.id}/votes`, json('POST', vote(e.o, ['yes', 'no'], 'A2')));
    const a = await call(`/api/events/${e.id}/admin`, { token: e.admin });
    expect(a.body.participants.map((p: Json) => p.name)).toEqual(['A1', 'A2']);
    expect(a.body.time_options[0].votes).toEqual({ yes: 2, maybe: 0, no: 0, total: 2 });
    expect(a.body.time_options[1].votes).toEqual({ yes: 0, maybe: 1, no: 1, total: 2 });
  });

  test('closed poll page: read-only "Svar", no name field / save button', async () => {
    const e = await create();
    await call(`/api/events/${e.id}/votes`, json('POST', vote(e.o, ['yes'], 'Sofie')));
    await call(`/api/events/${e.id}/close`, json('POST', { chosen_option_id: e.o[0] }, e.admin));
    const p = await call(`/da/p/${e.id}`);
    expect(p.text).toContain('Afstemningen er lukket');
    expect(p.text).toContain('>Svar</h2>');
    expect(p.text).not.toContain('id="name"');
    expect(p.text).not.toContain('Gem mine svar');
    expect(p.text).toContain('is-chosen');
  });
});

describe('K2: passed dates', () => {
  test('new yes/maybe on a date before UTC today − 1 → 400; no is fine; existing answers are kept on edit', async () => {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    try {
      const e = await create();
      const first = await call(`/api/events/${e.id}/votes`, json('POST', vote(e.o, ['yes', 'maybe', 'no'])));
      expect(first.status).toBe(201);
      // the first date now lies in the past (e.g. the poll ran for weeks)
      await prisma.timeOption.update({ where: { id: e.o[0] }, data: { date: new Date('2020-01-01T00:00:00Z') } });
      const bad = await call(`/api/events/${e.id}/votes`, json('POST', vote(e.o, ['yes', 'yes'])));
      expect(bad.status).toBe(400);
      expect(bad.body.errors[0]).toMatch(/passeret/);
      expect((await call(`/api/events/${e.id}/votes`, json('POST', vote(e.o, ['maybe'])))).status).toBe(400);
      expect((await call(`/api/events/${e.id}/votes`, json('POST', vote(e.o, ['no', 'yes'])))).status).toBe(201);
      expect((await call(`/api/events/${e.id}/votes`, json('POST', vote(e.o, [null, 'yes'])))).status).toBe(201);
      // edit: unchanged 'yes' on the passed date is kept; changing it to 'maybe' is refused
      const keep = await call(`/api/events/${e.id}/votes/me`, json('PUT', vote(e.o, ['yes', 'yes', 'yes'], 'Ole'), first.body.edit_token));
      expect(keep.status).toBe(200);
      expect(keep.body.event.participants[0].votes).toEqual(['yes', 'yes', 'yes']);
      expect((await call(`/api/events/${e.id}/votes/me`, json('PUT', vote(e.o, ['maybe', 'yes', 'yes'], 'Ole'), first.body.edit_token))).status).toBe(400);
    } finally { await prisma.$disconnect(); }
  });
});
