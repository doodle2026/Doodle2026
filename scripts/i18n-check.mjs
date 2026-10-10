// Port of Doodle UI's i18n/build.js validation (design §45.6) – runs in `npm run lint` (CI):
// every catalog must have exactly en.json's keys, the same placeholders ({x}, {x, plural…}, {{mustache}}),
// and every plural needs an `other` branch. Messages must also parse as ICU. Exit 1 on any error.
import { readFileSync } from 'node:fs';
import { IntlMessageFormat } from 'intl-messageformat';
const L = ['en', 'da', 'fr', 'de'];
const cat = Object.fromEntries(L.map((l) => [l, JSON.parse(readFileSync(new URL(`../messages/${l}.json`, import.meta.url), 'utf8'))]));
const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? flat(v, p + k + '.') : [[p + k, v]]));
const F = Object.fromEntries(L.map((l) => [l, Object.fromEntries(flat(cat[l]))]));
const vars = (s) => [...new Set([...s.matchAll(/\{\s*(\w+)\s*(?:\}|,\s*(?:plural|select)\s*,)/g)].map((m) => m[1])
  .concat([...s.matchAll(/\{\{[#^/]?(\w+)\}\}/g)].map((m) => m[1])))].sort().join(',');
let err = 0;
const say = (m) => { console.error(m); err++; };
for (const l of L.slice(1)) {
  for (const k in F.en) {
    if (!(k in F[l])) say(`${l}: missing ${k}`);
    else if (vars(F.en[k]) !== vars(F[l][k])) say(`${l}: placeholder mismatch ${k}: [${vars(F.en[k])}] vs [${vars(F[l][k])}]`);
  }
  for (const k in F[l]) if (!(k in F.en)) say(`${l}: extra key ${k}`);
}
for (const l of L) for (const [k, v] of Object.entries(F[l])) {
  if (typeof v !== 'string') { say(`${l}: ${k} is not a string`); continue; }
  if (/,\s*plural\s*,/.test(v) && !/other\s*\{/.test(v)) say(`${l}: plural without 'other' ${k}`);
  if (!k.startsWith('email.')) { try { new IntlMessageFormat(v, l, undefined, { ignoreTag: true }); } catch (e) { say(`${l}: ICU parse error ${k}: ${e.message}`); } }
}
console.log(`i18n: ${Object.keys(F.en).length} keys × ${L.length} locales, ${err} errors`);
process.exit(err ? 1 : 0);
