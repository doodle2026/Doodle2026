import { describe, test, expect, inject, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const BASE = inject('baseUrl');
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

const rndIp = () => `10.9.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}`;
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
const at = (md: string) => `${Y}-${md}:00Z`;
async function create() {
  const r = await call('/api/events', json('POST', {
    title: 'Teammøde', description: 'Q4',
    time_options: [{ start: at('11-03T09:00') }, { start: at('11-04T09:00'), end: at('11-04T10:00') }, { start: at('11-05T09:00') }],
  }));
  expect(r.status).toBe(201);
  return { id: r.body.id as string, token: r.body.admin_token as string, opts: r.body.time_options as Json[] };
}
const patchBody = (opts: Json[], extra: Json = {}): Json => ({
  title: 'Nyt navn', description: 'Ny tekst',
  time_options: opts.map((o) => ({ id: o.id, start: o.start_at, end: o.end_at })), ...extra,
});

describe('admin auth', () => {
  test('GET /admin needs the Bearer token: 401 without, 403 wrong/other poll/malformed, 200 right', async () => {
    const a = await create(); const b = await create();
    expect((await call(`/api/events/${a.id}/admin`)).status).toBe(401);
    for (const t of [b.token, 'A'.repeat(43), 'short', a.token.slice(0, -1) + (a.token.endsWith('A') ? 'B' : 'A')]) {
      const r = await call(`/api/events/${a.id}/admin`, { token: t });
      expect(r.status, t).toBe(403);
      expect(r.headers.get('cache-control')).toMatch(/no-store/);
    }
    const ok = await call(`/api/events/${a.id}/admin`, { token: a.token });
    expect(ok.status).toBe(200);
    expect(ok.body.time_options[0].votes).toEqual({ yes: 0, maybe: 0, no: 0, total: 0 });
    expect(ok.body.participants).toEqual([]);
    expect(JSON.stringify(ok.body)).not.toMatch(/token|hash/i);
    for (const h of ['x-robots-tag', 'referrer-policy']) expect(ok.headers.get(h)).toBeTruthy();
    expect(ok.headers.get('cache-control')).toMatch(/no-store/);
  });

  test('token in query/cookie is NOT accepted (header only)', async () => {
    const a = await create();
    expect((await call(`/api/events/${a.id}/admin?token=${a.token}`)).status).toBe(401);
    expect((await call(`/api/events/${a.id}/admin`, { headers: { Cookie: `admin=${a.token}` } })).status).toBe(401);
  });

  test('all admin writes are JSON-only (415) and token-protected', async () => {
    const a = await create();
    for (const [m, p] of [['PATCH', ''], ['POST', '/close'], ['POST', '/reopen'], ['POST', '/rotate-admin']]) {
      const form = await call(`/api/events/${a.id}${p}`, { method: m, token: a.token, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'title=x' });
      expect(form.status, `${m} ${p}`).toBe(415);
      const noTok = await call(`/api/events/${a.id}${p}`, json(m, {}));
      expect(noTok.status, `${m} ${p}`).toBe(401);
      expect(noTok.body.errors).toBeInstanceOf(Array);
    }
  });
});

describe('PATCH /api/events/:id', () => {
  test('edits title/description/options (keep, move, add, remove without votes)', async () => {
    const a = await create();
    const body = patchBody([a.opts[0], { ...a.opts[1], start_at: at('11-04T11:00'), end_at: null }]);
    body.time_options.push({ start: at('11-06T12:00') } as Json);
    const r = await call(`/api/events/${a.id}`, json('PATCH', body, a.token));
    expect(r.status).toBe(200);
    expect(r.body.title).toBe('Nyt navn');
    expect(r.body.time_options.map((o: Json) => o.start_at)).toEqual([
      `${Y}-11-03T09:00:00.000Z`, `${Y}-11-04T11:00:00.000Z`, `${Y}-11-06T12:00:00.000Z`]);
    expect(r.body.time_options[0].id).toBe(a.opts[0].id); // kept options keep their id (and votes)
    const pub = await call(`/api/events/${a.id}`);
    expect(pub.body.description).toBe('Ny tekst');
  });

  test('same validation as create: blank/zero-width title, too long, no options, past new option, bad types → 400', async () => {
    const a = await create();
    const cases: (Json | null)[] = [
      patchBody(a.opts, { title: ' \u200B ' }),
      patchBody(a.opts, { title: 'x'.repeat(201) }),
      patchBody(a.opts, { description: 'x'.repeat(2001) }),
      patchBody([], {}),
      { ...patchBody(a.opts), time_options: [{ start: '2020-01-01T10:00:00Z' }] },
      { ...patchBody(a.opts), time_options: 'nope' },
      { ...patchBody(a.opts), time_options: [{ id: 'x', start: at('11-03T09:00') }] },
      { ...patchBody(a.opts), time_options: [{ id: a.opts[0].id, start: at('11-03T09:00') }, { id: a.opts[0].id, start: at('11-04T09:00') }] },
      null, [],
    ];
    for (const c of cases) {
      const r = await call(`/api/events/${a.id}`, json('PATCH', c, a.token));
      expect(r.status, JSON.stringify(c)?.slice(0, 80)).toBe(400);
      expect(r.body.errors.length).toBeGreaterThan(0);
    }
    const tooBig = await call(`/api/events/${a.id}`, { method: 'PATCH', token: a.token, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'x'.repeat(40_000) }) });
    expect(tooBig.status).toBe(413);
  });

  test('option id of another poll → 400', async () => {
    const a = await create(); const b = await create();
    const r = await call(`/api/events/${a.id}`, json('PATCH', patchBody([{ ...b.opts[0] }]), a.token));
    expect(r.status).toBe(400);
  });

  test('unchanged existing option in the past may stay; moving it into the past is rejected', async () => {
    const a = await create();
    await prisma.timeOption.update({ where: { id: a.opts[0].id }, data: { startAt: new Date('2020-01-01T10:00:00Z') } });
    const adm = await call(`/api/events/${a.id}/admin`, { token: a.token });
    const keep = await call(`/api/events/${a.id}`, json('PATCH', patchBody(adm.body.time_options), a.token));
    expect(keep.status).toBe(200);
    const moved = adm.body.time_options.map((o: Json, i: number) => (i === 0 ? { ...o, start_at: '2020-01-02T10:00:00.000Z' } : o));
    expect((await call(`/api/events/${a.id}`, json('PATCH', patchBody(moved), a.token))).status).toBe(400);
  });

  test('removing an option with votes needs confirm_remove_voted (409 otherwise); other votes survive', async () => {
    const a = await create();
    const p = await prisma.participant.create({ data: { event: { connect: { slug: a.id } }, name: 'Anders', nameKey: 'anders', editTokenHash: randomBytes(32).toString('hex') } });
    await prisma.vote.createMany({ data: [
      { participantId: p.id, timeOptionId: a.opts[0].id, value: 'yes' },
      { participantId: p.id, timeOptionId: a.opts[1].id, value: 'maybe' },
    ] });
    const adm = await call(`/api/events/${a.id}/admin`, { token: a.token });
    expect(adm.body.time_options[0].votes).toEqual({ yes: 1, maybe: 0, no: 0, total: 1 });
    expect(adm.body.participants.map((x: Json) => x.name)).toEqual(['Anders']);

    const without = patchBody(a.opts.slice(1));
    const r409 = await call(`/api/events/${a.id}`, json('PATCH', without, a.token));
    expect(r409.status).toBe(409);
    expect(r409.body.voted_option_ids).toEqual([a.opts[0].id]);
    expect(await prisma.timeOption.count({ where: { id: a.opts[0].id } })).toBe(1); // nothing changed

    const ok = await call(`/api/events/${a.id}`, json('PATCH', { ...without, confirm_remove_voted: true }, a.token));
    expect(ok.status).toBe(200);
    expect(await prisma.vote.findMany({ where: { participantId: p.id }, select: { timeOptionId: true } }))
      .toEqual([{ timeOptionId: a.opts[1].id }]);
    // Removing an option without votes needs no confirmation
    const free = await call(`/api/events/${a.id}`, json('PATCH', patchBody([ok.body.time_options[0]]), a.token));
    expect(free.status).toBe(200);
  });
});

