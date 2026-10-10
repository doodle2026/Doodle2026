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
