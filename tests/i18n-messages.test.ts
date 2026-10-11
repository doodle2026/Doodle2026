/** Phase 2 (§45.6): catalogs, type-safe keys, rich text without innerHTML, every locale renders its own copy. */
import { describe, test, expect, inject } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement, Fragment } from 'react';
import { formatHtml, htmlToReact } from '../src/i18n/rich';
import { markup, T } from './helpers/t';
import en from '../messages/en.json';

const BASE = inject('baseUrl');
const ip = () => `10.6.${(Math.random() * 255) | 0}.${(Math.random() * 254 + 1) | 0}`;
const html = (raw: string, vars = {}) => renderToStaticMarkup(createElement(Fragment, null, htmlToReact(formatHtml(raw, 'en', vars))));
const flat = (o: object, p = ''): string[] => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? flat(v, `${p}${k}.`) : [`${p}${k}`]));

describe('catalog checks', () => {
  test('i18n-check (keys, placeholders, plural other, ICU parse) passes – same script CI runs in `npm run lint`', () => {
    expect(execFileSync('node', ['scripts/i18n-check.mjs']).toString()).toMatch(/4 locales, 0 errors/);
  });
  test('every literal key used via t()/rich()/tr() in src exists in en.json', () => {
    const keys = new Set(flat(en));
    const files: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f)) files.push(p); } };
    walk('src');
    const missing: string[] = [];
    for (const f of files) {
      const s = readFileSync(f, 'utf8');
      for (const m of s.matchAll(/\b(?:t|tr|rich|t\.raw)\(\s*'([a-zA-Z]+\.[A-Za-z0-9_.]+)'/g)) if (!keys.has(m[1])) missing.push(`${f}: ${m[1]}`);
      for (const m of s.matchAll(/\[\s*'([a-z]+\.[A-Za-z0-9_]+)',\s*'[^']*',\s*'[^']*'\s*\]/g)) if (!keys.has(m[1])) missing.push(`${f}: ${m[1]}`);
    }
    expect(missing).toEqual([]);
  });
  test('fr/de plurals and select render', () => {
    expect(T.fr('date.count', { n: 1 })).toMatch(/^1 /);
    expect(T.de('admin.pcount', { n: 2 })).toMatch(/2/);
    expect(T.en('admin.dateChanged', { date: 'X', mode: 'reset', n: 3 })).toBe('✓ The date has been changed to X – 3 answers reset.');
    expect(T.da('vote.saved', { name: 'Jan' })).toBe('✓ Tak, Jan! Dine svar er gemt.');
  });
});

describe('rich catalog text → React (no innerHTML)', () => {
  test('whitelisted tags become elements; variables are escaped', () => {
    expect(html('Hi <strong>{name}</strong>', { name: '<img src=x onerror=alert(1)>' })).toBe('Hi <strong>&lt;img src=x onerror=alert(1)&gt;</strong>');
    expect(html('<a href="{href}">x</a>', { href: '/u/all/abc' })).toBe('<a href="/u/all/abc">x</a>');
    expect(html('<a href="{href}">x</a>', { href: 'javascript:alert(1)' })).toBe('<a>x</a>');
    expect(html('a<br>b <code>c</code>')).toBe('a<br/>b <code>c</code>');
    expect(html('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html('<span class="dp__desk">k</span>')).toBe('<span class="dp__desk">k</span>');
    expect(html('&lt;name@x.dk&gt; {n, plural, one {# date} other {# dates}}', { n: 2 })).toBe('&lt;name@x.dk&gt; 2 dates');
  });
});

describe('pages render in the URL locale', () => {
  const page = async (p: string) => markup(await (await fetch(BASE + p, { headers: { 'X-Forwarded-For': ip() } })).text());
  test('create page copy per locale', async () => {
    const want = { en: 'Create a poll', da: 'Opret en afstemning', fr: T.fr('create.h1'), de: T.de('create.h1') };
    for (const [l, h] of Object.entries(want)) {
      const s = await page(`/${l}`);
      expect(s, l).toContain(`<html lang="${l}"`);
      expect(s, l).toContain(h.replace(/'/g, '&#x27;'));
    }
  });
  test('poll page: dates, meta description and OG alt follow the locale; user content untouched', async () => {
    const y = new Date().getUTCFullYear() + 1;
    const r = await fetch(`${BASE}/api/events`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip() },
      body: JSON.stringify({ title: 'Julefrokost', options: [{ date: `${y}-10-14` }, { date: `${y}-10-22` }] }) });
    const { id } = await r.json();
    const en = await page(`/en/p/${id}`), de = await page(`/de/p/${id}`), da = await page(`/da/p/${id}`);
    expect(en).toContain('Julefrokost');
    expect(de).toContain('Julefrokost');
    expect(en).toMatch(/Choose the dates that suit you\. 2 date proposals, October 14\s–\s22, \d{4}\./);
    expect(da).toContain(`Vælg de datoer, der passer dig. 2 datoforslag, 14.–22. oktober ${y}.`);
    expect(en).toContain('og:locale" content="en_GB"');
    expect(de).toContain('og:locale" content="de_DE"');
    expect(en).toContain('Which dates work for you?');
    expect(de).toContain(T.de('vote.h'));
    const og = await fetch(`${BASE}/fr/p/${id}/opengraph-image`);
    expect(og.status).toBe(200);
    expect(og.headers.get('content-type')).toBe('image/png');
  });
});