describe('close / reopen', () => {
  test('close with chosen time → public API + poll page show closed banner; reopen resets', async () => {
    const a = await create();
    const c = await call(`/api/events/${a.id}/close`, json('POST', { chosen_option_id: a.opts[1].id }, a.token));
    expect(c.status).toBe(200);
    expect(c.body.is_closed).toBe(true);
    expect(c.body.chosen_option_id).toBe(a.opts[1].id);
    const pub = await call(`/api/events/${a.id}`);
    expect(pub.body.is_closed).toBe(true);
    expect(pub.body.closed_at).toMatch(/Z$/);
    expect(pub.body.chosen_option_id).toBe(a.opts[1].id);
    const page = await call(`/p/${a.id}`);
    expect(page.text).toContain('id="result-banner"');
    expect(page.text).toContain('Afstemningen er lukket');
    expect(page.text).toContain('Afstemningen er lukket – endeligt tidspunkt');

    const r = await call(`/api/events/${a.id}/reopen`, json('POST', {}, a.token));
    expect(r.status).toBe(200);
    expect(r.body.is_closed).toBe(false);
    expect(r.body.chosen_option_id).toBeNull();
    expect((await call(`/p/${a.id}`)).text).not.toContain('id="result-banner"');
  });

  test('close without a chosen time (empty body ok); invalid / foreign chosen id → 400', async () => {
    const a = await create(); const b = await create();
    const c = await call(`/api/events/${a.id}/close`, { method: 'POST', token: a.token, headers: { 'Content-Type': 'application/json' } });
    expect(c.status).toBe(200);
    expect(c.body.chosen_option_id).toBeNull();
    expect((await call(`/p/${a.id}`)).text).toContain('Arrangøren har lukket for svar.');
    for (const v of ['1', -1, 1.5, b.opts[0].id]) {
      expect((await call(`/api/events/${a.id}/close`, json('POST', { chosen_option_id: v }, a.token))).status, String(v)).toBe(400);
    }
  });
});

