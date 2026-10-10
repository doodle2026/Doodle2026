import { describe, test, expect, inject } from 'vitest';

const BASE = inject('baseUrl');
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const rndIp = () => `10.7.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}`;
async function call(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  const headers: Record<string, string> = { 'X-Forwarded-For': rndIp(), ...(rest.headers as Record<string, string> ?? {}) };
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(BASE + path, { redirect: 'manual', ...rest, headers });
  const text = await r.text();
  let body: Json = {};
  try { body = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, headers: r.headers, body, text };
}
const json = (method: string, body: unknown, token?: string) =>
  ({ method, token, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const Y = new Date().getUTCFullYear() + 1;
async function create(title = 'Teammøde; Q4, "plan"', description = 'Linje 1\nLinje 2') {
  const r = await call('/api/events', json('POST', { title, description, time_options: [
    { start: `${Y}-11-03T09:00:00+01:00`, end: `${Y}-11-03T10:30:00+01:00` }, { start: `${Y}-11-04T13:00:00Z` }] }));
  return { id: r.body.id as string, admin: r.body.admin_token as string, o: (r.body.time_options as Json[]).map((x) => x.id as number) };
}

describe('choose final time (admin)', () => {
  test('pick, change, clear while open; public API + page reflect it; token required', async () => {
    const e = await create();
    expect((await call(`/api/events/${e.id}/choose`, json('POST', { chosen_option_id: e.o[0] }))).status).toBe(401);
    expect((await call(`/api/events/${e.id}/choose`, json('POST', { chosen_option_id: e.o[0] }, 'A'.repeat(43)))).status).toBe(403);
    const c = await call(`/api/events/${e.id}/choose`, json('POST', { chosen_option_id: e.o[0] }, e.admin));
    expect(c.status).toBe(200);
    expect(c.body).toMatchObject({ chosen_option_id: e.o[0], is_closed: false });
    let page = await call(`/p/${e.id}`);
    expect(page.text).toContain('Tidspunktet er valgt');
    expect(page.text).toContain(`href="/api/events/${e.id}/ics"`);
    expect(page.text).toContain('is-chosen');
    const ch = await call(`/api/events/${e.id}/choose`, json('POST', { chosen_option_id: e.o[1] }, e.admin));
    expect(ch.body.chosen_option_id).toBe(e.o[1]);
    const cl = await call(`/api/events/${e.id}/choose`, json('POST', { chosen_option_id: null }, e.admin));
    expect(cl.body.chosen_option_id).toBeNull();
    page = await call(`/p/${e.id}`);
    expect(page.text).not.toContain('Tidspunktet er valgt');
    expect((await call(`/api/events/${e.id}`)).body.chosen_option_id).toBeNull();
  });

  test('validation: missing field, bad types, other poll\'s option → 400; JSON-only', async () => {
    const e = await create(); const f = await create();
    for (const b of [{}, { chosen_option_id: '1' }, { chosen_option_id: 0 }, { chosen_option_id: f.o[0] }, null]) {
      expect((await call(`/api/events/${e.id}/choose`, json('POST', b, e.admin))).status, JSON.stringify(b)).toBe(400);
    }
    expect((await call(`/api/events/${e.id}/choose`, { method: 'POST', token: e.admin, headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status).toBe(415);
  });

  test('closed poll can also change its chosen time; banner shows it', async () => {
    const e = await create();
    await call(`/api/events/${e.id}/close`, json('POST', {}, e.admin));
    const c = await call(`/api/events/${e.id}/choose`, json('POST', { chosen_option_id: e.o[1] }, e.admin));
    expect(c.body).toMatchObject({ is_closed: true, chosen_option_id: e.o[1] });
    expect((await call(`/p/${e.id}`)).text).toContain('Tidspunktet er valgt');
  });
});

describe('.ics', () => {
  test('404 until chosen; then RFC 5545 text/calendar attachment in UTC, escaped, folded, CRLF, no tokens', async () => {
    const e = await create('Teammøde; Q4, "plan" ' + 'æ'.repeat(60));
    expect((await call(`/api/events/${e.id}/ics`)).status).toBe(404);
    expect((await call('/api/events/AAAAAAAAAAAAAAAAAAAAAA/ics')).status).toBe(404);
    await call(`/api/events/${e.id}/choose`, json('POST', { chosen_option_id: e.o[0] }, e.admin));
    const r = await call(`/api/events/${e.id}/ics`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
    expect(r.headers.get('content-disposition')).toMatch(/^attachment; filename="teammoede-q4-plan-[a-z-]+\.ics"; filename\*=UTF-8''/);
    expect(r.headers.get('cache-control')).toMatch(/no-store/);
    const t = r.text;
    expect(t.split('\r\n').every((l) => Buffer.byteLength(l, 'utf8') <= 75)).toBe(true);
    expect(t.replace(/\r\n/g, '')).not.toMatch(/\n|\r/);
    const unfolded = t.replace(/\r\n /g, '');
    expect(unfolded).toContain(`UID:${e.id}@localhost\r\n`);
    expect(unfolded).toMatch(/SEQUENCE:\d+\r\nLAST-MODIFIED:\d{8}T\d{6}Z/);
    expect(unfolded).toMatch(/DTSTAMP:\d{8}T\d{6}Z/);
    expect(unfolded).toContain(`DTSTART:${Y}1103T080000Z`);
    expect(unfolded).toContain(`DTEND:${Y}1103T093000Z`);
    expect(unfolded).toContain('SUMMARY:Teammøde\\; Q4\\, "plan" ');
    expect(unfolded).toContain('DESCRIPTION:Linje 1\\nLinje 2');
    expect(t).not.toContain(e.admin);
    // stable UID across downloads
    const again = (await call(`/api/events/${e.id}/ics`)).text.replace(/\r\n /g, '');
    expect(again.match(/UID:.*/)![0]).toBe(unfolded.match(/UID:.*/)![0]);
  });

  test('changing the chosen time keeps the UID and bumps SEQUENCE (+ LAST-MODIFIED); same choice again does not', async () => {
    const e = await create();
    const ics = async () => (await call(`/api/events/${e.id}/ics`)).text.replace(/\r\n /g, '');
    const field = (t: string, f: string) => t.match(new RegExp(`^${f}:(.*)\r$`, 'm'))![1];
    await call(`/api/events/${e.id}/choose`, json('POST', { chosen_option_id: e.o[0] }, e.admin));
    const a = await ics();
    await call(`/api/events/${e.id}/choose`, json('POST', { chosen_option_id: e.o[0] }, e.admin)); // no change
    expect(field(await ics(), 'SEQUENCE')).toBe(field(a, 'SEQUENCE'));
    await new Promise((r) => setTimeout(r, 1100));
    await call(`/api/events/${e.id}/choose`, json('POST', { chosen_option_id: e.o[1] }, e.admin));
    const b = await ics();
    expect(field(b, 'UID')).toBe(field(a, 'UID'));
    expect(Number(field(b, 'SEQUENCE'))).toBe(Number(field(a, 'SEQUENCE')) + 1);
    expect(field(b, 'LAST-MODIFIED') > field(a, 'LAST-MODIFIED')).toBe(true);
    expect(field(b, 'DTSTART')).not.toBe(field(a, 'DTSTART'));
    // moving the chosen option via PATCH also bumps it
    const adm = await call(`/api/events/${e.id}/admin`, { token: e.admin });
    const moved = adm.body.time_options.map((o: Json) => ({ id: o.id, start: o.id === e.o[1] ? `${Y}-11-06T13:00:00Z` : o.start_at, end: o.end_at }));
    expect((await call(`/api/events/${e.id}`, json('PATCH', { title: 'T', time_options: moved }, e.admin))).status).toBe(200);
    const c = await ics();
    expect(Number(field(c, 'SEQUENCE'))).toBe(Number(field(b, 'SEQUENCE')) + 1);
    expect(field(c, 'DTSTART')).toBe(`${Y}1106T130000Z`);
  });

  test('bidi/invisible chars never reach the ICS filename (ASCII or UTF-8) or SUMMARY', async () => {
    const e = await create('a"b\\c/d e;f\u202Egnp\u2066x\u200D.exe');
    await call(`/api/events/${e.id}/choose`, json('POST', { chosen_option_id: e.o[0] }, e.admin));
    const r = await call(`/api/events/${e.id}/ics`);
    const cd = r.headers.get('content-disposition')!;
    expect(decodeURIComponent(cd)).not.toMatch(/[\u202A-\u202E\u2066-\u2069\u200B-\u200F]/);
    expect(cd).not.toMatch(/%E2%80%A[A-E]|%E2%81%A[6-9]|%E2%80%8[B-F]/i);
    expect(r.text).not.toMatch(/[\u202A-\u202E\u2066-\u2069]/);
  });

  test('no end time → default 1 hour', async () => {
    const e = await create();
    await call(`/api/events/${e.id}/choose`, json('POST', { chosen_option_id: e.o[1] }, e.admin));
    const t = (await call(`/api/events/${e.id}/ics`)).text;
    expect(t).toContain(`DTSTART:${Y}1104T130000Z\r\nDTEND:${Y}1104T140000Z`);
  });
});

describe('delete participant (admin)', () => {
  test('DELETE cascades votes, tally updates; token-protected; 404 for unknown / other poll', async () => {
    const e = await create(); const f = await create();
    const v1 = await call(`/api/events/${e.id}/votes`, json('POST', { name: 'Anders', votes: [{ option_id: e.o[0], value: 'yes' }] }));
    await call(`/api/events/${e.id}/votes`, json('POST', { name: 'Birgitte', votes: [{ option_id: e.o[0], value: 'yes' }] }));
    const vf = await call(`/api/events/${f.id}/votes`, json('POST', { name: 'X', votes: [{ option_id: f.o[0], value: 'yes' }] }));
    const pid = v1.body.participant_id;
    expect((await call(`/api/events/${e.id}/participants/${pid}`, { method: 'DELETE' })).status).toBe(401);
    expect((await call(`/api/events/${e.id}/participants/${pid}`, { method: 'DELETE', token: f.admin })).status).toBe(403);
    expect((await call(`/api/events/${e.id}/participants/${vf.body.participant_id}`, { method: 'DELETE', token: e.admin })).status).toBe(404);
    expect((await call(`/api/events/${e.id}/participants/abc`, { method: 'DELETE', token: e.admin })).status).toBe(404);
    const d = await call(`/api/events/${e.id}/participants/${pid}`, { method: 'DELETE', token: e.admin });
    expect(d.status).toBe(200);
    expect(d.headers.get('cache-control')).toMatch(/no-store/);
    expect(d.body.participants.map((p: Json) => p.name)).toEqual(['Birgitte']);
    expect(d.body.time_options[0].votes).toEqual({ yes: 1, maybe: 0, no: 0, total: 1 });
    expect((await call(`/api/events/${e.id}/participants/${pid}`, { method: 'DELETE', token: e.admin })).status).toBe(404);
    // the deleted participant's edit link no longer works; name is free again
    expect((await call(`/api/events/${e.id}/votes/me`, { token: v1.body.edit_token })).status).toBe(403);
    expect((await call(`/api/events/${e.id}/votes`, json('POST', { name: 'anders', votes: [{ option_id: e.o[0], value: 'no' }] }))).status).toBe(201);
  });
});
