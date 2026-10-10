// Pure, client-safe parsing of pasted invitation recipients (design §42 ParsedRecipients).
export const MAX_PER_SEND = 50;
export const MAX_PER_POLL = 200;
export const MESSAGE_MAX = 1000;
export const NAME_MAX = 100;

const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
export const normEmail = (e: string) => e.trim().toLowerCase();
export const validEmail = (e: string) => e.length <= 254 && EMAIL_RE.test(e) && !e.includes('..') && /\.[A-Za-z]{2,}$/.test(e);

export interface Recipient { email: string; name?: string }
export interface ParsedRecipients { valid: Recipient[]; invalid: string[]; duplicates: string[]; alreadyInvited: string[] }

const cleanName = (s: string) =>
  s.replace(/[\u0000-\u001F\u007F"<>]/g, ' ').replace(/[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);

/** Split on newlines, commas and semicolons (but not inside "Name <email>"); accepts `Name <email>`. */
export function parseRecipients(input: string | string[], alreadyInvited: Iterable<string> = []): ParsedRecipients {
  const items: string[] = [];
  for (const chunk of Array.isArray(input) ? input : [input]) {
    // `Name <email>` entries first (names may contain spaces), then split the rest on commas/semicolons/whitespace.
    const rest = chunk.replace(/([^,;\n<>]*)<([^<>\n]+)>/g, (_, n: string, e: string) => { items.push(`${n.trim()} <${e.trim()}>`); return ' '; });
    items.push(...rest.split(/[\s,;]+/));
  }
  for (let k = items.length - 1; k >= 0; k--) { items[k] = items[k].trim(); if (!items[k]) items.splice(k, 1); }
  const known = new Set([...alreadyInvited].map(normEmail));
  const seen = new Set<string>();
  const out: ParsedRecipients = { valid: [], invalid: [], duplicates: [], alreadyInvited: [] };
  for (const raw of items) {
    const m = /^(.*?)<([^<>]+)>\s*$/.exec(raw);
    const email = normEmail(m ? m[2] : raw.replace(/^mailto:/i, ''));
    const name = m ? cleanName(m[1]) : '';
    if (!validEmail(email)) { out.invalid.push(raw.slice(0, 320)); continue; }
    if (seen.has(email)) { out.duplicates.push(email); continue; }
    seen.add(email);
    if (known.has(email)) { out.alreadyInvited.push(email); continue; }
    out.valid.push(name ? { email, name } : { email });
  }
  return out;
}

/** Grapheme count (personal message limit is in graphemes). */
export const graphemes = (s: string) => [...new Intl.Segmenter('da', { granularity: 'grapheme' }).segment(s)].length;

/** "anna@example.com" → "a***@example.com" */
export const maskAddress = (e: string) => { const at = e.lastIndexOf('@'); return at > 0 ? `${e[0]}***${e.slice(at)}` : '***'; };