describe('rotate admin link', () => {
  test('returns a new token once; old token stops working; idempotent replay no longer returns the old one', async () => {
    const key = `rotate-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const body = { title: 'R', time_options: [{ start: at('11-03T09:00') }] };
    const c = await call('/api/events', json('POST', body, undefined, { 'Idempotency-Key': key }));
    const old = c.body.admin_token;
    const r = await call(`/api/events/${c.body.id}/rotate-admin`, json('POST', {}, old));
    expect(r.status).toBe(200);
    expect(r.body.admin_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r.body.admin_token).not.toBe(old);
    expect(r.body.admin_url).toBe(`/p/${c.body.id}/admin#${r.body.admin_token}`);
    expect(r.headers.get('cache-control')).toMatch(/no-store/);
    expect((await call(`/api/events/${c.body.id}/admin`, { token: old })).status).toBe(403);
    expect((await call(`/api/events/${c.body.id}/admin`, { token: r.body.admin_token })).status).toBe(200);
    const replay = await call('/api/events', json('POST', body, undefined, { 'Idempotency-Key': key }));
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(c.body.id);
    expect(replay.body.admin_token).toBeUndefined();
    expect(replay.text).not.toContain(old);
  });
});

describe('rate limiting', () => {
  test('POST /api/events: burst then 429 JSON with Retry-After (per IP)', async () => {
    const ip = `10.250.${(Math.random() * 255) | 0}.1`;
    const statuses: number[] = [];
    let last: Awaited<ReturnType<typeof call>> | null = null;
    for (let i = 0; i < 25; i++) {
      last = await call('/api/events', { ...json('POST', { title: '' }), ip });
      statuses.push(last.status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 400)).toBe(true);
    expect(statuses.slice(20).every((s) => s === 429)).toBe(true);
    expect(last!.headers.get('retry-after')).toMatch(/^\d+$/);
    expect(last!.headers.get('content-type')).toMatch(/json/);
    expect(last!.body.errors[0]).toMatch(/For mange/);
    // another IP is unaffected
    expect((await call('/api/events', json('POST', { title: '' }))).status).toBe(400);
  });

  test('admin writes are rate limited too', async () => {
    const a = await create();
    const ip = `10.251.${(Math.random() * 255) | 0}.1`;
    const st: number[] = [];
    for (let i = 0; i < 22; i++) st.push((await call(`/api/events/${a.id}/reopen`, { ...json('POST', {}, a.token), ip })).status);
    expect(st.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(st[21]).toBe(429);
  });
});
