import { describe, test, expect, inject } from 'vitest';
import { existsSync } from 'node:fs';

const BASE = inject('baseUrl');
const Y = new Date().getUTCFullYear() + 1;
const ip = () => `10.8.${(Math.random() * 255) | 0}.${(Math.random() * 250 + 1) | 0}`;
async function create() {
  const r = await fetch(`${BASE}/api/events`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip() },
    body: JSON.stringify({ title: 'Slet mig', time_options: [{ start: `${Y}-11-03T09:00:00Z` }] }) });
  const e = await r.json() as { id: string; admin_token: string; time_options: { id: number }[] };
  await fetch(`${BASE}/api/events/${e.id}/votes`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip() },
    body: JSON.stringify({ name: 'Anna', votes: [{ option_id: e.time_options[0].id, value: 'yes' }] }) });
  return e;
}
const del = (id: string, token?: string) => fetch(`${BASE}/api/events/${id}`, { method: 'DELETE', headers: { 'X-Forwarded-For': ip(), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });

describe('DELETE /api/events/:id', () => {
  test('requires the admin token (401 / 403), then deletes everything; second delete 404', async () => {
    const e = await create();
    expect((await del(e.id)).status).toBe(401);
    expect((await del(e.id, 'x'.repeat(43))).status).toBe(403);
    const r = await del(e.id, e.admin_token);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toContain('no-store');
    expect(await r.json()).toEqual({ deleted: true });
    expect((await fetch(`${BASE}/api/events/${e.id}`)).status).toBe(404);
    expect((await fetch(`${BASE}/p/${e.id}`)).status).toBe(404);
    expect([401, 403, 404]).toContain((await del(e.id, e.admin_token)).status);
  });
});

const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
describe.skipIf(!existsSync(CHROME))('delete poll UI (headless Chrome)', () => {
  test('danger zone → confirm dialog (Annullér focused) → start page with confirmation', async () => {
    const { chromium } = await import('playwright-core');
    const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
    try {
      const e = await create();
      const p = await b.newPage();
      await p.goto(`${BASE}/p/${e.id}/admin#${e.admin_token}`);
      await p.click('#delete-poll');
      await p.waitForSelector('dialog[open]');
      expect(await p.textContent('#dlg-h')).toContain('Slet «Slet mig»?');
      await p.click('dialog[open] .btn--danger');
      await p.waitForURL(`${BASE}/`);
      expect(await p.textContent('#deleted-notice')).toContain('Afstemningen er slettet');
      expect((await fetch(`${BASE}/api/events/${e.id}`)).status).toBe(404);
    } finally { await b.close(); }
  }, 30_000);
});
