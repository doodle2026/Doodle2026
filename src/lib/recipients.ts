// Pure, client-safe parsing of pasted invitation recipients (design §42 ParsedRecipients).
export const MAX_PER_SEND = 50;
export const MAX_PER_POLL = 200;
export const MESSAGE_MAX = 1000;
export const NAME_MAX = 100;

const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
export const normEmail = (e: string) => e.trim().toLowerCase();
/** L1: also local part ≤ 64, no leading/trailing dot in the local part, no consecutive dots anywhere. */
export const validEmail = (e: string) => {
  if (e.length > 254 || !EMAIL_RE.test(e) || e.includes('..') || !/\.[A-Za-z]{2,}$/.test(e)) return false;
  const local = e.slice(0, e.lastIndexOf('@'));
  return local.length >= 1 && local.length <= 64 && !local.startsWith('.') && !local.endsWith('.');
};

export interface Recipient { email: string; name?: string }
export interface ParsedRecipients { valid: Recipient[]; invalid: string[]; duplicates: string[]; alreadyInvited: string[] }

const cleanName = (s: string) =>
  s.replace(/[\u0000-\u001F\u007F<>]/g, ' ').replace(/[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);

/** Split on newlines, commas and semicolons (but not inside "Name <email>"); accepts `Name <email>`. */
/** `Name <email>` incl. quoted names with commas/semicolons ('"Lund, Jan" <a@x>') – shared by server parsing and the bulk field (H3). */
export const NAME_ADDR_RE = /((?:"(?:[^"\\\n]|\\.)*"|[^,;\n<>"])*)<([^<>\n]+)>/g;
/** Strip the outer quotes of a quoted display name and undo backslash escapes (`"Say \\"hi\\", Bo"` → `Say "hi", Bo`). */
export const unquote = (n: string) => { n = n.trim(); const m = /^"(.*)"$/s.exec(n); return (m ? m[1].replace(/\\(.)/g, '$1') : n).trim(); };

export function parseRecipients(input: string | string[], alreadyInvited: Iterable<string> = []): ParsedRecipients {
  const items: string[] = [];
  for (const chunk of Array.isArray(input) ? input : [input]) {
    // `Name <email>` entries first (names may contain spaces), then split the rest on commas/semicolons/whitespace.
    const rest = chunk.replace(NAME_ADDR_RE, (_, n: string, e: string) => { items.push(`${unquote(n)} <${e.trim()}>`); return ' '; });
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
