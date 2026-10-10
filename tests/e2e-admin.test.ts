/** Headless Chrome: the design spec (doodle-ui) round 4 (§26-32) – choose + undo, delete participant, inline option edit, V7 share flow. */
import { describe, test, expect, inject, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import type { Browser } from 'playwright-core';

const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const BASE = inject('baseUrl');
const Y = new Date().getUTCFullYear() + 1;
let browser: Browser;
const ip = () => `10.7.${(Math.random() * 255) | 0}.${(Math.random() * 254 + 1) | 0}`;

async function setup() {
  const r = await fetch(`${BASE}/api/events`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip() },
    body: JSON.stringify({ title: 'Runde 4', options: [{ date: `${Y}-11-03` }, { date: `${Y}-11-04` }] }) });
  const e = await r.json() as { id: string; admin_token: string; time_options: { id: number }[] };
  for (const [name, votes] of [['Anna', ['yes', 'no']], ['Bo', ['maybe', 'yes']]] as const) {
    await fetch(`${BASE}/api/events/${e.id}/votes`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip() },
      body: JSON.stringify({ name, votes: votes.map((v, i) => ({ option_id: e.time_options[i].id, value: v })) }) });
  }
  return e;
}
const pub = async (id: string) => (await fetch(`${BASE}/api/events/${id}`)).json();

describe.skipIf(!existsSync(CHROME))('admin round 4 (headless Chrome)', () => {
  beforeAll(async () => { const { chromium } = await import('playwright-core'); browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] }); });
  afterAll(async () => { await browser?.close(); });

  test('Endeligt: Vælg → ✓ Valgt + toast, Fortryd restores; Skift hertil; public banner with .ics + Google', async () => {
    const e = await setup();
    const p = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await p.goto(`${BASE}/p/${e.id}/admin#${e.admin_token}`);
    const b0 = '#admin-grid [data-choose]:nth-child(1)';
    await p.waitForSelector('#admin-grid .choose-btn');
    const btns = p.locator('#admin-grid .choose-btn');
    expect(await btns.nth(0).textContent()).toBe('Vælg');
    await btns.nth(0).click();
    await p.waitForSelector('.toast-undo');
    expect(await btns.nth(0).getAttribute('aria-pressed')).toBe('true');
    expect(await btns.nth(1).textContent()).toBe('Skift hertil');
    await expect.poll(async () => (await pub(e.id)).chosen_option_id).not.toBeNull();
    await p.click('#undo');
    await expect.poll(async () => (await pub(e.id)).chosen_option_id).toBeNull();
    await btns.nth(1).click();
    await expect.poll(async () => (await pub(e.id)).chosen_option_id).not.toBeNull();
    expect(await p.textContent('#result-banner')).toContain('Endeligt tidspunkt');
    const v = await browser.newPage();
    await v.goto(`${BASE}/p/${e.id}`);
    await v.waitForSelector('#result-banner #gcal');
    expect(await v.getAttribute('#gcal', 'href')).toContain('calendar.google.com');
    expect(await v.getAttribute('#ics', 'href')).toBe(`/api/events/${e.id}/ics`);
    void b0; await v.close(); await p.close();
  }, 30_000);

  test('delete participant: named dialog, Annullér has focus, delete moves focus to next trash button', async () => {
    const e = await setup();
    const p = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await p.goto(`${BASE}/p/${e.id}/admin#${e.admin_token}`);
    await p.waitForSelector('#admin-grid .del-btn');
    await p.click('#admin-grid .del-btn >> nth=0');
    await p.waitForSelector('dialog[open] #del-h');
    expect(await p.textContent('#del-h')).toBe('Slet Anna?');
    expect(await p.evaluate(() => document.activeElement?.id)).toBe('del-cancel');
    await p.click('#del-ok');
    await expect.poll(async () => (await pub(e.id)).participants.length).toBe(1);
    await expect.poll(() => p.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Slet Bo og deres svar');
    await p.close();
  }, 30_000);

  test('V10: ✎ opens inline edit, Esc cancels, changed start preselects Nulstil, Gem resets votes', async () => {
    const e = await setup();
    const p = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await p.goto(`${BASE}/p/${e.id}/admin#${e.admin_token}`);
    await p.click('[data-oe] >> nth=0');
    await p.waitForSelector('.opt-edit');
    await p.keyboard.press('Escape');
    expect(await p.$('.opt-edit')).toBeNull();
    await p.click('[data-oe] >> nth=0');
    await p.fill('#oe-s', '07:15');
    await expect.poll(() => p.isChecked('input[name="oe-v"][value="reset"]')).toBe(true);
    await p.fill('#oe-e', '06:00');
    await p.click('[data-oe-save]');
    expect(await p.textContent('#oe-err')).toContain('Sluttid');
    await p.fill('#oe-e', '');
    await p.press('#oe-s', 'Enter');
    await p.waitForSelector('.opt-edit', { state: 'detached' });
    await expect.poll(async () => (await pub(e.id)).participants.map((x: { votes: unknown[] }) => x.votes[0])).toEqual([null, null]);
    await p.close();
  }, 30_000);

  test('V7: Skjul closes without a dialog → yellow reminder; ✓ Jeg har gemt det collapses the admin link', async () => {
    const r = await fetch(`${BASE}/api/events`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip() },
      body: JSON.stringify({ title: 'V7', options: [{ date: `${Y}-11-03` }] }) });
    const e = await r.json() as { id: string; admin_url: string };
    const p = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await p.goto(`${BASE}/`);
    await p.evaluate(([id, u]) => sessionStorage.setItem(`mt-admin-${id}`, new URL(u, location.origin).pathname + new URL(u, location.origin).hash), [e.id, e.admin_url]);
    await p.goto(`${BASE}/p/${e.id}?created=1`);
    await p.waitForSelector('#adminurl');
    await p.click('#share-close');
    expect(await p.$('dialog[open]')).toBeNull();
    await p.waitForSelector('#share-reminder');
    expect(await p.textContent('#share-open')).toBe('↗ Del');
    await p.click('#rem-show');
    await p.waitForSelector('#adminurl');
    await p.click('#ack');
    await p.waitForSelector('#admin-done');
    expect(await p.$('#adminurl')).toBeNull();
    await p.click('#share-close');
    expect(await p.$('#share-reminder')).toBeNull();
    await p.close();
  }, 30_000);
});
