/** Step 5: personal invite links (#inv=<token>) – API + headless. */
import { describe, test, expect, inject, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { Browser } from 'playwright-core';

const BASE = inject('baseUrl');
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const prisma = new PrismaClient();
const Y = new Date().getUTCFullYear() + 1;
const ip = () => `10.40.${(Math.random() * 255) | 0}.${(Math.random() * 250 + 1) | 0}`;
const u = () => Math.random().toString(36).slice(2, 9);
const SECRET = 'dev-only-email-link-secret-not-for-production';
const invTok = (id: number, gen: number) => createHmac('sha256', SECRET).update(`moedetid-invite-v1:${id}:${gen}`).digest('base64url');
let browser: Browser | undefined;
afterAll(async () => { await browser?.close(); await prisma.$disconnect(); });

async function call(path: string, init: { method?: string; token?: string; json?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { 'X-Forwarded-For': ip(), ...init.headers };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.json !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(BASE + path, { method: init.method ?? 'GET', headers, body: init.json !== undefined ? JSON.stringify(init.json) : undefined });
  const t = await r.text(); let body: any; try { body = JSON.parse(t); } catch { body = t; } // eslint-disable-line @typescript-eslint/no-explicit-any
  return { status: r.status, body };
}
async function setup(track = true) {
  const e = (await call('/api/events', { method: 'POST', json: { title: 'Spor', options: [{ date: `${Y}-11-03` }, { date: `${Y}-11-04` }] } })).body;
  const a = `jonas.krogh-${u()}@firma.dk`, b = `b-${u()}@firma.dk`;
  const r = await call(`/api/events/${e.id}/invitations`, { method: 'POST', token: e.admin_token, json: { recipients: [`Jonas Krogh <${a}>`, b], track } });
  expect(r.status).toBe(201);
  const rows = await prisma.invitation.findMany({ where: { event: { slug: e.id } }, orderBy: { id: 'asc' } });
  return { e, a, b, rows, opt: e.time_options.map((o: { id: number }) => o.id) as number[] };
}
const vote = (slug: string, name: string, opts: number[], inv?: string) =>
  call(`/api/events/${slug}/votes`, { method: 'POST', json: { name, votes: opts.map((option_id) => ({ option_id, value: 'yes' })) }, headers: inv ? { 'X-Invite-Token': inv } : {} });
const list = async (s: { e: { id: string; admin_token: string } }) => (await call(`/api/events/${s.e.id}/invitations`, { token: s.e.admin_token })).body;

describe('personal invite links (step 5)', () => {
  test('tracking stored on the poll; only hashes stored; GET /invite → email + name hint; vote via link → answered', async () => {
    const s = await setup();
    const [ra] = s.rows;
    expect(ra.inviteGen).toBe(1); expect(ra.inviteTokenHash).toMatch(/^[0-9a-f]{64}$/);
    const t = invTok(ra.id, 1);
    expect(JSON.stringify(s.rows)).not.toContain(t);
    const who = await call(`/api/events/${s.e.id}/invite`, { token: t });
    expect(who.body).toMatchObject({ email: s.a, name_hint: 'Jonas Krogh', answered: false });
    const l0 = await list(s);
    expect(l0.tracking).toBe(true);
    expect(l0.invitees.map((i: { response: string }) => i.response)).toEqual(['invited', 'invited']);
    expect((await vote(s.e.id, 'Jonas', s.opt, t)).status).toBe(201);
    const l1 = await list(s);
    expect(l1.invitees[0].response).toBe('answered');
    expect(l1.public_answers).toEqual([]);
    expect(l1.reminder.recipient_count).toBe(1); // only the one who hasn't answered
  });

  test('reminders with tracking go only to unanswered (and carry their personal link)', async () => {
    const s = await setup();
    await vote(s.e.id, 'Jonas', s.opt, invTok(s.rows[0].id, 1));
    const r = await call(`/api/events/${s.e.id}/reminders`, { method: 'POST', token: s.e.admin_token });
    expect(r.status).toBe(201); expect(r.body.recipients).toBe(1);
  });

  test('public voters shown as "ikke inviteret"; manual link + undo; only manual links can be undone', async () => {
    const s = await setup();
    const v = await vote(s.e.id, 'Jan', s.opt);
    const l = await list(s);
    expect(l.public_answers).toEqual([{ id: v.body.participant_id, name: 'Jan' }]);
    const k = await call(`/api/events/${s.e.id}/invitations/link`, { method: 'POST', token: s.e.admin_token, json: { email: s.b, participant_id: v.body.participant_id } });
    expect(k.status).toBe(200);
    expect(k.body.invitees[1]).toMatchObject({ response: 'answered', linked_from: 'Jan' });
    expect(k.body.public_answers).toEqual([]);
    expect((await call(`/api/events/${s.e.id}/invitations/link`, { method: 'POST', token: s.e.admin_token, json: { email: s.a, participant_id: v.body.participant_id } })).body.code).toBe('already_linked');
    const un = await call(`/api/events/${s.e.id}/invitations/unlink`, { method: 'POST', token: s.e.admin_token, json: { email: s.b } });
    expect(un.body.invitees[1].response).toBe('invited');
    await vote(s.e.id, 'Jonas', s.opt, invTok(s.rows[0].id, 1));
    expect((await call(`/api/events/${s.e.id}/invitations/unlink`, { method: 'POST', token: s.e.admin_token, json: { email: s.a } })).body.code).toBe('not_manual');
  });

  test('resend issues a NEW token (old one dies); revoke invalidates, keeps the answer; reissue optional', async () => {
    const s = await setup(); const id = s.rows[0].id;
    const r = await call(`/api/events/${s.e.id}/invitations/resend`, { method: 'POST', token: s.e.admin_token, json: { email: s.a } });
    expect(r.status).toBe(200);
    expect((await call(`/api/events/${s.e.id}/invite`, { token: invTok(id, 1) })).body.code).toBe('inactive');
    expect((await call(`/api/events/${s.e.id}/invite`, { token: invTok(id, 2) })).status).toBe(200);
    await vote(s.e.id, 'Jonas', s.opt, invTok(id, 2));
    const rv = await call(`/api/events/${s.e.id}/invitations/revoke`, { method: 'POST', token: s.e.admin_token, json: { email: s.a } });
    expect(rv.status).toBe(200);
    expect((await call(`/api/events/${s.e.id}/invite`, { token: invTok(id, 2) })).status).toBe(404);
    expect(rv.body.invitees[0].response).toBe('answered'); // answer kept
    const rb = await call(`/api/events/${s.e.id}/invitations/revoke`, { method: 'POST', token: s.e.admin_token, json: { email: s.b } });
    expect(rb.body.invitees[1].response).toBe('revoked');
    const re = await call(`/api/events/${s.e.id}/invitations/revoke`, { method: 'POST', token: s.e.admin_token, json: { email: s.b, reissue: true } });
    expect(re.body.invitees[1].response).toBe('invited');
    expect((await call(`/api/events/${s.e.id}/invite`, { token: invTok(s.rows[1].id, 4) })).status).toBe(200);
  });

  test('a link for poll A does nothing on poll B; untracked invites have no personal link', async () => {
    const s = await setup(); const t = await setup(false);
    expect((await call(`/api/events/${t.e.id}/invite`, { token: invTok(s.rows[0].id, 1) })).status).toBe(404);
    const v = await vote(t.e.id, 'X', t.opt, invTok(s.rows[0].id, 1));
    expect(v.status).toBe(201);
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: s.rows[0].id } })).participantId).toBeNull();
    expect(t.rows.every((r) => r.inviteGen === null)).toBe(true);
    expect((await list(t)).tracking).toBe(false);
  });

  test('headless: #inv= prefills name + banner, "Ikke dig?" switches to public; #invite= works; revoked shows note', async () => {
    if (!existsSync(CHROME)) return;
    const { chromium } = await import('playwright-core');
    browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
    const s = await setup(); const t = invTok(s.rows[0].id, 1);
    const p = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await p.goto(`${BASE}/p/${s.e.id}#inv=${t}`);
    await p.waitForSelector('#personal-banner');
    expect(await p.textContent('#personal-banner')).toContain(s.a);
    expect(await p.inputValue('#name')).toBe('Jonas Krogh');
    expect(p.url()).not.toContain(t); // fragment stripped
    await p.click('#personal-banner a');
    await p.waitForSelector('#personal-banner', { state: 'detached' });
    expect(await p.inputValue('#name')).toBe('');
    const p1 = await browser.newPage(); // same-document hash change wouldn't reload
    await p1.goto(`${BASE}/p/${s.e.id}#invite=${invTok(s.rows[1].id, 1)}`);
    await p1.waitForSelector('#personal-banner');
    await call(`/api/events/${s.e.id}/invitations/revoke`, { method: 'POST', token: s.e.admin_token, json: { email: s.a } });
    const p2 = await browser.newPage();
    await p2.goto(`${BASE}/p/${s.e.id}#inv=${t}`);
    await p2.waitForSelector('#invite-inactive');
    // admin: Svar column + public answer link dialog validation
    await vote(s.e.id, 'Kasper', s.opt);
    const a = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
    await a.goto(`${BASE}/p/${s.e.id}/admin#${s.e.admin_token}`);
    await a.waitForSelector('#public-answers');
    expect(await a.textContent('#rtable thead')).toContain('Svar');
    expect(await a.isDisabled('#track')).toBe(true);
    await a.click('[data-linkp]'); await a.waitForSelector('dialog[open] #linksel');
    await a.click('#c-ok');
    expect(await a.getAttribute('#linksel', 'aria-invalid')).toBe('true');
    await a.selectOption('#linksel', s.b); await a.click('#c-ok');
    await a.waitForSelector('#inv-undo');
    expect(await a.textContent('#rtable')).toContain('Knyttet til svar fra "Kasper"');
    await a.click('#inv-undo');
    await a.waitForSelector('#public-answers [data-linkp]');
  }, 60_000);
});
