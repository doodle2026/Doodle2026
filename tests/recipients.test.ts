import { describe, expect, it } from 'vitest';
import { parseRecipients, graphemes, maskAddress } from '../src/lib/recipients';

describe('parseRecipients', () => {
  it('splits commas, semicolons, spaces, newlines; Outlook "Name <email>"; validates; dedupes; already invited', () => {
    const r = parseRecipients('mads@firma.dk, Ny Kollega <Ny.Kollega@Firma.dk>; pia@firma, ole@firma.dk OLE@firma.dk\nanders@firma.dk sara@@firma.dk', ['anders@firma.dk']);
    expect(r.valid).toEqual([{ email: 'ny.kollega@firma.dk', name: 'Ny Kollega' }, { email: 'mads@firma.dk' }, { email: 'ole@firma.dk' }]);
    expect(r.invalid).toEqual(['pia@firma', 'sara@@firma.dk']);
    expect(r.duplicates).toEqual(['ole@firma.dk']);
    expect(r.alreadyInvited).toEqual(['anders@firma.dk']);
  });
  it('names are cleaned (no quotes/control/bidi)', () => {
    expect(parseRecipients('"Evil\u202E" <a@b.dk>').valid[0].name).toBe('Evil');
  });
  it('helpers', () => {
    expect(graphemes('👨‍👩‍👧é')).toBe(2);
    expect(maskAddress('anna@example.com')).toBe('a***@example.com');
  });
});
