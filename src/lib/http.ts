import { NextResponse } from 'next/server';

export const jsonError = (status: number, errors: string[], headers?: HeadersInit) =>
  NextResponse.json({ errors }, { status, headers });

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' })[c]!);
}

/** Read a request body with a hard byte cap (works even without/with a lying Content-Length). */
export async function readBodyLimited(req: Request, limit: number): Promise<{ text: string } | { tooLarge: true }> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) return { tooLarge: true };
  if (!req.body) return { text: '' };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); return { tooLarge: true }; }
    chunks.push(value);
  }
  return { text: Buffer.concat(chunks).toString('utf8') };
}

/** JSON-only body (415 otherwise, CSRF hardening), 32 kB cap (413), parse (400). Empty body → {} if allowEmpty. */
export async function readJson(req: Request, limit: number, allowEmpty = false): Promise<{ data: unknown } | { response: Response }> {
  const ct = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (ct !== 'application/json') return { response: jsonError(415, ['Content-Type skal være application/json.']) };
  const body = await readBodyLimited(req, limit);
  if ('tooLarge' in body) return { response: jsonError(413, ['Forespørgslen er for stor (maks. 32 kB).']) };
  if (allowEmpty && body.text.trim() === '') return { data: {} };
  try { return { data: JSON.parse(body.text) }; } catch { return { response: jsonError(400, ['Ugyldig JSON.']) }; }
}

/** Log only error class/code – never request data (may contain tokens/keys). */
export function logError(where: string, e: unknown) {
  console.error(`${where} failed:`, e instanceof Error ? `${e.name}${'code' in e ? ` ${String((e as { code: unknown }).code)}` : ''}` : 'unknown');
}

export const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' } as const;
