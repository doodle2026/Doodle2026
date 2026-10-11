/** Brand spelling is "grabAday" (Jan, 11 Oct): no visible "GrabAday"/"Grabaday"/"GRABADAY" anywhere. Domains/package/env stay lowercase. */
import { describe, test, expect, inject } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BASE = inject('baseUrl');
const WRONG = /GrabAday|Grabaday|GRABADAY/;
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

describe('brand spelling grabAday', () => {
  test('catalogs, source, email templates, brand assets, README and docs contain no wrong casing', () => {
    const files = [...walk('messages'), ...walk('src'), ...walk('public/brand').filter((f) => f.endsWith('.svg')), ...walk('docs'), 'README.md', 'scripts/capture-server.mjs'];
    const bad = files.filter((f) => WRONG.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
  test('every catalog string that names the brand uses "grabAday"', () => {
    for (const l of ['en', 'da', 'fr', 'de']) {
      const txt = readFileSync(`messages/${l}.json`, 'utf8');
      expect(txt).toMatch(/grabAday/);
      expect(txt.match(/\bgrab ?a ?day\b/gi)?.filter((m) => m !== 'grabAday' && m.toLowerCase() !== 'grabaday') ?? []).toEqual([]);
    }
  });
  test('rendered pages: <title>, header and metadata say grabAday', async () => {
    for (const p of ['/en', '/da', '/fr/abuse', '/de/owner/login']) {
      const html = await (await fetch(BASE + p)).text();
      expect(html, p).not.toMatch(WRONG);
      expect(html, p).toContain('grabAday');
    }
  });
});
